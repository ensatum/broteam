import { deleteIssueChanges, dropAbsentIssueChanges, upsertIssueChanges } from './db';
import { bornSince, describeIssueChange } from '../shared/issueChanges';
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
  skipCommentKeys?: ReadonlySet<string>,
): void {
  const prevIssues = flattenMatrixIssues(previous);
  if (!prevIssues.length) return;
  const prevByKey = new Map(prevIssues.map((issue) => [issue.key, issue]));
  const now = new Date().toISOString();
  const writes: Array<{ issueKey: string; text: string; at: string }> = [];
  const drop: string[] = [];
  const seenNext = new Set<string>();
  for (const issue of nextIssues) {
    if (!issue.key || seenNext.has(issue.key)) continue;
    seenNext.add(issue.key);
    const prev = prevByKey.get(issue.key);
    if (!prev && !bornSince(issue.createdAt, previous?.fetchedAt)) {
      drop.push(issue.key);
      continue;
    }
    const change = describeIssueChange(prev, issue);
    if (!change) continue;
    if (change.commentOnly && skipCommentKeys?.has(issue.key)) continue;
    writes.push({ issueKey: issue.key, text: change.text, at: change.at || issue.updatedAt || now });
  }
  deleteIssueChanges(boardLocalId, drop);
  upsertIssueChanges(boardLocalId, writes);
  dropAbsentIssueChanges(boardLocalId, seenNext);
}
