export function sessionLog(level: 'info' | 'error', message: string, extra?: unknown): void {
  try {
    window.api?.sessionLog?.(level, message, toLogValue(extra));
  } catch {
    // A failed log line must not become the crash we are trying to record.
  }
}

function toLogValue(extra: unknown): unknown {
  if (extra instanceof Error) return { message: extra.message, stack: extra.stack };
  return extra;
}
