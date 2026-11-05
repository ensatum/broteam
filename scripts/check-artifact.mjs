import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'os';
import path from 'node:path';
import { assertBinary, listNodeFiles } from './ensure-native.mjs';

const APPIMAGE_EXTRACT = ['--appimage-extract'];

function assertTree(root, platform, arch) {
  const nodes = listNodeFiles(root);
  const sqlite = nodes.filter((file) => file.endsWith(`${path.sep}better_sqlite3.node`));
  if (sqlite.length === 0) {
    throw new Error(`В пакете нет better_sqlite3.node (${root})`);
  }
  for (const file of nodes) assertBinary(file, platform, arch);
}

function withTemp(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'broteam-artifact-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function inspect(file, platform, arch) {
  if (file.endsWith('.AppImage')) {
    withTemp((dir) => {
      execFileSync(file, APPIMAGE_EXTRACT, {
        cwd: dir,
        timeout: 120000,
        env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '0' },
      });
      assertTree(path.join(dir, 'squashfs-root'), platform, arch);
    });
    return;
  }
  if (file.endsWith('.deb')) {
    withTemp((dir) => {
      execFileSync('dpkg-deb', ['-x', file, dir], { timeout: 120000 });
      assertTree(dir, platform, arch);
    });
    return;
  }
  if (file.endsWith('.zip')) {
    withTemp((dir) => {
      execFileSync('unzip', ['-q', file, '-d', dir], { timeout: 120000 });
      assertTree(dir, platform, arch);
    });
  }
}

export async function artifactBuildCompleted(context) {
  const file = context.file;
  if (!file || !/\.(AppImage|deb|zip)$/.test(file)) return;
  const platform = context.packager.platform.nodeName;
  try {
    inspect(file, platform, context.arch);
    console.log(`Пакет ${path.basename(file)} содержит модуль только для ${platform}`);
  } catch (err) {
    rmSync(file, { force: true });
    throw new Error(`Пакет ${file} удалён: ${err.message}`);
  }
}

export default artifactBuildCompleted;
