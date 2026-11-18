import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { sourceStatusesOf, viewColumns } from '@shared/boardColumns';
import type { BoardColumnConfig, BoardMatrix, Developer, SavedBoard, TrackerIssue } from '@shared/types';
import { resolvePersonDisplayName } from '@shared/personDisplay';
import { issueRoleLabel, trackerUserRef, type IssueRole } from '@shared/rolePick';
import { trackerLastChange } from '@shared/issueChanges';
import { issueSearchParts, textHit } from '@shared/issueSearch';
import { renderMarkdown } from '../markdown';
import {
  PENDING_COLUMN,
  cellMissingBadges,
  formatDays,
  formatIssueClockTitle,
  issueIsBoardDone,
  issueTimeWarn,
} from '@shared/columnMeta';
import {
  IconActionButton,
  BookmarkToggleButton,
  MissingRoleMark,
  ClockBadge,
  PastSprintBadge,
  NoteClipboardButton,
  RefreshIcon,
  BellOffIcon,
  CopyIcon,
  CheckSquareIcon,
} from './Icons';
import IssuePeopleLines from './IssuePeopleLines';
import { RolePick } from './RolePick';
import { StoryPointsControl } from './StoryPointsControl';
import { StatusFlowButton } from './StatusFlowButton';
import { LoadBar } from './LoadBar';
import { EllipsisTitle, InstantTip } from './InstantTip';
import { EpicFilter, EpicMark, epicOptions } from './EpicFilter';
import { MarkdownSurface, type MarkdownHandle } from './MarkdownSurface';
import { QuickComment } from './QuickComment';
import { sortIssues, type ListSort } from './ListSort';
import {
  invalidateIssueStories,
  readIssueStory,
  useIssueStoryRevision,
  writeIssueStory,
} from '../issueStoryCache';

type Selection = {
  kind?: 'issues' | 'todos';
  developerId: number | null;
  developerName: string;
  statusKey: string | null;
  issues: TrackerIssue[];
} | null;

type Props = {
  width: number;
  selection: Selection;
  columns: BoardColumnConfig[];
  groupName?: string;
  people?: Developer[];
  boards?: SavedBoard[];
  issueNotes: Record<string, string>;
  issueBookmarks: Record<string, boolean>;
  issueNoteUpdatedAt?: Record<string, string>;
  issueBookmarkCreatedAt?: Record<string, string>;
  currentSprintId?: number | null;
  doneStatusKeys?: ReadonlySet<string>;
  finalKeys?: ReadonlySet<string> | null;
  readOnly: boolean;
  onClose: () => void;
  onIssueHover?: (issueKey: string | null) => void;
  onNoteChange: (issueKey: string, note: string) => Promise<void>;
  onBookmarkToggle: (issueKey: string) => Promise<void>;
  onIssueRefreshed: (matrix: BoardMatrix) => void;
  onError: (msg: string | null) => void;
  embedded?: boolean;
  listSort: ListSort;
  onShowAll?: () => void;
  onlyWithNote?: boolean;
  onlyWithBookmark?: boolean;
  onlyMissingPoints?: boolean;
  onlyMissingReviewer?: boolean;
  onlyMissingQa?: boolean;
  onlyTimeWarn?: boolean;
  onlyOtherSprint?: boolean;
  onlyWithChanges?: boolean;
  changeByKey?: ReadonlyMap<string, { text: string; at: string; seen?: boolean }>;
  onDismissChange?: (issueKey: string) => void;
  expandedKeys?: ReadonlySet<string>;
  onToggleExpand?: (issueKey: string) => void;
  /** Tasks in the selected cell, including done ones hidden by the list filter. */
  cellIssues?: TrackerIssue[];
  /** Same cell before the left-panel filters. */
  unfilteredCellIssues?: TrackerIssue[];
  showDone?: boolean;
  onEnableShowDone?: () => void;
  onResetFilters?: () => void;
};

function RoleName(props: {
  role: IssueRole;
  name?: string | null;
  people: Developer[];
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  onChange: (person: Developer | null) => void;
}) {
  const value = (props.name || '').trim();
  const label = issueRoleLabel(props.role);
  return (
    <RolePick
      role={props.role}
      current={value}
      people={props.people}
      disabled={props.disabled}
      busy={props.busy}
      className={`inline-flex w-fit max-w-full min-w-0 justify-self-start ${props.className || ''}`}
      onChange={props.onChange}
    >
      {value ? (
        <InstantTip text={label} className="inline-flex w-fit max-w-full min-w-0">
          <span className="truncate">{value}</span>
        </InstantTip>
      ) : (
        <span className="truncate text-red-300 line-through">{label}</span>
      )}
    </RolePick>
  );
}

function ChangeBadge(props: {
  text: string;
  at: string;
  actor?: string | null;
  rawActor?: string | null;
  seen?: boolean;
  onDismiss: () => void;
  onOpen?: () => void;
  expanded?: boolean;
  inline?: boolean;
}) {
  const seen = Boolean(props.seen);
  const actor = (props.actor || '').trim();
  const raw = (props.rawActor || '').trim();
  let label = props.text;
  for (const name of [actor, raw]) {
    const suffix = name ? ` · ${name}` : '';
    if (suffix && label.endsWith(suffix)) label = label.slice(0, -suffix.length);
  }
  return (
    <div
      className={`flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px] ${
        props.inline ? 'relative flex-1' : 'relative max-w-[70%] flex-1'
      } ${
        seen
          ? 'border border-[#e7edf2] bg-white text-slate-400'
          : 'cursor-pointer bg-amber-100 text-amber-950'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        if (seen) return;
        if (props.expanded) props.onDismiss();
        else props.onOpen?.();
      }}
    >
      {!seen && (
        <InstantTip text="Просмотрено" place="top" className="inline-flex shrink-0">
          <button
            type="button"
            className="inline-flex h-3.5 items-center border-r border-amber-300 pr-1 text-amber-950 hover:text-red-600"
            onClick={(event) => {
              event.stopPropagation();
              props.onDismiss();
            }}
          >
            <BellOffIcon className="h-3 w-3" />
          </button>
        </InstantTip>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {actor && <span className="ml-auto max-w-[40%] shrink-0 truncate">{actor}</span>}
      <span className={`shrink-0 tabular-nums ${seen ? 'text-slate-400' : 'text-amber-900/70'}`}>
        {formatChangeAt(props.at)}
      </span>
    </div>
  );
}

export default function IssuePanel(props: Props) {
  const { selection, columns, readOnly, width } = props;
  const viewedColumns = useMemo(() => viewColumns(columns), [columns]);
  const colorByStatus = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const column of viewedColumns) {
      colors[column.statusKey] = column.color;
      for (const status of sourceStatusesOf(column)) colors[status.key] = column.color;
    }
    return colors;
  }, [viewedColumns]);
  const colByStatus = useMemo(() => {
    const map: Record<string, BoardColumnConfig> = {};
    for (const column of viewedColumns) {
      map[column.statusKey] = column;
      for (const status of sourceStatusesOf(column)) map[status.key] = column;
    }
    return map;
  }, [viewedColumns]);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const noteSurface = useRef<MarkdownHandle>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState<number[]>([]);
  const [people, setPeople] = useState<Developer[]>([]);
  const [links, setLinks] = useState<Record<string, number[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [epicKey, setEpicKey] = useState<string | null>(null);

  useEffect(() => {
    setMenuKey(null);
    setMenuPos(null);
    setDraft('');
    setLinkDraft([]);
    setSearch('');
    setEpicKey(null);
  }, [selection?.developerId, selection?.statusKey]);

  useEffect(() => {
    void window.api.listDevelopers().then(setPeople).catch(() => undefined);
    void window.api.listIssueNoteLinks().then(setLinks).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onDoc = () => {
      setMenuKey(null);
      setMenuPos(null);
    };
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, []);

  const listedIssues = useMemo(() => {
    if (!selection) return [];
    const q = search.trim().toLowerCase();
    let matched = selection.issues;
    if (props.onlyWithNote) {
      matched = matched.filter((issue) => Boolean(props.issueNotes[issue.key]?.trim()));
    }
    if (props.onlyWithBookmark) {
      matched = matched.filter((issue) => Boolean(props.issueBookmarks?.[issue.key]));
    }
    if (props.onlyMissingPoints) {
      matched = matched.filter((issue) => issue.storyPoints === null);
    }
    if (props.onlyMissingReviewer) {
      matched = matched.filter((issue) => !issue.reviewerDisplay?.trim());
    }
    if (props.onlyMissingQa) {
      matched = matched.filter((issue) => !issue.qaDisplay?.trim());
    }
    if (props.onlyTimeWarn) {
      matched = matched.filter(
        (issue) => !issueIsBoardDone(issue, props.doneStatusKeys, props.finalKeys) && issueTimeWarn(issue) != null,
      );
    }
    if (props.onlyOtherSprint) {
      matched = matched.filter(
        (issue) =>
          !issueIsBoardDone(issue, props.doneStatusKeys, props.finalKeys) &&
          issue.sprintId != null &&
          issue.sprintId !== props.currentSprintId,
      );
    }
    if (props.onlyWithChanges) {
      matched = matched.filter((issue) => props.changeByKey?.get(issue.key)?.seen === false);
    }
    if (q) {
      matched = matched.filter((issue) =>
        textHit(q, issueSearchParts(issue, props.people?.length ? props.people : people, props.boards || [])),
      );
    }
    return matched;
  }, [
    selection,
    search,
    props.onlyWithNote,
    props.onlyWithBookmark,
    props.onlyMissingPoints,
    props.onlyMissingReviewer,
    props.onlyMissingQa,
    props.onlyTimeWarn,
    props.onlyOtherSprint,
    props.onlyWithChanges,
    props.changeByKey,
    props.doneStatusKeys,
    props.currentSprintId,
    props.issueNotes,
    props.issueBookmarks,
    props.people,
    props.boards,
    people,
  ]);
  const epicChoices = useMemo(() => epicOptions(listedIssues), [listedIssues]);
  useEffect(() => {
    if (epicKey && !epicChoices.some((item) => item.key === epicKey)) setEpicKey(null);
  }, [epicKey, epicChoices]);
  const filteredIssues = useMemo(() => {
    const matched = epicKey ? listedIssues.filter((issue) => issue.epicKey === epicKey) : listedIssues;
    return sortIssues(matched, props.listSort, (issue) => issue.createdAt);
  }, [listedIssues, epicKey, props.listSort]);
  const [paintCount, setPaintCount] = useState(40);
  const paintKey = `${selection?.developerId ?? ''}|${selection?.statusKey ?? ''}|${filteredIssues.length}|${search}|${epicKey ?? ''}|${props.listSort ?? ''}`;
  useEffect(() => {
    setPaintCount(40);
  }, [paintKey]);
  useEffect(() => {
    if (paintCount >= filteredIssues.length) return;
    const id = window.setTimeout(() => {
      setPaintCount((count) => Math.min(filteredIssues.length, count + 60));
    }, 0);
    return () => window.clearTimeout(id);
  }, [paintCount, paintKey, filteredIssues.length]);
  const paintedIssues = filteredIssues.slice(0, paintCount);

  const frameClass = props.embedded
    ? 'flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white'
    : 'flex min-h-0 max-h-full w-full flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white';

  if (!selection) {
    return (
      <aside
        style={props.embedded ? undefined : { width }}
        className={
          props.embedded
            ? 'flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-hidden bg-white p-4 text-center text-xs text-slate-500'
            : 'flex min-h-0 max-h-full w-full flex-1 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center text-xs text-slate-500'
        }
      >
        <p>Кликните по цифре в таблице, чтобы увидеть задачи.</p>
        {props.onShowAll && (
          <button
            type="button"
            className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-sky-800 hover:bg-sky-50"
            onClick={props.onShowAll}
          >
            Все задачи
          </button>
        )}
      </aside>
    );
  }

  const cellIssues = props.cellIssues ?? selection.issues;
  const unfilteredCellIssues = props.unfilteredCellIssues ?? cellIssues;
  const hiddenByListFilters = selection.issues.length > 0 && filteredIssues.length === 0;
  const hiddenByLeftFilters =
    filteredIssues.length === 0 && unfilteredCellIssues.length > cellIssues.length;
  const hiddenByFilters = hiddenByListFilters || hiddenByLeftFilters;
  const onlyDoneHidden =
    !hiddenByFilters &&
    filteredIssues.length === 0 &&
    props.showDone === false &&
    cellIssues.length > 0 &&
    cellIssues.every((issue) => issueIsBoardDone(issue, props.doneStatusKeys, props.finalKeys));
  const listNotice = onlyDoneHidden || hiddenByFilters || selection.issues.length === 0;

  async function saveNote(issueKey: string) {
    const text = (noteSurface.current?.read() ?? draft).replace(/\s+$/, '');
    await props.onNoteChange(issueKey, text);
    const saved = await window.api.setIssueNoteLinks(issueKey, linkDraft);
    setLinks((prev) => ({ ...prev, [issueKey]: saved }));
    setMenuKey(null);
    setMenuPos(null);
  }

  async function clearNote(issueKey: string) {
    setDraft('');
    setLinkDraft([]);
    await props.onNoteChange(issueKey, '');
    const saved = await window.api.setIssueNoteLinks(issueKey, []);
    setLinks((prev) => ({ ...prev, [issueKey]: saved }));
    setMenuKey(null);
    setMenuPos(null);
  }

  async function assignPoints(issueKey: string, points: number | null) {
    if (props.readOnly) return;
    props.onError(null);
    const matrix = await window.api.setStoryPoints(issueKey, points);
    invalidateIssueStories(issueKey);
    props.onIssueRefreshed(matrix);
  }

  async function assignRole(issueKey: string, role: IssueRole, person: Developer | null) {
    if (props.readOnly) return;
    const login = person ? trackerUserRef(person) : null;
    if (person && !login) {
      props.onError('У участника нет логина Трекера.');
      return;
    }
    setBusyKey(issueKey);
    props.onError(null);
    try {
      const matrix = await window.api.setIssueRole(issueKey, role, login);
      invalidateIssueStories(issueKey);
      props.onIssueRefreshed(matrix);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshFromTracker(issueKey: string) {
    setBusyKey(issueKey);
    props.onError(null);
    try {
      const matrix = await window.api.refreshIssue(issueKey);
      invalidateIssueStories(issueKey);
      props.onIssueRefreshed(matrix);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <aside style={props.embedded ? undefined : { width }} className={frameClass}>
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-100 px-2 py-1.5">
        <button
          type="button"
          title="Закрыть"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          onClick={props.onClose}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-sm text-slate-900">{selection.developerName}</span>
          <span className="text-[11px] text-slate-500">
            {' · '}
            {selection.statusKey == null
              ? 'TOTAL'
              : selection.statusKey === PENDING_COLUMN
                ? 'FLOW'
                : selection.statusKey.startsWith('group:')
                  ? props.groupName || selection.statusKey
                  : columns.find((c) => c.statusKey === selection.statusKey)?.alias ||
                    selection.statusKey}
            {' · '}
          </span>
          <span className="text-[11px] font-semibold text-slate-900">{filteredIssues.length}</span>
        </div>
        <div className="flex h-6 min-w-0 max-w-[14rem] items-center">
          <EpicFilter options={epicChoices} selected={epicKey} onSelect={setEpicKey} />
        </div>
        <input
          type="search"
          className="h-6 w-[30%] shrink-0 rounded border border-slate-300 bg-white px-2 text-xs"
          placeholder="Поиск по ключу"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div
        className={
          listNotice
            ? 'flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs'
            : 'min-h-0 flex-1 space-y-1 overflow-auto p-2 text-xs'
        }
      >
        {listNotice && selection.issues.length === 0 && !onlyDoneHidden && !hiddenByFilters && (
          <p className="text-slate-500">В этой ячейке нет задач</p>
        )}
        {onlyDoneHidden && (
          <div className="flex max-w-sm flex-col items-center gap-2 text-slate-600">
            <p>В ячейке только готовые задачи. Включите их отображение.</p>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-sky-800 hover:bg-sky-50"
              onClick={props.onEnableShowDone}
            >
              Показать готовые
            </button>
          </div>
        )}
        {hiddenByFilters && (
          <div className="flex max-w-sm flex-col items-center gap-2 text-slate-600">
            <p>Задачи скрыты выбранными фильтрами.</p>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-sky-800 hover:bg-sky-50"
              onClick={() => {
                setSearch('');
                setEpicKey(null);
                props.onResetFilters?.();
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        )}
        {!listNotice && paintedIssues.map((issue) => {
          const color = colorByStatus[issue.statusKey] || '#64748b';
          const col = colByStatus[issue.statusKey];
          const note = props.issueNotes[issue.key] || '';
          const hasNote = Boolean(note.trim());
          const bookmarked = Boolean(props.issueBookmarks?.[issue.key]);
          const noteUpdatedAt = props.issueNoteUpdatedAt?.[issue.key];
          const bookmarkCreatedAt = props.issueBookmarkCreatedAt?.[issue.key];
          const badges = cellMissingBadges([issue], col || {
            alias: '',
            statusKey: issue.statusKey,
            statusDisplay: issue.statusDisplay,
          });
          const done = issueIsBoardDone(issue, props.doneStatusKeys, props.finalKeys);
          const timeWarn = done ? null : issueTimeWarn(issue);
          const pastSprint =
            !done && issue.sprintId != null && issue.sprintId !== props.currentSprintId;
          const isMenuOpen = menuKey === issue.key;
          const openNote = (e: MouseEvent<Element>) => {
            e.stopPropagation();
            if (isMenuOpen) {
              const text = (noteSurface.current?.read() ?? draft).replace(/\s+$/, '');
              if (!text.trim()) {
                setMenuKey(null);
                setMenuPos(null);
                return;
              }
              void saveNote(issue.key);
              return;
            }
            setDraft(note);
            setLinkDraft(links[issue.key] || []);
            setMenuKey(issue.key);
            const r = e.currentTarget.getBoundingClientRect();
            setMenuPos({
              top: r.bottom + 4,
              left: Math.max(8, r.right - 420),
            });
          };
          const marks = (
            <>
              {badges.missingTester && (
                <MissingRoleMark kind="tester" tone={badges.testerTone} title="Нет тестировщика" />
              )}
              {badges.missingReviewer && (
                <MissingRoleMark kind="reviewer" tone={badges.reviewerTone} title="Нет ревьюера" />
              )}
              {timeWarn && <ClockBadge size="sm" title={formatIssueClockTitle(issue, timeWarn)} />}
              {pastSprint && (
                <PastSprintBadge
                  size="sm"
                  title={
                    issue.sprintName
                      ? `Задача из прошлого спринта: ${issue.sprintName}`
                      : 'Задача из прошлого спринта'
                  }
                />
              )}
            </>
          );
          const refreshButton = !readOnly && (
            <IconActionButton
              tone="muted"
              size="sm"
              title="Обновить из Трекера"
              disabled={busyKey === issue.key}
              onClick={(e) => {
                e.stopPropagation();
                void refreshFromTracker(issue.key);
              }}
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </IconActionButton>
          );
          const traitButtons = !readOnly && (
            <>
              <BookmarkToggleButton
                active={bookmarked}
                title={
                  bookmarked && bookmarkCreatedAt
                    ? `Добавлено в закладки ${new Date(bookmarkCreatedAt).toLocaleString('ru-RU')}`
                    : undefined
                }
                onClick={(e) => {
                  e.stopPropagation();
                  void props.onBookmarkToggle(issue.key);
                }}
              />
              <NoteClipboardButton hasNote={hasNote} onClick={openNote} />
            </>
          );
          const expanded = props.expandedKeys?.has(issue.key) ?? false;
          const toggleExpand = (e: MouseEvent<HTMLElement>) => {
            const target = e.target as HTMLElement;
            if (target.closest('a,button,textarea,input')) return;
            props.onToggleExpand?.(issue.key);
          };
          const notePopup = isMenuOpen && menuPos && (
            <NoteEditorPopup
              pos={menuPos}
              surfaceRef={noteSurface}
              draftKey={issue.key}
              draft={draft}
              people={people}
              linkedIds={linkDraft}
              onDraftChange={setDraft}
              onLinkedChange={setLinkDraft}
              onSave={() => void saveNote(issue.key)}
              onClear={() => void clearNote(issue.key)}
              onClose={() => {
                setMenuKey(null);
                setMenuPos(null);
              }}
            />
          );

          const linkedNames = (links[issue.key] || [])
            .map((id) => people.find((person) => person.id === id)?.displayName)
            .filter((name): name is string => Boolean(name));
          const change = props.changeByKey?.get(issue.key);
          const freshChange = change && change.seen === false ? change : null;
          const shownChange = change || trackerLastChange(issue);
          const acknowledge = () => {
            if (!freshChange) return;
            props.onDismissChange?.(issue.key);
          };
          const openFromBadge = () => {
            if (!expanded) props.onToggleExpand?.(issue.key);
          };
          const header = (
            <div
              className="flex cursor-pointer items-center gap-1.5 bg-slate-100 px-2 py-1 hover:bg-slate-200"
              onClick={toggleExpand}
            >
              <EpicMark
                epicKey={issue.epicKey}
                epicDisplay={issue.epicDisplay}
                onPick={(key) => setEpicKey(key)}
              />
              <StatusFlowButton
                issueKey={issue.key}
                statusKey={issue.statusKey}
                color={color}
                name={col?.statusDisplay || issue.statusDisplay || col?.alias || issue.statusKey}
                disabled={readOnly}
                colorFor={(key) => colorByStatus[key] || '#94a3b8'}
                onApplied={(matrix) => {
                  invalidateIssueStories(issue.key);
                  props.onIssueRefreshed(matrix);
                }}
                onError={props.onError}
              />
              <span className="inline-flex shrink-0 items-baseline">
                <a
                  href={issue.url}
                  className="font-medium text-sky-700 hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void window.api.openExternal(issue.url);
                  }}
                >
                  {issue.key}
                </a>
                <span className="text-black">:</span>
              </span>
              <EllipsisTitle className="min-w-0 truncate text-black" text={issue.summary} />
              <CopyIssueButton issueKey={issue.key} url={issue.url} summary={issue.summary} />
              <span className="min-w-0 flex-1" />
              <div className="flex shrink-0 items-center gap-1">
                {marks}
                <StoryPointsControl
                  value={issue.storyPoints}
                  disabled={readOnly}
                  onApply={(points) => assignPoints(issue.key, points)}
                  onError={props.onError}
                />
                {traitButtons}
                {refreshButton}
              </div>
            </div>
          );
          if (!expanded) {
            return (
              <div
                key={issue.key}
                className="overflow-hidden rounded border border-slate-200"
                onMouseEnter={() => props.onIssueHover?.(issue.key)}
                onMouseLeave={() => props.onIssueHover?.(null)}
              >
                {header}
                <div className="mt-0.5 grid grid-cols-2 gap-2 px-2 pb-1 text-[10px] text-slate-500">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1">
                    <RoleName
                      role="assignee"
                      name={issue.assigneeDisplay}
                      people={people}
                      disabled={props.readOnly}
                      busy={busyKey === issue.key}
                      onChange={(person) => void assignRole(issue.key, 'assignee', person)}
                    />
                    <span className="text-slate-300" aria-hidden>·</span>
                    <RoleName
                      role="reviewer"
                      name={issue.reviewerDisplay}
                      people={people}
                      disabled={props.readOnly}
                      busy={busyKey === issue.key}
                      onChange={(person) => void assignRole(issue.key, 'reviewer', person)}
                    />
                    <span className="text-slate-300" aria-hidden>·</span>
                    <RoleName
                      role="qa"
                      name={issue.qaDisplay}
                      people={people}
                      disabled={props.readOnly}
                      busy={busyKey === issue.key}
                      onChange={(person) => void assignRole(issue.key, 'qa', person)}
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5">
                    {shownChange ? (
                      <ChangeBadge
                        inline
                        text={shownChange.text}
                        at={shownChange.at}
                        actor={resolvePersonDisplayName(issue.updatedByMatchKeys, issue.updatedByDisplay, people) || ''}
                        rawActor={issue.updatedByDisplay}
                        seen={!freshChange}
                        onDismiss={acknowledge}
                        onOpen={openFromBadge}
                      />
                    ) : (
                      <span className="min-w-0 flex-1" />
                    )}
                    <span className="ml-auto shrink-0">{createdLabel(issue)}</span>
                  </div>
                </div>
                {notePopup}
              </div>
            );
          }

          return (
            <div
              key={issue.key}
              className="overflow-hidden rounded-md border border-slate-200"
              onMouseEnter={() => props.onIssueHover?.(issue.key)}
              onMouseLeave={() => props.onIssueHover?.(null)}
            >
              {header}
              <div className="px-2 py-1.5">
                <div className="flex items-stretch gap-1.5">
                  <div className="w-44 shrink-0 leading-snug">
                    <div className="text-[10px] text-slate-500">Создано: {createdLabel(issue) || '—'}</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {col?.statusDisplay || issue.statusDisplay}
                      {issue.daysInStatus != null ? ` · ${formatDays(issue.daysInStatus)}` : ''}
                    </div>
                    <IssuePeopleLines
                      issue={issue}
                      people={people}
                      disabled={props.readOnly}
                      busy={busyKey === issue.key}
                      onChange={(role, person) => void assignRole(issue.key, role, person)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {shownChange && (
                      <ChangeBadge
                        inline
                        text={shownChange.text}
                        at={shownChange.at}
                        actor={resolvePersonDisplayName(issue.updatedByMatchKeys, issue.updatedByDisplay, people) || ''}
                        rawActor={issue.updatedByDisplay}
                        seen={!freshChange}
                        expanded
                        onDismiss={acknowledge}
                        onOpen={openFromBadge}
                      />
                    )}
                    {(hasNote || linkedNames.length > 0) && (
                      <div className={shownChange ? 'mt-1' : ''}>
                        {hasNote && (
                          <div
                            className="markdown-body text-xs leading-snug text-red-800"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(note) }}
                          />
                        )}
                        {linkedNames.length > 0 && (
                          <div className="mt-0.5 text-[10px] text-slate-500">{linkedNames.join(', ')}</div>
                        )}
                        {hasNote && noteUpdatedAt && (
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            Дата примечания {new Date(noteUpdatedAt).toLocaleString('ru-RU')}
                          </div>
                        )}
                      </div>
                    )}
                    <IssueStory issueKey={issue.key} readOnly={props.readOnly} />
                  </div>
                </div>
              </div>
              {notePopup}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function IssueStory(props: { issueKey: string; readOnly?: boolean }) {
  const storyRev = useIssueStoryRevision();
  const [story, setStory] = useState(() => readIssueStory(props.issueKey));
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState<'description' | 'comment' | null>(null);
  useEffect(() => {
    setPart(null);
    setFailed(false);
    setStory(readIssueStory(props.issueKey));
  }, [props.issueKey]);
  useEffect(() => {
    setStory(readIssueStory(props.issueKey));
  }, [props.issueKey, storyRev]);
  async function toggle(next: 'description' | 'comment') {
    if (part === next) {
      setPart(null);
      return;
    }
    setPart(next);
    const cached = readIssueStory(props.issueKey);
    if (cached) {
      setStory(cached);
      setFailed(false);
      return;
    }
    if (story || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const loaded = await window.api.getIssueStory(props.issueKey);
      writeIssueStory(props.issueKey, loaded);
      setStory(loaded);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const buttonClass = (active: boolean) =>
    `rounded border px-1.5 py-0.5 text-[10px] ${active ? 'border-slate-400 bg-white' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'}`;
  return (
    <div className="mt-2 text-[11px] leading-snug text-slate-700">
      <div className="flex justify-center gap-1">
        <button type="button" className={buttonClass(part === 'description')} onClick={() => void toggle('description')}>
          Описание
        </button>
        <button type="button" className={buttonClass(part === 'comment')} onClick={() => void toggle('comment')}>
          Последний комментарий
        </button>
      </div>
      {busy && part && (
        <div className="mt-2">
          <LoadBar label={part === 'description' ? 'Загрузка описания…' : 'Загрузка последнего комментария…'} />
        </div>
      )}
      {failed && part && <div className="mt-1 text-center text-slate-400">Не загрузилось</div>}
      {story && part === 'description' && (
        <div className="mt-2">
          {story.description ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(story.description) }} />
          ) : (
            <div className="text-slate-400">Нет описания</div>
          )}
        </div>
      )}
      {story && part === 'comment' && (
        <div className="mt-2 overflow-hidden rounded border border-amber-200/80 bg-[#fffbeb] px-2 py-1.5">
          {story.commentText ? (
            <>
              {(story.commentAuthor || story.commentAt) && (
                <div className="text-[10px] text-slate-500">
                  {[story.commentAuthor, story.commentAt ? new Date(story.commentAt).toLocaleString('ru-RU') : '']
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
              {story.commentUrl && (
                <a
                  href={story.commentUrl}
                  className="text-[10px] text-sky-700 hover:underline"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void window.api.openExternal(story.commentUrl);
                  }}
                >
                  Открыть в Трекере
                </a>
              )}
              <div className="markdown-body mt-0.5" dangerouslySetInnerHTML={{ __html: renderMarkdown(story.commentText) }} />
            </>
          ) : (
            <div className="text-slate-400">Нет комментария</div>
          )}
          {!props.readOnly && <QuickComment issueKey={props.issueKey} />}
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function CopyIssueButton(props: { issueKey: string; url: string; summary: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      title="Скопировать номер и название"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white ${
        copied ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        void copyIssueLink(props.issueKey, props.url, props.summary).then((ok) => {
          if (!ok) return;
          setCopied(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 900);
        });
      }}
    >
      {copied ? <CheckSquareIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
    </button>
  );
}

async function copyIssueLink(issueKey: string, url: string, summary: string): Promise<boolean> {
  const plain = `${issueKey}: ${summary}`;
  const html = `<a href="${url.replace(/"/g, '&quot;')}">${escapeHtml(issueKey)}</a>: ${escapeHtml(summary)}`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      return false;
    }
  }
}

function formatChangeAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.toLocaleDateString('ru-RU')} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createdLabel(issue: TrackerIssue): string {
  if (!issue.createdAt) return '';
  const date = new Date(issue.createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU');
}

export function NoteEditorPopup(props: {
  pos: { top: number; left: number };
  draft: string;
  draftKey?: string;
  surfaceRef?: Ref<MarkdownHandle>;
  people?: Developer[];
  linkedIds?: number[];
  onDraftChange: (v: string) => void;
  onLinkedChange?: (ids: number[]) => void;
  onSave: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(props.pos);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = props.pos.left;
    let top = props.pos.top;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, props.pos.top - rect.height - 8);
    }
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [props.pos]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] w-[420px] max-w-[calc(100vw-16px)] rounded-lg border border-slate-300 bg-white p-2 shadow-xl"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1 text-[11px] font-medium text-slate-700">Примечание</div>
      <MarkdownSurface
        ref={props.surfaceRef}
        draft={props.draft}
        onDraft={props.onDraftChange}
        resetKey={props.draftKey}
        minRows={4}
        placeholder="Примечание к задаче"
      />
      {props.people && props.onLinkedChange && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {(props.linkedIds || []).map((id) => {
            const person = props.people?.find((item) => item.id === id);
            if (!person) return null;
            return (
              <button
                key={id}
                type="button"
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"
                onClick={() =>
                  props.onLinkedChange?.((props.linkedIds || []).filter((item) => item !== id))
                }
              >
                {person.displayName} ×
              </button>
            );
          })}
          <select
            className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-600"
            value=""
            aria-label="Связать с участником"
            onChange={(e) => {
              const id = Number(e.target.value);
              if (!id || (props.linkedIds || []).includes(id)) return;
              props.onLinkedChange?.([...(props.linkedIds || []), id]);
            }}
          >
            <option value="">+ участник</option>
            {props.people
              .filter((person) => !(props.linkedIds || []).includes(person.id))
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
          onClick={props.onClear}
        >
          Очистить
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2.5 py-1 text-[11px]"
          onClick={props.onClose}
        >
          Отмена
        </button>
        <button
          type="button"
          className="rounded bg-slate-900 px-2.5 py-1 text-[11px] text-white"
          onClick={props.onSave}
        >
          Сохранить
        </button>
      </div>
    </div>,
    document.body,
  );
}

