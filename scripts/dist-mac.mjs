#!/usr/bin/env node
/**
 * Cross-build macOS zip from Linux, one architecture per electron-builder run.
 * x64 lands in release/mac, arm64 in release/mac-arm64 (or the other way
 * around when that arch is the default). They do not share an app directory.
 * afterPack copies the darwin module into the .app and restores the host module.
 * check-artifact rejects a package whose binary is the wrong system or arch.
 *
 * electron-builder packs the zip with 7-Zip on Linux, and 7-Zip stores every
 * framework symlink as a full copy. After that, the .app is packed again with
 * info-zip -y, the same flags a macOS build uses, so each framework file is
 * stored once. latest-mac.yml is rewritten for the zip it names.
 *
 * DMG is skipped here (needs macOS `sips`). Output: release/BroTeam-*-mac.zip
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArtifact } from './check-artifact.mjs';
import { archName, assertBinary } from './ensure-native.mjs';
import { readPackage } from './version-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function macApp(releaseDir, productName, arch) {
  const apps = [];
  if (fs.existsSync(releaseDir)) {
    for (const name of fs.readdirSync(releaseDir)) {
      if (!name.startsWith('mac')) continue;
      const app = path.join(releaseDir, name, `${productName}.app`);
      const bin = path.join(app, 'Contents', 'MacOS', productName);
      if (!fs.existsSync(bin)) continue;
      try {
        assertBinary(bin, 'darwin', arch);
      } catch {
        continue;
      }
      apps.push(app);
    }
  }
  if (apps.length !== 1) {
    throw new Error(`Для macOS ${arch} ожидалось одно приложение, найдено ${apps.length}`);
  }
  return apps[0];
}

function fileSha512(file) {
  const hash = createHash('sha512');
  hash.update(fs.readFileSync(file));
  return hash.digest('base64');
}

function patchLatestMac(releaseDir, zipName, byteSize, sha512) {
  const file = path.join(releaseDir, 'latest-mac.yml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const urls = [...text.matchAll(/^ {2}- url: (\S+)\s*$/gm)].map((match) => match[1]);
  if (!urls.includes(zipName)) return;
  if (urls.length !== 1) {
    throw new Error(`latest-mac.yml перечисляет несколько файлов, размер ${zipName} не переписан`);
  }
  const next = text
    .replace(/^( *sha512: )\S+(\s*)$/gm, `$1${sha512}$2`)
    .replace(/^( *size: )\d+(\s*)$/gm, `$1${byteSize}$2`);
  fs.writeFileSync(file, next);
}

export function slimMacZip(projectRoot, arch) {
  const { pkg: meta } = readPackage(projectRoot);
  const productName = meta.build?.productName || 'BroTeam';
  const releaseDir = path.join(projectRoot, 'release');
  const zipName = `BroTeam-${meta.version}-${arch}-mac.zip`;
  const zipPath = path.join(releaseDir, zipName);
  if (!fs.existsSync(zipPath)) throw new Error(`Нет архива ${zipPath}`);
  const app = macApp(releaseDir, productName, arch);
  const tmp = path.join(releaseDir, `.${zipName}.repack`);
  fs.rmSync(tmp, { force: true });
  try {
    run('zip', ['-q', '-y', '-r', '-9', tmp, path.basename(app)], { cwd: path.dirname(app) });
    fs.renameSync(tmp, zipPath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  try {
    assertReleaseArtifact(zipPath, 'darwin', arch);
  } catch (err) {
    fs.rmSync(zipPath, { force: true });
    throw err;
  }
  const byteSize = fs.statSync(zipPath).size;
  patchLatestMac(releaseDir, zipName, byteSize, fileSha512(zipPath));
  fs.rmSync(`${zipPath}.blockmap`, { force: true });
  console.log(`${zipName}: ${(byteSize / 1024 / 1024).toFixed(1)} MB`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const { pkg } = readPackage(root);
  const arches = process.argv.slice(2).length ? process.argv.slice(2) : ['x64', 'arm64'];
  for (const arch of arches) archName(arch);

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
      slimMacZip(root, arch);
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
}
