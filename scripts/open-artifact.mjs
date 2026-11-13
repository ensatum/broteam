#!/usr/bin/env node
/**
 * Open the newest packaged file.
 * AppImage is started. deb, mac zip and Windows zip are handed to the system.
 *
 * node scripts/open-artifact.mjs --what build|release --type appimage|deb|mac|win --arch x64
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, versionIn } from './prune-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = ['appimage', 'deb', 'mac', 'win'];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

function matches(name, type) {
  if (type === 'appimage') return name.endsWith('.AppImage');
  if (type === 'deb') return name.endsWith('.deb');
  if (type === 'mac') return name.endsWith('-mac.zip');
  if (type === 'win') return name.endsWith('-win.zip');
  return false;
}

function prefersArch(name, arch) {
  return name.includes(`-${arch}.`) || name.includes(`-${arch}-`);
}

function pick(dir, type, arch) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => versionIn(name) && matches(name, type))
    .map((name) => ({ name, version: versionIn(name) }));
  if (!files.length) return null;
  const newest = files.map((file) => file.version).sort(compareVersions).at(-1);
  const same = files.filter((file) => file.version === newest);
  const preferred = same.filter((file) => prefersArch(file.name, arch));
  const chosen = preferred.length ? preferred : same;
  if (chosen.length === 1) return path.join(dir, chosen[0].name);
  throw new Error(
    `Несколько пакетов ${newest}. Укажите ARCH. Сейчас: ${chosen.map((file) => file.name).join(', ')}`,
  );
}

function launch(file, type) {
  const command = type === 'appimage' ? file : 'xdg-open';
  const args = type === 'appimage' ? [] : [file];
  if (type === 'appimage') fs.chmodSync(file, 0o755);
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });
  child.unref();
  console.log(file);
}

function main() {
  const what = arg('what') || 'build';
  const type = (arg('type') || 'appimage').toLowerCase();
  const arch = arg('arch') || process.arch;
  if (what !== 'build' && what !== 'release') {
    throw new Error('WHAT: build или release');
  }
  if (!types.includes(type)) throw new Error(`TYPE: ${types.join(', ')}`);
  const dir = path.join(root, what === 'build' ? 'builds' : 'release');
  const file = pick(dir, type, arch);
  if (!file) throw new Error(`Нет пакета ${type} в ${path.relative(root, dir)}/`);
  launch(file, type);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
