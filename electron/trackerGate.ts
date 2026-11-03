export class TrackerStopped extends Error {
  constructor() {
    super('Запросы остановлены');
    this.name = 'TrackerStopped';
  }
}

export function isTrackerStopped(error: unknown): boolean {
  return error instanceof TrackerStopped || (error instanceof Error && error.message === 'Запросы остановлены');
}

type GateState = { paused: boolean };

let paused = false;
let stopped = false;
let waiters: Array<() => void> = [];
const controllers = new Set<AbortController>();
const listeners = new Set<(state: GateState) => void>();

export function trackerGate(): GateState {
  return { paused };
}

export function subscribeTrackerGate(listener: (state: GateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const state = trackerGate();
  for (const listener of listeners) listener(state);
}

function wake(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

/** Allow a new run after a previous abort. */
export function armTracker(): void {
  stopped = false;
  paused = false;
  emit();
}

export function pauseTracker(): GateState {
  paused = true;
  emit();
  return trackerGate();
}

export function resumeTracker(): GateState {
  paused = false;
  wake();
  emit();
  return trackerGate();
}

export function abortTracker(): GateState {
  stopped = true;
  paused = false;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  wake();
  emit();
  return trackerGate();
}

export function bindRequest(controller: AbortController): void {
  controllers.add(controller);
}

export function releaseRequest(controller: AbortController): void {
  controllers.delete(controller);
}

export async function checkpoint(): Promise<void> {
  if (stopped) throw new TrackerStopped();
  while (paused) {
    await new Promise<void>((resolve) => waiters.push(resolve));
    if (stopped) throw new TrackerStopped();
  }
}

export async function pauseableWait(ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await checkpoint();
    const slice = Math.min(200, end - Date.now());
    if (slice <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, slice));
  }
}
