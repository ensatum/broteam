import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type ApiLine = { at: string; method: string; path: string; status: number; ms: number; detail: string };
type LogLine = { at: string; level: string; message: string };
type Tab = 'api' | 'log';

export function ConsoleDock(props: { open: boolean; height: number; onHeight: (height: number) => void }) {
  const [tab, setTab] = useState<Tab>('api');
  const [api, setApi] = useState<ApiLine[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    void window.api.getConsole().then((history) => {
      setApi(history.api);
      setLog(history.log);
    });
    const offApi = window.api.onConsoleApi((line) => setApi((prev) => trim([...prev, line])));
    const offLog = window.api.onConsoleLog((line) => setLog((prev) => trim([...prev, line])));
    return () => {
      offApi();
      offLog();
    };
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (props.open && stick.current && node) node.scrollTop = node.scrollHeight;
  }, [api, log, tab, props.open]);

  if (!props.open) return null;
  const lines = tab === 'api' ? api : log;

  function startResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startH = props.height;
    document.body.classList.add('bro-drag-row');
    const move = (ev: MouseEvent) => {
      const next = Math.min(window.innerHeight * 0.7, Math.max(140, startH + (startY - ev.clientY)));
      props.onHeight(next);
    };
    const up = () => {
      document.body.classList.remove('bro-drag-row');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-slate-700 bg-slate-900 text-slate-200" style={{ height: props.height }}>
      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-slate-800"
        title="Тяните, чтобы изменить высоту"
        onMouseDown={startResize}
      />
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px] leading-5"
        onScroll={(event) => {
          const node = event.currentTarget;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {lines.length === 0 && <div className="text-slate-500">Пока пусто</div>}
        {tab === 'api'
          ? api.map((line, index) => (
              <div key={`${line.at}-${index}`} className="whitespace-pre-wrap">
                <span className="text-slate-500">{clock(line.at)}</span>{' '}
                <span className={line.status >= 400 || line.status === 0 ? 'text-red-300' : 'text-emerald-300'}>
                  {line.status || 'ERR'}
                </span>{' '}
                <span className="text-sky-300">{line.method}</span> {line.path}
                <span className="text-slate-500"> {line.ms} мс</span>
                {line.detail ? <span className="text-slate-400"> · {line.detail}</span> : null}
              </div>
            ))
          : log.map((line, index) => (
              <div key={`${line.at}-${index}`} className="whitespace-pre-wrap">
                <span className="text-slate-500">{clock(line.at)}</span>{' '}
                <span className={line.level === 'error' ? 'text-red-300' : 'text-slate-400'}>{line.level}</span>{' '}
                {line.message}
              </div>
            ))}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1 border-t border-slate-700 px-1">
        <TabButton active={tab === 'api'} onClick={() => setTab('api')}>
          API
        </TabButton>
        <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
          LOG
        </TabButton>
      </div>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`h-5 rounded px-2 text-[10px] font-semibold ${
        props.active ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function trim<T>(lines: T[]): T[] {
  return lines.length > 500 ? lines.slice(lines.length - 500) : lines;
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 19);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
