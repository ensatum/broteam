#!/usr/bin/env node
/**
 * Cross-build a Windows x64 zip from Linux.
 * afterPack copies the win32 module into the app and restores the host module.
 * The zip is checked for a Windows x64 binary. No installer: NSIS needs Wine.
 * Output: release/BroTeam-*-x64-win.zip
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArtifact } from './check-artifact.mjs';
import { packTmp } from './pack-tmp.mjs';
import { readPackage } from './version-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arch = 'x64';

function run(cmd, args) {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${result.status ?? 1}`);
}

function main() {
  process.env.TMPDIR = packTmp();
  const { pkg } = readPackage(root);
  const zipName = `BroTeam-${pkg.version}-${arch}-win.zip`;
  const zipPath = path.join(root, 'release', zipName);
  run('npm', ['run', 'build']);
  try {
    run('npx', [
      'electron-builder',
      '--win',
      'zip',
      `--${arch}`,
      `-c.directories.output=release`,
      `-c.win.artifactName=BroTeam-${pkg.version}-${arch}-win.\${ext}`,
    ]);
    if (!fs.existsSync(zipPath)) throw new Error(`Нет архива ${zipPath}`);
    try {
      assertReleaseArtifact(zipPath, 'win32', arch);
    } catch (err) {
      fs.rmSync(zipPath, { force: true });
      throw err;
    }
    const byteSize = fs.statSync(zipPath).size;
    console.log(`${zipName}: ${(byteSize / 1024 / 1024).toFixed(1)} MB`);
  } finally {
    run('node', ['scripts/ensure-native.mjs', 'linux', process.arch]);
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
