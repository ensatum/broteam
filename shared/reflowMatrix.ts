import type { BoardColumnConfig, BoardMatrix, Developer, TrackerIssue } from './types';
import { OTHERS_ROW_ID, UNASSIGNED_ROW_ID } from './types';

export type ReflowView = {
  matrix: BoardMatrix;
  pendingDevIds: Set<number>;
  pendingStatusKeys: Set<string>;
};

function isUnassigned(issue: TrackerIssue): boolean {
  return !issue.assigneeDisplay?.trim() && !issue.assigneeLogin && !issue.assigneeUid;
}

function matchLogin(issue: TrackerIssue, people: Developer[]): string | null {
  const login = issue.assigneeLogin?.toLowerCase();
  const uid = issue.assigneeUid ? String(issue.assigneeUid) : '';
  for (const person of people) {
    if (login && person.login.toLowerCase() === login) return person.login;
    if (uid && String(person.uid) === uid) return person.login;
    if (login && String(person.uid) === issue.assigneeLogin) return person.login;
  }
  return null;
}

/** Rebuild table rows from the last fetch using the current participants and columns. */
export function reflowMatrix(
  matrix: BoardMatrix,
  participants: Developer[],
  columns: BoardColumnConfig[],
  boardLocalId: number | null,
  visibleIds?: Set<number> | null,
): ReflowView {
  const people = participants
    .filter((person) => {
      if (person.role === 'contact') return false;
      if (visibleIds) return visibleIds.has(person.id);
      return !person.hidden;
    })
    .map((person) => {
      const prev = matrix.developers.find((row) => row.developer.id === person.id);
      return prev ? { ...person, todos: undefined } : person;
    });
  const displayColumns = columns.filter(
    (column) => boardLocalId == null || column.boardLocalId === boardLocalId,
  );
  const foreignBoard =
    boardLocalId != null &&
    matrix.sourceBoardLocalId != null &&
    matrix.sourceBoardLocalId !== boardLocalId;
  const knownDevIds = new Set(
    matrix.developers.map((row) => row.developer.id).filter((id) => id > 0),
  );
  const knownStatuses = new Set(matrix.columns.map((column) => column.statusKey));
  const pendingDevIds = new Set(people.filter((person) => !knownDevIds.has(person.id)).map((p) => p.id));
  const pendingStatusKeys = new Set(
    displayColumns.filter((column) => !knownStatuses.has(column.statusKey)).map((column) => column.statusKey),
  );

  const seen = new Set<string>();
  const issues: TrackerIssue[] = [];
  if (!foreignBoard) {
    for (const row of matrix.developers) {
      for (const list of Object.values(row.issuesByColumn)) {
        for (const issue of list) {
          if (seen.has(issue.key)) continue;
          seen.add(issue.key);
          issues.push(issue);
        }
      }
    }
  }

  const byLogin = new Map<string, TrackerIssue[]>();
  for (const issue of issues) {
    if (pendingStatusKeys.has(issue.statusKey)) continue;
    if (!displayColumns.some((column) => column.statusKey === issue.statusKey)) continue;
    const login = isUnassigned(issue) ? '__unassigned__' : matchLogin(issue, people) || '__others__';
    if (!byLogin.has(login)) byLogin.set(login, []);
    byLogin.get(login)!.push(issue);
  }

  const rowPeople: Developer[] = [...people];
  if ((byLogin.get('__others__') || []).length) {
    rowPeople.push({
      id: OTHERS_ROW_ID,
      login: '__others__',
      displayName: 'Остальные',
      uid: '',
      color: 'muted',
      sortOrder: 10000,
      role: 'developer',
      onVacation: false,
      hidden: false,
    });
  }
  if ((byLogin.get('__unassigned__') || []).length) {
    rowPeople.push({
      id: UNASSIGNED_ROW_ID,
      login: '__unassigned__',
      displayName: 'Не назначено',
      uid: '',
      color: 'muted',
      sortOrder: 10001,
      role: 'developer',
      onVacation: false,
      hidden: false,
    });
  }

  const columnTotals: Record<string, number> = Object.fromEntries(
    displayColumns.map((column) => [column.statusKey, 0]),
  );
  let grandTotal = 0;
  const developers = rowPeople.map((developer) => {
    const prev = matrix.developers.find((row) => row.developer.id === developer.id);
    const bucket =
      developer.id === OTHERS_ROW_ID
        ? '__others__'
        : developer.id === UNASSIGNED_ROW_ID
          ? '__unassigned__'
          : developer.login;
    const mine = pendingDevIds.has(developer.id) ? [] : byLogin.get(bucket) || [];
    const counts: Record<string, number> = {};
    const issuesByColumn: Record<string, TrackerIssue[]> = {};
    for (const column of displayColumns) {
      if (pendingStatusKeys.has(column.statusKey) || pendingDevIds.has(developer.id)) {
        counts[column.statusKey] = 0;
        issuesByColumn[column.statusKey] = [];
        continue;
      }
      const list = mine.filter((issue) => issue.statusKey === column.statusKey);
      issuesByColumn[column.statusKey] = list;
      counts[column.statusKey] = list.length;
      columnTotals[column.statusKey] += list.length;
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    grandTotal += total;
    return {
      developer: { ...developer, onVacation: developer.onVacation },
      counts,
      total,
      note: prev?.note || '',
      todos: prev?.todos || [],
      issuesByColumn,
    };
  });

  return {
    matrix: {
      ...matrix,
      columns: displayColumns,
      developers,
      columnTotals,
      grandTotal,
    },
    pendingDevIds,
    pendingStatusKeys,
  };
}
