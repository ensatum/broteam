#!/usr/bin/env node
/**
 * Cross-build macOS zip from Linux.
 * The pack hook writes the darwin module into the .app and puts the Linux
 * module back. This script only checks the finished .app.
 *
 * DMG is skipped here (needs macOS `sips`). Output: release/BroTeam-*-mac.zip
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const arches = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['x64', 'arm64'];

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

function assertMachO(appOutDir) {
  const nodeFile = path.join(
    appOutDir,
    'BroTeam.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  if (!fs.existsSync(nodeFile)) {
    throw new Error(`missing native module: ${nodeFile}`);
  }
  const file = spawnSync('file', [nodeFile], { encoding: 'utf8' });
  const out = file.stdout || '';
  console.log(`  native: ${out.trim()}`);
  if (!/Mach-O/.test(out)) {
    throw new Error('better_sqlite3.node is not a macOS Mach-O binary — aborting');
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
    const appOut = arch === 'x64' ? path.join(root, 'release/mac') : path.join(root, 'release/mac-arm64');
    assertMachO(appOut);
  }
} finally {
  run('node', ['scripts/ensure-native.mjs', 'linux', process.arch === 'arm64' ? 'arm64' : 'x64']);
}

console.log('\nmac zip artifacts:');
for (const name of fs.readdirSync(path.join(root, 'release')).sort()) {
  if (/BroTeam-.*-mac\.zip$/i.test(name)) {
    const st = fs.statSync(path.join(root, 'release', name));
    console.log(`  ${name} (${Math.round(st.size / 1024 / 1024)} MB)`);
  }
}
