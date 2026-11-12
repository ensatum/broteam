import { forgetRun, stopRun } from './trackerGate';

export type TrackerRunState = {
  id: number;
  title: string;
  done: number;
  total: number;
  requests: number;
};

let nextId = 1;
const runs = new Map<number, TrackerRunState>();
const listeners = new Set<(runs: TrackerRunState[]) => void>();

function emit(): void {
  const list = [...runs.values()];
  for (const listener of listeners) listener(list);
}

export function subscribeTrackerRuns(listener: (runs: TrackerRunState[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listTrackerRuns(): TrackerRunState[] {
  return [...runs.values()];
}

export function startRun(title: string): number {
  const id = nextId;
  nextId += 1;
  runs.set(id, { id, title, done: 0, total: 0, requests: 0 });
  emit();
  return id;
}

export function setRunProgress(id: number, done: number, total: number): void {
  const run = runs.get(id);
  if (!run) return;
  run.done = done;
  run.total = total;
  emit();
}

export function noteRunRequest(id: number): void {
  const run = runs.get(id);
  if (!run) return;
  run.requests += 1;
  emit();
}

export function finishRun(id: number): void {
  runs.delete(id);
  forgetRun(id);
  emit();
}

export function cancelRun(id: number): void {
  stopRun(id);
  runs.delete(id);
  emit();
}

export function cancelAllRuns(): void {
  for (const id of [...runs.keys()]) stopRun(id);
  runs.clear();
  emit();
}
