import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type {
  BoardColumnConfig,
  BoardConfig,
  ColumnGroup,
  Developer,
  SavedBoard,
  TrackerBoard,
  GithubSource,
  TrackerConnection,
  TrackerUser,
} from '@shared/types';
import type { AppUpdateProgress } from '@shared/appUpdate';
import { freshBoardColumns } from '@shared/boardColumns';
import {
  applyBoardDrop,
  boardDragOrigin,
  coalesceColumns,
  columnSections,
  type BoardDrag,
  type BoardSlot,
  type ColumnSection,
} from '@shared/columnGroups';
import { excludedTypeKeys, typeIsExcluded } from '@shared/issueTypeFilter';
import { DEFAULT_GITHUB, DEVELOPER_TONE_PRESETS, PARTICIPANT_ROLES, hexTint, normalizeDeveloperTone } from '@shared/types';
import { sessionLog } from '../sessionLog';
import ColorField from '../components/ColorField';
import { ActivityIcon, ArrowDownIcon, ArrowRightIcon, BellOffIcon, DownloadIcon, InfoIcon, MoveIcon, PlusCircleIcon, PlusIcon, RefreshIcon, TrashIcon, UploadIcon } from '../components/Icons';
import { DEFAULT_WORK_SCHEDULE, type WorkSchedule } from '../autoRefresh';
import {
  DEFAULT_STORY_POINT_COLORS,
  STORY_POINT_MARKS,
  storyPointColors,
  defaultStoryPointCopy,
  type StoryPointCopy,
  type StoryPointMark,
} from '@shared/storyPoints';
import { useSaveStoryPointPalette, useStoryPointPalette } from '../storyPointPalette';

type SettingsTab = 'app' | 'integrations' | 'people' | 'boards' | 'points' | 'backup';
type BackupChoice = {
  settings: boolean;
  tasks: boolean;
  summary: boolean;
  drafts: boolean;
};

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'app', label: 'Приложение' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'boards', label: 'Доски' },
  { id: 'people', label: 'Участники' },
  { id: 'points', label: 'Story Points' },
  { id: 'backup', label: 'Импорт / экспорт' },
];

const BACKUP_OPTIONS: Array<[keyof BackupChoice, string]> = [
  ['settings', 'Настройки'],
  ['tasks', 'Задачи'],
  ['summary', 'Сводка'],
  ['drafts', 'Заметки'],
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
  groups: ColumnGroup[];
  onGroupsChange: (groups: ColumnGroup[]) => void;
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
  const [groupDraft, setGroupDraft] = useState(props.groups);
  const nextGroupId = useRef(-1);
  const columnDraftHold = useRef<BoardColumnConfig[] | null>(null);
  const listNodes = useRef(new Map<number, HTMLDivElement>());
  const dragReady = useRef(false);
  const dragStop = useRef<(() => void) | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => dragStop.current?.(), []);
  const [columnDrag, setColumnDrag] = useState<{
    boardId: number;
    drag: BoardDrag;
    slot: BoardSlot;
    label: string;
    x: number;
    y: number;
  } | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<TrackerUser[]>([]);
  const [savedBoards, setSavedBoards] = useState<SavedBoard[]>(props.boards);
  const [boardHits, setBoardHits] = useState<TrackerBoard[]>([]);
  const [boardSearch, setBoardSearch] = useState('');
  const [boardSearchError, setBoardSearchError] = useState<string | null>(null);
  const [boardTab, setBoardTab] = useState<number | null>(props.activeBoardId);
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
  const [issueTypes, setIssueTypes] = useState<Record<number, Array<{ key: string; display: string }>>>({});
  const [notice, setNotice] = useState<{ section: SettingsTab; block: string; tone: 'ok' | 'err'; text: string } | null>(null);
  function publishOk(block: string, text: string) {
    const where = sectionRef.current;
    setNotice({ section: where, block, tone: 'ok', text });
    sessionLog('info', 'settings', { section: where, block, text });
  }
  function publishErr(block: string, error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    const text = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
    const where = sectionRef.current;
    setNotice({ section: where, block, tone: 'err', text });
    sessionLog('error', 'settings', { section: where, block, text });
  }
  function noteFor(block: string) {
    if (!notice || notice.section !== section || notice.block !== block) return null;
    return (
      <div
        className={`rounded-md px-3 py-2 text-sm ${
          notice.tone === 'err'
            ? 'border border-red-200 bg-red-50 text-red-800'
            : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}
      >
        {notice.text}
      </div>
    );
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
    if (boardTab != null && savedBoards.some((board) => board.id === boardTab)) return;
    const next =
      savedBoards.find((board) => board.id === props.activeBoardId)?.id ?? savedBoards[0]?.id ?? null;
    setBoardTab(next);
  }, [savedBoards, boardTab, props.activeBoardId]);
  useEffect(() => {
    const board = savedBoards.find((item) => item.id === boardTab);
    if (!board || issueTypes[board.id]) return;
    void window.api
      .listBoardIssueTypes(board.trackerBoardId, board.queueKey)
      .then((types) => setIssueTypes((prev) => ({ ...prev, [board.id]: types })))
      .catch((error: unknown) => publishErr('boards', error));
  }, [boardTab, savedBoards, issueTypes]);
  useEffect(() => {
    if (columnDraftHold.current) {
      setColDraft(columnDraftHold.current);
      columnDraftHold.current = null;
      return;
    }
    setColDraft(props.columns);
  }, [props.columns]);
  useEffect(() => setGroupDraft(props.groups), [props.groups]);
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
      publishOk('github', 'Источник сохранён');
    } catch (e) {
      publishErr('github', e);
    } finally {
      setBusy(false);
    }
  }

  async function testGithub() {
    setBusy(true);
    props.onError(null);
    try {
      await window.api.testGithub(githubDraft);
      publishOk('github', 'Репозиторий доступен');
    } catch (e) {
      publishErr('github', e);
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
      publishOk('tracker', 'Подключение сохранено');
    } catch (e) {
      publishErr('tracker', e);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    props.onError(null);
    try {
      const me = await window.api.testConnection(connDraft);
      publishOk('tracker', `OK: ${me.display} (${me.login})`);
    } catch (e) {
      publishErr('tracker', e);
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
      publishErr('people', e);
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
        summary: role === 'developer' || role === 'qa',
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
        summary: false,
      },
    ]);
  }

  async function saveDevelopers() {
    setBusy(true);
    try {
      const saved = await window.api.replaceDevelopers(devDraft);
      props.onDevelopersChange(saved);
      publishOk('people', 'Участники сохранены');
    } catch (e) {
      publishErr('people', e);
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    props.onError(null);
    try {
      const result = await window.api.exportBackup(exportSections);
      if (result.ok) publishOk('export', `Экспорт сохранён: ${result.path}`);
    } catch (e) {
      publishErr('export', e);
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
      if (!Object.values(result.found).some(Boolean)) publishOk('import', 'Не найдено данных для импорта.');
    } catch (e) {
      publishErr('import', e);
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
      publishOk('import', `Импортировано: ${result.applied.join(', ')}`);
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
      publishErr('import', e);
    } finally {
      setBusy(false);
    }
  }

  async function searchBoards() {
    const q = boardSearch.trim();
    if (!q) {
      setBoardHits([]);
      setBoardSearchError('Введите название доски, ключ очереди или id');
      return;
    }
    const needle = q.toLowerCase();
    const local = savedBoards
      .filter((board) => {
        const alias = (board.alias || '').trim();
        return (
          String(board.trackerBoardId) === q ||
          board.name.toLowerCase().includes(needle) ||
          alias.toLowerCase().includes(needle) ||
          (board.queueKey || '').toLowerCase().includes(needle)
        );
      })
      .map((board) => ({
        id: board.trackerBoardId,
        name: (board.alias || '').trim() || board.name,
        queueKey: board.queueKey || null,
      }));
    const remoteOk = /^\d+$/.test(q) || /^[A-Za-z][A-Za-z0-9_-]{0,50}$/.test(q);
    setBusy(true);
    setBoardSearchError(null);
    try {
      let remote: TrackerBoard[] = [];
      if (remoteOk) {
        const known = savedBoards.map((board) => ({
          id: board.trackerBoardId,
          name: `${board.name} ${(board.alias || '').trim()}`.trim(),
          queueKey: board.queueKey || null,
        }));
        try {
          remote = await window.api.searchBoards(q, undefined, known);
        } catch (error) {
          if (!local.length) throw error;
        }
      }
      const byId = new Map<number, TrackerBoard>();
      for (const board of [...local, ...remote]) byId.set(board.id, board);
      const list = [...byId.values()];
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
          issueTypeFilter: '',
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
      if (added) {
        setBoardTab(added.id);
        await loadColumns(added.id, added.trackerBoardId, added.queueKey, added.issueTypeFilter);
      }
      publishOk('boards', `Добавлена доска ${board.name}#${board.id}`);
    } catch (e) {
      publishErr('boards', e);
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
      publishErr('boards', e);
    } finally {
      setBusy(false);
    }
  }

  async function loadColumns(
    localId: number,
    trackerBoardId: number,
    queueKey: string,
    issueTypeFilter: string,
  ) {
    setBusy(true);
    props.onError(null);
    try {
      const result = await window.api.getBoardColumns(
        trackerBoardId,
        queueKey,
        excludedTypeKeys(issueTypeFilter),
      );
      setIssueTypes((prev) => ({ ...prev, [localId]: result.issueTypes }));
      const mapped: BoardColumnConfig[] = freshBoardColumns(result.columns, localId).map((column) => ({
        ...column,
        id: 0,
      }));
      const savedForBoard = props.columns
        .filter((column) => column.boardLocalId === localId)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const grouped = new Map<string, BoardColumnConfig[]>();
      for (const saved of savedForBoard) {
        const list = grouped.get(saved.columnId) || [];
        list.push(saved);
        grouped.set(saved.columnId, list);
      }
      const ordered: BoardColumnConfig[] = [];
      const used = new Set<string>();
      for (const saved of savedForBoard) {
        if (used.has(saved.columnId)) continue;
        const incoming = mapped.find((column) => column.columnId === saved.columnId);
        if (!incoming) continue;
        used.add(saved.columnId);
        const group = grouped.get(saved.columnId) || [saved];
        const kept =
          group.find((column) => column.statusKey === incoming.statusKey) ||
          group.find((column) => column.statusDisplay === incoming.columnName) ||
          group[0];
        ordered.push({
          ...incoming,
          alias: kept.alias,
          groupId: kept.groupId ?? null,
          color: kept.color,
          duty: kept.duty,
          ownerRole: kept.ownerRole,
          enabled: true,
          sortOrder: ordered.length,
        });
      }
      for (const incoming of mapped) {
        if (used.has(incoming.columnId)) continue;
        ordered.push({ ...incoming, sortOrder: ordered.length });
      }
      const draftByKey = new Map(
        colDraft.map((column) => [`${column.boardLocalId}:${column.columnId}`, column]),
      );
      const withDraftEdits = (columns: BoardColumnConfig[]) =>
        columns.map((column) => {
          const edited = draftByKey.get(`${column.boardLocalId}:${column.columnId}`);
          if (
            !edited ||
            (edited.alias === column.alias &&
              edited.color === column.color &&
              (edited.duty || '') === (column.duty || '') &&
              (edited.ownerRole || '') === (column.ownerRole || ''))
          ) {
            return column;
          }
          return {
            ...column,
            alias: edited.alias,
            color: edited.color,
            duty: edited.duty,
            ownerRole: edited.ownerRole,
          };
        });
      if (sameColumnStructure(savedForBoard, ordered)) {
        setColDraft((prev) => [
          ...prev.filter((column) => column.boardLocalId !== localId),
          ...withDraftEdits(ordered),
        ]);
        publishOk('boards', `Колонки доски обновлены: ${ordered.length}`);
        return;
      }
      const others = props.columns.filter((column) => column.boardLocalId !== localId);
      const savedCols = await window.api.replaceColumns([...others, ...ordered]);
      const overlay = withDraftEdits(savedCols);
      columnDraftHold.current = overlay;
      props.onColumnsChange(savedCols);
      setColDraft(overlay);
      publishOk('boards', `Колонки сохранены: ${ordered.length}`);
    } catch (e) {
      publishErr('boards', e);
    } finally {
      setBusy(false);
    }
  }

  function stageBoardLayout(boardId: number, nextBoardColumns: BoardColumnConfig[], nextGroups: ColumnGroup[]) {
    setColDraft((prev) => [...prev.filter((column) => column.boardLocalId !== boardId), ...nextBoardColumns]);
    setGroupDraft((prev) => [...prev.filter((group) => group.boardLocalId !== boardId), ...nextGroups]);
  }
  const stageLayoutRef = useRef(stageBoardLayout);
  stageLayoutRef.current = stageBoardLayout;
  const draftsRef = useRef({ columns: colDraft, groups: groupDraft });
  draftsRef.current = { columns: colDraft, groups: groupDraft };
  useLayoutEffect(() => {
    dragReady.current = columnDrag != null;
  }, [columnDrag]);

  function beginColumnGrip(
    event: ReactPointerEvent<HTMLElement>,
    boardId: number,
    drag: BoardDrag,
    label: string,
    columns: BoardColumnConfig[],
    groups: ColumnGroup[],
  ) {
    if (event.button !== 0 || busy) return;
    const origin = boardDragOrigin(columns, groups, drag);
    const list = listNodes.current.get(boardId);
    if (!origin || !list) return;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let slot = origin;
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragStop.current = null;
      if (started) {
        const freshColumns = draftsRef.current.columns.filter((column) => column.boardLocalId === boardId);
        const freshGroups = draftsRef.current.groups.filter((group) => group.boardLocalId === boardId);
        const moved = applyBoardDrop(freshColumns, freshGroups, drag, slot);
        if (moved) stageLayoutRef.current(boardId, moved.columns, moved.groups);
      }
      dragReady.current = false;
      setColumnDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        setColumnDrag({ boardId, drag, slot: origin, label, x: ev.clientX, y: ev.clientY });
        return;
      }
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
      }
      if (!dragReady.current) return;
      const next = slotFromPointer(list, drag.kind, ev.clientX, ev.clientY);
      if (!next || sameBoardSlot(slot, next)) return;
      slot = next;
      setColumnDrag((prev) => (prev ? { ...prev, slot: next, x: ev.clientX, y: ev.clientY } : prev));
    };
    dragStop.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  async function saveBoardGroups(boardId: number, nextBoardColumns: BoardColumnConfig[], nextGroups: ColumnGroup[]) {
    const saved = await window.api.saveColumnGroups(
      boardId,
      nextGroups.map((group, index) => ({
        id: group.id > 0 ? group.id : undefined,
        name: group.name,
        color: group.color,
        sortOrder: index,
        collapsed: group.collapsed,
        statusKeys: nextBoardColumns
          .filter((column) => column.groupId === group.id)
          .map((column) => column.statusKey),
      })),
      nextBoardColumns.map((column) => column.statusKey),
    );
    return saved;
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
      const boardIds = new Set<number>();
      for (const column of colDraft) if (column.boardLocalId) boardIds.add(column.boardLocalId);
      for (const group of groupDraft) boardIds.add(group.boardLocalId);
      for (const group of props.groups) boardIds.add(group.boardLocalId);
      let stagedColumns = colDraft;
      let stagedGroups = groupDraft.filter((group) => !boardIds.has(group.boardLocalId));
      for (const boardId of boardIds) {
        const saved = await saveBoardGroups(
          boardId,
          stagedColumns.filter((column) => column.boardLocalId === boardId),
          groupDraft.filter((group) => group.boardLocalId === boardId),
        );
        const draftByKey = new Map(
          stagedColumns
            .filter((column) => column.boardLocalId === boardId)
            .map((column) => [column.statusKey, column]),
        );
        const merged = saved.columns.map((column) => {
          const edited = draftByKey.get(column.statusKey);
          if (!edited) return column;
          return {
            ...column,
            alias: edited.alias,
            color: edited.color,
            duty: edited.duty,
            ownerRole: edited.ownerRole,
          };
        });
        stagedColumns = [
          ...stagedColumns.filter((column) => column.boardLocalId !== boardId),
          ...merged.filter((column) => column.boardLocalId === boardId),
        ];
        stagedGroups = [
          ...stagedGroups,
          ...saved.groups.filter((group) => group.boardLocalId === boardId),
        ];
      }
      const savedCols = await window.api.replaceColumns(stagedColumns);
      props.onBoardChange(savedBoard);
      columnDraftHold.current = savedCols;
      props.onColumnsChange(savedCols);
      props.onGroupsChange(stagedGroups);
      setBoardDraft(savedBoard);
      setColDraft(savedCols);
      setGroupDraft(stagedGroups);
      publishOk('boards', 'Настройки доски сохранены');
    } catch (e) {
      publishErr('boards', e);
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
    JSON.stringify(savedBoards.map((board) => ({
      id: board.id,
      alias: board.alias || '',
      color: board.color || '',
      issueTypeFilter: board.issueTypeFilter || '',
    }))) !==
      JSON.stringify(props.boards.map((board) => ({
        id: board.id,
        alias: board.alias || '',
        color: board.color || '',
        issueTypeFilter: board.issueTypeFilter || '',
      }))) ||
    JSON.stringify(groupDraft) !== JSON.stringify(props.groups);

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

      {section === 'app' && (
      <>
      <SettingsSection title="Версия приложения">
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
      <SettingsSection title="Поведение">
        <CloseToTraySetting />
      </SettingsSection>
      </>
      )}

      {section === 'integrations' && (
      <>
      <SettingsSection title="Интеграция с Yandex Tracker" note={noteFor('tracker')}>
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
      <SettingsSection title="Источник на GitHub" note={noteFor('github')}>
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
      <SettingsSection title="Участники" note={noteFor('people')}>
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
                <label className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(d.summary)}
                    onChange={(e) => {
                      const next = [...devDraft];
                      next[index] = { ...d, summary: e.target.checked };
                      setDevDraft(next);
                    }}
                  />
                  Сводка
                </label>
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
      {columnDrag &&
        createPortal(
          <div
            ref={ghostRef}
            className="pointer-events-none fixed left-0 top-0 z-[10060] max-w-sm rounded-md border border-sky-600 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-lg"
            style={{ transform: `translate(${columnDrag.x + 14}px, ${columnDrag.y + 12}px)` }}
          >
            {columnDrag.label}
          </div>,
          document.body,
        )}
      <SchedulePanel
        autoSaveTime={props.autoSaveTime}
        minutes={props.autoRefreshMinutes}
        schedule={props.workSchedule}
        busy={busy}
        onSave={props.onScheduleSave}
      />
      <SettingsSection title="Добавленные доски" note={noteFor('boards')}>

        <div className="space-y-2">
          <p className="text-xs text-slate-500">Название доски, ключ очереди или id. Регистр не важен.</p>
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

        {savedBoards.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-slate-200">
            {savedBoards.map((board) => {
              const selected = board.id === boardTab;
              const label = (board.alias || '').trim() || board.name;
              return (
                <button
                  key={board.id}
                  type="button"
                  className={`border-b-2 px-3 py-1.5 text-sm ${
                    selected
                      ? 'border-slate-900 font-medium text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                  onClick={() => setBoardTab(board.id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-3">
          {savedBoards.map((board) => {
            if (board.id !== boardTab) return null;
            const boardColumns = colDraft
              .filter((c) => c.boardLocalId === board.id)
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
            const boardGroups = groupDraft
              .filter((group) => group.boardLocalId === board.id)
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
            return (
              <div key={board.id} className="overflow-hidden rounded border border-slate-200">
                <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <button
                    type="button"
                    title={boardColumns.length ? 'Обновить колонки' : 'Загрузить колонки'}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200 disabled:opacity-50"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadColumns(board.id, board.trackerBoardId, board.queueKey, board.issueTypeFilter);
                    }}
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </button>
                  <a
                    className="min-w-0 truncate font-medium text-slate-900 underline"
                    href={`https://tracker.yandex.ru/agile/board/${board.trackerBoardId}`}
                    title="Открыть доску в Трекере"
                    onClick={(event) => {
                      event.preventDefault();
                      void window.api.openExternal(
                        `https://tracker.yandex.ru/agile/board/${board.trackerBoardId}`,
                      );
                    }}
                  >
                    {board.name}#{board.trackerBoardId}
                  </a>
                  <span>
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
                    onChange={(event) => {
                      const alias = event.target.value;
                      setSavedBoards((prev) =>
                        prev.map((item) => (item.id === board.id ? { ...item, alias } : item)),
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
                    onClick={() => void removeBoard(board.id)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2 border-t border-slate-100 px-2 py-2">
                  <div className="space-y-1 pb-1">
                    <div className="text-xs text-slate-500">Типы задач</div>
                    {issueTypes[board.id] == null ? (
                      <p className="text-xs text-slate-500">Типы подгружаются при открытии доски.</p>
                    ) : issueTypes[board.id].length ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {issueTypes[board.id].map((type) => (
                          <label key={type.key} className="flex items-center gap-1.5 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={!typeIsExcluded(board.issueTypeFilter, type.key)}
                              onChange={() => {
                                const excluded = new Set(
                                  excludedTypeKeys(board.issueTypeFilter).map((key) => key.toLowerCase()),
                                );
                                const id = type.key.toLowerCase();
                                if (excluded.has(id)) excluded.delete(id);
                                else excluded.add(id);
                                const issueTypeFilter = issueTypes[board.id]
                                  .filter((item) => excluded.has(item.key.toLowerCase()))
                                  .map((item) => item.key)
                                  .join(',');
                                const next = savedBoards.map((item) =>
                                  item.id === board.id ? { ...item, issueTypeFilter } : item,
                                );
                                setSavedBoards(next);
                                void patchBoards(next).then(() =>
                                  loadColumns(board.id, board.trackerBoardId, board.queueKey, issueTypeFilter),
                                );
                              }}
                            />
                            {type.display}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Типы задач прочитать не удалось. Колонки остаются как на доске.
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
                      По умолчанию отмечены все. Снятый тип убирает его статусы из колонок.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 px-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      const id = nextGroupId.current;
                      nextGroupId.current -= 1;
                      stageBoardLayout(board.id, boardColumns, [
                        {
                          id,
                          boardLocalId: board.id,
                          name: 'Группа',
                          color: '#64748b',
                          sortOrder: 0,
                          collapsed: false,
                        },
                        ...boardGroups,
                      ]);
                    }}
                  >
                    <PlusCircleIcon className="h-4 w-4" />
                    Добавить группу
                  </button>
                  <div
                    ref={(node) => {
                      if (node) listNodes.current.set(board.id, node);
                      else listNodes.current.delete(board.id);
                    }}
                    className="flex flex-col gap-2"
                  >
                  {(() => {
                    const draggingHere = columnDrag?.boardId === board.id ? columnDrag : null;
                    const visual = sectionsWithout(columnSections(boardColumns, boardGroups), draggingHere?.drag ?? null);
                    const slot = draggingHere?.slot ?? null;
                    const changeColumn = (next: BoardColumnConfig) =>
                      setColDraft((prev) =>
                        prev.map((item) =>
                          item.boardLocalId === next.boardLocalId && item.statusKey === next.statusKey ? next : item,
                        ),
                      );
                    return (
                      <>
                        {slot?.kind === 'section' && slot.index === 0 && <InsertBar />}
                        {visual.map((section, index) => (
                          <Fragment key={section.kind === 'column' ? `col-${section.column.statusKey}` : `group-${section.group.id}`}>
                            {section.kind === 'column' ? (
                              <div data-board-section data-section-index={index}>
                                <ColumnEditorRow
                                  column={section.column}
                                  busy={busy}
                                  onGripDown={(event) =>
                                    beginColumnGrip(
                                      event,
                                      board.id,
                                      { kind: 'column', key: section.column.statusKey },
                                      section.column.alias || section.column.statusKey,
                                      boardColumns,
                                      boardGroups,
                                    )
                                  }
                                  onChange={changeColumn}
                                />
                              </div>
                            ) : (
                              <div data-board-section data-section-index={index}>
                                <ColumnGroupCard
                                  group={section.group}
                                  columns={boardColumns}
                                  groups={boardGroups}
                                  busy={busy}
                                  onGripDown={(event) =>
                                    beginColumnGrip(
                                      event,
                                      board.id,
                                      { kind: 'group', id: section.group.id },
                                      section.group.name || 'Группа',
                                      boardColumns,
                                      boardGroups,
                                    )
                                  }
                                  onSave={async (nextColumns, nextGroups) => {
                                    stageBoardLayout(board.id, nextColumns, nextGroups);
                                  }}
                                  onError={(error) => publishErr('boards', error)}
                                >
                                  {slot?.kind === 'member' && slot.groupId === section.group.id && slot.index === 0 && <InsertBar />}
                                  {section.columns.map((column, columnIndex) => (
                                    <Fragment key={`${column.boardLocalId}-${column.statusKey}`}>
                                      <div data-member>
                                        <ColumnEditorRow
                                          column={column}
                                          busy={busy}
                                          onGripDown={(event) =>
                                            beginColumnGrip(
                                              event,
                                              board.id,
                                              { kind: 'column', key: column.statusKey },
                                              column.alias || column.statusKey,
                                              boardColumns,
                                              boardGroups,
                                            )
                                          }
                                          onChange={changeColumn}
                                          onLeaveGroup={() =>
                                            stageBoardLayout(
                                              board.id,
                                              coalesceColumns(
                                                boardColumns.map((item) =>
                                                  item.statusKey === column.statusKey ? { ...item, groupId: null } : item,
                                                ),
                                              ),
                                              boardGroups,
                                            )
                                          }
                                        />
                                      </div>
                                      {slot?.kind === 'member' &&
                                        slot.groupId === section.group.id &&
                                        slot.index === columnIndex + 1 && <InsertBar />}
                                    </Fragment>
                                  ))}
                                </ColumnGroupCard>
                              </div>
                            )}
                            {slot?.kind === 'section' && slot.index === index + 1 && <InsertBar />}
                          </Fragment>
                        ))}
                      </>
                    );
                  })()}
                  </div>
                  {!boardColumns.length && (
                    <div className="text-sm text-slate-500">Колонки ещё не загружены</div>
                  )}
                </div>
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
            setGroupDraft(props.groups);
            setSavedBoards(props.boards);
          }}
        />
      </SettingsSection>
      </>
      )}

      {section === 'points' && <StoryPointSettings />}

      {section === 'backup' && (
      <>
        <p className="text-xs text-slate-500">
          Перенос данных между установками. Токен и подключение к Tracker не входят в файл.
          «Задачи» — текущее сохранение доски и примечания к задачам. «Сводка» — последняя повседневная сводка.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
        <SettingsSection title="Импорт" note={noteFor('import')}>
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
        <SettingsSection title="Экспорт" note={noteFor('export')}>
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

function SettingsSection(props: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-lg font-semibold text-slate-900">{props.title}</h2>
      </div>
      <div className="space-y-3 px-4 py-3">
        {props.note}
        {props.children}
      </div>
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

function StoryPointSettings() {
  const saved = useStoryPointPalette();
  const save = useSaveStoryPointPalette();
  const [draft, setDraft] = useState(saved);
  const [baseline, setBaseline] = useState(saved);
  const baselineRef = useRef(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft((prev) => (samePalette(prev, baselineRef.current) ? saved : prev));
    baselineRef.current = saved;
    setBaseline(saved);
  }, [saved]);
  const dirty = !samePalette(draft, baseline);
  const paint = (mark: StoryPointMark, hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    setDraft((prev) => ({ ...prev, colors: { ...prev.colors, [mark]: hex.toLowerCase() } }));
  };
  const writeCopy = (kind: 'brief' | 'detail', mark: StoryPointMark, text: string) => {
    setDraft((prev) => ({
      ...prev,
      copy: { ...prev.copy, [kind]: { ...prev.copy[kind], [mark]: text } },
    }));
  };
  return (
    <SettingsSection title="Story Points">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-600">
          Story Points — это не срок и не часы. Это сложность задачи относительно других задач команды: насколько она объёмная и сколько в ней неизвестного. Лесенка нарочно редкая: каждый следующий шаг заметно тяжелее предыдущего. Цвет цифры в таблице, в списке задач и в сводке берётся отсюда. Сумма в ячейке красится по среднему. Цвета и оба текста сначала правятся здесь и попадают в доску только по кнопке «Сохранить».
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setDraft((prev) => ({ ...prev, colors: storyPointColors(null) }))}
          >
            Восстановить цвета
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setDraft((prev) => ({ ...prev, copy: defaultStoryPointCopy() }))}
          >
            Восстановить описания
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {STORY_POINT_MARKS.map((mark) => (
          <div key={mark} className="flex items-start gap-3">
            <ColorField size="sm" value={draft.colors[mark]} onChange={(hex) => paint(mark, hex)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <div className="w-6 shrink-0 text-sm font-semibold tabular-nums text-slate-900">{mark}</div>
                <input
                  type="text"
                  value={draft.copy.brief[mark]}
                  onChange={(event) => writeCopy('brief', mark, event.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                />
              </div>
              <textarea
                value={draft.copy.detail[mark]}
                rows={3}
                onChange={(event) => writeCopy('detail', mark, event.target.value)}
                className="mt-1 w-full resize-y rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={!dirty || saving}
        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:cursor-default disabled:opacity-40"
        onClick={() => {
          setSaving(true);
          void save(draft)
            .then((stored) => {
              setDraft(stored);
              baselineRef.current = stored;
              setBaseline(stored);
            })
            .finally(() => setSaving(false));
        }}
      >
        Сохранить
      </button>
    </SettingsSection>
  );
}

function samePalette(
  left: { colors: typeof DEFAULT_STORY_POINT_COLORS; copy: StoryPointCopy },
  right: { colors: typeof DEFAULT_STORY_POINT_COLORS; copy: StoryPointCopy },
): boolean {
  return STORY_POINT_MARKS.every(
    (mark) =>
      left.colors[mark] === right.colors[mark] &&
      left.copy.brief[mark] === right.copy.brief[mark] &&
      left.copy.detail[mark] === right.copy.detail[mark],
  );
}

function CloseToTraySetting() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void window.api.getCloseToTray().then(setEnabled).catch(() => {});
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => {
          const next = event.target.checked;
          setEnabled(next);
          void window.api.setCloseToTray(next);
        }}
      />
      <span>Сворачивать в трей при закрытии окна. Полностью выйти можно из меню иконки в трее.</span>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    const text = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
    return `${text} Mb`;
  }
  const kb = bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0;
  return `${kb} Kb`;
}

function AppUpdateButton() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null);
  useEffect(() => window.api.onAppUpdateProgress(setProgress), []);
  const downloading = progress?.phase === 'download' && progress.total > 0 ? progress : null;
  const fraction = downloading ? Math.min(100, (downloading.received / downloading.total) * 100) : 0;
  return (
    <>
      <button
        type="button"
        className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setProgress({
            phase: 'version',
            message: 'Сверяем установленную версию с репозиторием.',
            received: 0,
            total: 0,
          });
          void window.api
            .updateAppFromRepo()
            .then((result) =>
              setProgress({
                phase: result.updated ? 'install' : 'version',
                message: result.message,
                received: 0,
                total: 0,
              }),
            )
            .catch((error: unknown) => {
              const raw = error instanceof Error ? error.message : String(error);
              setProgress({
                phase: 'version',
                message: raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''),
                received: 0,
                total: 0,
              });
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Обновление…' : 'Проверить и обновить'}
      </button>
      {progress && (
        <div className="basis-full space-y-1.5">
          <p className="text-sm text-slate-700">{progress.message}</p>
          {downloading && (
            <div className="max-w-md space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                <div className="h-full rounded-full bg-sky-600" style={{ width: `${fraction}%` }} />
              </div>
              <p className="text-xs text-slate-600">
                {formatBytes(downloading.received)} из {formatBytes(downloading.total)}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function sameColumnStructure(saved: BoardColumnConfig[], next: BoardColumnConfig[]): boolean {
  if (saved.length !== next.length) return false;
  const byId = new Map(saved.map((column) => [column.columnId, column]));
  for (const column of next) {
    const prev = byId.get(column.columnId);
    if (!prev) return false;
    const prevKeys = (prev.sourceStatuses || []).map((status) => status.key).join(',');
    const nextKeys = (column.sourceStatuses || []).map((status) => status.key).join(',');
    if (
      prev.columnName !== column.columnName ||
      prev.statusDisplay !== column.statusDisplay ||
      prevKeys !== nextKeys ||
      prev.enabled !== column.enabled
    ) {
      return false;
    }
  }
  return true;
}

function InsertBar() {
  return <div className="pointer-events-none h-[5px] shrink-0 rounded-sm bg-[#0284c7]" aria-hidden />;
}

function sectionsWithout(sections: ColumnSection[], drag: BoardDrag | null): ColumnSection[] {
  if (!drag) return sections;
  if (drag.kind === 'group') {
    return sections.filter((section) => !(section.kind === 'group' && section.group.id === drag.id));
  }
  return sections.flatMap((section): ColumnSection[] => {
    if (section.kind === 'column') return section.column.statusKey === drag.key ? [] : [section];
    return [{ ...section, columns: section.columns.filter((column) => column.statusKey !== drag.key) }];
  });
}

function sameBoardSlot(a: BoardSlot, b: BoardSlot): boolean {
  if (a.kind === 'section' && b.kind === 'section') return a.index === b.index;
  if (a.kind === 'member' && b.kind === 'member') return a.groupId === b.groupId && a.index === b.index;
  return false;
}

function slotFromPointer(list: HTMLElement, kind: BoardDrag['kind'], clientX: number, clientY: number): BoardSlot | null {
  if (kind === 'column') {
    const member = memberSlot(list, clientX, clientY);
    if (member) return member;
  }
  return sectionSlot(list, clientY);
}

function memberSlot(list: HTMLElement, clientX: number, clientY: number): BoardSlot | null {
  for (const card of list.querySelectorAll<HTMLElement>('[data-group-card]')) {
    const body = card.querySelector<HTMLElement>('[data-group-body]');
    if (!body) continue;
    const rect = body.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
    const rows = [...body.querySelectorAll<HTMLElement>('[data-member]')].filter((row) => row.dataset.dragging !== 'true');
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i].getBoundingClientRect();
      if (clientY < row.top + row.height / 2) {
        index = i;
        break;
      }
    }
    return { kind: 'member', groupId: Number(card.dataset.groupId), index };
  }
  return null;
}

function sectionSlot(list: HTMLElement, clientY: number): BoardSlot {
  const cards = [...list.querySelectorAll<HTMLElement>('[data-board-section]')].filter(
    (card) => card.dataset.dragging !== 'true',
  );
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return { kind: 'section', index: Number(card.dataset.sectionIndex) };
  }
  return { kind: 'section', index: cards.length };
}

function ColumnGroupCard(props: {
  group: ColumnGroup;
  columns: BoardColumnConfig[];
  groups: ColumnGroup[];
  busy: boolean;
  onGripDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onSave: (columns: BoardColumnConfig[], groups: ColumnGroup[]) => Promise<void>;
  onError: (error: unknown) => void;
  children: ReactNode;
}) {
  const group = props.group;
  async function save(columns: BoardColumnConfig[], groups: ColumnGroup[]) {
    try {
      await props.onSave(columns, groups);
    } catch (error) {
      props.onError(error);
    }
  }
  return (
          <div
            data-group-card
            data-group-id={group.id}
            className="flex flex-col gap-2 rounded border-2 p-2"
            style={{
              borderColor: group.color || '#64748b',
              backgroundImage: `linear-gradient(to right, ${hexTint(group.color || '#64748b')} 0%, #fff 20%, #fff 100%)`,
            }}
          >
            <div data-group-header className="flex items-center gap-2">
              <span
                title="Перетащить"
                className="inline-flex cursor-grab touch-none text-slate-400"
                onPointerDown={props.onGripDown}
              >
                <MoveIcon className="h-4 w-4" />
              </span>
              <button
                type="button"
                title={group.collapsed ? 'Развернуть' : 'Свернуть'}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                onClick={() =>
                  void save(
                    props.columns,
                    props.groups.map((item) =>
                      item.id === group.id ? { ...item, collapsed: !item.collapsed } : item,
                    ),
                  )
                }
              >
                {group.collapsed ? <ArrowRightIcon className="h-4 w-4" /> : <ArrowDownIcon className="h-4 w-4" />}
              </button>
              <ColorField
                value={group.color || '#64748b'}
                onChange={(hex) =>
                  void save(
                    props.columns,
                    props.groups.map((item) => (item.id === group.id ? { ...item, color: hex } : item)),
                  )
                }
              />
              <input
                className="h-8 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-sm"
                value={group.name}
                onChange={(event) =>
                  void save(
                    props.columns,
                    props.groups.map((item) =>
                      item.id === group.id ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                title="Удалить"
                className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-300 text-red-600 hover:bg-red-50"
                onClick={() =>
                  void save(
                    coalesceColumns(props.columns.map((column) =>
                      column.groupId === group.id ? { ...column, groupId: null } : column,
                    )),
                    props.groups.filter((item) => item.id !== group.id),
                  )
                }
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
            {!group.collapsed && (
              <div data-group-body className="flex min-h-8 flex-col gap-2 py-2">
                {props.children}
              </div>
            )}
          </div>
  );
}

function ColumnEditorRow(props: {
  column: BoardColumnConfig;
  busy: boolean;
  onGripDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onChange: (column: BoardColumnConfig) => void;
  onLeaveGroup?: () => void;
}) {
  const c = props.column;
  return (
    <div
      data-column-row
      className="flex items-center gap-2 rounded border border-slate-300 bg-white p-2 text-sm shadow-[0_1px_3px_rgba(15,23,42,0.18)]"
    >
      <span
        title="Перетащить"
        className="inline-flex cursor-grab touch-none text-slate-400"
        onPointerDown={props.onGripDown}
      >
        <MoveIcon className="h-4 w-4" />
      </span>
      <ColorField value={c.color} onChange={(hex) => props.onChange({ ...c, color: hex })} />
      <input
        className="h-8 w-56 shrink-0 rounded border border-slate-300 px-2"
        value={c.alias}
        onChange={(event) => props.onChange({ ...c, alias: event.target.value })}
      />
      <select
        className="h-8 w-32 shrink-0 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
        value={c.duty || ''}
        title="Тег колонки"
        onChange={(event) => {
          const duty =
            event.target.value === 'review' ||
            event.target.value === 'testing' ||
            event.target.value === 'development' ||
            event.target.value === 'ai' ||
            event.target.value === 'final'
              ? event.target.value
              : '';
          props.onChange({ ...c, duty });
        }}
      >
        <option value="">Без тега</option>
        <option value="development">Разработка</option>
        <option value="review">Ревью</option>
        <option value="testing">Тесты</option>
        <option value="ai">ИИ</option>
        <option value="final">Финал</option>
      </select>
      <select
        className="h-8 w-36 shrink-0 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700"
        value={c.ownerRole || ''}
        title="Ответственная роль: колонка значит, что задача сейчас в активной работе"
        onChange={(event) => {
          const ownerRole = event.target.value === 'developer' || event.target.value === 'qa' ? event.target.value : '';
          props.onChange({ ...c, ownerRole });
        }}
      >
        <option value="">Без роли</option>
        <option value="developer">Разработчик</option>
        <option value="qa">Тестировщик</option>
      </select>
      <div className="min-w-0 flex-1 text-slate-600">
        <div className="truncate" title={c.columnName}>
          {c.columnName}
        </div>
        {c.sourceStatuses.length > 0 ? (
          <div
            className="truncate text-xs text-slate-500"
            title={c.sourceStatuses.map((status) => status.display).join(', ')}
          >
            {c.sourceStatuses.map((status) => status.display).join(', ')}
          </div>
        ) : c.statusDisplay && c.statusDisplay !== c.columnName ? (
          <div className="truncate text-xs text-slate-500">{c.statusDisplay}</div>
        ) : null}
      </div>
      {props.onLeaveGroup && (
        <button
          type="button"
          title="Убрать из группы"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-50"
          onClick={props.onLeaveGroup}
        >
          ×
        </button>
      )}
    </div>
  );
}
