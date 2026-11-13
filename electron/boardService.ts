import {
  getActiveBoardLocalId,
  getBoardConfig,
  getConnection,
  listSavedBoards,
  getDeveloperNotes,
  getDeveloperTodosByDeveloper,
  getIssueNotes,
  getIssueNoteUpdatedAt,
  getIssueBookmarks,
  getIssueBookmarkCreatedAt,
  ensureAssigneeDevelopers,
  addBoardColumns,
  listColumns,
  listDevelopers,
  saveLastMatrix,
  getLastMatrix,
} from './db';
import { flattenMatrixIssues, syncIssueChanges } from './issueChanges';
import { describeIssueChange } from '../shared/issueChanges';
import { TrackerClient, buildIssuesQuery } from './tracker';
import type { BoardMatrix, Developer, TrackerIssue, TrackerSprint } from '../shared/types';
import { OTHERS_ROW_ID, UNASSIGNED_ROW_ID } from '../shared/types';
import { freshBoardColumns } from '../shared/boardColumns';
import { issueIsDone } from '../shared/columnMeta';
import { sessionLog } from './sessionLog';
import {
  applyDeveloperDisplayNames,
  remapMatrixPersonNames,
  resolvePersonDisplayName,
} from '../shared/personDisplay';

export { resolvePersonDisplayName, applyDeveloperDisplayNames, remapMatrixPersonNames };

function emptyMeta() {
  return {
    sprintTitle: 'Спринт не выбран',
    sprintStartDate: null as string | null,
    sprintEndDate: null as string | null,
    sprintCounts: [] as Array<{
      id: number;
      name: string;
      count: number;
      startDate?: string | null;
      endDate?: string | null;
    }>,
    reviewerCounts: [] as Array<{ name: string; count: number }>,
    qaCounts: [] as Array<{ name: string; count: number }>,
    sprintStatsById: {} as Record<number, { total: number; unassigned: number; done: number }>,
  };
}

function isDoneIssue(issue: TrackerIssue): boolean {
  return issueIsDone(issue);
}

function isUnassignedIssue(issue: TrackerIssue): boolean {
  return !issue.assigneeDisplay?.trim() && !issue.assigneeLogin && !issue.assigneeUid;
}

function emptyBucketRow(login: string, columns: BoardMatrix['columns']): BoardMatrix['developers'][number] {
  const unassigned = login === '__unassigned__';
  return {
    developer: {
      id: unassigned ? UNASSIGNED_ROW_ID : OTHERS_ROW_ID,
      login: unassigned ? '__unassigned__' : '__others__',
      displayName: unassigned ? 'Не назначено' : 'Остальные',
      uid: '',
      color: 'muted',
      sortOrder: unassigned ? 10001 : 10000,
      role: 'developer',
      onVacation: false,
      hidden: false,
      summary: false,
    },
    counts: Object.fromEntries(columns.map((column) => [column.statusKey, 0])),
    total: 0,
    note: '',
    todos: [],
    issuesByColumn: Object.fromEntries(columns.map((column) => [column.statusKey, [] as TrackerIssue[]])),
  };
}

function computeSprintStatsById(
  issues: TrackerIssue[],
): Record<number, { total: number; unassigned: number; done: number }> {
  const bySprint = new Map<number, TrackerIssue[]>();
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.sprintId == null) continue;
    const dedupe = `${issue.sprintId}:${issue.key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (!bySprint.has(issue.sprintId)) bySprint.set(issue.sprintId, []);
    bySprint.get(issue.sprintId)!.push(issue);
  }
  const out: Record<number, { total: number; unassigned: number; done: number }> = {};
  for (const [id, list] of bySprint) {
    out[id] = {
      total: list.length,
      unassigned: list.filter(isUnassignedIssue).length,
      done: list.filter((i) => isDoneIssue(i)).length,
    };
  }
  return out;
}

async function loadBoardIssues(
  client: TrackerClient,
  params: {
    boardId: number | null;
    membership: 'sprint' | 'board';
    ignoreSprint: boolean;
    openSprintIds: number[];
    foreignOpenIds: number[];
  },
): Promise<TrackerIssue[]> {
  if (params.membership === 'board' || params.ignoreSprint) {
    const query = buildIssuesQuery({
      boardId: params.boardId,
      queueKey: null,
      sprintIds: [],
      logins: [],
      membership: params.membership,
      unresolvedOnly: false,
    });
    const issues = await client.findIssues(query);
    if (params.membership === 'board' || params.boardId == null) return issues;
    const merged = new Map(issues.map((issue) => [issue.key, issue]));
    await mergeOpenIssuesWithoutSprint(client, params.boardId, merged);
    return [...merged.values()];
  }
  const merged = new Map<string, TrackerIssue>();
  if (params.openSprintIds.length && params.boardId != null) {
    const query = buildIssuesQuery({
      boardId: params.boardId,
      queueKey: null,
      sprintIds: params.openSprintIds,
      logins: [],
      membership: 'sprint',
      unresolvedOnly: false,
    });
    for (const issue of await client.findIssues(query)) merged.set(issue.key, issue);
  }
  if (params.foreignOpenIds.length && params.boardId != null) {
    const query = buildIssuesQuery({
      boardId: params.boardId,
      queueKey: null,
      sprintIds: params.foreignOpenIds,
      logins: [],
      membership: 'board',
      unresolvedOnly: false,
    });
    for (const issue of await client.findIssues(query)) {
      if (!merged.has(issue.key)) merged.set(issue.key, issue);
    }
  }
  if (params.boardId != null) await mergeOpenIssuesWithoutSprint(client, params.boardId, merged);
  return [...merged.values()];
}

async function mergeOpenIssuesWithoutSprint(
  client: TrackerClient,
  boardId: number,
  merged: Map<string, TrackerIssue>,
): Promise<void> {
  const query = buildIssuesQuery({
    boardId,
    queueKey: null,
    sprintIds: [],
    logins: [],
    membership: 'board',
    unresolvedOnly: false,
    emptySprint: true,
  });
  for (const issue of await client.findIssues(query)) {
    if (issue.sprintId != null || merged.has(issue.key)) continue;
    if (isDoneIssue(issue) || issue.statusKey === 'closed') continue;
    merged.set(issue.key, issue);
  }
}

function issueQueueKey(issueKey: string): string {
  const dash = issueKey.lastIndexOf('-');
  return (dash > 0 ? issueKey.slice(0, dash) : issueKey).trim().toLowerCase();
}

/** Issue keys are numbered inside a queue. That queue is the board the task belongs to. */
function belongsToBoardQueue(issueKey: string, queueKey: string): boolean {
  const queue = queueKey.trim().toLowerCase();
  if (!queue) return true;
  return issueQueueKey(issueKey) === queue;
}

function boardHasNoSprints(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('не может быть спринтов');
}

function isOpenSprint(s: TrackerSprint): boolean {
  if (s.archived) return false;
  const status = (s.status || '').toLowerCase();
  return status === 'in_progress' || status === 'draft';
}

function buildMeta(
  allIssues: TrackerIssue[],
  sprintById: Map<number, TrackerSprint>,
): Pick<
  BoardMatrix,
  'sprintTitle' | 'sprintStartDate' | 'sprintEndDate' | 'sprintCounts' | 'reviewerCounts' | 'qaCounts'
> {
  const sprintMap = new Map<
    number,
    {
      id: number;
      name: string;
      count: number;
      startDate?: string | null;
      endDate?: string | null;
    }
  >();
  const reviewerMap = new Map<string, number>();
  const qaMap = new Map<string, number>();

  for (const issue of allIssues) {
    if (issue.sprintId != null) {
      const meta = sprintById.get(issue.sprintId);
      if (meta && !isOpenSprint(meta)) continue;
      const prev = sprintMap.get(issue.sprintId);
      sprintMap.set(issue.sprintId, {
        id: issue.sprintId,
        name: issue.sprintName || meta?.name || `Sprint ${issue.sprintId}`,
        count: (prev?.count || 0) + 1,
        startDate: meta?.startDate ?? prev?.startDate ?? null,
        endDate: meta?.endDate ?? prev?.endDate ?? null,
      });
    }
    if (issue.reviewerDisplay?.trim()) {
      const name = issue.reviewerDisplay.trim();
      reviewerMap.set(name, (reviewerMap.get(name) || 0) + 1);
    }
    if (issue.qaDisplay?.trim()) {
      const name = issue.qaDisplay.trim();
      qaMap.set(name, (qaMap.get(name) || 0) + 1);
    }
  }

  const sprintCounts = [...sprintMap.values()].sort((a, b) => b.count - a.count);

  const reviewerCounts = [...reviewerMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));

  const qaCounts = [...qaMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));

  // Prefer in-progress open sprint present on the board, else freshest by id
  const openOnBoard = [...sprintMap.values()]
    .map((s) => ({ ...s, meta: sprintById.get(s.id) }))
    .filter((s) => s.meta && isOpenSprint(s.meta));
  const inProgress = openOnBoard.find((s) => (s.meta?.status || '').toLowerCase() === 'in_progress');
  const freshest = [...sprintMap.values()].sort((a, b) => b.id - a.id)[0];
  const preferred = inProgress || openOnBoard.sort((a, b) => b.id - a.id)[0] || freshest;

  return {
    sprintTitle: preferred?.name || 'Спринт не выбран',
    sprintStartDate: preferred?.startDate || null,
    sprintEndDate: preferred?.endDate || null,
    sprintCounts,
    reviewerCounts,
    qaCounts,
  };
}

async function reactionOnlyCommentKeys(
  client: TrackerClient,
  previous: BoardMatrix | null,
  nextIssues: TrackerIssue[],
): Promise<Set<string>> {
  const skip = new Set<string>();
  const prev = new Map(flattenMatrixIssues(previous).map((issue) => [issue.key, issue]));
  const suspects = nextIssues.filter((issue) => describeIssueChange(prev.get(issue.key), issue)?.commentOnly);
  await Promise.all(
    suspects.map(async (issue) => {
      try {
        const story = await client.getIssueStory(issue.key);
        const prevAt = Date.parse(prev.get(issue.key)?.lastCommentUpdatedAt || '') || 0;
        const realAt = Date.parse(story.commentAt || '') || 0;
        if (!story.commentText || realAt <= prevAt) skip.add(issue.key);
      } catch {
        // A failed lookup keeps the update visible.
      }
    }),
  );
  return skip;
}

export async function buildLiveMatrix(options?: {
  /** Snapshot: ignore the open-sprint filter and take every issue of the board's sprints. */
  ignoreSprintFilter?: boolean;
}): Promise<BoardMatrix> {
  const connection = getConnection();
  if (!connection.token) {
    throw new Error('Не задан токен Tracker. Откройте настройки подключения.');
  }

  const activeBoardId = getActiveBoardLocalId();
  let columns = listColumns().filter(
    (c) => activeBoardId == null || c.boardLocalId === activeBoardId,
  );
  const board = getBoardConfig();
  const issueNotes = getIssueNotes();
  const issueNoteUpdatedAt = getIssueNoteUpdatedAt();
  const issueBookmarks = getIssueBookmarks();
  const issueBookmarkCreatedAt = getIssueBookmarkCreatedAt();
  const developerNotes = getDeveloperNotes();
  const todosByDev = getDeveloperTodosByDeveloper();
  const metaEmpty = emptyMeta();
  const ignoreSprint = Boolean(options?.ignoreSprintFilter);

  const client = new TrackerClient(connection);
  if (activeBoardId != null && board.boardId) {
    try {
      const remote = await client.getBoardColumns(board.boardId);
      const known = new Set(columns.map((column) => column.statusKey));
      let order = columns.reduce((max, column) => Math.max(max, column.sortOrder), -1) + 1;
      const additions = freshBoardColumns(remote, activeBoardId)
        .filter((column) => !known.has(column.statusKey))
        .map((column) => ({ ...column, sortOrder: order++ }));
      if (additions.length) {
        addBoardColumns(additions);
        columns = listColumns().filter((column) => column.boardLocalId === activeBoardId);
      }
    } catch (error) {
      sessionLog('error', 'board columns', { boardId: board.boardId, error });
    }
  }
  const sprintById = new Map<number, TrackerSprint>();
  let openSprintIds: number[] = [];
  const foreignOpenIds: number[] = [];
  let membership: 'sprint' | 'board' = 'sprint';
  if (board.boardId) {
    try {
      const sprints = await client.getBoardSprints(board.boardId);
      for (const s of sprints) {
        sprintById.set(s.id, s);
        if (isOpenSprint(s)) openSprintIds.push(s.id);
      }
    } catch (error) {
      if (!boardHasNoSprints(error)) throw error;
      membership = 'board';
    }
  }
  if (membership === 'sprint' && board.boardId) {
    for (const other of listSavedBoards()) {
      if (!other.enabled || !other.trackerBoardId || other.trackerBoardId === board.boardId) continue;
      try {
        const sprints = await client.getBoardSprints(other.trackerBoardId);
        for (const s of sprints) {
          if (sprintById.has(s.id)) continue;
          sprintById.set(s.id, s);
          if (isOpenSprint(s)) foreignOpenIds.push(s.id);
        }
      } catch (error) {
        if (!boardHasNoSprints(error)) throw error;
      }
    }
  }

  // A task stays on the matrix when it sits in an open sprint of this board,
  // or on this board in an open sprint of another saved board,
  // or on this board with no sprint and a status that is not done.
  // No-sprint tasks stay on the default view until «Без спринта» is excluded.
  // It is drawn only on the board of its own queue: status columns differ
  // between boards, so a task listed on several boards must not be copied.
  // Statuses that are not columns of this board are dropped below.
  // A failed sprint list must not fall through to every sprint of the board.
  const issues = await loadBoardIssues(client, {
    boardId: board.boardId,
    membership,
    ignoreSprint,
    openSprintIds,
    foreignOpenIds,
  });

  const statusToColumn = new Map(columns.map((c) => [c.statusKey, c]));
  const requiredBoardId = board.boardId;
  const boardIssues: TrackerIssue[] = [];
  for (const issue of issues) {
    if (
      requiredBoardId != null &&
      (issue.boardIds?.length ?? 0) > 0 &&
      !issue.boardIds!.includes(requiredBoardId)
    ) {
      continue;
    }
    if (!belongsToBoardQueue(issue.key, board.queueKey)) continue;
    if (issue.sprintId != null) {
      const sprint = sprintById.get(issue.sprintId);
      if (sprint && !isOpenSprint(sprint)) continue;
    }
    if (!statusToColumn.has(issue.statusKey)) continue;
    boardIssues.push(issue);
  }
  ensureAssigneeDevelopers(
    boardIssues
      .filter((issue) => !isUnassignedIssue(issue))
      .map((issue) => ({
        login: issue.assigneeLogin || '',
        displayName: issue.assigneeDisplay || issue.assigneeLogin || '',
        uid: issue.assigneeUid ? String(issue.assigneeUid) : '',
      })),
  );
  const developers = listDevelopers().filter((d) => d.role !== 'contact' && !d.hidden);
  const byDev = new Map<string, TrackerIssue[]>();
  const loginByLower = new Map(developers.map((d) => [d.login.toLowerCase(), d.login]));
  const loginByUid = new Map(developers.map((d) => [String(d.uid), d.login]));
  const visibleIssues: TrackerIssue[] = [];
  for (const issue of boardIssues) {
    const matched =
      (issue.assigneeLogin && loginByLower.get(issue.assigneeLogin.toLowerCase())) ||
      (issue.assigneeUid && loginByUid.get(issue.assigneeUid)) ||
      (issue.assigneeLogin && loginByUid.get(issue.assigneeLogin)) ||
      null;
    const unassigned = isUnassignedIssue(issue);
    const login = unassigned ? '__unassigned__' : matched || '__others__';
    const resolved = applyDeveloperDisplayNames(issue, developers);
    if (!byDev.has(login)) byDev.set(login, []);
    byDev.get(login)!.push(resolved);
    visibleIssues.push(resolved);
  }

  const columnTotals: Record<string, number> = Object.fromEntries(
    columns.map((c) => [c.statusKey, 0]),
  );
  let grandTotal = 0;

  const rowDevelopers: Developer[] = [...developers];
  if ((byDev.get('__others__') || []).length) {
    rowDevelopers.push({
      id: OTHERS_ROW_ID,
      login: '__others__',
      displayName: 'Остальные',
      uid: '',
      color: 'muted',
      sortOrder: 10000,
      role: 'developer',
      onVacation: false,
      hidden: false,
      summary: false,
    });
  }
  if ((byDev.get('__unassigned__') || []).length) {
    rowDevelopers.push({
      id: UNASSIGNED_ROW_ID,
      login: '__unassigned__',
      displayName: 'Не назначено',
      uid: '',
      color: 'muted',
      sortOrder: 10001,
      role: 'developer',
      onVacation: false,
      hidden: false,
      summary: false,
    });
  }

  const rows = rowDevelopers.map((developer) => {
    const bucket =
      developer.id === OTHERS_ROW_ID
        ? '__others__'
        : developer.id === UNASSIGNED_ROW_ID
          ? '__unassigned__'
          : developer.login;
    const devIssues = byDev.get(bucket) || [];
    const counts: Record<string, number> = Object.fromEntries(
      columns.map((c) => [c.statusKey, 0]),
    );
    const issuesByColumn: Record<string, TrackerIssue[]> = Object.fromEntries(
      columns.map((c) => [c.statusKey, [] as TrackerIssue[]]),
    );

    for (const issue of devIssues) {
      counts[issue.statusKey] += 1;
      issuesByColumn[issue.statusKey].push(issue);
      columnTotals[issue.statusKey] += 1;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    grandTotal += total;

    return {
      developer,
      counts,
      total,
      note: developerNotes[developer.id] || '',
      todos: todosByDev[developer.id] || [],
      issuesByColumn,
    };
  });

  const matrix: BoardMatrix = {
    columns,
    developers: rows,
    columnTotals,
    grandTotal,
    issueNotes: getIssueNotes(),
    issueNoteUpdatedAt: getIssueNoteUpdatedAt(),
    issueBookmarks: getIssueBookmarks(),
    issueBookmarkCreatedAt: getIssueBookmarkCreatedAt(),
    fetchedAt: new Date().toISOString(),
    sourceBoardLocalId: activeBoardId,
    sprintScoped: membership === 'sprint',
    ...buildMeta(visibleIssues, sprintById),
    sprintStatsById: computeSprintStatsById(visibleIssues),
  };
  if (activeBoardId != null) {
    const previous = getLastMatrix<BoardMatrix>(activeBoardId);
    const skipComments = await reactionOnlyCommentKeys(client, previous, visibleIssues);
    syncIssueChanges(activeBoardId, previous, visibleIssues, skipComments);
  }
  const remapped = remapMatrixPersonNames(matrix, developers);
  if (!ignoreSprint) saveLastMatrix(remapped);
  return remapped;
}

/**
 * Replace one issue in an existing matrix using a fresh Tracker payload.
 * Does not call findIssues — only reassigns the row/column and recounts.
 */
export function patchIssueInMatrix(matrix: BoardMatrix, issue: TrackerIssue): BoardMatrix {
  const columns = matrix.columns;
  const statusToColumn = new Map(columns.map((c) => [c.statusKey, c]));
  const namedDevelopers = matrix.developers.map((row) => row.developer).filter((person) => person.id > 0);
  const loginByLower = new Map(namedDevelopers.map((person) => [person.login.toLowerCase(), person.login]));
  const loginByUid = new Map(
    namedDevelopers.filter((person) => person.uid).map((person) => [String(person.uid), person.login]),
  );

  const resolvedIssue = applyDeveloperDisplayNames(issue, namedDevelopers);
  const matched =
    (resolvedIssue.assigneeLogin && loginByLower.get(resolvedIssue.assigneeLogin.toLowerCase())) ||
    (resolvedIssue.assigneeUid && loginByUid.get(resolvedIssue.assigneeUid)) ||
    (resolvedIssue.assigneeLogin && loginByUid.get(resolvedIssue.assigneeLogin)) ||
    null;
  const targetLogin = isUnassignedIssue(resolvedIssue) ? '__unassigned__' : matched || '__others__';
  const boardConfig = getBoardConfig();
  const requiredBoardId = boardConfig.boardId;
  const onConfiguredBoard =
    requiredBoardId == null ||
    !(resolvedIssue.boardIds?.length) ||
    resolvedIssue.boardIds.includes(requiredBoardId);
  const onHomeQueue = belongsToBoardQueue(issue.key, boardConfig.queueKey);
  const wasPresent = matrix.developers.some((row) =>
    Object.values(row.issuesByColumn).some((items) => items.some((item) => item.key === issue.key)),
  );
  const placeOnBoard =
    statusToColumn.has(resolvedIssue.statusKey) && onHomeQueue && (onConfiguredBoard || wasPresent);

  const prevSprintDates = new Map(
    matrix.sprintCounts.map((s) => [
      s.id,
      { startDate: s.startDate ?? null, endDate: s.endDate ?? null, name: s.name },
    ]),
  );

  const visibleIssues: TrackerIssue[] = [];
  const columnTotals: Record<string, number> = Object.fromEntries(
    columns.map((c) => [c.statusKey, 0]),
  );
  let grandTotal = 0;

  const rowSource = matrix.developers.some((row) => row.developer.login === targetLogin)
    ? matrix.developers
    : [...matrix.developers, emptyBucketRow(targetLogin, columns)];

  const rows = rowSource.map((row) => {
    const counts: Record<string, number> = Object.fromEntries(
      columns.map((c) => [c.statusKey, 0]),
    );
    const issuesByColumn: Record<string, TrackerIssue[]> = Object.fromEntries(
      columns.map((c) => [c.statusKey, [] as TrackerIssue[]]),
    );

    for (const col of columns) {
      for (const existing of row.issuesByColumn[col.statusKey] || []) {
        if (existing.key === issue.key) continue;
        issuesByColumn[col.statusKey].push(existing);
        counts[col.statusKey] += 1;
        columnTotals[col.statusKey] += 1;
        visibleIssues.push(existing);
      }
    }

    if (placeOnBoard && row.developer.login === targetLogin) {
      issuesByColumn[resolvedIssue.statusKey].push(resolvedIssue);
      counts[resolvedIssue.statusKey] += 1;
      columnTotals[resolvedIssue.statusKey] += 1;
      visibleIssues.push(resolvedIssue);
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    grandTotal += total;

    return {
      ...row,
      counts,
      total,
      issuesByColumn,
    };
  });

  const meta = buildMetaFromIssues(visibleIssues, prevSprintDates, {
    sprintTitle: matrix.sprintTitle,
    sprintStartDate: matrix.sprintStartDate,
    sprintEndDate: matrix.sprintEndDate,
  });

  return {
    ...matrix,
    developers: rows,
    columnTotals,
    grandTotal,
    issueNotes: getIssueNotes(),
    issueNoteUpdatedAt: getIssueNoteUpdatedAt(),
    issueBookmarks: getIssueBookmarks(),
    issueBookmarkCreatedAt: getIssueBookmarkCreatedAt(),
    fetchedAt: new Date().toISOString(),
    ...meta,
  };
}

function buildMetaFromIssues(
  allIssues: TrackerIssue[],
  prevSprintDates: Map<
    number,
    { startDate: string | null; endDate: string | null; name: string }
  >,
  fallback: {
    sprintTitle: string;
    sprintStartDate: string | null;
    sprintEndDate: string | null;
  },
): Pick<
  BoardMatrix,
  'sprintTitle' | 'sprintStartDate' | 'sprintEndDate' | 'sprintCounts' | 'reviewerCounts' | 'qaCounts'
> {
  const sprintMap = new Map<
    number,
    {
      id: number;
      name: string;
      count: number;
      startDate?: string | null;
      endDate?: string | null;
    }
  >();
  const reviewerMap = new Map<string, number>();
  const qaMap = new Map<string, number>();

  for (const issue of allIssues) {
    if (issue.sprintId != null) {
      const prev = sprintMap.get(issue.sprintId);
      const dates = prevSprintDates.get(issue.sprintId);
      sprintMap.set(issue.sprintId, {
        id: issue.sprintId,
        name: issue.sprintName || dates?.name || `Sprint ${issue.sprintId}`,
        count: (prev?.count || 0) + 1,
        startDate: dates?.startDate ?? prev?.startDate ?? null,
        endDate: dates?.endDate ?? prev?.endDate ?? null,
      });
    }
    if (issue.reviewerDisplay?.trim()) {
      const name = issue.reviewerDisplay.trim();
      reviewerMap.set(name, (reviewerMap.get(name) || 0) + 1);
    }
    if (issue.qaDisplay?.trim()) {
      const name = issue.qaDisplay.trim();
      qaMap.set(name, (qaMap.get(name) || 0) + 1);
    }
  }

  const sprintCounts = [...sprintMap.values()].sort((a, b) => b.count - a.count);
  const preferred = [...sprintCounts].sort((a, b) => b.id - a.id)[0];

  return {
    sprintTitle: preferred?.name || fallback.sprintTitle || 'Спринт не выбран',
    sprintStartDate: preferred?.startDate ?? fallback.sprintStartDate,
    sprintEndDate: preferred?.endDate ?? fallback.sprintEndDate,
    sprintCounts,
    reviewerCounts: [...reviewerMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
    qaCounts: [...qaMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru')),
  };
}
