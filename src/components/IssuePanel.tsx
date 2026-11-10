import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BoardColumnConfig, BoardMatrix, Developer, SavedBoard, TrackerIssue } from '@shared/types';
import { resolvePersonDisplayName } from '@shared/personDisplay';
import { trackerLastChange } from '@shared/issueChanges';
import { issueSearchParts, textHit } from '@shared/issueSearch';
import { renderMarkdown } from '../markdown';
import {
  PENDING_COLUMN,
  cellMissingBadges,
  formatDays,
  formatIssueClockTitle,
  issueIsDone,
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
import { LoadBar } from './LoadBar';
import { InstantTip } from './InstantTip';
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
  people?: Developer[];
  boards?: SavedBoard[];
  issueNotes: Record<string, string>;
  issueBookmarks: Record<string, boolean>;
  issueNoteUpdatedAt?: Record<string, string>;
  issueBookmarkCreatedAt?: Record<string, string>;
  currentSprintId?: number | null;
  doneStatusKeys?: ReadonlySet<string>;
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

function RoleName(props: { role: string; name?: string | null; className?: string }) {
  const value = (props.name || '').trim();
  if (!value) {
    return <span className="min-w-0 justify-self-start truncate text-red-300 line-through">{props.role}</span>;
  }
  return (
    <InstantTip
      text={props.role}
      className={`inline-flex w-fit max-w-full min-w-0 cursor-help justify-self-start ${props.className || ''}`}
    >
      <span className="truncate" style={{ cursor: 'help' }}>
        {value}
      </span>
    </InstantTip>
  );
}

function ChangeBadge(props: {
  text: string;
  at: string;
  actor?: string | null;
  rawActor?: string | null;
  seen?: boolean;
  onDismiss: () => void;
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
      title={seen ? undefined : 'Просмотрено'}
      onClick={(event) => {
        event.stopPropagation();
        if (!seen) props.onDismiss();
      }}
    >
      <BellOffIcon className="h-3 w-3 shrink-0" />
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
  const colorByStatus = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.statusKey, c.color])),
    [columns],
  );
  const colByStatus = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.statusKey, c])),
    [columns],
  );
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState<number[]>([]);
  const [people, setPeople] = useState<Developer[]>([]);
  const [links, setLinks] = useState<Record<string, number[]>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setMenuKey(null);
    setMenuPos(null);
    setDraft('');
    setLinkDraft([]);
    setSearch('');
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

  const filteredIssues = useMemo(() => {
    if (!selection) return [];
    const q = search.trim().toLowerCase();
    let matched = selection.issues;
    if (props.onlyWithNote) {
      matched = matched.filter((issue) => Boolean(props.issueNotes[issue.key]?.trim()));
    }
    if (props.onlyWithBookmark) {
      matched = matched.filter((issue) => Boolean(props.issueBookmarks?.[issue.key]));
    }
    if (props.onlyMissingReviewer) {
      matched = matched.filter((issue) => !issue.reviewerDisplay?.trim());
    }
    if (props.onlyMissingQa) {
      matched = matched.filter((issue) => !issue.qaDisplay?.trim());
    }
    if (props.onlyTimeWarn) {
      matched = matched.filter(
        (issue) => !issueIsDone(issue, props.doneStatusKeys) && issueTimeWarn(issue) != null,
      );
    }
    if (props.onlyOtherSprint) {
      matched = matched.filter(
        (issue) =>
          !issueIsDone(issue, props.doneStatusKeys) &&
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
    return sortIssues(matched, props.listSort, (issue) => issue.createdAt);
  }, [
    selection,
    search,
    props.listSort,
    props.onlyWithNote,
    props.onlyWithBookmark,
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
  const [paintCount, setPaintCount] = useState(40);
  const paintKey = `${selection?.developerId ?? ''}|${selection?.statusKey ?? ''}|${filteredIssues.length}|${search}|${props.listSort ?? ''}`;
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
    cellIssues.every((issue) => issueIsDone(issue, props.doneStatusKeys));
  const listNotice = onlyDoneHidden || hiddenByFilters || selection.issues.length === 0;

  async function saveNote(issueKey: string) {
    await props.onNoteChange(issueKey, draft);
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
              ? 'Total'
              : selection.statusKey === PENDING_COLUMN
                ? 'Pending'
                : columns.find((c) => c.statusKey === selection.statusKey)?.alias ||
                  selection.statusKey}
            {' · '}
          </span>
          <span className="text-[11px] font-semibold text-slate-900">{filteredIssues.length}</span>
        </div>
        <input
          type="search"
          className="w-1/2 shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
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
          const done = issueIsDone(issue, props.doneStatusKeys);
          const timeWarn = done ? null : issueTimeWarn(issue);
          const pastSprint =
            !done && issue.sprintId != null && issue.sprintId !== props.currentSprintId;
          const isMenuOpen = menuKey === issue.key;
          const openNote = (e: MouseEvent<Element>) => {
            e.stopPropagation();
            if (isMenuOpen) {
              setMenuKey(null);
              setMenuPos(null);
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
            invalidateIssueStories(issue.key);
            props.onDismissChange?.(issue.key);
            if (!expanded) props.onToggleExpand?.(issue.key);
          };
          const header = (
            <div
              className="flex cursor-pointer items-center gap-1.5 bg-slate-100 px-2 py-1 hover:bg-slate-200"
              onClick={toggleExpand}
            >
              <StatusMark color={color} name={issue.statusDisplay || col?.alias || issue.statusKey} />
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
              <span className="min-w-0 truncate text-black" title={issue.summary}>
                {issue.summary}
              </span>
              <CopyIssueButton issueKey={issue.key} url={issue.url} summary={issue.summary} />
              <span className="min-w-0 flex-1" />
              <div className="flex shrink-0 items-center gap-px">
                {marks}
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
                    <RoleName role="Исполнитель" name={issue.assigneeDisplay} />
                    <span className="text-slate-300" aria-hidden>·</span>
                    <RoleName role="Ревьюер" name={issue.reviewerDisplay} />
                    <span className="text-slate-300" aria-hidden>·</span>
                    <RoleName role="Тестировщик" name={issue.qaDisplay} />
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
                      {issue.statusDisplay}
                      {issue.daysInStatus != null ? ` · ${formatDays(issue.daysInStatus)}` : ''}
                    </div>
                    <IssuePeopleLines issue={issue} />
                    <div className="mt-1 min-w-0">
                      <div className="whitespace-pre-wrap leading-snug text-red-800">
                        {hasNote ? note : <span className="text-slate-300">&nbsp;</span>}
                      </div>
                      {linkedNames.length > 0 && (
                        <div className="mt-0.5 text-[10px] text-slate-500">{linkedNames.join(', ')}</div>
                      )}
                      {hasNote && noteUpdatedAt && (
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          Дата примечания {new Date(noteUpdatedAt).toLocaleString('ru-RU')}
                        </div>
                      )}
                    </div>
                  </div>
                  <IssueStory issueKey={issue.key} />
                </div>
                {shownChange && (
                  <div className="mt-1">
                    <ChangeBadge
                      inline
                      text={shownChange.text}
                      at={shownChange.at}
                      actor={resolvePersonDisplayName(issue.updatedByMatchKeys, issue.updatedByDisplay, people) || ''}
                      rawActor={issue.updatedByDisplay}
                      seen={!freshChange}
                      onDismiss={acknowledge}
                    />
                  </div>
                )}
              </div>
              {notePopup}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function IssueStory(props: { issueKey: string }) {
  const storyRev = useIssueStoryRevision();
  const [story, setStory] = useState(() => readIssueStory(props.issueKey));
  const [failed, setFailed] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [commentOpen, setCommentOpen] = useState(true);
  useEffect(() => {
    setDescriptionOpen(true);
    setCommentOpen(true);
  }, [props.issueKey]);
  useEffect(() => {
    const cached = readIssueStory(props.issueKey);
    if (cached) {
      setStory(cached);
      setFailed(false);
      return;
    }
    let alive = true;
    setStory(null);
    setFailed(false);
    void window.api
      .getIssueStory(props.issueKey)
      .then((next) => {
        writeIssueStory(props.issueKey, next);
        if (alive) setStory(next);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [props.issueKey, storyRev]);
  return (
    <div className="min-w-0 flex-1 text-[11px] leading-snug text-slate-700">
      {!story && !failed && <LoadBar label="Загрузка описания и последнего комментария…" />}
      {failed && <div className="text-slate-400">Описание не загрузилось</div>}
      {story && (
        <>
          <button
            type="button"
            className="text-[10px] font-medium text-slate-500 hover:text-slate-800"
            onClick={() => setDescriptionOpen((open) => !open)}
          >
            {descriptionOpen ? '▾' : '▸'} Описание
          </button>
          {descriptionOpen &&
            (story.description ? (
              <div className="markdown-body mt-0.5" dangerouslySetInnerHTML={{ __html: renderMarkdown(story.description) }} />
            ) : (
              <div className="mt-0.5 text-slate-400">Нет описания</div>
            ))}
          <div className="mt-2">
            <button
              type="button"
              className="text-[10px] font-medium text-sky-700 hover:underline"
              onClick={() => setCommentOpen((open) => !open)}
            >
              {commentOpen ? '▾' : '▸'} Последний комментарий
            </button>
            {commentOpen && (
              <div className="mt-1 rounded border border-amber-200/80 bg-[#fffbeb] px-2 py-1.5">
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
                    <div
                      className="markdown-body mt-0.5"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(story.commentText) }}
                    />
                  </>
                ) : (
                  <div className="text-slate-400">Нет комментария</div>
                )}
              </div>
            )}
          </div>
        </>
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
      <textarea
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs min-h-[96px]"
        value={props.draft}
        onChange={(e) => props.onDraftChange(e.target.value)}
        autoFocus
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

function StatusMark(props: { color: string; name: string }) {
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <span
        className="inline-flex shrink-0 items-center justify-center p-1 -m-1"
        onMouseEnter={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setTip({ x: box.left + box.width / 2, y: box.top - 4 });
        }}
        onMouseLeave={() => setTip(null)}
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: props.color }} />
      </span>
      {tip &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-white shadow-lg"
            style={{ left: tip.x, top: tip.y }}
          >
            {props.name}
          </span>,
          document.body,
        )}
    </>
  );
}
