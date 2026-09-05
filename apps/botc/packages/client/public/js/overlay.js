/** A modal for long documents (the briefing, the chronicle), with markdown-lite. */

const inline = (text) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

/** Enough markdown for what the server writes: headings, lists, tables, rules. */
export function markdown(source) {
  const out = [];
  const lines = source.split('\n');
  let list = null;
  let table = null;
  let para = null;

  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
  };
  const closeParagraph = () => {
    if (para) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = null;
    }
  };
  const closeTable = () => {
    if (table) {
      const [head, ...body] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|.*\|$/.test(line)) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue; // the separator row
      closeParagraph();
      closeList();
      (table ??= []).push(cells);
      continue;
    }
    closeTable();

    if (list && /^\s{2,}\S/.test(raw) && !/^\s*[-*]\s/.test(raw)) {
      list[list.length - 1] = list[list.length - 1].replace('</li>', ` ${inline(line.trim())}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 5);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      closeParagraph();
      (list ??= []).push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    // Wrapped source lines belong to one paragraph, not one each.
    (para ??= []).push(line.trim());
  }
  closeParagraph();
  closeList();
  closeTable();
  return out.join('\n');
}

let node = null;

export function showOverlay(title, body, { loading = false } = {}) {
  if (!node) {
    node = document.createElement('div');
    node.className = 'overlay';
    node.addEventListener('click', (event) => {
      if (event.target === node || event.target.dataset.close !== undefined) hideOverlay();
    });
    document.body.appendChild(node);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideOverlay();
    });
  }
  node.hidden = false;
  node.innerHTML = `
    <div class="overlay-card">
      <header><h2>${inline(title)}</h2><button data-close>Close</button></header>
      <div class="overlay-body">${loading ? '<p>…</p>' : markdown(body)}</div>
    </div>`;
}

export function hideOverlay() {
  if (node) node.hidden = true;
}
