import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { BoardColumnConfig, Developer, SavedBoard } from '@shared/types';
import { applyMarkdownHotkey, handleRichHotkey, hotkeyId, htmlToMarkdown } from '../draftFormat';
import { renderMarkdown } from '../markdown';
import {
  shiftIsoDate,
  shiftIsoMonths,
  isoDate,
  previousWorkdayIso,
  type SummaryBuildRequest,
  type SummaryPeriod,
  type SummaryReport,
  type SummaryRow,
  type SummarySlice,
} from '@shared/summary';
import { resolvePersonDisplayName } from '@shared/personDisplay';
import { summarySearchParts, textHit } from '@shared/issueSearch';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckSquareIcon,
  EditIcon,
  EyeIcon,
  HashIcon,
  NoteClipboardButton,
  UsersIcon,
  XIcon,
} from './Icons';
import { CopyIssueButton } from './IssuePanel';
import { RunSpinner } from './ApiRunControls';
import { InstantTip } from './InstantTip';
import { SortMenu, type ListSortDir } from './ListSort';

type SummarySortKey = 'taken' | 'done' | 'created' | 'activity' | 'number' | 'assignee' | 'summary';
type SummarySort = { key: SummarySortKey; dir: 'asc' | 'desc' };

const SORTS: Array<{ key: SummarySortKey; label: string }> = [
  { key: 'taken', label: 'Взята' },
  { key: 'done', label: 'Завершена' },
  { key: 'created', label: 'Создана' },
  { key: 'activity', label: 'Активность' },
  { key: 'number', label: 'Номер' },
  { key: 'assignee', label: 'Исполнитель' },
  { key: 'summary', label: 'Название' },
];

const RANGE_PRESETS: Array<{
  id: string;
  label: string;
  range: () => { from: string; to: string; fromTime: string; toTime: string };
}> = [
  {
    id: 'last',
    label: 'Повседневная',
    range: () => ({ from: previousWorkdayIso(), to: isoDate(new Date()), fromTime: '12:00', toTime: '12:00' }),
  },
  { id: '3d', label: '3 дня', range: () => ({ ...spanDays(3), fromTime: '00:00', toTime: '23:59' }) },
  { id: '7d', label: '7 дней', range: () => ({ ...spanDays(7), fromTime: '00:00', toTime: '23:59' }) },
  { id: '1m', label: '1 месяц', range: () => ({ ...spanMonths(1), fromTime: '00:00', toTime: '23:59' }) },
  { id: '2m', label: '2 месяца', range: () => ({ ...spanMonths(2), fromTime: '00:00', toTime: '23:59' }) },
  { id: '3m', label: '3 месяца', range: () => ({ ...spanMonths(3), fromTime: '00:00', toTime: '23:59' }) },
];

export default function SummaryDock(props: {
  boardLocalId: number | null;
  trackerBoardId: number | null;
  queueKey: string;
  boards: SavedBoard[];
  participants: Developer[];
  columns: BoardColumnConfig[];
  personId: number | null;
  period: SummaryPeriod;
  onPersonId: (id: number | null) => void;
  onPeriod: (period: SummaryPeriod) => void;
  onIssueHover: (issueKey: string | null, boardLocalId: number | null) => void;
  onCached?: () => void;
}) {
  const people = props.participants.filter(
    (person) => !person.hidden && (person.role === 'developer' || person.role === 'qa'),
  );
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [running, setRunning] = useState(false);
  const [requests, setRequests] = useState(0);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(0);
  const [formedAt, setFormedAt] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ from: string; to: string; complete: boolean } | null>(null);
  const viewGen = useRef(0);
  const runningRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [reportNote, setReportNote] = useState('');
  const [issueNotes, setIssueNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [personOpen, setPersonOpen] = useState(false);
  const [sort, setSort] = useState<SummarySort>(loadSummarySort);
  const personRef = useRef<HTMLDivElement>(null);
  const selected = people.find((person) => person.id === props.personId) || null;

  useEffect(() => {
    if (props.boardLocalId == null || props.personId == null) {
      setReportNote('');
      setIssueNotes({});
      return;
    }
    let cancel = false;
    void window.api.getSummaryNotes(props.boardLocalId, props.personId).then((notes) => {
      if (cancel) return;
      setReportNote(notes.report);
      setIssueNotes(notes.issues);
    });
    return () => {
      cancel = true;
    };
  }, [props.boardLocalId, props.personId]);

  useEffect(() => {
    if (!running) return;
    return window.api.onSummaryProgress((progress) => {
      if (progress.row) {
        const row = progress.row;
        setRows((prev) => (prev.some((item) => item.key === row.key) ? prev : [...prev, row]));
      }
      setIndex(progress.index);
      setTotal(progress.total);
      setRequests(progress.requests);
    });
  }, [running]);

  useEffect(() => {
    if (!running) return;
    return window.api.onTrackerActivity((state) => setRequests(state.total));
  }, [running]);

  useEffect(() => {
    if (!personOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (personRef.current?.contains(event.target as Node)) return;
      setPersonOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [personOpen]);

  const namedRows = useMemo(() => rows.map((row) => remapSummaryRow(row, props.participants)), [rows, props.participants]);
  const visibleRows = useMemo(() => {
    const person = people.find((item) => item.id === props.personId) || null;
    let filtered =
      person == null
        ? namedRows
        : namedRows
            .filter((row) => (row.touchedIds || []).includes(person.id))
            .map((row) => focusSummaryRow(row, person));
    const needle = query.trim();
    if (needle) {
      filtered = filtered.filter((row) => textHit(needle, summarySearchParts(row, people, props.boards)));
    }
    return sortRows(filtered, sort);
  }, [namedRows, people, props.personId, props.boards, query, sort]);
  runningRef.current = running;

  function summaryRequest(period: SummaryPeriod = props.period): SummaryBuildRequest | null {
    if (props.boardLocalId == null) return null;
    return {
      boardLocalId: props.boardLocalId,
      trackerBoardId: props.trackerBoardId,
      queueKey: props.queueKey,
      participant: null,
      period,
      boards: props.boards
        .filter((board) => board.enabled)
        .map((board) => ({
          boardLocalId: board.id,
          trackerBoardId: board.trackerBoardId,
          queueKey: board.queueKey,
          name: board.name,
          alias: board.alias || '',
          color: board.color || '',
        })),
      columns: props.columns
        .filter((column) => column.enabled)
        .map((column) => ({
          statusKey: column.statusKey,
          alias: column.alias,
          statusDisplay: column.statusDisplay,
          columnName: column.columnName,
        })),
    };
  }

  function applySlice(slice: SummarySlice) {
    setRows(slice.report.rows);
    setFormedAt(slice.report.formedAt);
    setRequests(slice.report.requests);
    setCoverage({ from: slice.coverageFrom, to: slice.coverageTo, complete: slice.complete });
  }

  useEffect(() => {
    const request = summaryRequest();
    if (!request || runningRef.current) return;
    const gen = ++viewGen.current;
    void window.api.openSummary(request).then((slice) => {
      if (gen !== viewGen.current || runningRef.current) return;
      if (!slice) {
        setRows([]);
        setCoverage(null);
        setFormedAt(null);
        return;
      }
      applySlice(slice);
    });
    // The request is rebuilt from the period, person and board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.boardLocalId, props.period, props.trackerBoardId, props.queueKey, props.boards, props.columns]);

  async function build(period: SummaryPeriod = props.period) {
    const request = summaryRequest(period);
    if (!request) return;
    runningRef.current = true;
    viewGen.current += 1;
    setRunning(true);
    setError(null);
    setRows([]);
    setExpanded(new Set());
    setIndex(0);
    setTotal(0);
    setRequests(0);
    setFormedAt(new Date().toISOString());
    try {
      const report = await window.api.buildSummary(request);
      setRows(report.rows);
      setFormedAt(report.formedAt);
      setRequests(report.requests);
      const bounds = periodBounds(period);
      setCoverage({ from: bounds.from, to: bounds.to, complete: true });
      props.onCached?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Запросы остановлены')) {
        const bounds = periodBounds(period);
        setCoverage({ from: bounds.from, to: bounds.to, complete: false });
        props.onCached?.();
      } else {
        setError(message);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function reportPayload(): SummaryReport & { reportNote?: string; issueNotes?: Record<string, string> } {
    const person = people.find((item) => item.id === props.personId);
    return {
      formedAt: formedAt || new Date().toISOString(),
      period: props.period,
      participantName: person?.displayName || person?.login || '',
      requests,
      rows: visibleRows,
      reportNote,
      issueNotes,
    };
  }

  const personName = (selected?.displayName || selected?.login || '').trim();

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-slate-200 px-2 text-sm font-semibold text-slate-900">
        Сводка
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по ключу"
          className="h-6 w-40 min-w-0 rounded border border-slate-300 bg-white px-2 text-xs font-normal text-slate-800"
        />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <div className="inline-flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="Развернуть все"
              disabled={rows.length === 0 || rows.every((row) => expanded.has(row.key))}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => setExpanded(new Set(rows.map((row) => row.key)))}
            >
              <SummaryMaximizeIcon />
            </button>
            <button
              type="button"
              title="Свернуть все"
              disabled={rows.every((row) => !expanded.has(row.key))}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => setExpanded(new Set())}
            >
              <SummaryMinimizeIcon />
            </button>
          </div>
          <SortMenu
            sort={sort}
            options={SORTS}
            defaultDir={defaultSummaryDir}
            onChange={(next) => {
              setSort(next);
              saveSummarySort(next);
            }}
          />
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2">
        <div ref={personRef} className="relative flex min-w-0 items-center gap-1">
          <button
            type="button"
            title="Участник"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-white"
            onClick={() => setPersonOpen((value) => !value)}
          >
            <UsersIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="min-w-0 truncate text-left text-xs text-slate-800"
            onClick={() => setPersonOpen((value) => !value)}
          >
            {selected ? personName : 'Все'}
          </button>
          {selected && (
            <button
              type="button"
              title="Все участники"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white hover:text-slate-700"
              onClick={() => props.onPersonId(null)}
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
          {personOpen && (
            <div className="absolute left-0 top-7 z-20 max-h-72 w-64 overflow-y-auto rounded border border-slate-300 bg-white py-1 shadow-lg">
              <button
                type="button"
                className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-slate-50 ${
                  props.personId == null ? 'bg-slate-100 font-medium' : ''
                }`}
                onClick={() => {
                  props.onPersonId(null);
                  setPersonOpen(false);
                }}
              >
                Все
              </button>
              {(['developer', 'qa'] as const).map((role) => {
                const group = people.filter((person) => person.role === role);
                if (!group.length) return null;
                return (
                  <div key={role}>
                    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {role === 'developer' ? 'Разработчики' : 'Тестировщики'}
                    </div>
                    {group.map((person) => {
                      const count = namedRows.filter((row) => (row.touchedIds || []).includes(person.id)).length;
                      return (
                        <button
                          key={person.id}
                          type="button"
                          className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50 ${
                            person.id === props.personId ? 'bg-slate-100 font-medium' : ''
                          }`}
                          onClick={() => {
                            props.onPersonId(person.id);
                            setPersonOpen(false);
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{person.displayName || person.login}</span>
                          <span className="shrink-0 tabular-nums text-[10px] text-slate-400">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <PeriodField
          period={props.period}
          onChange={props.onPeriod}
          onFetch={(period) => void build(period)}
          disabled={running || props.boardLocalId == null}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 text-xs [&>*]:shrink-0">
        {formedAt && (
          <div className="text-[11px] text-slate-500">
            Сформирована {formatStamp(formedAt)}
            {!running && ` · запросов к API: ${requests}`}
          </div>
        )}
        {!selected && !running && formedAt && (
          <div className="text-[11px] text-slate-500">
            Журнал один на всех. Выберите участника, чтобы открыть его сводку без новых запросов.
          </div>
        )}
        {running && (
          <div className="flex justify-center py-4">
            <RunSpinner requests={requests} seen={index} total={total} />
          </div>
        )}
        {error && <div className="text-red-700">{error}</div>}
        {visibleRows.map((row) => {
          const open = expanded.has(row.key);
          const color = markerColor(row, props.columns, props.boardLocalId);
          const toggle = () =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(row.key)) next.delete(row.key);
              else next.add(row.key);
              return next;
            });
          return (
            <SummaryCard
              key={row.key}
              row={row}
              open={open}
              color={color}
              frame={summaryFrame(row, selected)}
              authored={Boolean(selected && sameName(row.author, personName))}
              personId={selected?.id ?? null}
              personName={personName}
              note={issueNotes[row.key] || ''}
              onToggle={toggle}
              onHover={props.onIssueHover}
              onNoteSave={(body) => {
                setIssueNotes((prev) => ({ ...prev, [row.key]: body }));
                if (props.boardLocalId == null || props.personId == null) return;
                void window.api.setSummaryIssueNote(props.boardLocalId, props.personId, row.key, body);
              }}
            />
          );
        })}
        <label className="mt-1 block text-[11px] text-slate-500">
          Примечание к отчёту
          <textarea
            className="mt-1 h-16 w-full resize-none rounded border border-slate-300 px-1 py-0.5 text-xs text-slate-800"
            value={reportNote}
            onChange={(event) => setReportNote(event.target.value)}
            onBlur={() => {
              if (props.boardLocalId == null || props.personId == null) return;
              void window.api.setSummaryReportNote(props.boardLocalId, props.personId, reportNote);
            }}
          />
        </label>
        <div className="flex gap-2 pb-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
            disabled={!rows.length}
            onClick={() => void window.api.exportSummary('xlsx', reportPayload())}
          >
            Excel
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
            disabled={!rows.length}
            onClick={() => void window.api.exportSummary('docx', reportPayload())}
          >
            Word
          </button>
        </div>
      </div>
    </div>
  );
}

function periodLabel(period: SummaryPeriod): string {
  const bounds = periodBounds(period);
  return `${formatDay(bounds.from)} - ${formatDay(bounds.to)}`;
}

function periodBounds(period: SummaryPeriod): { from: string; to: string } {
  if (period.kind === 'custom') return { from: period.from, to: period.to };
  const days = period.id === 'day' ? 1 : period.id === 'week' ? 7 : period.id === 'month' ? 30 : 90;
  return spanDays(days);
}

function spanDays(days: number): { from: string; to: string } {
  const today = isoDate(new Date());
  const back = days === 1 ? 1 : days - 1;
  return { from: shiftIsoDate(today, -back), to: today };
}

function spanMonths(months: number): { from: string; to: string } {
  const today = isoDate(new Date());
  return { from: shiftIsoMonths(today, -months), to: today };
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)}.${Number(month)}.${year}`;
}

function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function PeriodField(props: {
  period: SummaryPeriod;
  onChange: (period: SummaryPeriod) => void;
  onFetch: (period: SummaryPeriod) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const label = periodLabel(props.period);

  useLayoutEffect(() => {
    if (!open) return;
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 4, left: rect.left });
  }, [open, label]);

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

  return (
    <div ref={rootRef} className="flex items-center gap-1">
      <span className="shrink-0 text-[11px] font-normal text-slate-600">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        title={label}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-white"
        onClick={() => setOpen((value) => !value)}
      >
        <CalendarIcon className="h-3.5 w-3.5" />
      </button>
      {open && anchor && (
        <PeriodPopover
          panelRef={panelRef}
          anchor={anchor}
          period={props.period}
          disabled={props.disabled}
          onChange={(period, close) => {
            props.onChange(period);
            if (close) {
              setOpen(false);
              props.onFetch(period);
            }
          }}
        />
      )}
    </div>
  );
}

function PeriodPopover(props: {
  panelRef: RefObject<HTMLDivElement | null>;
  anchor: { top: number; left: number };
  period: SummaryPeriod;
  disabled?: boolean;
  onChange: (period: SummaryPeriod, close: boolean) => void;
}) {
  const initial = props.period.kind === 'custom' ? props.period.from : todayIso();
  const [month, setMonth] = useState(() => monthOf(initial));
  const [draftFrom, setDraftFrom] = useState<string | null>(props.period.kind === 'custom' ? props.period.from : null);
  const [draftTo, setDraftTo] = useState<string | null>(props.period.kind === 'custom' ? props.period.to : null);
  const [hover, setHover] = useState<string | null>(null);
  const [fromTime, setFromTime] = useState(props.period.kind === 'custom' ? props.period.fromTime || '12:00' : '12:00');
  const [toTime, setToTime] = useState(props.period.kind === 'custom' ? props.period.toTime || '12:00' : '12:00');
  const [pos, setPos] = useState(props.anchor);
  const days = useMemo(() => buildCalendar(month.year, month.month), [month]);
  const monthTitle = useMemo(() => {
    const name = new Date(month.year, month.month, 1).toLocaleDateString('ru-RU', { month: 'long' });
    return `${name} ${month.year}`;
  }, [month]);
  const today = todayIso();
  const previewTo = draftTo || (draftFrom && hover ? hover : null);
  const rangeFrom = draftFrom && previewTo && draftFrom > previewTo ? previewTo : draftFrom;
  const rangeTo = draftFrom && previewTo && draftFrom > previewTo ? draftFrom : previewTo;

  useLayoutEffect(() => {
    const el = props.panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = props.anchor.left;
    let top = props.anchor.top;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, props.anchor.top - rect.height - 8);
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [props.anchor, props.panelRef, monthTitle]);

  function shiftMonth(delta: number) {
    setMonth((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function pickDay(iso: string) {
    if (iso > today) return;
    if (!draftFrom || draftTo) {
      setDraftFrom(iso);
      setDraftTo(null);
      return;
    }
    const from = iso < draftFrom ? iso : draftFrom;
    const to = iso < draftFrom ? draftFrom : iso;
    setDraftFrom(from);
    setDraftTo(to);
  }

  function applyRange() {
    const from = rangeFrom || today;
    const to = rangeTo || from;
    props.onChange({ kind: 'custom', from, to, fromTime, toTime }, true);
  }

  return createPortal(
    <div
      ref={props.panelRef}
      className="fixed z-[9999] flex gap-2 rounded-lg border border-slate-300 bg-white p-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex w-52 flex-col">
      <div className="relative mb-2 flex items-center justify-center px-7">
        <button
          type="button"
          className="absolute left-0 inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
          title="Предыдущий месяц"
          onClick={() => shiftMonth(-1)}
        >
          <ArrowLeftIcon className="h-3 w-3" />
        </button>
        <div className="text-xs font-semibold capitalize text-slate-800">{monthTitle}</div>
        <button
          type="button"
          className="absolute right-0 inline-flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:bg-slate-100"
          title="Следующий месяц"
          onClick={() => shiftMonth(1)}
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
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-7" />;
          const iso = toIso(month.year, month.month, day);
          const future = iso > today;
          const endpoint = iso === rangeFrom || iso === rangeTo;
          const inside = Boolean(rangeFrom && rangeTo && iso > rangeFrom && iso < rangeTo);
          return (
            <button
              key={iso}
              type="button"
              disabled={future}
              onMouseEnter={() => setHover(iso)}
              onMouseLeave={() => setHover(null)}
              onClick={() => pickDay(iso)}
              className={`h-7 rounded text-xs ${
                future
                  ? 'cursor-default text-slate-300'
                  : endpoint
                    ? 'bg-sky-600 font-semibold text-white'
                    : inside
                      ? 'bg-sky-100 text-sky-900'
                      : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex items-center gap-1 pt-2">
        <input
          type="time"
          aria-label="Время начала сводки"
          value={fromTime}
          onChange={(event) => setFromTime(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded border border-slate-300 px-1 text-[11px] text-slate-700"
        />
        <ArrowRightIcon className="h-3 w-3 shrink-0 text-slate-400" />
        <input
          type="time"
          aria-label="Время конца сводки"
          value={toTime}
          onChange={(event) => setToTime(event.target.value)}
          className="h-7 min-w-0 flex-1 rounded border border-slate-300 px-1 text-[11px] text-slate-700"
        />
      </div>
      </div>
      <div className="flex w-36 flex-col gap-1 self-stretch">
        {RANGE_PRESETS.map((preset) => {
          const range = preset.range();
          const selected =
            draftFrom === range.from &&
            draftTo === range.to &&
            fromTime === range.fromTime &&
            toTime === range.toTime;
          return (
            <button
              key={preset.id}
              type="button"
              className={`h-7 rounded border px-1 text-[11px] ${
                selected
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => {
                setDraftFrom(range.from);
                setDraftTo(range.to);
                setFromTime(range.fromTime);
                setToTime(range.toTime);
                setMonth(monthOf(range.to));
              }}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={props.disabled}
          className="mt-auto h-7 rounded border border-emerald-600 bg-emerald-600 px-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          onClick={applyRange}
        >
          Получить
        </button>
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
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function SummaryMaximizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function SummaryMinimizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

const SUMMARY_SORT_KEY = 'broteam.summarySort';

function defaultSummaryDir(key: SummarySortKey): ListSortDir {
  return key === 'number' || key === 'assignee' || key === 'summary' ? 'asc' : 'desc';
}

function loadSummarySort(): SummarySort {
  try {
    const raw = localStorage.getItem(SUMMARY_SORT_KEY);
    if (!raw) return { key: 'taken', dir: 'desc' };
    const parsed = JSON.parse(raw) as Partial<SummarySort>;
    const key = SORTS.some((item) => item.key === parsed.key) ? (parsed.key as SummarySortKey) : 'taken';
    const dir = parsed.dir === 'asc' || parsed.dir === 'desc' ? parsed.dir : defaultSummaryDir(key);
    return { key, dir };
  } catch {
    return { key: 'taken', dir: 'desc' };
  }
}

function saveSummarySort(sort: SummarySort) {
  localStorage.setItem(SUMMARY_SORT_KEY, JSON.stringify(sort));
}

type SummaryFrame = 'plain' | 'gold';

const FRAME_CLASS: Record<SummaryFrame, string> = {
  plain: 'border-slate-200',
  gold: 'border-amber-400',
};

function SummaryCard(props: {
  row: SummaryRow;
  open: boolean;
  color: string;
  frame: SummaryFrame;
  authored: boolean;
  personId: number | null;
  personName: string;
  note: string;
  onToggle: () => void;
  onHover: (issueKey: string | null, boardLocalId: number | null) => void;
  onNoteSave: (body: string) => void;
}) {
  const { row } = props;
  const assigneeRole = splitRole(row.assignees, row.assignee);
  const qaRole = splitRole(row.qas, row.qa);
  const reviewerRole = splitRole(row.reviewers, row.reviewer);
  const taken = row.takenAt || row.receivedAt;
  const sprints = sprintNames(row);
  const [editingNote, setEditingNote] = useState(false);
  useEffect(() => {
    if (!props.open) setEditingNote(false);
  }, [props.open]);
  const showNote = props.open && (editingNote || Boolean(props.note.trim()));
  return (
    <div
      className={`relative shrink-0 cursor-pointer overflow-hidden rounded border py-1 pl-2 pr-2 hover:bg-slate-50 ${FRAME_CLASS[props.frame]}`}
      onClick={props.onToggle}
      onMouseEnter={() => props.onHover(row.key, row.boardLocalId ?? null)}
      onMouseLeave={() => props.onHover(null, null)}
    >
      {props.authored && (
        <span title="Автор" className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" aria-hidden />
      )}
      <div className="flex items-center gap-1.5">
        <InstantTip text={row.currentStatus || '—'} className="inline-flex shrink-0 items-center">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: props.color }} />
        </InstantTip>
        {row.boardLabel ? (
          <span
            className="inline-flex h-4 shrink-0 items-center rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-normal leading-none text-slate-600"
            style={row.boardColor ? { color: row.boardColor } : undefined}
          >
            {row.boardLabel}
          </span>
        ) : null}
        <span className="inline-flex shrink-0 items-baseline">
          <a
            href={row.url}
            className="font-medium text-sky-700 hover:underline"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void window.api.openExternal(row.url);
            }}
          >
            {row.key}
          </a>
          <span className="text-black">:</span>
        </span>
        <span className="min-w-0 truncate text-black" title={row.summary}>
          {row.summary}
        </span>
        <CopyIssueButton issueKey={row.key} url={row.url} summary={row.summary} />
        <span className="min-w-0 flex-1" />
        <NoteClipboardButton
          hasNote={Boolean(props.note.trim())}
          onClick={(event) => {
            event.stopPropagation();
            if (!props.open) props.onToggle();
            setEditingNote(true);
          }}
        />
      </div>
      {!props.open && (
        <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1 pl-3.5 text-[10px] text-slate-500">
          <CollapsedRole role="Исполнитель" current={assigneeRole.current} past={assigneeRole.past} selected={props.personName} />
          <span className="text-slate-300" aria-hidden>·</span>
          <CollapsedRole role="Ревьюер" current={reviewerRole.current} past={reviewerRole.past} selected={props.personName} />
          <span className="text-slate-300" aria-hidden>·</span>
          <CollapsedRole role="Тестировщик" current={qaRole.current} past={qaRole.past} selected={props.personName} />
          <span className="min-w-0 truncate text-right">
            {dayOf(taken)} - {dayOf(row.finalStatusAt)}
            {periodDayCount(taken, row.finalStatusAt) != null ? ` (${periodDayCount(taken, row.finalStatusAt)})` : ''}
          </span>
        </div>
      )}
      {props.open && (
        <div className="mt-1 text-[11px] text-slate-700" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 pl-3.5">
            <div className="min-w-0 space-y-0.5">
              <RoleLine label="Исполнитель" current={assigneeRole.current} past={assigneeRole.past} selected={props.personName} />
              <RoleLine label="Тестировщик" current={qaRole.current} past={qaRole.past} selected={props.personName} />
              <RoleLine label="Ревьюер" current={reviewerRole.current} past={reviewerRole.past} selected={props.personName} />
              <div>
                <span className="text-slate-500">Автор: </span>
                <span className={owns([row.author], props.personName) ? 'font-bold' : ''}>{row.author || '—'}</span>
              </div>
            </div>
            <div className="shrink-0 space-y-0.5 text-right">
              <div>
                <span className="text-slate-500">Создана: </span>
                {dayOf(row.createdAt)}
              </div>
              <div>
                <span className="text-slate-500">Взята: </span>
                {dayOf(taken)}
              </div>
              <div>
                <span className="text-slate-500">Завершена: </span>
                {dayOf(row.finalStatusAt)}
              </div>
            </div>
          </div>
          {row.columns.length > 0 && (
            <div className="mt-2.5 mb-2.5 px-6">
              <table className="w-full text-[11px] leading-snug">
                <tbody>
                  {row.columns.map((column, index) => {
                    const stripe = index % 2 === 1 ? 'bg-slate-100' : '';
                    return (
                      <tr key={column.statusKey || column.label} className={timeClass(row, column.kind)}>
                        <td className={`${stripe} py-0.5 pl-2.5 text-left`}>{column.label}</td>
                        <td className={`${stripe} py-0.5 pr-2.5 text-right whitespace-nowrap`}>{formatStay(column)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {sprints.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
              {sprints.map((sprint) => (
                <span key={sprint} className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-600">
                  {sprint}
                </span>
              ))}
            </div>
          )}
          <TaskActivity row={row} personId={props.personId} />
        </div>
      )}
      {showNote && (
        <SummaryNote
          note={props.note}
          editing={editingNote}
          onEdit={() => setEditingNote(true)}
          onSave={(body) => {
            setEditingNote(false);
            props.onNoteSave(body);
          }}
        />
      )}
    </div>
  );
}

function TaskActivity(props: { row: SummaryRow; personId: number | null }) {
  const id = props.personId == null ? '' : String(props.personId);
  const own = id ? props.row.commentsById : undefined;
  const comments = own ? own[id] || 0 : props.row.commentCount;
  const last = id ? props.row.lastById?.[id] : null;
  const at = last?.at || (!id ? props.row.lastActionAt || props.row.lastActivityAt : null);
  const text = last?.text || (!id ? props.row.lastActionText : '');
  const when = actionStamp(at);
  const action = [text, when].filter(Boolean).join(' · ') || '—';
  return (
    <div className="mt-1.5 space-y-0.5 pl-3.5 text-[11px] text-slate-600">
      <div>
        <span className="text-slate-500">Комментарии: </span>
        {comments}
      </div>
      <div>
        <span className="text-slate-500">Последнее: </span>
        {action}
      </div>
    </div>
  );
}

function actionStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function RoleLine(props: { label: string; current: string; past: string[]; selected: string }) {
  return (
    <div>
      <span className="text-slate-500">{props.label}: </span>
      <span className={sameName(props.current, props.selected) ? 'font-bold' : ''}>{props.current || '—'}</span>
      {props.past.length > 0 && (
        <span className="text-slate-400">
          {' ('}
          {props.past.map((name, index) => (
            <span key={`${name}-${index}`}>
              {index > 0 ? ', ' : ''}
              <span className={`line-through ${sameName(name, props.selected) ? 'font-bold text-slate-500' : ''}`}>
                {name}
              </span>
            </span>
          ))}
          {')'}
        </span>
      )}
    </div>
  );
}

function CollapsedRole(props: { role: string; current: string; past: string[]; selected: string }) {
  const pastHit = props.past.find((name) => sameName(name, props.selected));
  if (pastHit) {
    return (
      <RoleName
        role={props.role}
        name={pastHit}
        strike
        tip={`${props.role}: ${props.current || '—'}`}
        className="font-bold text-slate-500"
      />
    );
  }
  return (
    <RoleName
      role={props.role}
      name={props.current}
      className={sameName(props.current, props.selected) ? 'font-bold text-slate-800' : ''}
    />
  );
}

function timeClass(row: SummaryRow, kind: SummaryRow['columns'][number]['kind']): string {
  if (row.emphasizeTesting && kind === 'testing') return 'font-bold';
  if (row.emphasizeWork && kind === 'work') return 'font-bold';
  if (row.emphasizeReview && kind === 'review') return 'font-bold';
  return '';
}

function formatStamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU');
}

function sortRows(rows: SummaryRow[], sort: SummarySort): SummaryRow[] {
  if (sort.key === 'activity') {
    return [...rows].sort((a, b) => {
      const cmp = cmpMissingLast(activityStamp(a), activityStamp(b), sort.dir);
      return cmp || a.key.localeCompare(b.key);
    });
  }
  const key = sort.key;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => compareRows(a, b, key) * dir || a.key.localeCompare(b.key));
}

function compareRows(a: SummaryRow, b: SummaryRow, key: Exclude<SummarySortKey, 'activity'>): number {
  if (key === 'number') return issueNumber(a.key) - issueNumber(b.key);
  if (key === 'assignee') return a.assignee.localeCompare(b.assignee, 'ru');
  if (key === 'summary') return a.summary.localeCompare(b.summary, 'ru');
  const left = key === 'taken' ? a.takenAt || a.receivedAt : key === 'done' ? a.finalStatusAt : a.createdAt;
  const right = key === 'taken' ? b.takenAt || b.receivedAt : key === 'done' ? b.finalStatusAt : b.createdAt;
  return stampValue(left) - stampValue(right);
}

function activityStamp(row: SummaryRow): number | null {
  const iso = row.lastActivityAt || row.lastCommentAt || row.currentStatusAt || row.finalStatusAt || row.receivedAt || row.createdAt;
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function cmpMissingLast(a: number | null, b: number | null, dir: ListSortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function issueNumber(key: string): number {
  const match = /-(\d+)$/.exec(key);
  return match ? Number(match[1]) : 0;
}

function stampValue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function markerColor(row: SummaryRow, columns: BoardColumnConfig[], boardId: number | null): string {
  const match = columns.find(
    (column) =>
      column.boardLocalId === boardId &&
      (column.statusKey === row.statusKey ||
        column.statusDisplay === row.currentStatus ||
        column.alias === row.currentStatus ||
        column.columnName === row.currentStatus),
  );
  return match?.color || '#94a3b8';
}

function remapSummaryText(name: string, developers: Developer[]): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '—') return name;
  return resolvePersonDisplayName(null, trimmed, developers) || trimmed;
}

function remapSummaryRow(row: SummaryRow, developers: Developer[]): SummaryRow {
  const mapList = (list?: string[]) => list?.map((item) => remapSummaryText(item, developers));
  return {
    ...row,
    assignee: remapSummaryText(row.assignee, developers),
    reviewer: remapSummaryText(row.reviewer, developers),
    qa: remapSummaryText(row.qa, developers),
    author: remapSummaryText(row.author, developers),
    assignees: mapList(row.assignees),
    qas: mapList(row.qas),
    reviewers: mapList(row.reviewers),
    shuffles: row.shuffles.map((item) => ({
      ...item,
      title: item.title.replace(/((?:был|стал)\s+)(.+)$/, (_match, prefix: string, name: string) => {
        return prefix + remapSummaryText(name, developers);
      }),
    })),
  };
}

function focusSummaryRow(row: SummaryRow, person: Developer): SummaryRow {
  const name = person.displayName.trim();
  const ends = (list: string[] | undefined, fallback: string) => {
    const names = namesOf(list, fallback);
    return { first: names[0] || '', last: names[names.length - 1] || '' };
  };
  const assignee = ends(row.assignees, row.assignee);
  const qa = ends(row.qas, row.qa);
  const reviewer = ends(row.reviewers, row.reviewer);
  const shuffles: SummaryRow['shuffles'] = [];
  const push = (role: SummaryRow['shuffles'][number]['role'], label: string, first: string, last: string) => {
    if (first && first !== name) shuffles.push({ role, tone: 'success', title: `${label} сначала был ${first}` });
    if (last && last !== name) shuffles.push({ role, tone: 'danger', title: `${label} стал ${last}` });
  };
  push('assignee', 'Исполнитель', assignee.first, assignee.last);
  push('qa', 'Тестировщик', qa.first, qa.last);
  push('reviewer', 'Ревьюер', reviewer.first, reviewer.last);
  return {
    ...row,
    shuffles,
    emphasizeTesting: person.role === 'qa',
    emphasizeWork: person.role === 'developer' && owns(namesOf(row.assignees, row.assignee), name),
    emphasizeReview: person.role === 'developer' && owns(namesOf(row.reviewers, row.reviewer), name),
  };
}

function namesOf(list: string[] | undefined, fallback: string): string[] {
  const names = (list || []).map((name) => name.trim()).filter((name) => name && name !== '—');
  if (names.length) return names;
  const single = fallback.trim();
  return single && single !== '—' ? [single] : [];
}

function owns(names: string[], personName: string): boolean {
  const target = personName.trim();
  return Boolean(target) && names.some((name) => name.trim() === target);
}

function sprintNames(row: SummaryRow): string[] {
  const source = row.sprints?.length ? row.sprints : [row.receivedSprint, row.currentSprint];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of source) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === '—' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function RoleName(props: { role: string; name?: string; className?: string; strike?: boolean; tip?: string }) {
  const value = (props.name || '').trim();
  if (!value) {
    return <span className="min-w-0 justify-self-start truncate text-red-300 line-through">{props.role}</span>;
  }
  return (
    <InstantTip
      text={props.tip || props.role}
      className={`inline-flex w-fit max-w-full min-w-0 cursor-help justify-self-start ${props.className || ''}`}
    >
      <span className={`truncate ${props.strike ? 'line-through' : ''}`} style={{ cursor: 'help' }}>
        {value}
      </span>
    </InstantTip>
  );
}

function sameName(name: string | undefined, personName: string): boolean {
  const value = (name || '').trim();
  const target = personName.trim();
  return Boolean(value && target && value === target);
}

function splitRole(list: string[] | undefined, current: string): { current: string; past: string[] } {
  const names = namesOf(list, current);
  const now = current.trim();
  const actual = now && now !== '—' ? now : names[names.length - 1] || '';
  return { current: actual, past: names.filter((name) => name !== actual) };
}

function summaryFrame(row: SummaryRow, person: Developer | null): SummaryFrame {
  if (!person) return 'plain';
  if ((row.changedByIds || []).includes(person.id)) return 'gold';
  return 'plain';
}

function SummaryNote(props: {
  note: string;
  editing: boolean;
  onEdit: () => void;
  onSave: (body: string) => void;
}) {
  const [draft, setDraft] = useState(props.note);
  const [view, setView] = useState<'preview' | 'markdown'>('preview');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const skip = useRef(false);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (props.editing && !wasEditing.current) {
      setDraft(props.note);
      setView(props.note.trim() ? 'preview' : 'markdown');
    }
    wasEditing.current = props.editing;
  }, [props.editing, props.note]);

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
    if (!props.editing || view !== 'preview' || !node) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    node.innerHTML = renderMarkdown(draft);
  }, [props.editing, view, draft]);

  function source(): string {
    if (props.editing && view === 'preview' && previewRef.current) return htmlToMarkdown(previewRef.current);
    return draft;
  }

  function onMarkdownKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    const key = hotkeyId(event);
    if (!key) return;
    if (key !== 'Tab' && !['b', 'i', 'u', 's', 'e'].includes(key)) return;
    const next = applyMarkdownHotkey(draft, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    setDraft(next.value);
    pending.current = { start: next.start, end: next.end };
  }

  return (
    <div className="mt-1.5 flex items-stretch gap-1.5 border-t border-slate-100 pt-1" onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <button
          type="button"
          title={props.editing ? 'Сохранить' : 'Редактировать'}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-white ${
            props.editing
              ? 'border-emerald-600 bg-emerald-600 hover:border-emerald-700 hover:bg-emerald-700'
              : 'border-sky-600 bg-sky-600 hover:border-sky-700 hover:bg-sky-700'
          }`}
          onClick={() => {
            if (!props.editing) {
              props.onEdit();
              return;
            }
            props.onSave(source().replace(/\s+$/, ''));
          }}
        >
          {props.editing ? <CheckSquareIcon className="h-3.5 w-3.5" /> : <EditIcon className="h-3.5 w-3.5" />}
        </button>
        {props.editing && (
          <NoteModeSwitch
            value={view}
            onChange={(next) => {
              if (view === 'preview' && next === 'markdown' && previewRef.current) {
                setDraft(htmlToMarkdown(previewRef.current));
              }
              setView(next);
            }}
          />
        )}
      </div>
      <div className="flex min-h-full min-w-0 flex-1">
      {props.editing && view === 'markdown' ? (
        <textarea
          ref={areaRef}
          rows={Math.max(1, draft.split('\n').length)}
          className="m-0 block min-h-full w-full resize-none rounded border border-slate-300 bg-white p-1 text-xs leading-snug outline-none"
          value={draft}
          placeholder="Примечание к задаче"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onMarkdownKey}
        />
      ) : props.editing ? (
        <div
          ref={previewRef}
          className="summary-note markdown-body m-0 min-h-full w-full rounded border border-slate-300 bg-white p-1 text-xs leading-snug outline-none"
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            if (!previewRef.current) return;
            skip.current = true;
            setDraft(htmlToMarkdown(previewRef.current));
          }}
          onKeyDown={(event) => {
            if (!handleRichHotkey(event.nativeEvent)) return;
            if (!previewRef.current) return;
            skip.current = true;
            setDraft(htmlToMarkdown(previewRef.current));
          }}
        />
      ) : (
        <div
          className="summary-note markdown-body p-0 text-xs leading-snug"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(props.note) }}
        />
      )}
      </div>
    </div>
  );
}

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

function periodDayCount(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from) return null;
  const start = new Date(from);
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms =
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.max(0, Math.round(ms / 86_400_000));
}

function dayOf(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
    }
  }
  return '—';
}

function formatStay(column: SummaryRow['columns'][number]): string {
  const hours = Math.max(0, Math.round(column.ms / 3_600_000));
  const days = Math.floor(hours / 24);
  return `${days} дней ${hours - days * 24} часов`;
}
