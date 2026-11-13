import type {
  TrackerBoard,
  TrackerBoardColumn,
  TrackerConnection,
  TrackerIssue,
  TrackerSprint,
  TrackerUser,
} from '../shared/types';
import { collectPersonMatchKeys } from '../shared/personDisplay';
import { trackRequestEnd, trackRequestStart } from './trackerActivity';
import { noteRunRequest } from './trackerRuns';
import {
  bindRequest,
  checkpoint,
  currentRun,
  isTrackerStopped,
  pauseableWait,
  releaseRequest,
  TrackerStopped,
} from './trackerGate';
import { pushApiLine } from './consoleFeed';

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  retries?: number;
  /** Abort the attempt so a stuck Tracker call cannot hang the UI. */
  timeoutMs?: number;
  meta?: { totalPages?: number };
};

const BOARD_LOOKUP_TIMEOUT_MS = 12_000;

function normalizeKnownBoards(known: TrackerBoard[] | undefined): TrackerBoard[] {
  if (!Array.isArray(known)) return [];
  const out: TrackerBoard[] = [];
  for (const item of known) {
    if (!item || typeof item !== 'object') continue;
    const id = Number(item.id);
    if (!Number.isFinite(id)) continue;
    const name = String(item.name || '').trim() || `Доска ${id}`;
    const queueKey = item.queueKey?.trim() || null;
    out.push({ id, name, queueKey });
  }
  return out;
}

function looksLikeQueueKey(query: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,50}$/.test(query.trim());
}

/**
 * Id, or a case-insensitive piece of the board name or queue key.
 * A name like AI_BC used to be sent to Tracker as a queue: `_` is legal in a
 * queue key, so the lookup 404'd before any name comparison.
 */
function boardMatchesQuery(board: TrackerBoard, query: string): boolean {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return false;
  if (/^\d+$/.test(raw) && board.id === Number(raw)) return true;
  const name = (board.name || '').trim().toLowerCase();
  const queue = (board.queueKey || '').trim().toLowerCase();
  return name.includes(q) || queue.includes(q);
}

function sortBoards(list: TrackerBoard[]): TrackerBoard[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id - b.id);
}

function queueAlreadyListed(boards: Iterable<TrackerBoard>, queueKey: string): boolean {
  const q = queueKey.trim().toLowerCase();
  if (!q) return false;
  for (const board of boards) {
    if (board.queueKey?.trim().toLowerCase() === q) return true;
  }
  return false;
}

export class TrackerClient {
  private statusTypes: Map<string, string> | null = null;

  constructor(private connection: TrackerConnection) {}

  updateConnection(connection: TrackerConnection): void {
    this.connection = connection;
    this.statusTypes = null;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `OAuth ${this.connection.token}`,
      'Content-Type': 'application/json',
    };
    if (this.connection.cloudOrgId) {
      headers['X-Cloud-Org-Id'] = this.connection.cloudOrgId;
    }
    if (this.connection.orgId) {
      headers['X-Org-ID'] = this.connection.orgId;
    }
    return headers;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const base = this.connection.apiUrl.replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const retries = options.retries ?? 2;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await checkpoint();
      trackRequestStart();
      noteRunRequest(currentRun());
      const controller = new AbortController();
      bindRequest(controller);
      const started = Date.now();
      const method = options.method ?? 'GET';
      let recorded = false;
      const mark = (status: number) => {
        if (recorded) return;
        recorded = true;
        pushApiLine({
          method,
          path: safePath(url),
          status,
          ms: Date.now() - started,
          detail: safeDetail(options.body),
        });
      };
      const signal = options.timeoutMs
        ? AbortSignal.any([controller.signal, AbortSignal.timeout(options.timeoutMs)])
        : controller.signal;
      try {
        const response = await fetch(url, {
          method,
          headers: this.headers(),
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal,
        });
        mark(response.status);
        if (response.ok) {
          if (options.meta) {
            const pages = Number(response.headers.get('x-total-pages'));
            if (Number.isFinite(pages) && pages > 0) options.meta.totalPages = pages;
          }
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        }
        const text = await response.text();
        lastError = new Error(`Tracker API ${response.status}: ${text || response.statusText}`);
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === retries) throw lastError;
        if (response.status === 429) {
          const header = Number(response.headers.get('retry-after'));
          const waitMs = Number.isFinite(header) && header > 0 ? header * 1000 : 1500 * (attempt + 1);
          await pauseableWait(waitMs);
          continue;
        }
      } catch (err) {
        mark(0);
        if (isTrackerStopped(err) || (err instanceof Error && err.name === 'AbortError')) {
          throw new TrackerStopped();
        }
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        if (timedOut) {
          throw new Error('Tracker не ответил вовремя. Повторите поиск.');
        }
        if (err instanceof Error && err.message.startsWith('Tracker API')) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === retries) throw lastError;
      } finally {
        releaseRequest(controller);
        trackRequestEnd();
      }
      await pauseableWait(400 * (attempt + 1));
    }
    throw lastError ?? new Error('Tracker API request failed');
  }

  async myself(): Promise<{ login: string; display: string; uid: number }> {
    const data = await this.request<{
      login: string;
      display: string;
      uid: number;
    }>('/v2/myself');
    return data;
  }

  async searchUsers(query: string): Promise<TrackerUser[]> {
    const q = query.trim();
    if (!q) return [];

    // Exact login lookup
    try {
      const one = await this.request<{
        uid: number;
        login: string;
        display: string;
        email?: string | null;
        dismissed?: boolean;
      }>(`/v2/users/${encodeURIComponent(q)}`);
      if (one?.login) {
        return [
          {
            uid: one.uid,
            login: one.login,
            display: one.display,
            email: one.email,
            dismissed: Boolean(one.dismissed),
          },
        ];
      }
    } catch {
      // fall through to list+filter
    }

    const collected: TrackerUser[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await this.request<
        Array<{
          uid: number;
          login: string;
          display: string;
          email?: string | null;
          dismissed?: boolean;
        }>
      >('/v2/users', { query: { perPage: 100, page } });
      if (!batch.length) break;
      collected.push(
        ...batch.map((u) => ({
          uid: u.uid,
          login: u.login,
          display: u.display,
          email: u.email,
          dismissed: Boolean(u.dismissed),
        })),
      );
      if (batch.length < 100) break;
    }

    const needle = q.toLowerCase();
    const filtered = collected.filter(
      (u) =>
        u.login?.toLowerCase().includes(needle) ||
        u.display?.toLowerCase().includes(needle) ||
        u.email?.toLowerCase().includes(needle),
    );
    const unique = new Map<number, TrackerUser>();
    for (const u of filtered) {
      if (!unique.has(u.uid)) unique.set(u.uid, u);
    }
    return [...unique.values()]
      .sort((a, b) => Number(a.dismissed) - Number(b.dismissed))
      .slice(0, 40);
  }

  async getBoard(boardId: number): Promise<TrackerBoard> {
    const board = await this.request<{
      id: number;
      name?: string;
      display?: string;
      queues?: Array<{ key?: string; display?: string }>;
    }>(`/v2/boards/${boardId}`, { retries: 1, timeoutMs: BOARD_LOOKUP_TIMEOUT_MS });
    return {
      id: board.id,
      name: board.name || board.display || `Доска ${board.id}`,
      queueKey: board.queues?.[0]?.key || null,
    };
  }

  /**
   * Boards already kept locally (selected board or previous search hits).
   * A repeat lookup must not call Tracker again: listing boards and sampling
   * a queue that is already known often 504s or never returns.
   */
  private knownBoardHits(query: string, known: TrackerBoard[] | undefined): TrackerBoard[] {
    const hits = normalizeKnownBoards(known).filter((board) => boardMatchesQuery(board, query));
    return sortBoards(hits);
  }

  /**
   * Exact board id, or exact queue key.
   * A queue or board already present in `known` is returned without calling Tracker.
   */
  async searchBoards(
    query: string,
    queue?: string,
    known?: TrackerBoard[],
  ): Promise<TrackerBoard[]> {
    const q = query.trim();
    if (!q) return [];

    const already = this.knownBoardHits(q, known);
    if (already.length) return already;

    if (/^\d+$/.test(q)) {
      return [await this.getBoard(Number(q))];
    }

    const typedQueue = (looksLikeQueueKey(q) ? q : queue?.trim() || '').trim();
    const queueKey = typedQueue.toUpperCase();
    if (!queueKey || !looksLikeQueueKey(queueKey)) return [];
    if (queueAlreadyListed(normalizeKnownBoards(known), queueKey)) {
      return this.knownBoardHits(queueKey, known);
    }

    const found = await this.queueExists(queueKey);
    if (!found) throw new Error(`Очередь ${queueKey} не найдена`);

    const byId = new Map<number, TrackerBoard>();
    await this.collectBoardsFromQueue(byId, queueKey);
    return sortBoards([...byId.values()]);
  }

  private async queueExists(queueKey: string): Promise<boolean> {
    try {
      await this.request(`/v2/queues/${encodeURIComponent(queueKey)}`, {
        retries: 0,
        timeoutMs: BOARD_LOOKUP_TIMEOUT_MS,
      });
      return true;
    } catch (err) {
      if (err instanceof Error && /\b404\b/.test(err.message)) return false;
      throw err;
    }
  }

  /**
   * Boards seen on recent issues of a queue.
   * Skips the issue sample when that queue is already present on a known board.
   */
  async listBoards(queue?: string, known?: TrackerBoard[]): Promise<TrackerBoard[]> {
    const knownBoards = normalizeKnownBoards(known);
    const queueKey = queue?.trim() || '';
    if (!queueKey) return sortBoards(knownBoards);

    const listed = knownBoards.filter(
      (board) => board.queueKey?.trim().toLowerCase() === queueKey.toLowerCase(),
    );
    if (listed.length) return sortBoards(listed);

    const byId = new Map<number, TrackerBoard>();
    try {
      await this.collectBoardsFromQueue(byId, queueKey);
    } catch {
      return [];
    }
    return sortBoards([...byId.values()]);
  }

  /**
   * One page of queue issues, used only when this queue is not already listed.
   * Boards already in `byId` are not fetched again.
   */
  private async collectBoardsFromQueue(
    byId: Map<number, TrackerBoard>,
    queueKey: string,
    nameNeedle?: string,
  ): Promise<void> {
    if (queueAlreadyListed(byId.values(), queueKey)) return;
    const safeQueue = queueKey.replace(/"/g, '');
    const issues = await this.request<
      Array<{ boards?: Array<{ id?: number; name?: string | null }> }>
    >('/v2/issues/_search', {
      method: 'POST',
      query: { page: 1, perPage: 30 },
      body: { query: `"Queue": "${safeQueue}"` },
      retries: 0,
      timeoutMs: BOARD_LOOKUP_TIMEOUT_MS,
    });
    let detailFetches = 0;
    for (const issue of issues) {
      for (const board of issue.boards || []) {
        if (!board.id) continue;
        const existing = byId.get(board.id);
        if (existing) {
          if (!existing.queueKey) existing.queueKey = queueKey;
          if (!existing.name && board.name) existing.name = board.name;
          continue;
        }
        const name = board.name?.trim() || '';
        if (nameNeedle && name && !name.toLowerCase().includes(nameNeedle)) continue;
        if (name) {
          byId.set(board.id, { id: board.id, name, queueKey });
          continue;
        }
        if (detailFetches >= 5) {
          byId.set(board.id, { id: board.id, name: `Доска ${board.id}`, queueKey });
          continue;
        }
        detailFetches += 1;
        try {
          if (byId.has(board.id)) continue;
          const full = await this.getBoard(board.id);
          if (byId.has(full.id)) {
            const prev = byId.get(full.id)!;
            if (!prev.queueKey) prev.queueKey = full.queueKey || queueKey;
            continue;
          }
          byId.set(full.id, { ...full, queueKey: full.queueKey || queueKey });
        } catch {
          if (!byId.has(board.id)) {
            byId.set(board.id, { id: board.id, name: `Доска ${board.id}`, queueKey });
          }
        }
      }
    }
    const stamped = [...byId.values()].filter((board) => board.queueKey === queueKey).slice(0, 8);
    for (const board of stamped) {
      try {
        const full = await this.getBoard(board.id);
        if (full.queueKey) {
          byId.set(board.id, {
            ...board,
            name: board.name || full.name,
            queueKey: full.queueKey,
          });
        }
      } catch {
        // Keep the queue that surfaced this board.
      }
    }
  }

  async listStatusTypes(): Promise<Record<string, string>> {
    const types = await this.loadStatusTypes();
    return Object.fromEntries(types);
  }

  private async loadStatusTypes(): Promise<Map<string, string>> {
    if (this.statusTypes) return this.statusTypes;
    const list = await this.request<Array<{ key?: string; type?: string | null }>>('/v2/statuses');
    const types = new Map<string, string>();
    for (const status of list) {
      if (status.key && status.type) types.set(status.key, status.type);
    }
    this.statusTypes = types;
    return types;
  }

  async getBoardColumns(boardId: number): Promise<TrackerBoardColumn[]> {
    const columns = await this.request<
      Array<{
        id: string | number;
        display?: string;
        name?: string;
        statuses?: Array<{ key: string; display: string }>;
      }>
    >(`/v2/boards/${boardId}/columns`);
    return columns.map((c) => ({
      id: String(c.id),
      name: c.display || c.name || String(c.id),
      statuses: (c.statuses || []).map((s) => ({
        key: s.key,
        display: s.display,
      })),
    }));
  }

  async getBoardSprints(boardId: number): Promise<TrackerSprint[]> {
    const sprints = await this.request<
      Array<{
        id: number;
        name?: string;
        display?: string;
        status?: string;
        archived?: boolean;
        startDate?: string | null;
        endDate?: string | null;
      }>
    >(`/v2/boards/${boardId}/sprints`);
    return sprints.map((s) => ({
      id: s.id,
      name: s.name || s.display || `Sprint ${s.id}`,
      status: s.status || (s.archived ? 'archived' : ''),
      archived: Boolean(s.archived || s.status === 'archived'),
      startDate: s.startDate,
      endDate: s.endDate,
    }));
  }

  async findIssues(query: string): Promise<TrackerIssue[]> {
    const issues: TrackerIssue[] = [];
    let page = 1;
    const now = Date.now();
    const statusTypes = await this.loadStatusTypes().catch(() => new Map<string, string>());
    while (page <= 50) {
      const batch = await this.request<RawTrackerIssue[]>('/v2/issues/_search', {
        method: 'POST',
        query: { page, perPage: 100 },
        body: { query },
      });
      for (const issue of batch) {
        issues.push(mapTrackerIssue(issue, now, statusTypes));
      }
      if (batch.length < 100) break;
      page += 1;
    }
    return issues;
  }

  async getIssue(issueId: string): Promise<TrackerIssue> {
    const issue = await this.request<RawTrackerIssue>(`/v2/issues/${issueId}`);
    const statusTypes = await this.loadStatusTypes().catch(() => new Map<string, string>());
    return mapTrackerIssue(issue, Date.now(), statusTypes);
  }

  async getIssueStory(issueId: string): Promise<{
    description: string;
    commentText: string;
    commentUrl: string;
    commentAuthor: string;
    commentAt: string;
  }> {
    const issue = await this.request<{ description?: string }>(`/v2/issues/${issueId}`);
    const comments = await this.listIssueComments(issueId);
    const last = newestComment(comments);
    const commentId = last?.longId || (last?.id != null ? String(last.id) : '');
    const base = `https://tracker.yandex.ru/${issueId}`;
    return {
      description: issue.description || '',
      commentText: last?.text || '',
      commentUrl: commentId ? `${base}#${commentId}` : base,
      commentAuthor: last?.createdBy?.display || '',
      commentAt: last?.createdAt || '',
    };
  }

  async listIssueComments(issueId: string): Promise<TrackerComment[]> {
    return this.paged<TrackerComment>(`/v2/issues/${encodeURIComponent(issueId)}/comments`, 20);
  }

  async getTransitions(issueId: string): Promise<
    Array<{ id: string; display: string; toKey?: string; toDisplay?: string }>
  > {
    const data = await this.request<
      Array<{
        id: string;
        display: string;
        to?: { key?: string; display?: string };
      }>
    >(`/v2/issues/${issueId}/transitions`);
    return data.map((t) => ({
      id: t.id,
      display: t.display,
      toKey: t.to?.key,
      toDisplay: t.to?.display,
    }));
  }

  async executeTransition(issueId: string, transitionId: string): Promise<void> {
    await this.request(`/v2/issues/${issueId}/transitions/${transitionId}/_execute`, {
      method: 'POST',
      body: {},
    });
  }

  async listStatusTypeMap(): Promise<Map<string, string>> {
    return this.loadStatusTypes();
  }

  async getChangelog(issueKey: string): Promise<TrackerChangelogEvent[]> {
    const events = await this.paged<TrackerChangelogEvent>(changelogPath(issueKey), 30);
    return uniqueChangelog(events);
  }

  /** Newest pages first. Stops once a page contains an event older than `sinceMs`. */
  async getChangelogSince(issueKey: string, sinceMs: number): Promise<TrackerChangelogEvent[]> {
    const path = changelogPath(issueKey);
    const meta: { totalPages?: number } = {};
    const first = await this.request<TrackerChangelogEvent[]>(path, {
      query: { perPage: 50, page: 1 },
      retries: 5,
      meta,
    });
    const page1 = first || [];
    const total = meta.totalPages && meta.totalPages > 0 ? meta.totalPages : page1.length < 50 ? 1 : 30;
    const items: TrackerChangelogEvent[] = [];
    const consume = (batch: TrackerChangelogEvent[]) => {
      items.push(...batch);
      return batch.some((event) => {
        const at = Date.parse(event.updatedAt || '');
        return Number.isFinite(at) && at < sinceMs;
      });
    };
    if (changelogOrder(page1) === 'oldest-first' && total > 1) {
      for (let page = total; page >= 1; page -= 1) {
        const batch =
          page === 1
            ? page1
            : (await this.request<TrackerChangelogEvent[]>(path, {
                query: { perPage: 50, page },
                retries: 5,
              })) || [];
        if (consume(batch)) break;
        if (page > 1) await pauseableWait(120);
      }
    } else {
      const crossed = consume(page1);
      if (!crossed && page1.length === 50) {
        for (let page = 2; page <= total; page += 1) {
          const batch =
            (await this.request<TrackerChangelogEvent[]>(path, {
              query: { perPage: 50, page },
              retries: 5,
            })) || [];
          if (consume(batch) || batch.length < 50) break;
          await pauseableWait(120);
        }
      }
    }
    return uniqueChangelog(items);
  }

  private async paged<T>(path: string, cap: number): Promise<T[]> {
    const meta: { totalPages?: number } = {};
    const first = await this.request<T[]>(path, { query: { perPage: 50, page: 1 }, retries: 5, meta });
    const items = [...(first || [])];
    const total = meta.totalPages && meta.totalPages > 0 ? meta.totalPages : first && first.length === 50 ? cap : 1;
    const pages: number[] = [];
    if (total <= cap) {
      for (let page = 2; page <= total; page += 1) pages.push(page);
    } else {
      for (let page = 2; page <= 6; page += 1) pages.push(page);
      for (let page = Math.max(7, total - (cap - 6)); page <= total; page += 1) pages.push(page);
    }
    for (const page of pages) {
      const batch = await this.request<T[]>(path, { query: { perPage: 50, page }, retries: 5 });
      items.push(...(batch || []));
      if (!batch || batch.length < 50) break;
      await pauseableWait(120);
    }
    return items;
  }
}

export type TrackerComment = {
  id?: string | number;
  longId?: string;
  text?: string;
  createdAt?: string;
  type?: string;
  createdBy?: {
    id?: string | number;
    display?: string;
    login?: string;
    passportUid?: string | number;
  };
};

function newestComment(comments: TrackerComment[]): TrackerComment | null {
  let last: TrackerComment | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const item of comments) {
    if (isReactionComment(item.text, item.type)) continue;
    const at = Date.parse(item.createdAt || '');
    if (!last || (Number.isFinite(at) && at >= lastAt)) {
      last = item;
      lastAt = Number.isFinite(at) ? at : lastAt;
    }
  }
  return last;
}

function changelogPath(issueKey: string): string {
  return `/v2/issues/${encodeURIComponent(issueKey)}/changelog`;
}

function uniqueChangelog(events: TrackerChangelogEvent[]): TrackerChangelogEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.id || ''}|${event.updatedAt || ''}|${event.type || ''}|${event.comments?.added?.length || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function changelogOrder(events: TrackerChangelogEvent[]): 'newest-first' | 'oldest-first' | 'unknown' {
  const times = events
    .map((event) => Date.parse(event.updatedAt || ''))
    .filter((value) => Number.isFinite(value));
  if (times.length < 2) return 'unknown';
  if (times[0] > times[times.length - 1]) return 'newest-first';
  if (times[0] < times[times.length - 1]) return 'oldest-first';
  return 'unknown';
}

export type TrackerChangelogEvent = {
  id?: string;
  updatedAt?: string;
  updatedBy?: {
    id?: string | number;
    display?: string;
    login?: string;
    passportUid?: string | number;
    cloudUid?: string;
  } | null;
  type?: string;
  fields?: Array<{
    field?: { id?: string; display?: string } | string;
    from?: unknown;
    to?: unknown;
  }>;
  comments?: {
    added?: Array<{
      id?: string;
      display?: string;
      createdBy?: TrackerComment['createdBy'];
    }>;
  };
};

type RawTrackerIssue = {
  key: string;
  summary: string;
  status?: { key?: string; display?: string };
  assignee?: { id?: string | number; display?: string };
  statusStartTime?: string | null;
  createdAt?: string | null;
  createdBy?: { display?: string | null } | null;
  updatedAt?: string | null;
  updatedBy?: {
    id?: string | number | null;
    display?: string | null;
    login?: string | null;
    cloudUid?: string | null;
    passportUid?: string | number | null;
  } | null;
  deadline?: string | null;
  lastCommentUpdatedAt?: string | null;
  kodRevu?: {
    id?: string | number;
    display?: string;
    login?: string;
    cloudUid?: string;
    passportUid?: string | number;
  } | null;
  qaEngineer?: {
    id?: string | number;
    display?: string;
    login?: string;
    cloudUid?: string;
    passportUid?: string | number;
  } | null;
  sprint?: Array<{ id?: string | number; display?: string }> | null;
  boards?: Array<{ id?: number | string; name?: string | null }> | null;
};

export function isReactionComment(text: string | null | undefined, type?: string | null): boolean {
  const kind = (type || '').toLowerCase();
  if (kind.includes('reaction') || kind.includes('emoji')) return true;
  const raw = (text || '').trim();
  if (!raw) return false;
  const core = raw.replace(/\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s/gu, '');
  return core.length === 0;
}

function mapTrackerIssue(
  issue: RawTrackerIssue,
  now: number,
  statusTypes?: Map<string, string>,
): TrackerIssue {
  const rawId = issue.assignee?.id != null ? String(issue.assignee.id) : null;
  const looksLikeUid = rawId != null && /^\d+$/.test(rawId);
  const statusStartTime = issue.statusStartTime || null;
  let daysInStatus: number | null = null;
  if (statusStartTime) {
    const t = Date.parse(statusStartTime);
    if (!Number.isNaN(t)) {
      daysInStatus = Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
    }
  }
  const sprint = issue.sprint?.[0];
  const sprintIdRaw = sprint?.id;
  const sprintId =
    sprintIdRaw != null && String(sprintIdRaw) !== '' ? Number(sprintIdRaw) : null;
  const boardIds = (issue.boards || [])
    .map((b) => Number(b.id))
    .filter((id) => Number.isFinite(id));
  return {
    key: issue.key,
    summary: issue.summary,
    statusKey: issue.status?.key || '',
    statusDisplay: issue.status?.display || '',
    statusType: statusTypes?.get(issue.status?.key || '') || undefined,
    assigneeLogin: looksLikeUid ? null : rawId,
    assigneeUid: looksLikeUid ? rawId : null,
    assigneeDisplay: issue.assignee?.display || null,
    url: `https://tracker.yandex.ru/${issue.key}`,
    reviewerDisplay: issue.kodRevu?.display || null,
    qaDisplay: issue.qaEngineer?.display || null,
    reviewerUid: issue.kodRevu?.id != null ? String(issue.kodRevu.id) : null,
    qaUid: issue.qaEngineer?.id != null ? String(issue.qaEngineer.id) : null,
    reviewerMatchKeys: collectPersonMatchKeys(issue.kodRevu),
    qaMatchKeys: collectPersonMatchKeys(issue.qaEngineer),
    statusStartTime,
    daysInStatus,
    createdAt: issue.createdAt || null,
    authorDisplay: issue.createdBy?.display || null,
    updatedAt: issue.updatedAt || null,
    updatedByDisplay: issue.updatedBy?.display || null,
    updatedByMatchKeys: collectPersonMatchKeys(issue.updatedBy),
    deadline: issue.deadline || null,
    lastCommentUpdatedAt: issue.lastCommentUpdatedAt || null,
    sprintId: Number.isFinite(sprintId) ? sprintId : null,
    sprintName: sprint?.display || null,
    boardIds,
  };
}

export function buildIssuesQuery(params: {
  boardId?: number | null;
  queueKey?: string | null;
  sprintIds: number[];
  logins: string[];
  /**
   * Sprint boards are matched by their sprints.
   * Boards that cannot have sprints (Tracker 400) are matched by board membership.
   */
  membership?: 'sprint' | 'board';
  /** Default true — pass false to keep issues that already have a resolution. */
  unresolvedOnly?: boolean;
  /** Match issues that are not in any sprint. */
  emptySprint?: boolean;
}): string {
  const parts: string[] = [];
  const queueKey = (params.queueKey || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (queueKey) parts.push(`Queue: ${queueKey}`);
  if (params.boardId != null) {
    if (params.membership === 'board') parts.push(`Boards: ${params.boardId}`);
    else parts.push(`"Sprints By Board": ${params.boardId}`);
  }
  if (params.emptySprint) parts.push('"Sprint": empty()');
  else if (params.sprintIds.length) {
    parts.push(`"Sprint": ${params.sprintIds.join(',')}`);
  }
  if (params.logins.length) {
    const assignees = params.logins.map((l) => `"${l}"`).join(',');
    parts.push(`"Assignee": ${assignees}`);
  }
  if (params.unresolvedOnly !== false) {
    parts.push('"Resolution": unresolved()');
  }
  return parts.join(' AND ');
}

function safePath(url: URL): string {
  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (/token|password|secret|authorization|oauth|key/i.test(key)) params.set(key, '•••');
  }
  const search = params.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function safeDetail(body: unknown): string {
  if (!body || typeof body !== 'object' || !('query' in body)) return '';
  const query = (body as { query?: unknown }).query;
  if (typeof query !== 'string') return '';
  return query.replace(/oauth|token|password|secret/gi, '•••').slice(0, 220);
}
