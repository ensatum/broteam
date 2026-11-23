#!/usr/bin/env node
/**
 * Pack the current package.json version as a Linux AppImage into builds/.
 * Does not bump the version, commit, or push.
 * Shared by scripts/build.sh and scripts/open-artifact.mjs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packTmp } from './pack-tmp.mjs';
import { readPackage } from './version-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function appImagePath(version) {
  return path.join(root, 'builds', `BroTeam-${version}.AppImage`);
}

function run(cmd, args) {
  console.log(`+ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${result.status ?? 1}`);
}

export function packBuild() {
  const { pkg } = readPackage(root);
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Версия не в виде год.релиз.сборка: ${version}`);
  }
  process.env.TMPDIR = packTmp();
  run('npm', ['run', 'build']);
  run('node', ['scripts/ensure-native.mjs', 'linux', process.arch]);
  run('npx', [
    'electron-builder',
    '--linux',
    'AppImage',
    `--${process.arch}`,
    '-c.directories.output=builds',
    `-c.linux.artifactName=BroTeam-${version}.\${ext}`,
  ]);
  const file = appImagePath(version);
  if (!fs.existsSync(file)) throw new Error(`Нет файла ${path.relative(root, file)}`);
  return file;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    console.log(packBuild());
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
