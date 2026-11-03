import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getGithub } from './db';
import { isNewerVersion, liveVersion, parseAppVersion, versionLabels } from '../shared/version';

export type AppUpdateResult = {
  updated: boolean;
  restarted: boolean;
  message: string;
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
    if (!name.endsWith('.zip')) return false;
    if (process.arch === 'arm64') return name.includes('arm64');
    return !name.includes('arm64');
  }
  if (process.platform === 'win32') return name.endsWith('.exe');
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

async function installDownloaded(file: string, report: (message: string) => void): Promise<AppUpdateResult> {
  const appImage = process.env.APPIMAGE;
  if (process.platform === 'linux' && appImage && file.endsWith('.AppImage')) {
    report('Устанавливаем и перезапускаем…');
    fs.copyFileSync(file, appImage);
    fs.chmodSync(appImage, 0o755);
    const child = spawn(appImage, [], { detached: true, stdio: 'ignore' });
    child.unref();
    app.exit(0);
    return { updated: true, restarted: true, message: 'Приложение перезапускается.' };
  }
  const dest = path.join(app.getPath('downloads'), path.basename(file));
  fs.copyFileSync(file, dest);
  fs.chmodSync(dest, 0o755);
  return {
    updated: true,
    restarted: false,
    message: `Скачано: ${dest}. Автоперезапуск доступен для установленного AppImage.`,
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

export async function updateAppFromRepository(
  report: (message: string) => void,
): Promise<AppUpdateResult> {
  const source = getGithub();
  const remote = source.remote.trim();
  const branch = source.branch.trim();
  if (!remote || !branch) throw new Error('Сначала укажите репозиторий в разделе «Интеграции».');
  const { owner, repo } = parseGithubRepo(remote);
  const baked = app.getVersion();
  const shown = liveVersion(baked).full;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'broteam-update-'));
  try {
    report('Проверяем…');
    const pkgUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/package.json`;
    const pkgResponse = await fetch(pkgUrl, { headers: { 'User-Agent': 'BroTeam' } });
    if (pkgResponse.status === 404) throw new Error('В этой ветке нет package.json.');
    if (!pkgResponse.ok) throw new Error(`GitHub ответил ${pkgResponse.status}.`);
    const remotePkg = (await pkgResponse.json()) as { version?: string };
    const latest = newestVersion([remotePkg.version || ''], baked);
    if (!latest) {
      return { updated: false, restarted: false, message: `Установлена последняя версия ${shown}.` };
    }
    const tag = releaseTag(latest);
    let release: { assets?: Array<{ name: string; browser_download_url: string }> };
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
    report(`Скачиваем ${latest}…`);
    const downloaded = path.join(temp, asset.name);
    const fileResponse = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'BroTeam', Accept: 'application/octet-stream' },
    });
    if (!fileResponse.ok || !fileResponse.body) {
      throw new Error(`Файл ${asset.name} не скачался.`);
    }
    const body = fileResponse.body as unknown as import('node:stream/web').ReadableStream;
    await pipeline(Readable.fromWeb(body), fs.createWriteStream(downloaded));
    return await installDownloaded(downloaded, report);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
