import { mkdirSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.pack-tmp');
const need = 4 * 1024 * 1024 * 1024;

/** Packaging unpacks Electron into the temp directory. /tmp sits on a small root disk. */
export function packTmp() {
  mkdirSync(local, { recursive: true });
  const current = process.env.TMPDIR || os.tmpdir();
  try {
    const stat = statfsSync(current);
    if (Number(stat.bavail) * Number(stat.bsize) >= need) return current;
  } catch {
    /* use the repository disk */
  }
  return local;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) process.stdout.write(packTmp());
