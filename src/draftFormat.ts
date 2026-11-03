export type TextEdit = { value: string; start: number; end: number };

const MARKS: Record<string, [string, string]> = {
  b: ['**', '**'],
  i: ['*', '*'],
  u: ['<u>', '</u>'],
  s: ['~~', '~~'],
  e: ['`', '`'],
};

export function applyMarkdownHotkey(
  value: string,
  start: number,
  end: number,
  key: string,
  shift: boolean,
): TextEdit | null {
  const mark = MARKS[key];
  if (mark) return toggleWrap(value, start, end, mark[0], mark[1]);
  if (key === 'Tab') return indentLines(value, start, end, shift);
  return null;
}

const MARK_CODES: Record<string, string> = {
  KeyB: 'b',
  KeyI: 'i',
  KeyU: 'u',
  KeyS: 's',
  KeyE: 'e',
};

/** Physical key, so Ctrl+B works on a Russian layout too. */
export function hotkeyId(event: { key: string; code: string; ctrlKey: boolean; metaKey: boolean }): string | null {
  if (event.key === 'Tab' || event.code === 'Tab') return 'Tab';
  if (!(event.ctrlKey || event.metaKey)) return null;
  return MARK_CODES[event.code] || null;
}

export function handleRichHotkey(event: KeyboardEvent): boolean {
  const key = hotkeyId(event);
  const mod = event.ctrlKey || event.metaKey;
  if (mod && key && key in MARKS && key !== 'e') {
    event.preventDefault();
    const command =
      key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : 'strikeThrough';
    document.execCommand(command);
    return true;
  }
  if (mod && key === 'e') {
    event.preventDefault();
    wrapSelection('code');
    return true;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    document.execCommand(event.shiftKey ? 'outdent' : 'indent');
    return true;
  }
  return false;
}

export function htmlToMarkdown(root: HTMLElement): string {
  return renderBlocks(root, 0)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toggleWrap(value: string, start: number, end: number, open: string, close: string): TextEdit {
  const selected = value.slice(start, end);
  const before = value.slice(Math.max(0, start - open.length), start);
  const after = value.slice(end, end + close.length);
  if (before === open && after === close) {
    return {
      value: value.slice(0, start - open.length) + selected + value.slice(end + close.length),
      start: start - open.length,
      end: end - open.length,
    };
  }
  if (
    selected.startsWith(open) &&
    selected.endsWith(close) &&
    selected.length >= open.length + close.length
  ) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    };
  }
  const wrapped = `${open}${selected}${close}`;
  const caret = start + open.length;
  return {
    value: value.slice(0, start) + wrapped + value.slice(end),
    start: selected ? start : caret,
    end: selected ? start + wrapped.length : caret,
  };
}

function indentLines(value: string, start: number, end: number, outdent: boolean): TextEdit {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const next = block
    .split('\n')
    .map((line) => (outdent ? line.replace(/^(?: {1,2}|\t)/, '') : `  ${line}`))
    .join('\n');
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length,
  };
}

function wrapSelection(tag: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const element = document.createElement(tag);
  element.appendChild(range.extractContents());
  if (!element.textContent) element.textContent = tag === 'code' ? 'код' : '';
  range.insertNode(element);
  selection.removeAllRanges();
  const after = document.createRange();
  after.setStartAfter(element);
  after.collapse(true);
  selection.addRange(after);
}

function renderBlocks(node: Node, indent: number): string {
  let out = '';
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent || '';
      return;
    }
    if (!(child instanceof HTMLElement)) return;
    const tag = child.tagName;
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      out += renderListBlock(child, indent, tag === 'OL');
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = renderBlocks(child, indent).trim();
      out += `${inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n`;
      return;
    }
    if (tag === 'PRE') {
      const code = child.textContent || '';
      out += `\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\`\n`;
      return;
    }
    if (/^H[1-3]$/.test(tag)) {
      out += `${'#'.repeat(Number(tag[1]))} ${inlineMarkdown(child).trim()}\n\n`;
      return;
    }
    if (tag === 'DIV' || tag === 'P') {
      const inner = renderBlocks(child, indent).replace(/\n+$/, '');
      if (out && !out.endsWith('\n')) out += '\n';
      out += `${inner}\n`;
      return;
    }
    out += inlineMarkdown(child);
  });
  return out;
}

function renderListBlock(list: HTMLElement, indent: number, ordered: boolean): string {
  let out = '';
  let index = 1;
  for (const child of list.children) {
    if (child.tagName !== 'LI') continue;
    const pad = '  '.repeat(indent);
    const marker = ordered ? `${index}. ` : '- ';
    index += 1;
    let text = '';
    let nested = '';
    child.childNodes.forEach((node) => {
      if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
        nested += renderListBlock(node, indent + 1, node.tagName === 'OL');
        return;
      }
      text += node instanceof HTMLElement ? inlineMarkdown(node) : node.textContent || '';
    });
    out += `${pad}${marker}${text.trim()}\n${nested}`;
  }
  return out;
}

function inlineMarkdown(node: HTMLElement): string {
  const tag = node.tagName;
  if (tag === 'BR') return '\n';
  if (tag === 'UL' || tag === 'OL') return renderListBlock(node, 0, tag === 'OL');
  const inner = [...node.childNodes]
    .map((child) => (child instanceof HTMLElement ? inlineMarkdown(child) : child.textContent || ''))
    .join('');
  if (tag === 'STRONG' || tag === 'B') return `**${inner}**`;
  if (tag === 'EM' || tag === 'I') return `*${inner}*`;
  if (tag === 'U') return `<u>${inner}</u>`;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return `~~${inner}~~`;
  if (tag === 'CODE') return `\`${inner}\``;
  if (tag === 'A') {
    const href = node.getAttribute('href') || '';
    return href ? `[${inner}](${href})` : inner;
  }
  return inner;
}
