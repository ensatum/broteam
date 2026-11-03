import fs from 'node:fs';
import path from 'node:path';
import { settingsPayloadBytes } from './db';

export type StorageStats = {
  database: number;
  settings: number;
  logs: number;
};

function fileSize(target: string): number {
  try {
    const stat = fs.statSync(target);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function dirSize(dir: string): number {
  let total = 0;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const target = path.join(dir, name);
    try {
      const stat = fs.statSync(target);
      total += stat.isDirectory() ? dirSize(target) : stat.size;
    } catch {
      /* a file can disappear between listing and stat */
    }
  }
  return total;
}

export function readStorageStats(userData: string): StorageStats {
  const dataDir = path.join(userData, 'data');
  const database = ['standup.sqlite', 'standup.sqlite-wal', 'standup.sqlite-shm'].reduce(
    (sum, name) => sum + fileSize(path.join(dataDir, name)),
    0,
  );
  return {
    database,
    settings: settingsPayloadBytes(),
    logs: dirSize(path.join(userData, 'logs')),
  };
}
