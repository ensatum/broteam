import type { TrackerIssue } from '@shared/types';

/** Develop / Review / QA lines under an issue in lists. */
export default function IssuePeopleLines({ issue }: { issue: TrackerIssue }) {
  const develop = issue.assigneeDisplay?.trim() || '—';
  const review = issue.reviewerDisplay?.trim() || '';
  const qa = issue.qaDisplay?.trim() || '';

  return (
    <div className="mt-0.5 space-y-0 text-[10px] leading-snug">
      <div className="text-slate-400">Develop: {develop}</div>
      <div className={review ? 'text-green-600' : 'text-red-600'}>
        Reviewer: {review || '—'}
      </div>
      <div className={qa ? 'text-green-600' : 'text-red-600'}>
        QA: {qa || '—'}
      </div>
      <div className="text-slate-400">Автор: {issue.authorDisplay?.trim() || '—'}</div>
    </div>
  );
}
