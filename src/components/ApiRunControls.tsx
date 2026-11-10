import { PauseCircleIcon, PlayCircleIcon, XCircleIcon } from './Icons';
import { useTrackerPaused } from '../trackerGate';

export function RunSpinner(props: { requests?: number; seen?: number; total?: number; countId?: string }) {
  const paused = useTrackerPaused();
  const seen = props.seen ?? 0;
  const total = props.total ?? 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-28 w-28">
        <div
          className={`absolute inset-0 rounded-full border-[5px] border-sky-100 border-t-sky-500 ${
            paused ? '' : 'animate-spin'
          }`}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            title={paused ? 'Продолжить' : 'Пауза'}
            className={`pointer-events-auto inline-flex h-16 w-16 items-center justify-center rounded-full shadow-md ${
              paused
                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                : 'bg-sky-50 text-sky-600 hover:bg-sky-100'
            }`}
            onClick={() => void (paused ? window.api.resumeTracker() : window.api.pauseTracker())}
          >
            {paused ? <PlayCircleIcon className="h-11 w-11" /> : <PauseCircleIcon className="h-11 w-11" />}
          </button>
        </div>
        {paused && (
          <button
            type="button"
            title="Прервать"
            className="pointer-events-auto absolute inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-red-600 shadow hover:bg-red-50"
            style={{ left: 82, top: 8 }}
            onClick={() => void window.api.abortTracker()}
          >
            <XCircleIcon className="h-5 w-5" />
          </button>
        )}
      </div>
      <div
        id={props.countId}
        className="mt-3 text-center text-sm font-medium text-sky-800"
      >
        {`Запросов к API: ${props.requests ?? 0}`}
      </div>
      {total > 0 && (
        <div className="mt-0.5 text-center text-xs text-slate-500" title="Задачи доски, обновлённые за выбранный период">
          Просмотрено задач: {seen} из {total}
        </div>
      )}
    </div>
  );
}
