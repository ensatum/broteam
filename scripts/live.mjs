#!/usr/bin/env node
/**
 * Run the live app after the previous BroTeam has quit.
 *
 * node scripts/live.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopRunning } from './stop-running.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  await stopRunning({ freeDevPort: true });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const child = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit' });
child.on('error', (err) => {
  console.error(err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
