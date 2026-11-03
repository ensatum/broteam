#!/usr/bin/env node
/** Compatibility wrapper: release/ keeps only the latest version. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, [path.join(root, 'scripts/prune-artifacts.mjs'), path.join(root, 'release'), '1'], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
