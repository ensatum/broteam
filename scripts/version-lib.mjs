import fs from 'node:fs';

export function formatVersion(release, build, date = new Date()) {
  return `${date.getFullYear()}.${release}.${build}`;
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
