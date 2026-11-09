import { contextBridge, ipcRenderer } from 'electron';
import type {
  BoardColumnConfig,
  BoardConfig,
  BoardMatrix,
  SavedBoard,
  Developer,
  SnapshotPayload,
  TrackerBoard,
  TrackerBoardColumn,
  GithubSource,
  TrackerConnection,
  TrackerSprint,
  TrackerUser,
  TrackerIssue,
  IssueNoteRecord,
  LocalDraft,
  DeveloperTodo,
} from '../shared/types';
import type { SummaryBuildRequest, SummaryReport, SummaryRow, SummarySlice } from '../shared/summary';

export type BackupSections = {
  settings: boolean;
  tasks: boolean;
  summary: boolean;
  drafts: boolean;
};

export type ElectronApi = {
  getGithub: () => Promise<GithubSource>;
  saveGithub: (source: GithubSource) => Promise<GithubSource>;
  testGithub: (source: GithubSource) => Promise<boolean>;
  getConnection: () => Promise<TrackerConnection>;
  saveConnection: (connection: TrackerConnection) => Promise<TrackerConnection>;
  testConnection: (
    connection?: TrackerConnection,
  ) => Promise<{ login: string; display: string; uid: number }>;
  getBoard: () => Promise<BoardConfig>;
  saveBoard: (board: BoardConfig) => Promise<BoardConfig>;
  listDevelopers: () => Promise<Developer[]>;
  getBoardRowPrefs: () => Promise<Record<string, { hidden: number[]; shown: number[] }>>;
  saveBoardRowPrefs: (
    prefs: Record<string, { hidden: number[]; shown: number[] }>,
  ) => Promise<Record<string, { hidden: number[]; shown: number[] }>>;
  getRightTool: () => Promise<'summary' | 'drafts' | 'off' | null>;
  getCloseToTray: () => Promise<boolean>;
  setCloseToTray: (value: boolean) => Promise<boolean>;
  saveRightTool: (tool: 'summary' | 'drafts' | 'off') => Promise<'summary' | 'drafts' | 'off'>;
  replaceDevelopers: (
    developers: Array<Omit<Developer, 'id'> & { id?: number }>,
  ) => Promise<Developer[]>;
  listSavedBoards: () => Promise<SavedBoard[]>;
  replaceSavedBoards: (
    boards: Array<Omit<SavedBoard, 'id'> & { id?: number }>,
  ) => Promise<SavedBoard[]>;
  getActiveBoard: () => Promise<number | null>;
  setActiveBoard: (id: number) => Promise<number | null>;
  listIssueNoteLinks: () => Promise<Record<string, number[]>>;
  setIssueNoteLinks: (issueKey: string, participantIds: number[]) => Promise<number[]>;
  listColumns: () => Promise<BoardColumnConfig[]>;
  replaceColumns: (
    columns: Array<Omit<BoardColumnConfig, 'id'> & { id?: number }>,
  ) => Promise<BoardColumnConfig[]>;
  searchUsers: (query: string) => Promise<TrackerUser[]>;
  listBoards: (queue?: string, known?: TrackerBoard[]) => Promise<TrackerBoard[]>;
  searchBoards: (query: string, queue?: string, known?: TrackerBoard[]) => Promise<TrackerBoard[]>;
  getBoardColumns: (boardId: number) => Promise<TrackerBoardColumn[]>;
  listStatusTypes: () => Promise<Record<string, string>>;
  getBoardSprints: (boardId: number) => Promise<TrackerSprint[]>;
  getTransitions: (
    issueKey: string,
  ) => Promise<Array<{ id: string; display: string; toKey?: string; toDisplay?: string }>>;
  getIssueStory: (issueKey: string) => Promise<{
    description: string;
    commentText: string;
    commentUrl: string;
    commentAuthor: string;
    commentAt: string;
  }>;
  refreshIssue: (issueKey: string) => Promise<BoardMatrix>;
  executeTransition: (issueKey: string, transitionId: string) => Promise<boolean>;
  refreshBoard: (boardLocalId?: number) => Promise<BoardMatrix>;
  getLastBoard: (boardLocalId?: number) => Promise<BoardMatrix | null>;
  readLog: () => Promise<string>;
  revealLog: () => Promise<void>;
  saveLastBoard: (matrix: BoardMatrix) => Promise<boolean>;
  listIssueNotes: () => Promise<IssueNoteRecord[]>;
  setIssueNote: (issueKey: string, note: string) => Promise<string>;
  setDeveloperNote: (developerId: number, note: string) => Promise<boolean>;
  toggleIssueBookmark: (issueKey: string) => Promise<boolean>;
  listDeveloperTodos: (developerId?: number) => Promise<DeveloperTodo[]>;
  createDeveloperTodo: (
    developerId: number,
    title: string,
    body: string,
  ) => Promise<DeveloperTodo>;
  updateDeveloperTodo: (
    id: number,
    patch: { title?: string; body?: string; developerId?: number },
  ) => Promise<DeveloperTodo | null>;
  deleteDeveloperTodo: (id: number) => Promise<boolean>;
  assignDraftToDeveloper: (draftId: number, developerId: number) => Promise<DeveloperTodo>;
  listDrafts: () => Promise<LocalDraft[]>;
  createDraft: (title: string, body: string) => Promise<LocalDraft>;
  updateDraft: (id: number, title: string, body: string) => Promise<LocalDraft | null>;
  setDraftPeople: (id: number, peopleIds: number[]) => Promise<LocalDraft | null>;
  setDraftFavorite: (id: number, favorite: boolean) => Promise<LocalDraft | null>;
  setDraftDone: (id: number, done: boolean) => Promise<LocalDraft | null>;
  setDraftNote: (id: number, note: string) => Promise<LocalDraft | null>;
  deleteDraft: (id: number) => Promise<boolean>;
  exportBackup: (
    sections: BackupSections,
  ) => Promise<{ ok: true; path: string } | { ok: false; reason: 'cancelled' }>;
  importBackup: (
    sections: BackupSections,
  ) => Promise<
    | { ok: true; applied: string[]; path: string }
    | { ok: false; reason: 'cancelled' }
  >;
  inspectBackup: () => Promise<
    | { ok: true; path: string; found: BackupSections }
    | { ok: false; reason: 'cancelled' }
  >;
  importBackupPath: (
    filePath: string,
    sections: BackupSections,
  ) => Promise<{ ok: true; applied: string[]; path: string }>;
  listSnapshots: () => Promise<Array<{ id: number; date: string; createdAt: string }>>;
  getSnapshot: (
    id: number,
  ) => Promise<{
    id: number;
    date: string;
    createdAt: string;
    payload: SnapshotPayload;
  } | null>;
  snapshotExists: (date: string) => Promise<boolean>;
  createSnapshot: (
    date: string,
    replaceExisting: boolean,
  ) => Promise<
    | { ok: true; snapshot: { id: number; date: string; createdAt: string } }
    | { ok: false; reason: 'exists' }
  >;
  deleteSnapshot: (id: number) => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  notify: (body: string) => Promise<boolean>;
  getAppInfo: () => Promise<{ name: string; version: string; headerVersion: string }>;
  updateAppFromRepo: () => Promise<{ updated: boolean; restarted: boolean; message: string }>;
  onAppUpdateProgress: (listener: (message: string) => void) => () => void;
  sessionLog: (level: 'info' | 'error', message: string, extra?: unknown) => void;
  resetTrackerActivity: () => Promise<{ total: number; inflight: number; sinceRefresh: number; dayTotal: number }>;
  beginBoardRefresh: () => Promise<{ total: number; inflight: number; sinceRefresh: number; dayTotal: number }>;
  trackerUsage: () => Promise<{ total: number; inflight: number; sinceRefresh: number; dayTotal: number }>;
  storageStats: () => Promise<{ database: number; settings: number; logs: number }>;
  onTrackerActivity: (
    listener: (state: { total: number; inflight: number; sinceRefresh: number; dayTotal: number }) => void,
  ) => () => void;
  onTrackerGate: (listener: (state: { paused: boolean }) => void) => () => void;
  pauseTracker: () => Promise<{ paused: boolean }>;
  resumeTracker: () => Promise<{ paused: boolean }>;
  abortTracker: () => Promise<{ paused: boolean }>;
  listIssueChanges: () => Promise<
    Array<{ issueKey: string; boardLocalId: number; text: string; at: string; seen: boolean }>
  >;
  dismissIssueChanges: (
    boardLocalId: number,
    issueKeys: string[],
  ) => Promise<
    Array<{ issueKey: string; boardLocalId: number; text: string; at: string; seen: boolean }>
  >;
  getSummaryNotes: (
    boardLocalId: number,
    participantId: number,
  ) => Promise<{ report: string; issues: Record<string, string> }>;
  setSummaryReportNote: (boardLocalId: number, participantId: number, body: string) => Promise<boolean>;
  setSummaryIssueNote: (
    boardLocalId: number,
    participantId: number,
    issueKey: string,
    body: string,
  ) => Promise<boolean>;
  listSummaryCache: (boardLocalId: number) => Promise<{ people: number[]; shared: boolean }>;
  openSummary: (request: SummaryBuildRequest) => Promise<SummarySlice | null>;
  buildSummary: (request: SummaryBuildRequest) => Promise<SummaryReport>;
  refreshSummaryIssue: (
    request: SummaryBuildRequest,
    issueKey: string,
    boardLocalId: number,
  ) => Promise<SummaryRow | null>;
  onSummaryProgress: (
    listener: (progress: { row: SummaryRow | null; index: number; total: number; requests: number }) => void,
  ) => () => void;
  getConsole: () => Promise<{
    api: Array<{ at: string; method: string; path: string; status: number; ms: number; detail: string }>;
    log: Array<{ at: string; level: string; message: string }>;
  }>;
  onConsoleApi: (
    listener: (line: { at: string; method: string; path: string; status: number; ms: number; detail: string }) => void,
  ) => () => void;
  onConsoleLog: (listener: (line: { at: string; level: string; message: string }) => void) => () => void;
  exportSummary: (
    format: 'xlsx' | 'docx',
    report: SummaryReport & { reportNote?: string; issueNotes?: Record<string, string> },
  ) => Promise<{ ok: true; path: string } | { ok: false; reason: 'cancelled' }>;
};

const api: ElectronApi = {
  getGithub: () => ipcRenderer.invoke('settings:getGithub'),
  saveGithub: (source) => ipcRenderer.invoke('settings:saveGithub', source),
  testGithub: (source) => ipcRenderer.invoke('settings:testGithub', source),
  getConnection: () => ipcRenderer.invoke('settings:getConnection'),
  saveConnection: (connection) => ipcRenderer.invoke('settings:saveConnection', connection),
  testConnection: (connection) => ipcRenderer.invoke('settings:testConnection', connection),
  getBoard: () => ipcRenderer.invoke('settings:getBoard'),
  saveBoard: (board) => ipcRenderer.invoke('settings:saveBoard', board),
  listDevelopers: () => ipcRenderer.invoke('developers:list'),
  getBoardRowPrefs: () => ipcRenderer.invoke('boardRows:get'),
  saveBoardRowPrefs: (prefs) => ipcRenderer.invoke('boardRows:save', prefs),
  getRightTool: () => ipcRenderer.invoke('rightTool:get'),
  getCloseToTray: () => ipcRenderer.invoke('app:getCloseToTray'),
  setCloseToTray: (value) => ipcRenderer.invoke('app:setCloseToTray', value),
  saveRightTool: (tool) => ipcRenderer.invoke('rightTool:save', tool),
  replaceDevelopers: (developers) => ipcRenderer.invoke('developers:replace', developers),
  listSavedBoards: () => ipcRenderer.invoke('boards:list'),
  replaceSavedBoards: (boards) => ipcRenderer.invoke('boards:replace', boards),
  getActiveBoard: () => ipcRenderer.invoke('boards:getActive'),
  setActiveBoard: (id) => ipcRenderer.invoke('boards:setActive', id),
  listIssueNoteLinks: () => ipcRenderer.invoke('notes:listLinks'),
  setIssueNoteLinks: (issueKey, participantIds) =>
    ipcRenderer.invoke('notes:setLinks', issueKey, participantIds),
  listColumns: () => ipcRenderer.invoke('columns:list'),
  replaceColumns: (columns) => ipcRenderer.invoke('columns:replace', columns),
  searchUsers: (query) => ipcRenderer.invoke('tracker:searchUsers', query),
  listBoards: (queue, known) => ipcRenderer.invoke('tracker:listBoards', queue, known),
  searchBoards: (query, queue, known) =>
    ipcRenderer.invoke('tracker:searchBoards', query, queue, known),
  getBoardColumns: (boardId) => ipcRenderer.invoke('tracker:getBoardColumns', boardId),
  listStatusTypes: () => ipcRenderer.invoke('tracker:statusTypes'),
  getBoardSprints: (boardId) => ipcRenderer.invoke('tracker:getBoardSprints', boardId),
  getTransitions: (issueKey) => ipcRenderer.invoke('tracker:getTransitions', issueKey),
  getIssueStory: (issueKey) => ipcRenderer.invoke('tracker:issueStory', issueKey),
  refreshIssue: (issueKey) => ipcRenderer.invoke('tracker:refreshIssue', issueKey),
  executeTransition: (issueKey, transitionId) =>
    ipcRenderer.invoke('tracker:executeTransition', issueKey, transitionId),
  refreshBoard: (boardLocalId) => ipcRenderer.invoke('board:refresh', boardLocalId),
  getLastBoard: (boardLocalId) => ipcRenderer.invoke('board:getLast', boardLocalId),
  readLog: () => ipcRenderer.invoke('log:read'),
  revealLog: () => ipcRenderer.invoke('log:reveal'),
  saveLastBoard: (matrix) => ipcRenderer.invoke('board:saveLast', matrix),
  listIssueNotes: () => ipcRenderer.invoke('notes:list'),
  setIssueNote: (issueKey, note) => ipcRenderer.invoke('notes:setIssue', issueKey, note),
  setDeveloperNote: (developerId, note) =>
    ipcRenderer.invoke('notes:setDeveloper', developerId, note),
  toggleIssueBookmark: (issueKey) => ipcRenderer.invoke('bookmarks:toggle', issueKey),
  listDeveloperTodos: (developerId) => ipcRenderer.invoke('todos:list', developerId),
  createDeveloperTodo: (developerId, title, body) =>
    ipcRenderer.invoke('todos:create', developerId, title, body),
  updateDeveloperTodo: (id, patch) => ipcRenderer.invoke('todos:update', id, patch),
  deleteDeveloperTodo: (id) => ipcRenderer.invoke('todos:delete', id),
  assignDraftToDeveloper: (draftId, developerId) =>
    ipcRenderer.invoke('drafts:assign', draftId, developerId),
  listDrafts: () => ipcRenderer.invoke('drafts:list'),
  createDraft: (title, body) => ipcRenderer.invoke('drafts:create', title, body),
  updateDraft: (id, title, body) => ipcRenderer.invoke('drafts:update', id, title, body),
  setDraftPeople: (id, peopleIds) => ipcRenderer.invoke('drafts:people', id, peopleIds),
  setDraftFavorite: (id, favorite) => ipcRenderer.invoke('drafts:favorite', id, favorite),
  setDraftDone: (id, done) => ipcRenderer.invoke('drafts:done', id, done),
  setDraftNote: (id, note) => ipcRenderer.invoke('drafts:note', id, note),
  deleteDraft: (id) => ipcRenderer.invoke('drafts:delete', id),
  exportBackup: (sections) => ipcRenderer.invoke('backup:export', sections),
  importBackup: (sections) => ipcRenderer.invoke('backup:import', sections),
  inspectBackup: () => ipcRenderer.invoke('backup:inspect'),
  importBackupPath: (filePath, sections) => ipcRenderer.invoke('backup:importPath', filePath, sections),
  listSnapshots: () => ipcRenderer.invoke('snapshots:list'),
  getSnapshot: (id) => ipcRenderer.invoke('snapshots:get', id),
  snapshotExists: (date) => ipcRenderer.invoke('snapshots:exists', date),
  createSnapshot: (date, replaceExisting) =>
    ipcRenderer.invoke('snapshots:create', date, replaceExisting),
  deleteSnapshot: (id) => ipcRenderer.invoke('snapshots:delete', id),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (body) => ipcRenderer.invoke('app:notify', body),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  updateAppFromRepo: () => ipcRenderer.invoke('app:updateFromRepo'),
  onAppUpdateProgress: (listener) => {
    const wrapped = (_event: unknown, message: string) => listener(message);
    ipcRenderer.on('app:updateProgress', wrapped);
    return () => ipcRenderer.removeListener('app:updateProgress', wrapped);
  },
  sessionLog: (level, message, extra) => ipcRenderer.send('log:write', level, message, extra),
  resetTrackerActivity: () => ipcRenderer.invoke('tracker:resetActivity'),
  beginBoardRefresh: () => ipcRenderer.invoke('tracker:beginBoardRefresh'),
  trackerUsage: () => ipcRenderer.invoke('tracker:usage'),
  storageStats: () => ipcRenderer.invoke('app:storageStats'),
  onTrackerActivity: (listener) => {
    const wrapped = (
      _event: unknown,
      state: { total: number; inflight: number; sinceRefresh: number; dayTotal: number },
    ) => listener(state);
    ipcRenderer.on('tracker:activity', wrapped);
    return () => ipcRenderer.removeListener('tracker:activity', wrapped);
  },
  onTrackerGate: (listener) => {
    const wrapped = (_event: unknown, state: { paused: boolean }) => listener(state);
    ipcRenderer.on('tracker:gate', wrapped);
    return () => ipcRenderer.removeListener('tracker:gate', wrapped);
  },
  pauseTracker: () => ipcRenderer.invoke('tracker:pause'),
  resumeTracker: () => ipcRenderer.invoke('tracker:resume'),
  abortTracker: () => ipcRenderer.invoke('tracker:abort'),
  listIssueChanges: () => ipcRenderer.invoke('changes:list'),
  dismissIssueChanges: (boardLocalId, issueKeys) =>
    ipcRenderer.invoke('changes:dismiss', boardLocalId, issueKeys),
  getSummaryNotes: (boardLocalId, participantId) =>
    ipcRenderer.invoke('summary:notes', boardLocalId, participantId),
  setSummaryReportNote: (boardLocalId, participantId, body) =>
    ipcRenderer.invoke('summary:setReportNote', boardLocalId, participantId, body),
  setSummaryIssueNote: (boardLocalId, participantId, issueKey, body) =>
    ipcRenderer.invoke('summary:setIssueNote', boardLocalId, participantId, issueKey, body),
  listSummaryCache: (boardLocalId) => ipcRenderer.invoke('summary:cached', boardLocalId),
  openSummary: (request) => ipcRenderer.invoke('summary:open', request),
  buildSummary: (request) => ipcRenderer.invoke('summary:build', request),
  refreshSummaryIssue: (request, issueKey, boardLocalId) =>
    ipcRenderer.invoke('summary:refreshIssue', request, issueKey, boardLocalId),
  onSummaryProgress: (listener) => {
    const wrapped = (
      _event: unknown,
      progress: { row: SummaryRow | null; index: number; total: number; requests: number },
    ) => listener(progress);
    ipcRenderer.on('summary:progress', wrapped);
    return () => ipcRenderer.removeListener('summary:progress', wrapped);
  },
  getConsole: () => ipcRenderer.invoke('console:history'),
  onConsoleApi: (listener) => {
    const wrapped = (
      _event: unknown,
      line: { at: string; method: string; path: string; status: number; ms: number; detail: string },
    ) => listener(line);
    ipcRenderer.on('console:api', wrapped);
    return () => ipcRenderer.removeListener('console:api', wrapped);
  },
  onConsoleLog: (listener) => {
    const wrapped = (_event: unknown, line: { at: string; level: string; message: string }) => listener(line);
    ipcRenderer.on('console:log', wrapped);
    return () => ipcRenderer.removeListener('console:log', wrapped);
  },
  exportSummary: (format, report) => ipcRenderer.invoke('summary:export', format, report),
};

contextBridge.exposeInMainWorld('api', api);
