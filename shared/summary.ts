import type { BoardColumnConfig, Developer } from './types';

export type SummaryPreset = 'day' | 'week' | 'month' | 'quarter';

export type SummaryPeriod =
  | { kind: 'preset'; id: SummaryPreset }
  | { kind: 'custom'; from: string; to: string; fromTime?: string; toTime?: string };

export type SummaryBoardRef = {
  boardLocalId: number;
  trackerBoardId: number;
  queueKey: string;
  name: string;
  alias: string;
};

export type SummaryBuildRequest = {
  boardLocalId: number | null;
  trackerBoardId: number | null;
  queueKey: string;
  participant: Developer | null;
  period: SummaryPeriod;
  columns: Array<Pick<BoardColumnConfig, 'statusKey' | 'alias' | 'statusDisplay' | 'columnName'>>;
  boards?: SummaryBoardRef[];
};

export type SummarySlice = {
  report: SummaryReport;
  coverageFrom: string;
  coverageTo: string;
  complete: boolean;
};

export type SummaryColumnTime = {
  statusKey: string;
  /** Tracker status name, not the app alias. */
  label: string;
  ms: number;
  workMs?: number;
  kind: 'testing' | 'work' | 'review' | 'other';
};

export type SummaryShuffle = {
  role: 'assignee' | 'qa' | 'reviewer';
  tone: 'success' | 'danger';
  title: string;
};

export type SummaryRow = {
  key: string;
  summary: string;
  url: string;
  assignee: string;
  reviewer: string;
  qa: string;
  author: string;
  createdAt: string | null;
  /** When the task entered a status of type done. */
  finalStatusAt: string | null;
  /** When the task first entered an in-progress status. */
  takenAt?: string | null;
  statusKey?: string;
  assignees?: string[];
  qas?: string[];
  reviewers?: string[];
  sprints?: string[];
  receivedAt: string | null;
  receivedStatus: string;
  receivedSprint: string;
  currentSprint: string;
  currentStatus: string;
  currentStatusAt: string | null;
  commentCount: number;
  /** Comment events per summary user id. */
  commentsById?: Record<string, number>;
  firstCommentAt: string | null;
  lastCommentAt: string | null;
  /** Latest changelog or issue update time. */
  lastActivityAt?: string | null;
  /** Latest described changelog event on the task. */
  lastActionAt?: string | null;
  lastActionText?: string;
  /** Latest described changelog event per summary user id. */
  lastById?: Record<string, { at: string; text: string }>;
  /** Summary users who touched the task inside the period. */
  touchedIds?: number[];
  /** Summary users who authored a changelog event inside the period. */
  changedByIds?: number[];
  boardLocalId?: number | null;
  boardLabel?: string;
  columns: SummaryColumnTime[];
  shuffles: SummaryShuffle[];
  emphasizeTesting: boolean;
  emphasizeWork: boolean;
  emphasizeReview: boolean;
};

export function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return isoDate(new Date(year, month - 1, day + days));
}

export function shiftIsoMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return isoDate(new Date(year, month - 1 + months, day));
}

/** Previous Mon–Fri through today. Monday starts at the last Friday. */
export function previousWorkdayIso(today = new Date()): string {
  const day = today.getDay();
  const back = day === 1 ? 3 : day === 0 ? 2 : 1;
  return shiftIsoDate(isoDate(today), -back);
}

export function defaultSummaryPeriod(today = new Date()): SummaryPeriod {
  return {
    kind: 'custom',
    from: previousWorkdayIso(today),
    to: isoDate(today),
    fromTime: '12:00',
    toTime: '12:00',
  };
}

export type SummaryReport = {
  formedAt: string;
  period: SummaryPeriod;
  participantName: string;
  requests: number;
  rows: SummaryRow[];
};
