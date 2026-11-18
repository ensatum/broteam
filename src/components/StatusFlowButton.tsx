import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardMatrix } from '@shared/types';
import { buildCalendar, monthOf, toIso } from '../monthGrid';
import { InstantTip } from './InstantTip';

const EDGE = 8;

type Choice = { id: string; key: string; display: string; screenId?: string };
type AskedField = { id: string; name: string; type: string };
type Gate =
  | {
      kind: 'dates';
      choice: Choice;
      fields: AskedField[];
      values: Record<string, string>;
      openId: string | null;
      cursor: { year: number; month: number };
    }
  | { kind: 'blocked'; choice: Choice; names: string[] };

function statusChoices(
  transitions: Array<{ id: string; display: string; toKey?: string; toDisplay?: string; screenId?: string }>,
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
      screenId: transition.screenId,
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
  const [checking, setChecking] = useState(false);
  const [gate, setGate] = useState<Gate | null>(null);
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
  }, [open, loading, choices, checking, gate]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (busy) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popRef.current?.contains(target)) return;
      generation.current += 1;
      setGate(null);
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      generation.current += 1;
      setGate(null);
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
      setGate(null);
      setOpen(false);
      return;
    }
    const gen = generation.current + 1;
    generation.current = gen;
    setChoices([]);
    setGate(null);
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

  const run = (choice: Choice, values?: Record<string, string>) => {
    if (busy) return;
    setBusy(true);
    props.onError?.(null);
    void window.api
      .executeTransition(props.issueKey, choice.id, values)
      .then((matrix) => {
        props.onApplied(matrix, { key: choice.key, display: choice.display });
        generation.current += 1;
        setGate(null);
        setOpen(false);
      })
      .catch((error: unknown) => {
        props.onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(false));
  };

  const pick = (choice: Choice) => {
    if (busy || checking) return;
    if (!choice.screenId) {
      run(choice);
      return;
    }
    const gen = generation.current;
    setChecking(true);
    setGate(null);
    void window.api
      .transitionFields(choice.screenId)
      .then((fields) => {
        if (generation.current !== gen) return;
        const dates = fields.filter((field) => field.type === 'date');
        const others = fields.filter((field) => field.type !== 'date');
        if (others.length) {
          setGate({ kind: 'blocked', choice, names: others.map((field) => field.name) });
          return;
        }
        if (!dates.length) {
          run(choice);
          return;
        }
        const today = todayIso();
        setGate({
          kind: 'dates',
          choice,
          fields: dates,
          values: Object.fromEntries(dates.map((field) => [field.id, today])),
          openId: null,
          cursor: monthOf(today),
        });
      })
      .catch((error: unknown) => {
        if (generation.current !== gen) return;
        props.onError?.(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (generation.current === gen) setChecking(false);
      });
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
            className={`fixed z-[10080] max-h-[calc(100vh-16px)] overflow-y-auto rounded-md border border-slate-200 bg-white py-0.5 text-[11px] shadow-lg ${
              gate?.kind === 'dates' ? 'w-56' : 'min-w-28'
            }`}
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {(loading || checking) && <div className="px-2 py-1 text-slate-500">Загрузка…</div>}
            {!loading && !checking && gate?.kind === 'blocked' && (
              <div className="px-2 py-1">
                <div className="text-slate-800">{gate.choice.display}</div>
                <div className="mt-0.5 text-slate-500">Нужно указать: {gate.names.join(', ')}.</div>
                <button
                  type="button"
                  className="mt-1 text-slate-500 hover:text-slate-800"
                  onClick={() => setGate(null)}
                >
                  Отмена
                </button>
              </div>
            )}
            {!loading && !checking && gate?.kind === 'dates' && (
              <form
                className="px-2 py-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (gate.fields.some((field) => !gate.values[field.id])) return;
                  run(gate.choice, gate.values);
                }}
              >
                <div className="mb-1 text-slate-800">{gate.choice.display}</div>
                {gate.fields.map((field) => {
                  const value = gate.values[field.id] || '';
                  const open = gate.openId === field.id;
                  return (
                    <div key={field.id} className="mb-1">
                      <div className="text-slate-500">{field.name}</div>
                      <button
                        type="button"
                        className="mt-0.5 w-full rounded border border-slate-200 px-1.5 py-0.5 text-left text-slate-800 hover:bg-slate-50"
                        onClick={() =>
                          setGate({
                            ...gate,
                            openId: open ? null : field.id,
                            cursor: monthOf(value),
                          })
                        }
                      >
                        {value ? ruDate(value) : 'ДД.ММ.ГГГГ'}
                      </button>
                      {open && (
                        <MonthGrid
                          year={gate.cursor.year}
                          month={gate.cursor.month}
                          selected={value}
                          onShift={(delta) => {
                            const next = new Date(gate.cursor.year, gate.cursor.month + delta, 1);
                            setGate({
                              ...gate,
                              cursor: { year: next.getFullYear(), month: next.getMonth() },
                            });
                          }}
                          onPick={(iso) =>
                            setGate({
                              ...gate,
                              openId: null,
                              values: { ...gate.values, [field.id]: iso },
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    className="text-slate-500 hover:text-slate-800"
                    onClick={() => setGate(null)}
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={busy || gate.fields.some((field) => !gate.values[field.id])}
                    className="font-medium text-slate-800 hover:text-slate-950 disabled:opacity-50"
                  >
                    Продолжить
                  </button>
                </div>
              </form>
            )}
            {!loading && !checking && !gate && choices.length === 0 && (
              <div className="px-2 py-1 text-slate-500">Нет переходов</div>
            )}
            {!loading && !checking && !gate &&
              choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  onClick={() => pick(choice)}
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

function MonthGrid(props: {
  year: number;
  month: number;
  selected: string;
  onShift: (delta: number) => void;
  onPick: (iso: string) => void;
}) {
  const title = new Date(props.year, props.month, 1).toLocaleDateString('ru-RU', { month: 'long' });
  const days = buildCalendar(props.year, props.month);
  return (
    <div className="mt-1">
      <div className="relative mb-1 flex items-center justify-center px-5">
        <button
          type="button"
          className="absolute left-0 text-slate-500 hover:text-slate-800"
          onClick={() => props.onShift(-1)}
        >
          ‹
        </button>
        <div className="capitalize text-slate-700">
          {title} {props.year}
        </div>
        <button
          type="button"
          className="absolute right-0 text-slate-500 hover:text-slate-800"
          onClick={() => props.onShift(1)}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-400">
        {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-7 gap-0.5">
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-5" />;
          const iso = toIso(props.year, props.month, day);
          const selected = iso === props.selected;
          return (
            <button
              key={iso}
              type="button"
              className={`h-5 rounded ${
                selected ? 'bg-slate-800 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
              onClick={() => props.onPick(iso)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

function ruDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
