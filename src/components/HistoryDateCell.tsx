import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftIcon, ArrowRightIcon, CrosshairIcon } from './Icons';

export type HistorySnapshotRef = { id: number; date: string };

export type HistoryDateControl = {
  dateLabel: string;
  live: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoLive: () => void;
  snapshots: HistorySnapshotRef[];
  onOpenSnapshot: (id: number) => void;
  onSave: () => void;
  saveBusy: boolean;
  canSave: boolean;
  /** Live mode, and nothing snapshot-relevant changed since the last save. */
  saveClean?: boolean;
};

export default function HistoryDateCell(props: HistoryDateControl) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(props.dateLabel));
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const byDate = useMemo(
    () => new Map(props.snapshots.map((item) => [item.date, item])),
    [props.snapshots],
  );
  const calendarDays = useMemo(() => buildCalendar(month.year, month.month), [month]);
  const monthTitle = useMemo(() => {
    const name = new Date(month.year, month.month, 1).toLocaleDateString('ru-RU', {
      month: 'long',
    });
    return `${name} ${month.year}`;
  }, [month]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = dateRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 4, left: rect.left });
  }, [open, props.dateLabel]);

  function toggleCalendar() {
    setMonth(monthOf(props.dateLabel));
    setOpen((value) => !value);
  }

  function shiftMonth(delta: number) {
    setMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  const prevTitle = props.live
    ? props.hasPrev
      ? 'Ближайшее сохранение'
      : 'Нет сохранений'
    : props.hasPrev
      ? 'Предыдущий снапшот'
      : 'Нет более раннего снапшота';
  const hasNewerSnapshot = props.snapshots.some((item) => item.date > props.dateLabel);
  const nextTitle = !props.hasNext
    ? 'Нет более позднего снапшота'
    : hasNewerSnapshot
      ? 'Следующий снапшот'
      : 'К живому состоянию';

  return (
    <div ref={rootRef} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center">
      <div className="flex items-center">
        <NavButton disabled={!props.hasPrev} title={prevTitle} onClick={props.onPrev}>
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </NavButton>
      </div>
      <button
        ref={dateRef}
        type="button"
        title="Календарь сохранений"
        className="justify-self-center cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-[11px] font-medium tabular-nums leading-none text-slate-800 hover:text-slate-950"
        onClick={toggleCalendar}
      >
        {props.dateLabel}
      </button>
      <div className="flex items-center">
        <NavButton disabled={!props.hasNext} title={nextTitle} onClick={props.onNext}>
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </NavButton>
        <button
          type="button"
          title={props.live ? 'Живой режим' : 'К живому состоянию'}
          disabled={props.live}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 ${
            props.live
              ? 'cursor-default text-slate-300'
              : 'cursor-pointer text-slate-700 hover:bg-slate-200'
          }`}
          onClick={() => {
            if (!props.live) props.onGoLive();
          }}
        >
          <CrosshairIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && anchor && (
        <CalendarPopover
          panelRef={panelRef}
          anchor={anchor}
          monthTitle={monthTitle}
          days={calendarDays}
          year={month.year}
          month={month.month}
          byDate={byDate}
          selectedDate={props.dateLabel}
          onShift={shiftMonth}
          onOpen={(id) => {
            setOpen(false);
            props.onOpenSnapshot(id);
          }}
        />
      )}
    </div>
  );
}

function NavButton(props: {
  disabled: boolean;
  title: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      title={props.title}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border-0 bg-transparent p-0 ${
        props.disabled
          ? 'cursor-default text-slate-300'
          : 'cursor-pointer text-slate-700 hover:bg-slate-200'
      } ${props.className ?? ''}`}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

function CalendarPopover(props: {
  panelRef: RefObject<HTMLDivElement | null>;
  anchor: { top: number; left: number };
  monthTitle: string;
  days: Array<number | null>;
  year: number;
  month: number;
  byDate: Map<string, HistorySnapshotRef>;
  selectedDate: string;
  onShift: (delta: number) => void;
  onOpen: (id: number) => void;
}) {
  const [pos, setPos] = useState(props.anchor);

  useLayoutEffect(() => {
    const el = props.panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = props.anchor.left;
    let top = props.anchor.top;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, props.anchor.top - rect.height - 8);
    }
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [props.anchor, props.panelRef, props.monthTitle]);

  return createPortal(
    <div
      ref={props.panelRef}
      data-floating-menu
      className="fixed z-[9999] w-56 rounded-lg border border-slate-300 bg-white p-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="relative mb-2 flex items-center justify-center px-7">
        <button
          type="button"
          className="absolute left-0 inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
          title="Предыдущий месяц"
          onClick={() => props.onShift(-1)}
        >
          <ArrowLeftIcon className="h-3 w-3" />
        </button>
        <div className="text-xs font-semibold capitalize text-slate-800">{props.monthTitle}</div>
        <button
          type="button"
          className="absolute right-0 inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
          title="Следующий месяц"
          onClick={() => props.onShift(1)}
        >
          <ArrowRightIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-500">
        {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {props.days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-7" />;
          const iso = toIso(props.year, props.month, day);
          const snap = props.byDate.get(iso);
          const selected = iso === props.selectedDate;
          return (
            <button
              key={iso}
              type="button"
              disabled={!snap}
              title={snap ? `История ${iso}` : undefined}
              onClick={() => snap && props.onOpen(snap.id)}
              className={`h-7 rounded text-xs ${
                snap
                  ? 'cursor-pointer border border-indigo-300 bg-indigo-50 font-semibold text-indigo-900 hover:bg-indigo-100'
                  : 'cursor-default border border-transparent text-slate-400'
              } ${selected ? 'ring-2 ring-slate-800' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function monthOf(iso: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

function buildCalendar(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1);
  let weekday = first.getDay();
  weekday = weekday === 0 ? 6 : weekday - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array(weekday).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toIso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
