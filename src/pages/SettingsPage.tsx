import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type {
  BoardColumnConfig,
  BoardConfig,
  Developer,
  SavedBoard,
  TrackerBoard,
  GithubSource,
  TrackerConnection,
  TrackerUser,
} from '@shared/types';
import { COLUMN_COLORS, DEFAULT_GITHUB, DEVELOPER_TONE_PRESETS, PARTICIPANT_ROLES, normalizeDeveloperTone } from '@shared/types';
import { sessionLog } from '../sessionLog';
import ColorField from '../components/ColorField';
import { ActivityIcon, BellOffIcon, DownloadIcon, InfoIcon, PlusIcon, RefreshIcon, TrashIcon, UploadIcon } from '../components/Icons';
import { DEFAULT_WORK_SCHEDULE, type WorkSchedule } from '../autoRefresh';

type SettingsTab = 'app' | 'integrations' | 'people' | 'boards' | 'backup';
type BackupChoice = {
  settings: boolean;
  tasks: boolean;
  summary: boolean;
  drafts: boolean;
};

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'app', label: 'Приложение' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'people', label: 'Участники' },
  { id: 'boards', label: 'Доски и колонки' },
  { id: 'backup', label: 'Импорт / экспорт' },
];

const BACKUP_OPTIONS: Array<[keyof BackupChoice, string]> = [
  ['settings', 'Настройки'],
  ['tasks', 'Задачи'],
  ['summary', 'Сводка'],
  ['drafts', 'Черновики'],
];

type Props = {
  connection: TrackerConnection;
  board: BoardConfig;
  developers: Developer[];
  columns: BoardColumnConfig[];
  boards: SavedBoard[];
  activeBoardId: number | null;
  onConnectionChange: (c: TrackerConnection) => void;
  onBoardChange: (b: BoardConfig) => void;
  onDevelopersChange: (d: Developer[]) => void;
  onColumnsChange: (c: BoardColumnConfig[]) => void;
  onBoardsChange: (boards: SavedBoard[]) => void;
  onActiveBoardChange: (id: number | null) => void;
  onReloadAll?: () => void;
  onError: (msg: string | null) => void;
  autoRefreshMinutes: number;
  autoSaveTime: string;
  workSchedule: WorkSchedule;
  onScheduleSave: (value: { minutes: number; autoSaveTime: string; schedule: WorkSchedule }) => void;
  initialSection?: SettingsTab;
};

export default function SettingsPage(props: Props) {
  const [connDraft, setConnDraft] = useState(props.connection);
  const [boardDraft, setBoardDraft] = useState(props.board);
  const [devDraft, setDevDraft] = useState<Array<Omit<Developer, 'id'> & { id?: number }>>(
    props.developers,
  );
  const [colDraft, setColDraft] = useState(props.columns);
  const columnDraftHold = useRef<BoardColumnConfig[] | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<TrackerUser[]>([]);
  const [savedBoards, setSavedBoards] = useState<SavedBoard[]>(props.boards);
  const [boardHits, setBoardHits] = useState<TrackerBoard[]>([]);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardSearchError, setBoardSearchError] = useState<string | null>(null);
  const [columnListsOpen, setColumnListsOpen] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [importSections, setImportSections] = useState<BackupChoice>(() => ({
    settings: false,
    tasks: false,
    summary: false,
    drafts: false,
  }));
  const [importReady, setImportReady] = useState<BackupChoice | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [exportSections, setExportSections] = useState<BackupChoice>(() => ({
    settings: true,
    tasks: false,
    summary: false,
    drafts: false,
  }));
  const [section, setSection] = useState<SettingsTab>(props.initialSection ?? 'app');
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const [notice, setNotice] = useState<{ section: SettingsTab; tone: 'ok' | 'err'; text: string } | null>(null);
  function publishOk(text: string) {
    const where = sectionRef.current;
    setNotice({ section: where, tone: 'ok', text });
    sessionLog('info', 'settings', { section: where, text });
  }
  function publishErr(error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    const where = sectionRef.current;
    setNotice({ section: where, tone: 'err', text });
    sessionLog('error', 'settings', { section: where, text });
  }
  const [githubDraft, setGithubDraft] = useState<GithubSource>(DEFAULT_GITHUB);
  const [githubSaved, setGithubSaved] = useState<GithubSource>(DEFAULT_GITHUB);
  const [appInfo, setAppInfo] = useState<{ name: string; version: string; headerVersion: string }>({
    name: 'BroTeam',
    version: '',
    headerVersion: '',
  });

  useEffect(() => setConnDraft(props.connection), [props.connection]);
  useEffect(() => setBoardDraft(props.board), [props.board]);
  useEffect(() => setSavedBoards(props.boards), [props.boards]);
  useEffect(() => setDevDraft(props.developers), [props.developers]);
  useEffect(() => {
    if (columnDraftHold.current) {
      setColDraft(columnDraftHold.current);
      columnDraftHold.current = null;
      return;
    }
    setColDraft(props.columns);
  }, [props.columns]);
  useEffect(() => {
    void window.api.getAppInfo().then(setAppInfo).catch(() => undefined);
    void window.api.getGithub().then((value) => {
      setGithubDraft(value);
      setGithubSaved(value);
    }).catch(() => undefined);
  }, []);

  async function saveGithub() {
    setBusy(true);
    props.onError(null);
    try {
      const saved = await window.api.saveGithub(githubDraft);
      setGithubDraft(saved);
      setGithubSaved(saved);
      publishOk('Источник сохранён');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function testGithub() {
    setBusy(true);
    props.onError(null);
    try {
      await window.api.testGithub(githubDraft);
      publishOk('Репозиторий доступен');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection() {
    setBusy(true);
    props.onError(null);
    try {
      const saved = await window.api.saveConnection(connDraft);
      props.onConnectionChange(saved);
      publishOk('Подключение сохранено');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    props.onError(null);
    try {
      const me = await window.api.testConnection(connDraft);
      publishOk(`OK: ${me.display} (${me.login})`);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function searchUsers() {
    setBusy(true);
    props.onError(null);
    try {
      const users = await window.api.searchUsers(userQuery);
      setUserResults(users);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  function addDeveloper(user: TrackerUser, role: Developer['role']) {
    if (devDraft.some((d) => d.login === user.login || String(d.uid) === String(user.uid))) return;
    setDevDraft((prev) => [
      ...prev,
      {
        login: user.login,
        displayName: user.display,
        uid: String(user.uid),
        color: 'auto',
        sortOrder: prev.length,
        role,
        onVacation: false,
        hidden: false,
      },
    ]);
    setUserResults([]);
    setUserQuery('');
  }

  function addContact() {
    setDevDraft((prev) => [
      ...prev,
      {
        login: `contact-${Date.now()}`,
        displayName: '',
        uid: '',
        color: 'auto',
        sortOrder: prev.length,
        role: 'contact',
        onVacation: false,
        hidden: false,
      },
    ]);
  }

  async function saveDevelopers() {
    setBusy(true);
    try {
      const saved = await window.api.replaceDevelopers(devDraft);
      props.onDevelopersChange(saved);
      publishOk('Участники сохранены');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    props.onError(null);
    try {
      const result = await window.api.exportBackup(exportSections);
      if (result.ok) publishOk(`Экспорт сохранён: ${result.path}`);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function chooseImportFile() {
    setBusy(true);
    props.onError(null);
    try {
      const result = await window.api.inspectBackup();
      if (!result.ok) return;
      setImportPath(result.path);
      setImportReady(result.found);
      setImportSections(result.found);
      if (!Object.values(result.found).some(Boolean)) publishOk('Не найдено данных для импорта.');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function importBackup() {
    if (!importPath) return;
    const ok = window.confirm(
      'Импорт заменит выбранные разделы данными из файла. Продолжить?',
    );
    if (!ok) return;
    setBusy(true);
    props.onError(null);
    try {
      const result = await window.api.importBackupPath(importPath, importSections);
      if (!result.ok) return;
      publishOk(`Импортировано: ${result.applied.join(', ')}`);
      // Refresh local drafts of settings from DB
      const [boardCfg, devs, cols, nextBoards, activeId] = await Promise.all([
        window.api.getBoard(),
        window.api.listDevelopers(),
        window.api.listColumns(),
        window.api.listSavedBoards(),
        window.api.getActiveBoard(),
      ]);
      setBoardDraft(boardCfg);
      setDevDraft(devs);
      setColDraft(cols);
      setSavedBoards(nextBoards);
      props.onBoardChange(boardCfg);
      props.onDevelopersChange(devs);
      props.onColumnsChange(cols);
      props.onBoardsChange(nextBoards);
      props.onActiveBoardChange(activeId);
      props.onReloadAll?.();
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function searchBoards() {
    const q = boardSearch.trim();
    if (!q) {
      setBoardHits([]);
      setBoardSearchError('Введите точный id доски или точный ключ очереди');
      return;
    }
    if (!/^\d+$/.test(q) && !/^[A-Za-z][A-Za-z0-9_-]{0,50}$/.test(q)) {
      setBoardSearchError('Нужен точный id доски или точный ключ очереди');
      return;
    }
    setBusy(true);
    setBoardSearchError(null);
    try {
      const known = savedBoards.map((board) => ({
        id: board.trackerBoardId,
        name: board.name,
        queueKey: board.queueKey || null,
      }));
      const list = await window.api.searchBoards(q, undefined, known);
      setBoardHits(list);
      if (!list.length) setBoardSearchError('Ничего не найдено');
    } catch (e) {
      setBoardHits([]);
      setBoardSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addFoundBoard(board: TrackerBoard) {
    if (savedBoards.some((item) => item.trackerBoardId === board.id)) return;
    setBusy(true);
    props.onError(null);
    try {
      const next = await window.api.replaceSavedBoards([
        ...savedBoards,
        {
          trackerBoardId: board.id,
          name: board.name,
          alias: '',
          color: '',
          queueKey: board.queueKey || '',
          enabled: true,
          sortOrder: savedBoards.length,
        },
      ]);
      setSavedBoards(next);
      props.onBoardsChange(next);
      const added = next.find((item) => item.trackerBoardId === board.id);
      if (added && (props.activeBoardId == null || !next.some((item) => item.id === props.activeBoardId))) {
        const active = await window.api.setActiveBoard(added.id);
        props.onActiveBoardChange(active);
        const cfg = await window.api.getBoard();
        props.onBoardChange(cfg);
        setBoardDraft(cfg);
      }
      setBoardHits([]);
      setBoardSearch('');
      if (added) await loadColumns(added.id, added.trackerBoardId);
      publishOk(`Добавлена доска ${board.name}#${board.id}`);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function patchBoards(next: SavedBoard[]) {
    props.onError(null);
    const saved = await window.api.replaceSavedBoards(next);
    setSavedBoards(saved);
    props.onBoardsChange(saved);
    const activeStill = saved.some((board) => board.id === props.activeBoardId && board.enabled);
    const fallback = saved.find((board) => board.enabled) || saved[0];
    if (!activeStill && fallback) {
      const active = await window.api.setActiveBoard(fallback.id);
      props.onActiveBoardChange(active);
    } else if (!saved.length) {
      props.onActiveBoardChange(null);
    }
    const cfg = await window.api.getBoard();
    props.onBoardChange(cfg);
    setBoardDraft(cfg);
    return saved;
  }

  async function removeBoard(localId: number) {
    setBusy(true);
    props.onError(null);
    try {
      const nextColumns = colDraft.filter((column) => column.boardLocalId !== localId);
      setColDraft(nextColumns);
      await patchBoards(savedBoards.filter((item) => item.id !== localId));
      const savedCols = await window.api.replaceColumns(nextColumns);
      setColDraft(savedCols);
      props.onColumnsChange(savedCols);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadColumns(localId: number, trackerBoardId: number) {
    setBusy(true);
    props.onError(null);
    try {
      const cols = await window.api.getBoardColumns(trackerBoardId);
      const mapped: BoardColumnConfig[] = [];
      let colorIdx = 0;
      for (const col of cols) {
        for (const status of col.statuses.length ? col.statuses : [{ key: col.id, display: col.name }]) {
          mapped.push({
            id: 0,
            columnId: col.id,
            columnName: col.name,
            statusKey: status.key,
            statusDisplay: status.display,
            alias: shortAlias(status.display || col.name),
            color: COLUMN_COLORS[colorIdx % COLUMN_COLORS.length],
            enabled: true,
            sortOrder: mapped.length,
            boardLocalId: localId,
          });
          colorIdx += 1;
        }
      }
      const savedForBoard = props.columns
        .filter((column) => column.boardLocalId === localId)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const savedByKey = new Map(savedForBoard.map((column) => [column.statusKey, column]));
      const ordered: BoardColumnConfig[] = [];
      for (const saved of savedForBoard) {
        const incoming = mapped.find((column) => column.statusKey === saved.statusKey);
        if (!incoming) continue;
        ordered.push({
          ...saved,
          columnId: incoming.columnId,
          columnName: incoming.columnName,
          statusDisplay: incoming.statusDisplay,
          enabled: true,
          sortOrder: ordered.length,
        });
      }
      for (const incoming of mapped) {
        if (savedByKey.has(incoming.statusKey)) continue;
        ordered.push({ ...incoming, sortOrder: ordered.length });
      }
      const draftByKey = new Map(
        colDraft.map((column) => [`${column.boardLocalId}:${column.statusKey}`, column]),
      );
      const withDraftEdits = (columns: BoardColumnConfig[]) =>
        columns.map((column) => {
          const edited = draftByKey.get(`${column.boardLocalId}:${column.statusKey}`);
          if (!edited || (edited.alias === column.alias && edited.color === column.color)) return column;
          return { ...column, alias: edited.alias, color: edited.color };
        });
      if (sameColumnStructure(savedForBoard, ordered)) {
        setColDraft((prev) => [
          ...prev.filter((column) => column.boardLocalId !== localId),
          ...withDraftEdits(ordered),
        ]);
        publishOk(`Колонки доски обновлены: ${ordered.length}`);
        return;
      }
      const others = props.columns.filter((column) => column.boardLocalId !== localId);
      const savedCols = await window.api.replaceColumns([...others, ...ordered]);
      const overlay = withDraftEdits(savedCols);
      columnDraftHold.current = overlay;
      props.onColumnsChange(savedCols);
      setColDraft(overlay);
      publishOk(`Колонки сохранены: ${ordered.length}`);
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveBoardSettings() {
    setBusy(true);
    try {
      const savedBoardsNow = await window.api.replaceSavedBoards(savedBoards);
      setSavedBoards(savedBoardsNow);
      props.onBoardsChange(savedBoardsNow);
      const active =
        savedBoardsNow.find((board) => board.id === props.activeBoardId && board.enabled) ||
        savedBoardsNow.find((board) => board.enabled) ||
        null;
      if (active) {
        const id = await window.api.setActiveBoard(active.id);
        props.onActiveBoardChange(id);
      }
      const cleaned = {
        ...boardDraft,
        boardId: active?.trackerBoardId ?? boardDraft.boardId,
        boardName: active?.name || boardDraft.boardName,
        queueKey: active?.queueKey || boardDraft.queueKey,
        sprintIds: [],
        qaFilterNames: [],
      };
      const savedBoard = await window.api.saveBoard(cleaned);
      const savedCols = await window.api.replaceColumns(colDraft);
      props.onBoardChange(savedBoard);
      props.onColumnsChange(savedCols);
      setBoardDraft(savedBoard);
      setColDraft(savedCols);
      publishOk('Настройки доски сохранены');
    } catch (e) {
      publishErr(e);
    } finally {
      setBusy(false);
    }
  }

  const connectionDirty = JSON.stringify(connDraft) !== JSON.stringify(props.connection);
  const githubDirty = githubDraft.remote !== githubSaved.remote || githubDraft.branch !== githubSaved.branch;
  const developersDirty = JSON.stringify(devDraft) !== JSON.stringify(props.developers);
  const boardsDirty =
    Boolean(boardDraft.columnHeadersNoWrap) !== Boolean(props.board.columnHeadersNoWrap) ||
    JSON.stringify(colDraft) !== JSON.stringify(props.columns) ||
    JSON.stringify(savedBoards.map((board) => ({ id: board.id, alias: board.alias || '', color: board.color || '' }))) !==
      JSON.stringify(props.boards.map((board) => ({ id: board.id, alias: board.alias || '', color: board.color || '' })));

  return (
    <div className="flex w-full items-start gap-6">
      <nav className="sticky top-0 flex w-52 shrink-0 flex-col gap-1">
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-md px-3 py-2 text-left text-sm ${
              section === item.id
                ? 'bg-sky-600 font-semibold text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 space-y-4">
      {notice && notice.section === section && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            notice.tone === 'err'
              ? 'border border-red-200 bg-red-50 text-red-800'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      {section === 'app' && (
      <SettingsSection title="Приложение">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-sm space-y-1">
            <span>Название</span>
            <input
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700"
              value={appInfo.name}
              readOnly
              tabIndex={-1}
            />
          </label>
          <label className="min-w-48 flex-1 text-sm space-y-1">
            <span>Версия</span>
            <input
              className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700"
              value={appInfo.version || '—'}
              readOnly
              tabIndex={-1}
            />
          </label>
          <AppUpdateButton />
        </div>
      </SettingsSection>
      )}

      {section === 'integrations' && (
      <>
      <SettingsSection title="Интеграция с Yandex Tracker">
        <p className="text-sm text-slate-600">
          Те же параметры, что у MCP-сервера: OAuth-токен и Cloud Org ID.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm space-y-1">
            <span>OAuth токен</span>
            <input
              type="password"
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={connDraft.token}
              onChange={(e) => setConnDraft({ ...connDraft, token: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="text-sm space-y-1">
            <span>Cloud Org ID</span>
            <input
              type="password"
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={connDraft.cloudOrgId}
              onChange={(e) => setConnDraft({ ...connDraft, cloudOrgId: e.target.value })}
              autoComplete="off"
            />
          </label>
          <label className="text-sm space-y-1">
            <span>Org ID (опционально)</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={connDraft.orgId}
              onChange={(e) => setConnDraft({ ...connDraft, orgId: e.target.value })}
            />
          </label>
          <label className="text-sm space-y-1">
            <span>API URL</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={connDraft.apiUrl}
              onChange={(e) => setConnDraft({ ...connDraft, apiUrl: e.target.value })}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveActions
            dirty={connectionDirty}
            busy={busy}
            onSave={() => void saveConnection()}
            onCancel={() => setConnDraft(props.connection)}
          />
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void testConnection()}
          >
            Проверить
          </button>
        </div>
      </SettingsSection>
      <SettingsSection title="Источник на GitHub">
        <p className="text-sm text-slate-600">
          Репозиторий и ветка, откуда читается номер версии. Файлы обновления берутся из релизов GitHub.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm space-y-1">
            <span>Репозиторий</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={githubDraft.remote}
              onChange={(e) => setGithubDraft({ ...githubDraft, remote: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="text-sm space-y-1">
            <span>Ветка</span>
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              value={githubDraft.branch}
              onChange={(e) => setGithubDraft({ ...githubDraft, branch: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveActions
            dirty={githubDirty}
            busy={busy}
            onSave={() => void saveGithub()}
            onCancel={() => setGithubDraft(githubSaved)}
          />
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void testGithub()}
          >
            Проверить
          </button>
        </div>
      </SettingsSection>
      </>
      )}

      {section === 'people' && (
      <SettingsSection title="Участники">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Поиск по логину или имени в Трекере"
            value={userQuery}
            onChange={(e) => {
              setUserQuery(e.target.value);
              if (!e.target.value.trim()) setUserResults([]);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void searchUsers()}
          />
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => void searchUsers()}
          >
            Найти
          </button>
        </div>
        {userQuery.trim() && userResults.length > 0 && (
          <ul className="max-h-40 overflow-auto rounded border border-slate-200 divide-y">
            {userResults.map((u) => (
              <li
                key={u.uid}
                className={`flex items-center justify-between px-3 py-2 text-sm ${
                  u.dismissed ? 'bg-slate-50 text-slate-400' : ''
                }`}
              >
                <span>
                  {u.display}{' '}
                  <span className={u.dismissed ? 'text-slate-400' : 'text-slate-500'}>
                    ({u.login}, uid …{String(u.uid).slice(-4)}
                    {u.email ? `, ${u.email}` : ''}
                    {u.dismissed ? ', уволен' : ''})
                  </span>
                </span>
                {u.dismissed ? (
                  <span className="text-slate-400">Недоступен</span>
                ) : (
                  <select
                    className="h-8 rounded border border-slate-300 px-2 text-sm"
                    value=""
                    aria-label={`Роль для ${u.display}`}
                    onChange={(event) => {
                      const role = event.target.value as Developer['role'];
                      if (!role) return;
                      addDeveloper(u, role);
                    }}
                  >
                    <option value="">Роль</option>
                    {PARTICIPANT_ROLES.filter((role) => role.id !== 'contact').map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2">
          {devDraft.map((d, index) => (
              <div key={d.login || index} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
                <ToneSelect
                  value={d.color}
                  unavailable={Boolean(d.onVacation)}
                  onChange={(color) => {
                    const next = [...devDraft];
                    next[index] = { ...d, color, onVacation: false };
                    setDevDraft(next);
                  }}
                  onUnavailable={() => {
                    const next = [...devDraft];
                    next[index] = { ...d, onVacation: true };
                    setDevDraft(next);
                  }}
                />
                <input
                  className="h-8 w-56 shrink-0 rounded border border-slate-300 px-2 text-sm"
                  value={d.displayName}
                  placeholder={d.role === 'contact' ? 'Имя контакта' : 'Имя'}
                  onChange={(e) => {
                    const next = [...devDraft];
                    next[index] = { ...d, displayName: e.target.value };
                    setDevDraft(next);
                  }}
                />
                <select
                  className="h-8 w-36 shrink-0 rounded border border-slate-300 px-2 text-sm"
                  value={d.role}
                  aria-label="Роль"
                  onChange={(e) => {
                    const next = [...devDraft];
                    next[index] = { ...d, role: e.target.value as Developer['role'] };
                    setDevDraft(next);
                  }}
                >
                  {PARTICIPANT_ROLES.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
                {d.role !== 'contact' && (
                  <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-400"
                    title={[d.login, d.uid ? `uid ${d.uid}` : ''].filter(Boolean).join('\n')}
                  >
                    <InfoIcon className="h-4 w-4" />
                  </span>
                )}
                <button
                  type="button"
                  title="Удалить"
                  className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-300 text-red-600 hover:bg-red-50"
                  onClick={() => setDevDraft(devDraft.filter((_, i) => i !== index))}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveActions
            dirty={developersDirty}
            busy={busy}
            label="Сохранить участников"
            onSave={() => void saveDevelopers()}
            onCancel={() => setDevDraft(props.developers)}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:bg-amber-100"
            disabled={busy}
            onClick={addContact}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Внешний участник
          </button>
        </div>
      </SettingsSection>
      )}

      {section === 'boards' && (
      <>
      <SchedulePanel
        autoSaveTime={props.autoSaveTime}
        minutes={props.autoRefreshMinutes}
        schedule={props.workSchedule}
        busy={busy}
        onSave={props.onScheduleSave}
      />
      <SettingsSection title="Доски и колонки">

        <div className="space-y-2">
          <p className="text-xs text-slate-500">Точный id доски или точный ключ очереди.</p>
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[220px] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
              placeholder="ID доски или ключ очереди"
              value={boardSearch}
              onChange={(e) => {
                const value = e.target.value;
                setBoardSearch(value);
                if (!value.trim()) {
                  setBoardHits([]);
                  setBoardSearchError(null);
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && void searchBoards()}
            />
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={busy}
              onClick={() => void searchBoards()}
            >
              Найти
            </button>
          </div>
          {boardSearchError && <p className="text-xs text-red-600">{boardSearchError}</p>}
          {boardSearch.trim() && boardHits.length > 0 && (
            <ul className="max-h-36 overflow-auto rounded border border-slate-200 divide-y text-sm">
              {boardHits.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span>
                    {b.name}#{b.id}
                    {b.queueKey ? ` (${b.queueKey})` : ''}
                  </span>
                  <button
                    type="button"
                    className="text-emerald-700 underline"
                    onClick={() => void addFoundBoard(b)}
                  >
                    Добавить
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(boardDraft.columnHeadersNoWrap)}
            onChange={(e) =>
              setBoardDraft({ ...boardDraft, columnHeadersNoWrap: e.target.checked })
            }
          />
          Не переносить заголовки колонок в таблице на новую строку
        </label>

        <div className="space-y-3">
          {savedBoards.map((board) => {
            const boardColumns = colDraft.filter((c) => c.boardLocalId === board.id);
            const columnsOpen = columnListsOpen[board.id] === true;
            return (
              <div key={board.id} className="overflow-hidden rounded border border-slate-200">
                <div
                  className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-100"
                  onClick={() =>
                    setColumnListsOpen((prev) => ({ ...prev, [board.id]: !columnsOpen }))
                  }
                >
                  <button
                    type="button"
                    title={boardColumns.length ? 'Обновить колонки' : 'Загрузить колонки'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 disabled:opacity-50"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadColumns(board.id, board.trackerBoardId);
                    }}
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </button>
                  <span className="min-w-0 truncate font-medium text-slate-900">
                    {board.name}#{board.trackerBoardId}
                  </span>
                  <span onClick={(event) => event.stopPropagation()}>
                    <ColorField
                      value={board.color || '#64748b'}
                      onChange={(hex) => {
                        setSavedBoards((prev) =>
                          prev.map((item) => (item.id === board.id ? { ...item, color: hex } : item)),
                        );
                      }}
                    />
                  </span>
                  <input
                    className="h-7 w-36 shrink-0 rounded border border-slate-300 px-2 text-xs"
                    placeholder="Своё название"
                    value={board.alias || ''}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const alias = event.target.value;
                      setSavedBoards((prev) =>
                        prev.map((item) => (item.id === board.id ? { ...item, alias } : item)),
                      );
                    }}
                    onBlur={(event) => {
                      const alias = event.target.value;
                      void patchBoards(
                        savedBoards.map((item) => (item.id === board.id ? { ...item, alias } : item)),
                      );
                    }}
                  />
                  {board.queueKey ? <span className="shrink-0 text-slate-500">({board.queueKey})</span> : null}
                  <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-slate-600">
                    {boardColumns.length}
                  </span>
                  <button
                    type="button"
                    title="Удалить"
                    className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-300 text-red-600 hover:bg-red-50"
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeBoard(board.id);
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                {columnsOpen && (
                <div className="space-y-1 border-t border-slate-100 px-2 py-2">
                  {boardColumns.map((c) => {
                    const index = colDraft.findIndex(
                      (item) => item.boardLocalId === c.boardLocalId && item.statusKey === c.statusKey,
                    );
                    return (
                      <div
                        key={`${c.boardLocalId}-${c.statusKey}`}
                        className="flex items-center gap-2 rounded border border-slate-100 p-2 text-sm"
                      >
                        <ColorField
                          value={c.color}
                          onChange={(hex) => {
                            const next = [...colDraft];
                            next[index] = { ...c, color: hex };
                            setColDraft(next);
                          }}
                        />
                        <input
                          className="h-8 w-56 shrink-0 rounded border border-slate-300 px-2"
                          value={c.alias}
                          onChange={(e) => {
                            const next = [...colDraft];
                            next[index] = { ...c, alias: e.target.value };
                            setColDraft(next);
                          }}
                        />
                        <div className="min-w-0 flex-1 truncate text-slate-600" title={`${c.columnName} / ${c.statusDisplay}`}>
                          {c.columnName} → {c.statusDisplay}{' '}
                          <span className="text-xs">({c.statusKey})</span>
                        </div>
                      </div>
                    );
                  })}
                  {!boardColumns.length && (
                    <div className="text-sm text-slate-500">Колонки ещё не загружены</div>
                  )}
                </div>
                )}
              </div>
            );
          })}
          {!savedBoards.length && (
            <div className="text-sm text-slate-500">Добавьте хотя бы одну доску</div>
          )}
        </div>

        <SaveActions
          dirty={boardsDirty}
          busy={busy}
          label="Сохранить доски"
          onSave={() => void saveBoardSettings()}
          onCancel={() => {
            setBoardDraft(props.board);
            setColDraft(props.columns);
            setSavedBoards(props.boards);
          }}
        />
      </SettingsSection>
      </>
      )}

      {section === 'backup' && (
      <>
        <p className="text-xs text-slate-500">
          Перенос данных между установками. Токен и подключение к Tracker не входят в файл.
          «Задачи» — текущее сохранение доски и заметки к задачам. «Сводка» — последняя повседневная сводка.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
        <SettingsSection title="Импорт">
          <BackupChecks
            sections={importSections}
            enabled={importReady ?? { settings: false, tasks: false, summary: false, drafts: false }}
            onChange={(key, checked) => setImportSections((current) => ({ ...current, [key]: checked }))}
          />
          {importReady && !Object.values(importReady).some(Boolean) && (
            <p className="text-sm text-slate-500">Не найдено данных для импорта.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void chooseImportFile()}
            >
              <DownloadIcon className="h-4 w-4" />
              Выбрать файл
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy || !importPath || !Object.values(importSections).some(Boolean)}
              onClick={() => void importBackup()}
            >
              Применить
            </button>
          </div>
        </SettingsSection>
        <SettingsSection title="Экспорт">
          <BackupChecks
            sections={exportSections}
            onChange={(key, checked) => setExportSections((current) => ({ ...current, [key]: checked }))}
          />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy || !Object.values(exportSections).some(Boolean)}
            onClick={() => void exportBackup()}
          >
            <UploadIcon className="h-4 w-4" />
            Выгрузить
          </button>
        </SettingsSection>
        </div>
      </>
      )}
      </div>
    </div>
  );
}

function useDismiss(open: boolean, rootRef: RefObject<HTMLDivElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeRef.current();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, rootRef]);
}

function ToneSelect(props: {
  value: string;
  unavailable: boolean;
  onChange: (color: string) => void;
  onUnavailable: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const tone = normalizeDeveloperTone(props.value);
  const current = DEVELOPER_TONE_PRESETS[tone];
  const title = props.unavailable ? 'Unavailable' : current.label;
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuH = 248;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < menuH && rect.top > menuH ? rect.top - menuH - 4 : rect.bottom + 4;
      setPos({ top, left: Math.min(rect.left, window.innerWidth - 176) });
    }
    setOpen((value) => !value);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 bg-white"
        style={!props.unavailable && current.hex ? { backgroundColor: current.hex } : undefined}
        onClick={toggle}
      >
        {props.unavailable ? (
          <BellOffIcon className="h-4 w-4 text-slate-400" />
        ) : (
          tone === 'auto' && <ActivityIcon className="h-4 w-4 text-slate-500" />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[80] w-40 rounded border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {Object.entries(DEVELOPER_TONE_PRESETS).map(([id, preset]) => (
              <button
                key={id}
                type="button"
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  props.onChange(id);
                  setOpen(false);
                }}
              >
                {id === 'auto' ? (
                  <ActivityIcon className="h-3.5 w-3.5 text-slate-500" />
                ) : (
                  <ToneSwatch hex={preset.hex} />
                )}
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                props.onUnavailable();
                setOpen(false);
              }}
            >
              <BellOffIcon className="h-3.5 w-3.5 text-slate-400" />
              Unavailable
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

function ToneSwatch(props: { hex: string | null }) {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded border border-slate-300"
      style={props.hex ? { backgroundColor: props.hex } : { background: 'linear-gradient(135deg, #fff 45%, #94a3b8 45% 55%, #fff 55%)' }}
    />
  );
}

const WEEKDAYS: Array<{ id: number; label: string }> = [
  { id: 1, label: 'Пн' },
  { id: 2, label: 'Вт' },
  { id: 3, label: 'Ср' },
  { id: 4, label: 'Чт' },
  { id: 5, label: 'Пт' },
  { id: 6, label: 'Сб' },
  { id: 7, label: 'Вс' },
];

function SchedulePanel(props: {
  autoSaveTime: string;
  minutes: number;
  schedule: WorkSchedule;
  busy: boolean;
  onSave: (value: { minutes: number; autoSaveTime: string; schedule: WorkSchedule }) => void;
}) {
  const savedKey = JSON.stringify({
    autoSaveTime: props.autoSaveTime,
    minutes: props.minutes,
    schedule: props.schedule,
  });
  const [draft, setDraft] = useState({
    autoSaveTime: props.autoSaveTime,
    minutes: props.minutes,
    schedule: props.schedule,
  });
  useEffect(() => {
    setDraft({
      autoSaveTime: props.autoSaveTime,
      minutes: props.minutes,
      schedule: props.schedule,
    });
  }, [savedKey, props.autoSaveTime, props.minutes, props.schedule]);
  const dirty = JSON.stringify(draft) !== savedKey;
  const schedule = draft.schedule;
  return (
    <SettingsSection title="Автосохранение и автообновление">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        Автосохранение
        <input
          type="time"
          className="h-8 rounded border border-slate-300 px-2 text-sm"
          value={draft.autoSaveTime}
          onChange={(event) => setDraft({ ...draft, autoSaveTime: event.target.value || '12:00' })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        Интервал автообновления, мин
        <input
          type="number"
          min={1}
          max={240}
          className="h-8 w-20 rounded border border-slate-300 px-2 text-sm"
          value={draft.minutes}
          onChange={(event) => {
            const next = Math.round(Number(event.target.value));
            if (!Number.isFinite(next)) return;
            setDraft({ ...draft, minutes: Math.min(240, Math.max(1, next)) });
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(event) =>
            setDraft({
              ...draft,
              schedule: { ...schedule, enabled: event.target.checked },
            })
          }
        />
        По рабочему графику
      </label>
      {schedule.enabled && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => {
              const on = schedule.days.includes(day.id);
              return (
                <button
                  key={day.id}
                  type="button"
                  aria-pressed={on}
                  className={`h-8 min-w-9 rounded-md px-2 text-sm ${
                    on ? 'bg-sky-600 font-semibold text-white' : 'border border-slate-300 bg-white text-slate-600'
                  }`}
                  onClick={() => {
                    const days = on
                      ? schedule.days.filter((item) => item !== day.id)
                      : [...schedule.days, day.id].sort((a, b) => a - b);
                    setDraft({ ...draft, schedule: { ...schedule, days } });
                  }}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span>с</span>
            <input
              type="time"
              className="h-8 rounded border border-slate-300 bg-white px-2 text-sm"
              value={schedule.start}
              onChange={(event) =>
                setDraft({ ...draft, schedule: { ...schedule, start: event.target.value || DEFAULT_WORK_SCHEDULE.start } })
              }
            />
            <span>до</span>
            <input
              type="time"
              className="h-8 rounded border border-slate-300 bg-white px-2 text-sm"
              value={schedule.end}
              onChange={(event) =>
                setDraft({ ...draft, schedule: { ...schedule, end: event.target.value || DEFAULT_WORK_SCHEDULE.end } })
              }
            />
          </div>
          <p className="text-xs text-slate-500">
            Обновление запускается только в выбранные дни и только внутри этого интервала.
            {schedule.end <= schedule.start ? ' Конец интервала должен быть позже начала.' : ''}
          </p>
        </div>
      )}
      <SaveActions
        dirty={dirty}
        busy={props.busy}
        onSave={() => props.onSave(draft)}
        onCancel={() =>
          setDraft({
            autoSaveTime: props.autoSaveTime,
            minutes: props.minutes,
            schedule: props.schedule,
          })
        }
      />
    </SettingsSection>
  );
}

function SaveActions(props: {
  dirty: boolean;
  busy: boolean;
  label?: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const ready = props.dirty && !props.busy;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={`rounded-md px-3 py-2 text-sm ${
          ready ? 'bg-slate-900 text-white' : 'cursor-default bg-slate-200 text-slate-400'
        }`}
        disabled={!ready}
        onClick={props.onSave}
      >
        {props.label || 'Сохранить'}
      </button>
      <button
        type="button"
        className={`rounded-md border px-3 py-2 text-sm ${
          ready ? 'border-slate-300 text-slate-700' : 'cursor-default border-slate-200 text-slate-300'
        }`}
        disabled={!ready}
        onClick={props.onCancel}
      >
        Отменить
      </button>
    </div>
  );
}

function SettingsSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-lg font-semibold text-slate-900">{props.title}</h2>
      </div>
      <div className="space-y-3 px-4 py-3">{props.children}</div>
    </section>
  );
}

function BackupChecks(props: {
  sections: BackupChoice;
  enabled?: BackupChoice;
  onChange: (key: keyof BackupChoice, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {BACKUP_OPTIONS.map(([key, label]) => {
        const locked = props.enabled ? !props.enabled[key] : false;
        return (
          <label key={key} className={`flex items-center gap-2 ${locked ? 'text-slate-400' : ''}`}>
            <input
              type="checkbox"
              checked={props.sections[key]}
              disabled={locked}
              onChange={(event) => props.onChange(key, event.target.checked)}
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}

function AppUpdateButton() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => window.api.onAppUpdateProgress(setText), []);
  return (
    <>
      <button
        type="button"
        className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setText('Проверяем…');
          void window.api
            .updateAppFromRepo()
            .then((result) => setText(result.message))
            .catch((error: unknown) => {
              const raw = error instanceof Error ? error.message : String(error);
              setText(raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''));
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Обновление…' : 'Проверить и обновить'}
      </button>
      {text && <p className="basis-full text-sm text-slate-700">{text}</p>}
    </>
  );
}

function sameColumnStructure(saved: BoardColumnConfig[], next: BoardColumnConfig[]): boolean {
  if (saved.length !== next.length) return false;
  const byKey = new Map(saved.map((column) => [column.statusKey, column]));
  for (const column of next) {
    const prev = byKey.get(column.statusKey);
    if (!prev) return false;
    if (
      prev.columnId !== column.columnId ||
      prev.columnName !== column.columnName ||
      prev.statusDisplay !== column.statusDisplay ||
      prev.enabled !== column.enabled
    ) {
      return false;
    }
  }
  return true;
}

function shortAlias(name: string): string {
  const map: Record<string, string> = {
    Новая: 'New',
    Открыт: 'Open',
    'Требуется информация': 'Info',
    'Цель заблокирована': 'Hold',
    'На доработку': 'Hold',
    'В работе': 'Active',
    'В работе, Разработка': 'Active',
    Ревью: 'Review',
    'Тестирование на DEV': 'Test',
    'Готово к релизу': 'Pre-Prod',
    'Можно тестировать': 'QA',
    'В тестирование': 'QA',
    Тестируется: 'Testing',
    Решен: 'Accept',
    Приемка: 'Accept',
    Закрыт: 'Closed',
  };
  return map[name] || name.slice(0, 10);
}
