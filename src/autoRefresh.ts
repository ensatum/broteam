const ENABLED_KEY = 'broteam.autoRefresh';
const MINUTES_KEY = 'broteam.autoRefreshMinutes';
const SAVE_TIME_KEY = 'broteam.autoSaveTime';
const SAVE_STAMP_KEY = 'broteam.autoSaveStamp';

export function loadAutoRefresh(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAutoRefresh(enabled: boolean) {
  localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
}

export function loadAutoRefreshMinutes(): number {
  try {
    const n = Number(localStorage.getItem(MINUTES_KEY));
    if (!Number.isFinite(n) || n < 1) return 15;
    return Math.min(240, Math.round(n));
  } catch {
    return 15;
  }
}

export function saveAutoRefreshMinutes(minutes: number) {
  const clamped = Math.min(240, Math.max(1, Math.round(minutes)));
  localStorage.setItem(MINUTES_KEY, String(clamped));
}

export function loadAutoSaveTime(): string {
  try {
    const raw = localStorage.getItem(SAVE_TIME_KEY) || '';
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '12:00';
  } catch {
    return '12:00';
  }
}

export function saveAutoSaveTime(value: string) {
  localStorage.setItem(SAVE_TIME_KEY, /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '12:00');
}

export function autoSaveStamp(date: string, time: string): string {
  return `${date} ${time}`;
}

export function loadAutoSaveStamp(): string {
  try {
    return localStorage.getItem(SAVE_STAMP_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAutoSaveStamp(stamp: string) {
  localStorage.setItem(SAVE_STAMP_KEY, stamp);
}

const SCHEDULE_KEY = 'broteam.workSchedule';

/** ISO weekdays: 1 Monday … 7 Sunday. */
export type WorkSchedule = {
  enabled: boolean;
  days: number[];
  start: string;
  end: string;
};

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  enabled: false,
  days: [1, 2, 3, 4, 5],
  start: '10:00',
  end: '19:00',
};

function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function loadWorkSchedule(): WorkSchedule {
  try {
    const raw = JSON.parse(localStorage.getItem(SCHEDULE_KEY) || '') as Partial<WorkSchedule>;
    const days = Array.isArray(raw.days)
      ? [...new Set(raw.days.map(Number).filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b)
      : [...DEFAULT_WORK_SCHEDULE.days];
    return {
      enabled: Boolean(raw.enabled),
      days,
      start: parseClock(String(raw.start)) != null ? String(raw.start) : DEFAULT_WORK_SCHEDULE.start,
      end: parseClock(String(raw.end)) != null ? String(raw.end) : DEFAULT_WORK_SCHEDULE.end,
    };
  } catch {
    return { ...DEFAULT_WORK_SCHEDULE, days: [...DEFAULT_WORK_SCHEDULE.days] };
  }
}

export function saveWorkSchedule(schedule: WorkSchedule) {
  const start = parseClock(schedule.start) != null ? schedule.start : DEFAULT_WORK_SCHEDULE.start;
  const end = parseClock(schedule.end) != null ? schedule.end : DEFAULT_WORK_SCHEDULE.end;
  const days = [...new Set(schedule.days.filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b);
  localStorage.setItem(
    SCHEDULE_KEY,
    JSON.stringify({ enabled: schedule.enabled, days, start, end }),
  );
}

function weekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function clockMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function withinSchedule(date: Date, schedule: WorkSchedule, start: number, end: number): boolean {
  if (!schedule.days.includes(weekday(date))) return false;
  const clock = clockMinutes(date);
  return clock >= start && clock < end;
}

function nextWindowStart(from: Date, schedule: WorkSchedule, startMin: number): Date {
  for (let add = 0; add < 8; add += 1) {
    const day = new Date(from);
    day.setDate(from.getDate() + add);
    day.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    if (!schedule.days.includes(weekday(day))) continue;
    if (day.getTime() <= from.getTime()) continue;
    return day;
  }
  return new Date(from.getTime() + 24 * 60 * 60_000);
}

/** Milliseconds until the next refresh. Null means the schedule never opens. */
export function refreshDelayMs(
  now: Date,
  minutes: number,
  schedule: WorkSchedule,
  anchorMs: number | null,
): number | null {
  const interval = Math.min(240, Math.max(1, Math.round(minutes))) * 60_000;
  const fromAnchor =
    anchorMs == null || Number.isNaN(anchorMs) ? interval : Math.max(1000, interval - (now.getTime() - anchorMs));
  if (!schedule.enabled) return fromAnchor;
  const start = parseClock(schedule.start);
  const end = parseClock(schedule.end);
  if (start == null || end == null || end <= start || schedule.days.length === 0) return null;
  if (!withinSchedule(now, schedule, start, end)) {
    return Math.max(1000, nextWindowStart(now, schedule, start).getTime() - now.getTime());
  }
  const due = new Date(now.getTime() + fromAnchor);
  if (withinSchedule(due, schedule, start, end)) return fromAnchor;
  return Math.max(1000, nextWindowStart(due, schedule, start).getTime() - now.getTime());
}
