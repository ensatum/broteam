export type TrackerConnection = {
  token: string;
  cloudOrgId: string;
  orgId: string;
  apiUrl: string;
};

export type GithubSource = {
  remote: string;
  branch: string;
};

export const DEFAULT_GITHUB: GithubSource = {
  remote: 'https://github.com/ensatum/broteam',
  branch: 'main',
};

export type ParticipantRole = 'developer' | 'qa' | 'manager' | 'ai' | 'contact';

export const PARTICIPANT_ROLES: Array<{ id: ParticipantRole; label: string }> = [
  { id: 'developer', label: 'Разработчик' },
  { id: 'qa', label: 'Тестировщик' },
  { id: 'manager', label: 'Менеджер' },
  { id: 'ai', label: 'AI' },
  { id: 'contact', label: 'Контакт' },
];

/** Synthetic table rows, not stored as participants. */
export const UNASSIGNED_ROW_ID = -1;
export const OTHERS_ROW_ID = -2;

export type Developer = {
  id: number;
  login: string;
  displayName: string;
  uid: string;
  color: string;
  sortOrder: number;
  role: ParticipantRole;
  onVacation: boolean;
  /** When true, the person stays in settings and notes but has no table row. */
  hidden: boolean;
};

export type BoardColumnConfig = {
  id: number;
  columnId: string;
  columnName: string;
  statusKey: string;
  statusDisplay: string;
  alias: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  /** Local agile_boards.id. 0 = legacy rows before boards were split. */
  boardLocalId: number;
};

export type SavedBoard = {
  id: number;
  trackerBoardId: number;
  name: string;
  /** Name shown on board badges. Empty keeps the Tracker name. */
  alias: string;
  /** Accent for the board tab and summary badge. Empty keeps the neutral tab. */
  color: string;
  queueKey: string;
  enabled: boolean;
  sortOrder: number;
};

export type BoardConfig = {
  boardId: number | null;
  boardName: string;
  queueKey: string;
  /** @deprecated unused — open sprints are loaded from the board automatically */
  sprintIds: number[];
  /** @deprecated unused — QA list is derived from board issues */
  qaFilterNames: string[];
  /** Keep table column headers on a single line (no wrap) */
  columnHeadersNoWrap: boolean;
};

export type TrackerUser = {
  uid: number;
  login: string;
  display: string;
  email?: string | null;
  dismissed?: boolean;
};

export type TrackerBoard = {
  id: number;
  name: string;
  /** Primary queue key if known (from board.queues) */
  queueKey?: string | null;
};

export type TrackerBoardColumn = {
  id: string;
  name: string;
  statuses: Array<{ key: string; display: string }>;
};

export type TrackerSprint = {
  id: number;
  name: string;
  status: string;
  archived: boolean;
  startDate?: string | null;
  endDate?: string | null;
};

export type TrackerIssue = {
  key: string;
  summary: string;
  statusKey: string;
  statusDisplay: string;
  /** Tracker status type: new, inProgress, paused, done, cancelled. */
  statusType?: string;
  assigneeLogin: string | null;
  assigneeUid: string | null;
  assigneeDisplay: string | null;
  url: string;
  reviewerDisplay: string | null;
  qaDisplay: string | null;
  /** Tracker person id/uid for reviewer (kodRevu), when available */
  reviewerUid?: string | null;
  /** Tracker person id/uid for QA (qaEngineer), when available */
  qaUid?: string | null;
  /** All id/login/passport/cloud variants for reviewer matching */
  reviewerMatchKeys?: string[];
  /** All id/login/passport/cloud variants for QA matching */
  qaMatchKeys?: string[];
  statusStartTime: string | null;
  daysInStatus: number | null;
  /** ISO datetime the issue was created in Tracker, when the payload includes it */
  createdAt?: string | null;
  authorDisplay?: string | null;
  /** ISO datetime of the last Tracker update, when the payload includes it */
  updatedAt?: string | null;
  /** Display name of the user who last changed the issue. */
  updatedByDisplay?: string | null;
  /** Login and uid variants of that user, for matching a custom participant name. */
  updatedByMatchKeys?: string[];
  /** YYYY-MM-DD deadline from Tracker */
  deadline: string | null;
  /** ISO datetime of last comment */
  lastCommentUpdatedAt: string | null;
  sprintId: number | null;
  sprintName: string | null;
  /** Agile board ids the issue is on (from Tracker `boards`) */
  boardIds?: number[];
};

export type IssueNote = {
  issueKey: string;
  note: string;
};

export type IssueNoteRecord = {
  issueKey: string;
  note: string;
  updatedAt: string | null;
};

/** Local draft note (not linked to Tracker) */
export type LocalDraft = {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Participants and contacts related to the draft. Not a TODO assignment. */
  peopleIds: number[];
  favorite: boolean;
  note: string;
  /** Finished drafts stay in the list, hidden until the done filter is on. */
  done: boolean;
};

/** Local per-developer todo / «задумка» */
export type DeveloperTodo = {
  id: number;
  developerId: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type DeveloperNote = {
  developerId: number;
  note: string;
};

export type BoardMatrix = {
  columns: BoardColumnConfig[];
  developers: Array<{
    developer: Developer;
    counts: Record<string, number>;
    total: number;
    /** @deprecated use todos — kept for old snapshots */
    note: string;
    todos: DeveloperTodo[];
    issuesByColumn: Record<string, TrackerIssue[]>;
  }>;
  columnTotals: Record<string, number>;
  grandTotal: number;
  issueNotes: Record<string, string>;
  /** ISO timestamps of last note edit, keyed by issue key */
  issueNoteUpdatedAt: Record<string, string>;
  /** Local bookmarks keyed by issue key (true if bookmarked) */
  issueBookmarks: Record<string, boolean>;
  /** ISO timestamps when bookmark was added, keyed by issue key */
  issueBookmarkCreatedAt: Record<string, string>;
  fetchedAt: string;
  /** Local agile board this matrix was fetched for. */
  sourceBoardLocalId?: number | null;
  /**
   * True when the board has sprints. Tasks without a sprint stay on the default
   * view and drop out when «Без спринта» is excluded.
   */
  sprintScoped?: boolean;
  sprintTitle: string;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  sprintCounts: Array<{
    id: number;
    name: string;
    count: number;
    startDate?: string | null;
    endDate?: string | null;
  }>;
  reviewerCounts: Array<{ name: string; count: number }>;
  qaCounts: Array<{ name: string; count: number }>;
  /**
   * Sprint header stats (Всего / Без исполнителя / Готово), keyed by sprint id.
   * Counts only issues placed in this board's columns. «Готово» is status type done.
   */
  sprintStatsById?: Record<
    number,
    { total: number; unassigned: number; done: number }
  >;
};

export type SnapshotMeta = {
  id: number;
  date: string;
  createdAt: string;
};

export type SnapshotPayload = {
  date: string;
  connectionMeta: { cloudOrgId: string; orgId: string; apiUrl: string };
  board: BoardConfig;
  columns: BoardColumnConfig[];
  matrix: BoardMatrix;
  /** Cached matrices of every added board, keyed by local board id. */
  matrices?: Record<string, BoardMatrix>;
};

export type AppSettings = {
  connection: TrackerConnection;
  board: BoardConfig;
};

export const DEFAULT_CONNECTION: TrackerConnection = {
  token: '',
  cloudOrgId: '',
  orgId: '',
  apiUrl: 'https://api.tracker.yandex.net',
};

export const DEFAULT_BOARD: BoardConfig = {
  boardId: null,
  boardName: '',
  queueKey: '',
  sprintIds: [],
  qaFilterNames: [],
  columnHeadersNoWrap: false,
};

export const DEVELOPER_TONE_PRESETS = {
  auto: { label: 'Auto', hex: null as string | null },
  danger: { label: 'Danger', hex: '#ffc6c6' },
  problem: { label: 'Problem', hex: '#ffdbb6' },
  warning: { label: 'Warning', hex: '#ffffd7' },
  success: { label: 'Success', hex: '#dde8cb' },
  info: { label: 'Info', hex: '#cbe1f9' },
  muted: { label: 'Muted', hex: '#e4e6ea' },
} as const;

export type DeveloperTone = keyof typeof DEVELOPER_TONE_PRESETS;

/** @deprecated use DEVELOPER_TONE_PRESETS */
export const DEVELOPER_COLORS = Object.values(DEVELOPER_TONE_PRESETS)
  .map((p) => p.hex)
  .filter((h): h is string => Boolean(h));

export function normalizeParticipantRole(role: string | null | undefined): ParticipantRole {
  if (role === 'qa' || role === 'manager' || role === 'ai' || role === 'contact') return role;
  return 'developer';
}

export function normalizeDeveloperTone(color: string | null | undefined): DeveloperTone {
  if (!color) return 'auto';
  if (color in DEVELOPER_TONE_PRESETS) return color as DeveloperTone;
  const lower = color.toLowerCase();
  for (const [key, preset] of Object.entries(DEVELOPER_TONE_PRESETS)) {
    if (preset.hex && preset.hex.toLowerCase() === lower) return key as DeveloperTone;
  }
  return 'auto';
}

function sumByAlias(
  counts: Record<string, number>,
  columns: Array<{ statusKey: string; alias: string; statusDisplay?: string }>,
  pattern: RegExp,
): number {
  let sum = 0;
  for (const col of columns) {
    const label = `${col.alias} ${col.statusDisplay || ''} ${col.statusKey}`;
    if (pattern.test(label)) sum += counts[col.statusKey] || 0;
  }
  return sum;
}

/**
 * Auto tone from Work / Open only (New и остальные колонки не влияют).
 *
 * Priority when Work≥1 and Work≤1 both apply (Work=1): info/success first.
 *
 * info:    Work≥1 и Open≥10
 * success: Work≥1 и Open 2…10
 * warning: Work≤1 и Open≥2
 * problem: Work≤1 и Open=1
 * danger:  Work≤1 и Open=0 (или нет задач)
 */
export function toneFromWorkload(
  counts: Record<string, number>,
  columns: Array<{ statusKey: string; alias: string; statusDisplay?: string }>,
): Exclude<DeveloperTone, 'auto'> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'danger';

  const work = sumByAlias(
    counts,
    columns,
    /\b(active|in[\s_-]?progress|work|в работе|разработк)\b/i,
  );
  const open = sumByAlias(counts, columns, /\b(open|открыт)\b/i);

  if (work >= 1 && open >= 10) return 'info';
  if (work >= 1 && open >= 2 && open <= 10) return 'success';

  if (work <= 1) {
    if (open <= 0) return 'danger';
    if (open === 1) return 'problem';
    return 'warning'; // Open≥2
  }

  // Work≥2, но Open < 2 — нет «здорового» бэклога Open
  return 'warning';
}

export function resolveDeveloperRowColor(
  toneOrHex: string,
  counts: Record<string, number>,
  columns: Array<{ statusKey: string; alias: string; statusDisplay?: string }>,
): string {
  const tone = normalizeDeveloperTone(toneOrHex);
  if (tone === 'auto') {
    return DEVELOPER_TONE_PRESETS[toneFromWorkload(counts, columns)].hex!;
  }
  return DEVELOPER_TONE_PRESETS[tone].hex!;
}

/** Darken `#rrggbb` by factor (0–1), e.g. 0.2 ≈ 20% darker. */
export function darkenHex(hex: string, factor = 0.2): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - factor));
  const g = Math.round(((n >> 8) & 0xff) * (1 - factor));
  const b = Math.round((n & 0xff) * (1 - factor));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export const COLUMN_COLORS = [
  '#6b7280',
  '#111827',
  '#ea580c',
  '#dc2626',
  '#7c3aed',
  '#1d4ed8',
  '#0891b2',
  '#16a34a',
  '#ca8a04',
  '#db2777',
  '#4b5563',
];
