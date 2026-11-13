import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BoardColumnConfig,
  BoardConfig,
  BoardMatrix,
  Developer,
  SavedBoard,
  TrackerConnection,
} from '@shared/types';
import { DEFAULT_BOARD, DEFAULT_CONNECTION } from '@shared/types';
import type { BoardHeaderModel } from './pages/BoardPage';
import { MenuIcon, RefreshIcon, ToggleLeftIcon, ToggleRightIcon, TrashIcon } from './components/Icons';
import { InstantTip } from './components/InstantTip';
import {
  autoSaveStamp,
  loadAutoRefresh,
  loadAutoRefreshMinutes,
  loadAutoSaveStamp,
  loadAutoSaveTime,
  loadWorkSchedule,
  refreshDelayMs,
  saveAutoRefresh,
  saveAutoRefreshMinutes,
  saveAutoSaveStamp,
  saveAutoSaveTime,
  saveWorkSchedule,
  type WorkSchedule,
} from './autoRefresh';
import { defaultSummaryPeriod } from '@shared/summary';
import { changeStillOpen } from '@shared/issueChanges';
import { invalidateIssueStories } from './issueStoryCache';
import { revealContentFade, setApiCount, startContentFade } from './contentFade';
import { sessionLog } from './sessionLog';
import { describeMatrix } from '@shared/matrixShape';

const BoardPage = lazy(() => import('./pages/BoardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

type Tab = 'board' | 'settings';

const MENU_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: 'board', label: 'Доски' },
  { id: 'settings', label: 'Настройки' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('board');
  const [editExit, setEditExit] = useState(0);
  const [settingsSection, setSettingsSection] = useState<'app' | 'integrations' | 'boards'>('app');
  const [menuOpen, setMenuOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const runsRef = useRef<HTMLDivElement>(null);
  const [autoRefresh, setAutoRefresh] = useState(loadAutoRefresh);
  const [autoMinutes, setAutoMinutes] = useState(loadAutoRefreshMinutes);
  const [autoSaveTime, setAutoSaveTime] = useState(loadAutoSaveTime);
  const [workSchedule, setWorkSchedule] = useState<WorkSchedule>(loadWorkSchedule);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [connection, setConnection] = useState<TrackerConnection>(DEFAULT_CONNECTION);
  const [board, setBoard] = useState<BoardConfig>(DEFAULT_BOARD);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [columns, setColumns] = useState<BoardColumnConfig[]>([]);
  const [boards, setBoards] = useState<SavedBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [shownBoardId, setShownBoardId] = useState<number | null>(null);
  const [boardHeader, setBoardHeader] = useState<BoardHeaderModel>({
    title: '',
    period: null,
    outdated: false,
    previous: false,
    open: 0,
    done: 0,
    total: 0,
  });
  const [matrix, setMatrix] = useState<BoardMatrix | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingBoardId, setRefreshingBoardId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [bootDone, setBootDone] = useState(false);
  const [apiRequests, setApiRequests] = useState(0);
  const [trayCue, setTrayCue] = useState<{ tick: number; boardId: number | null; bell: boolean }>({
    tick: 0,
    boardId: null,
    bell: false,
  });
  const [apiUsage, setApiUsage] = useState({ sinceRefresh: 0, dayTotal: 0, inflight: 0 });
  const [runs, setRuns] = useState<
    Array<{ id: number; title: string; done: number; total: number; requests: number }>
  >([]);
  const runShare = useMemo(() => {
    let done = 0;
    let total = 0;
    for (const run of runs) {
      if (run.total <= 0) continue;
      done += run.done;
      total += run.total;
    }
    return { done, total };
  }, [runs]);
  const [storageStats, setStorageStats] = useState({ database: 0, settings: 0, logs: 0 });
  const [changes, setChanges] = useState<
    Array<{ issueKey: string; boardLocalId: number; text: string; at: string; seen: boolean }>
  >([]);
  const boardSwitch = useRef(0);
  const refreshLock = useRef(false);
  const summarySaveLock = useRef(false);

  const loadSettings = useCallback(async () => {
    const [conn, boardCfg, devs, cols, savedBoards, activeId, last] = await Promise.all([
      window.api.getConnection(),
      window.api.getBoard(),
      window.api.listDevelopers(),
      window.api.listColumns(),
      window.api.listSavedBoards(),
      window.api.getActiveBoard(),
      window.api.getLastBoard(),
    ]);
    setConnection(conn);
    setBoard(boardCfg);
    setDevelopers(devs);
    setColumns(cols);
    setBoards(savedBoards);
    setActiveBoardId(activeId);
    setShownBoardId(activeId);
    setChanges(await window.api.listIssueChanges());
    setMatrix(last && last.sourceBoardLocalId === activeId ? last : null);
    setReady(true);
    if (!conn.token) {
      setSettingsSection('integrations');
      setTab('settings');
    }
  }, []);

  useEffect(() => {
    void loadSettings().catch((e: Error) => setError(e.message));
  }, [loadSettings]);

  useEffect(() => {
    window.api.notifyShellReady();
  }, []);

  useEffect(() => {
    if (ready && tab === 'settings') setBootDone(true);
  }, [ready, tab]);

  useEffect(() => {
    const persist = () => {
      if (matrix) void window.api.saveLastBoard(matrix);
    };
    window.addEventListener('beforeunload', persist);
    return () => window.removeEventListener('beforeunload', persist);
  }, [matrix]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!runsOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (runsRef.current?.contains(event.target as Node)) return;
      setRunsOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [runsOpen]);

  useEffect(() => {
    if (runs.length === 0) setRunsOpen(false);
  }, [runs.length]);

  const handleMatrixChange = useCallback((next: BoardMatrix) => {
    setMatrix(next);
    void window.api.saveLastBoard(next);
  }, []);

  const reloadLiveMatrix = useCallback(async () => {
    try {
      const last = await window.api.getLastBoard();
      if (last) setMatrix(last);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const goLiveBoard = useCallback(() => {
    setTab('board');
    setMenuOpen(false);
    void reloadLiveMatrix();
  }, [reloadLiveMatrix]);

  const markSnapshotDirty = useCallback(() => undefined, []);

  useEffect(() => {
    const apply = (state: { total: number; inflight?: number; sinceRefresh?: number; dayTotal?: number }) => {
      setApiCount(state.total);
      setApiRequests(state.total);
      setApiUsage({
        sinceRefresh: state.sinceRefresh ?? 0,
        dayTotal: state.dayTotal ?? 0,
        inflight: state.inflight ?? 0,
      });
    };
    void window.api.trackerUsage().then(apply).catch(() => undefined);
    return window.api.onTrackerActivity(apply);
  }, []);
  useEffect(() => {
    void window.api.listTrackerRuns().then(setRuns).catch(() => undefined);
    return window.api.onTrackerRuns(setRuns);
  }, []);
  useEffect(
    () =>
      window.api.onWorkCleared(() => {
        setMatrix(null);
        setChanges([]);
        invalidateIssueStories();
        void window.api.storageStats().then(setStorageStats).catch(() => undefined);
      }),
    [],
  );
  useEffect(() => {
    let stop = false;
    const load = () => {
      void window.api.storageStats().then((stats) => {
        if (!stop) setStorageStats(stats);
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const viewRef = useRef(activeBoardId);
  viewRef.current = shownBoardId ?? activeBoardId;

  const refreshBoard = useCallback(async () => {
    if (refreshLock.current || refreshingBoardId != null) return;
    refreshLock.current = true;
    await window.api.resetTrackerActivity();
    await window.api.beginBoardRefresh();
    setApiCount(0);
    const refreshButton = document.querySelector<HTMLButtonElement>('[data-refresh]');
    refreshButton?.setAttribute('disabled', '');
    refreshButton?.querySelector('svg')?.classList.add('animate-spin');
    const queue = boards.filter((item) => item.enabled);
    setError(null);
    let stopped = false;
    const failures: string[] = [];
    try {
      for (const item of queue) {
        setRefreshingBoardId(item.id);
        try {
          const data = await window.api.refreshBoard(item.id);
          if (viewRef.current === item.id) {
            setRefreshingBoardId(null);
            await startContentFade(false);
            if (viewRef.current === item.id) setMatrix(data);
            window.setTimeout(() => revealContentFade(), 0);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (message.includes('Запросы остановлены')) throw e;
          failures.push(`${(item.alias || '').trim() || item.name}: ${message}`);
          sessionLog('error', 'board refresh failed', { id: item.id, error: message });
          if (viewRef.current === item.id) setRefreshingBoardId(null);
        }
        if (viewRef.current != null) await window.api.setActiveBoard(viewRef.current);
      }
      if (failures.length) setError(failures.join('\n'));
      setDevelopers(await window.api.listDevelopers());
      const listed = await window.api.listIssueChanges();
      setLastRefreshAt(Date.now());
      setChanges(listed);
      try {
        await window.api.createSnapshot(todayIso(), true);
      } catch (e) {
        sessionLog('error', 'auto-snapshot', { error: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      stopped = e instanceof Error && e.message.includes('Запросы остановлены');
      if (!stopped) setError(e instanceof Error ? e.message : String(e));
    } finally {
      try {
        if (viewRef.current != null) await window.api.setActiveBoard(viewRef.current);
        if (stopped && viewRef.current != null) {
          const last = await window.api.getLastBoard(viewRef.current);
          setMatrix(last && last.sourceBoardLocalId === viewRef.current ? last : null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (!stopped) invalidateIssueStories();
      refreshLock.current = false;
      refreshButton?.removeAttribute('disabled');
      refreshButton?.querySelector('svg')?.classList.remove('animate-spin');
      setRefreshingBoardId(null);
      setLoading(false);
    }
  }, [boards, refreshingBoardId]);

  useEffect(() => {
    if (!ready || !bootDone || !autoRefresh || refreshingBoardId != null) return;
    const fetched = matrix?.fetchedAt ? Date.parse(matrix.fetchedAt) : Number.NaN;
    const anchor = lastRefreshAt ?? (Number.isNaN(fetched) ? null : fetched);
    const wait = refreshDelayMs(new Date(), autoMinutes, workSchedule, anchor);
    if (wait == null) return;
    const timer = window.setTimeout(() => {
      void refreshBoard();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [ready, bootDone, autoRefresh, autoMinutes, workSchedule, lastRefreshAt, matrix?.fetchedAt, refreshingBoardId, refreshBoard]);

  useEffect(() => {
    if (!ready || !bootDone) return;
    const tick = async () => {
      if (summarySaveLock.current || refreshLock.current || refreshingBoardId != null) return;
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (clock < autoSaveTime) return;
      const date = todayIso();
      const stamp = autoSaveStamp(date, autoSaveTime);
      if (loadAutoSaveStamp() === stamp) return;
      const enabled = boards.filter((item) => item.enabled && item.id > 0);
      if (!enabled.length) return;
      summarySaveLock.current = true;
      try {
        const anchor = enabled.find((item) => item.id === activeBoardId) || enabled[0];
        const report = await window.api.buildSummary({
          boardLocalId: anchor.id,
          trackerBoardId: anchor.trackerBoardId,
          queueKey: anchor.queueKey,
          participant: null,
          period: defaultSummaryPeriod(now),
          boards: enabled.map((item) => ({
            boardLocalId: item.id,
            trackerBoardId: item.trackerBoardId,
            queueKey: item.queueKey,
            name: item.name,
            alias: item.alias || '',
          })),
          columns: columns
            .filter((column) => column.enabled)
            .map((column) => ({
              statusKey: column.statusKey,
              alias: column.alias,
              statusDisplay: column.statusDisplay,
              columnName: column.columnName,
              duty: column.duty,
              ownerRole: column.ownerRole,
              boardLocalId: column.boardLocalId,
            })),
        });
        if (report) saveAutoSaveStamp(stamp);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('Запросы остановлены')) {
          saveAutoSaveStamp(stamp);
          return;
        }
        sessionLog('error', 'auto-save', { error: message });
      } finally {
        summarySaveLock.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(timer);
  }, [ready, bootDone, autoSaveTime, boards, columns, activeBoardId, refreshingBoardId]);

  const setupKind = !connection.token
    ? 'integration'
    : boards.some((item) => item.enabled)
      ? null
      : 'boards';

  const activeMatrix = matrix;
  const openChangeKeys = useMemo(() => {
    const keys = new Set<string>();
    const createdAt = new Map<string, string | null>();
    for (const row of matrix?.developers || []) {
      for (const issues of Object.values(row.issuesByColumn || {})) {
        for (const issue of issues || []) {
          keys.add(issue.key);
          if (!createdAt.has(issue.key)) createdAt.set(issue.key, issue.createdAt || null);
        }
      }
    }
    return { boardId: matrix?.sourceBoardLocalId ?? null, keys, createdAt };
  }, [matrix]);

  function boardHasOpenChange(boardId: number): boolean {
    const onLoadedBoard = openChangeKeys.boardId === boardId;
    return changes.some((change) => {
      if (change.boardLocalId !== boardId) return false;
      if (onLoadedBoard && !openChangeKeys.keys.has(change.issueKey)) return false;
      const created = onLoadedBoard ? openChangeKeys.createdAt.get(change.issueKey) : undefined;
      return changeStillOpen(change, created);
    });
  }

  const onBoardPage = tab === 'board';

  function paintBoardBadge(id: number) {
    document.querySelectorAll<HTMLElement>('[data-board-badge]').forEach((el) => {
      const on = el.dataset.boardBadge === String(id);
      el.classList.toggle('border-black', on);
      el.classList.toggle('bg-black', on);
      el.classList.toggle('text-white', on);
      el.classList.toggle('font-semibold', on);
      el.classList.toggle('border-slate-300', !on);
      el.classList.toggle('text-slate-600', !on);
    });
  }

  const switchBoard = (id: number) => {
    if (id === (shownBoardId ?? activeBoardId)) return;
    setEditExit((value) => value + 1);
    viewRef.current = id;
    setShownBoardId(id);
    paintBoardBadge(id);
    if (refreshLock.current) {
      const ticket = ++boardSwitch.current;
      void window.api.getLastBoard(id).then((last) => {
        if (boardSwitch.current !== ticket || viewRef.current !== id) return;
        setActiveBoardId(id);
        setMatrix(last && last.sourceBoardLocalId === id ? last : null);
      });
      return;
    }
    const ticket = ++boardSwitch.current;
    const previousId = activeBoardId;
    sessionLog('info', 'switch board', { id, from: activeBoardId, hadMatrix: describeMatrix(matrix) });
    paintBoardBadge(id);
    const held = startContentFade(false);
    void window.api.resetTrackerActivity();
    setApiCount(0);
    void (async () => {
      try {
        await window.api.setActiveBoard(id);
        if (boardSwitch.current !== ticket) return;
        const cfg = await window.api.getBoard();
        if (boardSwitch.current !== ticket) return;
        sessionLog('info', 'switch board loaded', {
          id,
          queue: cfg.queueKey,
          boardId: cfg.boardId,
        });
        const last = await window.api.getLastBoard();
        if (boardSwitch.current !== ticket) return;
        await held;
        if (boardSwitch.current !== ticket) return;
        setBoard(cfg);
        setActiveBoardId(id);
        setShownBoardId(id);
        setMatrix(last && last.sourceBoardLocalId === id ? last : null);
        window.setTimeout(() => revealContentFade(), 0);
      } catch (error) {
        if (boardSwitch.current !== ticket) return;
        sessionLog('error', 'switch board failed', error);
        paintBoardBadge(previousId ?? id);
        setShownBoardId(previousId);
        setActiveBoardId(previousId);
        setError(error instanceof Error ? error.message : String(error));
        revealContentFade();
      }
    })();
  };

  const trayNav = useRef({ boards, changes, switchBoard, boardHasOpenChange });
  trayNav.current = { boards, changes, switchBoard, boardHasOpenChange };
  useEffect(() => {
    return window.api.onTrayShow(() => {
      const nav = trayNav.current;
      const target = [...nav.boards]
        .filter((board) => board.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .find((board) => nav.boardHasOpenChange(board.id));
      setTab('board');
      if (target) nav.switchBoard(target.id);
      setTrayCue((prev) => ({ tick: prev.tick + 1, boardId: target?.id ?? null, bell: target != null }));
    });
  }, []);

  async function clearWork() {
    const agreed = window.confirm(
      'Удалить список задач, сводки и заметки? Доски, колонки, люди, алиасы, цвета и порядок останутся.',
    );
    if (!agreed) return;
    try {
      const stats = await window.api.clearWorkData();
      setStorageStats(stats);
      setMatrix(null);
      setChanges([]);
      invalidateIssueStories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-dvh overflow-hidden flex flex-col">
      <header className="grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div ref={menuRef} className="relative shrink-0">
            <InstantTip text="Меню" place="bottom">
              <button
                type="button"
                aria-pressed={menuOpen}
                className={headerIconClass(menuOpen)}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MenuIcon />
              </button>
            </InstantTip>
            {menuOpen && (
              <div className="absolute left-0 top-full z-[9999] mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                {MENU_ITEMS.map(({ id, label }) =>
                  tab === id ? (
                    <div key={id} className="cursor-default px-3 py-1.5 text-sm font-normal text-slate-400">
                      {label}
                    </div>
                  ) : (
                    <button
                      key={id}
                      type="button"
                      className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm font-normal text-slate-800 hover:bg-slate-100"
                      onClick={() => {
                        if (id === 'board') {
                          goLiveBoard();
                          return;
                        }
                        if (id === 'settings') {
                          setSettingsSection('app');
                          setEditExit((value) => value + 1);
                        }
                        setTab(id);
                        setMenuOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          {onBoardPage ? (
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {boards.filter((item) => item.enabled).map((item) => {
                const active = item.id === (shownBoardId ?? activeBoardId);
                const refreshing = refreshingBoardId === item.id;
                const badgeClass = refreshing
                  ? 'bro-board-progress font-semibold text-white'
                  : active
                    ? 'border border-black bg-black font-semibold text-white'
                    : 'border border-slate-300 text-slate-600 hover:bg-slate-100';
                const changed = boardHasOpenChange(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-board-badge={item.id}
                    className={`relative inline-flex h-7 shrink-0 items-center rounded-none border-l-[3px] py-1 pl-2 pr-3.5 text-sm ${badgeClass}`}
                    style={{ borderLeftColor: item.color || (active ? '#000000' : '#cbd5e1') }}
                    onClick={() => switchBoard(item.id)}
                  >
                    {(item.alias || '').trim() || item.name}
                    {changed && (
                      <span className="pointer-events-none absolute right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="font-semibold text-lg tracking-tight text-slate-900">Настройки</span>
          )}
        </div>
        {onBoardPage ? <div id="board-edit-anchor" className="flex items-center justify-center" /> : <div />}
        {onBoardPage ? (
          <div className="flex items-center justify-end gap-1.5">
            {matrix?.fetchedAt && (
              <span className="text-[11px] tabular-nums text-slate-400">{formatStamp(matrix.fetchedAt)}</span>
            )}
            <InstantTip text={autoRefresh ? 'Выключить автообновление' : 'Включить автообновление'} place="bottom">
              <button
                type="button"
                aria-pressed={autoRefresh}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center border-0 bg-transparent text-slate-400"
                onClick={() => {
                  const next = !autoRefresh;
                  setAutoRefresh(next);
                  saveAutoRefresh(next);
                }}
              >
                {autoRefresh ? (
                  <ToggleRightIcon filled className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ToggleLeftIcon filled className="h-5 w-5 text-slate-300" />
                )}
              </button>
            </InstantTip>
            <InstantTip text={refreshingBoardId != null ? 'Обновление досок…' : 'Обновить все доски'} place="bottom">
              <button
                type="button"
                data-refresh=""
                disabled={refreshingBoardId != null}
                className={headerIconClass(false)}
                onClick={() => void refreshBoard()}
              >
                <RefreshIcon className={`h-4 w-4 ${refreshingBoardId != null ? 'animate-spin' : ''}`} />
              </button>
            </InstantTip>
          </div>
        ) : (
          <div />
        )}
      </header>

      {error && (
        <div className="shrink-0 mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
          <button
            className="ml-3 cursor-pointer underline"
            onClick={() => setError(null)}
          >
            скрыть
          </button>
        </div>
      )}

      <main
        className={`flex min-h-0 flex-1 flex-col ${
          onBoardPage ? 'overflow-hidden' : 'overflow-auto p-4'
        }`}
      >
        <Suspense fallback={<BoardShell />}>
        {!ready ? (
          <BoardShell />
        ) : tab === 'settings' ? (
          <SettingsPage
            connection={connection}
            board={board}
            developers={developers}
            columns={columns}
            boards={boards}
            activeBoardId={activeBoardId}
            onConnectionChange={setConnection}
            onBoardChange={setBoard}
            onDevelopersChange={setDevelopers}
            onColumnsChange={setColumns}
            onBoardsChange={setBoards}
            onActiveBoardChange={setActiveBoardId}
            onReloadAll={() => void loadSettings()}
            onError={setError}
            autoRefreshMinutes={autoMinutes}
            autoSaveTime={autoSaveTime}
            workSchedule={workSchedule}
            onScheduleSave={(value) => {
              setAutoMinutes(value.minutes);
              saveAutoRefreshMinutes(value.minutes);
              setAutoSaveTime(value.autoSaveTime);
              saveAutoSaveTime(value.autoSaveTime);
              setWorkSchedule(value.schedule);
              saveWorkSchedule(value.schedule);
            }}
            initialSection={settingsSection}
          />
        ) : (
          <BoardPage
            matrix={activeMatrix}
            readOnly={false}
            snapshotDate={null}
            columnHeadersNoWrap={board.columnHeadersNoWrap}
            setupKind={setupKind}
            onRefresh={() => void refreshBoard()}
            refreshingBoardId={refreshingBoardId}
            editExit={editExit}
            onMatrixChange={handleMatrixChange}
            onDevelopersChange={setDevelopers}
            onColumnsChange={setColumns}
            participants={developers}
            columns={columns}
            boards={boards}
            activeBoardId={activeBoardId}
            onActiveBoard={switchBoard}
            onHeaderChange={setBoardHeader}
            onError={setError}
            onGoSettings={(section) => {
              setSettingsSection(section);
              setTab('settings');
            }}
            onSnapshotContentChange={markSnapshotDirty}
            changes={changes}
            apiRequests={apiRequests}
            trayCue={trayCue}
            onBootstrapped={() => setBootDone(true)}
            onDismissChanges={(keys) => {
              if (activeBoardId == null || !keys.length) return;
              void window.api.dismissIssueChanges(activeBoardId, keys).then(setChanges);
            }}
          />
        )}
        </Suspense>
      </main>
      <footer className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 text-[11px] tabular-nums text-slate-500">
        <span className="inline-flex items-center gap-1">
          <InstantTip text="Обнулить счётчики запросов" place="top">
            <button
              type="button"
              aria-label="Обнулить счётчики запросов"
              className="inline-flex h-3.5 w-3.5 items-center justify-center text-slate-400 hover:text-red-700"
              onClick={() => void window.api.resetApiCounters()}
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          </InstantTip>
          <InstantTip text="Запросы с последнего обновления (за сегодня)" place="top">
            <span>
              API {apiUsage.sinceRefresh} ({apiUsage.dayTotal})
            </span>
          </InstantTip>
          <button
            type="button"
            title="Остановить запросы"
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-slate-300 text-[8px] leading-none text-slate-700 hover:bg-red-200 hover:text-red-700 disabled:opacity-40"
            disabled={runs.length === 0 && apiUsage.inflight === 0}
            onClick={() => void window.api.abortTracker()}
          >
            ■
          </button>
          {runs.length > 0 && (
            <div ref={runsRef} className="relative flex items-center">
              <button
                type="button"
                aria-pressed={runsOpen}
                aria-label="Ход запросов"
                className="flex h-6 w-[100px] cursor-pointer items-center"
                onClick={() => setRunsOpen((open) => !open)}
              >
                <RunMeter done={runShare.done} total={runShare.total} className="h-1.5 w-full" />
              </button>
              {runsOpen && (
                <div className="absolute bottom-full left-0 z-[9999] mb-1 max-h-40 w-80 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl">
                  {runs.map((run) => (
                    <div key={run.id} className="flex items-center gap-2 px-2 py-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700" title={run.title}>
                        {run.title}
                      </span>
                      <RunMeter done={run.done} total={run.total} className="h-1.5 w-[72px] shrink-0" />
                      <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
                        {run.total > 0 ? `${run.done}/${run.total}` : '…'}
                      </span>
                      <InstantTip text="Остановить" place="top">
                        <button
                          type="button"
                          aria-label={`Остановить: ${run.title}`}
                          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm bg-slate-300 text-[8px] leading-none text-slate-700 hover:bg-red-200 hover:text-red-700"
                          onClick={() => void window.api.cancelTrackerRun(run.id)}
                        >
                          ■
                        </button>
                      </InstantTip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <InstantTip
              text="Удалить задачи, сводки и заметки. Доски, колонки, алиасы и цвета останутся."
              place="top"
            >
              <button
                type="button"
                aria-label="Очистить базу"
                className="inline-flex h-3.5 w-3.5 items-center justify-center text-slate-400 hover:text-red-700"
                onClick={() => void clearWork()}
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </InstantTip>
            база {formatBytes(storageStats.database)}
          </span>
          <span>настройки {formatBytes(storageStats.settings)}</span>
          <span>логи {formatBytes(storageStats.logs)}</span>
        </span>
      </footer>
    </div>
  );
}

function RunMeter(props: { done: number; total: number; className: string }) {
  const known = props.total > 0;
  const width = known ? Math.min(100, (props.done / props.total) * 100) : 0;
  return (
    <span className={`relative block overflow-hidden rounded-full bg-slate-300 ${props.className}`}>
      {known ? (
        <span className="block h-full bg-sky-600" style={{ width: `${width}%` }} />
      ) : (
        <span className="bro-save-progress block h-full w-1/4 bg-sky-500" />
      )}
    </span>
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

function BoardShell() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-11 shrink-0 border-r border-slate-200 bg-slate-50" />
      <div className="min-w-0 flex-1 bg-white" />
      <div className="w-11 shrink-0 border-l border-slate-200 bg-slate-50" />
    </div>
  );
}

function headerIconClass(pressed: boolean, tone: 'default' | 'danger' = 'default'): string {
  if (pressed) {
    return 'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-white text-slate-800 shadow';
  }
  const color = tone === 'danger' ? 'text-red-600' : 'text-slate-500';
  return `inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-transparent ${color} hover:border-slate-200 hover:bg-white hover:shadow-sm disabled:cursor-default disabled:text-slate-300 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none`;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
