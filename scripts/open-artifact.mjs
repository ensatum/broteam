#!/usr/bin/env node
/**
 * Open a packaged file.
 * The build AppImage is the version recorded in git. If that file is missing, it is packed
 * from a clean tree without a version bump, commit, or push. Other packages are the newest local file.
 * A running BroTeam is closed before launch.
 * AppImage is started. deb, mac zip and Windows zip are handed to the system.
 *
 * node scripts/open-artifact.mjs --what build|release --type appimage|deb|mac|win --arch x64
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appImagePath, packBuild } from './pack-build.mjs';
import { compareVersions, versionIn } from './prune-artifacts.mjs';
import { stopRunning } from './stop-running.mjs';

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

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitError(err, fallback) {
  const detail = err.stderr ? String(err.stderr).trim() : '';
  return detail ? `${fallback} ${detail}` : fallback;
}

function versionInGit() {
  let raw;
  try {
    raw = git(['show', 'HEAD:package.json']);
  } catch (err) {
    throw new Error(gitError(err, 'Не удалось прочитать версию сборки из git.'));
  }
  let version = '';
  try {
    version = JSON.parse(raw).version;
  } catch {
    throw new Error('package.json в git не читается.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Версия в git не в виде год.релиз.сборка: ${version}`);
  }
  return version;
}

function ensureCanRebuild() {
  let gitDir;
  let status;
  try {
    gitDir = path.resolve(root, git(['rev-parse', '--git-dir']).trim());
    status = git(['status', '--porcelain']);
  } catch (err) {
    throw new Error(gitError(err, 'Не удалось проверить git.'));
  }
  if (
    fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
    fs.existsSync(path.join(gitDir, 'rebase-apply')) ||
    fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))
  ) {
    throw new Error('Сначала завершите rebase или merge.');
  }
  if (status.trim()) {
    throw new Error(
      'Этой сборки нет в builds/, а рабочая копия отличается от git. Без бампа её можно собрать только из чистого дерева.',
    );
  }
}

function buildAppImage() {
  const version = versionInGit();
  const expected = appImagePath(version);
  if (fs.existsSync(expected)) return expected;
  ensureCanRebuild();
  console.log(`Сборки ${version} нет в builds/. Собираю её без бампа версии.`);
  const packed = packBuild();
  if (path.resolve(packed) !== path.resolve(expected) || !fs.existsSync(expected)) {
    throw new Error(`Сборка ${version} не появилась в builds/.`);
  }
  return expected;
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

async function main() {
  const what = arg('what') || 'build';
  const type = (arg('type') || 'appimage').toLowerCase();
  const arch = arg('arch') || process.arch;
  if (what !== 'build' && what !== 'release') {
    throw new Error('WHAT: build или release');
  }
  if (!types.includes(type)) throw new Error(`TYPE: ${types.join(', ')}`);
  const dir = path.join(root, what === 'build' ? 'builds' : 'release');
  const file = what === 'build' && type === 'appimage' ? buildAppImage() : pick(dir, type, arch);
  if (!file) throw new Error(`Нет пакета ${type} в ${path.relative(root, dir)}/`);
  await stopRunning();
  launch(file, type);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
