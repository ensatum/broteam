import type { TrackerIssue } from './types';

export type IssueChangeNote = { text: string; at: string };

function actorName(issue: TrackerIssue): string {
  return (issue.updatedByDisplay || '').trim();
}

function withActor(text: string, actor: string): string {
  if (!actor || text.includes(actor)) return text;
  return `${text} · ${actor}`;
}

function stamp(at: number, fallback: string): string {
  if (at > 0) return new Date(at).toISOString();
  return fallback;
}

/** Latest difference between two fetches. A newer event of the same kind replaces the previous note. */
export function describeIssueChange(
  prev: TrackerIssue | undefined,
  next: TrackerIssue,
): IssueChangeNote | null {
  const fallback = next.updatedAt || new Date().toISOString();
  const actor = actorName(next);
  if (!prev) return { text: withActor('Новая задача', actor), at: fallback };
  const bits: Array<{ at: number; text: string }> = [];
  const updatedAt = Date.parse(next.updatedAt || '') || 0;
  if (prev.statusKey !== next.statusKey) {
    bits.push({
      at: Date.parse(next.statusStartTime || next.updatedAt || '') || updatedAt,
      text: withActor(
        `Статус ${prev.statusDisplay || prev.statusKey || '—'} → ${next.statusDisplay || next.statusKey || '—'}`,
        actor,
      ),
    });
  }
  if (
    (prev.lastCommentUpdatedAt || '') !== (next.lastCommentUpdatedAt || '') &&
    next.lastCommentUpdatedAt
  ) {
    bits.push({
      at: Date.parse(next.lastCommentUpdatedAt) || updatedAt,
      text: withActor('Новый комментарий', actor),
    });
  }
  if ((prev.summary || '') !== (next.summary || '')) {
    bits.push({ at: updatedAt, text: withActor('Изменилось название', actor) });
  }
  if (
    personChanged(
      [prev.assigneeUid, prev.assigneeLogin],
      [next.assigneeUid, next.assigneeLogin],
      prev.assigneeDisplay,
      next.assigneeDisplay,
    )
  ) {
    bits.push({
      at: updatedAt,
      text: withActor(`Исполнитель ${prev.assigneeDisplay || '—'} → ${next.assigneeDisplay || '—'}`, actor),
    });
  }
  if (
    personChanged(
      [prev.reviewerUid, ...(prev.reviewerMatchKeys || [])],
      [next.reviewerUid, ...(next.reviewerMatchKeys || [])],
      prev.reviewerDisplay,
      next.reviewerDisplay,
    )
  ) {
    bits.push({
      at: updatedAt,
      text: withActor(`Ревьюер ${prev.reviewerDisplay || '—'} → ${next.reviewerDisplay || '—'}`, actor),
    });
  }
  if (
    personChanged(
      [prev.qaUid, ...(prev.qaMatchKeys || [])],
      [next.qaUid, ...(next.qaMatchKeys || [])],
      prev.qaDisplay,
      next.qaDisplay,
    )
  ) {
    bits.push({
      at: updatedAt,
      text: withActor(`Тестировщик ${prev.qaDisplay || '—'} → ${next.qaDisplay || '—'}`, actor),
    });
  }
  if ((prev.sprintId ?? null) !== (next.sprintId ?? null)) {
    bits.push({
      at: updatedAt,
      text: withActor(`Спринт ${prev.sprintName || '—'} → ${next.sprintName || '—'}`, actor),
    });
  }
  if ((prev.deadline || '') !== (next.deadline || '')) {
    bits.push({
      at: updatedAt,
      text: withActor(`Дедлайн ${prev.deadline || '—'} → ${next.deadline || '—'}`, actor),
    });
  }
  if (!bits.length) {
    if ((prev.updatedAt || '') !== (next.updatedAt || '') && next.updatedAt) {
      return { text: withActor('Задача обновлена', actor), at: fallback };
    }
    return null;
  }
  bits.sort((a, b) => b.at - a.at);
  const latest = bits[0];
  return { text: latest.text, at: stamp(latest.at, fallback) };
}

function personIds(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = (value || '').trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

/** A local alias rewrite changes the display and keeps the Tracker id. That is not a Tracker change. */
function personChanged(
  prevIds: Array<string | null | undefined>,
  nextIds: Array<string | null | undefined>,
  prevDisplay: string | null | undefined,
  nextDisplay: string | null | undefined,
): boolean {
  const prev = personIds(prevIds);
  const next = personIds(nextIds);
  if (prev.length || next.length) {
    if (!prev.length || !next.length) return true;
    return !prev.some((id) => next.includes(id));
  }
  return (prevDisplay || '') !== (nextDisplay || '');
}

/** Last Tracker fact already stored on the issue. Shown even when it predates the first sync. */
export function trackerLastChange(issue: TrackerIssue): IssueChangeNote | null {
  const events: Array<{ at: number; text: string }> = [];
  const statusAt = Date.parse(issue.statusStartTime || '');
  if (issue.statusStartTime && Number.isFinite(statusAt)) {
    events.push({ at: statusAt, text: `Статус ${issue.statusDisplay || issue.statusKey || '—'}` });
  }
  const commentAt = Date.parse(issue.lastCommentUpdatedAt || '');
  if (issue.lastCommentUpdatedAt && Number.isFinite(commentAt)) {
    events.push({ at: commentAt, text: 'Комментарий' });
  }
  const updatedAt = Date.parse(issue.updatedAt || '');
  if (issue.updatedAt && Number.isFinite(updatedAt)) {
    events.push({ at: updatedAt, text: 'Обновление' });
  }
  if (!events.length) return null;
  events.sort((a, b) => b.at - a.at);
  const top = events[0];
  const specific = events.find((event) => event.text !== 'Обновление' && Math.abs(event.at - top.at) < 2000);
  const pick = specific || top;
  return { text: pick.text, at: new Date(pick.at).toISOString() };
}
