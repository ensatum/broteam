import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  BoardColumnConfig,
  BoardConfig,
  Developer,
  ParticipantRole,
  SavedBoard,
  GithubSource,
  TrackerConnection,
} from '../shared/types';
import { DEFAULT_BOARD, DEFAULT_CONNECTION, DEFAULT_GITHUB, normalizeParticipantRole } from '../shared/types';
import { normalizeColumnDuty } from '../shared/columnMeta';
import { liveVersion, settingsIncompatible } from '../shared/version';

let db: Database.Database | null = null;

export function initDb(userDataPath: string, bakedVersion = ''): Database.Database {
  const dir = path.join(userDataPath, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const versionFile = path.join(dir, 'app-version');
  const stored = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';
  if (settingsIncompatible(stored)) {
    for (const name of ['standup.sqlite', 'standup.sqlite-wal', 'standup.sqlite-shm']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) fs.rmSync(file);
    }
  }
  const dbPath = path.join(dir, 'standup.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  if (bakedVersion) fs.writeFileSync(versionFile, liveVersion(bakedVersion).full);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database is not initialized');
  return db;
}

function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS developers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      uid TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS board_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      column_id TEXT NOT NULL,
      column_name TEXT NOT NULL,
      status_key TEXT NOT NULL,
      status_display TEXT NOT NULL,
      alias TEXT NOT NULL,
      color TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(status_key)
    );

    CREATE TABLE IF NOT EXISTS issue_notes (
      issue_key TEXT PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS developer_notes (
      developer_id INTEGER PRIMARY KEY,
      note TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(developer_id) REFERENCES developers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS issue_bookmarks (
      issue_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS developer_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      developer_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(developer_id) REFERENCES developers(id) ON DELETE CASCADE
    );
  `);

  // Existing installs may miss updated_at / created_at on issue_notes
  const cols = database.prepare(`PRAGMA table_info(issue_notes)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'updated_at')) {
    database.exec(`ALTER TABLE issue_notes ADD COLUMN updated_at TEXT`);
  }
  if (!cols.some((c) => c.name === 'created_at')) {
    database.exec(`ALTER TABLE issue_notes ADD COLUMN created_at TEXT`);
  }
  const draftCols = database.prepare(`PRAGMA table_info(drafts)`).all() as Array<{ name: string }>;
  if (!draftCols.some((column) => column.name === 'people_ids')) {
    database.exec(`ALTER TABLE drafts ADD COLUMN people_ids TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!draftCols.some((column) => column.name === 'favorite')) {
    database.exec(`ALTER TABLE drafts ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`);
  }
  if (!draftCols.some((column) => column.name === 'note')) {
    database.exec(`ALTER TABLE drafts ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
  }
  if (!draftCols.some((column) => column.name === 'done')) {
    database.exec(`ALTER TABLE drafts ADD COLUMN done INTEGER NOT NULL DEFAULT 0`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS issue_changes (
      issue_key TEXT NOT NULL,
      board_local_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      at TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (issue_key, board_local_id)
    );
    CREATE TABLE IF NOT EXISTS summary_notes (
      board_local_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (board_local_id, participant_id)
    );
    CREATE TABLE IF NOT EXISTS summary_issue_notes (
      board_local_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      issue_key TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (board_local_id, participant_id, issue_key)
    );
    CREATE TABLE IF NOT EXISTS summary_source (
      board_local_id INTEGER PRIMARY KEY,
      formed_at TEXT NOT NULL,
      from_iso TEXT NOT NULL,
      to_iso TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS summary_cache (
      board_local_id INTEGER NOT NULL,
      participant_id INTEGER NOT NULL,
      formed_at TEXT NOT NULL,
      from_iso TEXT NOT NULL,
      to_iso TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      PRIMARY KEY (board_local_id, participant_id)
    );
  `);

  // Migrate legacy free-text developer_notes → developer_todos (once)
  migrateDeveloperNotesToTodos(database);
  migratePeopleAndBoards(database);
}

function migratePeopleAndBoards(database: Database.Database): void {
  const devCols = database.prepare(`PRAGMA table_info(developers)`).all() as Array<{ name: string }>;
  if (!devCols.some((c) => c.name === 'role')) {
    database.exec(`ALTER TABLE developers ADD COLUMN role TEXT NOT NULL DEFAULT 'developer'`);
  }
  if (!devCols.some((c) => c.name === 'on_vacation')) {
    database.exec(`ALTER TABLE developers ADD COLUMN on_vacation INTEGER NOT NULL DEFAULT 0`);
  }
  if (!devCols.some((c) => c.name === 'hidden')) {
    database.exec(`ALTER TABLE developers ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
  }
  if (!devCols.some((c) => c.name === 'summary')) {
    database.exec(`ALTER TABLE developers ADD COLUMN summary INTEGER NOT NULL DEFAULT 0`);
    database.exec(`UPDATE developers SET summary = 1 WHERE role IN ('developer', 'qa')`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS agile_boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracker_board_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      queue_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS issue_note_links (
      issue_key TEXT NOT NULL,
      participant_id INTEGER NOT NULL,
      PRIMARY KEY (issue_key, participant_id)
    );
  `);

  const colInfo = database.prepare(`PRAGMA table_info(board_columns)`).all() as Array<{ name: string }>;
  if (!colInfo.some((c) => c.name === 'board_local_id')) {
    database.exec(`
      CREATE TABLE board_columns_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_local_id INTEGER NOT NULL DEFAULT 0,
        column_id TEXT NOT NULL,
        column_name TEXT NOT NULL,
        status_key TEXT NOT NULL,
        status_display TEXT NOT NULL,
        alias TEXT NOT NULL,
        color TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(board_local_id, status_key)
      );
      INSERT INTO board_columns_v2 (
        id, board_local_id, column_id, column_name, status_key, status_display, alias, color, enabled, sort_order
      )
      SELECT id, 0, column_id, column_name, status_key, status_display, alias, color, enabled, sort_order
      FROM board_columns;
      DROP TABLE board_columns;
      ALTER TABLE board_columns_v2 RENAME TO board_columns;
    `);
  }

  const dutyCols = database.prepare(`PRAGMA table_info(board_columns)`).all() as Array<{ name: string }>;
  if (!dutyCols.some((column) => column.name === 'duty')) {
    database.exec(`ALTER TABLE board_columns ADD COLUMN duty TEXT NOT NULL DEFAULT ''`);
  }

  const boardCols = database.prepare(`PRAGMA table_info(agile_boards)`).all() as Array<{ name: string }>;
  if (!boardCols.some((column) => column.name === 'alias')) {
    database.exec(`ALTER TABLE agile_boards ADD COLUMN alias TEXT NOT NULL DEFAULT ''`);
  }
  if (!boardCols.some((column) => column.name === 'color')) {
    database.exec(`ALTER TABLE agile_boards ADD COLUMN color TEXT NOT NULL DEFAULT ''`);
  }

  const boardCount = database.prepare(`SELECT COUNT(*) as c FROM agile_boards`).get() as { c: number };
  if (boardCount.c > 0) return;
  const raw = database.prepare(`SELECT value FROM settings WHERE key = 'board'`).get() as
    | { value: string }
    | undefined;
  if (!raw?.value) return;
  let parsed: BoardConfig;
  try {
    parsed = { ...DEFAULT_BOARD, ...JSON.parse(raw.value) };
  } catch {
    return;
  }
  if (parsed.boardId == null) return;
  const inserted = database
    .prepare(
      `INSERT INTO agile_boards(tracker_board_id, name, queue_key, enabled, sort_order)
       VALUES(?, ?, ?, 1, 0)`,
    )
    .run(parsed.boardId, parsed.boardName || `Доска ${parsed.boardId}`, parsed.queueKey || '');
  const localId = Number(inserted.lastInsertRowid);
  database.prepare(`UPDATE board_columns SET board_local_id = ? WHERE board_local_id = 0`).run(localId);
  database
    .prepare(
      `INSERT INTO settings(key, value) VALUES('activeBoardLocalId', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(localId));
}

function migrateDeveloperNotesToTodos(database: Database.Database): void {
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='developer_notes'`)
    .get() as { name: string } | undefined;
  if (!tables) return;
  const flag = database.prepare(`SELECT value FROM settings WHERE key = ?`).get(
    'migrated_developer_todos_v1',
  ) as { value: string } | undefined;
  if (flag?.value === '1') return;

  const notes = database
    .prepare(`SELECT developer_id, note FROM developer_notes`)
    .all() as Array<{ developer_id: number; note: string }>;
  const insert = database.prepare(
    `INSERT INTO developer_todos(developer_id, title, body, created_at, updated_at)
     VALUES(?, '', ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const tx = database.transaction(() => {
    for (const n of notes) {
      if (!n.note?.trim()) continue;
      const existing = database
        .prepare(`SELECT COUNT(*) as c FROM developer_todos WHERE developer_id = ?`)
        .get(n.developer_id) as { c: number };
      if (existing.c > 0) continue;
      insert.run(n.developer_id, n.note.trim(), now, now);
    }
    database
      .prepare(
        `INSERT INTO settings(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run('migrated_developer_todos_v1', '1');
  });
  tx();
}

function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export type BoardRowPrefs = Record<string, { hidden: number[]; shown: number[] }>;

function normalizeBoardRowPrefs(value: unknown): BoardRowPrefs {
  if (!value || typeof value !== 'object') return {};
  const out: BoardRowPrefs = {};
  for (const [key, slot] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !slot || typeof slot !== 'object') continue;
    const row = slot as { hidden?: unknown; shown?: unknown };
    const ids = (list: unknown) =>
      Array.isArray(list) ? [...new Set(list.map(Number).filter((id) => Number.isInteger(id)))] : [];
    out[key] = { hidden: ids(row.hidden), shown: ids(row.shown) };
  }
  return out;
}

export function readBoardRowPrefs(): BoardRowPrefs {
  const raw = getSetting('boardRows');
  if (!raw) return {};
  try {
    return normalizeBoardRowPrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeBoardRowPrefs(prefs: unknown): BoardRowPrefs {
  const next = normalizeBoardRowPrefs(prefs);
  setSetting('boardRows', JSON.stringify(next));
  return next;
}

export type RightTool = 'summary' | 'drafts' | 'off';

export function readRightTool(): RightTool | null {
  const raw = getSetting('rightTool');
  if (raw === 'summary' || raw === 'drafts' || raw === 'off') return raw;
  return null;
}

export function writeRightTool(tool: unknown): RightTool {
  const next: RightTool = tool === 'summary' || tool === 'drafts' || tool === 'off' ? tool : 'off';
  setSetting('rightTool', next);
  return next;
}

export function readCloseToTray(): boolean {
  return getSetting('closeToTray') === '1';
}

export function writeCloseToTray(value: boolean): boolean {
  setSetting('closeToTray', value ? '1' : '0');
  return value;
}

export function readApiDayCount(): { date: string; total: number } {
  const raw = getSetting('apiDayCount');
  if (!raw) return { date: '', total: 0 };
  try {
    const parsed = JSON.parse(raw) as { date?: string; total?: number };
    return { date: parsed.date || '', total: Number(parsed.total) || 0 };
  } catch {
    return { date: '', total: 0 };
  }
}

export function writeApiDayCount(date: string, total: number): void {
  setSetting('apiDayCount', JSON.stringify({ date, total }));
}

export function settingsPayloadBytes(): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS bytes FROM settings`)
    .get() as { bytes: number };
  return row?.bytes || 0;
}

export function getConnection(): TrackerConnection {
  const raw = getSetting('connection');
  if (!raw) return { ...DEFAULT_CONNECTION };
  return { ...DEFAULT_CONNECTION, ...JSON.parse(raw) };
}

export function saveConnection(connection: TrackerConnection): void {
  setSetting('connection', JSON.stringify(connection));
}

export function getGithub(): GithubSource {
  const raw = getSetting('github');
  if (!raw) return { ...DEFAULT_GITHUB };
  return { ...DEFAULT_GITHUB, ...JSON.parse(raw) };
}

export function saveGithub(source: GithubSource): void {
  setSetting('github', JSON.stringify(source));
}

export function getBoardConfig(): BoardConfig {
  const raw = getSetting('board');
  const parsed: BoardConfig = raw ? { ...DEFAULT_BOARD, ...JSON.parse(raw) } : { ...DEFAULT_BOARD };
  const activeId = getActiveBoardLocalId();
  const active = listSavedBoards().find((b) => b.id === activeId);
  if (!active) return parsed;
  return {
    ...parsed,
    boardId: active.trackerBoardId,
    boardName: active.name,
    queueKey: active.queueKey,
  };
}

export function saveBoardConfig(board: BoardConfig): void {
  setSetting('board', JSON.stringify(board));
}

function mapDeveloper(row: {
  id: number;
  login: string;
  displayName: string;
  uid: string;
  color: string;
  sortOrder: number;
  role?: string;
  onVacation?: number;
  hidden?: number;
  summary?: number;
}): Developer {
  const role = normalizeParticipantRole(row.role);
  return {
    id: row.id,
    login: row.login,
    displayName: row.displayName,
    uid: row.uid,
    color: row.color,
    sortOrder: row.sortOrder,
    role,
    onVacation: Boolean(row.onVacation),
    hidden: Boolean(row.hidden),
    summary: row.summary == null ? role === 'developer' || role === 'qa' : Boolean(row.summary),
  };
}

export function listDevelopers(): Developer[] {
  const rows = getDb()
    .prepare(
      `SELECT id, login, display_name as displayName, uid, color, sort_order as sortOrder,
              role, on_vacation as onVacation, hidden, summary
       FROM developers ORDER BY sort_order ASC, id ASC`,
    )
    .all() as Array<{
    id: number;
    login: string;
    displayName: string;
    uid: string;
    color: string;
    sortOrder: number;
    role: string;
    onVacation: number;
    hidden: number;
    summary: number;
  }>;
  return rows.map(mapDeveloper);
}

export function replaceDevelopers(
  developers: Array<Omit<Developer, 'id'> & { id?: number }>,
): Developer[] {
  const database = getDb();
  const tx = database.transaction(() => {
    const existing = database.prepare(`SELECT id, login FROM developers`).all() as Array<{
      id: number;
      login: string;
    }>;
    const byLogin = new Map(existing.map((row) => [row.login.toLowerCase(), row.id]));
    const byId = new Set(existing.map((row) => row.id));
    // Park current logins first. An old install already has these people under
    // different ids, and renaming one row onto another's login trips UNIQUE.
    const park = database.prepare(`UPDATE developers SET login = ? WHERE id = ?`);
    for (const row of existing) park.run(`\u0000${row.id}`, row.id);
    const keep = new Set<number>();
    const update = database.prepare(
      `UPDATE developers
       SET login = ?, display_name = ?, uid = ?, color = ?, sort_order = ?, role = ?, on_vacation = ?, hidden = ?, summary = ?
       WHERE id = ?`,
    );
    const insert = database.prepare(
      `INSERT INTO developers(login, display_name, uid, color, sort_order, role, on_vacation, hidden, summary)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, d] of developers.entries()) {
      const role: ParticipantRole = normalizeParticipantRole(d.role);
      const vacation = d.onVacation ? 1 : 0;
      const hidden = d.hidden ? 1 : 0;
      const summary = d.summary == null ? (role === 'developer' || role === 'qa' ? 1 : 0) : d.summary ? 1 : 0;
      const order = d.sortOrder ?? index;
      const loginId = byLogin.get(d.login.toLowerCase());
      const id = loginId ?? (d.id && byId.has(d.id) ? d.id : null);
      if (id != null) {
        update.run(d.login, d.displayName, d.uid, d.color, order, role, vacation, hidden, summary, id);
        keep.add(id);
      } else {
        const info = insert.run(d.login, d.displayName, d.uid, d.color, order, role, vacation, hidden, summary);
        keep.add(Number(info.lastInsertRowid));
      }
    }
    const remove = database.prepare(`DELETE FROM developers WHERE id = ?`);
    for (const row of existing) {
      if (!keep.has(row.id)) remove.run(row.id);
    }
  });
  tx();
  return listDevelopers();
}

/** Insert assignees that are not already participants. Existing rows stay as they are. */
export function ensureAssigneeDevelopers(
  people: Array<{ login: string; displayName: string; uid: string }>,
): Developer[] {
  const incoming = people.filter((person) => person.login.trim() || person.uid.trim());
  if (!incoming.length) return listDevelopers();
  const database = getDb();
  const tx = database.transaction(() => {
    const existing = database.prepare(`SELECT login, uid FROM developers`).all() as Array<{
      login: string;
      uid: string;
    }>;
    const byLogin = new Set(existing.map((row) => row.login.toLowerCase()));
    const byUid = new Set(existing.map((row) => row.uid).filter(Boolean));
    const nextOrder = database.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS n FROM developers`).get() as {
      n: number;
    };
    const insert = database.prepare(
      `INSERT INTO developers(login, display_name, uid, color, sort_order, role, on_vacation, hidden, summary)
       VALUES(?, ?, ?, 'auto', ?, 'developer', 0, 0, 1)`,
    );
    let order = nextOrder.n + 1;
    for (const person of incoming) {
      const login = person.login.trim();
      const uid = person.uid.trim();
      if (
        (login && byLogin.has(login.toLowerCase())) ||
        (uid && byUid.has(uid)) ||
        (login && byUid.has(login))
      ) {
        continue;
      }
      const storedLogin = login || `uid-${uid}`;
      if (byLogin.has(storedLogin.toLowerCase())) continue;
      insert.run(storedLogin, person.displayName.trim() || storedLogin, uid, order);
      byLogin.add(storedLogin.toLowerCase());
      if (uid) byUid.add(uid);
      order += 1;
    }
  });
  tx();
  return listDevelopers();
}

export function listSavedBoards(): SavedBoard[] {
  const rows = getDb()
    .prepare(
      `SELECT id, tracker_board_id as trackerBoardId, name, alias, color, queue_key as queueKey,
              enabled, sort_order as sortOrder
       FROM agile_boards ORDER BY sort_order ASC, id ASC`,
    )
    .all() as Array<{
    id: number;
    trackerBoardId: number;
    name: string;
    alias: string | null;
    color: string | null;
    queueKey: string;
    enabled: number;
    sortOrder: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    trackerBoardId: row.trackerBoardId,
    name: row.name,
    alias: row.alias || '',
    color: row.color || '',
    queueKey: row.queueKey,
    enabled: Boolean(row.enabled),
    sortOrder: row.sortOrder,
  }));
}

export function replaceSavedBoards(boards: Array<Omit<SavedBoard, 'id'> & { id?: number }>): SavedBoard[] {
  const database = getDb();
  const tx = database.transaction(() => {
    const keep = new Set<number>();
    const update = database.prepare(
      `UPDATE agile_boards
       SET tracker_board_id = ?, name = ?, alias = ?, color = ?, queue_key = ?, enabled = ?, sort_order = ?
       WHERE id = ?`,
    );
    const insert = database.prepare(
      `INSERT INTO agile_boards(tracker_board_id, name, alias, color, queue_key, enabled, sort_order)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, board] of boards.entries()) {
      const order = board.sortOrder ?? index;
      const enabled = board.enabled ? 1 : 0;
      const alias = board.alias || '';
      const color = board.color || '';
      if (board.id && database.prepare(`SELECT id FROM agile_boards WHERE id = ?`).get(board.id)) {
        update.run(board.trackerBoardId, board.name, alias, color, board.queueKey, enabled, order, board.id);
        keep.add(board.id);
      } else {
        const info = insert.run(board.trackerBoardId, board.name, alias, color, board.queueKey, enabled, order);
        keep.add(Number(info.lastInsertRowid));
      }
    }
    const existing = database.prepare(`SELECT id FROM agile_boards`).all() as Array<{ id: number }>;
    const removeBoard = database.prepare(`DELETE FROM agile_boards WHERE id = ?`);
    const removeCols = database.prepare(`DELETE FROM board_columns WHERE board_local_id = ?`);
    for (const row of existing) {
      if (keep.has(row.id)) continue;
      removeCols.run(row.id);
      removeBoard.run(row.id);
    }
  });
  tx();
  return listSavedBoards();
}

export function getActiveBoardLocalId(): number | null {
  const raw = getSetting('activeBoardLocalId');
  const id = raw ? Number(raw) : NaN;
  const boards = listSavedBoards().filter((b) => b.enabled);
  if (Number.isFinite(id) && boards.some((b) => b.id === id)) return id;
  return boards[0]?.id ?? listSavedBoards()[0]?.id ?? null;
}

export function setActiveBoardLocalId(id: number): void {
  setSetting('activeBoardLocalId', String(id));
}

/** Replace the board list with the exported rows, keeping their local ids. */
export function importSavedBoards(boards: SavedBoard[], activeLocalId: number | null): SavedBoard[] {
  const database = getDb();
  const tx = database.transaction(() => {
    database.prepare('DELETE FROM agile_boards').run();
    const insert = database.prepare(
      `INSERT INTO agile_boards(id, tracker_board_id, name, alias, color, queue_key, enabled, sort_order)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, board] of boards.entries()) {
      insert.run(
        board.id,
        board.trackerBoardId,
        board.name,
        board.alias || '',
        board.color || '',
        board.queueKey || '',
        board.enabled ? 1 : 0,
        board.sortOrder ?? index,
      );
    }
    const ids = new Set(boards.map((board) => board.id));
    const active =
      activeLocalId != null && ids.has(activeLocalId)
        ? activeLocalId
        : (boards.find((board) => board.enabled)?.id ?? boards[0]?.id ?? null);
    if (active != null) setActiveBoardLocalId(active);
    else database.prepare(`DELETE FROM settings WHERE key = 'activeBoardLocalId'`).run();
  });
  tx();
  return listSavedBoards();
}

export function clearCachedMatrices(): void {
  getDb().prepare(`DELETE FROM settings WHERE key IN ('lastMatrix', 'lastMatrices')`).run();
}

export function listIssueNoteLinks(): Record<string, number[]> {
  const rows = getDb()
    .prepare(`SELECT issue_key, participant_id FROM issue_note_links`)
    .all() as Array<{ issue_key: string; participant_id: number }>;
  const out: Record<string, number[]> = {};
  for (const row of rows) {
    if (!out[row.issue_key]) out[row.issue_key] = [];
    out[row.issue_key].push(row.participant_id);
  }
  return out;
}

export function setIssueNoteLinks(issueKey: string, participantIds: number[]): number[] {
  const database = getDb();
  const unique = [...new Set(participantIds)];
  const tx = database.transaction(() => {
    database.prepare(`DELETE FROM issue_note_links WHERE issue_key = ?`).run(issueKey);
    const insert = database.prepare(
      `INSERT INTO issue_note_links(issue_key, participant_id) VALUES(?, ?)`,
    );
    for (const id of unique) insert.run(issueKey, id);
  });
  tx();
  return unique;
}

export function listColumns(): BoardColumnConfig[] {
  return getDb()
    .prepare(
      `SELECT id, column_id as columnId, column_name as columnName,
              status_key as statusKey, status_display as statusDisplay,
              alias, color, enabled, sort_order as sortOrder,
              board_local_id as boardLocalId, duty
       FROM board_columns ORDER BY sort_order ASC, id ASC`,
    )
    .all()
    .map((row) => {
      const raw = row as Omit<BoardColumnConfig, 'enabled' | 'duty'> & { enabled: number; duty: string | null };
      const duty = normalizeColumnDuty(raw.duty);
      return { ...raw, duty, enabled: Boolean(raw.enabled), boardLocalId: raw.boardLocalId || 0 };
    });
}

export function replaceColumns(
  columns: Array<Omit<BoardColumnConfig, 'id'> & { id?: number }>,
): BoardColumnConfig[] {
  const database = getDb();
  const tx = database.transaction(() => {
    database.prepare('DELETE FROM board_columns').run();
    const insert = database.prepare(
      `INSERT INTO board_columns(
         column_id, column_name, status_key, status_display, alias, color, enabled, sort_order, board_local_id, duty
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, c] of columns.entries()) {
      const duty = normalizeColumnDuty(c.duty);
      insert.run(
        c.columnId,
        c.columnName,
        c.statusKey,
        c.statusDisplay,
        c.alias,
        c.color,
        c.enabled ? 1 : 0,
        c.sortOrder ?? index,
        c.boardLocalId || 0,
        duty,
      );
    }
  });
  tx();
  return listColumns();
}

export function getIssueNotes(): Record<string, string> {
  const rows = getDb().prepare('SELECT issue_key, note FROM issue_notes').all() as Array<{
    issue_key: string;
    note: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.issue_key, r.note]));
}

export function listIssueNotes(): Array<{
  issueKey: string;
  note: string;
  updatedAt: string | null;
}> {
  const rows = getDb()
    .prepare('SELECT issue_key, note, updated_at FROM issue_notes ORDER BY updated_at DESC, issue_key ASC')
    .all() as Array<{ issue_key: string; note: string; updated_at: string | null }>;
  return rows
    .filter((r) => r.note.trim())
    .map((r) => ({
      issueKey: r.issue_key,
      note: r.note,
      updatedAt: r.updated_at,
    }));
}

export function getIssueNoteUpdatedAt(): Record<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT issue_key,
              COALESCE(updated_at, created_at) as note_at
       FROM issue_notes
       WHERE COALESCE(updated_at, created_at) IS NOT NULL`,
    )
    .all() as Array<{ issue_key: string; note_at: string }>;
  return Object.fromEntries(rows.map((r) => [r.issue_key, r.note_at]));
}

export function setIssueNote(issueKey: string, note: string): string {
  const updatedAt = new Date().toISOString();
  const trimmed = note.trim();
  if (!trimmed) {
    getDb().prepare('DELETE FROM issue_notes WHERE issue_key = ?').run(issueKey);
    return updatedAt;
  }
  getDb()
    .prepare(
      `INSERT INTO issue_notes(issue_key, note, created_at, updated_at) VALUES(?, ?, ?, ?)
       ON CONFLICT(issue_key) DO UPDATE SET
         note = excluded.note,
         updated_at = excluded.updated_at,
         created_at = COALESCE(issue_notes.created_at, excluded.created_at)`,
    )
    .run(issueKey, note, updatedAt, updatedAt);
  return updatedAt;
}

export function getIssueBookmarks(): Record<string, boolean> {
  const rows = getDb()
    .prepare('SELECT issue_key FROM issue_bookmarks')
    .all() as Array<{ issue_key: string }>;
  return Object.fromEntries(rows.map((r) => [r.issue_key, true]));
}

export function getIssueBookmarkCreatedAt(): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT issue_key, created_at FROM issue_bookmarks')
    .all() as Array<{ issue_key: string; created_at: string }>;
  return Object.fromEntries(rows.map((r) => [r.issue_key, r.created_at]));
}

/** Toggle bookmark; returns new active state. */
export function toggleIssueBookmark(issueKey: string): boolean {
  const db = getDb();
  const existing = db
    .prepare('SELECT 1 FROM issue_bookmarks WHERE issue_key = ?')
    .get(issueKey);
  if (existing) {
    db.prepare('DELETE FROM issue_bookmarks WHERE issue_key = ?').run(issueKey);
    return false;
  }
  db.prepare('INSERT INTO issue_bookmarks(issue_key, created_at) VALUES(?, ?)').run(
    issueKey,
    new Date().toISOString(),
  );
  return true;
}

export function setIssueBookmark(issueKey: string, active: boolean): boolean {
  const db = getDb();
  if (!active) {
    db.prepare('DELETE FROM issue_bookmarks WHERE issue_key = ?').run(issueKey);
    return false;
  }
  db.prepare(
    `INSERT INTO issue_bookmarks(issue_key, created_at) VALUES(?, ?)
     ON CONFLICT(issue_key) DO NOTHING`,
  ).run(issueKey, new Date().toISOString());
  return true;
}

export function getDeveloperNotes(): Record<number, string> {
  const rows = getDb()
    .prepare('SELECT developer_id, note FROM developer_notes')
    .all() as Array<{ developer_id: number; note: string }>;
  return Object.fromEntries(rows.map((r) => [r.developer_id, r.note]));
}

export function setDeveloperNote(developerId: number, note: string): void {
  getDb()
    .prepare(
      `INSERT INTO developer_notes(developer_id, note) VALUES(?, ?)
       ON CONFLICT(developer_id) DO UPDATE SET note = excluded.note`,
    )
    .run(developerId, note);
}

export type DeveloperTodoRow = {
  id: number;
  developerId: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

function mapTodoRow(row: {
  id: number;
  developer_id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}): DeveloperTodoRow {
  return {
    id: row.id,
    developerId: row.developer_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDeveloperTodos(developerId?: number): DeveloperTodoRow[] {
  const sql =
    developerId != null
      ? `SELECT id, developer_id, title, body, created_at, updated_at
         FROM developer_todos WHERE developer_id = ?
         ORDER BY updated_at DESC, id DESC`
      : `SELECT id, developer_id, title, body, created_at, updated_at
         FROM developer_todos ORDER BY updated_at DESC, id DESC`;
  const rows =
    developerId != null
      ? (getDb().prepare(sql).all(developerId) as Array<{
          id: number;
          developer_id: number;
          title: string;
          body: string;
          created_at: string;
          updated_at: string;
        }>)
      : (getDb().prepare(sql).all() as Array<{
          id: number;
          developer_id: number;
          title: string;
          body: string;
          created_at: string;
          updated_at: string;
        }>);
  return rows.map(mapTodoRow);
}

export function getDeveloperTodosByDeveloper(): Record<number, DeveloperTodoRow[]> {
  const map: Record<number, DeveloperTodoRow[]> = {};
  for (const t of listDeveloperTodos()) {
    if (!map[t.developerId]) map[t.developerId] = [];
    map[t.developerId].push(t);
  }
  return map;
}

export function createDeveloperTodo(
  developerId: number,
  title: string,
  body: string,
): DeveloperTodoRow {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO developer_todos(developer_id, title, body, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
    )
    .run(developerId, title.trim(), body.trim(), now, now);
  const row = getDb()
    .prepare(
      `SELECT id, developer_id, title, body, created_at, updated_at FROM developer_todos WHERE id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as {
    id: number;
    developer_id: number;
    title: string;
    body: string;
    created_at: string;
    updated_at: string;
  };
  return mapTodoRow(row);
}

export function updateDeveloperTodo(
  id: number,
  patch: { title?: string; body?: string; developerId?: number },
): DeveloperTodoRow | null {
  const existing = getDb()
    .prepare(
      `SELECT id, developer_id, title, body, created_at, updated_at FROM developer_todos WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        developer_id: number;
        title: string;
        body: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!existing) return null;
  const now = new Date().toISOString();
  const title = patch.title != null ? patch.title.trim() : existing.title;
  const body = patch.body != null ? patch.body.trim() : existing.body;
  const developerId = patch.developerId != null ? patch.developerId : existing.developer_id;
  getDb()
    .prepare(
      `UPDATE developer_todos SET developer_id = ?, title = ?, body = ?, updated_at = ? WHERE id = ?`,
    )
    .run(developerId, title, body, now, id);
  return mapTodoRow({
    ...existing,
    developer_id: developerId,
    title,
    body,
    updated_at: now,
  });
}

export function deleteDeveloperTodo(id: number): boolean {
  const info = getDb().prepare('DELETE FROM developer_todos WHERE id = ?').run(id);
  return info.changes > 0;
}

/** Move draft → developer todo, then delete draft. */
export function assignDraftToDeveloper(draftId: number, developerId: number): DeveloperTodoRow {
  const draft = getDb()
    .prepare(`SELECT id, title, body FROM drafts WHERE id = ?`)
    .get(draftId) as { id: number; title: string; body: string } | undefined;
  if (!draft) throw new Error('Заметка не найдена');
  const todo = createDeveloperTodo(developerId, draft.title, draft.body);
  getDb().prepare('DELETE FROM drafts WHERE id = ?').run(draftId);
  return todo;
}

export function listSnapshots(): Array<{ id: number; date: string; createdAt: string }> {
  return getDb()
    .prepare(
      `SELECT id, date, created_at as createdAt FROM snapshots ORDER BY date DESC, id DESC`,
    )
    .all() as Array<{ id: number; date: string; createdAt: string }>;
}

export function getSnapshotByDate(date: string): { id: number; date: string; createdAt: string; payload: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, date, created_at as createdAt, payload FROM snapshots WHERE date = ?`,
    )
    .get(date) as
    | { id: number; date: string; createdAt: string; payload: string }
    | undefined;
  return row ?? null;
}

export function getSnapshotById(id: number): { id: number; date: string; createdAt: string; payload: string } | null {
  const row = getDb()
    .prepare(
      `SELECT id, date, created_at as createdAt, payload FROM snapshots WHERE id = ?`,
    )
    .get(id) as
    | { id: number; date: string; createdAt: string; payload: string }
    | undefined;
  return row ?? null;
}

export function upsertSnapshot(date: string, payload: unknown): { id: number; date: string; createdAt: string } {
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO snapshots(date, payload, created_at) VALUES(?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
    )
    .run(date, JSON.stringify(payload), createdAt);
  const row = getSnapshotByDate(date)!;
  return { id: row.id, date: row.date, createdAt: row.createdAt };
}

export function deleteSnapshot(id: number): void {
  getDb().prepare('DELETE FROM snapshots WHERE id = ?').run(id);
}

function readMatrixMap(): Record<string, unknown> {
  const raw = getSetting('lastMatrices');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLastMatrix(matrix: unknown): void {
  const activeId = getActiveBoardLocalId();
  let stored = matrix;
  let slot = activeId;
  if (matrix && typeof matrix === 'object') {
    const row = matrix as { sourceBoardLocalId?: number | null };
    if (row.sourceBoardLocalId != null) slot = row.sourceBoardLocalId;
    else if (activeId != null) stored = { ...row, sourceBoardLocalId: activeId };
  }
  if (slot != null && slot === activeId) setSetting('lastMatrix', JSON.stringify(stored));
  if (slot == null) {
    setSetting('lastMatrix', JSON.stringify(stored));
    return;
  }
  const all = readMatrixMap();
  all[String(slot)] = stored;
  setSetting('lastMatrices', JSON.stringify(all));
}

export function listCachedMatrices(): Record<string, unknown> {
  return readMatrixMap();
}

export function getLastMatrix<T = unknown>(boardLocalId?: number | null): T | null {
  const id = boardLocalId ?? getActiveBoardLocalId();
  const all = readMatrixMap();
  if (id != null) {
    const cached = all[String(id)];
    if (cached && typeof cached === 'object') {
      const source = (cached as { sourceBoardLocalId?: number | null }).sourceBoardLocalId;
      if (source == null || source === id) return cached as T;
    } else if (cached) {
      return cached as T;
    }
    if (Object.keys(all).length === 0) {
      const legacy = readLegacyMatrix<T>();
      if (!legacy || typeof legacy !== 'object') return null;
      const source = (legacy as { sourceBoardLocalId?: number | null }).sourceBoardLocalId;
      const enabled = listSavedBoards().filter((board) => board.enabled);
      // A build that stored one board left a single cache with no owner.
      // Keep it for that one board. Do not hand it to every board added later.
      if (source != null && source !== id) return null;
      if (source == null && enabled.length !== 1) return null;
      const stamped = { ...(legacy as object), sourceBoardLocalId: id };
      all[String(id)] = stamped;
      setSetting('lastMatrices', JSON.stringify(all));
      return stamped as T;
    }
    return null;
  }
  return readLegacyMatrix<T>();
}

function readLegacyMatrix<T>(): T | null {
  const raw = getSetting('lastMatrix');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type DraftRow = {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  peopleIds: number[];
  favorite: boolean;
  note: string;
  done: boolean;
};

function parsePeopleIds(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((id) => Number.isInteger(id));
  } catch {
    return [];
  }
}

function mapDraft(row: {
  id: number;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  peopleIds: string | null;
  favorite: number;
  note: string | null;
  done: number;
}): DraftRow {
  return {
    ...row,
    peopleIds: parsePeopleIds(row.peopleIds),
    favorite: row.favorite === 1,
    note: row.note || '',
    done: row.done === 1,
  };
}

const DRAFT_SELECT = `SELECT id, title, body, created_at as createdAt, updated_at as updatedAt, people_ids as peopleIds, favorite, note, done FROM drafts`;

export function listDrafts(): DraftRow[] {
  const rows = getDb()
    .prepare(`${DRAFT_SELECT} ORDER BY updated_at DESC, id DESC`)
    .all() as Array<Parameters<typeof mapDraft>[0]>;
  return rows.map(mapDraft);
}

export function createDraft(title: string, body: string): DraftRow {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO drafts(title, body, created_at, updated_at) VALUES(?, ?, ?, ?)`,
    )
    .run(title.trim(), body.trim(), now, now);
  const row = getDb()
    .prepare(`${DRAFT_SELECT} WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as Parameters<typeof mapDraft>[0];
  return mapDraft(row);
}

export function updateDraft(id: number, title: string, body: string): DraftRow | null {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      `UPDATE drafts SET title = ?, body = ?, updated_at = ? WHERE id = ?`,
    )
    .run(title.trim(), body.trim(), now, id);
  if (!info.changes) return null;
  const row = getDb().prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as
    | Parameters<typeof mapDraft>[0]
    | undefined;
  return row ? mapDraft(row) : null;
}

export function setDraftPeople(id: number, peopleIds: number[]): DraftRow | null {
  const unique = [...new Set(peopleIds.filter((personId) => Number.isInteger(personId)))];
  const info = getDb()
    .prepare(`UPDATE drafts SET people_ids = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(unique), new Date().toISOString(), id);
  if (!info.changes) return null;
  const row = getDb().prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as
    | Parameters<typeof mapDraft>[0]
    | undefined;
  return row ? mapDraft(row) : null;
}

export function setDraftNote(id: number, note: string): DraftRow | null {
  const info = getDb().prepare(`UPDATE drafts SET note = ? WHERE id = ?`).run(note, id);
  if (!info.changes) return null;
  const row = getDb().prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as
    | Parameters<typeof mapDraft>[0]
    | undefined;
  return row ? mapDraft(row) : null;
}

export function setDraftDone(id: number, done: boolean): DraftRow | null {
  const info = getDb().prepare(`UPDATE drafts SET done = ? WHERE id = ?`).run(done ? 1 : 0, id);
  if (!info.changes) return null;
  const row = getDb().prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as
    | Parameters<typeof mapDraft>[0]
    | undefined;
  return row ? mapDraft(row) : null;
}

export function setDraftFavorite(id: number, favorite: boolean): DraftRow | null {
  const info = getDb().prepare(`UPDATE drafts SET favorite = ? WHERE id = ?`).run(favorite ? 1 : 0, id);
  if (!info.changes) return null;
  const row = getDb().prepare(`${DRAFT_SELECT} WHERE id = ?`).get(id) as
    | Parameters<typeof mapDraft>[0]
    | undefined;
  return row ? mapDraft(row) : null;
}

export function deleteDraft(id: number): boolean {
  const info = getDb().prepare('DELETE FROM drafts WHERE id = ?').run(id);
  return info.changes > 0;
}

export type StoredIssueChange = {
  issueKey: string;
  boardLocalId: number;
  text: string;
  at: string;
  seen: boolean;
};

export function listIssueChanges(boardLocalId?: number | null): StoredIssueChange[] {
  type Row = { issueKey: string; boardLocalId: number; text: string; at: string; seen: number };
  const rows = (
    boardLocalId == null
      ? getDb().prepare(
          `SELECT issue_key as issueKey, board_local_id as boardLocalId, text, at, seen
           FROM issue_changes`,
        ).all()
      : getDb().prepare(
          `SELECT issue_key as issueKey, board_local_id as boardLocalId, text, at, seen
           FROM issue_changes WHERE board_local_id = ?`,
        ).all(boardLocalId)
  ) as Row[];
  return rows.map((row) => ({ ...row, seen: Boolean(row.seen) }));
}

export function upsertIssueChanges(
  boardLocalId: number,
  changes: Array<{ issueKey: string; text: string; at: string }>,
): void {
  const existing = new Map(
    listIssueChanges(boardLocalId).map((row) => [row.issueKey, row]),
  );
  const write = getDb().prepare(
    `INSERT INTO issue_changes(issue_key, board_local_id, text, at, seen)
     VALUES(?, ?, ?, ?, 0)
     ON CONFLICT(issue_key, board_local_id) DO UPDATE SET
       text = excluded.text, at = excluded.at, seen = 0`,
  );
  const tx = getDb().transaction(() => {
    for (const change of changes) {
      const prev = existing.get(change.issueKey);
      const nextAt = Date.parse(change.at) || 0;
      if (prev && prev.text === change.text && (Date.parse(prev.at) || 0) >= nextAt) continue;
      write.run(change.issueKey, boardLocalId, change.text, change.at);
    }
  });
  tx();
}

export function deleteIssueChanges(boardLocalId: number, issueKeys: string[]): void {
  if (!issueKeys.length) return;
  const stmt = getDb().prepare(
    `DELETE FROM issue_changes WHERE board_local_id = ? AND issue_key = ? AND text LIKE 'Новая задача%'`,
  );
  const tx = getDb().transaction(() => {
    for (const key of issueKeys) stmt.run(boardLocalId, key);
  });
  tx();
}

export function dismissIssueChanges(boardLocalId: number, issueKeys: string[]): void {
  if (!issueKeys.length) return;
  const stmt = getDb().prepare(
    `UPDATE issue_changes SET seen = 1 WHERE board_local_id = ? AND issue_key = ?`,
  );
  const tx = getDb().transaction(() => {
    for (const key of issueKeys) stmt.run(boardLocalId, key);
  });
  tx();
}

export function getSummaryNotes(
  boardLocalId: number,
  participantId: number,
): { report: string; issues: Record<string, string> } {
  const report = getDb()
    .prepare(
      `SELECT body FROM summary_notes WHERE board_local_id = ? AND participant_id = ?`,
    )
    .get(boardLocalId, participantId) as { body: string } | undefined;
  const rows = getDb()
    .prepare(
      `SELECT issue_key as issueKey, body FROM summary_issue_notes
       WHERE board_local_id = ? AND participant_id = ?`,
    )
    .all(boardLocalId, participantId) as Array<{ issueKey: string; body: string }>;
  const issues: Record<string, string> = {};
  for (const row of rows) issues[row.issueKey] = row.body;
  return { report: report?.body || '', issues };
}

export function setSummaryReportNote(
  boardLocalId: number,
  participantId: number,
  body: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO summary_notes(board_local_id, participant_id, body)
       VALUES(?, ?, ?)
       ON CONFLICT(board_local_id, participant_id) DO UPDATE SET body = excluded.body`,
    )
    .run(boardLocalId, participantId, body);
}

export type StoredSummaryCache = {
  formedAt: string;
  fromIso: string;
  toIso: string;
  requests: number;
  payload: string;
};

export function getSummarySource(boardLocalId: number): StoredSummaryCache | null {
  const row = getDb()
    .prepare(
      `SELECT formed_at as formedAt, from_iso as fromIso, to_iso as toIso, requests, payload
       FROM summary_source WHERE board_local_id = ?`,
    )
    .get(boardLocalId) as StoredSummaryCache | undefined;
  return row || null;
}

export function saveSummarySource(boardLocalId: number, cache: StoredSummaryCache): void {
  getDb()
    .prepare(
      `INSERT INTO summary_source(board_local_id, formed_at, from_iso, to_iso, requests, payload)
       VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_local_id) DO UPDATE SET
         formed_at = excluded.formed_at,
         from_iso = excluded.from_iso,
         to_iso = excluded.to_iso,
         requests = excluded.requests,
         payload = excluded.payload`,
    )
    .run(boardLocalId, cache.formedAt, cache.fromIso, cache.toIso, cache.requests, cache.payload);
}

export function listSummaryCachePeople(boardLocalId: number): number[] {
  const rows = getDb()
    .prepare(`SELECT participant_id as participantId FROM summary_cache WHERE board_local_id = ?`)
    .all(boardLocalId) as Array<{ participantId: number }>;
  return rows.map((row) => row.participantId);
}

export function getSummaryCache(boardLocalId: number, participantId: number): StoredSummaryCache | null {
  const row = getDb()
    .prepare(
      `SELECT formed_at as formedAt, from_iso as fromIso, to_iso as toIso, requests, payload
       FROM summary_cache WHERE board_local_id = ? AND participant_id = ?`,
    )
    .get(boardLocalId, participantId) as StoredSummaryCache | undefined;
  return row || null;
}

export function saveSummaryCache(
  boardLocalId: number,
  participantId: number,
  cache: StoredSummaryCache,
): void {
  getDb()
    .prepare(
      `INSERT INTO summary_cache(board_local_id, participant_id, formed_at, from_iso, to_iso, requests, payload)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(board_local_id, participant_id) DO UPDATE SET
         formed_at = excluded.formed_at,
         from_iso = excluded.from_iso,
         to_iso = excluded.to_iso,
         requests = excluded.requests,
         payload = excluded.payload`,
    )
    .run(
      boardLocalId,
      participantId,
      cache.formedAt,
      cache.fromIso,
      cache.toIso,
      cache.requests,
      cache.payload,
    );
}

export function setSummaryIssueNote(
  boardLocalId: number,
  participantId: number,
  issueKey: string,
  body: string,
): void {
  if (!body.trim()) {
    getDb()
      .prepare(
        `DELETE FROM summary_issue_notes
         WHERE board_local_id = ? AND participant_id = ? AND issue_key = ?`,
      )
      .run(boardLocalId, participantId, issueKey);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO summary_issue_notes(board_local_id, participant_id, issue_key, body)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(board_local_id, participant_id, issue_key) DO UPDATE SET body = excluded.body`,
    )
    .run(boardLocalId, participantId, issueKey, body);
}
