import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  deleteSnapshot,
  getBoardConfig,
  getConnection,
  getGithub,
  saveGithub,
  getSnapshotByDate,
  getSnapshotById,
  initDb,
  listColumns,
  listDevelopers,
  listSavedBoards,
  replaceSavedBoards,
  getActiveBoardLocalId,
  setActiveBoardLocalId,
  listIssueNoteLinks,
  setIssueNoteLinks,
  listSnapshots,
  getLastMatrix,
  listCachedMatrices,
  saveLastMatrix,
  replaceColumns,
  replaceDevelopers,
  readBoardRowPrefs,
  writeBoardRowPrefs,
  readRightTool,
  writeRightTool,
  saveBoardConfig,
  saveConnection,
  setDeveloperNote,
  setIssueNote,
  listIssueNotes,
  listDrafts,
  createDraft,
  updateDraft,
  setDraftPeople,
  setDraftFavorite,
  setDraftDone,
  setDraftNote,
  deleteDraft,
  upsertSnapshot,
  toggleIssueBookmark,
  getIssueBookmarks,
  getIssueBookmarkCreatedAt,
  getIssueNotes,
  getIssueNoteUpdatedAt,
  listDeveloperTodos,
  createDeveloperTodo,
  updateDeveloperTodo,
  deleteDeveloperTodo,
  assignDraftToDeveloper,
  listIssueChanges,
  dismissIssueChanges,
  getSummaryNotes,
  setSummaryReportNote,
  setSummaryIssueNote,
  listSummaryCachePeople,
  getSummarySource,
  readCloseToTray,
  writeCloseToTray,
} from './db';
import { exportBackupToFile, importBackupFromFile, importBackupFromPath, inspectBackupFile, type BackupSections } from './backup';
import { checkGithub, updateAppFromRepository } from './appUpdate';
import { isNewerVersion, liveVersion } from '../shared/version';
import { buildLiveMatrix, patchIssueInMatrix, remapMatrixPersonNames } from './boardService';
import { TrackerClient } from './tracker';
import type {
  BoardColumnConfig,
  BoardConfig,
  BoardMatrix,
  SavedBoard,
  Developer,
  SnapshotPayload,
  TrackerBoard,
  GithubSource,
  TrackerConnection,
} from '../shared/types';
import { COLUMN_COLORS, DEVELOPER_TONE_PRESETS, normalizeDeveloperTone } from '../shared/types';
import { describeMatrix } from '../shared/matrixShape';
import { initSessionLog, sessionLog, sessionLogPath } from './sessionLog';
import {
  beginBoardRefreshUsage,
  initApiUsage,
  resetTrackerActivity,
  subscribeTrackerActivity,
  trackerActivity,
} from './trackerActivity';
import { readStorageStats } from './storageStats';
import { consoleHistory } from './consoleFeed';
import { buildSummaryReport, refreshSummaryIssue, sliceStoredSummary } from './summaryReport';
import { trayPng } from './trayIcon';
import {
  abortTracker,
  armTracker,
  pauseTracker,
  resumeTracker,
  subscribeTrackerGate,
} from './trackerGate';
import type { SummaryBuildRequest } from '../shared/summary';
import { exportSummary } from './summaryExport';

let mainWindow: BrowserWindow | null = null;
let latestMatrix: BoardMatrix | null = null;
let tray: Tray | null = null;
let allowQuit = false;
let instanceServer: net.Server | null = null;

function resolveAppIcon(): string | undefined {
  const candidates = [
    // Packaged AppImage/deb: extraResources → resources/icon.png
    path.join(process.resourcesPath || '', 'icon.png'),
    // Unpacked linux build icons
    path.join(process.resourcesPath || '', 'icons', '512x512.png'),
    // Dev / unpacked next to dist-electron
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function loadAppIcon(): Electron.NativeImage | undefined {
  const iconPath = resolveAppIcon();
  if (!iconPath) return undefined;
  const img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) return undefined;
  return img;
}

function createWindow(): void {
  const iconImage = loadAppIcon();
  const windowTitle = `BroTeam - ${liveVersion(app.getVersion()).full}`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: windowTitle,
    ...(iconImage ? { icon: iconImage } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (iconImage && process.platform === 'linux') {
    mainWindow.setIcon(iconImage);
  }

  // The page <title> would otherwise replace the window title after load.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (allowQuit) return;
    sessionLog('error', 'render-process-gone', details);
    const file = sessionLogPath();
    void dialog
      .showMessageBox({
        type: 'error',
        title: 'BroTeam',
        message: 'Приложение закрылось из-за ошибки.',
        detail: file ? `Лог: ${file}` : 'Файл лога не найден.',
        buttons: file ? ['Открыть лог', 'Закрыть'] : ['Закрыть'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (file && response === 0) void shell.openPath(file);
      });
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    sessionLog('error', 'did-fail-load', { code, description, url });
  });
  mainWindow.webContents.on(
    'console-message',
    (event: unknown, legacyLevel?: unknown, legacyMessage?: unknown, legacyLine?: unknown, legacySource?: unknown) => {
      const details =
        event && typeof event === 'object' && 'message' in event
          ? (event as { level?: string | number; message?: string; lineNumber?: number; sourceId?: string })
          : {
              level: legacyLevel as string | number,
              message: String(legacyMessage ?? ''),
              lineNumber: Number(legacyLine ?? 0),
              sourceId: String(legacySource ?? ''),
            };
      const level = String(details.level ?? '');
      if (level !== 'error' && level !== '3') return;
      sessionLog('error', 'renderer console', {
        message: String(details.message ?? '').slice(0, 1500),
        line: details.lineNumber,
        source: details.sourceId,
      });
    },
  );

  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (allowQuit || !readCloseToTray()) return;
    event.preventDefault();
    mainWindow?.hide();
  });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  app.focus({ steal: true });
  mainWindow.setAlwaysOnTop(false);
  if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('tray:show');
}

function paintTray(): void {
  try {
    paintTrayIcon();
  } catch (error) {
    sessionLog('error', 'tray', error);
  }
}

function paintTrayIcon(): void {
  const alert = listIssueChanges().some((item) => !item.seen);
  const file = path.join(app.getPath('userData'), alert ? 'tray-alert.png' : 'tray.png');
  fs.writeFileSync(file, trayPng(alert));
  if (!tray) {
    tray = new Tray(file);
    tray.setToolTip('BroTeam');
    tray.on('click', () => showMainWindow());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Показать', click: () => showMainWindow() },
        {
          label: 'Закрыть',
          click: () => {
            allowQuit = true;
            app.quit();
          },
        },
      ]),
    );
  } else {
    tray.setImage(file);
  }
}

function instanceFile(): string {
  return path.join(app.getPath('userData'), 'instance.json');
}

function askRunningInstance(port: number, version: string): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value.trim());
    };
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(`${JSON.stringify({ version })}\n`);
    });
    let data = '';
    socket.setTimeout(800);
    socket.on('data', (buf) => {
      data += buf.toString();
    });
    socket.on('timeout', () => {
      socket.destroy();
      finish('');
    });
    socket.on('error', () => finish(''));
    socket.on('close', () => finish(data));
  });
}

function peerStillListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(200);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPeerExit(port: number): Promise<void> {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (!(await peerStillListening(port))) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function processArgv(pid: number): string[] {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function processParent(pid: number): number {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^PPid:\s+(\d+)/m.exec(status);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function ownProcessTree(): Set<number> {
  const keep = new Set<number>([process.pid]);
  let current = process.pid;
  while (current > 1) {
    const parent = processParent(current);
    if (!parent || keep.has(parent)) break;
    keep.add(parent);
    current = parent;
  }
  return keep;
}

function isOtherAppMain(argv: string[]): boolean {
  if (!argv.length || argv.some((arg) => arg.startsWith('--type='))) return false;
  return /(^|\/)broteam$/i.test(argv[0]);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function closeOlderMains(): Promise<void> {
  let names: string[] = [];
  try {
    names = fs.readdirSync('/proc');
  } catch {
    return;
  }
  const keep = ownProcessTree();
  const victims = names
    .filter((name) => /^\d+$/.test(name))
    .map(Number)
    .filter((pid) => !keep.has(pid) && isOtherAppMain(processArgv(pid)));
  if (!victims.length) return;
  sessionLog('info', 'instance close older', { pids: victims });
  for (const pid of victims) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline && victims.some(pidAlive)) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function claimInstance(version: string): Promise<boolean> {
  let peer: { port?: number; version?: string } | null = null;
  try {
    peer = JSON.parse(fs.readFileSync(instanceFile(), 'utf8')) as { port?: number; version?: string };
  } catch {
    peer = null;
  }
  if (peer?.port) {
    const answer = await askRunningInstance(peer.port, version);
    sessionLog('info', 'instance handshake', { version, peer: peer.version || '', answer: answer || 'none' });
    if (answer === 'stay') return false;
    if (answer === 'yield') await waitForPeerExit(peer.port);
  }
  await closeOlderMains();
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        if (!buf.includes('\n')) return;
        let incoming = '';
        try {
          incoming = String((JSON.parse(buf) as { version?: string }).version || '');
        } catch {
          incoming = '';
        }
        if (isNewerVersion(incoming, version)) {
          sessionLog('info', 'instance yield', { version, incoming });
          socket.end('yield\n');
          allowQuit = true;
          setTimeout(() => app.quit(), 80);
          return;
        }
        socket.end('stay\n');
        showMainWindow();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      fs.writeFileSync(instanceFile(), JSON.stringify({ port, version, pid: process.pid }));
      instanceServer = server;
      resolve();
    });
  });
  return true;
}

function getClient(): TrackerClient {
  return new TrackerClient(getConnection());
}

function registerIpc(): void {
  ipcMain.handle('app:getInfo', () => {
    const versions = liveVersion(app.getVersion());
    return {
      name: app.getName(),
      version: versions.full,
      headerVersion: versions.header,
    };
  });
  ipcMain.handle('app:updateFromRepo', async (event) => {
    return updateAppFromRepository((message) => {
      event.sender.send('app:updateProgress', message);
    });
  });

  ipcMain.handle('settings:getGithub', () => getGithub());
  ipcMain.handle('settings:saveGithub', (_e, source: GithubSource) => {
    saveGithub(source);
    return getGithub();
  });
  ipcMain.handle('settings:testGithub', async (_e, source: GithubSource) => {
    await checkGithub(source.remote, source.branch);
    return true;
  });

  ipcMain.handle('settings:getConnection', () => getConnection());
  ipcMain.handle('settings:saveConnection', (_e, connection: TrackerConnection) => {
    saveConnection(connection);
    return getConnection();
  });
  ipcMain.handle('settings:testConnection', async (_e, connection?: TrackerConnection) => {
    const conn = connection || getConnection();
    const client = new TrackerClient(conn);
    const me = await client.myself();
    return me;
  });

  ipcMain.handle('settings:getBoard', () => getBoardConfig());
  ipcMain.handle('settings:saveBoard', (_e, board: BoardConfig) => {
    saveBoardConfig(board);
    return getBoardConfig();
  });

  ipcMain.handle('developers:list', () => listDevelopers());
  ipcMain.handle('boardRows:get', () => readBoardRowPrefs());
  ipcMain.handle('boardRows:save', (_e, prefs: unknown) => writeBoardRowPrefs(prefs));
  ipcMain.handle('rightTool:get', () => readRightTool());
  ipcMain.handle('rightTool:save', (_e, tool: unknown) => writeRightTool(tool));
  ipcMain.handle(
    'developers:replace',
    (_e, developers: Array<Omit<Developer, 'id'> & { id?: number }>) => {
      const normalized = developers.map((d, index) => ({
        id: d.id,
        login: d.login,
        displayName: d.displayName,
        uid: String(d.uid),
        color: normalizeDeveloperTone(d.color),
        sortOrder: d.sortOrder ?? index,
        role: d.role,
        onVacation: Boolean(d.onVacation),
        hidden: Boolean(d.hidden),
        summary: d.summary == null ? d.role === 'developer' || d.role === 'qa' : Boolean(d.summary),
      }));
      return replaceDevelopers(normalized);
    },
  );

  ipcMain.handle('boards:list', () => listSavedBoards());
  ipcMain.handle(
    'boards:replace',
    (_e, boards: Array<Omit<SavedBoard, 'id'> & { id?: number }>) => replaceSavedBoards(boards),
  );
  ipcMain.handle('boards:getActive', () => getActiveBoardLocalId());
  ipcMain.handle('boards:setActive', (_e, id: number) => {
    sessionLog('info', 'boards:setActive', { id });
    setActiveBoardLocalId(id);
    const active = getActiveBoardLocalId();
    sessionLog('info', 'boards:setActive done', { active });
    return active;
  });
  ipcMain.handle('notes:listLinks', () => listIssueNoteLinks());
  ipcMain.handle('notes:setLinks', (_e, issueKey: string, participantIds: number[]) =>
    setIssueNoteLinks(issueKey, participantIds),
  );

  ipcMain.handle('columns:list', () => listColumns());
  ipcMain.handle(
    'columns:replace',
    (_e, columns: Array<Omit<BoardColumnConfig, 'id'> & { id?: number }>) => {
      return replaceColumns(columns);
    },
  );

  ipcMain.handle('tracker:searchUsers', async (_e, query: string) => {
    return getClient().searchUsers(query);
  });
  ipcMain.handle('tracker:listBoards', async (_e, queue?: string, known?: TrackerBoard[]) => {
    return getClient().listBoards(queue, known);
  });
  ipcMain.handle(
    'tracker:searchBoards',
    async (_e, query: string, queue?: string, known?: TrackerBoard[]) => {
      return getClient().searchBoards(query, queue, known);
    },
  );
  ipcMain.handle('tracker:getBoardColumns', async (_e, boardId: number) => {
    return getClient().getBoardColumns(boardId);
  });
  ipcMain.handle('tracker:statusTypes', async () => {
    return getClient().listStatusTypes();
  });
  ipcMain.handle('tracker:getBoardSprints', async (_e, boardId: number) => {
    return getClient().getBoardSprints(boardId);
  });
  ipcMain.handle('tracker:getTransitions', async (_e, issueKey: string) => {
    return getClient().getTransitions(issueKey);
  });
  ipcMain.handle('tracker:issueStory', async (_e, issueKey: string) => {
    return getClient().getIssueStory(issueKey);
  });
  ipcMain.handle('tracker:refreshIssue', async (_e, issueKey: string) => {
    const issue = await getClient().getIssue(issueKey);
    const activeId = getActiveBoardLocalId();
    const remembered =
      latestMatrix && activeId != null && latestMatrix.sourceBoardLocalId === activeId
        ? latestMatrix
        : getLastMatrix<BoardMatrix>();
    const current =
      remembered && activeId != null && remembered.sourceBoardLocalId === activeId
        ? remembered
        : null;
    if (!current) {
      const matrix = await buildLiveMatrix();
      latestMatrix = matrix;
      return matrix;
    }
    const matrix = patchIssueInMatrix(current, issue);
    latestMatrix = matrix;
    saveLastMatrix(matrix);
    return matrix;
  });
  ipcMain.handle(
    'tracker:executeTransition',
    async (_e, issueKey: string, transitionId: string) => {
      await getClient().executeTransition(issueKey, transitionId);
      return true;
    },
  );

  ipcMain.handle('board:refresh', async (_e, boardLocalId?: number) => {
    armTracker();
    const viewed = getActiveBoardLocalId();
    const target = typeof boardLocalId === 'number' ? boardLocalId : viewed;
    sessionLog('info', 'board:refresh start', { activeId: target });
    if (target != null && target !== viewed) setActiveBoardLocalId(target);
    try {
      const matrix = await buildLiveMatrix();
      if (getActiveBoardLocalId() === target) latestMatrix = matrix;
      sessionLog('info', 'board:refresh done', describeMatrix(matrix));
      paintTray();
      return matrix;
    } catch (error) {
      sessionLog('error', 'board:refresh failed', error);
      throw error;
    } finally {
      if (target != null && getActiveBoardLocalId() === target && viewed != null && viewed !== target) {
        setActiveBoardLocalId(viewed);
      }
    }
  });
  ipcMain.handle('board:getLast', (_e, boardLocalId?: number) => {
    const activeId = typeof boardLocalId === 'number' ? boardLocalId : getActiveBoardLocalId();
    try {
      const memoryMatches =
        latestMatrix != null && activeId != null && latestMatrix.sourceBoardLocalId === activeId;
      const memory = memoryMatches ? latestMatrix : null;
      const loaded = memory || getLastMatrix<BoardMatrix>(typeof boardLocalId === 'number' ? boardLocalId : undefined);
      const loadedOwns =
        loaded != null &&
        (activeId == null || loaded.sourceBoardLocalId === activeId);
      const m = loadedOwns ? loaded : null;
      sessionLog('info', 'board:getLast', {
        activeId,
        memory: memory ? describeMatrix(memory) : null,
        ignoredMemory: latestMatrix && !memoryMatches ? describeMatrix(latestMatrix) : null,
        loaded: describeMatrix(m),
      });
      const peek = typeof boardLocalId === 'number' && boardLocalId !== getActiveBoardLocalId();
      if (!m) {
        if (!peek && (latestMatrix?.sourceBoardLocalId == null || latestMatrix?.sourceBoardLocalId === activeId)) {
          latestMatrix = null;
        }
        return null;
      }
      const remapped = remapMatrixPersonNames(m, listDevelopers());
      if (!peek) latestMatrix = remapped;
      const todosByDev: Record<number, ReturnType<typeof listDeveloperTodos>> = {};
      for (const t of listDeveloperTodos()) {
        if (!todosByDev[t.developerId]) todosByDev[t.developerId] = [];
        todosByDev[t.developerId].push(t);
      }
      return {
        ...remapped,
        issueNotes: getIssueNotes(),
        issueNoteUpdatedAt: getIssueNoteUpdatedAt(),
        issueBookmarks: getIssueBookmarks(),
        issueBookmarkCreatedAt: getIssueBookmarkCreatedAt(),
        developers: remapped.developers.map((row) => ({
          ...row,
          todos: todosByDev[row.developer.id] ?? [],
        })),
      };
    } catch (error) {
      sessionLog('error', 'board:getLast failed', error);
      throw error;
    }
  });
  ipcMain.handle('board:saveLast', (_e, matrix: BoardMatrix) => {
    latestMatrix = matrix;
    // Keep notes from DB authoritative when caching.
    matrix.issueNotes = {
      ...matrix.issueNotes,
      ...Object.fromEntries(
        Object.entries(
          // re-merge is done in setIssueNote path; here just store what UI sends
          matrix.issueNotes || {},
        ),
      ),
    };
    saveLastMatrix(matrix);
    return true;
  });

  ipcMain.handle('notes:list', () => listIssueNotes());
  ipcMain.handle('notes:setIssue', (_e, issueKey: string, note: string) => {
    const updatedAt = setIssueNote(issueKey, note);
    if (latestMatrix) {
      const issueNotes = { ...latestMatrix.issueNotes };
      const issueNoteUpdatedAt = { ...(latestMatrix.issueNoteUpdatedAt || {}) };
      if (!note.trim()) {
        delete issueNotes[issueKey];
        delete issueNoteUpdatedAt[issueKey];
      } else {
        issueNotes[issueKey] = note;
        issueNoteUpdatedAt[issueKey] = updatedAt;
      }
      latestMatrix = { ...latestMatrix, issueNotes, issueNoteUpdatedAt };
      saveLastMatrix(latestMatrix);
    }
    return updatedAt;
  });
  ipcMain.handle('notes:setDeveloper', (_e, developerId: number, note: string) => {
    setDeveloperNote(developerId, note);
    if (latestMatrix) {
      latestMatrix = {
        ...latestMatrix,
        developers: latestMatrix.developers.map((row) =>
          row.developer.id === developerId ? { ...row, note } : row,
        ),
      };
      saveLastMatrix(latestMatrix);
    }
    return true;
  });

  function syncTodosIntoLatest(): void {
    if (!latestMatrix) return;
    const byDev = new Map<number, ReturnType<typeof listDeveloperTodos>>();
    for (const t of listDeveloperTodos()) {
      const list = byDev.get(t.developerId) || [];
      list.push(t);
      byDev.set(t.developerId, list);
    }
    latestMatrix = {
      ...latestMatrix,
      developers: latestMatrix.developers.map((row) => ({
        ...row,
        todos: byDev.get(row.developer.id) || [],
      })),
    };
    saveLastMatrix(latestMatrix);
  }

  ipcMain.handle('todos:list', (_e, developerId?: number) => listDeveloperTodos(developerId));
  ipcMain.handle(
    'todos:create',
    (_e, developerId: number, title: string, body: string) => {
      const todo = createDeveloperTodo(developerId, title, body);
      syncTodosIntoLatest();
      return todo;
    },
  );
  ipcMain.handle(
    'todos:update',
    (
      _e,
      id: number,
      patch: { title?: string; body?: string; developerId?: number },
    ) => {
      const todo = updateDeveloperTodo(id, patch);
      syncTodosIntoLatest();
      return todo;
    },
  );
  ipcMain.handle('todos:delete', (_e, id: number) => {
    const ok = deleteDeveloperTodo(id);
    syncTodosIntoLatest();
    return ok;
  });
  ipcMain.handle(
    'drafts:assign',
    (_e, draftId: number, developerId: number) => {
      const todo = assignDraftToDeveloper(draftId, developerId);
      syncTodosIntoLatest();
      return todo;
    },
  );

  ipcMain.handle('bookmarks:toggle', (_e, issueKey: string) => {
    const active = toggleIssueBookmark(issueKey);
    if (latestMatrix) {
      const issueBookmarks = { ...(latestMatrix.issueBookmarks || {}) };
      const issueBookmarkCreatedAt = { ...(latestMatrix.issueBookmarkCreatedAt || {}) };
      if (active) {
        issueBookmarks[issueKey] = true;
        issueBookmarkCreatedAt[issueKey] =
          getIssueBookmarkCreatedAt()[issueKey] || new Date().toISOString();
      } else {
        delete issueBookmarks[issueKey];
        delete issueBookmarkCreatedAt[issueKey];
      }
      latestMatrix = { ...latestMatrix, issueBookmarks, issueBookmarkCreatedAt };
      saveLastMatrix(latestMatrix);
    }
    return active;
  });

  ipcMain.handle('drafts:list', () => listDrafts());
  ipcMain.handle('drafts:create', (_e, title: string, body: string) => createDraft(title, body));
  ipcMain.handle('drafts:update', (_e, id: number, title: string, body: string) =>
    updateDraft(id, title, body),
  );
  ipcMain.handle('drafts:people', (_e, id: number, peopleIds: number[]) =>
    setDraftPeople(id, peopleIds),
  );
  ipcMain.handle('drafts:favorite', (_e, id: number, favorite: boolean) =>
    setDraftFavorite(id, favorite),
  );
  ipcMain.handle('drafts:done', (_e, id: number, done: boolean) => setDraftDone(id, done));
  ipcMain.handle('drafts:note', (_e, id: number, note: string) => setDraftNote(id, note));
  ipcMain.handle('drafts:delete', (_e, id: number) => deleteDraft(id));

  ipcMain.handle('backup:export', async (_e, sections: BackupSections) => {
    return exportBackupToFile(mainWindow, sections);
  });
  ipcMain.handle('backup:inspect', async () => inspectBackupFile(mainWindow));
  ipcMain.handle('backup:importPath', async (_e, filePath: string, sections: BackupSections) => {
    const result = await importBackupFromPath(filePath, sections);
    if (result.ok && sections.settings) latestMatrix = null;
    return result;
  });
  ipcMain.handle('backup:import', async (_e, sections: BackupSections) => {
    const result = await importBackupFromFile(mainWindow, sections);
    if (result.ok && sections.settings) latestMatrix = null;
    return result;
  });

  subscribeTrackerActivity((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('tracker:activity', state);
    }
  });
  subscribeTrackerGate((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('tracker:gate', state);
    }
  });
  ipcMain.handle('tracker:pause', () => pauseTracker());
  ipcMain.handle('tracker:resume', () => resumeTracker());
  ipcMain.handle('tracker:abort', () => abortTracker());
  ipcMain.handle('tracker:resetActivity', () => resetTrackerActivity());
  ipcMain.handle('tracker:beginBoardRefresh', () => beginBoardRefreshUsage());
  ipcMain.handle('tracker:usage', () => trackerActivity());
  ipcMain.handle('app:storageStats', () => readStorageStats(app.getPath('userData')));
  ipcMain.handle('console:history', () => consoleHistory());
  ipcMain.handle('log:read', () => {
    const file = sessionLogPath();
    if (!file || !fs.existsSync(file)) return '';
    return fs.readFileSync(file, 'utf8');
  });
  ipcMain.handle('log:reveal', () => {
    const file = sessionLogPath();
    if (file) shell.showItemInFolder(file);
  });
  ipcMain.handle('changes:list', () => listIssueChanges());
  ipcMain.handle('changes:dismiss', (_e, boardLocalId: number, issueKeys: string[]) => {
    dismissIssueChanges(boardLocalId, issueKeys);
    paintTray();
    return listIssueChanges();
  });
  ipcMain.handle('summary:notes', (_e, boardLocalId: number, participantId: number) =>
    getSummaryNotes(boardLocalId, participantId),
  );
  ipcMain.handle(
    'summary:setReportNote',
    (_e, boardLocalId: number, participantId: number, body: string) => {
      setSummaryReportNote(boardLocalId, participantId, body);
      return true;
    },
  );
  ipcMain.handle(
    'summary:setIssueNote',
    (_e, boardLocalId: number, participantId: number, issueKey: string, body: string) => {
      setSummaryIssueNote(boardLocalId, participantId, issueKey, body);
      return true;
    },
  );
  ipcMain.handle('summary:cached', (_e, boardLocalId: number) => ({
    people: listSummaryCachePeople(boardLocalId),
    shared: getSummarySource(boardLocalId) != null,
  }));
  ipcMain.handle('summary:open', (_e, request: SummaryBuildRequest) => sliceStoredSummary(request));
  ipcMain.handle('app:getCloseToTray', () => readCloseToTray());
  ipcMain.handle('app:setCloseToTray', (_e, value: boolean) => writeCloseToTray(Boolean(value)));
  ipcMain.handle(
    'summary:refreshIssue',
    async (_e, request: SummaryBuildRequest, issueKey: string, boardLocalId: number) => {
      armTracker();
      return refreshSummaryIssue(request, issueKey, boardLocalId);
    },
  );
  ipcMain.handle('summary:build', async (event, request: SummaryBuildRequest) => {
    armTracker();
    resetTrackerActivity();
    const win = BrowserWindow.fromWebContents(event.sender);
    return buildSummaryReport(request, (progress) => {
      win?.webContents.send('summary:progress', {
        ...progress,
        requests: trackerActivity().total,
      });
    });
  });
  ipcMain.handle(
    'summary:export',
    async (
      event,
      format: 'xlsx' | 'docx',
      report: Parameters<typeof exportSummary>[2],
    ) => exportSummary(BrowserWindow.fromWebContents(event.sender), format, report),
  );

  ipcMain.handle('snapshots:list', () => listSnapshots());
  ipcMain.handle('snapshots:get', (_e, id: number) => {
    const row = getSnapshotById(id);
    if (!row) return null;
    return {
      id: row.id,
      date: row.date,
      createdAt: row.createdAt,
      payload: JSON.parse(row.payload) as SnapshotPayload,
    };
  });
  ipcMain.handle('snapshots:exists', (_e, date: string) => {
    return Boolean(getSnapshotByDate(date));
  });
  ipcMain.handle(
    'snapshots:create',
    async (_e, date: string, replaceExisting: boolean) => {
      const existing = getSnapshotByDate(date);
      if (existing && !replaceExisting) {
        return { ok: false as const, reason: 'exists' as const };
      }
      // Save the board already on screen. A fresh Tracker load (especially one
      // that walks every sprint) is what made saving feel stuck.
      const matrices = listCachedMatrices() as Record<string, BoardMatrix>;
      if (latestMatrix?.sourceBoardLocalId != null) {
        matrices[String(latestMatrix.sourceBoardLocalId)] = latestMatrix;
      }
      const activeId = getActiveBoardLocalId();
      let matrix =
        (activeId != null ? matrices[String(activeId)] : undefined) ||
        latestMatrix ||
        getLastMatrix<BoardMatrix>();
      if (!matrix) matrix = await buildLiveMatrix();
      const connection = getConnection();
      const payload: SnapshotPayload = {
        date,
        connectionMeta: {
          cloudOrgId: connection.cloudOrgId,
          orgId: connection.orgId,
          apiUrl: connection.apiUrl,
        },
        board: getBoardConfig(),
        columns: listColumns(),
        matrix,
        matrices,
      };
      const meta = upsertSnapshot(date, payload);
      for (const item of listSnapshots()) {
        if (item.id !== meta.id) deleteSnapshot(item.id);
      }
      return { ok: true as const, snapshot: meta };
    },
  );
  ipcMain.handle('snapshots:delete', (_e, id: number) => {
    deleteSnapshot(id);
    return true;
  });

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    void shell.openExternal(url);
    return true;
  });

  ipcMain.handle('app:notify', (_e, body: string) => {
    if (!Notification.isSupported()) return false;
    new Notification({ title: 'BroTeam', body: String(body || '') }).show();
    return true;
  });

  ipcMain.handle('util:defaultColumnColors', () => COLUMN_COLORS);
  ipcMain.handle('util:defaultDeveloperColors', () => DEVELOPER_TONE_PRESETS);
  ipcMain.on('log:write', (_e, level: string, message: string, extra?: unknown) => {
    sessionLog(level === 'error' ? 'error' : 'info', message, extra);
  });
}

function resolveUserData(appData: string): string {
  const target = path.join(appData, 'bro-team');
  const database = (dir: string) => path.join(dir, 'data', 'standup.sqlite');
  const legacy = ['BroTeam', 'BroTracker', 'tracker-standup'].map((name) => path.join(appData, name));
  try {
    if (!fs.existsSync(database(target))) {
      const source = legacy.find((dir) => fs.existsSync(database(dir)));
      if (source) {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(source, target);
      }
    }
  } catch {
    const source = legacy.find((dir) => fs.existsSync(database(dir)));
    if (source) return source;
  }
  return target;
}

app.whenReady().then(async () => {
  // Default Electron File/Edit/View/Help menu is unused here — hide it.
  Menu.setApplicationMenu(null);
  app.setName('BroTeam');
  app.setPath('userData', resolveUserData(app.getPath('appData')));
  initDb(app.getPath('userData'), app.getVersion());
  initApiUsage();
  initSessionLog(app.getPath('userData'));
  const version = liveVersion(app.getVersion()).full;
  const claimed = await claimInstance(version).catch(() => true);
  if (!claimed) {
    app.quit();
    return;
  }
  latestMatrix = getLastMatrix<BoardMatrix>();
  sessionLog('info', 'startup matrix', describeMatrix(latestMatrix));
  registerIpc();
  createWindow();
  paintTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', () => {
  allowQuit = true;
  if (latestMatrix) saveLastMatrix(latestMatrix);
  instanceServer?.close();
  try {
    const raw = JSON.parse(fs.readFileSync(instanceFile(), 'utf8')) as { pid?: number };
    if (raw.pid === process.pid) fs.rmSync(instanceFile(), { force: true });
  } catch {
    /* no instance file */
  }
});

app.on('window-all-closed', () => {
  if (latestMatrix) saveLastMatrix(latestMatrix);
  if (readCloseToTray() && !allowQuit) return;
  if (process.platform !== 'darwin') app.quit();
});
