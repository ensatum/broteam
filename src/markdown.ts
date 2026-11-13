function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  mdash: '\u2014',
  ndash: '\u2013',
  laquo: '\u00ab',
  raquo: '\u00bb',
  hellip: '\u2026',
};

/** Tracker stores Yandex markup, which keeps a few HTML entities as text. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:([a-z]+)|#(\d+)|#x([0-9a-f]+));/gi, (all, name: string, dec: string, hex: string) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? all;
    const code = dec ? Number(dec) : Number.parseInt(hex, 16);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return all;
    if (code < 32 && code !== 9 && code !== 10) return all;
    return String.fromCodePoint(code);
  });
}

function inline(text: string): string {
  const kept: string[] = [];
  const marked = text.replace(/<u>([^<]*)<\/u>/gi, (_all, inner: string) => {
    kept.push(`<u>${escapeHtml(inner)}</u>`);
    return `\u0000${kept.length - 1}\u0000`;
  });
  let html = escapeHtml(marked);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\+\+([^+]+)\+\+/g, '<u>$1</u>');
  html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\u0000(\d+)\u0000/g, (_all, index: string) => kept[Number(index)] || '');
  return html;
}

type ListItem = { indent: number; ordered: boolean; text: string };

function renderList(items: ListItem[]): string {
  const index = { i: 0 };
  const chunks: string[] = [];
  while (index.i < items.length) chunks.push(renderListLevel(items, index, items[index.i].indent));
  return chunks.join('');
}

function renderListLevel(items: ListItem[], index: { i: number }, base: number): string {
  const ordered = items[index.i].ordered;
  const tag = ordered ? 'ol' : 'ul';
  const buf: string[] = [];
  while (index.i < items.length && items[index.i].indent >= base && items[index.i].ordered === ordered) {
    const item = items[index.i];
    if (item.indent > base) break;
    index.i += 1;
    let nested = '';
    if (index.i < items.length && items[index.i].indent > item.indent) {
      nested = renderListLevel(items, index, items[index.i].indent);
    }
    buf.push(`<li>${inline(item.text)}${nested}</li>`);
  }
  return `<${tag}>${buf.join('')}</${tag}>`;
}

const NOTE_OPEN = /^\{%\s*note(?:\s+(info|tip|warning|alert))?(?:\s+"([^"]*)"|\s+'([^']*)')?\s*%}\s*$/i;
const CUT_OPEN = /^\{%\s*cut(?:\s+"([^"]*)"|\s+'([^']*)')?\s*%}\s*$/i;
const NOTE_CLOSE = /^\{%\s*endnote\s*%}\s*$/i;
const CUT_CLOSE = /^\{%\s*endcut\s*%}\s*$/i;

function splitCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isTableHead(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1]));
}

function renderTable(lines: string[], index: { i: number }): string {
  const header = splitCells(lines[index.i]);
  index.i += 2;
  const rows: string[][] = [];
  while (index.i < lines.length && lines[index.i].includes('|') && lines[index.i].trim()) {
    if (isTableSeparator(lines[index.i])) {
      index.i += 1;
      continue;
    }
    rows.push(splitCells(lines[index.i]));
    index.i += 1;
  }
  const cells = (values: string[], tag: 'th' | 'td') =>
    header
      .map((_, cell) => `<${tag}>${inline(values[cell] || '')}</${tag}>`)
      .join('');
  const head = `<thead><tr>${cells(header, 'th')}</tr></thead>`;
  const body = rows.map((row) => `<tr>${cells(row, 'td')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function takeBlock(lines: string[], start: number, close: RegExp): { body: string; next: number } {
  const buf: string[] = [];
  let i = start;
  while (i < lines.length && !close.test(lines[i].trim())) {
    buf.push(lines[i]);
    i += 1;
  }
  if (i < lines.length) i += 1;
  return { body: buf.join('\n'), next: i };
}

const NOTE_TONE: Record<string, string> = {
  info: 'yfm-note-info',
  tip: 'yfm-note-tip',
  warning: 'yfm-note-warning',
  alert: 'yfm-note-alert',
};

/** Markdown plus the Yandex blocks Tracker stores in descriptions and comments. */
export function renderMarkdown(source: string): string {
  const lines = decodeEntities(source).replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const note = NOTE_OPEN.exec(trimmed);
    if (note) {
      const block = takeBlock(lines, i + 1, NOTE_CLOSE);
      const tone = NOTE_TONE[(note[1] || 'info').toLowerCase()] || NOTE_TONE.info;
      const title = note[2] || note[3] || '';
      const heading = title ? `<div class="yfm-note-title">${inline(title)}</div>` : '';
      out.push(`<aside class="yfm-note ${tone}">${heading}${renderMarkdown(block.body)}</aside>`);
      i = block.next;
      continue;
    }
    const cut = CUT_OPEN.exec(trimmed);
    if (cut) {
      const block = takeBlock(lines, i + 1, CUT_CLOSE);
      const title = cut[1] || cut[2] || 'Подробнее';
      out.push(`<details class="yfm-cut"><summary>${inline(title)}</summary>${renderMarkdown(block.body)}</details>`);
      i = block.next;
      continue;
    }
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(escapeHtml(lines[i]));
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (!trimmed) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (isTableHead(lines, i)) {
      const cursor = { i };
      out.push(renderTable(lines, cursor));
      i = cursor.i;
      continue;
    }
    if (line.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        buf.push(inline(lines[i].slice(2)));
        i += 1;
      }
      out.push(`<blockquote>${buf.join('<br/>')}</blockquote>`);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!match) break;
        items.push({
          indent: match[1].length,
          ordered: /\d/.test(match[2]),
          text: match[3],
        });
        i += 1;
      }
      out.push(renderList(items));
      continue;
    }
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) &&
      !NOTE_OPEN.test(lines[i].trim()) &&
      !CUT_OPEN.test(lines[i].trim()) &&
      !isTableHead(lines, i)
    ) {
      buf.push(inline(lines[i]));
      i += 1;
    }
    out.push(`<p>${buf.join('<br/>')}</p>`);
  }
  return out.join('');
}
