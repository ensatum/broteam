import fs from 'node:fs';
import path from 'node:path';
import { pushLogLine } from './consoleFeed';

const MAX_BYTES = 256 * 1024;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const KEEP = new Set(['session.log', 'session.prev.log']);

let filePath = '';

export function initSessionLog(userData: string): string {
  const dir = path.join(userData, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const name of fs.readdirSync(dir)) {
    const target = path.join(dir, name);
    let age = MAX_AGE_MS + 1;
    try {
      age = now - fs.statSync(target).mtimeMs;
    } catch {
      age = MAX_AGE_MS + 1;
    }
    if (!KEEP.has(name) || age > MAX_AGE_MS) {
      fs.rmSync(target, { force: true, recursive: true });
    }
  }
  const current = path.join(dir, 'session.log');
  const prev = path.join(dir, 'session.prev.log');
  if (fs.existsSync(current)) {
    fs.rmSync(prev, { force: true });
    fs.renameSync(current, prev);
  }
  filePath = current;
  write('info', 'session start', { pid: process.pid, userData });
  return filePath;
}

export function sessionLogPath(): string {
  return filePath;
}

export function sessionLog(level: string, message: string, extra?: unknown): void {
  write(level, message, extra);
}

function write(level: string, message: string, extra?: unknown): void {
  if (!filePath) return;
  const stamp = new Date().toISOString();
  const detail = pack(extra);
  const line = detail
    ? `${stamp} ${level.toUpperCase()} ${message} ${detail}\n`
    : `${stamp} ${level.toUpperCase()} ${message}\n`;
  pushLogLine(level, detail ? `${message} ${detail}` : message);
  try {
    fs.appendFileSync(filePath, line);
    const size = fs.statSync(filePath).size;
    if (size <= MAX_BYTES) return;
    const text = fs.readFileSync(filePath, 'utf8');
    const kept = text.slice(Math.max(0, text.length - Math.floor(MAX_BYTES / 2)));
    const cut = kept.indexOf('\n');
    fs.writeFileSync(filePath, (cut >= 0 ? kept.slice(cut + 1) : kept));
  } catch {
    // Logging must not take the app down with it.
  }
}

function pack(extra: unknown): string {
  if (extra == null) return '';
  try {
    const text = JSON.stringify(extra, (key, value) => {
      if (/token|password|secret|authorization|oauth|cookie|api[-_]?key/i.test(key)) return '•••';
      if (value instanceof Error) return { message: value.message, stack: value.stack };
      return value;
    });
    if (!text || text === '{}' || text === 'null') return '';
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return String(extra).slice(0, 500);
  }
}
