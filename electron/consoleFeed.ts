import { BrowserWindow } from 'electron';

export type ConsoleApiLine = {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  detail: string;
};

export type ConsoleLogLine = {
  at: string;
  level: string;
  message: string;
};

const MAX = 500;
const apiLines: ConsoleApiLine[] = [];
const logLines: ConsoleLogLine[] = [];

function publish(channel: string, line: ConsoleApiLine | ConsoleLogLine): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, line);
  }
}

export function pushApiLine(line: Omit<ConsoleApiLine, 'at'>): void {
  const next = { ...line, at: new Date().toISOString() };
  apiLines.push(next);
  if (apiLines.length > MAX) apiLines.shift();
  publish('console:api', next);
}

export function pushLogLine(level: string, message: string): void {
  const next = { at: new Date().toISOString(), level, message };
  logLines.push(next);
  if (logLines.length > MAX) logLines.shift();
  publish('console:log', next);
}

export function consoleHistory(): { api: ConsoleApiLine[]; log: ConsoleLogLine[] } {
  return { api: [...apiLines], log: [...logLines] };
}
