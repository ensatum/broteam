import { dialog } from 'electron';
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import type {
  BoardColumnConfig,
  BoardConfig,
  Developer,
  SavedBoard,
  SnapshotPayload,
} from '../shared/types';
import {
  getBoardConfig,
  clearCachedMatrices,
  getActiveBoardLocalId,
  importSavedBoards,
  listColumns,
  listDevelopers,
  listDrafts,
  listIssueNotes,
  listSavedBoards,
  listSnapshots,
  getSnapshotById,
  replaceColumns,
  replaceDevelopers,
  saveBoardConfig,
  setIssueNote,
  deleteDraft,
  upsertSnapshot,
  getDb,
} from './db';

export type BackupSections = {
  settings: boolean;
  tasks: boolean;
  summary: boolean;
  drafts: boolean;
};

export type AppBackup = {
  format: 'bro-team-backup' | 'brotracker-backup';
  version: 1 | 2;
  exportedAt: string;
  settings?: {
    board: BoardConfig;
    boards?: SavedBoard[];
    activeBoardLocalId?: number | null;
    columns: BoardColumnConfig[];
    developers: Developer[];
  };
  history?: Array<{ date: string; createdAt: string; payload: SnapshotPayload }>;
  notes?: {
    issues: Array<{ issueKey: string; note: string; updatedAt: string | null }>;
    developers: Array<{ login: string; note: string }>;
  };
  tasks?: {
    history: Array<{ date: string; createdAt: string; payload: SnapshotPayload }>;
    issueNotes: Array<{ issueKey: string; note: string; updatedAt: string | null }>;
    issueNoteLinks: Array<{ issueKey: string; participantId: number }>;
  };
  summary?: {
    sources: Array<{
      boardLocalId: number;
      formedAt: string;
      fromIso: string;
      toIso: string;
      requests: number;
      payload: string;
    }>;
    caches: Array<{
      boardLocalId: number;
      participantId: number;
      formedAt: string;
      fromIso: string;
      toIso: string;
      requests: number;
      payload: string;
    }>;
    notes: Array<{ boardLocalId: number; participantId: number; body: string }>;
    issueNotes: Array<{ boardLocalId: number; participantId: number; issueKey: string; body: string }>;
  };
  drafts?: Array<{
    title: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    peopleLogins?: string[];
    favorite?: boolean;
    note?: string;
    done?: boolean;
  }>;
};

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildBackup(sections: BackupSections): AppBackup {
  const backup: AppBackup = {
    format: 'bro-team-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
  };

  if (sections.settings) {
    backup.settings = {
      board: getBoardConfig(),
      boards: listSavedBoards(),
      activeBoardLocalId: getActiveBoardLocalId(),
      columns: listColumns(),
      developers: listDevelopers(),
    };
  }

  if (sections.tasks) {
    const db = getDb();
    const metas = listSnapshots();
    backup.tasks = {
      history: metas.map((meta) => {
        const full = getSnapshotById(meta.id)!;
        return {
          date: full.date,
          createdAt: full.createdAt,
          payload: JSON.parse(full.payload) as SnapshotPayload,
        };
      }),
      issueNotes: listIssueNotes(),
      issueNoteLinks: db
        .prepare(
          `SELECT issue_key as issueKey, participant_id as participantId FROM issue_note_links`,
        )
        .all() as Array<{ issueKey: string; participantId: number }>,
    };
  }

  if (sections.summary) {
    const db = getDb();
    backup.summary = {
      sources: db
        .prepare(
          `SELECT board_local_id as boardLocalId, formed_at as formedAt, from_iso as fromIso,
                  to_iso as toIso, requests, payload
           FROM summary_source`,
        )
        .all() as NonNullable<AppBackup['summary']>['sources'],
      caches: db
        .prepare(
          `SELECT board_local_id as boardLocalId, participant_id as participantId,
                  formed_at as formedAt, from_iso as fromIso, to_iso as toIso, requests, payload
           FROM summary_cache`,
        )
        .all() as NonNullable<AppBackup['summary']>['caches'],
      notes: db
        .prepare(
          `SELECT board_local_id as boardLocalId, participant_id as participantId, body
           FROM summary_notes`,
        )
        .all() as NonNullable<AppBackup['summary']>['notes'],
      issueNotes: db
        .prepare(
          `SELECT board_local_id as boardLocalId, participant_id as participantId,
                  issue_key as issueKey, body
           FROM summary_issue_notes`,
        )
        .all() as NonNullable<AppBackup['summary']>['issueNotes'],
    };
  }

  if (sections.drafts) {
    const byId = new Map(listDevelopers().map((person) => [person.id, person.login]));
    backup.drafts = listDrafts().map((d) => ({
      title: d.title,
      body: d.body,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      peopleLogins: d.peopleIds
        .map((id) => byId.get(id))
        .filter((login): login is string => Boolean(login)),
      favorite: d.favorite,
      note: d.note,
      done: d.done,
    }));
  }

  return backup;
}

export function applyBackup(backup: AppBackup, sections: BackupSections): string[] {
  if (backup.format !== 'bro-team-backup' && backup.format !== 'brotracker-backup') {
    throw new Error('Неверный формат файла (ожидается bro-team-backup)');
  }
  const applied: string[] = [];

  if (sections.settings) {
    if (!backup.settings) throw new Error('В файле нет блока настроек');
    const settings = backup.settings;
    getDb().transaction(() => {
      saveBoardConfig(settings.board);
      if (Array.isArray(settings.boards)) {
        importSavedBoards(settings.boards, settings.activeBoardLocalId ?? null);
      }
      replaceDevelopers(
        settings.developers.map((d, index) => ({
          login: d.login,
          displayName: d.displayName,
          uid: String(d.uid),
          color: d.color,
          sortOrder: d.sortOrder ?? index,
          role: d.role,
          onVacation: Boolean(d.onVacation),
          hidden: Boolean(d.hidden),
        })),
      );
      replaceColumns(
        settings.columns.map((c, index) => ({
          columnId: c.columnId,
          columnName: c.columnName,
          statusKey: c.statusKey,
          statusDisplay: c.statusDisplay,
          alias: c.alias,
          color: c.color,
          enabled: c.enabled,
          sortOrder: c.sortOrder ?? index,
          boardLocalId: c.boardLocalId || 0,
          duty: c.duty === 'review' || c.duty === 'testing' ? c.duty : '',
        })),
      );
      // The previous install kept one board's tasks. Those rows must not stay
      // on screen as if they belonged to every imported board.
      clearCachedMatrices();
    })();
    applied.push('настройки');
  }

  if (sections.tasks) {
    const history = backup.tasks?.history ?? backup.history;
    const issueNotes = backup.tasks?.issueNotes ?? backup.notes?.issues;
    const links = backup.tasks?.issueNoteLinks;
    if (!history && !issueNotes && !links) throw new Error('В файле нет блока задач');
    const db = getDb();
    db.prepare('DELETE FROM snapshots').run();
    db.prepare('DELETE FROM issue_notes').run();
    db.prepare('DELETE FROM issue_note_links').run();
    for (const snap of history || []) upsertSnapshot(snap.date, snap.payload);
    for (const note of issueNotes || []) setIssueNote(note.issueKey, note.note);
    if (links?.length) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO issue_note_links(issue_key, participant_id) VALUES(?, ?)`,
      );
      for (const link of links) insert.run(link.issueKey, link.participantId);
    }
    applied.push(`задачи (${(history || []).length})`);
  }

  if (sections.summary) {
    if (!backup.summary) throw new Error('В файле нет блока сводки');
    const db = getDb();
    db.prepare('DELETE FROM summary_source').run();
    db.prepare('DELETE FROM summary_cache').run();
    db.prepare('DELETE FROM summary_notes').run();
    db.prepare('DELETE FROM summary_issue_notes').run();
    const insertSource = db.prepare(
      `INSERT INTO summary_source(board_local_id, formed_at, from_iso, to_iso, requests, payload)
       VALUES(?, ?, ?, ?, ?, ?)`,
    );
    for (const row of backup.summary.sources) {
      insertSource.run(row.boardLocalId, row.formedAt, row.fromIso, row.toIso, row.requests, row.payload);
    }
    const insertCache = db.prepare(
      `INSERT INTO summary_cache(board_local_id, participant_id, formed_at, from_iso, to_iso, requests, payload)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of backup.summary.caches) {
      insertCache.run(
        row.boardLocalId,
        row.participantId,
        row.formedAt,
        row.fromIso,
        row.toIso,
        row.requests,
        row.payload,
      );
    }
    const insertNote = db.prepare(
      `INSERT INTO summary_notes(board_local_id, participant_id, body) VALUES(?, ?, ?)`,
    );
    for (const row of backup.summary.notes) insertNote.run(row.boardLocalId, row.participantId, row.body);
    const insertIssue = db.prepare(
      `INSERT INTO summary_issue_notes(board_local_id, participant_id, issue_key, body) VALUES(?, ?, ?, ?)`,
    );
    for (const row of backup.summary.issueNotes) {
      insertIssue.run(row.boardLocalId, row.participantId, row.issueKey, row.body);
    }
    applied.push('сводка');
  }

  if (sections.drafts) {
    if (!backup.drafts) throw new Error('В файле нет блока черновиков');
    // Replace all drafts
    const existing = listDrafts();
    for (const d of existing) deleteDraft(d.id);
    const db = getDb();
    const byLogin = new Map(listDevelopers().map((person) => [person.login.toLowerCase(), person.id]));
    const insert = db.prepare(
      `INSERT INTO drafts(title, body, created_at, updated_at, people_ids, favorite, note, done) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of backup.drafts) {
      const peopleIds = (d.peopleLogins || [])
        .map((login) => byLogin.get(login.toLowerCase()))
        .filter((id): id is number => id != null);
      insert.run(
        d.title,
        d.body,
        d.createdAt,
        d.updatedAt,
        JSON.stringify(peopleIds),
        d.favorite ? 1 : 0,
        d.note || '',
        d.done ? 1 : 0,
      );
    }
    applied.push(`черновики (${backup.drafts.length})`);
  }

  return applied;
}

export async function exportBackupToFile(
  win: BrowserWindow | null,
  sections: BackupSections,
): Promise<{ ok: true; path: string } | { ok: false; reason: 'cancelled' }> {
  if (!sections.settings && !sections.tasks && !sections.summary && !sections.drafts) {
    throw new Error('Выберите хотя бы один раздел для экспорта');
  }
  const saveOpts = {
    title: 'Экспорт BroTeam',
    defaultPath: `bro-team-backup-${todayStamp()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, saveOpts)
    : await dialog.showSaveDialog(saveOpts);
  if (result.canceled || !result.filePath) return { ok: false, reason: 'cancelled' };
  const data = buildBackup(sections);
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, path: result.filePath };
}

export function backupContents(backup: AppBackup): BackupSections {
  return {
    settings: Boolean(backup.settings),
    tasks: Boolean(backup.tasks),
    summary: Boolean(backup.summary),
    drafts: Boolean(backup.drafts?.length),
  };
}

async function chooseBackupFile(
  win: BrowserWindow | null,
): Promise<{ ok: true; path: string; backup: AppBackup } | { ok: false; reason: 'cancelled' }> {
  const openOpts: Electron.OpenDialogOptions = {
    title: 'Импорт BroTeam',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOpts)
    : await dialog.showOpenDialog(openOpts);
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
  const backup = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as AppBackup;
  if (backup.format !== 'bro-team-backup') throw new Error('Это не файл настроек BroTeam.');
  return { ok: true, path: result.filePaths[0], backup };
}

export async function inspectBackupFile(
  win: BrowserWindow | null,
): Promise<
  { ok: true; path: string; found: BackupSections } | { ok: false; reason: 'cancelled' }
> {
  const picked = await chooseBackupFile(win);
  if (!picked.ok) return picked;
  return { ok: true, path: picked.path, found: backupContents(picked.backup) };
}

export async function importBackupFromPath(
  filePath: string,
  sections: BackupSections,
): Promise<{ ok: true; applied: string[]; path: string }> {
  if (!sections.settings && !sections.tasks && !sections.summary && !sections.drafts) {
    throw new Error('Выберите хотя бы один раздел для импорта');
  }
  const backup = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AppBackup;
  if (backup.format !== 'bro-team-backup') throw new Error('Это не файл настроек BroTeam.');
  return { ok: true, applied: applyBackup(backup, sections), path: filePath };
}

export async function importBackupFromFile(
  win: BrowserWindow | null,
  sections: BackupSections,
): Promise<
  | { ok: true; applied: string[]; path: string }
  | { ok: false; reason: 'cancelled' }
> {
  if (!sections.settings && !sections.tasks && !sections.summary && !sections.drafts) {
    throw new Error('Выберите хотя бы один раздел для импорта');
  }
  const openOpts: Electron.OpenDialogOptions = {
    title: 'Импорт BroTeam',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, openOpts)
    : await dialog.showOpenDialog(openOpts);
  if (result.canceled || !result.filePaths[0]) return { ok: false, reason: 'cancelled' };
  const raw = fs.readFileSync(result.filePaths[0], 'utf8');
  const backup = JSON.parse(raw) as AppBackup;
  const applied = applyBackup(backup, sections);
  return { ok: true, applied, path: result.filePaths[0] };
}
