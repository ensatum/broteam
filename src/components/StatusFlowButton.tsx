import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardMatrix } from '@shared/types';
import { InstantTip } from './InstantTip';

const EDGE = 8;

type Choice = { id: string; key: string; display: string };

function statusChoices(
  transitions: Array<{ id: string; display: string; toKey?: string; toDisplay?: string }>,
  currentKey: string,
): Choice[] {
  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const transition of transitions) {
    const key = (transition.toKey || '').trim();
    if (!key || key === currentKey || seen.has(key)) continue;
    seen.add(key);
    choices.push({
      id: transition.id,
      key,
      display: (transition.toDisplay || transition.display || key).trim(),
    });
  }
  return choices;
}

export function StatusFlowButton(props: {
  issueKey: string;
  statusKey: string;
  color: string;
  name: string;
  disabled?: boolean;
  colorFor: (statusKey: string) => string;
  onApplied: (matrix: BoardMatrix, status: { key: string; display: string }) => void;
  onError?: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const width = pop.offsetWidth;
      const height = pop.offsetHeight;
      let left = anchor.right + 6;
      let top = anchor.top + anchor.height / 2 - height / 2;
      if (left + width > window.innerWidth - EDGE) left = anchor.left - 6 - width;
      if (left < EDGE) left = EDGE;
      if (top < EDGE) top = EDGE;
      if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, window.innerHeight - EDGE - height);
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, loading, choices]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (busy) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popRef.current?.contains(target)) return;
      generation.current += 1;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      generation.current += 1;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, busy]);

  const dot = <span className="h-2 w-2 rounded-full" style={{ backgroundColor: props.color }} />;

  if (props.disabled) {
    return (
      <InstantTip text={props.name} className="inline-flex shrink-0">
        <span className="inline-flex items-center justify-center p-1 -m-1">{dot}</span>
      </InstantTip>
    );
  }

  const toggle = () => {
    if (busy) return;
    if (open) {
      generation.current += 1;
      setOpen(false);
      return;
    }
    const gen = generation.current + 1;
    generation.current = gen;
    setChoices([]);
    setLoading(true);
    setOpen(true);
    void window.api
      .getTransitions(props.issueKey)
      .then((transitions) => {
        if (generation.current !== gen) return;
        setChoices(statusChoices(transitions, props.statusKey));
      })
      .catch((error: unknown) => {
        if (generation.current !== gen) return;
        props.onError?.(error instanceof Error ? error.message : String(error));
        setOpen(false);
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false);
      });
  };

  const apply = (choice: Choice) => {
    if (busy) return;
    setBusy(true);
    props.onError?.(null);
    void window.api
      .executeTransition(props.issueKey, choice.id)
      .then((matrix) => {
        props.onApplied(matrix, { key: choice.key, display: choice.display });
        generation.current += 1;
        setOpen(false);
      })
      .catch((error: unknown) => {
        props.onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <InstantTip text={props.name} className="inline-flex shrink-0">
        <button
          ref={anchorRef}
          type="button"
          className="inline-flex cursor-pointer items-center justify-center bg-transparent p-1 -m-1"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          {dot}
        </button>
      </InstantTip>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[10080] max-h-[calc(100vh-16px)] min-w-28 overflow-y-auto rounded-md border border-slate-200 bg-white py-0.5 text-[11px] shadow-lg"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {loading && <div className="px-2 py-1 text-slate-500">Загрузка…</div>}
            {!loading && choices.length === 0 && <div className="px-2 py-1 text-slate-500">Нет переходов</div>}
            {!loading &&
              choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => apply(choice)}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: props.colorFor(choice.key) }}
                  />
                  <span className="whitespace-nowrap">{choice.display}</span>
                </button>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
