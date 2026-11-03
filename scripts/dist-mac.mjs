#!/usr/bin/env node
/**
 * Cross-build macOS zip from Linux.
 * electron-builder alone leaves host (Linux) better-sqlite3.node inside the .app —
 * this script swaps in official darwin Electron prebuilds before packaging.
 *
 * DMG is skipped here (needs macOS `sips`). Output: release/BroTeam-*-mac.zip
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3');
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
    process.exit(r.status ?? 1);
  }
}

function installPrebuild(platform, arch) {
  console.log(`\n→ better-sqlite3 prebuild ${platform}-${arch} (electron ${electronVersion})`);
  run(
    'npx',
    [
      '--yes',
      'prebuild-install',
      '--platform',
      platform,
      '--arch',
      arch,
      '--runtime',
      'electron',
      '--target',
      electronVersion,
    ],
    { cwd: sqliteDir },
  );
}

function assertMachO(appOutDir) {
  const nodeFile = path.join(
    appOutDir,
    'BroTeam.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );
  if (!fs.existsSync(nodeFile)) {
    console.error(`missing native module: ${nodeFile}`);
    process.exit(1);
  }
  const file = spawnSync('file', [nodeFile], { encoding: 'utf8' });
  const out = file.stdout || '';
  console.log(`  native: ${out.trim()}`);
  if (!/Mach-O/.test(out)) {
    console.error('better_sqlite3.node is not a macOS Mach-O binary — aborting');
    process.exit(1);
  }
}

run('npm', ['run', 'build']);

for (const arch of arches) {
  installPrebuild('darwin', arch);
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

// Restore Linux binary for local dist:linux / dev
installPrebuild('linux', process.arch === 'arm64' ? 'arm64' : 'x64');

console.log('\nmac zip artifacts:');
for (const name of fs.readdirSync(path.join(root, 'release')).sort()) {
  if (/BroTeam-.*-mac\.zip$/i.test(name)) {
    const st = fs.statSync(path.join(root, 'release', name));
    console.log(`  ${name} (${Math.round(st.size / 1024 / 1024)} MB)`);
  }
}
