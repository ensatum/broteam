import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { applyMarkdownHotkey, handleRichHotkey, hotkeyId, htmlToMarkdown } from '../draftFormat';
import { renderMarkdown } from '../markdown';
import { EyeIcon, HashIcon } from './Icons';

export type MarkdownHandle = { read: () => string };

export const MarkdownSurface = forwardRef<
  MarkdownHandle,
  {
    draft: string;
    onDraft: (value: string) => void;
    placeholder?: string;
    resetKey?: string | number | boolean;
    minRows?: number;
    leading?: ReactNode;
  }
>(function MarkdownSurface(props, ref) {
  const [view, setView] = useState<'preview' | 'markdown'>(props.draft.trim() ? 'preview' : 'markdown');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const skip = useRef(false);
  const pending = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    setView(props.draft.trim() ? 'preview' : 'markdown');
  }, [props.resetKey]);

  useLayoutEffect(() => {
    const sel = pending.current;
    const area = areaRef.current;
    if (!sel || !area) return;
    area.selectionStart = sel.start;
    area.selectionEnd = sel.end;
    pending.current = null;
  });

  useLayoutEffect(() => {
    const node = previewRef.current;
    if (view !== 'preview' || !node) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    node.innerHTML = renderMarkdown(props.draft);
  }, [view, props.draft]);

  function source(): string {
    if (view === 'preview' && previewRef.current) return htmlToMarkdown(previewRef.current);
    return props.draft;
  }

  useImperativeHandle(ref, () => ({
    read: () => source().replace(/\s+$/, ''),
  }));

  function onMarkdownKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    const key = hotkeyId(event);
    if (!key) return;
    if (key !== 'Tab' && !['b', 'i', 'u', 's', 'e'].includes(key)) return;
    const next = applyMarkdownHotkey(props.draft, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    props.onDraft(next.value);
    pending.current = { start: next.start, end: next.end };
  }

  return (
    <div className="flex min-h-0 items-stretch gap-1.5">
      <div className="flex shrink-0 flex-col items-center gap-1">
        {props.leading}
        <NoteModeSwitch
          value={view}
          onChange={(next) => {
            if (view === 'preview' && next === 'markdown' && previewRef.current) {
              props.onDraft(htmlToMarkdown(previewRef.current));
            }
            setView(next);
          }}
        />
      </div>
      <div className="flex min-h-full min-w-0 flex-1">
        {view === 'markdown' ? (
          <textarea
            ref={areaRef}
            rows={Math.max(props.minRows ?? 1, props.draft.split('\n').length)}
            className="m-0 block min-h-full w-full resize-none rounded border border-slate-300 bg-white p-1 text-xs leading-snug outline-none"
            value={props.draft}
            placeholder={props.placeholder}
            onChange={(event) => props.onDraft(event.target.value)}
            onKeyDown={onMarkdownKey}
          />
        ) : (
          <div
            ref={previewRef}
            className="summary-note markdown-body m-0 min-h-full w-full rounded border border-slate-300 bg-white p-1 text-xs leading-snug outline-none"
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              if (!previewRef.current) return;
              skip.current = true;
              props.onDraft(htmlToMarkdown(previewRef.current));
            }}
            onKeyDown={(event) => {
              if (!handleRichHotkey(event.nativeEvent)) return;
              if (!previewRef.current) return;
              skip.current = true;
              props.onDraft(htmlToMarkdown(previewRef.current));
            }}
          />
        )}
      </div>
    </div>
  );
});

function NoteModeSwitch(props: {
  value: 'preview' | 'markdown';
  onChange: (value: 'preview' | 'markdown') => void;
}) {
  const item = (active: boolean) =>
    `inline-flex items-center justify-center ${active ? 'bg-slate-300 text-slate-700' : 'text-slate-500 hover:bg-slate-50'}`;
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-slate-300">
      <button type="button" title="Просмотр" className={`${item(props.value === 'preview')} h-6 w-6`} onClick={() => props.onChange('preview')}>
        <EyeIcon className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Markdown" className={`${item(props.value === 'markdown')} h-6 w-6`} onClick={() => props.onChange('markdown')}>
        <HashIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
