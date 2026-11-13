import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppUpdateProgress } from '../shared/appUpdate';
import { getGithub } from './db';
import { isNewerVersion, liveVersion, parseAppVersion, versionLabels } from '../shared/version';

export type AppUpdateResult = {
  updated: boolean;
  restarted: boolean;
  message: string;
  handoff?: boolean;
};

const GITHUB_HEADERS = {
  'User-Agent': 'BroTeam',
  Accept: 'application/vnd.github+json',
};

function parseGithubRepo(remote: string): { owner: string; repo: string } {
  const trimmed = remote.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const match = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error('Укажите репозиторий GitHub, например https://github.com/ensatum/broteam');
  return { owner: match[1], repo: match[2] };
}

function releaseTag(version: string): string {
  const parts = version.split('.');
  if (parts.length < 2) return version;
  return parts.slice(0, -1).join('.');
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: GITHUB_HEADERS });
  if (response.status === 404) throw new Error('not-found');
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}.`);
  return (await response.json()) as T;
}

function artifactMatches(name: string, version: string): boolean {
  if (!versionLabels(version).some((label) => name.includes(label))) return false;
  if (process.platform === 'linux') return name.endsWith('.AppImage');
  if (process.platform === 'darwin') {
    if (!name.endsWith('.zip') || !name.includes('-mac')) return false;
    if (process.arch === 'arm64') return name.includes('arm64');
    return !name.includes('arm64');
  }
  if (process.platform === 'win32') return name.endsWith('.zip') && name.includes('-win');
  return false;
}

function newestVersion(versions: string[], baked: string): string | null {
  let best: string | null = null;
  for (const version of versions) {
    if (!parseAppVersion(version)) continue;
    if (best && !isNewerVersion(version, best)) continue;
    best = version;
  }
  if (!best || !isNewerVersion(best, baked)) return null;
  return best;
}

function canWrite(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`Команда ${command} не выполнилась.`);
}

/** Packaged Mac app: …/BroTeam.app/Contents/MacOS/BroTeam */
function runningMacApp(): string | null {
  const bundle = path.resolve(process.execPath, '../../..');
  if (!bundle.endsWith('.app') || path.basename(bundle) === 'Electron.app') return null;
  return bundle;
}

function macCanReplace(bundle: string): boolean {
  if (bundle.includes('/AppTranslocation/') || bundle.includes('/private/var/folders/')) return false;
  if (bundle.startsWith('/Volumes/')) return false;
  return canWrite(path.dirname(bundle));
}

function macInstallDestination(): string {
  const current = runningMacApp();
  if (current && macCanReplace(current)) return current;
  const userApps = path.join(app.getPath('home'), 'Applications');
  fs.mkdirSync(userApps, { recursive: true });
  if (canWrite(userApps)) return path.join(userApps, 'BroTeam.app');
  if (canWrite('/Applications')) return '/Applications/BroTeam.app';
  throw new Error('Нет прав заменить приложение. Перенесите BroTeam.app в папку «Программы» и повторите.');
}

function findMacApp(dir: string): string | null {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.app')) return path.join(dir, name);
  }
  return null;
}

function installMacZip(zip: string, report: (progress: AppUpdateProgress) => void): AppUpdateResult {
  if (!runningMacApp()) {
    throw new Error('Автоустановка доступна для собранного приложения, не для запуска из исходников.');
  }
    const dest = macInstallDestination();
    const replacing = dest === runningMacApp();
    const message = replacing
      ? `Файл скачан в ${zip}. После выхода приложение будет заменено и запущено снова.`
      : `Файл скачан в ${zip}. Текущую копию заменить нельзя, ставим в ${dest} и запускаем её.`;
    report({ phase: 'install', message, received: 0, total: 0 });
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-mac-'));
  try {
    run('ditto', ['-xk', zip, extracted]);
    const unpacked = findMacApp(extracted);
    if (!unpacked) throw new Error('В архиве нет приложения.');
    const stagedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-next-'));
    const staged = path.join(stagedDir, 'BroTeam.app');
    run('ditto', [unpacked, staged]);
    const script = path.join(os.tmpdir(), `broteam-install-${process.pid}.sh`);
    fs.writeFileSync(
      script,
      `#!/bin/bash
set -euo pipefail
pid="$1"
src="$2"
dest="$3"
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
done
mkdir -p "$(dirname "$dest")"
backup="\${dest}.previous"
rm -rf "$backup"
if [[ -d "$dest" ]]; then
  mv "$dest" "$backup"
fi
if ! ditto "$src" "$dest"; then
  if [[ -d "$backup" ]]; then
    rm -rf "$dest"
    mv "$backup" "$dest"
  fi
  exit 1
fi
xattr -dr com.apple.quarantine "$dest" || true
rm -rf "$backup" "$(dirname "$src")"
open "$dest"
rm -f "$0"
`,
      { mode: 0o755 },
    );
    const child = spawn('bash', [script, String(process.pid), staged, dest], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    app.exit(0);
    return { updated: true, restarted: true, message };
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

async function installDownloaded(
  file: string,
  report: (progress: AppUpdateProgress) => void,
  hold: { keep: boolean },
): Promise<AppUpdateResult> {
  const appImage = process.env.APPIMAGE;
  if (process.platform === 'linux' && appImage && file.endsWith('.AppImage')) {
    const message = `Файл скачан в ${file}. После выхода он заменит текущий AppImage и приложение запустится снова.`;
    report({ phase: 'install', message, received: 0, total: 0 });
    const script = path.join(os.tmpdir(), `broteam-install-${process.pid}.sh`);
    fs.writeFileSync(
      script,
      `#!/bin/bash
set -euo pipefail
pid="$1"
src="$2"
dest="$3"
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2
done
cp -f "$src" "$dest"
chmod 755 "$dest"
rm -rf "$(dirname "$src")"
setsid "$dest" >/dev/null 2>&1 < /dev/null &
rm -f "$0"
`,
      { mode: 0o755 },
    );
    const child = spawn('bash', [script, String(process.pid), file, appImage], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    hold.keep = true;
    app.exit(0);
    return { updated: true, restarted: true, message, handoff: true };
  }
  if (process.platform === 'darwin' && file.endsWith('.zip')) {
    return installMacZip(file, report);
  }
  const dest = path.join(app.getPath('downloads'), path.basename(file));
  fs.copyFileSync(file, dest);
  fs.chmodSync(dest, 0o755);
  return {
    updated: true,
    restarted: false,
    message: `Файл скачан в ${dest}. ${
      process.platform === 'linux'
        ? 'Автоматическая установка и перезапуск доступны для установленного AppImage.'
        : 'Дальше замените программу этим файлом вручную.'
    }`,
  };
}

export async function checkGithub(remote: string, branch: string): Promise<void> {
  const name = branch.trim();
  if (!remote.trim() || !name) throw new Error('Укажите репозиторий и ветку.');
  const { owner, repo } = parseGithubRepo(remote);
  try {
    await githubJson(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(name)}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'not-found') {
      throw new Error('Репозиторий или ветка не найдены.');
    }
    throw error;
  }
}

type ReleaseAsset = {
  name: string;
  size?: number;
  browser_download_url: string;
};

async function assetByteSize(asset: ReleaseAsset): Promise<number> {
  if (asset.size && asset.size > 0) return asset.size;
  const head = await fetch(asset.browser_download_url, {
    method: 'HEAD',
    headers: { 'User-Agent': 'BroTeam' },
  });
  const length = Number(head.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : 0;
}

async function downloadToFile(
  url: string,
  dest: string,
  total: number,
  onBytes: (received: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'BroTeam', Accept: 'application/octet-stream' },
  });
  if (!response.ok || !response.body) throw new Error(`Файл не скачался.`);
  const headerLength = Number(response.headers.get('content-length'));
  const expected = headerLength > 0 ? headerLength : total;
  let received = 0;
  let reportedAt = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      const now = Date.now();
      if (now - reportedAt >= 100) {
        reportedAt = now;
        onBytes(received, expected);
      }
      callback(null, chunk);
    },
  });
  const body = response.body as unknown as import('node:stream/web').ReadableStream;
  await pipeline(Readable.fromWeb(body), counter, fs.createWriteStream(dest));
  onBytes(received, expected || received);
}

export async function updateAppFromRepository(
  report: (progress: AppUpdateProgress) => void,
): Promise<AppUpdateResult> {
  const source = getGithub();
  const remote = source.remote.trim();
  const branch = source.branch.trim();
  if (!remote || !branch) throw new Error('Сначала укажите репозиторий в разделе «Интеграции».');
  const { owner, repo } = parseGithubRepo(remote);
  const baked = app.getVersion();
  const shown = liveVersion(baked).full;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-update-'));
  const hold = { keep: false };
  try {
    report({
      phase: 'version',
      message: `Сверяем установленную версию ${shown} с репозиторием.`,
      received: 0,
      total: 0,
    });
    const pkgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/package.json`;
    const pkgResponse = await fetch(pkgUrl, { headers: { 'User-Agent': 'BroTeam' } });
    if (pkgResponse.status === 404) throw new Error('В этой ветке нет package.json.');
    if (!pkgResponse.ok) throw new Error(`GitHub ответил ${pkgResponse.status}.`);
    const remotePkg = (await pkgResponse.json()) as { version?: string };
    const latest = newestVersion([remotePkg.version || ''], baked);
    if (!latest) {
      return { updated: false, restarted: false, message: `Установлена последняя версия ${shown}.` };
    }
    report({
      phase: 'size',
      message: `В репозитории версия ${latest}, она новее установленной ${shown}. Запрашиваем размер файла обновления.`,
      received: 0,
      total: 0,
    });
    const tag = releaseTag(latest);
    let release: { assets?: ReleaseAsset[] };
    try {
      release = await githubJson(
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'not-found') {
        throw new Error(`Релиз ${tag} на GitHub не опубликован. Прикрепите файлы к этому тегу на странице Releases.`);
      }
      throw error;
    }
    const asset = (release.assets || []).find((item) => artifactMatches(item.name, latest));
    if (!asset) {
      return {
        updated: false,
        restarted: false,
        message: `Есть версия ${latest}, но файла для этой системы нет.`,
      };
    }
    const total = await assetByteSize(asset);
    if (!total) throw new Error(`Не удалось узнать размер файла ${asset.name}.`);
    const downloaded = path.join(temp, asset.name);
    report({
      phase: 'download',
      message: `Скачиваем ${asset.name} в ${temp}.`,
      received: 0,
      total,
    });
    await downloadToFile(asset.browser_download_url, downloaded, total, (received, size) => {
      report({
        phase: 'download',
        message: `Скачиваем ${asset.name} в ${temp}.`,
        received,
        total: size,
      });
    });
    const installed = await installDownloaded(downloaded, report, hold);
    return installed;
  } finally {
    if (!hold.keep) fs.rmSync(temp, { recursive: true, force: true });
  }
}
