import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import WebSocket from 'ws';

export interface TextResult {
  text: string;
  isError: boolean;
}

/** An agent at the table, talking to the server over MCP. */
export class AgentClient {
  private constructor(
    readonly client: Client,
    readonly seatToken: string,
    readonly name: string,
  ) {}

  static async connect(port: number, name = 'agent'): Promise<Client> {
    const client = new Client({ name, version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    return client;
  }

  static async join(port: number, game: string, name: string): Promise<AgentClient> {
    const client = await AgentClient.connect(port, name);
    const result = await call(client, 'join_game', { game, name });
    if (result.isError) throw new Error(`join failed: ${result.text}`);
    const token = /seat token \(keep it, it is your identity\): (\w+)/.exec(result.text)?.[1];
    if (!token) throw new Error(`no token in response:\n${result.text}`);
    return new AgentClient(client, token, name);
  }

  call(tool: string, args: Record<string, unknown> = {}): Promise<TextResult> {
    return call(this.client, tool, { seat_token: this.seatToken, ...args });
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export async function call(
  client: Client,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<TextResult> {
  const result = (await client.callTool({ name: tool, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = (result.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n');
  return { text, isError: result.isError === true };
}

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

/** A human at the table, talking to the server over the WebSocket the browser uses. */
export class HumanClient {
  readonly received: WsMessage[] = [];
  private nextId = 0;

  private constructor(private readonly socket: WebSocket) {}

  static async connect(port: number, token: string): Promise<HumanClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const client = new HumanClient(socket);
    socket.on('message', (raw) => client.received.push(JSON.parse(String(raw)) as WsMessage));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  send(command: Record<string, unknown>): Promise<WsMessage> {
    const id = `m${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${JSON.stringify(command)}`)), 4000);
      const onMessage = (raw: WebSocket.RawData) => {
        const message = JSON.parse(String(raw)) as WsMessage;
        if (message['id'] !== id) return;
        clearTimeout(timer);
        this.socket.off('message', onMessage);
        resolve(message);
      };
      this.socket.on('message', onMessage);
      this.socket.send(JSON.stringify({ id, type: 'command', command }));
    });
  }

  /** Latest state snapshot pushed by the server. */
  view(): Record<string, unknown> | undefined {
    for (let i = this.received.length - 1; i >= 0; i -= 1) {
      const message = this.received[i];
      if (message?.type === 'state') return message['view'] as Record<string, unknown>;
    }
    return undefined;
  }

  texts(): string[] {
    return this.received
      .filter((m) => m.type === 'events')
      .flatMap((m) => (m['events'] as { text: string }[]).map((e) => e.text));
  }

  async waitFor(predicate: (messages: WsMessage[]) => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.received)) {
      if (Date.now() > deadline) throw new Error('timed out waiting for a websocket message');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): void {
    this.socket.close();
  }
}

export async function postJson(port: number, path: string, body: unknown): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function getJson(port: number, path: string): Promise<any> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return response.json();
}
