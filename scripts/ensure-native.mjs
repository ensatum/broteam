import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = path.join(root, 'node_modules/better-sqlite3');
export const nativeModulePath = path.join(mod, 'build/Release/better_sqlite3.node');

const archByIndex = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

export function archName(arch) {
  const name = typeof arch === 'number' ? archByIndex[arch] : arch;
  if (!name || name === 'universal') {
    throw new Error(`Архитектура ${arch} собирается только отдельно, не универсальным пакетом`);
  }
  if (!['ia32', 'x64', 'armv7l', 'arm64'].includes(name)) {
    throw new Error(`Неизвестная архитектура: ${arch}`);
  }
  return name;
}

export function electronVersion() {
  return JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
}

export function installNative(platform, arch) {
  const name = archName(arch);
  const prebuildArch = name === 'armv7l' ? 'arm' : name;
  const version = electronVersion();
  execFileSync(
    'npx',
    [
      '--yes',
      'prebuild-install',
      '--runtime', 'electron',
      '--target', version,
      '--platform', platform,
      '--arch', prebuildArch,
    ],
    { cwd: mod, stdio: 'inherit' },
  );
  assertBinary(nativeModulePath, platform, name);
  console.log(`better_sqlite3.node: ${platform} ${name}, Electron ${version}`);
}

export function listNodeFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names;
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(current, name);
      let st;
      try {
        st = lstatSync(file);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) stack.push(file);
      else if (name.endsWith('.node')) out.push(file);
    }
  }
  return out;
}

export function describeBinary(file) {
  return execFileSync('file', ['-b', file], { encoding: 'utf8' }).trim();
}

function family(kind) {
  const elf = kind.includes('ELF');
  const macho = kind.includes('Mach-O');
  const pe = /PE32|MS Windows|DOS executable/.test(kind);
  if (elf + macho + pe !== 1) return null;
  if (elf) return 'linux';
  if (macho) return 'darwin';
  return 'win32';
}

function archMatches(kind, arch) {
  if (arch === 'x64') return /x86[-_]64/.test(kind);
  if (arch === 'arm64') return /aarch64|\barm64\b/.test(kind);
  if (arch === 'ia32') return /80386|\bi386\b/.test(kind);
  if (arch === 'armv7l') return /\bARM\b/.test(kind) && !/aarch64/.test(kind);
  return false;
}

export function assertBinary(file, platform, arch) {
  const kind = describeBinary(file);
  const got = family(kind);
  const name = arch == null ? null : archName(arch);
  if (got !== platform || (name && !archMatches(kind, name))) {
    throw new Error(`${file}: ${kind}. Для ${platform}${name ? ` ${name}` : ''} это модуль другой системы`);
  }
  return kind;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  installNative(process.argv[2] || 'linux', process.argv[3] || process.arch);
}
