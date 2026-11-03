function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  const kept: string[] = [];
  const marked = text.replace(/<u>([^<]*)<\/u>/gi, (_all, inner: string) => {
    kept.push(`<u>${escapeHtml(inner)}</u>`);
    return `\u0000${kept.length - 1}\u0000`;
  });
  let html = escapeHtml(marked);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
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

/** Small safe markdown subset: headings, lists, quotes, code fences, links, emphasis. */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
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
    if (!line.trim()) {
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
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(inline(lines[i]));
      i += 1;
    }
    out.push(`<p>${buf.join('<br/>')}</p>`);
  }
  return out.join('');
}
