import { StopCircleIcon } from './Icons';

export function RunSpinner(props: {
  requests?: number;
  seen?: number;
  total?: number;
  countId?: string;
  onStop: () => void | Promise<void>;
}) {
  const seen = props.seen ?? 0;
  const total = props.total ?? 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-28 w-28">
        <div className="absolute inset-0 animate-spin rounded-full border-[5px] border-sky-100 border-t-sky-500" />
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            title="Остановить"
            className="pointer-events-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-600 shadow-md hover:bg-slate-200"
            onClick={() => void props.onStop()}
          >
            <StopCircleIcon className="h-11 w-11" />
          </button>
        </div>
      </div>
      <div id={props.countId} className="mt-3 text-center text-sm font-medium text-sky-800">
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

export function stopBoardRefresh(): Promise<void> {
  return stopMatchingRuns((title) => title.startsWith('Обновление досок'));
}

export function stopMatchingRuns(match: (title: string) => boolean): Promise<void> {
  return window.api.listTrackerRuns().then(async (runs) => {
    for (const run of runs) {
      if (!match(run.title)) continue;
      await window.api.cancelTrackerRun(run.id);
    }
  });
}
