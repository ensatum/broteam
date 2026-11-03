import { useSyncExternalStore } from 'react';

let paused = false;
const listeners = new Set<() => void>();
let attached = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function attach(): void {
  if (attached || typeof window === 'undefined' || !window.api?.onTrackerGate) return;
  attached = true;
  window.api.onTrackerGate((state) => {
    paused = state.paused;
    emit();
  });
}

export function useTrackerPaused(): boolean {
  attach();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => paused,
  );
}
