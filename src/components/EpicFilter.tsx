import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { PackageIcon, XIcon } from './Icons';
import { InstantTip } from './InstantTip';

export type EpicRef = { epicKey?: string | null; epicDisplay?: string | null };

export type EpicOption = { key: string; display: string };

export function epicOptions(items: EpicRef[]): EpicOption[] {
  const byKey = new Map<string, string>();
  for (const item of items) {
    const key = item.epicKey?.trim();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item.epicDisplay?.trim() || '');
  }
  return [...byKey.entries()]
    .map(([key, display]) => ({ key, display }))
    .sort((a, b) => a.key.localeCompare(b.key, 'ru'));
}

export function EpicMark(props: EpicRef) {
  const key = props.epicKey?.trim() || '';
  const display = props.epicDisplay?.trim() || '';
  const linked = Boolean(key);
  return (
    <span className="inline-flex shrink-0" onClick={(event) => event.stopPropagation()}>
      <InstantTip text={linked ? `${key}: ${display}` : ''} className={linked ? 'text-sky-700' : 'text-slate-400'}>
        <PackageIcon className="h-3.5 w-3.5" />
      </InstantTip>
    </span>
  );
}

export function EpicFilter(props: {
  options: EpicOption[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const current = props.options.find((item) => item.key === props.selected) || null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function toggle(event: ReactMouseEvent) {
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = 288;
    const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8);
    setPlace({ left, top: box.bottom + 4 });
    setOpen(true);
  }

  if (current) {
    return (
      <span className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded border border-sky-300 bg-sky-100 px-1.5 text-xs text-sky-900">
        <PackageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0">{current.key}:</span>
        <span className="min-w-0 truncate">{current.display}</span>
        <button
          type="button"
          aria-label="Сбросить эпик"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-sky-800 hover:bg-sky-200"
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(null);
          }}
        >
          <XIcon className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <InstantTip text="Эпики">
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-white"
          onClick={toggle}
        >
          <PackageIcon className="h-3.5 w-3.5" />
        </button>
      </InstantTip>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[10040] max-h-64 w-72 overflow-y-auto rounded border border-slate-300 bg-white py-1 shadow-lg"
            style={{ left: place.left, top: place.top }}
          >
            {props.options.length === 0 && (
              <div className="px-2 py-1 text-xs text-slate-400">В списке нет эпиков</div>
            )}
            {props.options.map((epic) => (
              <button
                key={epic.key}
                type="button"
                className="flex w-full min-w-0 items-baseline gap-1 px-2 py-1 text-left text-xs hover:bg-slate-50"
                onClick={() => {
                  props.onSelect(epic.key);
                  setOpen(false);
                }}
              >
                <span className="shrink-0 font-medium">{epic.key}:</span>
                <span className="min-w-0 truncate">{epic.display}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
