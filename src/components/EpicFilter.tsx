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

export function EpicMark(props: EpicRef & { onPick?: (key: string) => void }) {
  const key = props.epicKey?.trim() || '';
  const display = props.epicDisplay?.trim() || '';
  const linked = Boolean(key);
  const icon = <PackageIcon className="h-3.5 w-3.5" />;
  if (!linked) {
    return (
      <span className="inline-flex shrink-0 text-slate-400" onClick={(event) => event.stopPropagation()}>
        {icon}
      </span>
    );
  }
  return (
    <InstantTip text={`${key}: ${display}`} className="inline-flex shrink-0 text-sky-700">
      <button
        type="button"
        className="inline-flex items-center"
        onClick={(event) => {
          event.stopPropagation();
          props.onPick?.(key);
        }}
      >
        {icon}
      </button>
    </InstantTip>
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
    if (!props.options.length) setOpen(false);
  }, [props.options.length]);

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
    if (!props.options.length) return;
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
    const label = current.display || current.key;
    const tip = current.display ? `${current.key}: ${current.display}` : current.key;
    return (
      <span className="inline-flex h-6 min-w-0 max-w-[10rem] items-center gap-1 self-center rounded border border-sky-300 bg-sky-100 py-0 pl-1.5 pr-0.5 text-xs text-sky-900">
        <PackageIcon className="h-3.5 w-3.5 shrink-0" />
        <InstantTip text={tip} className="min-w-0 truncate">
          {label}
        </InstantTip>
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
    <div ref={rootRef} className="flex h-6 items-center">
      <InstantTip text={props.options.length ? 'Эпики' : 'В списке нет эпиков'} className="inline-flex h-6 items-center">
        <button
          type="button"
          disabled={!props.options.length}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:cursor-default disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-slate-100"
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
