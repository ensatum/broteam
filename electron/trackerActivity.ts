import { readApiDayCount, writeApiDayCount } from './db';

export type TrackerActivity = {
  total: number;
  inflight: number;
  sinceRefresh: number;
  dayTotal: number;
};

let total = 0;
let inflight = 0;
let sinceRefresh = 0;
let refreshSeen = false;
let dayTotal = 0;
let dayStamp = '';
const listeners = new Set<(state: TrackerActivity) => void>();

function localDay(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function initApiUsage(): void {
  const saved = readApiDayCount();
  const today = localDay();
  dayStamp = today;
  dayTotal = saved.date === today ? saved.total : 0;
  if (saved.date !== today) writeApiDayCount(today, 0);
}

export function trackerActivity(): TrackerActivity {
  return { total, inflight, sinceRefresh, dayTotal };
}

export function resetTrackerActivity(): TrackerActivity {
  total = 0;
  inflight = 0;
  emit();
  return trackerActivity();
}

/** Next Tracker calls belong to a new "refresh all boards", including that refresh itself. */
export function beginBoardRefreshUsage(): TrackerActivity {
  sinceRefresh = 0;
  refreshSeen = true;
  emit();
  return trackerActivity();
}

export function subscribeTrackerActivity(listener: (state: TrackerActivity) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function trackRequestStart(): void {
  total += 1;
  inflight += 1;
  const today = localDay();
  if (today !== dayStamp) {
    dayStamp = today;
    dayTotal = 0;
  }
  dayTotal += 1;
  if (refreshSeen) sinceRefresh += 1;
  writeApiDayCount(dayStamp, dayTotal);
  emit();
}

export function trackRequestEnd(): void {
  inflight = Math.max(0, inflight - 1);
  emit();
}

function emit(): void {
  const state = trackerActivity();
  for (const listener of listeners) listener(state);
}
