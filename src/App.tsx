import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BoardColumnConfig,
  BoardConfig,
  BoardMatrix,
  Developer,
  SavedBoard,
  TrackerConnection,
} from '@shared/types';
import { DEFAULT_BOARD, DEFAULT_CONNECTION } from '@shared/types';
import SettingsPage from './pages/SettingsPage';
import BoardPage, { type BoardHeaderModel } from './pages/BoardPage';
import { MenuIcon, RefreshIcon, ToggleLeftIcon, ToggleRightIcon } from './components/Icons';
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
import { revealContentFade, setApiCount, startContentFade } from './contentFade';
import { sessionLog } from './sessionLog';
import { describeMatrix } from '@shared/matrixShape';

type Tab = 'board' | 'settings';

const MENU_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: 'board', label: 'Доски' },
  { id: 'settings', label: 'Настройки' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('board');
  const [settingsSection, setSettingsSection] = useState<'app' | 'integrations' | 'boards'>('app');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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
  const [apiRequests, setApiRequests] = useState(0);
  const [apiUsage, setApiUsage] = useState({ sinceRefresh: 0, dayTotal: 0 });
  const [storageStats, setStorageStats] = useState({ database: 0, settings: 0, logs: 0 });
  const [changes, setChanges] = useState<
    Array<{ issueKey: string; boardLocalId: number; text: string; at: string; seen: boolean }>
  >([]);
  const boardSwitch = useRef(0);
  const refreshLock = useRef(false);

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
    const apply = (state: { total: number; sinceRefresh?: number; dayTotal?: number }) => {
      setApiCount(state.total);
      setApiUsage({ sinceRefresh: state.sinceRefresh ?? 0, dayTotal: state.dayTotal ?? 0 });
    };
    void window.api.trackerUsage().then(apply).catch(() => undefined);
    return window.api.onTrackerActivity(apply);
  }, []);
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
  viewRef.current = activeBoardId;

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
      refreshLock.current = false;
      refreshButton?.removeAttribute('disabled');
      refreshButton?.querySelector('svg')?.classList.remove('animate-spin');
      setRefreshingBoardId(null);
      setLoading(false);
    }
  }, [boards, refreshingBoardId]);

  useEffect(() => {
    if (!ready || !autoRefresh || refreshingBoardId != null) return;
    const fetched = matrix?.fetchedAt ? Date.parse(matrix.fetchedAt) : Number.NaN;
    const anchor = lastRefreshAt ?? (Number.isNaN(fetched) ? null : fetched);
    const wait = refreshDelayMs(new Date(), autoMinutes, workSchedule, anchor);
    if (wait == null) return;
    const timer = window.setTimeout(() => {
      void refreshBoard();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [ready, autoRefresh, autoMinutes, workSchedule, lastRefreshAt, matrix?.fetchedAt, refreshingBoardId, refreshBoard]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || refreshLock.current || refreshingBoardId != null) return;
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (clock < autoSaveTime) return;
      const date = todayIso();
      const stamp = autoSaveStamp(date, autoSaveTime);
      if (loadAutoSaveStamp() === stamp) return;
      const enabled = boards.filter((item) => item.enabled && item.id > 0);
      if (!enabled.length) return;
      try {
        const anchor = enabled.find((item) => item.id === activeBoardId) || enabled[0];
        await window.api.buildSummary({
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
            })),
        });
        saveAutoSaveStamp(stamp);
      } catch (e) {
        sessionLog('error', 'auto-save', { error: e instanceof Error ? e.message : String(e) });
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ready, autoSaveTime, boards, columns, activeBoardId, refreshingBoardId]);

  const setupKind = !connection.token
    ? 'integration'
    : boards.some((item) => item.enabled)
      ? null
      : 'boards';

  const activeMatrix = matrix;

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
    if (id === activeBoardId) return;
    if (refreshLock.current) {
      const ticket = ++boardSwitch.current;
      paintBoardBadge(id);
      viewRef.current = id;
      setActiveBoardId(id);
      void window.api.getLastBoard(id).then((last) => {
        if (boardSwitch.current !== ticket || viewRef.current !== id) return;
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
        setMatrix(last && last.sourceBoardLocalId === id ? last : null);
        window.setTimeout(() => revealContentFade(), 0);
      } catch (error) {
        if (boardSwitch.current !== ticket) return;
        sessionLog('error', 'switch board failed', error);
        paintBoardBadge(previousId ?? id);
        setActiveBoardId(previousId);
        setError(error instanceof Error ? error.message : String(error));
        revealContentFade();
      }
    })();
  };

  return (
    <div className="h-dvh overflow-hidden flex flex-col">
      <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
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
                        if (id === 'settings') setSettingsSection('app');
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
                const active = item.id === activeBoardId;
                const refreshing = refreshingBoardId === item.id;
                const badgeClass = refreshing
                  ? 'bro-board-progress font-semibold text-white'
                  : active
                    ? 'border border-black bg-black font-semibold text-white'
                    : 'border border-slate-300 text-slate-600 hover:bg-slate-100';
                const changed = changes.some((change) => change.boardLocalId === item.id && !change.seen);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-board-badge={item.id}
                    disabled={refreshingBoardId != null}
                    className={`relative inline-flex h-7 shrink-0 items-center rounded-md py-1 pl-2.5 pr-3.5 text-sm disabled:cursor-default ${badgeClass}`}
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
        {onBoardPage && (
          <div className="flex shrink-0 items-center gap-1.5">
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
        {!ready ? (
          <div className="text-slate-500">Загрузка…</div>
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
            onDismissChanges={(keys) => {
              if (activeBoardId == null || !keys.length) return;
              void window.api.dismissIssueChanges(activeBoardId, keys).then(setChanges);
            }}
          />
        )}
      </main>
      <footer className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 text-[11px] tabular-nums text-slate-500">
        <InstantTip text="Запросы с последнего обновления (за сегодня)" place="top">
          <span>
            API {apiUsage.sinceRefresh} ({apiUsage.dayTotal})
          </span>
        </InstantTip>
        <span className="flex items-center gap-3">
          <span>база {formatBytes(storageStats.database)}</span>
          <span>настройки {formatBytes(storageStats.settings)}</span>
          <span>логи {formatBytes(storageStats.logs)}</span>
        </span>
      </footer>
    </div>
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
