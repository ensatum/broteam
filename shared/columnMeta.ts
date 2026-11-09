import type { BoardColumnConfig, TrackerIssue } from './types';

export type ColumnRole = 'review' | 'testing' | 'other';

export function columnRole(col: {
  alias: string;
  statusKey?: string;
  statusDisplay?: string;
  columnName?: string;
  duty?: string;
}): ColumnRole {
  if (col.duty === 'review' || col.duty === 'testing') return col.duty;
  const label = `${col.alias} ${col.statusDisplay || ''} ${col.statusKey || ''} ${col.columnName || ''}`;
  if (/\b(review|ревью)\b/i.test(label) || /inReview/i.test(col.statusKey || '')) {
    return 'review';
  }
  if (
    /\b(test|testing|qa|тест)\b/i.test(label) ||
    /testirovanie|testing|readyForTest|rc/i.test(col.statusKey || '')
  ) {
    return 'testing';
  }
  return 'other';
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
}

export function issueMissingOwner(issue: TrackerIssue, role: ColumnRole): boolean {
  if (role === 'review') return !issue.reviewerDisplay?.trim();
  if (role === 'testing') return !issue.qaDisplay?.trim();
  return false;
}

export type MissingBadgeTone = 'warn' | 'muted';

export type CellMissingBadges = {
  missingReviewer: boolean;
  missingTester: boolean;
  reviewerTone: MissingBadgeTone;
  testerTone: MissingBadgeTone;
};

/** Missing R/T in any column; red only in Review / Testing columns, otherwise muted. */
export function cellMissingBadges(
  issues: TrackerIssue[],
  col: BoardColumnConfig | { alias: string; statusKey: string; statusDisplay?: string },
): CellMissingBadges {
  const role = columnRole(col);
  const missingReviewer = issues.some((i) => !i.reviewerDisplay?.trim());
  const missingTester = issues.some((i) => !i.qaDisplay?.trim());
  return {
    missingReviewer,
    missingTester,
    reviewerTone: role === 'review' ? 'warn' : 'muted',
    testerTone: role === 'testing' ? 'warn' : 'muted',
  };
}

export function issueMissingBadges(
  issue: TrackerIssue,
  col: BoardColumnConfig | { alias: string; statusKey: string; statusDisplay?: string; columnName?: string },
): CellMissingBadges {
  return cellMissingBadges([issue], col);
}

export function cellHasMissingOwner(
  issues: TrackerIssue[],
  col: BoardColumnConfig | { alias: string; statusKey: string; statusDisplay?: string },
): boolean {
  const b = cellMissingBadges(issues, col);
  return b.missingReviewer || b.missingTester;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TimeWarn = 'stale' | 'overdue';

/** Latest of status change / last comment, or null if unknown. */
export function issueLastActivityMs(issue: TrackerIssue): number | null {
  const statusTs = issue.statusStartTime ? Date.parse(issue.statusStartTime) : NaN;
  const commentTs = issue.lastCommentUpdatedAt
    ? Date.parse(issue.lastCommentUpdatedAt)
    : NaN;
  const times = [statusTs, commentTs].filter((t) => !Number.isNaN(t));
  if (!times.length) return null;
  return Math.max(...times);
}

/** Stale: no status change and no comment for more than a week. */
export function isIssueStale(issue: TrackerIssue, now = Date.now()): boolean {
  const lastActivity = issueLastActivityMs(issue);
  if (lastActivity == null) return false;
  return now - lastActivity > WEEK_MS;
}

/** Overdue: deadline date is before today (local calendar). */
export function isIssueOverdue(issue: TrackerIssue, now = Date.now()): boolean {
  if (!issue.deadline) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(issue.deadline.trim());
  if (!m) return false;
  const deadlineDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now);
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return deadlineDay < todayDay;
}

/** Red stale wins over orange overdue. */
export function issueTimeWarn(issue: TrackerIssue, now = Date.now()): TimeWarn | null {
  if (isIssueStale(issue, now)) return 'stale';
  if (isIssueOverdue(issue, now)) return 'overdue';
  return null;
}

export function cellTimeWarn(issues: TrackerIssue[], now = Date.now()): TimeWarn | null {
  if (issues.some((i) => isIssueStale(i, now))) return 'stale';
  if (issues.some((i) => isIssueOverdue(i, now))) return 'overdue';
  return null;
}

export function formatDays(days: number | null): string {
  if (days == null) return '';
  if (days === 0) return '0 дн.';
  return `${days} дн.`;
}

/** Board column that is not a Tracker status: tasks outside a final status. */
export const PENDING_COLUMN = '__pending';

/** True when Tracker classifies the issue status as type `done`. */
export function issueIsDone(
  issue: TrackerIssue,
  doneStatusKeys?: ReadonlySet<string>,
): boolean {
  if (issue.statusType) return issue.statusType === 'done';
  return doneStatusKeys?.has(issue.statusKey) ?? false;
}

/** Hover text for clock on a single issue. */
export function formatIssueClockTitle(
  issue: TrackerIssue,
  warn: TimeWarn,
  now = Date.now(),
): string {
  const last = issueLastActivityMs(issue);
  if (last != null) {
    const days = Math.max(0, Math.floor((now - last) / DAY_MS));
    const date = new Date(last).toLocaleDateString('ru-RU');
    return `Последняя активность ${date} (${days} дн.)`;
  }
  return warn === 'stale' ? 'Нет активности более недели' : 'Просрочена';
}
