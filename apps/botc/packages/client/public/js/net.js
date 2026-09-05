/** Thin wrappers over the server's HTTP API and the game WebSocket. */

export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `request failed (${response.status})`);
  return data;
}

/**
 * Connects to the game socket and keeps reconnecting. `handlers` gets
 * `state`, `events`, `error` and `status` callbacks.
 */
export function connect(token, handlers) {
  let socket = null;
  let closed = false;
  let backoff = 500;
  let pending = new Map();
  let nextId = 0;

  const open = () => {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`);

    socket.addEventListener('open', () => {
      backoff = 500;
      handlers.status?.('connected');
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
      if (message.type === 'state') handlers.state?.(message.view);
      else if (message.type === 'events') handlers.events?.(message.events);
      else if (message.type === 'error' && !message.id) handlers.error?.(message.error);
    });

    socket.addEventListener('close', () => {
      handlers.status?.('disconnected');
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000);
    });

    socket.addEventListener('error', () => socket?.close());
  };

  open();

  return {
    /** Send a command; resolves with the server's ok/error reply. */
    send(command) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ type: 'error', error: 'not connected' });
      }
      const id = `c${++nextId}`;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        setTimeout(() => {
          if (pending.delete(id)) resolve({ type: 'error', error: 'no reply from the server' });
        }, 8000);
        socket.send(JSON.stringify({ id, type: 'command', command }));
      });
    },
    close() {
      closed = true;
      socket?.close();
    },
  };
}
