import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { BoardColumnConfig, Developer, SavedBoard } from '@shared/types';
import { PARTICIPANT_ROLES } from '@shared/types';
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
  CastIcon,
  CoffeeIcon,
  HashIcon,
  IconActionButton,
  NoteClipboardButton,
  TargetIcon,
  RefreshIcon,
  UserIcon,
  UsersIcon,
  XIcon,
  ZapIcon,
} from './Icons';
import { CopyIssueButton } from './IssuePanel';
import { LoadBar } from './LoadBar';
import { RunSpinner } from './ApiRunControls';
import { InstantTip } from './InstantTip';
import { SortMenu, type ListSortDir } from './ListSort';
import {
  invalidateIssueStories,
  readIssueStory,
  useIssueStoryRevision,
  writeIssueStory,
} from '../issueStoryCache';

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
  castOn: boolean;
  onPersonId: (id: number | null) => void;
  onCast: () => void;
  onOpenBoard: (boardLocalId: number) => void;
  onPeriod: (period: SummaryPeriod) => void;
  onIssueHover: (issueKey: string | null, boardLocalId: number | null) => void;
  onCached?: () => void;
}) {
  const roster = props.participants.filter((person) => !person.hidden);
  const people = roster.filter((person) => person.summary);
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
  const [plans, setPlans] = useState(true);
  const [indirect, setIndirect] = useState(false);
  const [personal, setPersonal] = useState(true);
  const [activity, setActivity] = useState(true);
  const personRef = useRef<HTMLDivElement>(null);
  const selected = roster.find((person) => person.id === props.personId) || null;

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
    return window.api.onWorkCleared(() => {
      runningRef.current = false;
      setRunning(false);
      setRows([]);
      setFormedAt(null);
      setCoverage(null);
      setRequests(0);
    });
  }, []);

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
  const [boardFilter, setBoardFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const audienceRows = useMemo(() => {
    const people = props.participants.filter(
      (person) => !person.hidden && (person.role === 'developer' || person.role === 'qa'),
    );
    return namedRows
      .filter((row) => cardVisible(row, selected, props.columns, people, { personal, indirect, plans, activity }))
      .map((row) => (selected ? focusSummaryRow(row, selected) : row));
  }, [namedRows, selected, props.columns, props.participants, personal, indirect, plans, activity]);
  const boardBadges = useMemo(
    () => summaryBoardBadges(audienceRows, props.boards),
    [audienceRows, props.boards],
  );
  const statusColumns = useMemo(
    () =>
      boardFilter == null
        ? []
        : props.columns
            .filter((column) => column.enabled && column.boardLocalId === boardFilter)
            .sort((a, b) => a.sortOrder - b.sortOrder),
    [props.columns, boardFilter],
  );
  const statusBadges = useMemo(
    () => (boardFilter == null ? [] : summaryStatusBadges(audienceRows, boardFilter, statusColumns)),
    [audienceRows, boardFilter, statusColumns],
  );
  useEffect(() => {
    if (boardFilter != null && !boardBadges.some((badge) => badge.id === boardFilter)) {
      setBoardFilter(null);
      setStatusFilter(null);
    }
  }, [boardBadges, boardFilter]);
  useEffect(() => {
    if (statusFilter != null && !statusBadges.some((badge) => badge.key === statusFilter)) setStatusFilter(null);
  }, [statusBadges, statusFilter]);
  const visibleRows = useMemo(() => {
    let filtered = audienceRows;
    if (boardFilter != null) filtered = filtered.filter((row) => row.boardLocalId === boardFilter);
    if (statusFilter) filtered = filtered.filter((row) => rowStatusKey(row, statusColumns) === statusFilter);
    const needle = query.trim();
    if (needle) {
      filtered = filtered.filter((row) => textHit(needle, summarySearchParts(row, roster, props.boards)));
    }
    return sortRows(filtered, sort);
  }, [audienceRows, boardFilter, statusFilter, statusColumns, query, roster, props.boards, sort]);
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
          duty: column.duty,
          ownerRole: column.ownerRole,
          boardLocalId: column.boardLocalId,
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

  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const personName = (selected?.displayName || selected?.login || '').trim();

  async function refreshRow(row: SummaryRow) {
    const boardLocalId = row.boardLocalId ?? props.boardLocalId;
    const request = summaryRequest();
    if (boardLocalId == null || !request) return;
    setRefreshingKey(row.key);
    setError(null);
    try {
      const next = await window.api.refreshSummaryIssue(request, row.key, boardLocalId);
      invalidateIssueStories(row.key);
      if (next) setRows((prev) => prev.map((item) => (item.key === row.key ? next : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingKey((current) => (current === row.key ? null : current));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="relative flex h-8 shrink-0 items-center gap-2 border-b border-slate-200 px-2 text-sm font-semibold text-slate-900">
        Сводка
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
        <button
          type="button"
          title={
            selected
              ? 'Оставить на всех досках задачи этого участника'
              : props.castOn
                ? 'Выключить трансляцию'
                : 'Сначала выберите участника'
          }
          aria-pressed={props.castOn}
          disabled={!selected && !props.castOn}
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${
            props.castOn
              ? 'bg-[#3647d2] text-white'
              : selected
                ? 'text-slate-600 hover:bg-white'
                : 'cursor-default text-slate-300'
          }`}
          onClick={props.onCast}
        >
          <CastIcon className="h-3.5 w-3.5" />
        </button>
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
              {PARTICIPANT_ROLES.map((role) => {
                const group = people.filter((person) => person.role === role.id);
                if (!group.length) return null;
                return (
                  <div key={role.id}>
                    <div className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {role.label}
                    </div>
                    {group.map((person) => {
                      const count = namedRows.filter((row) => personOnRow(row, person)).length;
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
        <span className="mx-1 h-4 w-px shrink-0 bg-slate-300" aria-hidden />
        <PeriodField
          period={props.period}
          onChange={props.onPeriod}
          onFetch={(period) => void build(period)}
          disabled={running || props.boardLocalId == null}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по ключу"
          className="ml-auto h-6 w-[30%] shrink-0 rounded border border-slate-300 bg-white px-2 text-xs font-normal text-slate-800"
        />
      </div>
      <div className="flex shrink-0 flex-col gap-1 border-b border-slate-200 px-2 py-1">
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {boardBadges.map((badge) => (
              <BoardFilterBadge
                key={badge.id}
                label={badge.label}
                count={badge.count}
                color={badge.color}
                selected={boardFilter === badge.id}
                onToggle={() => {
                  if (boardFilter === badge.id) {
                    setBoardFilter(null);
                    setStatusFilter(null);
                    return;
                  }
                  setBoardFilter(badge.id);
                  setStatusFilter(null);
                }}
              />
            ))}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {selected ? (
                <>
                  <button
                    type="button"
                    aria-pressed={personal}
                    title="Задачи, где участник сам действовал в периоде"
                    className={summaryToggleClass(personal, false)}
                    onClick={() => setPersonal((on) => !on)}
                  >
                    <UserIcon className="h-3 w-3" />
                    Лично
                  </button>
                  <button
                    type="button"
                    aria-pressed={indirect}
                    title="Задачи, где участник за период ничего не делал"
                    className={summaryToggleClass(indirect, false)}
                    onClick={() => setIndirect((on) => !on)}
                  >
                    <CoffeeIcon className="h-3 w-3" />
                    Косвенно
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-pressed={activity}
                  title="Задачи, по которым была активность за период"
                  className={summaryToggleClass(activity, false, 'primary')}
                  onClick={() => setActivity((on) => !on)}
                >
                  <ZapIcon className="h-3 w-3" />
                  Активность
                </button>
              )}
              <button
                type="button"
                aria-pressed={plans}
                title="Задачи в колонках с тегом, без активности за период"
                className={summaryToggleClass(plans, false, 'primary')}
                onClick={() => setPlans((on) => !on)}
              >
                <TargetIcon className="h-3 w-3" />
                Планы
              </button>
            </div>
          </div>
          {boardFilter != null && statusBadges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {statusBadges.map((badge) => (
                <StatusFilterBadge
                  key={badge.key}
                  label={badge.label}
                  count={badge.count}
                  color={badge.color}
                  selected={statusFilter === badge.key}
                  onToggle={() => setStatusFilter((current) => (current === badge.key ? null : badge.key))}
                />
              ))}
            </div>
          )}
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
          const color = markerColor(row, props.columns);
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
              frame={summaryFrame(row, selected, props.columns)}
              authored={Boolean(selected && sameName(row.author, personName))}
              personId={selected?.id ?? null}
              personRole={selected?.role ?? null}
              personName={personName}
              note={issueNotes[row.key] || ''}
              columns={props.columns}
              onToggle={toggle}
              onHover={props.onIssueHover}
              refreshing={refreshingKey === row.key}
              onRefresh={() => void refreshRow(row)}
              onNoteSave={(body) => {
                setIssueNotes((prev) => ({ ...prev, [row.key]: body }));
                if (props.boardLocalId == null || props.personId == null) return;
                void window.api.setSummaryIssueNote(props.boardLocalId, props.personId, row.key, body);
              }}
              onOpenBoard={props.onOpenBoard}
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
    <div ref={rootRef} className="flex shrink-0 items-center gap-1">
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
          Сформировать
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

type SummaryFrame = 'plain' | 'gold' | 'primary' | 'success';

const FRAME_CLASS: Record<SummaryFrame, string> = {
  plain: 'border-slate-200',
  gold: 'border-amber-400',
  primary: 'border-sky-600',
  success: 'border-emerald-600',
};

function SummaryCard(props: {
  row: SummaryRow;
  open: boolean;
  color: string;
  frame: SummaryFrame;
  authored: boolean;
  personId: number | null;
  personRole: Developer['role'] | null;
  personName: string;
  note: string;
  columns: BoardColumnConfig[];
  onToggle: () => void;
  onHover: (issueKey: string | null, boardLocalId: number | null) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onNoteSave: (body: string) => void;
  onOpenBoard: (boardLocalId: number) => void;
}) {
  const { row } = props;
  const assigneeRole = splitRole(row.assignees, row.assignee);
  const qaRole = splitRole(row.qas, row.qa);
  const reviewerRole = splitRole(row.reviewers, row.reviewer);
  const taken = row.takenAt || row.receivedAt;
  const sprints = sprintNames(row);
  const [editingNote, setEditingNote] = useState(false);
  const storyRev = useIssueStoryRevision();
  const seenStoryRev = useRef(storyRev);
  const [story, setStory] = useState(() => readIssueStory(row.key));
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyPart, setStoryPart] = useState<'description' | 'comment' | null>(null);
  const [storyFailed, setStoryFailed] = useState(false);
  useEffect(() => {
    if (!props.open) setEditingNote(false);
  }, [props.open]);
  useEffect(() => {
    if (seenStoryRev.current === storyRev) return;
    seenStoryRev.current = storyRev;
    const cached = readIssueStory(row.key);
    setStory(cached);
    if (cached || !storyPart) return;
    let alive = true;
    setStoryBusy(true);
    setStoryFailed(false);
    void window.api
      .getIssueStory(row.key)
      .then((next) => {
        writeIssueStory(row.key, next);
        if (alive) setStory(next);
      })
      .catch(() => {
        if (alive) setStoryFailed(true);
      })
      .finally(() => {
        if (alive) setStoryBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [storyRev, row.key, storyPart]);
  async function loadStory(part: 'description' | 'comment') {
    if (storyPart === part) {
      setStoryPart(null);
      return;
    }
    setStoryPart(part);
    const cached = readIssueStory(row.key);
    if (cached) {
      setStory(cached);
      setStoryFailed(false);
      return;
    }
    if (story || storyBusy) return;
    setStoryBusy(true);
    setStoryFailed(false);
    try {
      const next = await window.api.getIssueStory(row.key);
      writeIssueStory(row.key, next);
      setStory(next);
    } catch {
      setStoryFailed(true);
    } finally {
      setStoryBusy(false);
    }
  }
  const showNote = props.open && (editingNote || Boolean(props.note.trim()));
  return (
    <div
      className={`relative shrink-0 cursor-pointer overflow-hidden rounded border hover:bg-slate-50 ${FRAME_CLASS[props.frame]}`}
      onClick={props.onToggle}
      onMouseEnter={() => props.onHover(row.key, row.boardLocalId ?? null)}
      onMouseLeave={() => props.onHover(null, null)}
    >
      {props.authored && (
        <span title="Автор" className="absolute inset-y-0 left-0 w-1.5 bg-emerald-500" aria-hidden />
      )}
      <div className={`flex items-center gap-1.5 px-2 py-1 ${props.open ? 'border-b border-slate-200 bg-slate-50' : ''}`}>
        <InstantTip text={row.currentStatus || '—'} className="inline-flex shrink-0 items-center">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: props.color }} />
        </InstantTip>
        {row.boardLabel ? (
          <button
            type="button"
            title="Открыть доску"
            className="inline-flex h-4 shrink-0 items-center rounded-none border border-l-[3px] border-slate-300 bg-white px-1 text-[10px] font-medium leading-none text-slate-700"
            style={{ borderLeftColor: row.boardColor || '#64748b' }}
            onClick={(event) => {
              event.stopPropagation();
              if (row.boardLocalId != null) props.onOpenBoard(row.boardLocalId);
            }}
          >
            {row.boardLabel}
          </button>
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
        <div className="flex shrink-0 items-center gap-px">
          <NoteClipboardButton
            hasNote={Boolean(props.note.trim())}
            onClick={(event) => {
              event.stopPropagation();
              if (!props.open) props.onToggle();
              setEditingNote(true);
            }}
          />
          <IconActionButton
            tone="muted"
            size="sm"
            title="Обновить задачу"
            disabled={props.refreshing}
            onClick={(event) => {
              event.stopPropagation();
              props.onRefresh();
            }}
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${props.refreshing ? 'animate-spin' : ''}`} />
          </IconActionButton>
        </div>
      </div>
      {!props.open && (
        <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-1 px-2 pb-1 pl-5 text-[10px] text-slate-500">
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
        <div className="mt-1 px-2 pb-1 text-[11px] text-slate-700" onClick={(event) => event.stopPropagation()}>
          {props.refreshing && (
            <div className="mb-2 pl-3.5">
              <LoadBar label="Обновление задачи…" />
            </div>
          )}
          <div className="flex items-start gap-3 pl-3.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <RoleLine label="Исполнитель" current={assigneeRole.current} past={assigneeRole.past} selected={props.personName} />
              <RoleLine label="Тестировщик" current={qaRole.current} past={qaRole.past} selected={props.personName} />
              <RoleLine label="Ревьюер" current={reviewerRole.current} past={reviewerRole.past} selected={props.personName} />
              <div>
                <span className="text-slate-500">Автор: </span>
                <span className={owns([row.author], props.personName) ? 'font-bold' : ''}>{row.author || '—'}</span>
              </div>
            </div>
            <div className="max-w-[40%] shrink-0 self-center px-1 text-center text-[11px] font-medium text-slate-800">
              {row.currentStatus || '—'}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5 text-right">
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
          <SummaryHours
            row={row}
            personId={props.personId}
            personRole={props.personRole}
            columns={props.columns}
          />
          {sprints.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
              {sprints.map((sprint) => (
                <span key={sprint} className="rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-600">
                  {sprint}
                </span>
              ))}
            </div>
          )}
          <TaskActivity row={row} personId={props.personId} personName={props.personName} />
          <div className="mt-2 flex gap-1 pl-3.5">
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 text-[10px] ${storyPart === 'description' ? 'border-slate-400 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`}
              onClick={() => void loadStory('description')}
            >
              Описание
            </button>
            <button
              type="button"
              className={`rounded border px-1.5 py-0.5 text-[10px] ${storyPart === 'comment' ? 'border-slate-400 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`}
              onClick={() => void loadStory('comment')}
            >
              Последний комментарий
            </button>
          </div>
          {storyBusy && storyPart && (
            <div className="mt-2 pl-3.5">
              <LoadBar label={storyPart === 'description' ? 'Загрузка описания…' : 'Загрузка последнего комментария…'} />
            </div>
          )}
          {storyFailed && storyPart && <div className="mt-1 pl-3.5 text-slate-400">Не загрузилось</div>}
          {story && storyPart === 'description' && (
            <div className="mt-2 pl-3.5">
              {story.description ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(story.description) }} />
              ) : (
                <div className="text-slate-400">Нет описания</div>
              )}
            </div>
          )}
          {story && storyPart === 'comment' && (
            <div className="mt-2 ml-3.5 rounded border border-amber-200/80 bg-[#fffbeb] px-2 py-1.5">
              {story.commentText ? (
                <>
                  <a
                    href={story.commentUrl}
                    className="text-[10px] font-medium text-sky-700 hover:underline"
                    onClick={(event) => {
                      event.preventDefault();
                      void window.api.openExternal(story.commentUrl);
                    }}
                  >
                    Последний комментарий
                  </a>
                  {(story.commentAuthor || story.commentAt) && (
                    <div className="text-[10px] text-slate-500">
                      {[story.commentAuthor, story.commentAt ? new Date(story.commentAt).toLocaleString('ru-RU') : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
                  <div className="markdown-body mt-0.5" dangerouslySetInnerHTML={{ __html: renderMarkdown(story.commentText) }} />
                </>
              ) : (
                <div className="text-slate-400">Нет комментария</div>
              )}
            </div>
          )}
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

function TaskActivity(props: { row: SummaryRow; personId: number | null; personName: string }) {
  const id = props.personId == null ? '' : String(props.personId);
  const own = id ? props.row.commentsById : undefined;
  const comments = own ? own[id] || 0 : props.row.commentCount;
  const last = id ? props.row.lastById?.[id] : newestParticipantAction(props.row.lastById);
  const when = actionStamp(last?.at);
  const action = [last?.text, when].filter(Boolean).join(' · ') || '—';
  const label = props.personName.trim()
    ? `Последнее действие ${props.personName.trim()}`
    : 'Последнее действие любого участника';
  return (
    <div className="mt-1.5 space-y-0.5 pl-3.5 text-[11px] text-slate-600">
      <div>
        <span className="text-slate-500">Комментарии: </span>
        {comments}
      </div>
      <div>
        <span className="text-slate-500">{label}: </span>
        {action}
      </div>
    </div>
  );
}

function newestParticipantAction(
  lastById: SummaryRow['lastById'],
): { at: string; text: string } | null {
  let best: { at: string; text: string } | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const item of Object.values(lastById || {})) {
    const at = Date.parse(item.at || '');
    if (!Number.isFinite(at) || at < bestAt) continue;
    best = item;
    bestAt = at;
  }
  return best;
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

function markerColor(row: SummaryRow, columns: BoardColumnConfig[]): string {
  const onBoard = columns.filter(
    (column) => row.boardLocalId == null || column.boardLocalId === row.boardLocalId,
  );
  const match =
    onBoard.find((column) => column.statusKey === row.statusKey) ||
    onBoard.find(
      (column) =>
        column.statusDisplay === row.currentStatus ||
        column.alias === row.currentStatus ||
        column.columnName === row.currentStatus,
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

function summaryFrame(row: SummaryRow, person: Developer | null, columns: BoardColumnConfig[]): SummaryFrame {
  const kind = cardKind(row, person, columns);
  if (kind === 'success') return 'success';
  if (kind === 'personal') return 'primary';
  if (kind === 'plan') return 'gold';
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
    <div className="mt-1.5 flex items-stretch gap-1.5 border-t border-slate-100 px-2 pb-2 pt-1.5" onClick={(event) => event.stopPropagation()}>
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

function hourCount(ms: number): string {
  const hours = Math.max(0, ms / 3_600_000);
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',');
}

function ownStay(
  column: SummaryRow['columns'][number] | undefined,
  personId: number | null,
  role: Developer['role'] | null,
): { own: number; total: number; split: boolean } {
  const total = column?.ms || 0;
  if (personId == null || !column) return { own: total, total, split: false };
  const key = String(personId);
  const author = column.byAuthor?.[key] || 0;
  const own =
    role === 'qa'
      ? (column.byQa?.[key] || 0) + author
      : (column.byAssignee?.[key] || 0) + (column.byReviewer?.[key] || 0) + author;
  return { own, total, split: true };
}

function SummaryHours(props: {
  row: SummaryRow;
  personId: number | null;
  personRole: Developer['role'] | null;
  columns: BoardColumnConfig[];
}) {
  const recorded = new Map(props.row.columns.map((column) => [column.statusKey, column]));
  const ordered = props.columns
    .filter(
      (column) =>
        column.enabled &&
        (props.row.boardLocalId == null || column.boardLocalId === props.row.boardLocalId),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
  let frontier = -1;
  ordered.forEach((column, index) => {
    if (column.statusKey === props.row.statusKey || recorded.has(column.statusKey)) frontier = index;
  });
  const lines = ordered.map((column, index) => {
    const spent = recorded.get(column.statusKey);
    return {
      key: column.statusKey,
      label: spent?.label || column.statusDisplay || column.alias || column.statusKey,
      kind: spent?.kind || 'other',
      duty: column.duty || '',
      reached: index <= frontier,
      stay: ownStay(spent, props.personId, props.personRole),
    };
  });
  const extras = props.row.columns
    .filter((extra) => !lines.some((line) => line.key === extra.statusKey))
    .map((extra) => ({
      key: extra.statusKey,
      label: extra.label,
      kind: extra.kind,
      duty: '',
      reached: true,
      stay: ownStay(extra, props.personId, props.personRole),
    }));
  const firstAhead = lines.findIndex((line) => !line.reached);
  if (extras.length) {
    if (firstAhead < 0) lines.push(...extras);
    else lines.splice(firstAhead, 0, ...extras);
  }
  const split = lines.some((line) => line.stay.split);
  const showAi = lines.some((line) => line.duty === 'ai');
  const reachedLines = lines.filter((line) => line.reached);
  const ownTotal = reachedLines.reduce((sum, line) => sum + (line.duty === 'ai' ? 0 : line.stay.own), 0);
  const allTotal = reachedLines.reduce((sum, line) => sum + line.stay.total, 0);
  const aiTotal = reachedLines.reduce((sum, line) => sum + (line.duty === 'ai' ? line.stay.total : 0), 0);
  if (!lines.length) return null;
  const cell = (line: (typeof lines)[number], ms: number) => (line.reached ? hourCount(ms) : '—');
  const hover = 'group-hover:bg-sky-100';
  return (
    <div className="my-2.5 px-6">
      <table className="w-full text-[11px] leading-snug">
        <thead>
          <tr className="text-[10px] font-medium text-slate-400">
            <th className="py-0.5 pl-2.5 text-left font-medium">Статус</th>
            <th className="py-0.5 pr-2.5 text-right font-medium">Часы (личные)</th>
            {split && <th className="py-0.5 pr-2.5 text-right font-medium">Часы (общие)</th>}
            {showAi && <th className="py-0.5 pr-2.5 text-right font-medium">ИИ</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const stripe = index % 2 === 1 ? 'bg-slate-100' : '';
            const own = line.duty === 'ai' ? null : line.stay.own;
            return (
              <tr key={line.key} className={`group ${stripe} hover:bg-sky-100 ${timeClass(props.row, line.kind)}`}>
                <td className={`py-0.5 pl-2.5 text-left ${hover}`}>{line.label}</td>
                <td className={`py-0.5 pr-2.5 text-right font-medium tabular-nums ${hover}`}>
                  {own == null ? '—' : cell(line, own)}
                </td>
                {split && (
                  <td className={`py-0.5 pr-2.5 text-right tabular-nums text-slate-400 ${hover}`}>
                    {cell(line, line.stay.total)}
                  </td>
                )}
                {showAi && (
                  <td className={`py-0.5 pr-2.5 text-right tabular-nums text-slate-400 ${hover}`}>
                    {line.duty === 'ai' ? cell(line, line.stay.total) : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 font-semibold text-slate-700">
            <td className="py-0.5 pl-2.5 text-left">Total</td>
            <td className="py-0.5 pr-2.5 text-right tabular-nums">{hourCount(ownTotal)}</td>
            {split && <td className="py-0.5 pr-2.5 text-right tabular-nums text-slate-400">{hourCount(allTotal)}</td>}
            {showAi && <td className="py-0.5 pr-2.5 text-right tabular-nums text-slate-400">{hourCount(aiTotal)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const SUMMARY_BADGE_GRAY = '#64748b';

function summaryToggleClass(on: boolean, disabled: boolean, tone: 'default' | 'primary' = 'default'): string {
  const base = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium shadow-sm';
  if (disabled) return `${base} cursor-default border-slate-200 bg-slate-100 text-slate-300 shadow-none`;
  if (!on) return `${base} border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100`;
  if (tone === 'primary') return `${base} border-sky-600 bg-sky-600 text-white hover:border-sky-700 hover:bg-sky-700`;
  return `${base} border-slate-800 bg-slate-800 text-white hover:bg-slate-700`;
}

function summaryBoardBadges(
  rows: SummaryRow[],
  boards: SavedBoard[],
  extra: Array<{ boardLocalId: number | null }> = [],
) {
  const counts = new Map<number, number>();
  for (const row of [...rows, ...extra]) {
    if (row.boardLocalId == null) continue;
    counts.set(row.boardLocalId, (counts.get(row.boardLocalId) || 0) + 1);
  }
  return boards
    .filter((board) => board.enabled && (counts.get(board.id) || 0) > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((board) => ({
      id: board.id,
      label: (board.alias || '').trim() || board.name,
      color: (board.color || '').trim() || SUMMARY_BADGE_GRAY,
      count: counts.get(board.id) || 0,
    }));
}

function summaryStatusBadges(
  rows: SummaryRow[],
  boardId: number,
  columns: BoardColumnConfig[],
  extra: Array<{ boardLocalId: number | null; statusKey: string }> = [],
) {
  const counts = new Map<string, number>();
  const add = (key: string) => {
    if (!key || !columns.some((column) => column.statusKey === key)) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  for (const row of rows) {
    if (row.boardLocalId !== boardId) continue;
    add(rowStatusKey(row, columns));
  }
  for (const row of extra) {
    if (row.boardLocalId !== boardId) continue;
    add(row.statusKey);
  }
  const seen = new Set<string>();
  const badges: Array<{ key: string; label: string; color: string; count: number }> = [];
  for (const column of columns) {
    if (seen.has(column.statusKey)) continue;
    const count = counts.get(column.statusKey) || 0;
    if (!count) continue;
    seen.add(column.statusKey);
    badges.push({
      key: column.statusKey,
      label: (column.alias || '').trim() || column.statusDisplay || column.columnName || column.statusKey,
      color: (column.color || '').trim() || SUMMARY_BADGE_GRAY,
      count,
    });
  }
  return badges;
}

function rowStatusKey(row: SummaryRow, columns: BoardColumnConfig[]): string {
  if (row.statusKey && columns.some((column) => column.statusKey === row.statusKey)) return row.statusKey;
  const match = columns.find(
    (column) =>
      column.statusDisplay === row.currentStatus ||
      column.alias === row.currentStatus ||
      column.columnName === row.currentStatus,
  );
  return match?.statusKey || '';
}

function BoardFilterBadge(props: {
  label: string;
  count: number;
  color: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-5 max-w-full items-center rounded-none border border-l-[3px] bg-white px-1.5 text-[10px] font-medium leading-none ${
        props.selected ? 'border-slate-600 text-black' : 'border-slate-300 text-slate-400'
      }`}
      style={{ borderLeftColor: props.color }}
      onClick={props.onToggle}
    >
      <span className="truncate">{props.label}</span>
      <span className="ml-1 shrink-0 tabular-nums">{props.count}</span>
    </button>
  );
}

function StatusFilterBadge(props: {
  label: string;
  count: number;
  color: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-5 max-w-full items-center gap-1 rounded border bg-white px-1.5 text-[10px] font-medium leading-none ${
        props.selected ? 'border-slate-600 text-black' : 'border-slate-300 text-slate-400'
      }`}
      onClick={props.onToggle}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: props.color }} />
      <span className="truncate">{props.label}</span>
      <span className="shrink-0 tabular-nums">{props.count}</span>
    </button>
  );
}

function personHit(person: Developer, value: string | null | undefined): boolean {
  const name = (value || '').trim().toLowerCase();
  if (!name) return false;
  return [person.displayName, person.login].some((item) => item.trim().toLowerCase() === name);
}

function personOnRow(row: SummaryRow, person: Developer): boolean {
  if ((row.touchedIds || []).includes(person.id)) return true;
  const keys = [person.displayName, person.login].map((item) => item.trim()).filter(Boolean);
  const names = [
    row.assignee,
    row.reviewer,
    row.qa,
    row.author,
    ...(row.assignees || []),
    ...(row.reviewers || []),
    ...(row.qas || []),
  ];
  return names.some((name) => keys.includes((name || '').trim()));
}

type CardKind = 'success' | 'personal' | 'indirect' | 'plan' | 'activity';

function hadActivity(row: SummaryRow): boolean {
  return row.activeInPeriod !== false;
}

function columnOf(row: SummaryRow, columns: BoardColumnConfig[]): BoardColumnConfig | undefined {
  return columns.find(
    (column) =>
      column.enabled &&
      column.statusKey === (row.statusKey || '') &&
      (row.boardLocalId == null || column.boardLocalId === row.boardLocalId),
  );
}

function isPlanFor(column: BoardColumnConfig | undefined, row: SummaryRow, person: Developer): boolean {
  if (!column) return false;
  if (person.role === 'qa' && column.duty === 'testing' && personHit(person, row.qa)) return true;
  if (person.role === 'developer' && column.duty === 'review' && personHit(person, row.reviewer)) return true;
  if (person.role === 'developer' && column.duty === 'development' && personHit(person, row.assignee)) return true;
  return false;
}

function standsWith(column: BoardColumnConfig, row: SummaryRow, person: Developer): boolean {
  if (column.ownerRole === 'developer') return personHit(person, row.assignee);
  if (column.ownerRole === 'qa') return personHit(person, row.qa);
  return false;
}

function cardKind(row: SummaryRow, person: Developer | null, columns: BoardColumnConfig[]): CardKind | null {
  const column = columnOf(row, columns);
  if (!person) return hadActivity(row) ? 'activity' : 'plan';
  if (column?.ownerRole && column.ownerRole === person.role && standsWith(column, row, person)) return 'success';
  if ((row.changedByIds || []).includes(person.id)) return 'personal';
  if (hadActivity(row) && personOnRow(row, person)) return 'indirect';
  if (!hadActivity(row) && isPlanFor(column, row, person)) return 'plan';
  return null;
}

function cardVisible(
  row: SummaryRow,
  person: Developer | null,
  columns: BoardColumnConfig[],
  people: Developer[],
  flags: { personal: boolean; indirect: boolean; plans: boolean; activity: boolean },
): boolean {
  if (!person) {
    if (hadActivity(row)) return flags.activity;
    return flags.plans && people.some((item) => isPlanFor(columnOf(row, columns), row, item));
  }
  const kind = cardKind(row, person, columns);
  if (kind === 'success') return true;
  if (kind === 'personal') return flags.personal;
  if (kind === 'indirect') return flags.indirect;
  if (kind === 'plan') return flags.plans;
  return false;
}
