import { AsyncLocalStorage } from 'node:async_hooks';

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
const controllers = new Map<number, Set<AbortController>>();
const runOf = new WeakMap<AbortController, number>();
const stoppedRuns = new Set<number>();
const runContext = new AsyncLocalStorage<number>();
const listeners = new Set<(state: GateState) => void>();
let abortHook: () => void = () => {};

export function setAbortHook(hook: () => void): void {
  abortHook = hook;
}

export function currentRun(): number {
  return runContext.getStore() ?? 0;
}

export function withRun<T>(id: number, fn: () => Promise<T>): Promise<T> {
  return runContext.run(id, fn);
}

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

export function stopRun(runId: number): void {
  if (!runId) return;
  stoppedRuns.add(runId);
  const bucket = controllers.get(runId);
  if (bucket) {
    for (const controller of bucket) controller.abort();
    bucket.clear();
  }
  wake();
}

export function forgetRun(runId: number): void {
  stoppedRuns.delete(runId);
  controllers.delete(runId);
}

export function abortTracker(): GateState {
  stopped = true;
  paused = false;
  abortHook();
  for (const bucket of controllers.values()) {
    for (const controller of bucket) controller.abort();
  }
  controllers.clear();
  wake();
  emit();
  return trackerGate();
}

export function bindRequest(controller: AbortController): void {
  const runId = currentRun();
  runOf.set(controller, runId);
  let bucket = controllers.get(runId);
  if (!bucket) {
    bucket = new Set();
    controllers.set(runId, bucket);
  }
  bucket.add(controller);
}

export function releaseRequest(controller: AbortController): void {
  const runId = runOf.get(controller) ?? 0;
  controllers.get(runId)?.delete(controller);
  runOf.delete(controller);
}

export async function checkpoint(): Promise<void> {
  const runId = currentRun();
  if (stopped || (runId !== 0 && stoppedRuns.has(runId))) throw new TrackerStopped();
  while (paused) {
    await new Promise<void>((resolve) => waiters.push(resolve));
    if (stopped || (runId !== 0 && stoppedRuns.has(runId))) throw new TrackerStopped();
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
