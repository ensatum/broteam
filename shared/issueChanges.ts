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
    (prev.assigneeDisplay || '') !== (next.assigneeDisplay || '') ||
    (prev.assigneeUid || '') !== (next.assigneeUid || '') ||
    (prev.assigneeLogin || '') !== (next.assigneeLogin || '')
  ) {
    bits.push({
      at: updatedAt,
      text: withActor(`Исполнитель ${prev.assigneeDisplay || '—'} → ${next.assigneeDisplay || '—'}`, actor),
    });
  }
  if ((prev.reviewerDisplay || '') !== (next.reviewerDisplay || '')) {
    bits.push({
      at: updatedAt,
      text: withActor(`Ревьюер ${prev.reviewerDisplay || '—'} → ${next.reviewerDisplay || '—'}`, actor),
    });
  }
  if ((prev.qaDisplay || '') !== (next.qaDisplay || '')) {
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
