import type { Developer } from '../shared/types';
import type {
  SummaryBoardRef,
  SummaryBuildRequest,
  SummaryColumnTime,
  SummaryPeriod,
  SummaryReport,
  SummaryRow,
  SummaryShuffle,
  SummarySlice,
} from '../shared/summary';
import { TrackerClient, buildIssuesQuery, isReactionComment, type TrackerChangelogEvent, type TrackerComment } from './tracker';
import { trackerActivity } from './trackerActivity';
import {
  clearSummaryReports,
  getConnection,
  getSummaryCache,
  getSummarySource,
  listDevelopers,
  listSummarySourceBounds,
  saveSummaryCache,
  saveSummarySource,
  type StoredSummaryCache,
} from './db';
import { resolvePersonDisplayName } from '../shared/personDisplay';
import { isTrackerStopped, pauseableWait } from './trackerGate';

const TESTING_KEYS = new Set(['testing', 'readyForTest', 'testirovanieNaDev']);
/** Status chronology plus the people who hold a task during each status. */
const CHRONOLOGY_FIELDS = ['status', 'assignee', 'qaEngineer', 'kodRevu'] as const;

export async function buildSummaryReport(
  request: SummaryBuildRequest,
  onProgress: (progress: { row: SummaryRow | null; index: number; total: number }) => void,
  stillCurrent: () => boolean = () => true,
): Promise<SummaryReport> {
  const formedAt = new Date().toISOString();
  const connection = getConnection();
  if (!connection.token) throw new Error('Не задан токен Tracker.');
  const client = new TrackerClient(connection);
  const developers = listDevelopers();
  const statusTypes = await client.listStatusTypeMap().catch(() => new Map<string, string>());
  const bounds = periodWindow(request.period);
  const boards = summaryTargets(request);
  const found = new Map<string, { issue: SummaryIssue; board: SummaryBoardRef }>();
  for (const board of boards) {
    const base = buildIssuesQuery({
      boardId: board.trackerBoardId,
      queueKey: '',
      sprintIds: [],
      logins: [],
      membership: 'board',
      unresolvedOnly: false,
    });
    const issues = await client.findIssues(`${base} AND ${bounds.query}`);
    for (const issue of issues) rememberIssue(found, issue, board, boards);
    const statuses = watchedStatuses(request, board.boardLocalId);
    if (statuses.length) {
      const standing = buildIssuesQuery({
        boardId: board.trackerBoardId,
        queueKey: '',
        sprintIds: [],
        logins: [],
        membership: 'board',
        unresolvedOnly: true,
      });
      const quoted = statuses.map((key) => `"${key.replace(/"/g, '')}"`).join(', ');
      const parked = await client.findIssues(`${standing} AND Status: ${quoted}`);
      for (const issue of parked) rememberIssue(found, issue, board, boards);
    }
  }
  const collected = [...found.values()];
  if (collected.length > 0) onProgress({ row: null, index: 0, total: collected.length });
  const rows: SummaryRow[] = [];
  const stored: SummaryIssue[] = [];
  const eventsByKey: Record<string, TrackerChangelogEvent[]> = {};
  const chronologyByKey: Record<string, TrackerChangelogEvent[]> = {};
  const originByKey = new Map<string, SummaryBoardRef>();
  try {
    for (let i = 0; i < collected.length; i += 1) {
      const { issue, board } = collected[i];
      let row: SummaryRow | null = null;
      try {
        const events = (await changelogForPeriod(client, issue.key, bounds.fromIso)).map(slimEvent);
        const chronology = await chronologyForIssue(client, issue.key);
        stored.push(snapshotIssue(issue));
        eventsByKey[issue.key] = events;
        chronologyByKey[issue.key] = chronology;
        originByKey.set(issue.key, board);
        row = interpretIssue(
          issue,
          events,
          request,
          statusTypes,
          bounds.fromIso,
          bounds.toIso,
          developers,
          board,
          chronology,
        );
        if (row) rows.push(row);
      } catch (error) {
        if (isTrackerStopped(error)) throw error;
      }
      onProgress({ row, index: i + 1, total: collected.length });
      if (i < collected.length - 1) await pauseableWait(280);
    }
  } catch (error) {
    if (isTrackerStopped(error) && stillCurrent()) {
      persistCollected(request, formedAt, bounds, statusTypes, stored, eventsByKey, chronologyByKey, originByKey, true);
    }
    throw error;
  }
  rows.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  persistCollected(request, formedAt, bounds, statusTypes, stored, eventsByKey, chronologyByKey, originByKey, false);
  return {
    formedAt,
    period: request.period,
    participantName: request.participant?.displayName || request.participant?.login || 'Все участники',
    requests: trackerActivity().total,
    rows,
  };
}

export async function refreshSummaryIssue(
  request: SummaryBuildRequest,
  issueKey: string,
  boardLocalId: number,
): Promise<SummaryRow | null> {
  const connection = getConnection();
  if (!connection.token) throw new Error('Не задан токен Tracker.');
  const client = new TrackerClient(connection);
  const developers = listDevelopers();
  const statusTypes = await client.listStatusTypeMap().catch(() => new Map<string, string>());
  const issue = await client.getIssue(issueKey);
  const stored = getSummarySource(boardLocalId);
  const bounds = periodWindow(request.period);
  const sinceIso =
    stored?.fromIso && Date.parse(stored.fromIso) < Date.parse(bounds.fromIso) ? stored.fromIso : bounds.fromIso;
  const events = (await changelogForPeriod(client, issueKey, sinceIso)).map(slimEvent);
  const chronology = await chronologyForIssue(client, issueKey);
  const comments = await client.listIssueComments(issueKey);
  const payload: SummaryCachePayload = stored
    ? (JSON.parse(stored.payload) as SummaryCachePayload)
    : { issues: [], events: {}, statusTypes: [...statusTypes.entries()] };
  const snap = snapshotIssue({
    key: issue.key,
    summary: issue.summary,
    url: issue.url,
    statusKey: issue.statusKey,
    statusDisplay: issue.statusDisplay,
    statusStartTime: issue.statusStartTime,
    assigneeDisplay: issue.assigneeDisplay,
    reviewerDisplay: issue.reviewerDisplay,
    qaDisplay: issue.qaDisplay,
    authorDisplay: issue.authorDisplay,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    sprintName: issue.sprintName,
  });
  const index = payload.issues.findIndex((item) => item.key === issueKey);
  if (index >= 0) payload.issues[index] = snap;
  else payload.issues.push(snap);
  payload.events[issueKey] = events;
  payload.chronology = payload.chronology || {};
  payload.chronology[issueKey] = chronology;
  if (!payload.statusTypes?.length) payload.statusTypes = [...statusTypes.entries()];
  saveSummarySource(boardLocalId, {
    formedAt: stored?.formedAt || new Date().toISOString(),
    fromIso: stored?.fromIso || bounds.fromIso,
    toIso: stored?.toIso || bounds.toIso,
    requests: stored?.requests || trackerActivity().total,
    payload: JSON.stringify(payload),
  });
  const origin = (request.boards || []).find((board) => board.boardLocalId === boardLocalId);
  const row = interpretIssue(
    snap,
    events,
    { ...request, participant: null },
    new Map(payload.statusTypes),
    stored?.fromIso || bounds.fromIso,
    stored?.toIso || bounds.toIso,
    developers,
    origin,
    chronology,
  );
  if (!row) return null;
  return applyCommentMarks(row, comments, developers);
}

async function changelogForPeriod(client: TrackerClient, issueKey: string, fromIso: string) {
  const sinceMs = Date.parse(fromIso);
  if (!Number.isFinite(sinceMs)) return client.getChangelog(issueKey);
  return client.getChangelogSince(issueKey, sinceMs);
}

async function chronologyForIssue(client: TrackerClient, issueKey: string): Promise<TrackerChangelogEvent[]> {
  const groups: TrackerChangelogEvent[][] = [];
  for (let i = 0; i < CHRONOLOGY_FIELDS.length; i += 1) {
    if (i > 0) await pauseableWait(120);
    groups.push(await client.getFieldChangelog(issueKey, CHRONOLOGY_FIELDS[i]));
  }
  return mergeChangelog(groups).map(slimEvent);
}

function mergeChangelog(groups: TrackerChangelogEvent[][]): TrackerChangelogEvent[] {
  const merged = new Map<string, TrackerChangelogEvent>();
  for (const event of groups.flat()) {
    const key = event.id || `${event.updatedAt || ''}|${event.type || ''}|${(event.fields || []).map((field) => fieldId(field.field)).join(',')}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...event, fields: [...(event.fields || [])] });
      continue;
    }
    const seen = new Set((prev.fields || []).map((field) => fieldId(field.field)));
    for (const field of event.fields || []) {
      const id = fieldId(field.field);
      if (seen.has(id)) continue;
      seen.add(id);
      prev.fields = [...(prev.fields || []), field];
    }
  }
  return [...merged.values()];
}

function applyCommentMarks(row: SummaryRow, comments: TrackerComment[], developers: Developer[]): SummaryRow {
  const lastById = { ...(row.lastById || {}) };
  let lastActionAt = row.lastActionAt;
  let lastActionText = row.lastActionText;
  let lastActionBy = row.lastActionBy || '';
  for (const comment of comments) {
    if (isReactionComment(comment.text, comment.type)) continue;
    const at = Date.parse(comment.createdAt || '');
    if (!Number.isFinite(at) || !comment.createdAt) continue;
    const who = developers.filter((person) => matchesPerson(person, comment.createdBy || null));
    for (const person of who) {
      const key = String(person.id);
      const prev = lastById[key];
      if (!prev || at >= stamp(prev.at)) lastById[key] = { at: comment.createdAt, text: 'Комментарий' };
    }
    if (!lastActionAt || at >= stamp(lastActionAt)) {
      lastActionAt = comment.createdAt;
      lastActionText = 'Комментарий';
      lastActionBy = customPersonName(comment.createdBy?.display || '', developers);
    }
  }
  return { ...row, lastById, lastActionAt, lastActionText, lastActionBy };
}

export function sliceStoredSummary(request: SummaryBuildRequest): SummarySlice | null {
  const boards = summaryTargets(request);
  if (!boards.length) return null;
  try {
    return sliceBoards(boards, request);
  } catch {
    return null;
  }
}

function sliceSummaryCache(stored: StoredSummaryCache, request: SummaryBuildRequest): SummarySlice {
  const payload = JSON.parse(stored.payload) as SummaryCachePayload;
  const developers = listDevelopers();
  const statusTypes = new Map(payload.statusTypes);
  const bounds = periodWindow(request.period);
  const rows: SummaryRow[] = [];
  for (const issue of payload.issues) {
    const row = interpretIssue(
      issue,
      payload.events[issue.key] || [],
      request,
      statusTypes,
      bounds.fromIso,
      bounds.toIso,
      developers,
      undefined,
      payload.chronology?.[issue.key],
    );
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const fromMs = Date.parse(bounds.fromIso);
  const toMs = Date.parse(bounds.toIso);
  const covers = fromMs >= Date.parse(stored.fromIso) - 1000 && toMs <= Date.parse(stored.toIso) + 1000;
  const complete = covers && !payload.partial;
  return {
    report: {
      formedAt: stored.formedAt,
      period: request.period,
      participantName: request.participant?.displayName || request.participant?.login || '',
      requests: stored.requests,
      rows,
    },
    coverageFrom: stored.fromIso,
    coverageTo: stored.toIso,
    complete,
  };
}

/** A new formation that crosses the stored period replaces that summary entirely. */
export function discardOverlappingSummary(period: SummaryPeriod): void {
  const bounds = periodWindow(period);
  const overlaps = listSummarySourceBounds().some((row) =>
    rangesOverlap(bounds.fromIso, bounds.toIso, row.fromIso, row.toIso),
  );
  if (!overlaps) return;
  clearSummaryReports();
}

function rangesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  const a0 = Date.parse(aFrom);
  const a1 = Date.parse(aTo);
  const b0 = Date.parse(bFrom);
  const b1 = Date.parse(bTo);
  if (![a0, a1, b0, b1].every((value) => Number.isFinite(value))) return false;
  return a0 <= b1 && b0 <= a1;
}

function periodWindow(period: SummaryPeriod): { fromIso: string; toIso: string; query: string } {
  if (period.kind === 'custom') {
    const swapped = period.from > period.to;
    const from = swapped ? period.to : period.from;
    const to = swapped ? period.from : period.to;
    const fromTime = swapped ? period.toTime : period.fromTime;
    const toTime = swapped ? period.fromTime : period.toTime;
    return {
      fromIso: clockBound(from, fromTime, false),
      toIso: clockBound(to, toTime, true),
      query: `Updated: >= "${from}" AND Updated: < "${addIsoDays(to, 1)}"`,
    };
  }
  const ms =
    period.id === 'day'
      ? 86_400_000
      : period.id === 'week'
        ? 7 * 86_400_000
        : period.id === 'month'
          ? 30 * 86_400_000
          : 90 * 86_400_000;
  const from = new Date(Date.now() - ms);
  return {
    fromIso: from.toISOString(),
    toIso: new Date().toISOString(),
    query: `Updated: > "${from.toISOString().slice(0, 10)}"`,
  };
}

function clockBound(iso: string, time: string | undefined, end: boolean): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time || '');
  const hours = match ? Number(match[1]) : end ? 23 : 0;
  const minutes = match ? Number(match[2]) : end ? 59 : 0;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, match ? 0 : end ? 59 : 0, match ? 0 : end ? 999 : 0);
  return date.toISOString();
}

function summaryTargets(request: SummaryBuildRequest): SummaryBoardRef[] {
  const listed = (request.boards || []).filter((board) => board.trackerBoardId > 0);
  if (listed.length) return listed;
  if (request.trackerBoardId == null || request.boardLocalId == null) return [];
  return [
    {
      boardLocalId: request.boardLocalId,
      trackerBoardId: request.trackerBoardId,
      queueKey: request.queueKey,
      name: '',
      alias: '',
    },
  ];
}

function issueQueue(key: string): string {
  const dash = key.lastIndexOf('-');
  return (dash > 0 ? key.slice(0, dash) : key).toLowerCase();
}

function sourceBoard(key: string, foundOn: SummaryBoardRef, boards: SummaryBoardRef[]): SummaryBoardRef {
  const queue = issueQueue(key);
  return boards.find((board) => board.queueKey.toLowerCase() === queue) || foundOn;
}

function watchedStatuses(request: SummaryBuildRequest, boardLocalId: number): string[] {
  const keys = request.columns
    .filter((column) => column.boardLocalId === boardLocalId && columnKeepsIssue(column))
    .map((column) => column.statusKey);
  return [...new Set(keys)];
}

function watchedStatus(
  request: SummaryBuildRequest,
  origin: SummaryBoardRef | undefined,
  statusKey: string,
): boolean {
  if (!statusKey) return false;
  return request.columns.some(
    (column) =>
      column.statusKey === statusKey &&
      (!origin || !column.boardLocalId || column.boardLocalId === origin.boardLocalId) &&
      columnKeepsIssue(column),
  );
}

function columnKeepsIssue(column: SummaryBuildRequest['columns'][number]): boolean {
  return (
    column.duty === 'development' ||
    column.duty === 'review' ||
    column.duty === 'testing' ||
    column.ownerRole === 'developer' ||
    column.ownerRole === 'qa'
  );
}

function rememberIssue(
  found: Map<string, { issue: SummaryIssue; board: SummaryBoardRef }>,
  issue: SummaryIssue,
  foundOn: SummaryBoardRef,
  boards: SummaryBoardRef[],
): void {
  const source = sourceBoard(issue.key, foundOn, boards);
  const prev = found.get(issue.key);
  if (!prev) {
    found.set(issue.key, { issue, board: source });
    return;
  }
  const queue = issueQueue(issue.key);
  const prevIsSource = prev.board.queueKey.toLowerCase() === queue;
  const nextIsSource = source.queueKey.toLowerCase() === queue;
  if (nextIsSource && !prevIsSource) found.set(issue.key, { issue, board: source });
}

function persistCollected(
  request: SummaryBuildRequest,
  formedAt: string,
  bounds: { fromIso: string; toIso: string },
  statusTypes: Map<string, string>,
  issues: SummaryIssue[],
  events: Record<string, TrackerChangelogEvent[]>,
  chronology: Record<string, TrackerChangelogEvent[]>,
  originByKey: Map<string, SummaryBoardRef>,
  partial: boolean,
): void {
  const groups = new Map<
    number,
    { issues: SummaryIssue[]; events: Record<string, TrackerChangelogEvent[]>; chronology: Record<string, TrackerChangelogEvent[]> }
  >();
  for (const issue of issues) {
    const boardId = originByKey.get(issue.key)?.boardLocalId;
    if (boardId == null) continue;
    const group = groups.get(boardId) || { issues: [], events: {}, chronology: {} };
    group.issues.push(issue);
    if (events[issue.key]) group.events[issue.key] = events[issue.key];
    if (chronology[issue.key]) group.chronology[issue.key] = chronology[issue.key];
    groups.set(boardId, group);
  }
  for (const [boardLocalId, group] of groups) {
    persistCache(
      { ...request, boardLocalId, participant: null },
      formedAt,
      bounds,
      statusTypes,
      group.issues,
      group.events,
      group.chronology,
      partial,
    );
  }
}

function sliceBoards(boards: SummaryBoardRef[], request: SummaryBuildRequest): SummarySlice | null {
  const developers = listDevelopers();
  const merged = new Map<
    string,
    { issue: SummaryIssue; events: TrackerChangelogEvent[]; chronology?: TrackerChangelogEvent[]; board: SummaryBoardRef }
  >();
  const placed = new Map<string, { issue: SummaryIssue; board: SummaryBoardRef }>();
  let formedAt = '';
  let requests = 0;
  let fromIso = '';
  let toIso = '';
  let partial = boards.length === 0;
  let statusTypes = new Map<string, string>();
  let any = false;
  for (const board of boards) {
    const stored = getSummarySource(board.boardLocalId);
    if (!stored) {
      partial = true;
      continue;
    }
    any = true;
    formedAt = stored.formedAt;
    requests += stored.requests;
    fromIso = fromIso && fromIso > stored.fromIso ? fromIso : stored.fromIso;
    toIso = toIso && toIso < stored.toIso ? toIso : stored.toIso;
    const payload = JSON.parse(stored.payload) as SummaryCachePayload;
    if (payload.partial) partial = true;
    statusTypes = new Map(payload.statusTypes);
    for (const issue of payload.issues) {
      rememberIssue(placed, issue, board, boards);
      const kept = placed.get(issue.key);
      if (!kept) continue;
      const prev = merged.get(issue.key);
      const eventsHere = payload.events[issue.key];
      const chronologyHere = payload.chronology?.[issue.key];
      const fromSource = kept.board.boardLocalId === board.boardLocalId;
      const events =
        fromSource && eventsHere ? eventsHere : !prev?.events?.length && eventsHere ? eventsHere : prev?.events || eventsHere || [];
      const chronology =
        fromSource && chronologyHere
          ? chronologyHere
          : !prev?.chronology?.length && chronologyHere
            ? chronologyHere
            : prev?.chronology || chronologyHere;
      merged.set(issue.key, { issue: kept.issue, board: kept.board, events, chronology });
    }
  }
  if (!any) return null;
  const bounds = periodWindow(request.period);
  const rows: SummaryRow[] = [];
  for (const item of merged.values()) {
    const row = interpretIssue(
      item.issue,
      item.events || [],
      request,
      statusTypes,
      bounds.fromIso,
      bounds.toIso,
      developers,
      item.board,
      item.chronology,
    );
    if (row) rows.push(row);
  }
  rows.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  const fromMs = Date.parse(bounds.fromIso);
  const toMs = Date.parse(bounds.toIso);
  const covers =
    Boolean(fromIso && toIso) && fromMs >= Date.parse(fromIso) - 1000 && toMs <= Date.parse(toIso) + 1000;
  return {
    report: {
      formedAt,
      period: request.period,
      participantName: request.participant?.displayName || request.participant?.login || 'Все участники',
      requests,
      rows,
    },
    coverageFrom: fromIso,
    coverageTo: toIso,
    complete: covers && !partial,
  };
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type PersonRef = {
  id?: string | number;
  display?: string;
  login?: string;
  passportUid?: string | number;
};

type SummaryIssue = {
  key: string;
  summary: string;
  url: string;
  statusKey: string;
  statusDisplay: string;
  statusStartTime: string | null;
  assigneeDisplay: string | null;
  reviewerDisplay: string | null;
  qaDisplay: string | null;
  authorDisplay?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  sprintName: string | null;
};

type SummaryCachePayload = {
  issues: SummaryIssue[];
  events: Record<string, TrackerChangelogEvent[]>;
  /** Full status and holder history. Absent on summaries built before this was stored. */
  chronology?: Record<string, TrackerChangelogEvent[]>;
  statusTypes: Array<[string, string]>;
  partial?: boolean;
};

function snapshotIssue(issue: SummaryIssue): SummaryIssue {
  return {
    key: issue.key,
    summary: issue.summary,
    url: issue.url,
    statusKey: issue.statusKey,
    statusDisplay: issue.statusDisplay,
    statusStartTime: issue.statusStartTime,
    assigneeDisplay: issue.assigneeDisplay,
    reviewerDisplay: issue.reviewerDisplay,
    qaDisplay: issue.qaDisplay,
    authorDisplay: issue.authorDisplay || null,
    createdAt: issue.createdAt || null,
    updatedAt: issue.updatedAt || null,
    sprintName: issue.sprintName,
  };
}

function persistCache(
  request: SummaryBuildRequest,
  formedAt: string,
  bounds: { fromIso: string; toIso: string },
  statusTypes: Map<string, string>,
  issues: SummaryIssue[],
  events: Record<string, TrackerChangelogEvent[]>,
  chronology: Record<string, TrackerChangelogEvent[]>,
  partial: boolean,
): void {
  if (request.boardLocalId == null || !issues.length) return;
  const payload: SummaryCachePayload = {
    issues,
    events,
    chronology,
    statusTypes: [...statusTypes.entries()],
    partial,
  };
  const stored: StoredSummaryCache = {
    formedAt,
    fromIso: bounds.fromIso,
    toIso: bounds.toIso,
    requests: trackerActivity().total,
    payload: JSON.stringify(payload),
  };
  saveSummarySource(request.boardLocalId, stored);
  if (request.participant) saveSummaryCache(request.boardLocalId, request.participant.id, stored);
}

function roleOf(field: { id?: string; display?: string } | string | undefined): 'assignee' | 'qa' | 'reviewer' | 'status' | 'sprint' | '' {
  const id = fieldId(field).toLowerCase();
  const display = (typeof field === 'object' && field?.display ? field.display : '').toLowerCase();
  const blob = `${id} ${display}`;
  if (id === 'status' || display === 'статус') return 'status';
  if (id === 'assignee' || display === 'исполнитель') return 'assignee';
  if (id === 'sprint' || display === 'спринт') return 'sprint';
  if (id === 'qa' || id === 'qaengineer' || /tester|тестиров|qaengineer/.test(blob)) return 'qa';
  if (id === 'kodrevu' || id === 'reviewer' || id === 'codereview' || /ревью|reviewer|codereview|review/.test(blob)) return 'reviewer';
  return '';
}

function slimEvent(event: TrackerChangelogEvent): TrackerChangelogEvent {
  return {
    updatedAt: event.updatedAt,
    updatedBy: event.updatedBy
      ? {
          id: event.updatedBy.id,
          display: event.updatedBy.display,
          login: event.updatedBy.login,
          passportUid: event.updatedBy.passportUid,
        }
      : null,
    type: event.type,
    comments: event.comments?.added?.length
      ? {
          added: event.comments.added.map((item) => ({
            id: item.id,
            createdBy: item.createdBy
              ? {
                  id: item.createdBy.id,
                  display: item.createdBy.display,
                  login: item.createdBy.login,
                  passportUid: item.createdBy.passportUid,
                }
              : undefined,
          })),
        }
      : undefined,
    fields: (event.fields || [])
      .filter((field) => roleOf(field.field))
      .map((field) => ({
        field: {
          id: fieldId(field.field),
          display: typeof field.field === 'object' ? field.field.display : undefined,
        },
        from: slimValue(field.from),
        to: slimValue(field.to),
      })),
  };
}

function slimValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(slimValue);
  if (typeof value === 'object') {
    const row = value as { key?: string; display?: string; id?: string | number; login?: string; passportUid?: string | number };
    return { key: row.key, display: row.display, id: row.id, login: row.login, passportUid: row.passportUid };
  }
  return null;
}

type StatusSpan = {
  key: string;
  display: string;
  from: number;
  to: number;
  assigneeIds: number[];
  qaIds: number[];
  reviewerIds: number[];
};

function collectStatusSpans(
  issue: SummaryIssue,
  events: TrackerChangelogEvent[],
  audience: Developer[],
  holds: (person: Developer, value: unknown) => boolean,
): StatusSpan[] {
  const ordered = [...events].sort((a, b) => stamp(a.updatedAt) - stamp(b.updatedAt));
  const idsHolding = (value: unknown) => audience.filter((person) => holds(person, value)).map((person) => person.id);
  const statusSpans: StatusSpan[] = [];
  let assigneeIds: number[] = [];
  let qaIds: number[] = [];
  let reviewerIds: number[] = [];
  let sawAssignee = false;
  let sawQa = false;
  let sawReviewer = false;
  let statusKey = '';
  let statusDisplay = '';
  let spanStart = issue.createdAt ? Date.parse(issue.createdAt) : Number.NaN;
  const firstStatus = ordered
    .flatMap((event) => event.fields || [])
    .find((field) => roleOf(field.field) === 'status');
  if (!firstStatus && issue.statusKey) {
    statusKey = issue.statusKey;
    statusDisplay = issue.statusDisplay || '';
    const statusStart = stamp(issue.statusStartTime || undefined);
    if (Number.isFinite(statusStart)) spanStart = statusStart;
  } else if (firstStatus) {
    const bornKey = valueKey(firstStatus.from) || valueDisplay(firstStatus.from);
    if (bornKey) {
      statusKey = bornKey;
      statusDisplay = valueDisplay(firstStatus.from) || bornKey;
    }
  }
  const fillHolders = (kind: 'assignee' | 'qa' | 'reviewer', ids: number[]) => {
    for (const span of statusSpans) {
      if (kind === 'assignee' && !span.assigneeIds.length) span.assigneeIds = [...ids];
      if (kind === 'qa' && !span.qaIds.length) span.qaIds = [...ids];
      if (kind === 'reviewer' && !span.reviewerIds.length) span.reviewerIds = [...ids];
    }
  };
  const closeSpan = (nextAt: number) => {
    if (!statusKey || !Number.isFinite(spanStart) || !Number.isFinite(nextAt) || nextAt < spanStart) return;
    statusSpans.push({
      key: statusKey,
      display: statusDisplay,
      from: spanStart,
      to: nextAt,
      assigneeIds: [...assigneeIds],
      qaIds: [...qaIds],
      reviewerIds: [...reviewerIds],
    });
  };
  const retarget = (at: number) => {
    if (statusKey && Number.isFinite(spanStart) && at > spanStart) {
      closeSpan(at);
      spanStart = at;
    }
  };
  const takeRole = (role: 'assignee' | 'qa' | 'reviewer', fromIds: number[], toIds: number[], at: number) => {
    if (role === 'assignee') {
      if (!sawAssignee) {
        assigneeIds = fromIds;
        fillHolders('assignee', fromIds);
        sawAssignee = true;
      }
      retarget(at);
      assigneeIds = toIds;
      return;
    }
    if (role === 'qa') {
      if (!sawQa) {
        qaIds = fromIds;
        fillHolders('qa', fromIds);
        sawQa = true;
      }
      retarget(at);
      qaIds = toIds;
      return;
    }
    if (!sawReviewer) {
      reviewerIds = fromIds;
      fillHolders('reviewer', fromIds);
      sawReviewer = true;
    }
    retarget(at);
    reviewerIds = toIds;
  };
  for (const event of ordered) {
    const at = stamp(event.updatedAt);
    for (const field of event.fields || []) {
      const role = roleOf(field.field);
      if (role === 'status') {
        closeSpan(at);
        statusKey = valueKey(field.to) || statusKey;
        statusDisplay = valueDisplay(field.to) || statusDisplay;
        spanStart = at;
      } else if (role === 'assignee' || role === 'qa' || role === 'reviewer') {
        takeRole(role, idsHolding(field.from), idsHolding(field.to), at);
      }
    }
  }
  if (!sawAssignee) {
    assigneeIds = idsHolding(issue.assigneeDisplay);
    fillHolders('assignee', assigneeIds);
  }
  if (!sawQa) {
    qaIds = idsHolding(issue.qaDisplay);
    fillHolders('qa', qaIds);
  }
  if (!sawReviewer) {
    reviewerIds = idsHolding(issue.reviewerDisplay);
    fillHolders('reviewer', reviewerIds);
  }
  const end = Date.now();
  if (statusKey && Number.isFinite(spanStart)) {
    statusSpans.push({
      key: statusKey,
      display: statusDisplay || issue.statusDisplay,
      from: spanStart,
      to: end,
      assigneeIds: [...assigneeIds],
      qaIds: [...qaIds],
      reviewerIds: [...reviewerIds],
    });
  }
  return statusSpans;
}

function interpretIssue(
  issue: SummaryIssue,
  events: TrackerChangelogEvent[],
  request: SummaryBuildRequest,
  statusTypes: Map<string, string>,
  fromIso: string,
  toIso: string,
  developers: Developer[] = [],
  origin?: SummaryBoardRef,
  chronology?: TrackerChangelogEvent[],
): SummaryRow | null {
  const focus = request.participant;
  const audience = (
    focus
      ? [focus]
      : developers.filter((person) => (person.role === 'developer' || person.role === 'qa') && !person.hidden)
  ).filter((person) => person.id > 0);
  if (!audience.length) return null;
  const touched = new Set<number>();
  const changedBy = new Set<number>();
  const ordered = [...events].sort((a, b) => stamp(a.updatedAt) - stamp(b.updatedAt));
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  let touchedInPeriod = false;
  let assignee = '';
  let reviewer = '';
  let qa = '';
  let statusKey = '';
  let statusDisplay = '';
  let statusAt: string | null = issue.createdAt || null;
  let sprint = '';
  let takenAt: string | null = null;
  const assignees: string[] = [];
  const qas: string[] = [];
  const reviewers: string[] = [];
  const sprints: string[] = [];
  let receivedAt: string | null = null;
  let receivedStatus = '';
  let receivedSprint = '';
  const first: Record<'assignee' | 'qa' | 'reviewer', string> = { assignee: '', qa: '', reviewer: '' };
  const last: Record<'assignee' | 'qa' | 'reviewer', string> = { assignee: '', qa: '', reviewer: '' };
  let wasAssignee = false;
  let wasReviewer = false;
  const comments: number[] = [];
  let commentTotal = 0;
  const commentsById: Record<string, number> = {};
  let lastActionAt: string | null = null;
  let lastActionText = '';
  let lastActionBy = '';
  const lastById: Record<string, { at: string; text: string }> = {};
  let finalStatusAt: string | null = null;
  let lastActivityAt = issue.updatedAt || issue.createdAt || null;
  const personLabel = (raw: string) => customPersonName(raw, developers);
  const holds = (person: Developer, value: unknown) => {
    if (matchesPerson(person, asPerson(value))) return true;
    const display = valueDisplay(value);
    if (!display) return false;
    if (matchesPerson(person, { display })) return true;
    const resolved = personLabel(display);
    return Boolean(resolved) && resolved === person.displayName.trim();
  };

  const noteRole = (role: 'assignee' | 'qa' | 'reviewer', name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!first[role]) first[role] = trimmed;
    last[role] = trimmed;
    const list = role === 'assignee' ? assignees : role === 'qa' ? qas : reviewers;
    if (!list.includes(trimmed)) list.push(trimmed);
  };
  const noteSprint = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || sprints.includes(trimmed)) return;
    sprints.push(trimmed);
  };

  for (const event of ordered) {
    const at = stamp(event.updatedAt);
    if (at >= stamp(lastActivityAt || undefined)) lastActivityAt = event.updatedAt || lastActivityAt;
    const matchedNow = audience.filter((item) => matchesPerson(item, event.updatedBy || null));
    const byPerson = matchedNow.length > 0;
    if (byPerson && at >= fromMs && at <= toMs) {
      touchedInPeriod = true;
      for (const item of matchedNow) {
        touched.add(item.id);
        changedBy.add(item.id);
      }
    }
    for (const field of event.fields || []) {
      const role = roleOf(field.field);
      if (role === 'status') {
        statusKey = valueKey(field.to) || statusKey;
        statusDisplay = valueDisplay(field.to) || statusDisplay;
        statusAt = event.updatedAt || statusAt;
        const type = statusTypes.get(statusKey);
        if (type === 'done') finalStatusAt = event.updatedAt || finalStatusAt;
        if (!takenAt && isProgressStatus(statusKey, statusDisplay, type)) takenAt = event.updatedAt || null;
      } else if (role === 'assignee') {
        assignee = personLabel(valueDisplay(field.to));
        noteRole('assignee', assignee);
        const assigned = audience.filter((item) => holds(item, field.to) || holds(item, field.from));
        if (at >= fromMs && at <= toMs) {
          if (assigned.length) touchedInPeriod = true;
          for (const item of assigned) touched.add(item.id);
        }
        if (focus && assigned.some((item) => item.id === focus.id && holds(item, field.to))) {
          wasAssignee = true;
          if (!receivedAt) {
            receivedAt = event.updatedAt || null;
            receivedStatus = statusDisplay;
            receivedSprint = sprint;
          }
        }
      } else if (role === 'qa' || role === 'reviewer') {
        const label = personLabel(valueDisplay(field.to));
        if (role === 'qa') qa = label;
        else reviewer = label;
        noteRole(role, label);
        const involved = audience.filter((item) => holds(item, field.to) || holds(item, field.from));
        if (at >= fromMs && at <= toMs) {
          if (involved.length) touchedInPeriod = true;
          for (const item of involved) touched.add(item.id);
        }
        if (role === 'reviewer' && focus && involved.some((item) => item.id === focus.id)) wasReviewer = true;
      } else if (role === 'sprint') {
        sprint = valueDisplay(field.to);
        noteSprint(sprint);
      }
    }
    const eventType = (event.type || '').toLowerCase();
    const reaction = eventType.includes('reaction') || eventType.includes('emoji');
    const commented =
      !reaction && (eventType.includes('comment') || Boolean(event.comments?.added?.length));
    const commentPeople = commented
      ? audience.filter(
          (item) =>
            matchesPerson(item, event.updatedBy || null) ||
            (event.comments?.added || []).some((comment) => matchesPerson(item, comment.createdBy || null)),
        )
      : [];
    const addedComments = Math.max(event.comments?.added?.length || 0, commented ? 1 : 0);
    if (addedComments) {
      commentTotal += addedComments;
      for (const item of commentPeople) {
        const key = String(item.id);
        commentsById[key] = (commentsById[key] || 0) + addedComments;
      }
    }
    if (commentPeople.length && commented && Number.isFinite(at)) comments.push(at);
    const actionText = describeSummaryAction(event, personLabel);
    if (actionText && event.updatedAt && Number.isFinite(at)) {
      if (!lastActionAt || at >= stamp(lastActionAt)) {
        lastActionAt = event.updatedAt;
        lastActionText = actionText;
        lastActionBy = eventActor(event, personLabel);
      }
      const actors = commented ? commentPeople : matchedNow;
      for (const item of actors) {
        const key = String(item.id);
        const prev = lastById[key];
        if (!prev || at >= stamp(prev.at)) lastById[key] = { at: event.updatedAt, text: actionText };
      }
    }
    if (byPerson && !receivedAt && Number.isFinite(at)) {
      receivedAt = event.updatedAt || null;
      receivedStatus = statusDisplay;
      receivedSprint = sprint;
    }
  }
  const movedInPeriod =
    touchedInPeriod ||
    ordered.some((event) => {
      const at = stamp(event.updatedAt);
      return at >= fromMs && at <= toMs;
    }) ||
    (stamp(issue.updatedAt || undefined) >= fromMs && stamp(issue.updatedAt || undefined) <= toMs);
  if (movedInPeriod) {
    for (const person of audience) {
      if (holds(person, issue.assigneeDisplay)) {
        touched.add(person.id);
        touchedInPeriod = true;
        if (focus && person.id === focus.id) wasAssignee = true;
      }
      if (holds(person, issue.reviewerDisplay)) {
        touched.add(person.id);
        touchedInPeriod = true;
        if (focus && person.id === focus.id) wasReviewer = true;
      }
      if (holds(person, issue.qaDisplay)) {
        touched.add(person.id);
        touchedInPeriod = true;
      }
    }
  }
  if (!movedInPeriod && !watchedStatus(request, origin, issue.statusKey)) return null;
  if (!finalStatusAt && statusTypes.get(issue.statusKey) === 'done') finalStatusAt = issue.statusStartTime;
  if (!takenAt && isProgressStatus(issue.statusKey, issue.statusDisplay, statusTypes.get(issue.statusKey))) {
    takenAt = issue.statusStartTime;
  }
  noteRole('assignee', personLabel(issue.assigneeDisplay || assignee));
  noteRole('qa', personLabel(issue.qaDisplay || qa));
  noteRole('reviewer', personLabel(issue.reviewerDisplay || reviewer));
  noteSprint(issue.sprintName || '');
  const spanEvents = chronology?.length ? chronology : ordered;
  const columns = sumColumns(
    collectStatusSpans(issue, spanEvents, audience, holds),
    request.columns,
    origin?.boardLocalId,
    audience.filter((person) => holds(person, issue.authorDisplay)).map((person) => person.id),
  );
  const name = focus?.displayName.trim() || '';
  const shuffles: SummaryShuffle[] = [];
  if (focus) {
    pushShuffle(shuffles, 'assignee', 'Исполнитель', first.assignee, last.assignee || personLabel(issue.assigneeDisplay || ''), name);
    pushShuffle(shuffles, 'qa', 'Тестировщик', first.qa, last.qa || personLabel(issue.qaDisplay || ''), name);
    pushShuffle(shuffles, 'reviewer', 'Ревьюер', first.reviewer, last.reviewer || personLabel(issue.reviewerDisplay || ''), name);
  }
  const role = focus?.role;
  return {
    key: issue.key,
    summary: issue.summary,
    url: issue.url,
    assignee: personLabel(issue.assigneeDisplay || assignee) || '—',
    reviewer: personLabel(issue.reviewerDisplay || reviewer) || '—',
    qa: personLabel(issue.qaDisplay || qa) || '—',
    author: personLabel(issue.authorDisplay || '') || '—',
    createdAt: issue.createdAt || null,
    finalStatusAt,
    takenAt,
    statusKey: issue.statusKey,
    assignees,
    qas,
    reviewers,
    sprints,
    receivedAt,
    receivedStatus: receivedStatus || '—',
    receivedSprint: receivedSprint || '—',
    currentSprint: issue.sprintName || sprint || '—',
    currentStatus: issue.statusDisplay || statusDisplay || '—',
    currentStatusAt: issue.statusStartTime || statusAt,
    commentCount: commentTotal,
    commentsById,
    firstCommentAt: comments.length ? new Date(Math.min(...comments)).toISOString() : null,
    lastCommentAt: comments.length ? new Date(Math.max(...comments)).toISOString() : null,
    lastActivityAt,
    lastActionAt,
    lastActionText,
    lastActionBy,
    lastById,
    touchedIds: [...touched],
    changedByIds: [...changedBy],
    activeInPeriod: movedInPeriod,
    boardLocalId: origin?.boardLocalId ?? null,
    boardLabel: (origin?.alias || '').trim() || origin?.name || '',
    boardColor: origin?.color || '',
    columns,
    shuffles,
    emphasizeTesting: role === 'qa',
    emphasizeWork: role === 'developer' && wasAssignee,
    emphasizeReview: role === 'developer' && wasReviewer,
  };
}

function eventActor(event: TrackerChangelogEvent, personLabel: (raw: string) => string): string {
  const commentBy = (event.comments?.added || []).map((item) => item.createdBy?.display || '').find(Boolean) || '';
  const raw = (commentBy || event.updatedBy?.display || '').trim();
  if (!raw) return '';
  return personLabel(raw) || raw;
}

function describeSummaryAction(
  event: TrackerChangelogEvent,
  personLabel: (raw: string) => string,
): string {
  const bits: string[] = [];
  const added = event.comments?.added?.length || 0;
  const type = (event.type || '').toLowerCase();
  const reaction = type.includes('reaction') || type.includes('emoji');
  if (!reaction && (added > 0 || type.includes('comment'))) bits.push(added > 1 ? `Комментарии (${added})` : 'Комментарий');
  for (const field of event.fields || []) {
    const role = roleOf(field.field);
    const to = valueDisplay(field.to);
    if (role === 'status') bits.push(`Статус ${to || '—'}`);
    else if (role === 'assignee') bits.push(`Исполнитель ${personLabel(to) || '—'}`);
    else if (role === 'qa') bits.push(`Тестировщик ${personLabel(to) || '—'}`);
    else if (role === 'reviewer') bits.push(`Ревьюер ${personLabel(to) || '—'}`);
    else if (role === 'sprint') bits.push(`Спринт ${to || '—'}`);
  }
  if (bits.length) return bits.join(', ');
  return event.updatedAt ? 'Изменение' : '';
}

function pushShuffle(
  out: SummaryShuffle[],
  role: SummaryShuffle['role'],
  label: string,
  first: string,
  last: string,
  personName: string,
): void {
  if (first && first !== personName) {
    out.push({ role, tone: 'success', title: `${label} сначала был ${first}` });
  }
  if (last && last !== personName) {
    out.push({ role, tone: 'danger', title: `${label} стал ${last}` });
  }
}

function addBucket(bucket: Record<string, number>, ids: number[], ms: number) {
  for (const id of ids) {
    const key = String(id);
    bucket[key] = (bucket[key] || 0) + ms;
  }
}

function sumColumns(
  spans: Array<{
    key: string;
    display: string;
    from: number;
    to: number;
    assigneeIds?: number[];
    qaIds?: number[];
    reviewerIds?: number[];
  }>,
  columns: SummaryBuildRequest['columns'],
  boardLocalId: number | undefined,
  authorIds: number[],
): SummaryColumnTime[] {
  const byKey = new Map<string, SummaryColumnTime>();
  for (const span of spans) {
    const column = columns.find(
      (item) => item.statusKey === span.key && (boardLocalId == null || item.boardLocalId === boardLocalId),
    );
    const label = span.display || column?.statusDisplay || column?.columnName || span.key || '—';
    const kind = columnKind(span.key, label, column?.statusDisplay, column?.columnName);
    const prev = byKey.get(span.key || label);
    const ms = Math.max(0, span.to - span.from);
    const workMs = workingMs(span.from, span.to);
    const row =
      prev || { statusKey: span.key, label, ms: 0, workMs: 0, kind, byAssignee: {}, byQa: {}, byReviewer: {}, byAuthor: {} };
    row.ms += ms;
    row.workMs = (row.workMs || 0) + workMs;
    const duty = column?.duty || '';
    if (duty === 'development') addBucket(row.byAssignee || (row.byAssignee = {}), span.assigneeIds || [], ms);
    else if (duty === 'review') addBucket(row.byReviewer || (row.byReviewer = {}), span.reviewerIds || [], ms);
    else if (duty === 'testing') addBucket(row.byQa || (row.byQa = {}), span.qaIds || [], ms);
    else if (duty !== 'ai') addBucket(row.byAuthor || (row.byAuthor = {}), authorIds, ms);
    if (!prev) byKey.set(span.key || label, row);
  }
  return [...byKey.values()].filter((item) => item.ms >= 60_000);
}

function isProgressStatus(statusKey: string, display: string, type: string | undefined): boolean {
  if (type === 'inProgress') return true;
  if (/progress|inprogress/i.test(statusKey)) return true;
  return /в работе/i.test(display);
}

/** Weekday overlap with 10:00–19:00 local time. */
function workingMs(from: number, to: number): number {
  if (!(to > from)) return 0;
  let total = 0;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < to) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      const open = new Date(cursor);
      open.setHours(10, 0, 0, 0);
      const close = new Date(cursor);
      close.setHours(19, 0, 0, 0);
      const start = Math.max(from, open.getTime());
      const end = Math.min(to, close.getTime());
      if (end > start) total += end - start;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function columnKind(
  statusKey: string,
  ...names: Array<string | undefined>
): SummaryColumnTime['kind'] {
  if (statusKey === 'inProgress') return 'work';
  if (statusKey === 'inReview') return 'review';
  if (TESTING_KEYS.has(statusKey) || names.some((name) => /тест/i.test(name || ''))) return 'testing';
  return 'other';
}

function customPersonName(raw: string, developers: Developer[]): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—') return trimmed;
  return resolvePersonDisplayName(null, trimmed, developers) || trimmed;
}

function matchesPerson(person: Developer, who: PersonRef | null): boolean {
  if (!who) return false;
  const login = (who.login || '').toLowerCase();
  if (login && login === person.login.toLowerCase()) return true;
  const ids = [who.id, who.passportUid].filter((value) => value != null).map(String);
  if (person.uid && ids.includes(String(person.uid))) return true;
  const name = (who.display || '').trim();
  return Boolean(name) && name === person.displayName.trim();
}

function fieldId(field: { id?: string; display?: string } | string | undefined): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.id ? String(field.id) : '';
}

function valueDisplay(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(valueDisplay).filter(Boolean).join(', ');
  if (typeof value === 'object' && 'display' in value) return String((value as { display?: string }).display || '');
  return '';
}

function valueKey(value: unknown): string {
  if (value && typeof value === 'object' && 'key' in value) return String((value as { key?: string }).key || '');
  return '';
}

function asPerson(value: unknown): PersonRef | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as PersonRef;
  return row;
}

function stamp(iso: string | undefined): number {
  const ms = Date.parse(iso || '');
  return Number.isNaN(ms) ? 0 : ms;
}

