import { upsertIssueChanges } from './db';
import { describeIssueChange } from '../shared/issueChanges';
import type { BoardMatrix, TrackerIssue } from '../shared/types';

export function flattenMatrixIssues(matrix: BoardMatrix | null): TrackerIssue[] {
  if (!matrix) return [];
  const byKey = new Map<string, TrackerIssue>();
  for (const row of matrix.developers || []) {
    for (const issues of Object.values(row.issuesByColumn || {})) {
      for (const issue of issues || []) {
        if (issue?.key) byKey.set(issue.key, issue);
      }
    }
  }
  return [...byKey.values()];
}

/** Remember the latest unseen change. The first populated matrix is a baseline, not a flood of "new". */
export function syncIssueChanges(
  boardLocalId: number,
  previous: BoardMatrix | null,
  nextIssues: TrackerIssue[],
): void {
  const prevIssues = flattenMatrixIssues(previous);
  if (!prevIssues.length) return;
  const prevByKey = new Map(prevIssues.map((issue) => [issue.key, issue]));
  const now = new Date().toISOString();
  const writes: Array<{ issueKey: string; text: string; at: string }> = [];
  const seenNext = new Set<string>();
  for (const issue of nextIssues) {
    if (!issue.key || seenNext.has(issue.key)) continue;
    seenNext.add(issue.key);
    const change = describeIssueChange(prevByKey.get(issue.key), issue);
    if (!change) continue;
    writes.push({ issueKey: issue.key, text: change.text, at: change.at || issue.updatedAt || now });
  }
  upsertIssueChanges(boardLocalId, writes);
}
