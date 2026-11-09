import type { Developer, SavedBoard, TrackerIssue } from './types';

export function textHit(query: string, parts: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => (part || '').toLowerCase().includes(needle));
}

export function issueSearchParts(
  issue: TrackerIssue,
  people: Developer[],
  boards: SavedBoard[],
): Array<string | null | undefined> {
  const keys = [
    issue.assigneeUid,
    issue.assigneeLogin,
    issue.reviewerUid,
    ...(issue.reviewerMatchKeys || []),
    issue.qaUid,
    ...(issue.qaMatchKeys || []),
  ].filter((value): value is string => Boolean(value && value.trim()));
  const shown = [issue.assigneeDisplay, issue.reviewerDisplay, issue.qaDisplay, issue.authorDisplay];
  const linked = people.filter((person) => {
    const ids = [person.login, person.uid, person.displayName].filter(Boolean);
    return ids.some((id) => keys.includes(String(id))) || shown.includes(person.displayName);
  });
  const onBoards = boards.filter((board) => (issue.boardIds || []).includes(board.trackerBoardId));
  return [
    issue.key,
    issue.summary,
    ...shown,
    issue.assigneeLogin,
    ...linked.flatMap((person) => [person.displayName, person.login]),
    ...onBoards.flatMap((board) => [board.name, board.alias]),
  ];
}

export function summarySearchParts(
  row: {
    key: string;
    summary: string;
    assignee?: string;
    reviewer?: string;
    qa?: string;
    author?: string;
    assignees?: string[];
    reviewers?: string[];
    qas?: string[];
    boardLabel?: string;
    boardLocalId?: number | null;
  },
  people: Developer[],
  boards: SavedBoard[],
): Array<string | null | undefined> {
  const names = [
    row.assignee,
    row.reviewer,
    row.qa,
    row.author,
    ...(row.assignees || []),
    ...(row.reviewers || []),
    ...(row.qas || []),
  ];
  const linked = people.filter(
    (person) => names.includes(person.displayName) || names.includes(person.login),
  );
  const board = boards.find((item) => item.id === row.boardLocalId);
  return [
    row.key,
    row.summary,
    ...names,
    row.boardLabel,
    board?.name,
    board?.alias,
    ...linked.flatMap((person) => [person.displayName, person.login]),
  ];
}
