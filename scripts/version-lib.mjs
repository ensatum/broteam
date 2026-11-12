import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function formatVersion(release, build, date = new Date()) {
  return `${date.getFullYear()}.${release}.${build}`;
}

export function releaseTag(version) {
  const match = /^(\d+\.\d+)\.\d+$/.exec(String(version));
  if (!match) throw new Error(`Версия не в виде год.релиз.сборка: ${version}`);
  return match[1];
}

export function readPackage(root) {
  const file = `${root}/package.json`;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const release = Number(pkg.broteam?.release);
  const build = Number(pkg.broteam?.build);
  if (!Number.isInteger(release) || !Number.isInteger(build)) {
    throw new Error('В package.json нужны целые broteam.release и broteam.build');
  }
  return { file, pkg, release, build };
}

export function writePackageVersion(root, release, build, date = new Date()) {
  const { file, pkg } = readPackage(root);
  const version = formatVersion(release, build, date);
  pkg.version = version;
  pkg.broteam = { ...(pkg.broteam || {}), release, build };
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return version;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const kind = process.argv[2] || 'version';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { pkg } = readPackage(root);
  if (kind === 'version') process.stdout.write(pkg.version);
  else if (kind === 'tag') process.stdout.write(releaseTag(pkg.version));
  else {
    console.error('Использование: node scripts/version-lib.mjs [version|tag]');
    process.exit(1);
  }
}
