#!/usr/bin/env node
/**
 * Cross-build macOS zip from Linux, one architecture per electron-builder run.
 * x64 lands in release/mac, arm64 in release/mac-arm64 (or the other way
 * around when that arch is the default). They do not share an app directory.
 * afterPack copies the darwin module into the .app and restores the host module.
 * check-artifact rejects a package whose binary is the wrong system or arch.
 *
 * DMG is skipped here (needs macOS `sips`). Output: release/BroTeam-*-mac.zip
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archName } from './ensure-native.mjs';
import { readPackage } from './version-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pkg } = readPackage(root);
const arches = process.argv.slice(2).length ? process.argv.slice(2) : ['x64', 'arm64'];
for (const arch of arches) archName(arch);

function run(cmd, args, opts = {}) {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} → ${r.status ?? 1}`);
  }
}

run('npm', ['run', 'build']);

try {
  for (const arch of arches) {
    run('npx', [
      'electron-builder',
      '--mac',
      'zip',
      `--${arch}`,
      `-c.mac.artifactName=BroTeam-${pkg.version}-${arch}-mac.\${ext}`,
    ]);
  }
} finally {
  run('node', ['scripts/ensure-native.mjs', 'linux', process.arch]);
}

console.log('\nmac zip artifacts:');
for (const name of fs.readdirSync(path.join(root, 'release')).sort()) {
  if (/BroTeam-.*-mac\.zip$/i.test(name)) {
    const st = fs.statSync(path.join(root, 'release', name));
    console.log(`  ${name} (${Math.round(st.size / 1024 / 1024)} MB)`);
  }
}
