import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type {
  BoardColumnConfig,
  BoardMatrix,
  ColumnGroup,
  Developer,
  SavedBoard,
  TrackerIssue,
} from '@shared/types';
import { OTHERS_ROW_ID, UNASSIGNED_ROW_ID } from '@shared/types';
import { reflowMatrix } from '@shared/reflowMatrix';
import { groupHeaderCells, groupStatusKey, moveGroupBefore, placeColumn, tableSlots } from '@shared/columnGroups';
import { resolveDeveloperRowColor, darkenHex, hexTint } from '@shared/types';
import { describeMatrix } from '@shared/matrixShape';
import { sessionLog } from '../sessionLog';
import { PENDING_COLUMN, cellMissingBadges, cellTimeWarn, finalColumnKeys, issueIsBoardDone, issueIsDone, issueTimeWarn } from '@shared/columnMeta';
import { staleNewTaskNote, changeStillOpen } from '@shared/issueChanges';
import { storyPointsTotal, type StoryPointsSum } from '@shared/storyPoints';
import { invalidateIssueStories } from '../issueStoryCache';
import IssuePanel from '../components/IssuePanel';
import { PointsSumBadge } from '../components/StoryPointsControl';
import SummaryDock from '../components/SummaryDock';
import { RunSpinner, stopBoardRefresh } from '../components/ApiRunControls';
import { InstantTip, showTitleIfCut } from '../components/InstantTip';
import { ConsoleDock } from '../components/ConsoleDock';
import { attachFadeHost, fadeThen, hideWorkBusy, reapplyFade, showWorkBusy } from '../contentFade';
import { defaultSummaryPeriod, type SummaryPeriod } from '@shared/summary';
import TodoPanel from '../components/TodoPanel';
import {
  BookmarkIcon,
  ClipboardIcon,
  PaperclipIcon,
  SlashIcon,
  CompassIcon,
  CellBadgeStack,
  type CellBadgeKind,
  type CellBadgeModel,
  InboxIcon,
  ActivityIcon,
  TerminalIcon,
  BellIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  BellOffIcon,
  ShuffleIcon,
  FilterIcon,
  ClockIcon,
  CalendarIcon,
  EyeOffIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  ShieldIcon,
  BatteryChargingIcon,
  UserCheckIcon,
  TableIcon,
  CheckIcon,
  XIcon,
  MoveIcon,
  UsersIcon,
  RefreshIcon,
} from '../components/Icons';
import DraftDock from '../components/DraftDock';
import {
  ListSortButton,
  loadListSort,
  saveListSort,
  type ListSort,
} from '../components/ListSort';

const UNASSIGNED_FILTER = '__none__';
/** Sprint-filter id for tasks that are not in any sprint. Not a Tracker sprint id. */
const NO_SPRINT = -1;
const LAYOUT_KEY = 'broteam.boardLayout';
const RIGHT_TOOL_KEY = 'broteam.rightTool';

type RightTool = 'summary' | 'drafts' | 'off';

function loadRightTool(): RightTool {
  try {
    const raw = localStorage.getItem(RIGHT_TOOL_KEY);
    if (raw === 'summary' || raw === 'drafts' || raw === 'off') return raw;
  } catch {
    /* ignore broken storage */
  }
  return 'off';
}

function saveRightToolLocal(tool: RightTool): void {
  localStorage.setItem(RIGHT_TOOL_KEY, tool);
}
const FILTER_GROUPS_KEY = 'broteam.filterGroups';
const LEFT_FILTERS_KEY = 'broteam.leftFilters';
const BOARD_ROWS_KEY = 'broteam.boardRows';
const BOARD_COLS_KEY = 'broteam.boardCols';
const COLUMN_AUTO_SKIP_KEY = 'broteam.columnAutoSkip';
const TABLE_MODE_KEY = 'broteam.tableMode';
const TABLE_SHOWN_KEY = 'broteam.tableShown';
const BOARD_SCALE_KEY = 'broteam.boardScale';
const SHOW_DONE_KEY = 'broteam.showDoneIssues';
const CROSS_BOARDS_KEY = 'broteam.crossBoards';
const CROSS_PRIMED_KEY = 'broteam.crossPrimed';

function loadCrossBoards(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CROSS_BOARDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCrossBoards(value: Record<string, boolean>): void {
  localStorage.setItem(CROSS_BOARDS_KEY, JSON.stringify(value));
}

type BoardRowPrefs = Record<string, { hidden: number[]; shown: number[] }>;
type BoardColPrefs = Record<string, { hidden: string[]; shown: string[] }>;
type ColumnAutoSkip = Record<string, string[]>;
type TablePref = 'hidden' | 'mini' | 'full' | null;

function loadBoardRowPrefs(): BoardRowPrefs {
  try {
    const raw = localStorage.getItem(BOARD_ROWS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BoardRowPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBoardRowPrefs(prefs: BoardRowPrefs): void {
  localStorage.setItem(BOARD_ROWS_KEY, JSON.stringify(prefs));
}

function loadBoardColPrefs(): BoardColPrefs {
  try {
    const raw = localStorage.getItem(BOARD_COLS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BoardColPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBoardColPrefs(prefs: BoardColPrefs): void {
  localStorage.setItem(BOARD_COLS_KEY, JSON.stringify(prefs));
}

function loadColumnAutoSkip(): ColumnAutoSkip {
  try {
    const raw = localStorage.getItem(COLUMN_AUTO_SKIP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ColumnAutoSkip;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveColumnAutoSkip(prefs: ColumnAutoSkip): void {
  localStorage.setItem(COLUMN_AUTO_SKIP_KEY, JSON.stringify(prefs));
}

function loadTableMode(): TablePref {
  try {
    const raw = localStorage.getItem(TABLE_MODE_KEY);
    if (raw === 'hidden' || raw === 'mini' || raw === 'full') return raw;
  } catch {
    /* ignore broken storage */
  }
  return 'full';
}

function loadTableShown(): boolean {
  try {
    return localStorage.getItem(TABLE_SHOWN_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveTableShown(on: boolean): void {
  localStorage.setItem(TABLE_SHOWN_KEY, on ? '1' : '0');
}

function readBoardScales(): Record<string, { fraction: number; mode: 'mini' | 'full' }> {
  try {
    const raw = localStorage.getItem(BOARD_SCALE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { fraction: number; mode: 'mini' | 'full' }>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeBoardScale(id: number, scale: { fraction: number; mode: 'mini' | 'full' }): void {
  const all = readBoardScales();
  all[String(id)] = scale;
  localStorage.setItem(BOARD_SCALE_KEY, JSON.stringify(all));
}

function saveTableMode(mode: TablePref): void {
  if (!mode) localStorage.removeItem(TABLE_MODE_KEY);
  else localStorage.setItem(TABLE_MODE_KEY, mode);
}

function loadShowDone(): boolean {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveShowDone(on: boolean): void {
  localStorage.setItem(SHOW_DONE_KEY, on ? '1' : '0');
}

function rowVisible(
  person: Developer,
  boardId: number | null,
  prefs: BoardRowPrefs,
  assigneeIds: Set<number>,
): boolean {
  if (person.role === 'contact') return false;
  const slot = boardId == null ? undefined : prefs[String(boardId)];
  if (slot?.shown?.includes(person.id)) return true;
  if (slot?.hidden?.includes(person.id)) return false;
  if (person.hidden) return false;
  return assigneeIds.has(person.id);
}

type BoardPersonPick = {
  key: string;
  label: string;
  participant: Developer | null;
  login: string;
  uid: string;
  total?: number;
};

function sameAssignee(person: Developer, issue: TrackerIssue): boolean {
  const login = issue.assigneeLogin?.toLowerCase();
  if (login && person.login.toLowerCase() === login) return true;
  if (issue.assigneeUid && String(person.uid) === String(issue.assigneeUid)) return true;
  const name = issue.assigneeDisplay?.trim();
  return Boolean(name) && person.displayName.trim() === name;
}

type TableMode = 'full' | 'mini' | 'hidden';

const NAME_COL_PX = 156;
/** Column stays readable in compact mode. Narrower hides the table. */
const COMPACT_COL_PX = 34;
/** Column width at which digits and icons reach their cap. Wider cells keep growing. */
const FULL_COL_PX = 72;
const COMPACT_HEADER_PX = 32;
const COMPACT_ROW_PX = 22;
const FULL_HEADER_PX = 34;
/** Cell size from which icons stay readable. Smaller than this is compact. */
const ICON_COL_PX = 48;
const ICON_ROW_PX = 36;
/** Natural full row. Digits do not grow past this. */
const MAX_ROW_PX = 46;
const MAX_DIGIT_PX = 28;
/** Task-list header stays on one line down to this center width. */
const TASKS_MIN_PX = 640;
const LEFT_RAIL_PX = 44;
const RIGHT_RAIL_PX = 44;
/** Expanded drafts stay readable; the panel does not shrink below this. */
const DRAFTS_MIN_PX = 280;
const SUMMARY_MIN_PX = 600;

function tableWidth(dataCols: number, colPx: number) {
  return NAME_COL_PX + dataCols * colPx;
}

function tableHeight(bodyRows: number, headerPx: number, rowPx: number) {
  return headerPx + bodyRows * rowPx;
}

function setMoveGhost(event: DragEvent, label: string) {
  const ghost = document.createElement('div');
  ghost.textContent = label;
  ghost.style.position = 'fixed';
  ghost.style.top = '-1000px';
  ghost.style.left = '0';
  ghost.style.padding = '4px 10px';
  ghost.style.borderRadius = '6px';
  ghost.style.background = '#0284c7';
  ghost.style.color = '#fff';
  ghost.style.font = '600 12px/1.2 sans-serif';
  ghost.style.whiteSpace = 'nowrap';
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  window.setTimeout(() => ghost.remove(), 0);
}

function resolveTableMode(input: {
  width: number;
  height: number;
  dataCols: number;
  bodyRows: number;
  pref: 'hidden' | 'mini' | 'full' | null;
  holdHidden: boolean;
  shown: boolean;
}): TableMode {
  if (!input.shown || input.holdHidden || input.pref === 'hidden') return 'hidden';
  if (input.pref === 'mini') return 'mini';
  return 'full';
}

type FilterGroupsOpen = {
  sprints: boolean;
  assignees: boolean;
  reviewers: boolean;
  qa: boolean;
  authors: boolean;
};

type BoardLayout = {
  filtersOpen: boolean;
  issuesOpen: boolean;
  draftsOpen: boolean;
  tableFraction: number;
  draftsFraction: number;
  filtersWidth: number;
};

function loadFilterGroups(): FilterGroupsOpen {
  const fallback: FilterGroupsOpen = { sprints: true, assignees: true, reviewers: true, qa: true, authors: true };
  try {
    const raw = localStorage.getItem(FILTER_GROUPS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FilterGroupsOpen>;
    return {
      sprints: parsed.sprints !== false,
      assignees: parsed.assignees !== false,
      reviewers: parsed.reviewers !== false,
      qa: parsed.qa !== false,
      authors: parsed.authors !== false,
    };
  } catch {
    return fallback;
  }
}

type LeftFilterMemory = {
  groups: FilterGroupsOpen;
  sprint: number | null;
  reviewer: string | null;
  qa: string | null;
  author: string | null;
  assignee: string | null;
  pinnedSprints: number[];
  pinnedReviewers: string[];
  pinnedQas: string[];
  pinnedAuthors: string[];
  pinnedAssignees: string[];
  excludedSprints: number[];
  excludedReviewers: string[];
  excludedQas: string[];
  excludedAuthors: string[];
  excludedAssignees: string[];
};

function emptyLeftFilters(): LeftFilterMemory {
  return {
    groups: loadFilterGroups(),
    sprint: null,
    reviewer: null,
    qa: null,
    author: null,
    assignee: null,
    pinnedSprints: [],
    pinnedReviewers: [],
    pinnedQas: [],
    pinnedAuthors: [],
    pinnedAssignees: [],
    excludedSprints: [],
    excludedReviewers: [],
    excludedQas: [],
    excludedAuthors: [],
    excludedAssignees: [],
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function asNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function normalizeLeftFilters(raw: Partial<LeftFilterMemory> | null | undefined): LeftFilterMemory {
  const groups = raw?.groups;
  return {
    groups: {
      sprints: groups?.sprints !== false,
      assignees: groups?.assignees !== false,
      reviewers: groups?.reviewers !== false,
      qa: groups?.qa !== false,
      authors: groups?.authors !== false,
    },
    sprint: typeof raw?.sprint === 'number' && Number.isFinite(raw.sprint) ? raw.sprint : null,
    reviewer: typeof raw?.reviewer === 'string' && raw.reviewer ? raw.reviewer : null,
    qa: typeof raw?.qa === 'string' && raw.qa ? raw.qa : null,
    author: typeof raw?.author === 'string' && raw.author ? raw.author : null,
    assignee: typeof raw?.assignee === 'string' && raw.assignee ? raw.assignee : null,
    pinnedSprints: asNumberList(raw?.pinnedSprints),
    pinnedReviewers: asStringList(raw?.pinnedReviewers),
    pinnedQas: asStringList(raw?.pinnedQas),
    pinnedAuthors: asStringList(raw?.pinnedAuthors),
    pinnedAssignees: asStringList(raw?.pinnedAssignees),
    excludedSprints: asNumberList(raw?.excludedSprints),
    excludedReviewers: asStringList(raw?.excludedReviewers),
    excludedQas: asStringList(raw?.excludedQas),
    excludedAuthors: asStringList(raw?.excludedAuthors),
    excludedAssignees: asStringList(raw?.excludedAssignees),
  };
}

function readLeftFilterMap(): Record<string, Partial<LeftFilterMemory>> {
  try {
    const raw = localStorage.getItem(LEFT_FILTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<LeftFilterMemory>>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadLeftFilters(boardId: number | null): LeftFilterMemory {
  if (boardId == null) return emptyLeftFilters();
  const slot = readLeftFilterMap()[String(boardId)];
  if (!slot) return emptyLeftFilters();
  return normalizeLeftFilters(slot);
}

function saveLeftFilters(boardId: number, memory: LeftFilterMemory): void {
  const map = readLeftFilterMap();
  map[String(boardId)] = memory;
  localStorage.setItem(LEFT_FILTERS_KEY, JSON.stringify(map));
}

function loadBoardLayout(): BoardLayout {
  const fallback: BoardLayout = {
    filtersOpen: true,
    issuesOpen: true,
    draftsOpen: false,
    tableFraction: 0.4,
    draftsFraction: 0.42,
    filtersWidth: DRAFTS_MIN_PX,
  };
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BoardLayout>;
    const tableFraction =
      typeof parsed.tableFraction === 'number' &&
      parsed.tableFraction >= 0.08 &&
      parsed.tableFraction <= 0.92
        ? parsed.tableFraction
        : fallback.tableFraction;
    const draftsFraction =
      typeof parsed.draftsFraction === 'number' &&
      parsed.draftsFraction >= 0.22 &&
      parsed.draftsFraction <= 0.85
        ? parsed.draftsFraction
        : fallback.draftsFraction;
    return {
      filtersOpen: parsed.filtersOpen !== false,
      issuesOpen: parsed.issuesOpen !== false,
      draftsOpen: parsed.draftsOpen === true,
      tableFraction,
      draftsFraction,
      filtersWidth:
        typeof parsed.filtersWidth === 'number' && parsed.filtersWidth >= DRAFTS_MIN_PX
          ? parsed.filtersWidth
          : fallback.filtersWidth,
    };
  } catch {
    return fallback;
  }
}

type Props = {
  matrix: BoardMatrix | null;
  readOnly: boolean;
  snapshotDate?: string | null;
  columnHeadersNoWrap?: boolean;
  setupKind: 'integration' | 'boards' | null;
  onRefresh: () => void;
  onRefreshBoard: () => void;
  refreshingBoardId?: number | null;
  editExit?: number;
  onMatrixChange: (m: BoardMatrix) => void;
  onDevelopersChange: (d: Developer[]) => void;
  onColumnsChange: (c: BoardColumnConfig[]) => void;
  groups: ColumnGroup[];
  onGroupsChange: (groups: ColumnGroup[]) => void;
  onError: (msg: string | null) => void;
  onGoSettings: (section: 'integrations' | 'boards') => void;
  onSnapshotContentChange: () => void;
  participants: Developer[];
  columns: BoardColumnConfig[];
  boards: SavedBoard[];
  activeBoardId: number | null;
  onActiveBoard: (id: number) => void;
  onHeaderChange: (header: BoardHeaderModel) => void;
  changes: Array<{ issueKey: string; boardLocalId: number; text: string; at: string; seen: boolean }>;
  onDismissChanges: (keys: string[]) => void;
  onCrossChange?: () => void;
  onPrepareCross?: () => Promise<boolean>;
  apiRequests: number;
  trayCue: { tick: number; boardId: number | null; bell: boolean };
  onBootstrapped?: () => void;
};

export type BoardHeaderModel = {
  title: string;
  period: string | null;
  outdated: boolean;
  previous: boolean;
  open: number;
  done: number;
  total: number;
};

export type CellSelection = {
  kind: 'issues' | 'todos';
  developerId: number | null;
  developerName: string;
  statusKey: string | null;
  issues: TrackerIssue[];
};

export default function BoardPage(props: Props) {
  const { readOnly } = props;
  // A matrix belongs to one board. The previous install stored a single
  // BROCARDDEV cache with no owner; it must not fill every other board.
  const sourceMatrix =
    props.matrix != null &&
    props.activeBoardId != null &&
    props.matrix.sourceBoardLocalId === props.activeBoardId
      ? props.matrix
      : null;
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => loadBoardLayout().filtersOpen);
  const [issuesOpen, setIssuesOpen] = useState(() => loadBoardLayout().issuesOpen);
  const [paintStage, setPaintStage] = useState<'rails' | 'table' | 'list' | 'summary'>('rails');
  const bootCb = useRef(props.onBootstrapped);
  bootCb.current = props.onBootstrapped;
  useEffect(() => {
    let stage: 'rails' | 'table' | 'list' | 'summary' = 'rails';
    let timer = 0;
    const advance = () => {
      stage = stage === 'rails' ? 'table' : stage === 'table' ? 'list' : 'summary';
      setPaintStage(stage);
      if (stage !== 'summary') timer = window.setTimeout(advance, 48);
      else timer = window.setTimeout(() => bootCb.current?.(), 48);
    };
    timer = window.setTimeout(advance, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [rightTool, setRightToolState] = useState<RightTool>(loadRightTool);
  const rightToolTouched = useRef(false);
  const summaryOpen = rightTool === 'summary';
  const draftsOpen = rightTool !== 'off';
  const [draftsFraction, setDraftsFraction] = useState(() => loadBoardLayout().draftsFraction);
  const [filtersWidth, setFiltersWidth] = useState(() => loadBoardLayout().filtersWidth);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const [modeMenuPos, setModeMenuPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!modeMenuOpen) return;
    const place = () => {
      const box = modeButtonRef.current?.getBoundingClientRect();
      if (!box) return;
      const top = box.bottom + 2;
      const left = box.left;
      setModeMenuPos((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [modeMenuOpen]);
  useLayoutEffect(() => {
    hideWorkBusy();
  });
  useEffect(() => {
    if (!modeMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (modeButtonRef.current?.contains(target) || modeMenuRef.current?.contains(target)) return;
      setModeMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModeMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [modeMenuOpen]);
  const [rowWidth, setRowWidth] = useState(0);
  const [centerBox, setCenterBox] = useState({ w: 0, h: 0 });
  const [listSort, setListSort] = useState<ListSort>(() => loadListSort());
  const [listFilterEpoch, setListFilterEpoch] = useState(0);
  const [activeIcon, setActiveIcon] = useState<CellBadgeKind | null>(null);
  const [pinnedIcons, setPinnedIcons] = useState<Set<CellBadgeKind>>(() => new Set());
  const noteOn = activeIcon === 'note' || pinnedIcons.has('note');
  const bookmarkOn = activeIcon === 'bookmark' || pinnedIcons.has('bookmark');
  const missingPointsOn = activeIcon === 'points' || pinnedIcons.has('points');
  const missingReviewerOn = activeIcon === 'reviewer' || pinnedIcons.has('reviewer');
  const missingQaOn = activeIcon === 'tester' || pinnedIcons.has('tester');
  const timeWarnOn = activeIcon === 'time' || pinnedIcons.has('time');
  const otherSprintOn = activeIcon === 'sprint' || pinnedIcons.has('sprint');
  const changesOn = activeIcon === 'changes' || pinnedIcons.has('changes');
  const [showDoneIssues, setShowDoneIssues] = useState(loadShowDone);
  const [boardScope, setBoardScope] = useState<BoardScope>('total');
  const [calcBusy, setCalcBusy] = useState(false);
  const [initialLeft] = useState(() => loadLeftFilters(props.activeBoardId));
  const [appliedSprint, setAppliedSprint] = useState<number | null>(initialLeft.sprint);
  const [appliedReviewer, setAppliedReviewer] = useState<string | null>(initialLeft.reviewer);
  const [appliedQa, setAppliedQa] = useState<string | null>(initialLeft.qa);
  const [appliedAuthor, setAppliedAuthor] = useState<string | null>(initialLeft.author);
  const [appliedAssignee, setAppliedAssignee] = useState<string | null>(initialLeft.assignee);
  const [appliedPinnedSprints, setAppliedPinnedSprints] = useState<Set<number>>(
    () => new Set(initialLeft.pinnedSprints),
  );
  const [appliedPinnedReviewers, setAppliedPinnedReviewers] = useState<Set<string>>(
    () => new Set(initialLeft.pinnedReviewers),
  );
  const [appliedPinnedQas, setAppliedPinnedQas] = useState<Set<string>>(() => new Set(initialLeft.pinnedQas));
  const [appliedPinnedAuthors, setAppliedPinnedAuthors] = useState<Set<string>>(
    () => new Set(initialLeft.pinnedAuthors),
  );
  const [appliedPinnedAssignees, setAppliedPinnedAssignees] = useState<Set<string>>(
    () => new Set(initialLeft.pinnedAssignees),
  );
  const [appliedExcludedSprints, setAppliedExcludedSprints] = useState<Set<number>>(
    () => new Set(initialLeft.excludedSprints),
  );
  const [appliedExcludedReviewers, setAppliedExcludedReviewers] = useState<Set<string>>(
    () => new Set(initialLeft.excludedReviewers),
  );
  const [appliedExcludedQas, setAppliedExcludedQas] = useState<Set<string>>(
    () => new Set(initialLeft.excludedQas),
  );
  const [appliedExcludedAuthors, setAppliedExcludedAuthors] = useState<Set<string>>(
    () => new Set(initialLeft.excludedAuthors),
  );
  const [appliedExcludedAssignees, setAppliedExcludedAssignees] = useState<Set<string>>(
    () => new Set(initialLeft.excludedAssignees),
  );
  const [appliedIcon, setAppliedIcon] = useState<CellBadgeKind | null>(null);
  const [appliedPinnedIcons, setAppliedPinnedIcons] = useState<Set<CellBadgeKind>>(() => new Set());
  const [appliedShowDone, setAppliedShowDone] = useState(loadShowDone);
  const [summaryPersonId, setSummaryPersonId] = useState<number | null>(null);
  const [castOn, setCastOn] = useState(false);
  const castPersonId = castOn ? summaryPersonId : null;
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>(defaultSummaryPeriod);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(220);
  const [filterGroupOpen, setFilterGroupOpen] = useState(initialLeft.groups);
  const noteFilter = appliedIcon === 'note' || appliedPinnedIcons.has('note');
  const bookmarkFilter = appliedIcon === 'bookmark' || appliedPinnedIcons.has('bookmark');
  const missingPointsFilter = appliedIcon === 'points' || appliedPinnedIcons.has('points');
  const missingReviewerFilter = appliedIcon === 'reviewer' || appliedPinnedIcons.has('reviewer');
  const missingQaFilter = appliedIcon === 'tester' || appliedPinnedIcons.has('tester');
  const timeWarnFilter = appliedIcon === 'time' || appliedPinnedIcons.has('time');
  const otherSprintFilter = appliedIcon === 'sprint' || appliedPinnedIcons.has('sprint');
  const changesFilter = appliedIcon === 'changes' || appliedPinnedIcons.has('changes');
  const [doneStatusKeys, setDoneStatusKeys] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void window.api
      .listStatusTypes()
      .then((types) => {
        if (cancelled) return;
        const done = new Set<string>();
        for (const [key, type] of Object.entries(types)) {
          if (type === 'done') done.add(key);
        }
        setDoneStatusKeys(done);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const finalKeys = useMemo(
    () => finalColumnKeys(props.columns, props.activeBoardId),
    [props.columns, props.activeBoardId],
  );
  const [reorderMode, setReorderMode] = useState(false);
  const [crossBoards, setCrossBoards] = useState<Record<string, boolean>>(loadCrossBoards);
  const [crossBusy, setCrossBusy] = useState(false);
  const crossLock = useRef(false);
  const crossOn = props.activeBoardId != null && Boolean(crossBoards[String(props.activeBoardId)]);
  const boardQueueKey =
    props.boards.find((board) => board.id === props.activeBoardId)?.queueKey || '';
  const [editSlot, setEditSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setEditSlot(document.getElementById('board-edit-anchor'));
  }, []);
  const editSnap = useRef<{
    filtersOpen: boolean;
    issuesOpen: boolean;
    rightTool: RightTool;
    tableShown: boolean;
    consoleOpen: boolean;
  } | null>(null);
  useEffect(() => {
    if (!props.editExit) return;
    setReorderMode(false);
    const snap = editSnap.current;
    editSnap.current = null;
    if (!snap) return;
    setFiltersOpen(snap.filtersOpen);
    setIssuesOpen(snap.issuesOpen);
    setRightTool(snap.rightTool);
    setTableShown(snap.tableShown);
    saveTableShown(snap.tableShown);
    setConsoleOpen(snap.consoleOpen);
  }, [props.editExit]);
  const [rowPrefs, setRowPrefs] = useState<BoardRowPrefs>(loadBoardRowPrefs);
  const rowPrefsTouched = useRef(false);
  useEffect(() => {
    let cancel = false;
    void window.api.getBoardRowPrefs().then((stored) => {
      if (cancel || rowPrefsTouched.current) return;
      const filled = (prefs: BoardRowPrefs) =>
        Object.values(prefs).some((slot) => slot.hidden.length > 0 || slot.shown.length > 0);
      if (filled(stored)) {
        setRowPrefs(stored);
        saveBoardRowPrefs(stored);
        return;
      }
      const local = loadBoardRowPrefs();
      if (filled(local)) void window.api.saveBoardRowPrefs(local);
    });
    return () => {
      cancel = true;
    };
  }, []);
  const [columnPrefs, setColumnPrefs] = useState<BoardColPrefs>(loadBoardColPrefs);
  const [columnAutoSkip, setColumnAutoSkip] = useState<ColumnAutoSkip>(loadColumnAutoSkip);
  const autoSkipKey = (columnAutoSkip[String(props.activeBoardId ?? '')] || []).join('\0');
  const unseenKey = props.changes
    .filter((change) => change.boardLocalId === props.activeBoardId && !change.seen)
    .map((change) => change.issueKey)
    .sort()
    .join('\0');
  useEffect(() => {
    if (props.activeBoardId == null || !sourceMatrix || !autoSkipKey) return;
    const skipped = new Set(autoSkipKey.split('\0'));
    const byKey = new Map(
      props.changes
        .filter((change) => change.boardLocalId === props.activeBoardId)
        .map((change) => [change.issueKey, change]),
    );
    const keys: string[] = [];
    for (const statusKey of skipped) keys.push(...columnChangeKeys(sourceMatrix, statusKey, byKey));
    if (keys.length) props.onDismissChanges(keys);
  }, [autoSkipKey, unseenKey, sourceMatrix, props.activeBoardId]);
  const [othersMenu, setOthersMenu] = useState<{ top: number; left: number } | null>(null);
  const peopleButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [tableFraction, setTableFraction] = useState(() => loadBoardLayout().tableFraction);
  const [tablePref, setTablePref] = useState<TablePref>(loadTableMode);
  const [tableShown, setTableShown] = useState(loadTableShown);
  const [holdHidden, setHoldHidden] = useState(false);
  const [dropColKey, setDropColKey] = useState<string | null>(null);
  const [dropDevId, setDropDevId] = useState<number | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const [draggingDev, setDraggingDev] = useState<number | null>(null);
  const [sprintFilter, setSprintFilter] = useState<number | null>(initialLeft.sprint);
  const [reviewerFilter, setReviewerFilter] = useState<string | null>(initialLeft.reviewer);
  const [qaFilter, setQaFilter] = useState<string | null>(initialLeft.qa);
  const [authorFilter, setAuthorFilter] = useState<string | null>(initialLeft.author);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(initialLeft.assignee);
  const [pinnedSprints, setPinnedSprints] = useState<Set<number>>(() => new Set(initialLeft.pinnedSprints));
  const [pinnedReviewers, setPinnedReviewers] = useState<Set<string>>(
    () => new Set(initialLeft.pinnedReviewers),
  );
  const [pinnedQas, setPinnedQas] = useState<Set<string>>(() => new Set(initialLeft.pinnedQas));
  const [pinnedAuthors, setPinnedAuthors] = useState<Set<string>>(() => new Set(initialLeft.pinnedAuthors));
  const [pinnedAssignees, setPinnedAssignees] = useState<Set<string>>(() => new Set(initialLeft.pinnedAssignees));
  const [excludedSprints, setExcludedSprints] = useState<Set<number>>(
    () => new Set(initialLeft.excludedSprints),
  );
  const [excludedReviewers, setExcludedReviewers] = useState<Set<string>>(
    () => new Set(initialLeft.excludedReviewers),
  );
  const [excludedQas, setExcludedQas] = useState<Set<string>>(() => new Set(initialLeft.excludedQas));
  const [excludedAuthors, setExcludedAuthors] = useState<Set<string>>(
    () => new Set(initialLeft.excludedAuthors),
  );
  const [excludedAssignees, setExcludedAssignees] = useState<Set<string>>(
    () => new Set(initialLeft.excludedAssignees),
  );
  const [highlightIssueKey, setHighlightIssueKey] = useState<string | null>(null);
  const [summaryTabs, setSummaryTabs] = useState<number[] | null>(null);
  const summaryHoverTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (summaryHoverTimer.current != null) window.clearTimeout(summaryHoverTimer.current);
    },
    [],
  );
  useEffect(() => {
    const badges = document.querySelectorAll<HTMLElement>('[data-board-badge]');
    badges.forEach((el) => {
      el.classList.remove('is-summary-focus', 'is-summary-dim');
    });
    if (!summaryTabs?.length) return;
    const focus = new Set(summaryTabs.map(String));
    badges.forEach((el) => {
      el.classList.add(focus.has(el.dataset.boardBadge || '') ? 'is-summary-focus' : 'is-summary-dim');
    });
    return () => {
      badges.forEach((el) => {
        el.classList.remove('is-summary-focus', 'is-summary-dim');
      });
    };
  }, [summaryTabs]);
  const [tableHover, setTableHover] = useState<{
    row: number | 'total' | 'head';
    col: string;
  } | null>(null);
  const dragging = useRef<'drafts' | 'filters' | null>(null);
  const splitDragging = useRef(false);
  const dragColKey = useRef<string | null>(null);
  const dragDevId = useRef<number | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const boardRowRef = useRef<HTMLDivElement>(null);
  const tableHostObs = useRef<ResizeObserver | null>(null);
  const tableHostEl = useRef<HTMLDivElement | null>(null);
  const [tableViewport, setTableViewport] = useState({ h: 0, header: 0 });
  const setTableHost = useCallback((node: HTMLDivElement | null) => {
    tableHostObs.current?.disconnect();
    tableHostObs.current = null;
    tableHostEl.current = node;
    if (!node) {
      attachFadeHost('table', null);
      return;
    }
    const measure = () => {
      const header = Math.round(node.querySelector('thead')?.getBoundingClientRect().height ?? 0);
      const h = Math.round(node.clientHeight);
      setTableViewport((prev) =>
        prev.h === h && prev.header === header ? prev : { h, header },
      );
    };
    const observer = new ResizeObserver(measure);
    tableHostObs.current = observer;
    observer.observe(node);
    const thead = node.querySelector('thead');
    if (thead) observer.observe(thead);
    attachFadeHost('table', node);
    measure();
  }, []);
  const holdReason = useRef<'user' | 'drag' | null>(null);
  const appliedTableFit = useRef('');
  const draggedTable = useRef(false);
  const iconFit = useRef({ col: 0, row: 0, pref: 'full' as TablePref, shown: true, id: null as number | null });
  const modeExpect = useRef<'mini' | 'full' | null>(null);
  const sizeSide = useRef<'above' | 'below' | null>(null);
  const renderStamp = useRef('');
  const layoutRef = useRef({
    filtersOpen: true,
    issuesOpen: true,
    compactW: 0,
    compactH: 0,
    filtersWidth: DRAFTS_MIN_PX,
    draftsOpen: false,
    tableShown: true,
    panelFloor: DRAFTS_MIN_PX,
  });

  const matrixMatches =
    sourceMatrix != null &&
    (sourceMatrix.sourceBoardLocalId == null || sourceMatrix.sourceBoardLocalId === props.activeBoardId);
  const displayBoardRef = useRef(props.activeBoardId);
  const filterOwnerRef = useRef<number | null>(props.activeBoardId);
  const leftSnapshotRef = useRef<{ boardId: number | null; memory: LeftFilterMemory }>({
    boardId: props.activeBoardId,
    memory: emptyLeftFilters(),
  });
  if (matrixMatches && props.activeBoardId != null) displayBoardRef.current = props.activeBoardId;
  const displayBoardId = matrixMatches ? props.activeBoardId : displayBoardRef.current;
  const assigneeIds = useMemo(() => {
    const ids = new Set<number>();
    if (!sourceMatrix) return ids;
    for (const row of sourceMatrix.developers) {
      for (const list of Object.values(row.issuesByColumn)) {
        for (const issue of list) {
          const person = props.participants.find((item) => sameAssignee(item, issue));
          if (person) ids.add(person.id);
        }
      }
    }
    return ids;
  }, [sourceMatrix, props.participants]);
  const visibleIds = useMemo(() => {
    const ids = new Set<number>();
    for (const person of props.participants) {
      if (rowVisible(person, displayBoardId, rowPrefs, assigneeIds)) ids.add(person.id);
    }
    return ids;
  }, [props.participants, displayBoardId, rowPrefs, assigneeIds]);
  const reflowed = useMemo(() => {
    if (!sourceMatrix) return null;
    try {
      return reflowMatrix(
        sourceMatrix,
        props.participants,
        props.columns,
        displayBoardId,
        visibleIds,
        { include: crossOn, queueKey: boardQueueKey },
      );
    } catch (error) {
      sessionLog('error', 'reflowMatrix', {
        activeBoardId: props.activeBoardId,
        matrix: describeMatrix(sourceMatrix),
        participants: props.participants.length,
        columns: props.columns.length,
        error,
      });
      return null;
    }
  }, [sourceMatrix, props.participants, props.columns, displayBoardId, visibleIds, crossOn, boardQueueKey]);
  const activeSprints = useMemo(() => {
    const ids = new Set(pinnedSprints);
    if (sprintFilter != null) ids.add(sprintFilter);
    return ids;
  }, [pinnedSprints, sprintFilter]);
  const activeReviewers = useMemo(() => {
    const names = new Set(pinnedReviewers);
    if (reviewerFilter) names.add(reviewerFilter);
    return names;
  }, [pinnedReviewers, reviewerFilter]);
  const activeQas = useMemo(() => {
    const names = new Set(pinnedQas);
    if (qaFilter) names.add(qaFilter);
    return names;
  }, [pinnedQas, qaFilter]);
  const dataSprints = useMemo(() => {
    const ids = new Set(appliedPinnedSprints);
    if (appliedSprint != null) ids.add(appliedSprint);
    return ids;
  }, [appliedPinnedSprints, appliedSprint]);
  const dataReviewers = useMemo(() => {
    const names = new Set(appliedPinnedReviewers);
    if (appliedReviewer) names.add(appliedReviewer);
    return names;
  }, [appliedPinnedReviewers, appliedReviewer]);
  const dataQas = useMemo(() => {
    const names = new Set(appliedPinnedQas);
    if (appliedQa) names.add(appliedQa);
    return names;
  }, [appliedPinnedQas, appliedQa]);
  const activeAuthors = useMemo(() => {
    const names = new Set(pinnedAuthors);
    if (authorFilter) names.add(authorFilter);
    return names;
  }, [pinnedAuthors, authorFilter]);
  const activeAssignees = useMemo(() => {
    const names = new Set(pinnedAssignees);
    if (assigneeFilter) names.add(assigneeFilter);
    return names;
  }, [pinnedAssignees, assigneeFilter]);
  const dataAuthors = useMemo(() => {
    const names = new Set(appliedPinnedAuthors);
    if (appliedAuthor) names.add(appliedAuthor);
    return names;
  }, [appliedPinnedAuthors, appliedAuthor]);
  const dataAssignees = useMemo(() => {
    const names = new Set(appliedPinnedAssignees);
    if (appliedAssignee) names.add(appliedAssignee);
    return names;
  }, [appliedPinnedAssignees, appliedAssignee]);
  const authorNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of sourceMatrix?.developers || []) {
      for (const issues of Object.values(row.issuesByColumn || {})) {
        for (const issue of issues || []) {
          const name = (issue.authorDisplay || '').trim();
          if (name) names.add(name);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [sourceMatrix]);
  const assigneeNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of sourceMatrix?.developers || []) {
      for (const issues of Object.values(row.issuesByColumn || {})) {
        for (const issue of issues || []) {
          const name = (issue.assigneeDisplay || '').trim();
          if (name) names.add(name);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [sourceMatrix]);
  const unseenChangeKeys = useMemo(() => {
    const createdAt = new Map<string, string | null>();
    for (const row of reflowed?.matrix.developers || []) {
      for (const issues of Object.values(row.issuesByColumn || {})) {
        for (const issue of issues || []) {
          if (!createdAt.has(issue.key)) createdAt.set(issue.key, issue.createdAt || null);
        }
      }
    }
    const keys = new Set<string>();
    for (const change of props.changes) {
      if (reflowed && !createdAt.has(change.issueKey)) continue;
      if (!changeStillOpen(change, createdAt.get(change.issueKey))) continue;
      keys.add(change.issueKey);
    }
    return keys;
  }, [props.changes, reflowed]);
  useEffect(() => {
    if (boardScope === 'changes' && unseenChangeKeys.size === 0) setBoardScope('total');
  }, [boardScope, unseenChangeKeys]);
  const matrix = useMemo(() => {
    if (!reflowed) return null;
    const castPerson =
      castPersonId == null ? null : props.participants.find((person) => person.id === castPersonId) || null;
    return applyBoardScope(
      applyCast(
        applyFilters(
          reflowed.matrix,
          dataSprints,
          dataReviewers,
          dataQas,
          dataAuthors,
          dataAssignees,
          {
            sprints: appliedExcludedSprints,
            reviewers: appliedExcludedReviewers,
            qas: appliedExcludedQas,
            authors: appliedExcludedAuthors,
            assignees: appliedExcludedAssignees,
          },
          doneStatusKeys,
          finalKeys,
        ),
        castPerson,
      ),
      boardScope,
      doneStatusKeys,
      unseenChangeKeys,
      finalKeys,
    );
  }, [
    reflowed,
    dataSprints,
    dataReviewers,
    dataQas,
    dataAuthors,
    dataAssignees,
    appliedExcludedSprints,
    appliedExcludedReviewers,
    appliedExcludedQas,
    appliedExcludedAuthors,
    appliedExcludedAssignees,
    boardScope,
    doneStatusKeys,
    finalKeys,
    unseenChangeKeys,
    castPersonId,
    props.participants,
  ]);
  const rowPicks = useMemo(() => {
    const visibleIds = new Set(
      (reflowed?.matrix.developers || []).map((row) => row.developer.id).filter((id) => id > 0),
    );
    const othersRow = reflowed?.matrix.developers.find((row) => row.developer.id === OTHERS_ROW_ID);
    const seen = new Set<string>();
    const fromOthers: BoardPersonPick[] = [];
    for (const issues of Object.values(othersRow?.issuesByColumn || {})) {
      for (const issue of issues) {
        const participant = props.participants.find((person) => sameAssignee(person, issue)) || null;
        if (participant && visibleIds.has(participant.id)) continue;
        const label =
          participant?.displayName || issue.assigneeDisplay || issue.assigneeLogin || 'Без имени';
        const key = participant
          ? `p:${participant.id}`
          : `a:${issue.assigneeLogin || ''}|${issue.assigneeUid || ''}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fromOthers.push({
          key,
          label,
          participant,
          login: participant?.login || issue.assigneeLogin || '',
          uid: participant?.uid || (issue.assigneeUid ? String(issue.assigneeUid) : ''),
        });
      }
    }
    fromOthers.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    const listed = new Set(
      fromOthers.map((item) => item.participant?.id).filter((id): id is number => id != null),
    );
    const fromParticipants: BoardPersonPick[] = props.participants
      .filter(
        (person) =>
          person.role !== 'contact' && !visibleIds.has(person.id) && !listed.has(person.id),
      )
      .map((person) => ({
        key: `p:${person.id}`,
        label: person.displayName || person.login,
        participant: person,
        login: person.login,
        uid: person.uid,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    return { fromOthers, fromParticipants };
  }, [reflowed, props.participants]);
  const enabledStatusKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const column of props.columns) {
      if (props.activeBoardId != null && column.boardLocalId !== props.activeBoardId) continue;
      keys.add(column.statusKey);
    }
    return keys;
  }, [props.columns, props.activeBoardId]);
  const splitCount = useCallback(
    (match: (issue: TrackerIssue) => boolean) => {
      if (!sourceMatrix) return { open: 0, done: 0 };
      const seen = new Set<string>();
      let open = 0;
      let done = 0;
      for (const row of sourceMatrix.developers || []) {
        for (const [statusKey, issues] of Object.entries(row.issuesByColumn || {})) {
          for (const issue of issues || []) {
            if (!issue || seen.has(issue.key) || !match(issue)) continue;
            seen.add(issue.key);
            if (issueIsBoardDone(issue, doneStatusKeys, finalKeys)) done += 1;
            else if (enabledStatusKeys.has(statusKey)) open += 1;
          }
        }
      }
      return { open, done };
    },
    [sourceMatrix, enabledStatusKeys, doneStatusKeys, finalKeys],
  );

  function applyLeftMemory(memory: LeftFilterMemory) {
    const pinnedSprintIds = new Set(memory.pinnedSprints);
    const pinnedReviewerNames = new Set(memory.pinnedReviewers);
    const pinnedQaNames = new Set(memory.pinnedQas);
    const pinnedAuthorNames = new Set(memory.pinnedAuthors);
    const pinnedAssigneeNames = new Set(memory.pinnedAssignees);
    const excludedSprintIds = new Set(memory.excludedSprints);
    const excludedReviewerNames = new Set(memory.excludedReviewers);
    const excludedQaNames = new Set(memory.excludedQas);
    const excludedAuthorNames = new Set(memory.excludedAuthors);
    const excludedAssigneeNames = new Set(memory.excludedAssignees);
    setFilterGroupOpen(memory.groups);
    setSprintFilter(memory.sprint);
    setReviewerFilter(memory.reviewer);
    setQaFilter(memory.qa);
    setAuthorFilter(memory.author);
    setAssigneeFilter(memory.assignee);
    setPinnedSprints(pinnedSprintIds);
    setPinnedReviewers(pinnedReviewerNames);
    setPinnedQas(pinnedQaNames);
    setPinnedAuthors(pinnedAuthorNames);
    setPinnedAssignees(pinnedAssigneeNames);
    setExcludedSprints(excludedSprintIds);
    setExcludedReviewers(excludedReviewerNames);
    setExcludedQas(excludedQaNames);
    setExcludedAuthors(excludedAuthorNames);
    setExcludedAssignees(excludedAssigneeNames);
    setAppliedSprint(memory.sprint);
    setAppliedReviewer(memory.reviewer);
    setAppliedQa(memory.qa);
    setAppliedAuthor(memory.author);
    setAppliedAssignee(memory.assignee);
    setAppliedPinnedSprints(new Set(pinnedSprintIds));
    setAppliedPinnedReviewers(new Set(pinnedReviewerNames));
    setAppliedPinnedQas(new Set(pinnedQaNames));
    setAppliedPinnedAuthors(new Set(pinnedAuthorNames));
    setAppliedPinnedAssignees(new Set(pinnedAssigneeNames));
    setAppliedExcludedSprints(new Set(excludedSprintIds));
    setAppliedExcludedReviewers(new Set(excludedReviewerNames));
    setAppliedExcludedQas(new Set(excludedQaNames));
    setAppliedExcludedAuthors(new Set(excludedAuthorNames));
    setAppliedExcludedAssignees(new Set(excludedAssigneeNames));
  }

  leftSnapshotRef.current = {
    boardId: filterOwnerRef.current,
    memory: {
      groups: filterGroupOpen,
      sprint: sprintFilter,
      reviewer: reviewerFilter,
      qa: qaFilter,
      author: authorFilter,
      assignee: assigneeFilter,
      pinnedSprints: [...pinnedSprints],
      pinnedReviewers: [...pinnedReviewers],
      pinnedQas: [...pinnedQas],
      pinnedAuthors: [...pinnedAuthors],
      pinnedAssignees: [...pinnedAssignees],
      excludedSprints: [...excludedSprints],
      excludedReviewers: [...excludedReviewers],
      excludedQas: [...excludedQas],
      excludedAuthors: [...excludedAuthors],
      excludedAssignees: [...excludedAssignees],
    },
  };

  useEffect(() => {
    if (!props.snapshotDate) return;
    setSprintFilter(null);
    setReviewerFilter(null);
    setQaFilter(null);
    setAuthorFilter(null);
    setAssigneeFilter(null);
  }, [props.snapshotDate]);

  useEffect(() => {
    const nextId = props.activeBoardId;
    const owner = filterOwnerRef.current;
    if (owner !== nextId) {
      if (owner != null) saveLeftFilters(owner, leftSnapshotRef.current.memory);
      filterOwnerRef.current = nextId;
      applyLeftMemory(loadLeftFilters(nextId));
    }
    setAppliedIcon(null);
    setAppliedPinnedIcons(new Set());
    setCalcBusy(false);
    setBoardScope('total');
  }, [props.activeBoardId]);

  const seenTray = useRef(0);
  useEffect(() => {
    if (props.trayCue.tick === 0 || props.trayCue.tick === seenTray.current) return;
    if (props.trayCue.boardId != null && props.trayCue.boardId !== props.activeBoardId) return;
    seenTray.current = props.trayCue.tick;
    resetTaskFiltersNow();
    setBoardScope(props.trayCue.bell ? 'changes' : 'total');
    setShowDoneIssues(true);
    saveShowDone(true);
    setTableShown(true);
    saveTableShown(true);
    setIssuesOpen(true);
    const current = matrixRef.current;
    if (!current) return;
    setSelection({
      kind: 'issues',
      developerId: null,
      developerName: 'Вся команда',
      statusKey: null,
      issues: current.developers.flatMap((row) => Object.values(row.issuesByColumn).flat()),
    });
  }, [props.activeBoardId, props.trayCue]);

  useEffect(() => {
    const snap = leftSnapshotRef.current;
    if (snap.boardId == null || snap.boardId !== filterOwnerRef.current) return;
    saveLeftFilters(snap.boardId, snap.memory);
  }, [
    filterGroupOpen,
    sprintFilter,
    reviewerFilter,
    qaFilter,
    authorFilter,
    assigneeFilter,
    pinnedSprints,
    pinnedReviewers,
    pinnedQas,
    pinnedAuthors,
    pinnedAssignees,
    excludedSprints,
    excludedReviewers,
    excludedQas,
    excludedAuthors,
    excludedAssignees,
  ]);

  useEffect(
    () => () => {
      const snap = leftSnapshotRef.current;
      if (snap.boardId == null) return;
      saveLeftFilters(snap.boardId, snap.memory);
    },
    [],
  );

  function syncApplied(patch: {
    sprint?: number | null;
    reviewer?: string | null;
    qa?: string | null;
    author?: string | null;
    assignee?: string | null;
    pinnedSprints?: Set<number>;
    pinnedReviewers?: Set<string>;
    pinnedQas?: Set<string>;
    pinnedAuthors?: Set<string>;
    pinnedAssignees?: Set<string>;
    excludedSprints?: Set<number>;
    excludedReviewers?: Set<string>;
    excludedQas?: Set<string>;
    excludedAuthors?: Set<string>;
    excludedAssignees?: Set<string>;
    icon?: CellBadgeKind | null;
    pinnedIcons?: Set<CellBadgeKind>;
    showDone?: boolean;
  }) {
    if ('sprint' in patch) setAppliedSprint(patch.sprint ?? null);
    if ('reviewer' in patch) setAppliedReviewer(patch.reviewer ?? null);
    if ('qa' in patch) setAppliedQa(patch.qa ?? null);
    if ('author' in patch) setAppliedAuthor(patch.author ?? null);
    if ('assignee' in patch) setAppliedAssignee(patch.assignee ?? null);
    if (patch.pinnedSprints) setAppliedPinnedSprints(patch.pinnedSprints);
    if (patch.pinnedReviewers) setAppliedPinnedReviewers(patch.pinnedReviewers);
    if (patch.pinnedQas) setAppliedPinnedQas(patch.pinnedQas);
    if (patch.pinnedAuthors) setAppliedPinnedAuthors(patch.pinnedAuthors);
    if (patch.pinnedAssignees) setAppliedPinnedAssignees(patch.pinnedAssignees);
    if (patch.excludedSprints) setAppliedExcludedSprints(patch.excludedSprints);
    if (patch.excludedReviewers) setAppliedExcludedReviewers(patch.excludedReviewers);
    if (patch.excludedQas) setAppliedExcludedQas(patch.excludedQas);
    if (patch.excludedAuthors) setAppliedExcludedAuthors(patch.excludedAuthors);
    if (patch.excludedAssignees) setAppliedExcludedAssignees(patch.excludedAssignees);
    if ('icon' in patch) setAppliedIcon(patch.icon ?? null);
    if (patch.pinnedIcons) setAppliedPinnedIcons(patch.pinnedIcons);
    if ('showDone' in patch) setAppliedShowDone(Boolean(patch.showDone));
  }

  useEffect(() => {
    if (!calcBusy) return;
    let cancel = false;
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancel) return;
        setAppliedSprint(sprintFilter);
        setAppliedReviewer(reviewerFilter);
        setAppliedQa(qaFilter);
        setAppliedAuthor(authorFilter);
        setAppliedAssignee(assigneeFilter);
        setAppliedPinnedSprints(pinnedSprints);
        setAppliedPinnedReviewers(pinnedReviewers);
        setAppliedPinnedQas(pinnedQas);
        setAppliedPinnedAuthors(pinnedAuthors);
        setAppliedPinnedAssignees(pinnedAssignees);
        setAppliedExcludedSprints(excludedSprints);
        setAppliedExcludedReviewers(excludedReviewers);
        setAppliedExcludedQas(excludedQas);
        setAppliedExcludedAuthors(excludedAuthors);
        setAppliedExcludedAssignees(excludedAssignees);
        setAppliedIcon(activeIcon);
        setAppliedPinnedIcons(pinnedIcons);
        setAppliedShowDone(showDoneIssues);
      });
    });
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
    };
  }, [
    calcBusy,
    sprintFilter,
    reviewerFilter,
    qaFilter,
    authorFilter,
    assigneeFilter,
    pinnedSprints,
    pinnedReviewers,
    pinnedQas,
    pinnedAuthors,
    pinnedAssignees,
    excludedSprints,
    excludedReviewers,
    excludedQas,
    excludedAuthors,
    excludedAssignees,
    activeIcon,
    pinnedIcons,
    showDoneIssues,
  ]);

  useEffect(() => {
    if (!calcBusy) return;
    if (
      appliedSprint !== sprintFilter ||
      appliedReviewer !== reviewerFilter ||
      appliedQa !== qaFilter ||
      appliedAuthor !== authorFilter ||
      appliedAssignee !== assigneeFilter ||
      appliedPinnedSprints !== pinnedSprints ||
      appliedPinnedReviewers !== pinnedReviewers ||
      appliedPinnedQas !== pinnedQas ||
      appliedPinnedAuthors !== pinnedAuthors ||
      appliedPinnedAssignees !== pinnedAssignees ||
      appliedExcludedSprints !== excludedSprints ||
      appliedExcludedReviewers !== excludedReviewers ||
      appliedExcludedQas !== excludedQas ||
      appliedExcludedAuthors !== excludedAuthors ||
      appliedExcludedAssignees !== excludedAssignees ||
      appliedIcon !== activeIcon ||
      appliedPinnedIcons !== pinnedIcons ||
      appliedShowDone !== showDoneIssues
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => setCalcBusy(false));
    return () => cancelAnimationFrame(frame);
  }, [
    calcBusy,
    appliedSprint,
    appliedReviewer,
    appliedQa,
    appliedAuthor,
    appliedAssignee,
    appliedPinnedSprints,
    appliedPinnedReviewers,
    appliedPinnedQas,
    appliedPinnedAuthors,
    appliedPinnedAssignees,
    appliedExcludedSprints,
    appliedExcludedReviewers,
    appliedExcludedQas,
    appliedExcludedAuthors,
    appliedExcludedAssignees,
    appliedIcon,
    appliedPinnedIcons,
    appliedShowDone,
    sprintFilter,
    reviewerFilter,
    qaFilter,
    authorFilter,
    assigneeFilter,
    pinnedSprints,
    pinnedReviewers,
    pinnedQas,
    pinnedAuthors,
    pinnedAssignees,
    excludedSprints,
    excludedReviewers,
    excludedQas,
    excludedAuthors,
    excludedAssignees,
    activeIcon,
    pinnedIcons,
    showDoneIssues,
  ]);

  useEffect(() => {
    if (!calcBusy) return;
    void window.api.resetTrackerActivity();
  }, [calcBusy]);

  const matrixRef = useRef(matrix);
  matrixRef.current = matrix;
  const allTasksKey = useRef<string | null>(null);
  const keepCellOnFilterReset = useRef(false);

  useEffect(() => {
    if (!matrix || !selection) return;
    if (selection.kind === 'todos') {
      const row =
        selection.developerId != null
          ? matrix.developers.find((d) => d.developer.id === selection.developerId)
          : null;
      if (!row) {
        setSelection(null);
        return;
      }
      setSelection({
        ...selection,
        developerName: row.developer.displayName,
        issues: [],
      });
      return;
    }
    if (selection.statusKey === PENDING_COLUMN) {
      const rows =
        selection.developerId != null
          ? matrix.developers.filter((d) => d.developer.id === selection.developerId)
          : matrix.developers;
      if (selection.developerId != null && rows.length === 0) {
        setSelection(null);
        return;
      }
      setSelection({
        ...selection,
        kind: 'issues',
        developerName:
          selection.developerId != null ? rows[0].developer.displayName : selection.developerName,
        issues: rows
          .flatMap((row) => Object.values(row.issuesByColumn).flat())
          .filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys)),
      });
      return;
    }
    if (selection.developerId != null && selection.statusKey == null) {
      const row = matrix.developers.find((d) => d.developer.id === selection.developerId);
      if (!row) {
        setSelection(null);
        return;
      }
      setSelection({
        ...selection,
        kind: 'issues',
        developerName: row.developer.displayName,
        issues: Object.values(row.issuesByColumn).flat(),
      });
      return;
    }
    if (selection.developerId != null && selection.statusKey != null) {
      const row = matrix.developers.find((d) => d.developer.id === selection.developerId);
      if (!row) {
        setSelection(null);
        return;
      }
      setSelection({
        ...selection,
        kind: 'issues',
        developerName: row.developer.displayName,
        issues: issuesForStatus(row.issuesByColumn, selection.statusKey, props.columns),
      });
      return;
    }
    if (selection.developerId == null && selection.statusKey != null) {
      setSelection({
        ...selection,
        kind: 'issues',
        issues: matrix.developers.flatMap((r) =>
          issuesForStatus(r.issuesByColumn, selection.statusKey!, props.columns),
        ),
      });
      return;
    }
    setSelection({
      ...selection,
      kind: 'issues',
      issues: matrix.developers.flatMap((r) => Object.values(r.issuesByColumn).flat()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrix, doneStatusKeys]);

  useEffect(() => {
    const key = `${sprintFilter ?? ''}|${reviewerFilter ?? ''}|${qaFilter ?? ''}|${authorFilter ?? ''}|${assigneeFilter ?? ''}|${props.snapshotDate ?? ''}`;
    if (allTasksKey.current === null || allTasksKey.current === key) {
      allTasksKey.current = key;
      keepCellOnFilterReset.current = false;
      return;
    }
    allTasksKey.current = key;
    if (keepCellOnFilterReset.current) {
      keepCellOnFilterReset.current = false;
      return;
    }
    const current = matrixRef.current;
    if (!current) return;
    setIssuesOpen(true);
    setSelection({
      kind: 'issues',
      developerId: null,
      developerName: 'Вся команда',
      statusKey: null,
      issues: current.developers.flatMap((row) => Object.values(row.issuesByColumn).flat()),
    });
  }, [sprintFilter, reviewerFilter, qaFilter, authorFilter, assigneeFilter, props.snapshotDate]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const metrics = layoutRef.current;
      if (dragging.current === 'filters' && boardRowRef.current) {
        const rect = boardRowRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          const draftsW = metrics.draftsOpen
            ? RIGHT_RAIL_PX + DRAFTS_MIN_PX
            : RIGHT_RAIL_PX;
          const maxLeft = rect.width - LEFT_RAIL_PX - draftsW - 240;
          const next = Math.max(
            DRAFTS_MIN_PX,
            Math.min(maxLeft, e.clientX - rect.left - LEFT_RAIL_PX),
          );
          setFiltersWidth(next);
        }
      }
      if (dragging.current === 'drafts' && boardRowRef.current) {
        const rect = boardRowRef.current.getBoundingClientRect();
        if (rect.width > 0) {
          const leftW = metrics.filtersOpen ? DRAFTS_MIN_PX + LEFT_RAIL_PX : LEFT_RAIL_PX;
          const room = Math.max(0, rect.width - leftW - RIGHT_RAIL_PX);
          let contentW = rect.right - e.clientX - RIGHT_RAIL_PX;
          const floor = metrics.panelFloor || DRAFTS_MIN_PX;
          contentW = Math.max(floor, Math.min(room, contentW));
          const fraction = contentW / rect.width;
          const draftsW = RIGHT_RAIL_PX + contentW;
          const filtersW = leftW;
          const centerW = rect.width - filtersW - draftsW;
          if (!metrics.tableShown && metrics.compactW > 0 && centerW < metrics.compactW) {
            if (holdReason.current !== 'user') {
              holdReason.current = 'drag';
              setHoldHidden(true);
            }
          } else if (holdReason.current === 'drag') {
            holdReason.current = null;
            setHoldHidden(false);
          }
          setDraftsFraction(fraction);
        }
      }
      if (splitDragging.current && centerRef.current) {
        const rect = centerRef.current.getBoundingClientRect();
        if (rect.height > 0) {
          let fraction = Math.min(0.92, Math.max(0.08, (e.clientY - rect.top) / rect.height));
          const slot = rect.height * fraction - 12;
          if (metrics.tableShown && metrics.compactH > 0 && slot < metrics.compactH) {
            fraction = Math.min(0.92, Math.max(fraction, (metrics.compactH + 12) / rect.height));
          } else if (!metrics.tableShown && metrics.compactH > 0 && slot < metrics.compactH) {
            if (holdReason.current !== 'user') {
              holdReason.current = 'drag';
              setHoldHidden(true);
            }
          } else if (holdReason.current === 'drag') {
            holdReason.current = null;
            setHoldHidden(false);
          }
          draggedTable.current = true;
          setTableFraction(fraction);
        }
      }
    };
    const onUp = () => {
      dragging.current = null;
      splitDragging.current = false;
      document.body.classList.remove('bro-drag-row', 'bro-drag-col');
      document.body.style.userSelect = '';
      setTableHover(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('bro-drag-row', 'bro-drag-col');
    };
  }, []);

  useLayoutEffect(() => {
    reapplyFade();
  });

  useLayoutEffect(() => {
    const row = boardRowRef.current;
    const center = centerRef.current;
    if (!row && !center) return;
    const update = () => {
      if (row) {
        const width = row.clientWidth;
        setRowWidth((prev) => (prev === width ? prev : width));
      }
      if (center) {
        const width = center.clientWidth;
        const height = center.clientHeight;
        setCenterBox((prev) =>
          prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (row) observer.observe(row);
    if (center) observer.observe(center);
    return () => observer.disconnect();
  }, [matrix]);

  function beginResize(axis: 'row' | 'col') {
    document.body.classList.remove('bro-drag-row', 'bro-drag-col');
    document.body.classList.add(axis === 'row' ? 'bro-drag-row' : 'bro-drag-col');
    document.body.style.userSelect = 'none';
    setTableHover(null);
  }

  function startPanelResize() {
    dragging.current = 'drafts';
    beginResize('col');
  }

  function startFiltersResize() {
    dragging.current = 'filters';
    beginResize('col');
  }

  function startSplitResize() {
    splitDragging.current = true;
    beginResize('row');
  }

  const columns = useMemo(() => {
    const base = matrix?.columns || [];
    const stored = props.columns.filter(
      (column) => props.activeBoardId == null || column.boardLocalId === props.activeBoardId,
    );
    if (!stored.length) return base;
    const byKey = new Map(stored.map((column) => [column.statusKey, column]));
    const byColumn = new Map(stored.map((column) => [column.columnId, column]));
    return base
      .map((column) => {
        const saved = byKey.get(column.statusKey) || byColumn.get(column.columnId);
        if (!saved) return { ...column, groupId: column.groupId ?? null };
        return { ...column, groupId: saved.groupId ?? null, sortOrder: saved.sortOrder };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }, [matrix, props.columns, props.activeBoardId]);
  const boardGroups = props.groups
    .filter((group) => group.boardLocalId === props.activeBoardId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const columnSlot = props.activeBoardId == null ? undefined : columnPrefs[String(props.activeBoardId)];
  const autoSkipColumns = new Set(
    props.activeBoardId == null ? [] : columnAutoSkip[String(props.activeBoardId)] || [],
  );
  const columnTaskTotal = (statusKey: string) => matrix?.columnTotals[statusKey] || 0;
  const shownColumns = columns.filter((column) => {
    if (reorderMode) return true;
    if (columnSlot?.hidden?.includes(column.statusKey)) return false;
    if (columnTaskTotal(column.statusKey) > 0) return true;
    if (column.groupId == null) return false;
    return columns.some(
      (other) =>
        other.groupId === column.groupId &&
        !columnSlot?.hidden?.includes(other.statusKey) &&
        columnTaskTotal(other.statusKey) > 0,
    );
  });
  const slots = tableSlots(shownColumns, boardGroups);
  const groupRow = groupHeaderCells(slots, boardGroups);
  const showGroupRow = groupRow.some((cell) => cell.kind === 'group');
  const groupHeaderKey = showGroupRow
    ? boardGroups.map((group) => `${group.id}:${group.collapsed ? 1 : 0}`).join('|')
    : '';
  useLayoutEffect(() => {
    const node = tableHostEl.current;
    if (!node) return;
    const header = Math.round(node.querySelector('thead')?.getBoundingClientRect().height ?? 0);
    const h = Math.round(node.clientHeight);
    setTableViewport((prev) => (prev.h === h && prev.header === header ? prev : { h, header }));
  }, [groupHeaderKey]);
  const headSticky = 'top-0';
  const shownStatusKeys = useMemo(
    () => new Set(shownColumns.map((column) => column.statusKey)),
    [shownColumns],
  );
  const countedPicks = useMemo(() => {
    const withTotal = (item: BoardPersonPick): BoardPersonPick => ({
      ...item,
      total: assigneeTaskCount(matrix, shownStatusKeys, item),
    });
    return {
      fromOthers: rowPicks.fromOthers.map(withTotal),
      fromParticipants: rowPicks.fromParticipants.map(withTotal),
    };
  }, [rowPicks, matrix, shownStatusKeys]);
  const fitRows = (matrix?.developers.length ?? 0) + (matrix ? 1 : 0);
  const matrixReady =
    matrix != null &&
    (matrix.sourceBoardLocalId == null || matrix.sourceBoardLocalId === props.activeBoardId);
  const fitKey = `${props.activeBoardId}|${fitRows}`;
  useEffect(() => {
    if (!matrix || !matrixReady) return;
    if (appliedTableFit.current === fitKey) return;
    const sameBoard = appliedTableFit.current.startsWith(`${props.activeBoardId}|`);
    if (sameBoard && draggedTable.current) return;
    if (!issuesOpen || tablePref == null) return;
    if (centerBox.h <= 0 && tablePref !== 'hidden') return;
    const previousBoard = appliedTableFit.current.split('|')[0];
    const boardChanged = previousBoard !== '' && previousBoard !== String(props.activeBoardId ?? '');
    appliedTableFit.current = fitKey;
    draggedTable.current = false;
    if (tablePref === 'hidden') collapseTable();
    else revealTable(tablePref, boardChanged);
  }, [fitKey, matrix, matrixReady, issuesOpen, centerBox.h, props.activeBoardId]);
  useEffect(() => {
    if (props.activeBoardId == null) return;
    const saved = readBoardScales()[String(props.activeBoardId)];
    if (!saved) return;
    modeExpect.current = saved.mode === 'mini' || saved.mode === 'full' ? saved.mode : null;
    sizeSide.current = null;
    setTableFraction(saved.fraction);
    setTablePref(saved.mode);
  }, [props.activeBoardId]);
  useEffect(() => {
    if (props.activeBoardId == null) return;
    if (tablePref !== 'mini' && tablePref !== 'full') return;
    writeBoardScale(props.activeBoardId, { fraction: tableFraction, mode: tablePref });
  }, [props.activeBoardId, tableFraction, tablePref]);
  useEffect(() => {
    const watch = iconFit.current;
    if (!watch.shown || watch.id == null || watch.col <= 0 || watch.row <= 0) return;
    if (watch.pref !== 'mini' && watch.pref !== 'full') return;
    const above = watch.col >= ICON_COL_PX && watch.row >= ICON_ROW_PX;
    const side = above ? 'above' : 'below';
    if (modeExpect.current) {
      if (sizeSide.current == null) {
        sizeSide.current = side;
        return;
      }
      if (sizeSide.current === side) return;
      modeExpect.current = null;
    }
    sizeSide.current = side;
    const next = above ? 'full' : 'mini';
    if (next !== watch.pref) {
      setTablePref(next);
      saveTableMode(next);
    }
  }, [centerBox.w, centerBox.h, tableFraction, tableShown, issuesOpen, props.activeBoardId, showGroupRow]);
  useEffect(() => {
    if (!tableShown && !issuesOpen) setFiltersOpen(false);
  }, [tableShown, issuesOpen]);
  const sprintCounts = sourceMatrix?.sprintCounts || [];
  const reviewerCounts = sourceMatrix?.reviewerCounts || [];
  const qaCounts = sourceMatrix?.qaCounts || [];
  const currentSprintId = getCurrentSprintId(
    sprintCounts,
    sprintFilter,
    sourceMatrix?.sprintTitle,
  );
  const sprintHeader = describeSprintHeader(sprintCounts, activeSprints, props.snapshotDate || null);
  const sprintTitle = sprintHeader.title;
  const sprintPeriod = sprintHeader.period;
  const sprintOutdated = sprintHeader.stale;
  const boardTotals = useMemo(() => {
    try {
      return boardStatusTotals(sourceMatrix, doneStatusKeys, finalKeys);
    } catch (error) {
      sessionLog('error', 'boardStatusTotals', { error, matrix: describeMatrix(sourceMatrix) });
      return { open: 0, done: 0, total: 0 };
    }
  }, [sourceMatrix, doneStatusKeys, finalKeys]);
  useEffect(() => {
    if (!sourceMatrix) {
      props.onHeaderChange({
        title: '',
        period: null,
        outdated: false,
        previous: false,
        open: 0,
        done: 0,
        total: 0,
      });
      return;
    }
    props.onHeaderChange({
      title: sprintTitle,
      period: sprintPeriod,
      outdated: sprintOutdated != null,
      previous: sprintHeader.extra == null && !activeSprints.size,
      open: boardTotals.open,
      done: boardTotals.done,
      total: boardTotals.total,
    });
  }, [
    sourceMatrix,
    sprintTitle,
    sprintPeriod,
    sprintOutdated,
    sprintHeader.extra,
    activeSprints,
    boardTotals,
    props.onHeaderChange,
  ]);

  function isCellSelected(developerId: number | null, statusKey: string | null): boolean {
    if (!selection || selection.kind !== 'issues') return false;
    return selection.developerId === developerId && selection.statusKey === statusKey;
  }

  function isTodoSelected(developerId: number): boolean {
    return selection?.kind === 'todos' && selection.developerId === developerId;
  }

  function choose(next: CellSelection, icon: CellBadgeKind | 'clear' = 'changes') {
    setIssuesOpen(true);
    setSelection(next);
    if (icon === 'clear') {
      if (activeIcon != null) {
        setActiveIcon(null);
        syncApplied({ icon: null });
      }
      return;
    }
    if (!pinnedIcons.has(icon)) {
      setActiveIcon(icon);
      syncApplied({ icon });
    }
  }

  function chooseByBadge(kind: CellBadgeKind, next: CellSelection) {
    choose(next, kind);
  }

  function resetLeftFilters() {
    const emptyNums = new Set<number>();
    const emptyNames = new Set<string>();
    setSprintFilter(null);
    setReviewerFilter(null);
    setQaFilter(null);
    setAuthorFilter(null);
    setAssigneeFilter(null);
    setPinnedSprints(emptyNums);
    setPinnedReviewers(emptyNames);
    setPinnedQas(emptyNames);
    setPinnedAuthors(emptyNames);
    setPinnedAssignees(emptyNames);
    setExcludedSprints(emptyNums);
    setExcludedReviewers(emptyNames);
    setExcludedQas(emptyNames);
    setExcludedAuthors(emptyNames);
    setExcludedAssignees(emptyNames);
    syncApplied({
      sprint: null,
      reviewer: null,
      qa: null,
      author: null,
      assignee: null,
      pinnedSprints: emptyNums,
      pinnedReviewers: emptyNames,
      pinnedQas: emptyNames,
      pinnedAuthors: emptyNames,
      pinnedAssignees: emptyNames,
      excludedSprints: emptyNums,
      excludedReviewers: emptyNames,
      excludedQas: emptyNames,
      excludedAuthors: emptyNames,
      excludedAssignees: emptyNames,
    });
  }

  function isLeftExcluded(group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee', key: number | string) {
    if (group === 'sprint') return excludedSprints.has(key as number);
    if (group === 'reviewer') return excludedReviewers.has(key as string);
    if (group === 'qa') return excludedQas.has(key as string);
    if (group === 'author') return excludedAuthors.has(key as string);
    return excludedAssignees.has(key as string);
  }

  function writeExcluded(group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee', key: number | string, mode: 'add' | 'drop') {
    if (group === 'sprint') {
      const next = new Set(excludedSprints);
      if (mode === 'add') next.add(key as number);
      else next.delete(key as number);
      setExcludedSprints(next);
      return next;
    }
    const current =
      group === 'reviewer'
        ? excludedReviewers
        : group === 'qa'
          ? excludedQas
          : group === 'author'
            ? excludedAuthors
            : excludedAssignees;
    const next = new Set(current);
    if (mode === 'add') next.add(key as string);
    else next.delete(key as string);
    if (group === 'reviewer') setExcludedReviewers(next);
    else if (group === 'qa') setExcludedQas(next);
    else if (group === 'author') setExcludedAuthors(next);
    else setExcludedAssignees(next);
    return next;
  }

  function selectLeft(
    group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee',
    key: number | string,
  ) {
    const pinned =
      group === 'sprint'
        ? pinnedSprints
        : group === 'reviewer'
          ? pinnedReviewers
          : group === 'qa'
            ? pinnedQas
            : group === 'author'
              ? pinnedAuthors
              : pinnedAssignees;
    const selected =
      group === 'sprint'
        ? sprintFilter
        : group === 'reviewer'
          ? reviewerFilter
          : group === 'qa'
            ? qaFilter
            : group === 'author'
              ? authorFilter
              : assigneeFilter;
    const active = pinned.has(key as never) || selected === key;
    if (isLeftExcluded(group, key)) {
      const next = writeExcluded(group, key, 'drop');
      syncApplied(
        group === 'sprint'
          ? { excludedSprints: next as Set<number> }
          : group === 'reviewer'
            ? { excludedReviewers: next as Set<string> }
            : group === 'qa'
              ? { excludedQas: next as Set<string> }
              : group === 'author'
                ? { excludedAuthors: next as Set<string> }
                : { excludedAssignees: next as Set<string> },
      );
      return;
    }
    if (active) {
      clearLeft(group, key);
      return;
    }
    if (group !== 'sprint') setSprintFilter(null);
    if (group !== 'reviewer') setReviewerFilter(null);
    if (group !== 'qa') setQaFilter(null);
    if (group !== 'author') setAuthorFilter(null);
    if (group !== 'assignee') setAssigneeFilter(null);
    const patch = {
      sprint: null as number | null,
      reviewer: null as string | null,
      qa: null as string | null,
      author: null as string | null,
      assignee: null as string | null,
    };
    if (group === 'sprint') {
      patch.sprint = key as number;
      setSprintFilter(patch.sprint);
    } else if (group === 'reviewer') {
      patch.reviewer = key as string;
      setReviewerFilter(patch.reviewer);
    } else if (group === 'qa') {
      patch.qa = key as string;
      setQaFilter(patch.qa);
    } else if (group === 'author') {
      patch.author = key as string;
      setAuthorFilter(patch.author);
    } else {
      patch.assignee = key as string;
      setAssigneeFilter(patch.assignee);
    }
    syncApplied(patch);
  }

  function pinLeft(group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee', key: number | string) {
    if (isLeftExcluded(group, key)) {
      const excluded = writeExcluded(group, key, 'drop');
      if (group === 'sprint') {
        const next = new Set(pinnedSprints);
        next.add(key as number);
        setPinnedSprints(next);
        syncApplied({ excludedSprints: excluded as Set<number>, pinnedSprints: next });
        return;
      }
      const current =
        group === 'reviewer'
          ? pinnedReviewers
          : group === 'qa'
            ? pinnedQas
            : group === 'author'
              ? pinnedAuthors
              : pinnedAssignees;
      const next = new Set(current);
      next.add(key as string);
      if (group === 'reviewer') setPinnedReviewers(next);
      else if (group === 'qa') setPinnedQas(next);
      else if (group === 'author') setPinnedAuthors(next);
      else setPinnedAssignees(next);
      syncApplied({
        ...(group === 'reviewer'
          ? { excludedReviewers: excluded as Set<string>, pinnedReviewers: next }
          : group === 'qa'
            ? { excludedQas: excluded as Set<string>, pinnedQas: next }
            : group === 'author'
              ? { excludedAuthors: excluded as Set<string>, pinnedAuthors: next }
              : { excludedAssignees: excluded as Set<string>, pinnedAssignees: next }),
      });
      return;
    }
    if (group === 'sprint') {
      const id = key as number;
      const next = new Set(pinnedSprints);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPinnedSprints(next);
      if (sprintFilter === id) setSprintFilter(null);
      syncApplied({ pinnedSprints: next, ...(sprintFilter === id ? { sprint: null } : {}) });
      return;
    }
    const name = key as string;
    const current =
      group === 'reviewer'
        ? pinnedReviewers
        : group === 'qa'
          ? pinnedQas
          : group === 'author'
            ? pinnedAuthors
            : pinnedAssignees;
    const selected =
      group === 'reviewer'
        ? reviewerFilter
        : group === 'qa'
          ? qaFilter
          : group === 'author'
            ? authorFilter
            : assigneeFilter;
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    if (group === 'reviewer') setPinnedReviewers(next);
    else if (group === 'qa') setPinnedQas(next);
    else if (group === 'author') setPinnedAuthors(next);
    else setPinnedAssignees(next);
    if (selected === name) {
      if (group === 'reviewer') setReviewerFilter(null);
      else if (group === 'qa') setQaFilter(null);
      else if (group === 'author') setAuthorFilter(null);
      else setAssigneeFilter(null);
    }
    syncApplied({
      ...(group === 'reviewer'
        ? { pinnedReviewers: next }
        : group === 'qa'
          ? { pinnedQas: next }
          : group === 'author'
            ? { pinnedAuthors: next }
            : { pinnedAssignees: next }),
      ...(selected === name
        ? group === 'reviewer'
          ? { reviewer: null }
          : group === 'qa'
            ? { qa: null }
            : group === 'author'
              ? { author: null }
              : { assignee: null }
        : {}),
    });
  }

  function excludeLeft(group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee', key: number | string) {
    if (isLeftExcluded(group, key)) {
      const excluded = writeExcluded(group, key, 'drop');
      if (group === 'sprint') {
        const pins = new Set(pinnedSprints);
        pins.delete(key as number);
        setPinnedSprints(pins);
        if (sprintFilter === key) setSprintFilter(null);
        syncApplied({
          excludedSprints: excluded as Set<number>,
          pinnedSprints: pins,
          ...(sprintFilter === key ? { sprint: null } : {}),
        });
        return;
      }
      const name = key as string;
      const current =
        group === 'reviewer'
          ? pinnedReviewers
          : group === 'qa'
            ? pinnedQas
            : group === 'author'
              ? pinnedAuthors
              : pinnedAssignees;
      const selected =
      group === 'reviewer'
        ? reviewerFilter
        : group === 'qa'
          ? qaFilter
          : group === 'author'
            ? authorFilter
            : assigneeFilter;
      const pins = new Set(current);
      pins.delete(name);
      if (group === 'reviewer') setPinnedReviewers(pins);
      else if (group === 'qa') setPinnedQas(pins);
      else if (group === 'author') setPinnedAuthors(pins);
      else setPinnedAssignees(pins);
      if (selected === name) {
        if (group === 'reviewer') setReviewerFilter(null);
        else if (group === 'qa') setQaFilter(null);
        else if (group === 'author') setAuthorFilter(null);
        else setAssigneeFilter(null);
      }
      syncApplied({
        ...(group === 'reviewer'
          ? { excludedReviewers: excluded as Set<string>, pinnedReviewers: pins }
          : group === 'qa'
            ? { excludedQas: excluded as Set<string>, pinnedQas: pins }
            : group === 'author'
              ? { excludedAuthors: excluded as Set<string>, pinnedAuthors: pins }
              : { excludedAssignees: excluded as Set<string>, pinnedAssignees: pins }),
        ...(selected === name
          ? group === 'reviewer'
            ? { reviewer: null }
            : group === 'qa'
              ? { qa: null }
              : group === 'author'
                ? { author: null }
                : { assignee: null }
          : {}),
      });
      return;
    }
    const excluded = writeExcluded(group, key, 'add');
    if (group === 'sprint') {
      const id = key as number;
      const pins = new Set(pinnedSprints);
      pins.delete(id);
      setPinnedSprints(pins);
      if (sprintFilter === id) setSprintFilter(null);
      syncApplied({
        excludedSprints: excluded as Set<number>,
        pinnedSprints: pins,
        ...(sprintFilter === id ? { sprint: null } : {}),
      });
      return;
    }
    const name = key as string;
    const current =
      group === 'reviewer'
        ? pinnedReviewers
        : group === 'qa'
          ? pinnedQas
          : group === 'author'
            ? pinnedAuthors
            : pinnedAssignees;
    const selected =
      group === 'reviewer'
        ? reviewerFilter
        : group === 'qa'
          ? qaFilter
          : group === 'author'
            ? authorFilter
            : assigneeFilter;
    const pins = new Set(current);
    pins.delete(name);
    if (group === 'reviewer') setPinnedReviewers(pins);
    else if (group === 'qa') setPinnedQas(pins);
    else if (group === 'author') setPinnedAuthors(pins);
    else setPinnedAssignees(pins);
    if (selected === name) {
      if (group === 'reviewer') setReviewerFilter(null);
      else if (group === 'qa') setQaFilter(null);
      else if (group === 'author') setAuthorFilter(null);
      else setAssigneeFilter(null);
    }
    syncApplied({
      ...(group === 'reviewer'
        ? { excludedReviewers: excluded as Set<string>, pinnedReviewers: pins }
        : group === 'qa'
          ? { excludedQas: excluded as Set<string>, pinnedQas: pins }
          : group === 'author'
            ? { excludedAuthors: excluded as Set<string>, pinnedAuthors: pins }
            : { excludedAssignees: excluded as Set<string>, pinnedAssignees: pins }),
      ...(selected === name
        ? group === 'reviewer'
          ? { reviewer: null }
          : group === 'qa'
            ? { qa: null }
            : group === 'author'
              ? { author: null }
              : { assignee: null }
        : {}),
    });
  }

  function clearLeft(group: 'sprint' | 'reviewer' | 'qa' | 'author' | 'assignee', key: number | string) {
    if (group === 'sprint') {
      const next = new Set(pinnedSprints);
      next.delete(key as number);
      setPinnedSprints(next);
      if (sprintFilter === key) setSprintFilter(null);
      syncApplied({ pinnedSprints: next, ...(sprintFilter === key ? { sprint: null } : {}) });
      return;
    }
    if (group === 'reviewer') {
      const next = new Set(pinnedReviewers);
      next.delete(key as string);
      setPinnedReviewers(next);
      if (reviewerFilter === key) setReviewerFilter(null);
      syncApplied({ pinnedReviewers: next, ...(reviewerFilter === key ? { reviewer: null } : {}) });
      return;
    }
    if (group === 'qa') {
      const next = new Set(pinnedQas);
      next.delete(key as string);
      setPinnedQas(next);
      if (qaFilter === key) setQaFilter(null);
      syncApplied({ pinnedQas: next, ...(qaFilter === key ? { qa: null } : {}) });
      return;
    }
    if (group === 'assignee') {
      const next = new Set(pinnedAssignees);
      next.delete(key as string);
      setPinnedAssignees(next);
      if (assigneeFilter === key) setAssigneeFilter(null);
      syncApplied({ pinnedAssignees: next, ...(assigneeFilter === key ? { assignee: null } : {}) });
      return;
    }
    const next = new Set(pinnedAuthors);
    next.delete(key as string);
    setPinnedAuthors(next);
    if (authorFilter === key) setAuthorFilter(null);
    syncApplied({ pinnedAuthors: next, ...(authorFilter === key ? { author: null } : {}) });
  }

  function clickIconFilter(kind: CellBadgeKind) {
    if (pinnedIcons.has(kind) || activeIcon === kind) {
      const next = new Set(pinnedIcons);
      next.delete(kind);
      setPinnedIcons(next);
      if (activeIcon === kind) setActiveIcon(null);
      syncApplied({ pinnedIcons: next, ...(activeIcon === kind ? { icon: null } : {}) });
      return;
    }
    setActiveIcon(kind);
    syncApplied({ icon: kind });
  }

  function pinIconFilter(kind: CellBadgeKind) {
    const next = new Set(pinnedIcons);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setPinnedIcons(next);
    if (activeIcon === kind) setActiveIcon(null);
    syncApplied({ pinnedIcons: next, ...(activeIcon === kind ? { icon: null } : {}) });
  }

  function resetTaskFilters() {
    clearFadePreview();
    fadeThen(() => resetTaskFiltersNow());
  }

  function resetTaskFiltersNow() {
    keepCellOnFilterReset.current = true;
    setActiveIcon(null);
    setPinnedIcons(new Set());
    setSprintFilter(null);
    setReviewerFilter(null);
    setQaFilter(null);
    setAuthorFilter(null);
    setAssigneeFilter(null);
    setPinnedSprints(new Set());
    setPinnedReviewers(new Set());
    setPinnedQas(new Set());
    setPinnedAuthors(new Set());
    setPinnedAssignees(new Set());
    setExcludedSprints(new Set());
    setExcludedReviewers(new Set());
    setExcludedQas(new Set());
    setExcludedAuthors(new Set());
    setExcludedAssignees(new Set());
    const emptyNums = new Set<number>();
    const emptyNames = new Set<string>();
    const emptyIcons = new Set<CellBadgeKind>();
    syncApplied({
      icon: null,
      pinnedIcons: emptyIcons,
      sprint: null,
      reviewer: null,
      qa: null,
      author: null,
      assignee: null,
      pinnedSprints: emptyNums,
      pinnedReviewers: emptyNames,
      pinnedQas: emptyNames,
      pinnedAuthors: emptyNames,
      pinnedAssignees: emptyNames,
      excludedSprints: emptyNums,
      excludedReviewers: emptyNames,
      excludedQas: emptyNames,
      excludedAuthors: emptyNames,
      excludedAssignees: emptyNames,
    });
  }

  function enableShowDone() {
    fadeThen(() => {
      setShowDoneIssues(true);
      saveShowDone(true);
      syncApplied({ showDone: true });
    });
  }

  const cellVeil = "after:pointer-events-none after:absolute after:inset-0 after:content-['']";
  function shade(row: number | 'total' | 'head', col: string) {
    if (!tableHover) return '';
    const rowOn = tableHover.row === row;
    const colOn = tableHover.col === col;
    if (rowOn && colOn) return `${cellVeil} after:bg-black/[0.15]`;
    if (rowOn || colOn) return `${cellVeil} after:bg-black/[0.05]`;
    return '';
  }

  function selectAllTasks() {
    if (!matrix) return;
    choose(
      {
        kind: 'issues',
        developerId: null,
        developerName: 'Вся команда',
        statusKey: null,
        issues: matrix.developers.flatMap((row) =>
          columns.flatMap((column) => row.issuesByColumn[column.statusKey] || []),
        ),
      },
      'clear',
    );
  }

  const castPersonWatch = useRef({ on: false, id: null as number | null });
  useEffect(() => {
    const prev = castPersonWatch.current;
    castPersonWatch.current = { on: castOn, id: castPersonId };
    if (!prev.on || !castOn) return;
    if (prev.id == null || castPersonId == null || prev.id === castPersonId) return;
    selectAllTasks();
  }, [castOn, castPersonId]);

  function chooseBoardScope(scope: BoardScope) {
    showWorkBusy();
    window.setTimeout(() => {
      setBoardScope(scope);
      const showDone = scope !== 'open';
      setShowDoneIssues(showDone);
      saveShowDone(showDone);
      syncApplied({ showDone });
      selectAllTasks();
    }, 0);
  }

  function selectPending(
    developerId: number | null,
    developerName: string,
    issues: TrackerIssue[],
    icon: CellBadgeKind | 'clear' = 'clear',
  ) {
    choose(
      {
        kind: 'issues',
        developerId,
        developerName,
        statusKey: PENDING_COLUMN,
        issues: issues.filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys)),
      },
      icon,
    );
  }

  function setRightTool(next: RightTool) {
    rightToolTouched.current = true;
    setRightToolState(next);
    saveRightToolLocal(next);
    void window.api.saveRightTool(next);
  }

  useEffect(() => {
    let cancel = false;
    void window.api.getRightTool().then((stored) => {
      if (cancel || rightToolTouched.current) return;
      if (stored == null) {
        void window.api.saveRightTool(loadRightTool());
        return;
      }
      setRightToolState(stored);
      saveRightToolLocal(stored);
    });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        filtersOpen,
        issuesOpen,
        draftsOpen,
        tableFraction,
        draftsFraction,
        filtersWidth,
      }),
    );
  }, [filtersOpen, issuesOpen, draftsOpen, tableFraction, draftsFraction, filtersWidth]);

  useEffect(() => {
    setExpandedKeys(new Set());
  }, [selection?.kind, selection?.developerId, selection?.statusKey]);

  useEffect(() => {
    setReorderMode(false);
    const snap = editSnap.current;
    editSnap.current = null;
    if (!snap) return;
    setFiltersOpen(snap.filtersOpen);
    setIssuesOpen(snap.issuesOpen);
    setRightTool(snap.rightTool);
    setTableShown(snap.tableShown);
    saveTableShown(snap.tableShown);
    setConsoleOpen(snap.consoleOpen);
  }, [props.activeBoardId]);

  useEffect(() => {
    if (!reorderMode) setOthersMenu(null);
  }, [reorderMode]);

  function updateRowPrefs(boardId: number, person: Developer, mode: 'hide' | 'show') {
    setRowPrefs((prev) => {
      const key = String(boardId);
      const slot = prev[key] || { hidden: [], shown: [] };
      const hidden = slot.hidden.filter((id) => id !== person.id);
      const shown = slot.shown.filter((id) => id !== person.id);
      const nextSlot =
        mode === 'hide'
          ? { hidden: [...hidden, person.id], shown }
          : { hidden, shown: person.hidden ? [...shown, person.id] : shown };
      const next = { ...prev, [key]: nextSlot };
      rowPrefsTouched.current = true;
      saveBoardRowPrefs(next);
      void window.api.saveBoardRowPrefs(next);
      return next;
    });
    setOthersMenu(null);
  }

  function writeColumnPrefs(boardId: number, statusKey: string, mode: 'fix' | 'release' | 'show') {
    setColumnPrefs((prev) => {
      const key = String(boardId);
      const slot = prev[key] || { hidden: [], shown: [] };
      const hidden = slot.hidden.filter((item) => item !== statusKey);
      const shown = slot.shown.filter((item) => item !== statusKey);
      const nextSlot =
        mode === 'fix'
          ? { hidden: [...hidden, statusKey], shown }
          : mode === 'show'
            ? { hidden, shown: [...shown, statusKey] }
            : { hidden, shown };
      const next = { ...prev, [key]: nextSlot };
      saveBoardColPrefs(next);
      return next;
    });
  }

  function toggleColumnHideFix(statusKey: string) {
    if (props.activeBoardId == null) return;
    const fixed = columnSlot?.hidden?.includes(statusKey) ?? false;
    writeColumnPrefs(props.activeBoardId, statusKey, fixed ? 'release' : 'fix');
  }

  function toggleColumnAutoSkip(statusKey: string) {
    if (props.activeBoardId == null) return;
    const boardKey = String(props.activeBoardId);
    setColumnAutoSkip((prev) => {
      const current = prev[boardKey] || [];
      const nextKeys = current.includes(statusKey)
        ? current.filter((item) => item !== statusKey)
        : [...current, statusKey];
      const next = { ...prev, [boardKey]: nextKeys };
      saveColumnAutoSkip(next);
      return next;
    });
  }

  async function addRowOnBoard(pick: BoardPersonPick) {
    if (props.activeBoardId == null) return;
    let person = pick.participant;
    try {
      if (!person) {
        const login =
          pick.login.trim() ||
          (pick.uid.trim() ? `uid-${pick.uid.trim()}` : `name-${pick.label.trim() || 'assignee'}`);
        const saved = await window.api.replaceDevelopers([
          ...props.participants,
          {
            login,
            displayName: pick.label,
            uid: pick.uid,
            color: 'auto',
            sortOrder: props.participants.length,
            role: 'developer',
            onVacation: false,
            hidden: true,
            summary: true,
          },
        ]);
        props.onDevelopersChange(saved);
        person = saved.find((item) => item.login === login) ?? null;
      }
      if (!person) return;
      updateRowPrefs(props.activeBoardId, person, 'show');
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
    }
  }

  function openPeopleMenu(event: { currentTarget: HTMLElement }) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 224;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const top =
      rect.bottom + 8 + 280 > window.innerHeight ? Math.max(8, rect.top - 280) : rect.bottom + 4;
    setOthersMenu((open) => (open ? null : { top, left }));
  }

  function leaveReorder() {
    setReorderMode(false);
    const snap = editSnap.current;
    editSnap.current = null;
    if (!snap) return;
    setFiltersOpen(snap.filtersOpen);
    setIssuesOpen(snap.issuesOpen);
    setRightTool(snap.rightTool);
    setTableShown(snap.tableShown);
    saveTableShown(snap.tableShown);
    setConsoleOpen(snap.consoleOpen);
  }

  function resetEveryFilter() {
    if (reorderMode) leaveReorder();
    setCastOn(false);
    localStorage.removeItem(LEFT_FILTERS_KEY);
    clearFadePreview();
    fadeThen(() => {
      resetTaskFiltersNow();
      setBoardScope('total');
      setShowDoneIssues(true);
      saveShowDone(true);
      syncApplied({ showDone: true });
      setListFilterEpoch((epoch) => epoch + 1);
      selectAllTasks();
    });
  }

  function toggleEdit() {
    if (reorderMode) {
      leaveReorder();
      return;
    }
    if (!tableShown) return;
    editSnap.current = { filtersOpen, issuesOpen, rightTool, tableShown, consoleOpen };
    setReorderMode(true);
    setFiltersOpen(false);
    setIssuesOpen(false);
    setConsoleOpen(false);
    if (rightTool !== 'off') setRightTool('off');
  }

  const editMuted = !tableShown && !reorderMode;
  const editButton = editSlot
    ? createPortal(
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Сбросить фильтры на всех досках"
            className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            onClick={resetEveryFilter}
          >
            Сбросить все фильтры
          </button>
          <button
            type="button"
            aria-pressed={reorderMode}
            disabled={editMuted}
            title="Редактировать таблицу"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${
              reorderMode
                ? 'border-[#3647d2] bg-[#3647d2] text-white hover:border-[#2a38b0] hover:bg-[#2a38b0]'
                : editMuted
                  ? 'cursor-default border-slate-200 bg-slate-50 text-slate-400'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            onClick={toggleEdit}
          >
            <TableIcon className="h-3.5 w-3.5" />
            Редактировать таблицу
          </button>
          <button
            type="button"
            aria-pressed={crossOn}
            disabled={crossBusy || props.refreshingBoardId != null}
            title="Учитывать задачи других досок, которые есть и на этой"
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium disabled:opacity-50 ${
              crossOn
                ? 'border-[#3647d2] bg-[#3647d2] text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => {
              if (props.activeBoardId == null || crossLock.current) return;
              const boardId = props.activeBoardId;
              const turningOn = !crossBoards[String(boardId)];
              crossLock.current = true;
              setCrossBusy(true);
              void (async () => {
                try {
                  if (turningOn && localStorage.getItem(CROSS_PRIMED_KEY) !== '1') {
                    const ready = props.onPrepareCross ? await props.onPrepareCross() : false;
                    if (!ready) return;
                    localStorage.setItem(CROSS_PRIMED_KEY, '1');
                  }
                  setCrossBoards((prev) => {
                    const next = { ...prev, [String(boardId)]: turningOn };
                    saveCrossBoards(next);
                    props.onCrossChange?.();
                    return next;
                  });
                } finally {
                  crossLock.current = false;
                  setCrossBusy(false);
                }
              })();
            }}
          >
            <ShuffleIcon className="h-3.5 w-3.5" />
            Перекрёстные задачи
          </button>
        </div>,
        editSlot,
      )
    : null;

  function tableCorner() {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <button
          ref={peopleButtonRef}
          type="button"
          disabled={readOnly}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
            readOnly ? 'cursor-default text-slate-300' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
          }`}
          onClick={(event) => {
            if (readOnly) return;
            if (othersMenu) {
              setOthersMenu(null);
              return;
            }
            openPeopleMenu(event);
          }}
        >
          <UsersIcon className="h-3.5 w-3.5" />
          Исполнители
        </button>
      </div>
    );
  }

  function rememberTablePref(mode: TablePref) {
    draggedTable.current = false;
    setTablePref(mode);
    saveTableMode(mode);
  }

  function changeListSort(next: ListSort) {
    setListSort(next);
    saveListSort(next);
  }

  async function reloadTodosIntoMatrix(): Promise<void> {
    if (!sourceMatrix) return;
    const all = await window.api.listDeveloperTodos();
    const byDev: Record<number, typeof all> = {};
    for (const t of all) {
      if (!byDev[t.developerId]) byDev[t.developerId] = [];
      byDev[t.developerId].push(t);
    }
    props.onMatrixChange({
      ...sourceMatrix,
      developers: sourceMatrix.developers.map((r) => ({
        ...r,
        todos: byDev[r.developer.id] || [],
      })),
    });
    props.onSnapshotContentChange();
  }

  async function persistDevelopers(rows: BoardMatrix['developers']): Promise<Developer[]> {
    const saved = await window.api.replaceDevelopers(
      rows
        .filter((r) => r.developer.id > 0)
        .map((r, index) => ({
          ...r.developer,
          sortOrder: index,
        })),
    );
    props.onDevelopersChange(saved);
    if (sourceMatrix) {
      const byLogin = new Map(saved.map((d) => [d.login, d]));
      props.onMatrixChange({
        ...sourceMatrix,
        developers: rows.map((row) => ({
          ...row,
          developer: byLogin.get(row.developer.login) || row.developer,
        })),
      });
    }
    return saved;
  }

  async function persistColumns(cols: BoardColumnConfig[]): Promise<BoardColumnConfig[]> {
    const enabledOrder = cols.map((c, index) => ({ ...c, sortOrder: index }));
    const allCurrent = await window.api.listColumns();
    const enabledKeys = new Set(enabledOrder.map((c) => `${c.boardLocalId}:${c.statusKey}`));
    const disabled = allCurrent
      .filter((c) => !enabledKeys.has(`${c.boardLocalId}:${c.statusKey}`))
      .map((c, i) => ({ ...c, sortOrder: enabledOrder.length + i }));
    const saved = await window.api.replaceColumns([...enabledOrder, ...disabled]);
    props.onColumnsChange(saved);
    if (sourceMatrix) {
      props.onMatrixChange({
        ...sourceMatrix,
        columns: saved.filter(
          (c) => props.activeBoardId == null || c.boardLocalId === props.activeBoardId,
        ),
      });
    }
    return saved;
  }

  async function persistLayout(next: BoardColumnConfig[]) {
    const boardId = props.activeBoardId;
    if (boardId == null) {
      await persistColumns(next);
      return;
    }
    const rank = new Map<number, number>();
    next.forEach((column, index) => {
      if (column.groupId != null && !rank.has(column.groupId)) rank.set(column.groupId, index);
    });
    const drafts = props.groups
      .filter((group) => group.boardLocalId === boardId)
      .slice()
      .sort((a, b) => (rank.get(a.id) ?? a.sortOrder) - (rank.get(b.id) ?? b.sortOrder) || a.id - b.id)
      .map((group, index) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        sortOrder: index,
        collapsed: group.collapsed,
        statusKeys: next.filter((column) => column.groupId === group.id).map((column) => column.statusKey),
      }));
    const saved = await window.api.saveColumnGroups(
      boardId,
      drafts,
      next.map((column) => column.statusKey),
    );
    props.onGroupsChange(saved.groups);
    props.onColumnsChange(saved.columns);
  }

  function reorderColumns(fromKey: string, toKey: string) {
    if (readOnly || fromKey === toKey) return;
    const next = fromKey.startsWith('group:')
      ? moveGroupBefore(columns, Number(fromKey.slice('group:'.length)), toKey)
      : placeColumn(columns, fromKey, toKey);
    if (next === columns) return;
    void persistLayout(next);
  }

  function toggleGroupAutoSkip(group: ColumnGroup) {
    if (props.activeBoardId == null) return;
    const keys = columns.filter((column) => column.groupId === group.id).map((column) => column.statusKey);
    if (!keys.length) return;
    const boardKey = String(props.activeBoardId);
    setColumnAutoSkip((prev) => {
      const current = new Set(prev[boardKey] || []);
      const allOn = keys.every((key) => current.has(key));
      for (const key of keys) {
        if (allOn) current.delete(key);
        else current.add(key);
      }
      const next = { ...prev, [boardKey]: [...current] };
      saveColumnAutoSkip(next);
      return next;
    });
  }

  async function toggleGroup(group: ColumnGroup) {
    const boardId = group.boardLocalId;
    const drafts = props.groups
      .filter((item) => item.boardLocalId === boardId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        sortOrder: item.sortOrder,
        collapsed: item.id === group.id ? !item.collapsed : item.collapsed,
        statusKeys: props.columns.filter((column) => column.groupId === item.id).map((column) => column.statusKey),
      }));
    const saved = await window.api.saveColumnGroups(boardId, drafts);
    props.onGroupsChange(saved.groups);
    props.onColumnsChange(saved.columns);
  }

  function reorderDevelopers(fromId: number, toId: number) {
    if (readOnly || !sourceMatrix || fromId === toId || fromId < 0 || toId < 0) return;
    const next = [...sourceMatrix.developers];
    const from = next.findIndex((row) => row.developer.id === fromId);
    const to = next.findIndex((row) => row.developer.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    void persistDevelopers(next);
  }

  if (!sourceMatrix && props.setupKind === 'integration') {
    return (
      <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h2 className="text-lg font-semibold mb-2">Нужна начальная настройка</h2>
        <p className="mb-4 text-sm">
          Укажите подключение к Tracker, добавьте разработчиков и выберите колонки доски.
        </p>
        <button
          className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
          onClick={() => props.onGoSettings('integrations')}
        >
          Открыть настройки
        </button>
      </div>
    );
  }

  if (!sourceMatrix && props.setupKind === 'boards') {
    return (
      <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h2 className="text-lg font-semibold mb-2">Добавьте доску</h2>
        <p className="mb-4 text-sm">
          Подключение есть. Добавьте доску в разделе «Доски», колонки подтянутся сами.
        </p>
        <button
          className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white"
          onClick={() => props.onGoSettings('boards')}
        >
          Доски
        </button>
      </div>
    );
  }

  const paintKey = `${props.activeBoardId}|${sourceMatrix?.sourceBoardLocalId ?? 'none'}|${matrix ? 'view' : 'empty'}`;
  if (renderStamp.current !== paintKey) {
    renderStamp.current = paintKey;
    sessionLog('info', 'board paint', {
      activeBoardId: props.activeBoardId,
      view: matrix ? 'table' : 'empty',
      participants: props.participants.length,
      columns: props.columns.length,
      matrix: describeMatrix(sourceMatrix),
    });
  }

  const summaryPanel = paintStage === 'summary' ? (
    <SummaryDock
      boardLocalId={props.activeBoardId}
      trackerBoardId={props.boards.find((item) => item.id === props.activeBoardId)?.trackerBoardId ?? null}
      queueKey={props.boards.find((item) => item.id === props.activeBoardId)?.queueKey || ''}
      boards={props.boards}
      participants={props.participants}
      columns={props.columns}
      personId={summaryPersonId}
      period={summaryPeriod}
      castOn={castOn}
      onPersonId={(id) => {
        setSummaryPersonId(id);
        if (id == null) setCastOn(false);
      }}
      onCast={() => {
        if (summaryPersonId == null && !castOn) return;
        setCastOn((on) => !on);
      }}
      onOpenBoard={(id) => {
        if (id == null) return;
        setTableShown(true);
        saveTableShown(true);
        props.onActiveBoard(id);
      }}
      onPeriod={setSummaryPeriod}
      onMatrix={(next) => {
        if (props.readOnly) return;
        props.onMatrixChange(next);
      }}
      onIssueHover={(issueKey, boardLocalId, trackerBoardIds) => {
        if (!issueKey) {
          setHighlightIssueKey(null);
          if (summaryHoverTimer.current != null) window.clearTimeout(summaryHoverTimer.current);
          summaryHoverTimer.current = window.setTimeout(() => {
            summaryHoverTimer.current = null;
            setSummaryTabs(null);
          }, 1000);
          return;
        }
        if (summaryHoverTimer.current != null) {
          window.clearTimeout(summaryHoverTimer.current);
          summaryHoverTimer.current = null;
        }
        const known = trackerBoardIds.length ? trackerBoardIds : boardIdsInMatrix(sourceMatrix, issueKey);
        const members = new Set<number>();
        if (boardLocalId != null) members.add(boardLocalId);
        if (crossOn) {
          for (const board of props.boards) {
            if (board.enabled && known.includes(board.trackerBoardId)) members.add(board.id);
          }
        }
        const onTable = matrixHasIssue(matrix, issueKey);
        if (members.size === 0 && onTable && props.activeBoardId != null) members.add(props.activeBoardId);
        setHighlightIssueKey(onTable ? issueKey : null);
        setSummaryTabs(members.size ? [...members] : null);
      }}
    />
  ) : null;

  if (!matrix || !sourceMatrix) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
      <div ref={boardRowRef} className="flex min-h-0 flex-1 items-stretch overflow-hidden">
        <div className="m-3 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-6">
          <p className="mb-3 text-slate-600">Нажмите «Обновить», чтобы загрузить задачи из Трекера.</p>
          <button
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white"
            onClick={props.onRefresh}
          >
            Обновить
          </button>
        </div>
        <DraftsSide
          open={draftsOpen}
          width={
            rowWidth > 0
              ? Math.min(
                  Math.max(0, rowWidth - LEFT_RAIL_PX - RIGHT_RAIL_PX),
                  Math.max(summaryOpen ? SUMMARY_MIN_PX : DRAFTS_MIN_PX, Math.round(rowWidth * draftsFraction)),
                )
              : 420
          }
          summary={summaryOpen}
          onOpenChange={(open) => {
            setRightTool(open ? 'drafts' : 'off');
          }}
          onToggleSummary={() => {
            setRightTool(summaryOpen ? 'off' : 'summary');
          }}
          summaryPanel={summaryPanel}
          onResizeStart={startPanelResize}
          onError={props.onError}
          onSnapshotContentChange={props.onSnapshotContentChange}
          consoleOpen={consoleOpen}
          onToggleConsole={() => setConsoleOpen((open) => !open)}
        />
      </div>
      <ConsoleDock open={consoleOpen} height={consoleHeight} onHeight={setConsoleHeight} />
      </div>
    );
  }

  const cellSelectedClass = 'bro-cell-selected';
  const grandFigures = splitVisible(
    visibleIssuesByColumn(matrix, columns),
    columns,
    doneStatusKeys,
    finalKeys,
  );
  const grandIssues = matrix.developers.flatMap((developerRow) =>
    columns.flatMap((column) => developerRow.issuesByColumn[column.statusKey] || []),
  );
  const grandPoints = storyPointsTotal(grandIssues);
  const grandOpenPoints = storyPointsTotal(grandIssues.filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys)));
  const showPending = grandFigures.open > 0 && !reorderMode;
  const dataCols = slots.length + (showPending ? 2 : 1);
  const developerRows = matrix.developers;
  function columnDropMark(statusKey: string): string {
    if (draggingCol === statusKey) return 'bro-drag-source';
    if (!draggingCol || dropColKey !== statusKey) return '';
    const from = columns.findIndex((col) => col.statusKey === draggingCol);
    const to = columns.findIndex((col) => col.statusKey === statusKey);
    if (from < 0 || to < 0 || from === to) return '';
    return from < to ? 'bro-insert-after' : 'bro-insert-before';
  }
  function rowDropMark(devId: number): string {
    if (draggingDev === devId) return 'bro-drag-source';
    if (draggingDev == null || dropDevId !== devId || devId < 0) return '';
    const from = developerRows.findIndex((row) => row.developer.id === draggingDev);
    const to = developerRows.findIndex((row) => row.developer.id === devId);
    if (from < 0 || to < 0 || from === to) return '';
    return from < to ? 'bro-insert-below' : 'bro-insert-above';
  }
  function allowColumnDrop(event: DragEvent, statusKey: string) {
    const from = dragColKey.current;
    if (!from || readOnly) return;
    if (!from.startsWith('group:')) {
      const source = columns.find((column) => column.statusKey === from);
      const target = columns.find((column) => column.statusKey === statusKey);
      if (!source || !target) return;
      const sourceGroup = source.groupId ?? null;
      const targetGroup = target.groupId ?? null;
      if (sourceGroup !== targetGroup && sourceGroup != null) return;
    }
    event.preventDefault();
    if (dropColKey !== statusKey) setDropColKey(statusKey);
  }
  function dropColumn(event: DragEvent, statusKey: string) {
    event.preventDefault();
    const from = dragColKey.current;
    dragColKey.current = null;
    setDraggingCol(null);
    setDropColKey(null);
    if (from) reorderColumns(from, statusKey);
  }
  function allowRowDrop(event: DragEvent, devId: number) {
    if (dragDevId.current == null || readOnly || devId < 0) return;
    event.preventDefault();
    if (dropDevId !== devId) setDropDevId(devId);
  }
  function dropRow(event: DragEvent, devId: number) {
    event.preventDefault();
    const from = dragDevId.current;
    dragDevId.current = null;
    setDraggingDev(null);
    setDropDevId(null);
    if (from != null) reorderDevelopers(from, devId);
  }
  const bodyRows = matrix.developers.length + 1;
  const splitHeader =
    showGroupRow && slots.some((slot) => slot.kind === 'column' && slot.column.groupId != null);
  const headerUnits = splitHeader ? 2 : 1;
  const fullHeaderPx = FULL_HEADER_PX * headerUnits;
  const compactHeaderPx = COMPACT_HEADER_PX * headerUnits;
  const compactW = tableWidth(dataCols, COMPACT_COL_PX);
  const panelFloor = summaryOpen ? SUMMARY_MIN_PX : DRAFTS_MIN_PX;
  const panelWanted =
    rowWidth > 0 ? Math.round(Math.max(panelFloor, rowWidth * draftsFraction)) : Math.max(420, panelFloor);
  const panelRoom =
    rowWidth > 0
      ? Math.max(0, rowWidth - (filtersOpen ? DRAFTS_MIN_PX + LEFT_RAIL_PX : LEFT_RAIL_PX) - RIGHT_RAIL_PX)
      : panelWanted;
  const panelShown = draftsOpen || summaryOpen;
  const panelWidth = panelShown
    ? Math.max(panelFloor, Math.min(panelRoom, panelWanted))
    : panelWanted;
  const panelFlex = panelShown
    ? Math.min(panelWidth, tableShown ? Math.max(0, panelRoom - compactW) : panelWidth)
    : panelWidth;
  const panelOverlap = Math.max(0, panelWidth - panelFlex);
  const compactH = tableHeight(bodyRows, compactHeaderPx, COMPACT_ROW_PX);
  const fullW = tableWidth(dataCols, FULL_COL_PX);
  const fullNeedH = tableHeight(bodyRows, fullHeaderPx, MAX_ROW_PX);
  layoutRef.current = { filtersOpen, issuesOpen, compactW, compactH, filtersWidth, draftsOpen, tableShown, panelFloor };
  const slotHeight =
    centerBox.h <= 0
      ? 0
      : issuesOpen
        ? Math.max(0, centerBox.h * tableFraction - 12)
        : Math.max(0, centerBox.h - 44);
  const tableMode = resolveTableMode({
    width: centerBox.w,
    height: slotHeight,
    dataCols,
    bodyRows,
    pref: tablePref,
    holdHidden,
    shown: tableShown,
  });
  iconFit.current = {
    col: dataCols > 0 ? Math.max(0, (centerBox.w - NAME_COL_PX) / dataCols) : 0,
    row: bodyRows > 0 && slotHeight > 0 ? (slotHeight - fullHeaderPx) / bodyRows : 0,
    pref: tablePref,
    shown: tableShown,
    id: props.activeBoardId,
  };
  const compact = tableMode === 'mini';
  const headerBudget = compact ? compactHeaderPx : fullHeaderPx;
  const headerPx = Math.max(headerBudget, tableViewport.header);
  const fitRow =
    bodyRows > 0 && slotHeight > 0 ? (slotHeight - headerBudget) / bodyRows : MAX_ROW_PX;
  const measuredRow =
    tableViewport.h > 0 && bodyRows > 0
      ? (tableViewport.h - headerPx - bodyRows) / bodyRows
      : fitRow;
  const rowPx = Math.max(1, measuredRow);
  const colPx =
    dataCols > 0 ? Math.max(COMPACT_COL_PX, (centerBox.w - NAME_COL_PX) / dataCols) : FULL_COL_PX;
  const glyphScale = Math.min(1, rowPx / MAX_ROW_PX, colPx / FULL_COL_PX);
  const digitPx = Math.max(12, MAX_DIGIT_PX * glyphScale);
  const iconScale = tableMode === 'full' ? glyphScale : 1;
  const tableVars = {
    '--bro-row': `${rowPx}px`,
    '--bro-row-total': `${rowPx}px`,
    '--bro-digit': `${digitPx}px`,
    '--bro-digit-center': `${Math.max(11, Math.min(16, digitPx * 0.57))}px`,
    '--bro-digit-grand': `${Math.max(12, Math.min(20, digitPx * 0.72))}px`,
    '--bro-icon': String(iconScale),
    '--bro-bell': `${rowPx >= 36 ? 20 : 16}px`,
  } as CSSProperties;

  function predictCenterWidth(filters: boolean, drafts: boolean, fraction: number) {
    if (rowWidth <= 0) return Number.POSITIVE_INFINITY;
    const filtersW = filters ? DRAFTS_MIN_PX + LEFT_RAIL_PX : LEFT_RAIL_PX;
    const draftsW = drafts
      ? RIGHT_RAIL_PX + Math.round(Math.max(DRAFTS_MIN_PX, rowWidth * fraction))
      : RIGHT_RAIL_PX;
    return rowWidth - filtersW - draftsW;
  }

  function chooseTableMode(mode: 'mini' | 'full') {
    const rowPx = mode === 'mini' ? COMPACT_ROW_PX : ICON_ROW_PX;
    const headerPx = (mode === 'mini' ? COMPACT_HEADER_PX : FULL_HEADER_PX) * headerUnits;
    const needH = tableHeight(bodyRows, headerPx, rowPx);
    modeExpect.current = mode;
    sizeSide.current = null;
    draggedTable.current = true;
    if (centerBox.h > 0) {
      const fraction = (needH + 16) / centerBox.h;
      if (mode === 'full' && issuesOpen && fraction > 0.92) setIssuesOpen(false);
      else {
        if (!issuesOpen && mode === 'mini') setIssuesOpen(true);
        setTableFraction(Math.min(0.92, Math.max(0.08, fraction)));
      }
    }
    setTablePref(mode);
    saveTableMode(mode);
  }

  function revealTable(mode: 'mini' | 'full', heightOnly = false) {
    const needW = mode === 'full' ? fullW : compactW;
    const needH = mode === 'full' ? fullNeedH : compactH;
    if (!heightOnly && rowWidth > 0) {
      let filters = filtersOpen;
      let drafts = draftsOpen;
      let fraction = draftsFraction;
      if (drafts && predictCenterWidth(filters, drafts, fraction) < needW) fraction = 0.22;
      if (drafts && predictCenterWidth(filters, drafts, fraction) < needW) drafts = false;
      if (filters && predictCenterWidth(filters, drafts, fraction) < needW) filters = false;
      setFiltersOpen(filters);
      if (!drafts && rightTool === 'drafts') setRightTool('off');
      setDraftsFraction(fraction);
    }
    if (centerBox.h > 0 && issuesOpen) {
      const fractionForNeed = (needH + 16) / centerBox.h;
      if (fractionForNeed > 0.9) setIssuesOpen(false);
      else setTableFraction(Math.min(0.9, Math.max(0.08, fractionForNeed)));
    }
    holdReason.current = null;
    setHoldHidden(false);
    rememberTablePref(mode);
  }

  function collapseTable() {
    holdReason.current = 'user';
    setHoldHidden(true);
    rememberTablePref('hidden');
  }
  const cellBox = `bro-cell relative h-full w-full overflow-hidden ${compact ? 'bro-cell-mini' : ''}`;
  const totalBox = `${cellBox} bro-cell-total bro-cell-center`;
  const pointsOff = (count: number, place: 'side' | 'bell' | 'center' | 'grand') => {
    const digits = Math.max(1, String(Math.trunc(Math.abs(count))).length);
    if (compact && place !== 'center' && place !== 'grand') return colPx < 80 ? ' bro-points-off' : '';
    const font =
      place === 'grand'
        ? Math.max(12, Math.min(20, digitPx * 0.72))
        : place === 'center'
          ? Math.max(11, Math.min(16, digitPx * 0.57))
          : digitPx;
    const text = font * digits * (place === 'center' || place === 'grand' ? 0.7 : 0.62);
    const room = place === 'center' || place === 'grand' ? 64 : place === 'bell' ? 70 : 50;
    return colPx < text + room ? ' bro-points-off' : '';
  };
  const nameColBorder = 'border-r border-slate-300';
  const numColW = '';
  const activeFilterCount =
    activeSprints.size +
    activeReviewers.size +
    activeQas.size +
    activeAuthors.size +
    activeAssignees.size +
    excludedSprints.size +
    excludedReviewers.size +
    excludedQas.size +
    excludedAuthors.size +
    excludedAssignees.size;
  const leftFiltersOn = activeFilterCount > 0;
  const detailIssues =
    !selection
      ? []
      : selection.kind === 'issues'
        ? selection.issues
        : selection.developerId == null
          ? []
          : Object.values(
              matrix.developers.find((row) => row.developer.id === selection.developerId)
                ?.issuesByColumn || {},
            ).flat();
  const unfilteredCellIssues = issuesForSelection(
    reflowed?.matrix ?? null,
    selection,
    doneStatusKeys,
    columns,
    finalKeys,
  );
  const scopedIssues = detailIssues.filter((issue) => {
    if (boardScope === 'changes') return unseenChangeKeys.has(issue.key);
    if (boardScope === 'done') return issueIsBoardDone(issue, doneStatusKeys, finalKeys);
    if (boardScope === 'open') return !issueIsBoardDone(issue, doneStatusKeys, finalKeys);
    return true;
  });
  const listedIssues =
    boardScope === 'done' || appliedShowDone
      ? scopedIssues
      : scopedIssues.filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys));
  const detailNoteCount = uniqueIssueCount(listedIssues, (issue) =>
    Boolean(sourceMatrix.issueNotes[issue.key]?.trim()),
  );
  const detailBookmarkCount = uniqueIssueCount(listedIssues, (issue) =>
    Boolean(sourceMatrix.issueBookmarks?.[issue.key]),
  );
  const detailMissingPointsCount = uniqueIssueCount(listedIssues, (issue) => issue.storyPoints === null);
  const detailMissingReviewerCount = uniqueIssueCount(
    listedIssues,
    (issue) => !issue.reviewerDisplay?.trim(),
  );
  const detailMissingQaCount = uniqueIssueCount(listedIssues, (issue) => !issue.qaDisplay?.trim());
  const detailTimeWarnCount = uniqueIssueCount(
    listedIssues,
    (issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys) && issueTimeWarn(issue) != null,
  );
  const detailOtherSprintCount = uniqueIssueCount(
    listedIssues,
    (issue) =>
      !issueIsBoardDone(issue, doneStatusKeys, finalKeys) &&
      issue.sprintId != null &&
      issue.sprintId !== currentSprintId,
  );
  const createdAtByKey = new Map<string, string | null | undefined>();
  for (const row of (reflowed?.matrix ?? sourceMatrix).developers) {
    for (const issues of Object.values(row.issuesByColumn)) {
      for (const issue of issues) createdAtByKey.set(issue.key, issue.createdAt);
    }
  }
  const boardChangeRows = props.changes.filter(
    (change) => !staleNewTaskNote(change.text, createdAtByKey.get(change.issueKey)),
  );
  const changeByKey = new Map<string, { issueKey: string; text: string; at: string; seen: boolean }>();
  for (const change of boardChangeRows) {
    const prev = changeByKey.get(change.issueKey);
    if (!prev) {
      changeByKey.set(change.issueKey, change);
      continue;
    }
    if (change.boardLocalId === props.activeBoardId) {
      changeByKey.set(change.issueKey, { ...change, seen: prev.seen && change.seen });
    } else if (!change.seen) {
      changeByKey.set(change.issueKey, { ...prev, seen: false });
    }
  }
  const boardChanges = [...changeByKey.values()].filter(
    (change) => !change.seen && createdAtByKey.has(change.issueKey),
  );
  const visibleIssueKeys = [
    ...new Set(
      listedIssues
        .filter((issue) => {
          if (noteFilter && !sourceMatrix.issueNotes[issue.key]?.trim()) return false;
          if (bookmarkFilter && !sourceMatrix.issueBookmarks?.[issue.key]) return false;
          if (missingPointsFilter && issue.storyPoints !== null) return false;
          if (missingReviewerFilter && issue.reviewerDisplay?.trim()) return false;
          if (missingQaFilter && issue.qaDisplay?.trim()) return false;
          if (
            timeWarnFilter &&
            (issueIsBoardDone(issue, doneStatusKeys, finalKeys) || issueTimeWarn(issue) == null)
          ) {
            return false;
          }
          if (
            otherSprintFilter &&
            (issueIsBoardDone(issue, doneStatusKeys, finalKeys) ||
              !(issue.sprintId != null && issue.sprintId !== currentSprintId))
          ) {
            return false;
          }
          if (changesFilter && changeByKey.get(issue.key)?.seen !== false) return false;
          return true;
        })
        .map((issue) => issue.key),
    ),
  ];
  /** Name col: compact + ellipsis (no wrap). */
  const nameColW = 'w-[9.75rem] min-w-[9.75rem]';
  const tasksDock = paintStage === 'list' || paintStage === 'summary' ? (
    <TasksDock
      selection={selection}
      groupName={
        selection?.statusKey?.startsWith('group:')
          ? boardGroups.find((group) => groupStatusKey(group.id) === selection.statusKey)?.name
          : undefined
      }
      issues={listedIssues}
      people={props.participants}
      boards={props.boards}
      showDone={showDoneIssues}
      onToggleShowDone={() => {
        fadeThen(() => {
          setShowDoneIssues((prev) => {
            const next = !prev;
            saveShowDone(next);
            syncApplied({ showDone: next });
            return next;
          });
        });
      }}
      noteCount={detailNoteCount}
      bookmarkCount={detailBookmarkCount}
      noteFilter={noteOn}
      bookmarkFilter={bookmarkOn}
      missingPointsFilter={missingPointsOn}
      missingReviewerFilter={missingReviewerOn}
      missingQaFilter={missingQaOn}
      timeWarnFilter={timeWarnOn}
      otherSprintFilter={otherSprintOn}
      changesFilter={changesOn}
      listNoteFilter={noteFilter}
      listBookmarkFilter={bookmarkFilter}
      listMissingPointsFilter={missingPointsFilter}
      listMissingReviewerFilter={missingReviewerFilter}
      listMissingQaFilter={missingQaFilter}
      listTimeWarnFilter={timeWarnFilter}
      listOtherSprintFilter={otherSprintFilter}
      listChangesFilter={changesFilter}
      changeByKey={changeByKey}
      changeCount={boardChanges.filter((change) => listedIssues.some((issue) => issue.key === change.issueKey)).length}
      onDismissChange={(issueKey) => props.onDismissChanges([issueKey])}
      missingPointsCount={detailMissingPointsCount}
      missingReviewerCount={detailMissingReviewerCount}
      missingQaCount={detailMissingQaCount}
      timeWarnCount={detailTimeWarnCount}
      otherSprintCount={detailOtherSprintCount}
      notePinned={pinnedIcons.has('note')}
      bookmarkPinned={pinnedIcons.has('bookmark')}
      pointsPinned={pinnedIcons.has('points')}
      reviewerPinned={pinnedIcons.has('reviewer')}
      qaPinned={pinnedIcons.has('tester')}
      timePinned={pinnedIcons.has('time')}
      sprintPinned={pinnedIcons.has('sprint')}
      onToggleNoteFilter={() => clickIconFilter('note')}
      onToggleBookmarkFilter={() => clickIconFilter('bookmark')}
      onToggleMissingPoints={() => clickIconFilter('points')}
      onToggleMissingReviewer={() => clickIconFilter('reviewer')}
      onToggleMissingQa={() => clickIconFilter('tester')}
      onToggleTimeWarn={() => clickIconFilter('time')}
      onToggleOtherSprint={() => clickIconFilter('sprint')}
      onToggleChangesFilter={() => clickIconFilter('changes')}
      changesPinned={pinnedIcons.has('changes')}
      onPinNoteFilter={() => pinIconFilter('note')}
      onPinBookmarkFilter={() => pinIconFilter('bookmark')}
      onPinMissingPoints={() => pinIconFilter('points')}
      onPinMissingReviewer={() => pinIconFilter('reviewer')}
      onPinMissingQa={() => pinIconFilter('tester')}
      onPinTimeWarn={() => pinIconFilter('time')}
      onPinOtherSprint={() => pinIconFilter('sprint')}
      onPinChangesFilter={() => pinIconFilter('changes')}
      expandedKeys={expandedKeys}
      visibleIssueKeys={visibleIssueKeys}
      onToggleExpand={(issueKey) => {
        const opening = !expandedKeys.has(issueKey);
        if (opening && unseenChangeKeys.has(issueKey)) invalidateIssueStories(issueKey);
        setExpandedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(issueKey)) next.delete(issueKey);
          else next.add(issueKey);
          return next;
        });
      }}
      onExpandAll={() => setExpandedKeys(new Set(visibleIssueKeys))}
      onCollapseAll={() => setExpandedKeys(new Set())}
      listSort={listSort}
      onListSort={changeListSort}
      filterEpoch={listFilterEpoch}
      panelWidth={panelWidth}
      sourceMatrix={sourceMatrix}
      columns={columns}
      currentSprintId={currentSprintId}
      doneStatusKeys={doneStatusKeys}
      finalKeys={finalKeys}
      readOnly={readOnly}
      onClose={() => setSelection(null)}
      onShowAll={selectAllTasks}
      cellIssues={detailIssues}
      unfilteredCellIssues={unfilteredCellIssues}
      onEnableShowDone={enableShowDone}
      onResetFilters={resetTaskFilters}
      onCollapse={() => setIssuesOpen(false)}
      onIssueHover={setHighlightIssueKey}
      onMatrixChange={props.onMatrixChange}
      onSnapshotContentChange={props.onSnapshotContentChange}
      onChanged={() => void reloadTodosIntoMatrix()}
      onError={props.onError}
    />
  ) : null;

  const refreshOnThisBoard =
    props.refreshingBoardId != null && props.refreshingBoardId === props.activeBoardId;
  const refreshVeil = refreshOnThisBoard ? (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/60">
      <div className="pointer-events-auto">
        <RunSpinner
          requests={props.apiRequests}
          onStop={() => stopBoardRefresh()}
        />
      </div>
    </div>
  ) : null;

  return (
    <>
      {editButton}
      {modeMenuOpen &&
        createPortal(
          <div
            ref={modeMenuRef}
            className="fixed z-[10000] flex flex-col gap-0.5"
            style={{ top: modeMenuPos.top, left: modeMenuPos.left }}
          >
            {(
              [
                ['hidden', 'Свернуть таблицу', <EyeOffIcon key="hidden" className="h-4 w-4" />],
                ['mini', 'Компактная таблица', <FeatherListIcon key="mini" />],
                ['full', 'Таблица с иконками', <FeatherGridIcon key="full" />],
              ] as const
            ).map(([id, label, icon]) => (
              <InstantTip key={id} text={label} place="right" className="inline-flex">
                <button
                  type="button"
                  aria-label={label}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700/50 shadow-sm hover:border-slate-400 hover:bg-white hover:text-slate-600"
                  onClick={() => {
                    if (id === 'hidden') collapseTable();
                    else if (id === 'mini') revealTable('mini', true);
                    else revealTable('full');
                    setModeMenuOpen(false);
                  }}
                >
                  {icon}
                </button>
              </InstantTip>
            ))}
          </div>,
          document.body,
        )}
      {othersMenu &&
        createPortal(
          <OthersAssigneeMenu
            top={othersMenu.top}
            left={othersMenu.left}
            anchor={peopleButtonRef.current}
            fromOthers={countedPicks.fromOthers}
            fromParticipants={countedPicks.fromParticipants}
            onClose={() => setOthersMenu(null)}
            onPick={(pick) => {
              void addRowOnBoard(pick);
            }}
          />,
          document.body,
        )}
      <div className="flex min-h-0 flex-1 flex-col">
      <div ref={boardRowRef} className="flex min-h-0 flex-1 items-stretch overflow-hidden">
        <div className="relative z-30 flex h-full shrink-0">
          <div
            className={`flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-slate-200 bg-slate-50 p-1.5 ${
              filtersOpen ? '' : 'shadow-[2px_0_4px_-2px_rgba(15,23,42,0.18)]'
            }`}
          >
            <RailButton
              title={tableShown ? 'Скрыть таблицу' : 'Показать таблицу'}
              pressed={tableShown}
              onClick={() => {
                setTableShown((on) => {
                  const next = !on;
                  saveTableShown(next);
                  return next;
                });
              }}
            >
              <FeatherGridIcon />
            </RailButton>
            <RailButton
              title="Фильтры"
              pressed={filtersOpen}
              onClick={() => {
                if (!tableShown && !issuesOpen) {
                  setTableShown(true);
                  saveTableShown(true);
                  setFiltersOpen(true);
                  return;
                }
                setFiltersOpen((open) => !open);
              }}
            >
              <FilterIcon className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute bottom-px right-px rounded-full bg-sky-600 px-1 text-[8px] font-semibold leading-none text-white">
                  {activeFilterCount}
                </span>
              )}
            </RailButton>
            <RailButton
              title="Задачи"
              pressed={issuesOpen}
              onClick={() => setIssuesOpen((open) => !open)}
              className="mt-auto"
            >
              <InboxIcon className="h-4 w-4" />
            </RailButton>
          </div>
        {filtersOpen && (
          <aside
            className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.18)]"
            style={{ width: DRAFTS_MIN_PX }}
          >
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-slate-200 px-2">
              <span className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Фильтры
              </span>
              <button
                type="button"
                title="Свернуть все"
                disabled={Object.values(filterGroupOpen).every((open) => !open)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
                onClick={() =>
                  setFilterGroupOpen({ sprints: false, assignees: false, reviewers: false, qa: false, authors: false })
                }
              >
                <FilterGroupsMinimizeIcon />
              </button>
              <button
                type="button"
                title="Развернуть все"
                disabled={Object.values(filterGroupOpen).every(Boolean)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
                onClick={() =>
                  setFilterGroupOpen({ sprints: true, assignees: true, reviewers: true, qa: true, authors: true })
                }
              >
                <FilterGroupsMaximizeIcon />
              </button>
              <button
                type="button"
                title="Сбросить"
                disabled={!leftFiltersOn}
                className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                  leftFiltersOn ? 'text-slate-600 hover:bg-slate-100' : 'cursor-default text-slate-300'
                }`}
                onClick={() => {
                  if (!leftFiltersOn) return;
                  clearFadePreview();
                  fadeThen(resetLeftFilters);
                }}
              >
                <SlashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <PersonFilterBlock
                title="Спринты"
                open={filterGroupOpen.sprints}
                onToggle={() => setFilterGroupOpen((prev) => ({ ...prev, sprints: !prev.sprints }))}
                items={[
                  ...[...sprintCounts].sort(compareSprintsNewestFirst).map((s) => ({
                    key: String(s.id),
                    label: s.name,
                    count: splitCount((issue) => issue.sprintId === s.id),
                    active: activeSprints.has(s.id),
                    pinned: pinnedSprints.has(s.id),
                    excluded: excludedSprints.has(s.id),
                    onClick: () => selectLeft('sprint', s.id),
                    onClear: () => excludeLeft('sprint', s.id),
                    onPin: () => pinLeft('sprint', s.id),
                  })),
                  {
                    key: String(NO_SPRINT),
                    label: 'Без спринта',
                    count: splitCount(
                      (issue) => issue.sprintId == null && !issueIsBoardDone(issue, doneStatusKeys, finalKeys),
                    ),
                    active: activeSprints.has(NO_SPRINT),
                    pinned: pinnedSprints.has(NO_SPRINT),
                    excluded: excludedSprints.has(NO_SPRINT),
                    onClick: () => selectLeft('sprint', NO_SPRINT),
                    onClear: () => excludeLeft('sprint', NO_SPRINT),
                    onPin: () => pinLeft('sprint', NO_SPRINT),
                  },
                ]}
              />
              <PersonFilterBlock
                title="Исполнители"
                open={filterGroupOpen.assignees}
                onToggle={() => setFilterGroupOpen((prev) => ({ ...prev, assignees: !prev.assignees }))}
                items={[
                  ...assigneeNames.map((name) => ({
                    key: name,
                    label: name,
                    count: splitCount((issue) => (issue.assigneeDisplay || '').trim() === name.trim()),
                    active: activeAssignees.has(name),
                    pinned: pinnedAssignees.has(name),
                    excluded: excludedAssignees.has(name),
                    bold: props.participants.some(
                      (person) => person.role === 'developer' && person.displayName.trim() === name.trim(),
                    ),
                    onClick: () => selectLeft('assignee', name),
                    onClear: () => excludeLeft('assignee', name),
                    onPin: () => pinLeft('assignee', name),
                  })),
                  {
                    key: UNASSIGNED_FILTER,
                    label: 'Не назначено',
                    count: splitCount((issue) => !(issue.assigneeDisplay || '').trim()),
                    active: activeAssignees.has(UNASSIGNED_FILTER),
                    pinned: pinnedAssignees.has(UNASSIGNED_FILTER),
                    excluded: excludedAssignees.has(UNASSIGNED_FILTER),
                    danger: true,
                    onClick: () => selectLeft('assignee', UNASSIGNED_FILTER),
                    onClear: () => excludeLeft('assignee', UNASSIGNED_FILTER),
                    onPin: () => pinLeft('assignee', UNASSIGNED_FILTER),
                  },
                ]}
              />
              <PersonFilterBlock
                title="Reviewers"
                open={filterGroupOpen.reviewers}
                onToggle={() => setFilterGroupOpen((prev) => ({ ...prev, reviewers: !prev.reviewers }))}
                items={[
                  ...reviewerCounts.map((r) => ({
                    key: r.name,
                    label: r.name,
                    count: splitCount((issue) => (issue.reviewerDisplay || '').trim() === r.name.trim()),
                    active: activeReviewers.has(r.name),
                    pinned: pinnedReviewers.has(r.name),
                    excluded: excludedReviewers.has(r.name),
                    bold: props.participants.some(
                      (person) => person.role === 'developer' && person.displayName.trim() === r.name.trim(),
                    ),
                    onClick: () => selectLeft('reviewer', r.name),
                    onClear: () => excludeLeft('reviewer', r.name),
                    onPin: () => pinLeft('reviewer', r.name),
                  })),
                  {
                    key: UNASSIGNED_FILTER,
                    label: 'Не назначено',
                    count: splitCount((issue) => !(issue.reviewerDisplay || '').trim()),
                    active: activeReviewers.has(UNASSIGNED_FILTER),
                    pinned: pinnedReviewers.has(UNASSIGNED_FILTER),
                    excluded: excludedReviewers.has(UNASSIGNED_FILTER),
                    danger: true,
                    onClick: () => selectLeft('reviewer', UNASSIGNED_FILTER),
                    onClear: () => excludeLeft('reviewer', UNASSIGNED_FILTER),
                    onPin: () => pinLeft('reviewer', UNASSIGNED_FILTER),
                  },
                ]}
              />
              <PersonFilterBlock
                title="QA"
                open={filterGroupOpen.qa}
                onToggle={() => setFilterGroupOpen((prev) => ({ ...prev, qa: !prev.qa }))}
                items={[
                  ...qaCounts.map((q) => ({
                    key: q.name,
                    label: q.name,
                    count: splitCount((issue) => (issue.qaDisplay || '').trim() === q.name.trim()),
                    active: activeQas.has(q.name),
                    pinned: pinnedQas.has(q.name),
                    excluded: excludedQas.has(q.name),
                    bold: props.participants.some(
                      (person) => person.role === 'qa' && person.displayName.trim() === q.name.trim(),
                    ),
                    onClick: () => selectLeft('qa', q.name),
                    onClear: () => excludeLeft('qa', q.name),
                    onPin: () => pinLeft('qa', q.name),
                  })),
                  {
                    key: UNASSIGNED_FILTER,
                    label: 'Не назначено',
                    count: splitCount((issue) => !(issue.qaDisplay || '').trim()),
                    active: activeQas.has(UNASSIGNED_FILTER),
                    pinned: pinnedQas.has(UNASSIGNED_FILTER),
                    excluded: excludedQas.has(UNASSIGNED_FILTER),
                    danger: true,
                    onClick: () => selectLeft('qa', UNASSIGNED_FILTER),
                    onClear: () => excludeLeft('qa', UNASSIGNED_FILTER),
                    onPin: () => pinLeft('qa', UNASSIGNED_FILTER),
                  },
                ]}
              />
              <PersonFilterBlock
                title="Authors"
                open={filterGroupOpen.authors}
                onToggle={() => setFilterGroupOpen((prev) => ({ ...prev, authors: !prev.authors }))}
                empty={(sourceMatrix?.grandTotal ?? 0) > 0 ? 'Появится после обновления доски' : undefined}
                items={
                  authorNames.length
                    ? [
                        ...authorNames.map((name) => ({
                          key: name,
                          label: name,
                          count: splitCount((issue) => (issue.authorDisplay || '').trim() === name),
                          active: activeAuthors.has(name),
                          pinned: pinnedAuthors.has(name),
                          excluded: excludedAuthors.has(name),
                          bold: props.participants.some((person) => person.displayName.trim() === name),
                          onClick: () => selectLeft('author', name),
                          onClear: () => excludeLeft('author', name),
                          onPin: () => pinLeft('author', name),
                        })),
                        {
                          key: UNASSIGNED_FILTER,
                          label: 'Не назначено',
                          count: splitCount((issue) => !(issue.authorDisplay || '').trim()),
                          active: activeAuthors.has(UNASSIGNED_FILTER),
                          pinned: pinnedAuthors.has(UNASSIGNED_FILTER),
                          excluded: excludedAuthors.has(UNASSIGNED_FILTER),
                          danger: true,
                          onClick: () => selectLeft('author', UNASSIGNED_FILTER),
                          onClear: () => excludeLeft('author', UNASSIGNED_FILTER),
                          onPin: () => pinLeft('author', UNASSIGNED_FILTER),
                        },
                      ]
                    : []
                }
              />
            </div>
          </aside>
        )}
        </div>

        <div
          ref={centerRef}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {(tableShown || issuesOpen) && <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-slate-200 bg-slate-50 px-2">
            <div className="flex min-w-0 items-center gap-2">
            <InstantTip text={tablePref === 'mini' ? 'Компактная таблица' : 'Таблица с иконками'}>
            <button
              type="button"
              disabled={!tableShown}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:shadow-sm disabled:cursor-default disabled:text-slate-300 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none"
              onClick={() => {
                if (!tableShown) return;
                chooseTableMode(tablePref === 'mini' ? 'full' : 'mini');
              }}
            >
              {tablePref === 'mini' ? <FeatherMinimizeIcon /> : <FeatherMaximizeIcon />}
            </button>
            </InstantTip>
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px]">
              <span className="truncate font-semibold text-slate-900">{sprintTitle}</span>
              {sprintHeader.extra != null && sprintHeader.extra > 0 && (
                <span className="shrink-0 font-semibold text-sky-600">(+{sprintHeader.extra})</span>
              )}
              {sprintPeriod && (
                <span className="shrink-0 rounded bg-slate-200/80 px-1 py-px text-[10px] font-medium text-slate-500">
                  {sprintPeriod}
                </span>
              )}
              {sprintOutdated && (
                <span className="shrink-0 text-[10px] font-semibold text-red-600">{sprintOutdated}</span>
              )}
            </div>
            </div>
            <InstantTip text={props.refreshingBoardId != null ? 'Обновление доски…' : 'Обновить эту доску'}>
              <button
                type="button"
                disabled={props.refreshingBoardId != null || readOnly}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:shadow-sm disabled:cursor-default disabled:text-slate-300 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none"
                onClick={() => props.onRefreshBoard()}
              >
                <RefreshIcon
                  className={`h-3.5 w-3.5 ${props.refreshingBoardId === props.activeBoardId ? 'animate-spin' : ''}`}
                />
              </button>
            </InstantTip>
            <div className="flex min-w-0 items-center justify-end gap-1">
              {boardScope === 'changes' && boardChanges.length > 0 && (
                <InstantTip text="Пропустить изменения" className="inline-flex h-5 items-center">
                  <button
                    type="button"
                    className="inline-flex h-5 items-center rounded bg-red-600 px-1.5 text-white"
                    onClick={() => {
                      const visible = new Set(visibleIssueKeys);
                      const listed = boardChanges
                        .map((change) => change.issueKey)
                        .filter((key) => visible.has(key));
                      props.onDismissChanges(listed.length ? listed : boardChanges.map((change) => change.issueKey));
                    }}
                  >
                    <BellOffIcon bold className="h-3.5 w-3.5" />
                  </button>
                </InstantTip>
              )}
              {boardChanges.length > 0 && (
                <InstantTip text="Изменения" className="inline-flex h-5 items-center">
                  <button
                    type="button"
                    className={scopeBadgeClass(
                      boardScope === 'changes',
                      'bg-amber-100 text-amber-950',
                      'bg-amber-950 text-amber-100',
                    )}
                    onClick={() => chooseBoardScope('changes')}
                  >
                    <BellIcon className="h-3.5 w-3.5" />
                    {boardChanges.length}
                  </button>
                </InstantTip>
              )}
              <InstantTip text="Готово" className="inline-flex h-5 items-center">
                <button
                  type="button"
                  className={scopeBadgeClass(
                    boardScope === 'done',
                    'bg-emerald-100 text-emerald-900',
                    'bg-emerald-900 text-emerald-100',
                  )}
                  onClick={() => chooseBoardScope('done')}
                >
                  {boardTotals.done}
                </button>
              </InstantTip>
              <InstantTip text="Не готово" className="inline-flex h-5 items-center">
                <button
                  type="button"
                  className={scopeBadgeClass(
                    boardScope === 'open',
                    'bg-sky-100 text-sky-900',
                    'bg-sky-900 text-sky-100',
                  )}
                  onClick={() => chooseBoardScope('open')}
                >
                  {boardTotals.open}
                </button>
              </InstantTip>
              <InstantTip text="Всего" className="inline-flex h-5 items-center">
                <button
                  type="button"
                  className={scopeBadgeClass(
                    boardScope === 'total',
                    'bg-slate-200 text-slate-700',
                    'bg-slate-700 text-slate-200',
                  )}
                  onClick={() => chooseBoardScope('total')}
                >
                  {boardTotals.total}
                </button>
              </InstantTip>
            </div>
          </div>}
          {castPersonId != null && (tableShown || issuesOpen) && (
            <div className="flex h-6 shrink-0 items-center gap-2 border-b border-sky-200 bg-sky-50 px-2 text-[11px] text-sky-950">
              <span className="min-w-0 truncate">
                Включен режим трансляции сводки для участника{' '}
                {props.participants.find((person) => person.id === castPersonId)?.displayName ||
                  props.participants.find((person) => person.id === castPersonId)?.login}
              </span>
              <button
                type="button"
                title="Выключить трансляцию"
                className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-sky-800 hover:bg-sky-100"
                onClick={() => setCastOn(false)}
              >
                <XIcon className="h-3 w-3" />
              </button>
            </div>
          )}
          {reorderMode && tableMode !== 'hidden' && (
            <div className="flex h-5 shrink-0 items-center gap-1.5 border-b border-amber-300 bg-amber-50 px-2 text-[11px] text-amber-950">
              <span className="font-medium">Редактирование таблицы</span>
              <button
                type="button"
                title="Готово"
                className="ml-auto inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={leaveReorder}
              >
                <CheckIcon className="h-3 w-3" />
              </button>
            </div>
          )}
          {paintStage === 'rails' || tableMode === 'hidden' ? (
            paintStage !== 'rails' && refreshOnThisBoard ? <div className="relative min-h-0 flex-1">{refreshVeil}</div> : <div className="min-h-0 flex-1 bg-white" />
          ) : (
          <div
            className="bro-boot-in flex min-h-0 flex-col overflow-hidden"
            style={issuesOpen ? { flex: `${tableFraction} 1 0%` } : { flex: '1 1 auto' }}
          >
          <div className="relative h-full min-h-0">
          <div
            ref={setTableHost}
            className="bro-fade-host h-full min-h-0 overflow-x-auto overflow-y-hidden bg-white"
            style={panelOverlap > 0 ? { width: `calc(100% - ${panelOverlap}px)` } : undefined}
          >
            <table
              className="w-full table-fixed border-collapse text-sm [&_thead_th]:align-top"
              style={{
                ...tableVars,
                height: tableViewport.h > 0 ? tableViewport.h : '100%',
                ...(tableShown ? { minWidth: compactW } : {}),
              }}
              onMouseLeave={() => setTableHover(null)}
            >
              <colgroup>
                <col style={{ width: '9.75rem' }} />
              </colgroup>
              <thead>
                {showGroupRow && (
                  <tr className="bg-slate-50">
                    <th
                      rowSpan={2}
                      className={`sticky top-0 left-0 z-20 relative h-px overflow-hidden border-0 bg-slate-50 p-px ${nameColW} text-left ${shade('head', 'name')}`}
                      onMouseEnter={() => setTableHover({ row: 'head', col: 'name' })}
                    >
                      <HeaderChip className="flex items-start justify-center">{tableCorner()}</HeaderChip>
                    </th>
                    {slots.map((slot) => {
                      const grouped =
                        slot.kind === 'column' && slot.column.groupId != null
                          ? boardGroups.find((group) => group.id === slot.column.groupId)
                          : undefined;
                      if (slot.kind === 'column' && grouped && !grouped.collapsed) {
                        const members = slots.filter(
                          (item) => item.kind === 'column' && item.column.groupId === grouped.id,
                        );
                        const first = members[0];
                        if (first?.kind !== 'column' || first.column.statusKey !== slot.column.statusKey) return null;
                        const skipped =
                          members.length > 0 &&
                          members.every(
                            (item) => item.kind === 'column' && autoSkipColumns.has(item.column.statusKey),
                          );
                        return (
                          <th
                            key={`group-${grouped.id}`}
                            colSpan={members.length}
                            className="sticky top-0 z-10 h-px border-0 bg-slate-50 p-px text-left align-top"
                          >
                            <HeaderChip color={grouped.color || '#64748b'} className="bro-group-head flex items-start justify-between gap-1 px-1 py-0.5">
                              <span
                                className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${reorderMode && !readOnly ? 'cursor-grab' : 'cursor-pointer'}`}
                                onPointerEnter={(event) => showTitleIfCut(event.currentTarget, grouped.name)}
                                draggable={reorderMode && !readOnly}
                                onClick={() => void toggleGroup(grouped)}
                                onDragStart={(event) => {
                                  if (!reorderMode || readOnly) return;
                                  const key = groupStatusKey(grouped.id);
                                  dragDevId.current = null;
                                  dragColKey.current = key;
                                  setDraggingCol(key);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', key);
                                  setMoveGhost(event, grouped.name);
                                }}
                                onDragEnd={() => {
                                  dragColKey.current = null;
                                  setDraggingCol(null);
                                  setDropColKey(null);
                                }}
                              >
                                <ColumnAliasLabel alias={grouped.name} color={grouped.color} />
                              </span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  title={skipped ? 'Выключить автопропуск изменений' : 'Автопропуск изменений для всей группы'}
                                  className={`bro-group-bell inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                                    skipped ? 'text-red-600 hover:text-red-800' : 'text-slate-300 hover:text-slate-500'
                                  }`}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={() => toggleGroupAutoSkip(grouped)}
                                >
                                  <BellOffIcon className="h-3 w-3" />
                                </button>
                                <InstantTip text="Свернуть группу" place="bottom" className="inline-flex">
                                  <button
                                    type="button"
                                    className="bro-group-fold inline-flex h-4 w-4 items-center justify-center rounded border"
                                    style={groupFoldStyle(grouped.color || '#64748b')}
                                    onClick={() => void toggleGroup(grouped)}
                                  >
                                    <ChevronUpIcon className="h-3 w-3" />
                                  </button>
                                </InstantTip>
                              </span>
                            </HeaderChip>
                          </th>
                        );
                      }
                      if (slot.kind === 'group') {
                        const key = groupStatusKey(slot.group.id);
                        const dropKey = slot.columns[0]?.statusKey || key;
                        const skipped =
                          slot.columns.length > 0 &&
                          slot.columns.every((column) => autoSkipColumns.has(column.statusKey));
                        return (
                          <th
                            key={key}
                            rowSpan={2}
                            onDragOver={(event) => allowColumnDrop(event, dropKey)}
                            onDrop={(event) => dropColumn(event, dropKey)}
                            className={`sticky top-0 z-10 h-px border-0 bg-slate-50 p-px text-left ${columnDropMark(dropKey)}`}
                          >
                            <HeaderChip color={slot.group.color || '#64748b'} className="bro-group-head flex flex-col items-stretch justify-start gap-0.5 px-1 py-0.5">
                              <span className="flex items-center justify-end gap-0.5">
                                <button
                                  type="button"
                                  title={skipped ? 'Выключить автопропуск изменений' : 'Автопропуск изменений для всей группы'}
                                  className={`bro-group-bell inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                                    skipped ? 'text-red-600 hover:text-red-800' : 'text-slate-300 hover:text-slate-500'
                                  }`}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={() => toggleGroupAutoSkip(slot.group)}
                                >
                                  <BellOffIcon className="h-3 w-3" />
                                </button>
                                <InstantTip text="Развернуть группу" place="bottom" className="inline-flex">
                                  <button
                                    type="button"
                                    className="bro-group-fold inline-flex h-4 w-4 items-center justify-center rounded border"
                                    style={groupFoldStyle(slot.group.color || '#64748b')}
                                    onClick={() => void toggleGroup(slot.group)}
                                  >
                                    <ChevronDownIcon className="h-3 w-3" />
                                  </button>
                                </InstantTip>
                              </span>
                              <span
                                className={`min-w-0 truncate text-[11px] font-semibold ${reorderMode && !readOnly ? 'cursor-grab' : 'cursor-pointer'}`}
                                onPointerEnter={(event) => showTitleIfCut(event.currentTarget, slot.group.name)}
                                draggable={reorderMode && !readOnly}
                                onClick={() => void toggleGroup(slot.group)}
                                onDragStart={(event) => {
                                  if (!reorderMode || readOnly) return;
                                  dragDevId.current = null;
                                  dragColKey.current = key;
                                  setDraggingCol(key);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', key);
                                  setMoveGhost(event, slot.group.name);
                                }}
                                onDragEnd={() => {
                                  dragColKey.current = null;
                                  setDraggingCol(null);
                                  setDropColKey(null);
                                }}
                              >
                                <ColumnAliasLabel alias={slot.group.name} color={slot.group.color} />
                              </span>
                            </HeaderChip>
                          </th>
                        );
                      }
                      const c = slot.column;
                      return (
                        <th
                          key={c.statusKey}
                          rowSpan={2}
                          onDragOver={(event) => allowColumnDrop(event, c.statusKey)}
                          onDrop={(event) => dropColumn(event, c.statusKey)}
                          className={`sticky top-0 z-10 h-px border-0 bg-slate-50 p-px text-left font-semibold text-[11px] leading-tight text-black ${columnDropMark(c.statusKey)}`}
                        >
                          <HeaderChip color={c.color} className="flex flex-col justify-start gap-0.5 px-1 py-0.5">
                            <span className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                title={autoSkipColumns.has(c.statusKey) ? 'Выключить автопропуск изменений' : 'Автопропуск изменений'}
                                className={
                                  autoSkipColumns.has(c.statusKey)
                                    ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center text-red-600 hover:text-red-800'
                                    : 'inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-300 hover:text-slate-500'
                                }
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => toggleColumnAutoSkip(c.statusKey)}
                              >
                                <BellOffIcon className="h-3 w-3" />
                              </button>
                              {reorderMode && !readOnly && (
                                <button
                                  type="button"
                                  title="Скрыть с доски"
                                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                                    columnSlot?.hidden?.includes(c.statusKey)
                                      ? 'text-red-600 hover:text-red-800'
                                      : 'text-slate-400 hover:text-slate-700'
                                  }`}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={() => toggleColumnHideFix(c.statusKey)}
                                >
                                  <EyeOffIcon className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                            <span
                              className={`min-w-0 truncate ${reorderMode && !readOnly ? 'cursor-grab' : ''}`}
                              onPointerEnter={(event) => showTitleIfCut(event.currentTarget, c.alias)}
                              draggable={reorderMode && !readOnly}
                              onDragStart={(event) => {
                                if (!reorderMode || readOnly) return;
                                dragDevId.current = null;
                                dragColKey.current = c.statusKey;
                                setDraggingCol(c.statusKey);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', c.statusKey);
                                setMoveGhost(event, c.alias);
                              }}
                              onDragEnd={() => {
                                dragColKey.current = null;
                                setDraggingCol(null);
                                setDropColKey(null);
                              }}
                            >
                              <ColumnAliasLabel alias={c.alias} color={c.color} />
                            </span>
                          </HeaderChip>
                        </th>
                      );
                    })}
                    {showPending && (
                      <th
                        rowSpan={2}
                        title="Задачи не в финальном статусе"
                        className="sticky top-0 z-10 h-px border-0 bg-slate-50 p-px text-center font-bold text-[11px] whitespace-nowrap"
                      >
                        <HeaderChip className="flex items-start justify-center px-1 py-0.5">
                          <span className="block truncate">FLOW</span>
                        </HeaderChip>
                      </th>
                    )}
                    <th
                      rowSpan={2}
                      title="Все задачи"
                      className="sticky top-0 z-10 h-px border-0 bg-slate-50 p-px text-center font-bold text-[11px] whitespace-nowrap"
                    >
                      <HeaderChip className="flex items-start justify-center px-1 py-0.5">
                        <span className="block truncate">TOTAL</span>
                      </HeaderChip>
                    </th>
                  </tr>
                )}
                {(splitHeader || !showGroupRow) && (
                <tr className="bg-slate-50">
                  {!showGroupRow && (
                  <th
                    className={`sticky ${headSticky} left-0 z-20 relative h-px overflow-hidden border-0 bg-slate-50 p-px ${nameColW} text-left ${shade('head', 'name')}`}
                    onMouseEnter={() => setTableHover({ row: 'head', col: 'name' })}
                  >
                    <HeaderChip className="flex items-start justify-center">{tableCorner()}</HeaderChip>
                  </th>
                  )}
                  {slots.map((slot) => {
                    if (showGroupRow && (slot.kind === 'group' || slot.column.groupId == null)) return null;
                    if (slot.kind === 'group') {
                      const key = groupStatusKey(slot.group.id);
                      const dropKey = slot.columns[0]?.statusKey || key;
                      return (
                        <th
                          key={key}
                          onDragOver={(e) => allowColumnDrop(e, dropKey)}
                          onDrop={(e) => dropColumn(e, dropKey)}
                          onMouseEnter={() => setTableHover({ row: 'head', col: key })}
                          className={`relative sticky ${headSticky} z-10 h-px border-0 bg-slate-50 p-px text-left font-semibold text-[11px] leading-tight ${shade('head', key)} ${columnDropMark(dropKey)}`}
                        >
                          <HeaderChip color={slot.group.color} className="flex items-center px-1 py-0.5">
                            <span
                              className="block truncate"
                              style={{ color: slot.group.color }}
                              onPointerEnter={(event) => showTitleIfCut(event.currentTarget, slot.group.name)}
                            >
                              {slot.group.name}
                            </span>
                          </HeaderChip>
                        </th>
                      );
                    }
                    const c = slot.column;
                    return (
                    <th
                      key={c.statusKey}
                      onDragOver={(e) => allowColumnDrop(e, c.statusKey)}
                      onDrop={(e) => dropColumn(e, c.statusKey)}
                      onMouseEnter={() => setTableHover({ row: 'head', col: c.statusKey })}
                      className={`relative sticky ${headSticky} z-10 h-px border-0 bg-slate-50 p-px text-left font-semibold text-[11px] leading-tight text-black ${shade('head', c.statusKey)} ${columnDropMark(c.statusKey)}`}
                    >
                      <HeaderChip color={c.color} className="flex flex-col justify-start gap-0.5 px-1 py-0.5">
                        <span className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          title={
                            autoSkipColumns.has(c.statusKey)
                              ? 'Выключить автопропуск изменений'
                              : 'Автопропуск изменений'
                          }
                          className={
                            autoSkipColumns.has(c.statusKey)
                              ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center text-red-600 hover:text-red-800'
                              : 'inline-flex h-4 w-4 shrink-0 items-center justify-center text-slate-300 hover:text-slate-500'
                          }
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => toggleColumnAutoSkip(c.statusKey)}
                        >
                          <BellOffIcon className="h-3 w-3" />
                        </button>
                        {reorderMode && !readOnly && (
                          <button
                            type="button"
                            title="Скрыть с доски"
                            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${
                              columnSlot?.hidden?.includes(c.statusKey)
                                ? 'text-red-600 hover:text-red-800'
                                : 'text-slate-400 hover:text-slate-700'
                            }`}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => toggleColumnHideFix(c.statusKey)}
                          >
                            <EyeOffIcon className="h-3 w-3" />
                          </button>
                        )}
                        </span>
                        <span
                          className={`min-w-0 truncate ${reorderMode && !readOnly ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          onPointerEnter={(event) => showTitleIfCut(event.currentTarget, c.alias)}
                          draggable={reorderMode && !readOnly}
                          onDragStart={(e) => {
                            if (!reorderMode || readOnly) return;
                            dragDevId.current = null;
                            dragColKey.current = c.statusKey;
                            setDraggingDev(null);
                            setDraggingCol(c.statusKey);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', c.statusKey);
                            setMoveGhost(e, c.alias);
                          }}
                          onDragEnd={() => {
                            dragColKey.current = null;
                            setDraggingCol(null);
                            setDropColKey(null);
                          }}
                        >
                          <ColumnAliasLabel alias={c.alias} color={c.color} />
                        </span>
                      </HeaderChip>
                    </th>
                    );
                  })}
                  {!showGroupRow && showPending && (
                  <th
                    title="Задачи не в финальном статусе"
                    onMouseEnter={() => setTableHover({ row: 'head', col: PENDING_COLUMN })}
                    className={`relative sticky ${headSticky} z-10 h-px border-0 bg-slate-50 p-px text-center font-bold text-[11px] whitespace-nowrap ${shade('head', PENDING_COLUMN)}`}
                  >
                    <HeaderChip className="flex items-start justify-center px-1 py-0.5">
                      <span className="block truncate">FLOW</span>
                    </HeaderChip>
                  </th>
                  )}
                  {!showGroupRow && (
                  <th
                    title="Все задачи"
                    onMouseEnter={() => setTableHover({ row: 'head', col: 'total' })}
                    className={`relative sticky ${headSticky} z-10 h-px border-0 bg-slate-50 p-px text-center font-bold text-[11px] whitespace-nowrap ${shade('head', 'total')}`}
                  >
                    <HeaderChip className="flex items-start justify-center px-1 py-0.5">
                      <span className="block truncate">TOTAL</span>
                    </HeaderChip>
                  </th>
                  )}
                </tr>
                )}
              </thead>
              <tbody>
                {matrix.developers.map((row, rowIndex) => {
                  const sourceRow = sourceMatrix.developers.find(
                    (r) => r.developer.id === row.developer.id,
                  );
                  const nameColor = resolveDeveloperRowColor(
                    row.developer.color,
                    sourceRow?.counts || row.counts,
                    columns,
                  );
                  const rowIssues = columns.flatMap(
                    (column) => row.issuesByColumn[column.statusKey] || [],
                  );
                  const rowPoints = storyPointsTotal(rowIssues);
                  const rowOpenPoints = storyPointsTotal(
                    rowIssues.filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys)),
                  );
                  const rowFigures = splitVisible(row.issuesByColumn, columns, doneStatusKeys, finalKeys);
                  const totalSelected = isCellSelected(row.developer.id, null);
                  const pendingSelected = isCellSelected(row.developer.id, PENDING_COLUMN);
                  const rowFixed = row.developer.id < 0;
                  const away = row.developer.onVacation;
                  const edgeTop = rowIndex === 0 ? 'bro-edge-top' : '';
                  const edgeRight = 'bro-edge-right';
                  const soleColumn = slots.length === 0 && !showPending;
                  return (
                    <tr key={row.developer.id} className={away ? 'bg-slate-200 opacity-50' : 'bg-white'}>
                      <td
                        onDragOver={(e) => allowRowDrop(e, row.developer.id)}
                        onDrop={(e) => dropRow(e, row.developer.id)}
                        onMouseEnter={() => setTableHover({ row: row.developer.id, col: 'name' })}
                        className={`sticky left-0 z-10 relative h-px border-b border-black p-0 ${nameColBorder} ${nameColW} ${shade(row.developer.id, 'name')} ${rowDropMark(row.developer.id)}`}
                        style={{ backgroundColor: away ? '#e5e7eb' : nameColor }}
                      >
                        <div className="relative h-full w-full">
                          <div
                            className={`absolute inset-0 z-[1] flex items-center gap-1 px-1.5 ${
                              reorderMode ? '' : 'cursor-pointer'
                            }`}
                            onClick={(event) => {
                              if (reorderMode) return;
                              if ((event.target as HTMLElement).closest('[data-row-hide]')) return;
                              choose(
                                {
                                  kind: 'issues',
                                  developerId: row.developer.id,
                                  developerName: row.developer.displayName,
                                  statusKey: null,
                                  issues: rowIssues,
                                },
                                'clear',
                              );
                            }}
                          >
                            <span
                              className={`block min-w-0 flex-1 truncate pr-1 text-sm font-medium leading-tight ${
                                reorderMode && !readOnly && !rowFixed ? 'cursor-grab active:cursor-grabbing' : ''
                              }`}
                              onPointerEnter={(event) => {
                                const name = row.developer.displayName;
                                if (!away) {
                                  showTitleIfCut(event.currentTarget, name);
                                  return;
                                }
                                const cut = event.currentTarget.scrollWidth > event.currentTarget.clientWidth + 1;
                                event.currentTarget.setAttribute('title', cut ? `${name} — в отпуске` : 'В отпуске');
                              }}
                              draggable={reorderMode && !readOnly && !rowFixed}
                              onDragStart={(e) => {
                                if (!reorderMode || readOnly || rowFixed) return;
                                dragColKey.current = null;
                                dragDevId.current = row.developer.id;
                                setDraggingCol(null);
                                setDraggingDev(row.developer.id);
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', String(row.developer.id));
                                setMoveGhost(e, row.developer.displayName);
                              }}
                              onDragEnd={() => {
                                dragDevId.current = null;
                                setDraggingDev(null);
                                setDropDevId(null);
                              }}
                            >
                              {row.developer.displayName}
                            </span>
                            {reorderMode && !readOnly && !rowFixed && (
                              <button
                                type="button"
                                data-row-hide=""
                                title="Скрыть с доски"
                                className="inline-flex shrink-0 items-center justify-center text-slate-400 hover:text-red-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (props.activeBoardId == null) return;
                                  updateRowPrefs(props.activeBoardId, row.developer, 'hide');
                                }}
                              >
                                <EyeOffIcon className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          <span className="bro-cell-spacer invisible block leading-none" aria-hidden>
                            0
                          </span>
                        </div>
                      </td>
                      {slots.map((slot, slotIndex) => {
                        const grouped = slot.kind === 'group';
                        const edgeLeft = slotIndex === 0 ? 'bro-edge-left' : '';
                        const c = grouped
                          ? {
                              ...slot.columns[0],
                              statusKey: groupStatusKey(slot.group.id),
                              alias: slot.group.name,
                              color: slot.group.color,
                              statusDisplay: slot.group.name,
                              duty: slot.columns.some((column) => column.duty === 'review')
                                ? 'review'
                                : slot.columns.some((column) => column.duty === 'testing')
                                  ? 'testing'
                                  : slot.columns[0]?.duty || '',
                            }
                          : slot.column;
                        const count = grouped
                          ? slot.columns.reduce((sum, column) => sum + (row.counts[column.statusKey] || 0), 0)
                          : row.counts[c.statusKey] || 0;
                        const cellPending = Boolean(
                          reflowed?.pendingDevIds.has(row.developer.id) ||
                            (grouped
                              ? slot.columns.some((column) => reflowed?.pendingStatusKeys.has(column.statusKey))
                              : reflowed?.pendingStatusKeys.has(c.statusKey)),
                        );
                        const active = isCellSelected(row.developer.id, c.statusKey);
                        const issues = grouped
                          ? slot.columns.flatMap((column) => row.issuesByColumn[column.statusKey] || [])
                          : row.issuesByColumn[c.statusKey] || [];
                        const dropKey = grouped ? slot.columns[0]?.statusKey || c.statusKey : c.statusKey;
                        const badges = cellMissingBadges(issues, c);
                        const activeIssues = issues.filter((i) => !issueIsBoardDone(i, doneStatusKeys, finalKeys));
                        const timeWarn = cellTimeWarn(activeIssues);
                        const hasNote = issues.some(
                          (i) => Boolean(sourceMatrix?.issueNotes[i.key]?.trim()),
                        );
                        const bookmarked = issues.some(
                          (i) => Boolean(sourceMatrix?.issueBookmarks?.[i.key]),
                        );
                        const pastSprint = activeIssues.some(
                          (i) => i.sprintId != null && i.sprintId !== currentSprintId,
                        );
                        const highlighted =
                          highlightIssueKey != null &&
                          issues.some((i) => i.key === highlightIssueKey);
                        const changeCount = issues.filter((issue) => changeByKey.get(issue.key)?.seen === false).length;
                        const cellBadges: CellBadgeModel = {
                          ...badges,
                          hasNote,
                          timeWarn,
                          bookmarked,
                          pastSprint,
                          changes: changeCount > 0,
                          reviewerCount: issues.filter((issue) => !issue.reviewerDisplay?.trim()).length,
                          testerCount: issues.filter((issue) => !issue.qaDisplay?.trim()).length,
                          timeCount: activeIssues.filter((issue) => issueTimeWarn(issue) != null).length,
                          sprintCount: activeIssues.filter(
                            (issue) => issue.sprintId != null && issue.sprintId !== currentSprintId,
                          ).length,
                          changeCount,
                          missingPoints: issues.some((issue) => issue.storyPoints === null),
                          pointsCount: issues.filter((issue) => issue.storyPoints === null).length,
                          reviewerFilled: badges.reviewerTone === 'warn',
                          testerFilled: badges.testerTone === 'warn',
                        };
                        const cellPoints = storyPointsTotal(issues);
                        return (
                          <td
                            key={c.statusKey}
                            onDragOver={(e) => {
                              allowColumnDrop(e, dropKey);
                              allowRowDrop(e, row.developer.id);
                            }}
                            onDrop={(e) => {
                              if (dragColKey.current) dropColumn(e, dropKey);
                              else dropRow(e, row.developer.id);
                            }}
                            onMouseEnter={() => setTableHover({ row: row.developer.id, col: c.statusKey })}
                            className={`relative border-b border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] ${edgeTop} ${edgeLeft} ${shade(row.developer.id, c.statusKey)} ${
                              active ? cellSelectedClass : ''
                            } ${highlighted ? 'bro-cell-mark' : ''} ${columnDropMark(dropKey)} ${rowDropMark(row.developer.id)}`}
                          >
                            <div className={`${cellBox}${pointsOff(count, changeCount > 0 ? 'bell' : 'side')}`}>
                            {cellPending ? (
                              <span className="absolute inset-0 z-0 flex items-end px-1.5 pb-1 text-sm text-slate-400">—</span>
                            ) : (
                            <button
                              className={`bro-cell-count absolute inset-0 z-[1] cursor-pointer flex leading-none ${
                                count === 0 ? 'opacity-20' : ''
                              }`}
                              style={{ color: away ? '#94a3b8' : c.color }}
                              onClick={() =>
                                choose(
                                  {
                                    kind: 'issues',
                                    developerId: row.developer.id,
                                    developerName: row.developer.displayName,
                                    statusKey: c.statusKey,
                                    issues,
                                  },
                                  'clear',
                                )
                              }
                            >
                              {count}
                            </button>
                            )}
                            {!cellPending && (
                              <ChangeBell
                                show={changeCount > 0}
                                count={count}
                                heat={changeCount}
                                trailing={compact && cellPoints != null ? <span className="bro-points-cell"><PointsSumBadge sum={cellPoints.sum} tasks={cellPoints.tasks} /></span> : null}
                                onClick={() =>
                                  chooseByBadge('changes', {
                                    kind: 'issues',
                                    developerId: row.developer.id,
                                    developerName: row.developer.displayName,
                                    statusKey: c.statusKey,
                                    issues,
                                  })
                                }
                              />
                            )}
                            {!compact && !cellPending && (
                              <CellBadgeStack
                                model={cellBadges}
                                edge={cellPoints != null ? <span className="bro-points-cell"><PointsSumBadge sum={cellPoints.sum} tasks={cellPoints.tasks} /></span> : null}
                                onPick={(kind) =>
                                  chooseByBadge(kind, {
                                    kind: 'issues',
                                    developerId: row.developer.id,
                                    developerName: row.developer.displayName,
                                    statusKey: c.statusKey,
                                    issues,
                                  })
                                }
                              />
                            )}
                            <span className="bro-cell-count bro-cell-spacer invisible block leading-none" aria-hidden>
                              {count}
                            </span>
                            </div>
                          </td>
                        );
                      })}
                      {showPending && (
                      <td
                        onDragOver={(e) => allowRowDrop(e, row.developer.id)}
                        onDrop={(e) => dropRow(e, row.developer.id)}
                        onMouseEnter={() => setTableHover({ row: row.developer.id, col: PENDING_COLUMN })}
                        className={`relative border-b border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] ${edgeTop} ${slots.length === 0 ? 'bro-edge-left' : ''} ${shade(row.developer.id, PENDING_COLUMN)} ${
                          pendingSelected ? cellSelectedClass : ''
                        } ${rowDropMark(row.developer.id)}`}
                      >
                        <div className={`${cellBox} bro-cell-center${pointsOff(rowFigures.open, 'center')}`}>
                        <button
                          className="bro-cell-count bro-count-center absolute inset-0 z-[1] cursor-pointer flex leading-none"
                          onClick={() => selectPending(row.developer.id, row.developer.displayName, rowIssues)}
                        >
                          <InstantTip text="Не готово">{rowFigures.open}</InstantTip>
                        </button>
                        <PointsEdge cell={rowOpenPoints} />
                        <span className="bro-cell-count bro-count-center bro-cell-spacer invisible block leading-none" aria-hidden>
                          {rowFigures.open}
                        </span>
                        </div>
                      </td>
                      )}
                      <td
                        onDragOver={(e) => allowRowDrop(e, row.developer.id)}
                        onDrop={(e) => dropRow(e, row.developer.id)}
                        onMouseEnter={() => setTableHover({ row: row.developer.id, col: 'total' })}
                        className={`relative border-b border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] ${edgeTop} ${soleColumn ? 'bro-edge-left' : ''} ${edgeRight} ${shade(row.developer.id, 'total')} ${
                          totalSelected ? cellSelectedClass : ''
                        } ${rowDropMark(row.developer.id)}`}
                      >
                        <div className={`${cellBox} bro-cell-center${pointsOff(rowFigures.total, 'center')}`}>
                        <button
                          className="bro-cell-count bro-count-center absolute inset-0 z-[1] flex cursor-pointer leading-none text-slate-400"
                          onClick={() =>
                            choose(
                              {
                                kind: 'issues',
                                developerId: row.developer.id,
                                developerName: row.developer.displayName,
                                statusKey: null,
                                issues: rowIssues,
                              },
                              'clear',
                            )
                          }
                        >
                          <InstantTip text="Всего">{rowFigures.total}</InstantTip>
                        </button>
                        <PointsEdge cell={rowPoints} />
                        <span className="bro-cell-count bro-count-center bro-cell-spacer invisible block leading-none" aria-hidden>
                          {rowFigures.total}
                        </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td
                    onMouseEnter={() => setTableHover({ row: 'total', col: 'name' })}
                    className={`sticky left-0 z-10 relative h-px border-t border-black bg-slate-100 p-0 ${nameColBorder} font-bold text-base ${nameColW} ${shade('total', 'name')}`}
                  >
                    <div className="relative h-full w-full">
                      <div
                        className="absolute inset-0 z-[1] flex cursor-pointer items-center px-1.5"
                        onClick={selectAllTasks}
                      >
                        <span className="min-w-0 flex-1 truncate">TOTAL</span>
                      </div>
                      <span className="bro-cell-spacer bro-cell-total invisible block leading-none" aria-hidden>
                        0
                      </span>
                    </div>
                  </td>
                  {slots.map((slot, slotIndex) => {
                    const edgeLeft = slotIndex === 0 ? 'bro-edge-left' : '';
                    const edgeBottom = 'bro-edge-bottom';
                    if (slot.kind === 'group') {
                      const key = groupStatusKey(slot.group.id);
                      const selected = isCellSelected(null, key);
                      const value = slot.columns.reduce(
                        (sum, column) => sum + (matrix.columnTotals[column.statusKey] || 0),
                        0,
                      );
                      const issues = matrix.developers.flatMap((developerRow) =>
                        slot.columns.flatMap((column) => developerRow.issuesByColumn[column.statusKey] || []),
                      );
                      const points = storyPointsTotal(issues);
                      const dropKey = slot.columns[0]?.statusKey || key;
                      return (
                        <td
                          key={key}
                          onDragOver={(e) => allowColumnDrop(e, dropKey)}
                          onDrop={(e) => dropColumn(e, dropKey)}
                          onMouseEnter={() => setTableHover({ row: 'total', col: key })}
                          className={`relative border-t border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] ${edgeLeft} ${edgeBottom} ${shade('total', key)} ${
                            selected ? cellSelectedClass : 'bg-slate-100'
                          } ${columnDropMark(dropKey)}`}
                        >
                          <div className={`${totalBox}${pointsOff(value, 'center')}`}>
                            <button
                              className="bro-cell-count bro-count-center absolute inset-0 z-[1] cursor-pointer flex leading-none"
                              style={{ color: slot.group.color }}
                              onClick={() =>
                                choose(
                                  {
                                    kind: 'issues',
                                    developerId: null,
                                    developerName: 'Вся команда',
                                    statusKey: key,
                                    issues,
                                  },
                                  'clear',
                                )
                              }
                            >
                              {value}
                            </button>
                            <PointsEdge cell={points} />
                            <span className="bro-cell-count bro-count-center bro-cell-spacer invisible block leading-none" aria-hidden>
                              {value}
                            </span>
                          </div>
                        </td>
                      );
                    }
                    const c = slot.column;
                    const selected = isCellSelected(null, c.statusKey);
                    const value = matrix.columnTotals[c.statusKey] || 0;
                    const issues = matrix.developers.flatMap(
                      (r) => r.issuesByColumn[c.statusKey] || [],
                    );
                    const points = storyPointsTotal(issues);
                    return (
                      <td
                        key={c.statusKey}
                        onDragOver={(e) => allowColumnDrop(e, c.statusKey)}
                        onDrop={(e) => dropColumn(e, c.statusKey)}
                        onMouseEnter={() => setTableHover({ row: 'total', col: c.statusKey })}
                        className={`relative border-t border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] ${edgeLeft} ${edgeBottom} ${shade('total', c.statusKey)} ${
                          selected ? cellSelectedClass : 'bg-slate-100'
                        } ${columnDropMark(c.statusKey)}`}
                      >
                        <div className={`${totalBox}${pointsOff(value, 'center')}`}>
                        <button
                          className="bro-cell-count bro-count-center absolute inset-0 z-[1] cursor-pointer flex leading-none"
                          style={{ color: c.color }}
                          onClick={() =>
                            choose(
                              {
                                kind: 'issues',
                                developerId: null,
                                developerName: 'Вся команда',
                                statusKey: c.statusKey,
                                issues,
                              },
                              'clear',
                            )
                          }
                        >
                          {value}
                        </button>
                        <PointsEdge cell={points} />
                        <span className="bro-cell-count bro-count-center bro-cell-spacer invisible block leading-none" aria-hidden>
                          {value}
                        </span>
                        </div>
                      </td>
                    );
                  })}
                  {showPending && (
                  <td
                    onMouseEnter={() => setTableHover({ row: 'total', col: PENDING_COLUMN })}
                    className={`relative border-t border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] bro-edge-bottom ${slots.length === 0 ? 'bro-edge-left' : ''} ${shade('total', PENDING_COLUMN)} ${
                      isCellSelected(null, PENDING_COLUMN) ? cellSelectedClass : 'bg-slate-100'
                    }`}
                  >
                    <div className={`${totalBox}${pointsOff(grandFigures.open, 'center')}`}>
                    <button
                      className="bro-cell-count bro-count-center absolute inset-0 z-[1] cursor-pointer flex leading-none"
                      onClick={() =>
                        selectPending(
                          null,
                          'Вся команда',
                          matrix.developers.flatMap((row) =>
                            columns.flatMap((column) => row.issuesByColumn[column.statusKey] || []),
                          ),
                        )
                      }
                    >
                      <InstantTip text="Не готово">{grandFigures.open}</InstantTip>
                    </button>
                    <PointsEdge cell={grandOpenPoints} />
                    <span className="bro-cell-count bro-count-center bro-cell-spacer invisible block leading-none" aria-hidden>
                      {grandFigures.open}
                    </span>
                    </div>
                  </td>
                  )}
                  <td
                    onMouseEnter={() => setTableHover({ row: 'total', col: 'total' })}
                    className={`relative border-t border-slate-200 p-0 [border-right:1px_dotted_#cbd5e1] bro-edge-bottom bro-edge-right ${slots.length === 0 && !showPending ? 'bro-edge-left' : ''} ${shade('total', 'total')} ${
                      isCellSelected(null, null) ? cellSelectedClass : 'bg-slate-100'
                    }`}
                  >
                    <div className={`${totalBox}${pointsOff(grandFigures.total, 'grand')}`}>
                    <button
                      className="bro-cell-count bro-count-center bro-count-grand absolute inset-0 z-[1] flex cursor-pointer leading-none text-slate-400"
                      onClick={selectAllTasks}
                    >
                      <InstantTip text="Всего">{grandFigures.total}</InstantTip>
                    </button>
                    <PointsEdge cell={grandPoints} />
                    <span className="bro-cell-count bro-count-center bro-count-grand bro-cell-spacer invisible block leading-none" aria-hidden>
                      {grandFigures.total}
                    </span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            ref={(node) => attachFadeHost('spinner', node)}
            className="pointer-events-none absolute inset-0 z-40 hidden flex-col items-center justify-center"
          >
            <RunSpinner
              requests={props.apiRequests}
              onStop={() => stopBoardRefresh()}
            />
          </div>
          {refreshVeil}
          </div>
          </div>
          )}
          {issuesOpen && paintStage !== 'rails' && paintStage !== 'table' && tableMode !== 'hidden' && (
            <div
              className="relative z-20 flex h-2.5 shrink-0 cursor-row-resize flex-col justify-between bg-white py-px"
              title="Тяните, чтобы изменить высоту списка"
              onMouseDown={startSplitResize}
            >
              <div className="h-px bg-slate-300" />
              <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
                <div className="h-px w-10 bg-slate-400" />
              </div>
              <div className="h-px bg-slate-300" />
            </div>
          )}
          {issuesOpen && paintStage !== 'rails' && paintStage !== 'table' && (
                <div
                  className="relative flex min-h-0 flex-col"
                  style={
                    tableMode === 'hidden'
                      ? { flex: '1 1 auto' }
                      : { flex: `${Math.max(0.08, 1 - tableFraction)} 1 0%` }
                  }
                >
                  <div
                    ref={(node) => attachFadeHost('list', node)}
                    className="bro-fade-host bro-boot-in flex min-h-0 flex-1 flex-col"
                  >
                    {tasksDock}
                  </div>
                </div>
            )}
        </div>

        <DraftsSide
          open={draftsOpen || summaryOpen}
          hidePanel={false}
          summary={summaryOpen}
          width={panelWidth}
          flexWidth={panelFlex}
          onOpenChange={(open) => {
            setRightTool(open ? 'drafts' : 'off');
          }}
          onToggleSummary={() => {
            setRightTool(summaryOpen ? 'off' : 'summary');
          }}
          onResizeStart={startPanelResize}
          onError={props.onError}
          onSnapshotContentChange={props.onSnapshotContentChange}
          summaryPanel={summaryPanel}
          consoleOpen={consoleOpen}
          onToggleConsole={() => setConsoleOpen((open) => !open)}
        />
      </div>
      <ConsoleDock open={consoleOpen} height={consoleHeight} onHeight={setConsoleHeight} />
      </div>
    </>
  );
}

function scopeBadgeClass(active: boolean, idle: string, on: string): string {
  return `inline-flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] font-semibold leading-none tabular-nums ${active ? on : idle}`;
}

const BELL_STEPS = [
  { backgroundColor: '#f7e9a0', color: 'rgb(220 137 11 / 0.8)' },
  { backgroundColor: '#f3d97a', color: 'rgb(207 128 1 / 0.8)' },
  { backgroundColor: '#efc258', color: 'rgb(207 98 1 / 0.85)' },
  { backgroundColor: '#e9bd87', color: 'rgb(200 69 41 / 0.9)' },
  { backgroundColor: '#f3b5aa', color: '#a82733' },
] as const;

function changeBellStyle(count: number): CSSProperties {
  const index = Math.min(BELL_STEPS.length, Math.max(1, count || 1)) - 1;
  return BELL_STEPS[index];
}

function PointsEdge(props: { cell: StoryPointsSum | null }) {
  if (props.cell == null) return null;
  return (
    <span className="bro-points-edge">
      <PointsSumBadge sum={props.cell.sum} tasks={props.cell.tasks} />
    </span>
  );
}

function ChangeBell(props: { show: boolean; count: number; heat?: number; onClick?: () => void; trailing?: ReactNode }) {
  if (!props.show && !props.trailing) return null;
  return (
    <span className="bro-change-beside">
      {props.show && (
        <>
          <span className="bro-change-digit" aria-hidden>
            {props.count}
          </span>
          <InstantTip text="Есть изменения" place="top" className="bro-change-tip inline-flex">
            <button
              type="button"
              className="bro-change-bell pointer-events-auto"
              style={changeBellStyle(props.heat || 1)}
              onClick={(event) => {
                event.stopPropagation();
                props.onClick?.();
              }}
            >
              <BellIcon />
            </button>
          </InstantTip>
        </>
      )}
      {props.trailing}
    </span>
  );
}

function groupFoldStyle(color: string): CSSProperties {
  const edge = darkenHex(color, 0.1);
  return {
    color: darkenHex(edge, 0.2),
    borderColor: hexTint(edge, 0.2),
    ['--fold-fill' as string]: hexTint(edge, 0.18),
  };
}

function headerChipStyle(color?: string | null): CSSProperties {
  if (!color) {
    return {
      backgroundColor: '#ffffff',
      borderTop: '1px solid #cbd5e1',
      borderRight: '2px solid #cbd5e1',
      borderBottom: '1px solid #cbd5e1',
      borderLeft: '2px solid #cbd5e1',
    };
  }
  const edge = darkenHex(color, 0.1);
  return {
    backgroundColor: hexTint(color),
    borderTop: `1px solid ${edge}`,
    borderRight: `2px solid ${edge}`,
    borderBottom: `1px solid ${edge}`,
    borderLeft: `2px solid ${edge}`,
  };
}

function HeaderChip(props: { color?: string | null; className?: string; children: ReactNode }) {
  return (
    <div
      className={`box-border h-full min-h-full w-full min-w-0 overflow-hidden rounded ${props.className ?? ''}`}
      style={headerChipStyle(props.color)}
    >
      {props.children}
    </div>
  );
}

function ColumnAliasLabel(props: { alias: string; color: string }) {
  const accent = darkenHex(props.color, 0.1);
  const parts = props.alias.split(/([-\s]+)/);
  return (
    <>
      {parts.map((part, i) => {
        if (!part || /^[-\s]+$/.test(part)) {
          return <span key={i}>{part}</span>;
        }
        return (
          <span key={i}>
            <span style={{ color: accent }}>{part[0]}</span>
            <span>{part.slice(1)}</span>
          </span>
        );
      })}
    </>
  );
}

function columnChangeKeys(
  matrix: BoardMatrix | null,
  statusKey: string,
  changeByKey: Map<string, { text: string; at: string; seen?: boolean }>,
): string[] {
  if (!matrix) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of matrix.developers) {
    for (const issue of row.issuesByColumn[statusKey] || []) {
      if (changeByKey.get(issue.key)?.seen !== false || seen.has(issue.key)) continue;
      seen.add(issue.key);
      keys.push(issue.key);
    }
  }
  return keys;
}

function uniqueIssueCount(
  issues: TrackerIssue[],
  match: (issue: TrackerIssue) => boolean,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const issue of issues) {
    if (seen.has(issue.key) || !match(issue)) continue;
    seen.add(issue.key);
    count += 1;
  }
  return count;
}

function TasksDock(props: {
  selection: CellSelection | null;
  groupName?: string;
  issues: TrackerIssue[];
  people?: Developer[];
  boards?: SavedBoard[];
  noteCount: number;
  bookmarkCount: number;
  noteFilter: boolean;
  bookmarkFilter: boolean;
  missingPointsFilter: boolean;
  missingReviewerFilter: boolean;
  missingQaFilter: boolean;
  timeWarnFilter: boolean;
  otherSprintFilter: boolean;
  changesFilter: boolean;
  listNoteFilter: boolean;
  listBookmarkFilter: boolean;
  listMissingPointsFilter: boolean;
  listMissingReviewerFilter: boolean;
  listMissingQaFilter: boolean;
  listTimeWarnFilter: boolean;
  listOtherSprintFilter: boolean;
  listChangesFilter: boolean;
  changeByKey: Map<string, { text: string; at: string; seen?: boolean }>;
  changeCount: number;
  onDismissChange: (issueKey: string) => void;
  notePinned: boolean;
  bookmarkPinned: boolean;
  pointsPinned: boolean;
  reviewerPinned: boolean;
  qaPinned: boolean;
  timePinned: boolean;
  sprintPinned: boolean;
  changesPinned: boolean;
  missingPointsCount: number;
  missingReviewerCount: number;
  missingQaCount: number;
  timeWarnCount: number;
  otherSprintCount: number;
  onToggleNoteFilter: () => void;
  onToggleBookmarkFilter: () => void;
  onToggleMissingPoints: () => void;
  onToggleMissingReviewer: () => void;
  onToggleMissingQa: () => void;
  onToggleTimeWarn: () => void;
  onToggleOtherSprint: () => void;
  onToggleChangesFilter: () => void;
  onPinChangesFilter: () => void;
  onPinNoteFilter: () => void;
  onPinBookmarkFilter: () => void;
  onPinMissingPoints: () => void;
  onPinMissingReviewer: () => void;
  onPinMissingQa: () => void;
  onPinTimeWarn: () => void;
  onPinOtherSprint: () => void;
  showDone: boolean;
  onToggleShowDone: () => void;
  expandedKeys: ReadonlySet<string>;
  visibleIssueKeys: string[];
  onToggleExpand: (issueKey: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  listSort: ListSort;
  onListSort: (next: ListSort) => void;
  filterEpoch: number;
  panelWidth: number;
  sourceMatrix: BoardMatrix;
  columns: BoardColumnConfig[];
  currentSprintId?: number | null;
  doneStatusKeys?: ReadonlySet<string>;
  finalKeys: ReadonlySet<string> | null;
  readOnly: boolean;
  onClose: () => void;
  onShowAll: () => void;
  cellIssues: TrackerIssue[];
  unfilteredCellIssues: TrackerIssue[];
  onEnableShowDone: () => void;
  onResetFilters: () => void;
  onCollapse?: () => void;
  onIssueHover: (issueKey: string | null) => void;
  onMatrixChange: (matrix: BoardMatrix) => void;
  onSnapshotContentChange: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  const showingTodos = props.selection?.kind === 'todos';
  const taskCount = showingTodos
    ? props.sourceMatrix.developers.find((row) => row.developer.id === props.selection?.developerId)
        ?.todos.length || 0
    : uniqueIssueCount(props.issues, () => true);

  async function onNoteChange(issueKey: string, note: string) {
    if (props.readOnly) return;
    const updatedAt = await window.api.setIssueNote(issueKey, note);
    const issueNotes = { ...props.sourceMatrix.issueNotes };
    const issueNoteUpdatedAt = { ...(props.sourceMatrix.issueNoteUpdatedAt || {}) };
    if (!note.trim()) {
      delete issueNotes[issueKey];
      delete issueNoteUpdatedAt[issueKey];
    } else {
      issueNotes[issueKey] = note;
      issueNoteUpdatedAt[issueKey] = updatedAt;
    }
    props.onMatrixChange({ ...props.sourceMatrix, issueNotes, issueNoteUpdatedAt });
    props.onSnapshotContentChange();
  }

  async function onBookmarkToggle(issueKey: string) {
    if (props.readOnly) return;
    const active = await window.api.toggleIssueBookmark(issueKey);
    const issueBookmarks = { ...(props.sourceMatrix.issueBookmarks || {}) };
    const issueBookmarkCreatedAt = { ...(props.sourceMatrix.issueBookmarkCreatedAt || {}) };
    if (active) {
      issueBookmarks[issueKey] = true;
      issueBookmarkCreatedAt[issueKey] =
        issueBookmarkCreatedAt[issueKey] || new Date().toISOString();
    } else {
      delete issueBookmarks[issueKey];
      delete issueBookmarkCreatedAt[issueKey];
    }
    props.onMatrixChange({ ...props.sourceMatrix, issueBookmarks, issueBookmarkCreatedAt });
    props.onSnapshotContentChange();
  }

  const filterButtonClass = (active: boolean, pinned = false) =>
    `inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold tabular-nums ${
      pinned
        ? 'bg-sky-600 text-white'
        : active
          ? 'bg-emerald-100 text-slate-800'
          : 'text-slate-500 hover:bg-slate-100'
    }`;
  const filterIconClass = (pinned: boolean) => `h-3.5 w-3.5${pinned ? ' text-white' : ''}`;
  const filterTip = (on: boolean, name: string) => (on ? `Отменить фильтр: ${name}` : name);
  const allExpanded =
    props.visibleIssueKeys.length > 0 &&
    props.visibleIssueKeys.every((key) => props.expandedKeys.has(key));
  const allCollapsed = props.visibleIssueKeys.every((key) => !props.expandedKeys.has(key));

  const filterBar = (
    <div className="pointer-events-auto flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-1.5 py-1 text-xs">
        <span className="shrink-0 px-1 font-semibold text-slate-900">
          Задачи
          <span className="ml-1.5 font-normal text-slate-400">{taskCount}</span>
        </span>
        {!showingTodos && (
          <>
            <FilterIconButton
              title={filterTip(props.noteFilter, 'С примечанием')}
              active={props.noteFilter}
              pinned={props.notePinned}
              className={filterButtonClass(props.noteFilter, props.notePinned)}
              onClick={props.onToggleNoteFilter}
              onPin={props.onPinNoteFilter}
            >
              <ClipboardIcon className={filterIconClass(props.notePinned)} />
              {props.noteCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.bookmarkFilter, 'С закладкой')}
              active={props.bookmarkFilter}
              pinned={props.bookmarkPinned}
              className={filterButtonClass(props.bookmarkFilter, props.bookmarkPinned)}
              onClick={props.onToggleBookmarkFilter}
              onPin={props.onPinBookmarkFilter}
            >
              <BookmarkIcon className={filterIconClass(props.bookmarkPinned)} filled={props.bookmarkFilter} />
              {props.bookmarkCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.missingPointsFilter, 'Без Story Points')}
              active={props.missingPointsFilter}
              pinned={props.pointsPinned}
              className={filterButtonClass(props.missingPointsFilter, props.pointsPinned)}
              onClick={props.onToggleMissingPoints}
              onPin={props.onPinMissingPoints}
            >
              <BatteryChargingIcon className={filterIconClass(props.pointsPinned)} />
              {props.missingPointsCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.missingReviewerFilter, 'Без ревьюера')}
              active={props.missingReviewerFilter}
              pinned={props.reviewerPinned}
              className={filterButtonClass(props.missingReviewerFilter, props.reviewerPinned)}
              onClick={props.onToggleMissingReviewer}
              onPin={props.onPinMissingReviewer}
            >
              <ShieldIcon className={filterIconClass(props.reviewerPinned)} />
              {props.missingReviewerCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.missingQaFilter, 'Без QA')}
              active={props.missingQaFilter}
              pinned={props.qaPinned}
              className={filterButtonClass(props.missingQaFilter, props.qaPinned)}
              onClick={props.onToggleMissingQa}
              onPin={props.onPinMissingQa}
            >
              <UserCheckIcon className={filterIconClass(props.qaPinned)} />
              {props.missingQaCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.timeWarnFilter, 'Просроченные и без движения')}
              active={props.timeWarnFilter}
              pinned={props.timePinned}
              className={filterButtonClass(props.timeWarnFilter, props.timePinned)}
              onClick={props.onToggleTimeWarn}
              onPin={props.onPinTimeWarn}
            >
              <ClockIcon className={filterIconClass(props.timePinned)} />
              {props.timeWarnCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.otherSprintFilter, 'Чужой спринт')}
              active={props.otherSprintFilter}
              pinned={props.sprintPinned}
              className={filterButtonClass(props.otherSprintFilter, props.sprintPinned)}
              onClick={props.onToggleOtherSprint}
              onPin={props.onPinOtherSprint}
            >
              <CalendarIcon className={filterIconClass(props.sprintPinned)} />
              {props.otherSprintCount}
            </FilterIconButton>
            <FilterIconButton
              title={filterTip(props.changesFilter, 'С изменениями')}
              active={props.changesFilter}
              pinned={props.changesPinned}
              className={filterButtonClass(props.changesFilter, props.changesPinned)}
              onClick={props.onToggleChangesFilter}
              onPin={props.onPinChangesFilter}
            >
              <BellIcon className={filterIconClass(props.changesPinned)} />
              {props.changeCount}
            </FilterIconButton>
            <div className="ml-auto inline-flex shrink-0 items-center gap-0.5">
              <span className="shrink-0 text-[11px] font-medium text-slate-500">Готовые:</span>
              <InstantTip text="Включить отображение готовых задач" className="inline-flex">
              <button
                type="button"
                data-done-filter=""
                aria-pressed={props.showDone}
                aria-label={props.showDone ? 'Готовые показаны' : 'Готовые скрыты'}
                className={`inline-flex h-6 w-6 items-center justify-center rounded ${
                  props.showDone ? 'text-emerald-600' : 'text-slate-400'
                }`}
                onClick={(event) => {
                  clearFadePreview();
                  event.currentTarget.classList.add(props.showDone ? 'is-preview-off' : 'is-preview-on');
                  props.onToggleShowDone();
                }}
              >
                {props.showDone ? (
                  <ToggleRightIcon className="h-3.5 w-3.5" />
                ) : (
                  <ToggleLeftIcon className="h-3.5 w-3.5" />
                )}
              </button>
              </InstantTip>
              <span className="mx-1 h-4 w-px shrink-0 bg-slate-200" aria-hidden />
              <button
                type="button"
                title="Развернуть все"
                disabled={allExpanded}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
                onClick={props.onExpandAll}
              >
                <Maximize2Icon />
              </button>
              <button
                type="button"
                title="Свернуть все"
                disabled={allCollapsed}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
                onClick={props.onCollapseAll}
              >
                <Minimize2Icon />
              </button>
            </div>
            <ListSortButton sort={props.listSort} onChange={props.onListSort} />
          </>
        )}
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      {filterBar}
      <div className="flex min-h-0 flex-1 flex-col">
        {showingTodos && props.selection?.developerId != null ? (
            <TodoPanel
              embedded
              width={props.panelWidth}
              developerId={props.selection.developerId}
              developerName={props.selection.developerName}
              todos={
                props.sourceMatrix.developers.find(
                  (row) => row.developer.id === props.selection?.developerId,
                )?.todos || []
              }
              developers={props.sourceMatrix.developers.map((row) => row.developer)}
              readOnly={props.readOnly}
              onClose={props.onClose}
              onChanged={props.onChanged}
              onError={props.onError}
            />
          ) : (
            <IssuePanel
              embedded
              width={props.panelWidth}
              selection={
                props.selection?.kind === 'issues'
                  ? { ...props.selection, issues: props.issues }
                  : null
              }
              columns={props.columns}
              groupName={props.groupName}
              people={props.people}
              boards={props.boards}
              issueNotes={props.sourceMatrix.issueNotes}
              issueNoteUpdatedAt={props.sourceMatrix.issueNoteUpdatedAt || {}}
              issueBookmarks={props.sourceMatrix.issueBookmarks || {}}
              issueBookmarkCreatedAt={props.sourceMatrix.issueBookmarkCreatedAt || {}}
              currentSprintId={props.currentSprintId}
              doneStatusKeys={props.doneStatusKeys}
              finalKeys={props.finalKeys}
              readOnly={props.readOnly}
              onClose={props.onClose}
              onIssueHover={props.onIssueHover}
              onNoteChange={onNoteChange}
              onBookmarkToggle={onBookmarkToggle}
              onIssueRefreshed={(next) => {
                if (props.readOnly) return;
                props.onMatrixChange(next);
                props.onSnapshotContentChange();
              }}
              onError={props.onError}
              listSort={props.listSort}
              filterEpoch={props.filterEpoch}
              onShowAll={props.onShowAll}
              cellIssues={props.cellIssues}
              unfilteredCellIssues={props.unfilteredCellIssues}
              showDone={props.showDone}
              onEnableShowDone={props.onEnableShowDone}
              onResetFilters={props.onResetFilters}
              onlyWithNote={props.listNoteFilter}
              onlyWithBookmark={props.listBookmarkFilter}
              onlyMissingPoints={props.listMissingPointsFilter}
              onlyMissingReviewer={props.listMissingReviewerFilter}
              onlyMissingQa={props.listMissingQaFilter}
              onlyTimeWarn={props.listTimeWarnFilter}
              onlyOtherSprint={props.listOtherSprintFilter}
              onlyWithChanges={props.listChangesFilter}
              changeByKey={props.changeByKey}
              onDismissChange={props.onDismissChange}
              expandedKeys={props.expandedKeys}
              onToggleExpand={props.onToggleExpand}
            />
          )}
      </div>
    </div>
  );
}

const modeIcon = {
  className: 'h-4 w-4',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  shapeRendering: 'geometricPrecision' as const,
  'aria-hidden': true,
};

function FeatherMaximizeIcon() {
  return (
    <svg {...modeIcon}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function FeatherMinimizeIcon() {
  return (
    <svg {...modeIcon}>
      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function FeatherListIcon() {
  return (
    <svg {...modeIcon}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function FeatherGridIcon() {
  return (
    <svg {...modeIcon}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function Maximize2Icon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function Minimize2Icon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function RailButton(props: {
  title: string;
  pressed: boolean;
  onClick: () => void;
  className?: string;
  place?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <InstantTip text={props.title} place={props.place ?? 'right'} className={props.className}>
      <button
        type="button"
        aria-pressed={props.pressed}
        className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
          props.pressed
            ? 'border-slate-300 bg-white text-slate-800 shadow'
            : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:shadow-sm'
        }`}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </InstantTip>
  );
}

function DraftsSide(props: {
  open: boolean;
  summary?: boolean;
  hidePanel?: boolean;
  width: number;
  flexWidth?: number;
  onOpenChange: (open: boolean) => void;
  onToggleSummary?: () => void;
  summaryPanel?: ReactNode;
  onResizeStart: () => void;
  onError: (msg: string | null) => void;
  onSnapshotContentChange: () => void;
  consoleOpen?: boolean;
  onToggleConsole?: () => void;
}) {
  const draftsPressed = props.open && !props.summary;
  const panelOpen = props.open && !props.hidePanel;
  return (
    <div className="relative z-30 flex h-full shrink-0 bg-white">
      {panelOpen && (
      <div className="relative h-full shrink-0" style={{ width: props.flexWidth ?? props.width }}>
      <div
        className="absolute inset-y-0 right-0 z-30 flex min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-2px_0_4px_-2px_rgba(15,23,42,0.18)]"
        style={{ width: props.width }}
      >
        {panelOpen && (
          <div
            className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize"
            title="Тяните, чтобы изменить ширину"
            onMouseDown={props.onResizeStart}
          >
            <div className="absolute inset-y-0 left-0 w-px bg-slate-300 group-hover:w-1 group-hover:bg-sky-400" />
          </div>
        )}
        <div className={props.summary || !props.open ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
          {props.summaryPanel}
        </div>
        {props.open && !props.summary && (
          <DraftDock
            onOpenChange={props.onOpenChange}
            onError={props.onError}
            onSnapshotContentChange={props.onSnapshotContentChange}
          />
        )}
      </div>
      </div>
      )}
      <div
        className={`flex w-11 shrink-0 flex-col items-center gap-1.5 border-l border-slate-200 bg-slate-50 p-1.5 ${
          panelOpen ? '' : 'shadow-[-2px_0_4px_-2px_rgba(15,23,42,0.18)]'
        }`}
      >
        <RailButton
          place="left"
          title="Заметки"
          pressed={draftsPressed}
          onClick={() => props.onOpenChange(props.summary ? true : !props.open)}
        >
          <CompassIcon className="h-4 w-4" />
        </RailButton>
        <RailButton
          place="left"
          title="Сводка"
          pressed={Boolean(props.summary)}
          onClick={() => props.onToggleSummary?.()}
        >
          <ActivityIcon className="h-4 w-4" />
        </RailButton>
        <RailButton
          place="left"
          title="Консоль"
          pressed={Boolean(props.consoleOpen)}
          className="mt-auto"
          onClick={() => props.onToggleConsole?.()}
        >
          <TerminalIcon className="h-4 w-4" />
        </RailButton>
      </div>
    </div>
  );
}

function PersonFilterBlock(props: {
  title: string;
  open: boolean;
  onToggle: () => void;
  empty?: string;
  items: Array<{
    key: string;
    label: string;
    count: { open: number; done: number };
    active: boolean;
    pinned?: boolean;
    excluded?: boolean;
    bold?: boolean;
    danger?: boolean;
    onClick: () => void;
    onClear?: () => void;
    onPin?: () => void;
  }>;
}) {
  const open = props.open;
  const selected = props.items.filter((item) => item.active || item.pinned || item.excluded).length;
  return (
    <section className="border-b border-slate-100 px-2 py-1.5 last:border-b-0">
      <button
        type="button"
        className="mb-1 flex w-full items-center gap-1 text-left"
        aria-expanded={open}
        onClick={props.onToggle}
      >
        <svg
          className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-500">{props.title}</span>
        {!open && selected > 0 && (
          <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold tabular-nums text-sky-800">
            {selected}
          </span>
        )}
      </button>
      {open &&
        (!props.items.length ? (
          <div className="px-1 text-[11px] text-slate-400">{props.empty || 'Нет данных'}</div>
        ) : (
          <div className="space-y-0.5 text-xs">
            {props.items.map((item) => (
              <FilterRow
                key={item.key}
                label={item.label}
                count={item.count}
                active={item.active}
                pinned={item.pinned}
                excluded={item.excluded}
                bold={item.bold}
                danger={item.danger}
                onClick={item.onClick}
                onClear={item.onClear}
                onPin={item.onPin}
              />
            ))}
          </div>
        ))}
    </section>
  );
}

function clearFadePreview() {
  document.querySelectorAll('.is-preview-on, .is-preview-pin, .is-preview-off, .is-preview-exclude').forEach((el) => {
    el.classList.remove('is-preview-on', 'is-preview-pin', 'is-preview-off', 'is-preview-exclude');
  });
}

function paintFilterRow(
  el: HTMLElement,
  mode: 'single' | 'double',
  active: boolean,
  pinned: boolean,
  excluded = false,
) {
  clearFadePreview();
  if (mode === 'double') {
    el.classList.add(pinned ? 'is-preview-off' : 'is-preview-pin');
    return;
  }
  if (excluded || active || pinned) {
    el.classList.add('is-preview-off');
    return;
  }
  document.querySelectorAll('.bro-filter-row.is-active:not(.is-pinned)').forEach((other) => {
    if (other !== el) other.classList.add('is-preview-off');
  });
  el.classList.add('is-preview-on');
}

function paintIconButton(el: HTMLElement, mode: 'single' | 'double', active: boolean, pinned: boolean) {
  clearFadePreview();
  if (mode === 'double') {
    el.classList.add(pinned ? 'is-preview-off' : 'is-preview-pin');
    return;
  }
  if (active || pinned) el.classList.add('is-preview-off');
  else el.classList.add('is-preview-on');
}

function useDelayedClick(
  onSingle: () => void,
  onDouble: () => void,
  paint?: (mode: 'single' | 'double', el: HTMLElement) => void,
) {
  const singleRef = useRef(onSingle);
  const doubleRef = useRef(onDouble);
  const timer = useRef<number | null>(null);
  singleRef.current = onSingle;
  doubleRef.current = onDouble;
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const arm = (event: { currentTarget: EventTarget }, mode: 'single' | 'double', run: () => void) => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    paint?.(mode, event.currentTarget as HTMLElement);
    fadeThen(run);
  };
  return {
    onClick: (event: { currentTarget: EventTarget }) => {
      if (timer.current != null) {
        arm(event, 'double', () => doubleRef.current());
        return;
      }
      paint?.('single', event.currentTarget as HTMLElement);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fadeThen(() => singleRef.current());
      }, 400);
    },
    onDoubleClick: (event: { currentTarget: EventTarget }) => {
      arm(event, 'double', () => doubleRef.current());
    },
  };
}

function FilterIconButton(props: {
  title: string;
  active: boolean;
  pinned: boolean;
  className: string;
  onClick: () => void;
  onPin: () => void;
  children: ReactNode;
}) {
  const gestures = useDelayedClick(props.onClick, props.onPin, (mode, el) =>
    paintIconButton(el, mode, props.active, props.pinned),
  );
  return (
    <button
      type="button"
      title={props.title}
      data-icon-filter=""
      aria-pressed={props.active || props.pinned}
      className={`${props.className} select-none`}
      onClick={gestures.onClick}
      onDoubleClick={gestures.onDoubleClick}
    >
      {props.children}
    </button>
  );
}

function FilterRow(props: {
  label: string;
  count: { open: number; done: number };
  active: boolean;
  pinned?: boolean;
  excluded?: boolean;
  bold?: boolean;
  danger?: boolean;
  onClick: () => void;
  onClear?: () => void;
  onPin?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const gestures = useDelayedClick(
    props.onClick,
    () => props.onPin?.(),
    (mode) => {
      if (rowRef.current) {
        paintFilterRow(rowRef.current, mode, props.active, Boolean(props.pinned), Boolean(props.excluded));
      }
    },
  );
  const labelClass = `${props.danger ? 'text-red-900' : 'text-slate-700'} ${props.bold ? 'font-semibold' : ''}`;
  const countClass = props.danger
    ? props.active
      ? 'text-red-950'
      : 'text-red-900'
    : props.active
      ? 'text-emerald-800'
      : 'text-sky-700';
  const pinAt = useRef(0);
  return (
    <div
      ref={rowRef}
      className={`bro-filter-row flex w-full min-w-0 items-center gap-0.5 rounded px-0.5 py-0.5 ${
        props.excluded ? 'is-excluded' : props.pinned ? 'is-pinned' : props.active ? 'is-active' : ''
      }`}
    >
      <button
        type="button"
        title="Закрепить / Открепить"
        className={`bro-filter-pin inline-flex h-4 w-4 shrink-0 items-center justify-center ${
          props.pinned || props.excluded ? 'text-white' : 'text-slate-400 hover:text-slate-700'
        }`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          const now = Date.now();
          if (now - pinAt.current < 280) return;
          pinAt.current = now;
          if (rowRef.current) {
            paintFilterRow(rowRef.current, 'double', props.active, Boolean(props.pinned), Boolean(props.excluded));
          }
          fadeThen(() => props.onPin?.());
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <PaperclipIcon className="h-3 w-3" />
      </button>
      <button
        type="button"
        title={props.label}
        onClick={gestures.onClick}
        onDoubleClick={gestures.onDoubleClick}
        className="flex min-w-0 flex-1 items-center gap-1 text-left select-none"
      >
        <span className={`${labelClass} min-w-0 shrink truncate`}>{props.label}</span>
        <span
          aria-hidden
          className="mx-1 h-px min-w-3 flex-1 self-center"
          style={{
            backgroundImage: 'radial-gradient(circle, #94a3b8 0.7px, transparent 0.85px)',
            backgroundSize: '6px 1px',
            backgroundRepeat: 'repeat-x',
          }}
        />
        <span
          className={`w-8 shrink-0 text-right font-semibold tabular-nums ${countClass}`}
          title="Не готово"
        >
          {props.count.open}
        </span>
        <span
          className="bro-done-count w-9 shrink-0 rounded px-1 py-px text-right text-[10px] font-medium leading-none tabular-nums"
          title="Готово"
        >
          {props.count.done}
        </span>
      </button>
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <button
          type="button"
          title={props.excluded ? 'Снять исключение' : 'Исключить'}
          className={`bro-filter-x inline-flex h-4 w-4 items-center justify-center ${
            props.pinned || props.excluded ? 'text-white' : 'text-slate-400 hover:text-slate-700'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            if (rowRef.current) {
              clearFadePreview();
              rowRef.current.classList.add(props.excluded ? 'is-preview-off' : 'is-preview-exclude');
            }
            fadeThen(() => props.onClear?.());
          }}
        >
          <EyeOffIcon className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

function OthersAssigneeMenu(props: {
  top: number;
  left: number;
  anchor: HTMLElement | null;
  fromOthers: BoardPersonPick[];
  fromParticipants: BoardPersonPick[];
  onClose: () => void;
  onPick: (pick: BoardPersonPick) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (props.anchor?.contains(target)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [props.anchor]);
  const empty = !props.fromOthers.length && !props.fromParticipants.length;
  return (
    <div
      ref={ref}
      className="fixed z-[200] max-h-80 w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      style={{ top: props.top, left: props.left }}
    >
      {empty ? (
        <div className="px-2 py-1 text-xs text-slate-400">Никого нет</div>
      ) : (
        <>
          {props.fromOthers.length > 0 && (
            <ul>
              {props.fromOthers.map((item) => (
                <li key={item.key}>
                  <PickRow item={item} onPick={props.onPick} />
                </li>
              ))}
            </ul>
          )}
          {props.fromParticipants.length > 0 && (
            <ul className={props.fromOthers.length ? 'mt-1 border-t border-slate-200 pt-1' : ''}>
              {props.fromParticipants.map((item) => (
                <li key={item.key}>
                  <PickRow item={item} onPick={props.onPick} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PickRow(props: { item: BoardPersonPick; onPick: (pick: BoardPersonPick) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-slate-800 hover:bg-slate-50"
      title="Показать строку на этой доске"
      onClick={() => props.onPick(props.item)}
    >
      <span className="min-w-0 flex-1 truncate">{props.item.label}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-slate-400">{props.item.total ?? 0}</span>
    </button>
  );
}

function nameIn(set: Set<string>, value: string | null | undefined, unassigned: boolean): boolean {
  if (!set.size) return true;
  if (set.has(UNASSIGNED_FILTER) && unassigned) return true;
  const name = (value || '').trim();
  return Boolean(name) && set.has(name);
}

function issuesForStatus(
  issuesByColumn: Record<string, TrackerIssue[]>,
  statusKey: string,
  sourceColumns: BoardColumnConfig[],
): TrackerIssue[] {
  if (!statusKey.startsWith('group:')) return issuesByColumn[statusKey] || [];
  const groupId = Number(statusKey.slice('group:'.length));
  return sourceColumns
    .filter((column) => column.groupId === groupId)
    .flatMap((column) => issuesByColumn[column.statusKey] || []);
}

function issuesForSelection(
  source: BoardMatrix | null,
  selection: CellSelection | null,
  doneStatusKeys: ReadonlySet<string> | undefined,
  sourceColumns: BoardColumnConfig[],
  finalKeys: ReadonlySet<string> | null,
): TrackerIssue[] {
  if (!source || !selection || selection.kind !== 'issues') return [];
  if (selection.statusKey === PENDING_COLUMN) {
    const rows =
      selection.developerId != null
        ? source.developers.filter((row) => row.developer.id === selection.developerId)
        : source.developers;
    return rows
      .flatMap((row) => Object.values(row.issuesByColumn).flat())
      .filter((issue) => !issueIsBoardDone(issue, doneStatusKeys, finalKeys));
  }
  if (selection.developerId != null && selection.statusKey == null) {
    const row = source.developers.find((item) => item.developer.id === selection.developerId);
    return row ? Object.values(row.issuesByColumn).flat() : [];
  }
  if (selection.developerId != null && selection.statusKey != null) {
    const row = source.developers.find((item) => item.developer.id === selection.developerId);
    return row ? issuesForStatus(row.issuesByColumn, selection.statusKey, sourceColumns) : [];
  }
  if (selection.developerId == null && selection.statusKey != null) {
    return source.developers.flatMap((row) =>
      issuesForStatus(row.issuesByColumn, selection.statusKey!, sourceColumns),
    );
  }
  return source.developers.flatMap((row) => Object.values(row.issuesByColumn).flat());
}

function nameExcluded(set: Set<string>, value: string | null | undefined, unassigned: boolean): boolean {
  if (!set.size) return false;
  if (unassigned && set.has(UNASSIGNED_FILTER)) return true;
  const name = (value || '').trim();
  return Boolean(name) && set.has(name);
}

function sprintAllowed(
  issue: TrackerIssue,
  include: Set<number>,
  exclude: Set<number>,
  doneStatusKeys: ReadonlySet<string> | undefined,
  finalKeys: ReadonlySet<string> | null,
): boolean {
  const bare = issue.sprintId == null;
  if (bare) {
    if (exclude.has(NO_SPRINT)) return false;
    if (include.has(NO_SPRINT)) return !issueIsBoardDone(issue, doneStatusKeys, finalKeys);
    return ![...include].some((id) => id !== NO_SPRINT);
  }
  if (exclude.has(issue.sprintId as number)) return false;
  const real = [...include].filter((id) => id !== NO_SPRINT);
  if (include.has(NO_SPRINT) && real.length === 0) return false;
  if (real.length > 0 && !real.includes(issue.sprintId as number)) return false;
  return true;
}

function applyCast(matrix: BoardMatrix, person: Developer | null): BoardMatrix {
  if (!person) return matrix;
  const names = [person.displayName, person.login].map((item) => item.trim().toLowerCase()).filter(Boolean);
  const hit = (value: string | null | undefined) => names.includes((value || '').trim().toLowerCase());
  const match = (issue: TrackerIssue) =>
    hit(issue.authorDisplay) || hit(issue.assigneeDisplay) || hit(issue.reviewerDisplay) || hit(issue.qaDisplay);
  const developers = matrix.developers.map((row) => {
    const issuesByColumn: Record<string, TrackerIssue[]> = {};
    const counts: Record<string, number> = {};
    for (const col of matrix.columns) {
      const issues = (row.issuesByColumn[col.statusKey] || []).filter(match);
      issuesByColumn[col.statusKey] = issues;
      counts[col.statusKey] = issues.length;
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { ...row, issuesByColumn, counts, total };
  });
  const columnTotals: Record<string, number> = Object.fromEntries(matrix.columns.map((col) => [col.statusKey, 0]));
  let grandTotal = 0;
  for (const row of developers) {
    for (const col of matrix.columns) columnTotals[col.statusKey] += row.counts[col.statusKey] || 0;
    grandTotal += row.total;
  }
  return { ...matrix, developers, columnTotals, grandTotal };
}

function applyFilters(
  matrix: BoardMatrix,
  sprintIds: Set<number>,
  reviewerNames: Set<string>,
  qaNames: Set<string>,
  authorNames: Set<string>,
  assigneeNames: Set<string>,
  excluded: {
    sprints: Set<number>;
    reviewers: Set<string>;
    qas: Set<string>;
    authors: Set<string>;
    assignees: Set<string>;
  },
  doneStatusKeys: ReadonlySet<string> | undefined,
  finalKeys: ReadonlySet<string> | null,
): BoardMatrix {
  if (
    !sprintIds.size &&
    !reviewerNames.size &&
    !qaNames.size &&
    !authorNames.size &&
    !assigneeNames.size &&
    !excluded.sprints.size &&
    !excluded.reviewers.size &&
    !excluded.qas.size &&
    !excluded.authors.size &&
    !excluded.assignees.size
  ) {
    return matrix;
  }

  const match = (issue: TrackerIssue) => {
    if (!sprintAllowed(issue, sprintIds, excluded.sprints, doneStatusKeys, finalKeys)) return false;
    const reviewerMissing = !(issue.reviewerDisplay || '').trim();
    const qaMissing = !(issue.qaDisplay || '').trim();
    const authorMissing = !(issue.authorDisplay || '').trim();
    const assigneeMissing = !(issue.assigneeDisplay || '').trim();
    if (nameExcluded(excluded.reviewers, issue.reviewerDisplay, reviewerMissing)) return false;
    if (nameExcluded(excluded.qas, issue.qaDisplay, qaMissing)) return false;
    if (nameExcluded(excluded.authors, issue.authorDisplay, authorMissing)) return false;
    if (nameExcluded(excluded.assignees, issue.assigneeDisplay, assigneeMissing)) return false;
    if (!nameIn(reviewerNames, issue.reviewerDisplay, reviewerMissing)) return false;
    if (!nameIn(qaNames, issue.qaDisplay, qaMissing)) return false;
    if (!nameIn(authorNames, issue.authorDisplay, authorMissing)) return false;
    if (!nameIn(assigneeNames, issue.assigneeDisplay, assigneeMissing)) return false;
    return true;
  };

  const developers = matrix.developers.map((row) => {
    const issuesByColumn: Record<string, TrackerIssue[]> = {};
    const counts: Record<string, number> = {};
    for (const col of matrix.columns) {
      const issues = (row.issuesByColumn[col.statusKey] || []).filter(match);
      issuesByColumn[col.statusKey] = issues;
      counts[col.statusKey] = issues.length;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { ...row, issuesByColumn, counts, total };
  });

  const columnTotals: Record<string, number> = Object.fromEntries(
    matrix.columns.map((c) => [c.statusKey, 0]),
  );
  let grandTotal = 0;
  for (const row of developers) {
    for (const col of matrix.columns) {
      columnTotals[col.statusKey] += row.counts[col.statusKey] || 0;
    }
    grandTotal += row.total;
  }

  return { ...matrix, developers, columnTotals, grandTotal };
}

type BoardScope = 'changes' | 'done' | 'open' | 'total';

function applyBoardScope(
  matrix: BoardMatrix,
  scope: BoardScope,
  doneStatusKeys: ReadonlySet<string> | undefined,
  changeKeys: ReadonlySet<string>,
  finalKeys: ReadonlySet<string> | null,
): BoardMatrix {
  if (scope === 'total') return matrix;
  const match = (issue: TrackerIssue) => {
    if (scope === 'changes') return changeKeys.has(issue.key);
    if (scope === 'done') return issueIsBoardDone(issue, doneStatusKeys, finalKeys);
    return !issueIsBoardDone(issue, doneStatusKeys, finalKeys);
  };
  const developers = matrix.developers.map((row) => {
    const issuesByColumn: Record<string, TrackerIssue[]> = {};
    const counts: Record<string, number> = {};
    for (const col of matrix.columns) {
      const issues = (row.issuesByColumn[col.statusKey] || []).filter(match);
      issuesByColumn[col.statusKey] = issues;
      counts[col.statusKey] = issues.length;
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return { ...row, issuesByColumn, counts, total };
  });
  const columnTotals: Record<string, number> = Object.fromEntries(
    matrix.columns.map((column) => [column.statusKey, 0]),
  );
  let grandTotal = 0;
  for (const row of developers) {
    for (const column of matrix.columns) columnTotals[column.statusKey] += row.counts[column.statusKey] || 0;
    grandTotal += row.total;
  }
  return { ...matrix, developers, columnTotals, grandTotal };
}

function splitVisible(
  issuesByColumn: Record<string, TrackerIssue[]>,
  shown: Array<{ statusKey: string; alias: string; statusDisplay?: string }>,
  doneStatusKeys: ReadonlySet<string> | undefined,
  finalKeys: ReadonlySet<string> | null,
): { open: number; total: number } {
  const seen = new Set<string>();
  let total = 0;
  let done = 0;
  for (const column of shown) {
    for (const issue of issuesByColumn[column.statusKey] || []) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
      total += 1;
      if (issueIsBoardDone(issue, doneStatusKeys, finalKeys)) done += 1;
    }
  }
  return { open: Math.max(0, total - done), total };
}

function visibleIssuesByColumn(
  matrix: BoardMatrix,
  shown: Array<{ statusKey: string }>,
): Record<string, TrackerIssue[]> {
  const issuesByColumn: Record<string, TrackerIssue[]> = {};
  for (const column of shown) {
    issuesByColumn[column.statusKey] = matrix.developers.flatMap(
      (row) => row.issuesByColumn[column.statusKey] || [],
    );
  }
  return issuesByColumn;
}

function assigneeTaskCount(
  matrix: BoardMatrix | null,
  statusKeys: Set<string>,
  pick: BoardPersonPick,
): number {
  if (!matrix || !statusKeys.size) return 0;
  const seen = new Set<string>();
  let total = 0;
  for (const row of matrix.developers) {
    for (const [statusKey, issues] of Object.entries(row.issuesByColumn)) {
      if (!statusKeys.has(statusKey)) continue;
      for (const issue of issues) {
        if (seen.has(issue.key) || !pickMatchesIssue(pick, issue)) continue;
        seen.add(issue.key);
        total += 1;
      }
    }
  }
  return total;
}

function pickMatchesIssue(pick: BoardPersonPick, issue: TrackerIssue): boolean {
  if (pick.participant) return sameAssignee(pick.participant, issue);
  const login = (issue.assigneeLogin || '').toLowerCase();
  const uid = issue.assigneeUid ? String(issue.assigneeUid) : '';
  const name = (issue.assigneeDisplay || '').trim();
  if (pick.login && login === pick.login.toLowerCase()) return true;
  if (pick.uid && uid === pick.uid) return true;
  return Boolean(name) && name === pick.label;
}

function matrixHasIssue(board: BoardMatrix | null, key: string): boolean {
  if (!board) return false;
  for (const row of board.developers) {
    for (const list of Object.values(row.issuesByColumn)) {
      if (list.some((issue) => issue.key === key)) return true;
    }
  }
  return false;
}

function boardIdsInMatrix(board: BoardMatrix | null, key: string): number[] {
  if (!board) return [];
  for (const row of board.developers) {
    for (const list of Object.values(row.issuesByColumn)) {
      const issue = list.find((item) => item.key === key);
      if (issue) return issue.boardIds || [];
    }
  }
  return [];
}

function boardStatusTotals(
  matrix: BoardMatrix | null,
  doneStatusKeys: ReadonlySet<string> | undefined,
  finalKeys: ReadonlySet<string> | null,
): { open: number; done: number; total: number } {
  if (!matrix) return { open: 0, done: 0, total: 0 };
  const seen = new Set<string>();
  let done = 0;
  let total = 0;
  for (const row of matrix.developers) {
    for (const [statusKey, issues] of Object.entries(row.issuesByColumn)) {
      for (const issue of issues) {
        if (seen.has(issue.key)) continue;
        seen.add(issue.key);
        total += 1;
        if (issueIsBoardDone(issue, doneStatusKeys, finalKeys)) done += 1;
      }
    }
  }
  return { open: Math.max(0, total - done), done, total };
}

function countUnassignedIssues(
  matrix: BoardMatrix,
  field: 'reviewerDisplay' | 'qaDisplay',
): number {
  const seen = new Set<string>();
  let n = 0;
  for (const row of matrix.developers) {
    for (const issues of Object.values(row.issuesByColumn)) {
      for (const issue of issues) {
        if (seen.has(issue.key)) continue;
        seen.add(issue.key);
        if (!(issue[field] || '').trim()) n += 1;
      }
    }
  }
  return n;
}

/** Newest sprint first: later start, then later end, then higher Tracker id. */
function compareSprintsNewestFirst(
  a: { id: number; startDate?: string | null; endDate?: string | null },
  b: { id: number; startDate?: string | null; endDate?: string | null },
): number {
  const byStart = compareDateDesc(a.startDate, b.startDate);
  if (byStart !== 0) return byStart;
  const byEnd = compareDateDesc(a.endDate, b.endDate);
  if (byEnd !== 0) return byEnd;
  return b.id - a.id;
}

function compareDateDesc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ar = sprintDateRank(a);
  const br = sprintDateRank(b);
  if (ar === br) return 0;
  return br > ar ? 1 : -1;
}

function sprintDateRank(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const d = parseDateOnly(iso);
  return d ? d.getTime() : Number.NEGATIVE_INFINITY;
}

/** Prefer UI sprint filter; else preferred matrix sprint by title; else first sprintCounts entry. */
function getCurrentSprintId(
  sprintCounts: Array<{ id: number; name: string }>,
  sprintFilter: number | null,
  preferredName?: string,
): number | null {
  if (sprintFilter != null && sprintFilter !== NO_SPRINT) return sprintFilter;
  if (preferredName) {
    const found = sprintCounts.find((s) => s.name === preferredName);
    if (found) return found.id;
  }
  return sprintCounts[0]?.id ?? null;
}

/** Prefer UI sprint filter; else use matrix meta (open/in-progress sprint). */
type SprintHead = {
  id: number;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
};

function describeSprintHeader(
  sprintCounts: SprintHead[],
  activeSprints: Set<number>,
  snapshotDate: string | null,
): { title: string; extra: number | null; period: string | null; stale: 'устарел' | 'устарели' | null } {
  const selected = sprintCounts.filter((sprint) => activeSprints.has(sprint.id));
  if (selected.length === 0) {
    if (activeSprints.has(NO_SPRINT)) {
      return { title: 'Без спринта', extra: null, period: null, stale: null };
    }
    const span = sprintSpan(sprintCounts);
    const noneCurrent =
      sprintCounts.length > 0 &&
      sprintCounts.every((sprint) =>
        isSprintOutdated(sprint.startDate ?? null, sprint.endDate ?? null, snapshotDate),
      );
    return {
      title: 'Все спринты',
      extra: null,
      period: formatSprintPeriod(span.start, span.end),
      stale: noneCurrent ? 'устарели' : null,
    };
  }
  if (selected.length === 1) {
    const sprint = selected[0];
    return {
      title: sprint.name,
      extra: null,
      period: formatSprintPeriod(sprint.startDate ?? null, sprint.endDate ?? null),
      stale: isSprintOutdated(sprint.startDate ?? null, sprint.endDate ?? null, snapshotDate)
        ? 'устарел'
        : null,
    };
  }
  const freshest = [...selected].sort(compareSprintsNewestFirst)[0];
  const span = sprintSpan(selected);
  return {
    title: freshest.name,
    extra: selected.length - 1,
    period: formatSprintPeriod(span.start, span.end),
    stale: isSprintOutdated(span.start, span.end, snapshotDate) ? 'устарел' : null,
  };
}

function sprintSpan(sprints: SprintHead[]): { start: string | null; end: string | null } {
  let start: string | null = null;
  let end: string | null = null;
  for (const sprint of sprints) {
    if (sprint.startDate && (start == null || sprintDateRank(sprint.startDate) < sprintDateRank(start))) {
      start = sprint.startDate;
    }
    if (sprint.endDate && (end == null || sprintDateRank(sprint.endDate) > sprintDateRank(end))) {
      end = sprint.endDate;
    }
  }
  return { start, end };
}

function resolveBoardSprint(
  sprintCounts: Array<{
    id: number;
    name: string;
    count: number;
    startDate?: string | null;
    endDate?: string | null;
  }>,
  sprintFilter: number | null,
  fallbackName?: string,
  fallbackStart?: string | null,
  fallbackEnd?: string | null,
): { name: string; startDate: string | null; endDate: string | null } {
  if (sprintFilter === NO_SPRINT) {
    return { name: 'Без спринта', startDate: null, endDate: null };
  }
  if (sprintFilter != null) {
    const found = sprintCounts.find((s) => s.id === sprintFilter);
    return {
      name: found?.name || fallbackName || 'Спринт не выбран',
      startDate: found?.startDate ?? null,
      endDate: found?.endDate ?? null,
    };
  }
  return {
    name: fallbackName || 'Спринт не выбран',
    startDate: fallbackStart ?? null,
    endDate: fallbackEnd ?? null,
  };
}

/** Format ISO/date strings as dd.mm - dd.mm with leading zeros. */
function formatSprintPeriod(start: string | null, end: string | null): string | null {
  const a = formatDayMonth(start);
  const b = formatDayMonth(end);
  if (!a && !b) return null;
  return `${a || '??.??'} - ${b || '??.??'}`;
}

function formatDayMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = parseDateOnly(iso);
  if (!d) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/** Parse YYYY-MM-DD or ISO datetime as local calendar day. */
function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Outdated when the reference date (snapshot date, else today)
 * falls strictly outside [start, end]. Missing bounds are ignored.
 */
function isSprintOutdated(
  start: string | null,
  end: string | null,
  snapshotDate: string | null,
): boolean {
  if (!start && !end) return false;
  const ref = snapshotDate ? parseDateOnly(snapshotDate) : new Date();
  if (!ref) return false;
  const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const startDay = start ? parseDateOnly(start) : null;
  const endDay = end ? parseDateOnly(end) : null;
  if (startDay && refDay < startDay) return true;
  if (endDay && refDay > endDay) return true;
  return false;
}

function SprintHeaderStats(props: {
  matrix: BoardMatrix;
  sprintFilter: number | null;
}) {
  const stats = useMemo(() => {
    const sprintId =
      props.sprintFilter ??
      (
        props.matrix.sprintCounts.find((s) => s.name === props.matrix.sprintTitle) ||
        [...props.matrix.sprintCounts].sort((a, b) => b.id - a.id)[0]
      )?.id ??
      null;
    const fromApi =
      sprintId != null ? props.matrix.sprintStatsById?.[sprintId] : undefined;
    if (fromApi) return fromApi;

    // Fallback for old snapshots without sprintStatsById
    const issues = props.matrix.developers.flatMap((r) =>
      Object.values(r.issuesByColumn).flat(),
    );
    const inSprint =
      sprintId == null ? issues : issues.filter((i) => i.sprintId === sprintId);
    const seen = new Set<string>();
    const unique: TrackerIssue[] = [];
    for (const i of inSprint) {
      if (seen.has(i.key)) continue;
      seen.add(i.key);
      unique.push(i);
    }
    return {
      total: unique.length,
      unassigned: unique.filter(
        (i) => !i.assigneeDisplay?.trim() && !i.assigneeLogin && !i.assigneeUid,
      ).length,
      done: unique.filter((i) => issueIsDone(i)).length,
    };
  }, [props.matrix, props.sprintFilter]);

  return (
    <div className="flex flex-col items-end leading-tight text-[11px] shrink-0">
      <div className="text-slate-900 font-medium">Всего в спринте: {stats.total}</div>
      <div className="text-slate-400">Без исполнителя: {stats.unassigned}</div>
      <div className="text-green-800">Готово: {stats.done}</div>
    </div>
  );
}

function FilterGroupsMinimizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function FilterGroupsMaximizeIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
