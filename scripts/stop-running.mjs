#!/usr/bin/env node
/**
 * Ask the running BroTeam to quit, then stop this repo's dev server.
 * A forced kill happens only if the process ignores the quit signal.
 *
 * The dev port is Vite's server.port in vite.config.ts.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devElectron = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
const devPort = 5173;
const politeMs = 2500;
const termMs = 2500;
const killMs = 1000;
const dataNames = ['bro-team', 'BroTeam', 'BroTracker', 'tracker-standup'];

function configHome() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alive(pid) {
  if (!pid || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {
      /* already gone */
    }
  }
}

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function cwdOf(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return '';
  }
}

function parentOf(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = /^PPid:\s+(\d+)/m.exec(status);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function ownTree() {
  const keep = new Set([process.pid]);
  let current = process.pid;
  while (current > 1) {
    const parent = parentOf(current);
    if (!parent || keep.has(parent)) break;
    keep.add(parent);
    current = parent;
  }
  return keep;
}

function listPids() {
  if (process.platform !== 'linux') return [];
  try {
    return fs
      .readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    return [];
  }
}

export function isTrackedProcess(argv, cwd, children = false) {
  if (!argv?.length) return false;
  const child = argv.some((arg) => arg.startsWith('--type='));
  if (child) {
    if (!children) return false;
    return argv[0] === devElectron || /(^|\/)broteam$/i.test(argv[0]);
  }
  if (/(^|\/)broteam$/i.test(argv[0])) return true;
  if (/\.AppImage$/i.test(argv[0]) && /broteam/i.test(path.basename(argv[0]))) return true;
  if (argv[0] === devElectron) return true;
  if (cwd !== root) return false;
  const line = argv.join(' ');
  if (line.includes(`${root}/node_modules/vite/`)) return true;
  if (line.includes(`${root}/node_modules/.bin/vite`)) return true;
  if (line.includes(`${root}/node_modules/concurrently/`)) return true;
  if (line.includes(`${root}/node_modules/.bin/concurrently`)) return true;
  if (line.includes(`${root}/node_modules/wait-on/`)) return true;
  if (line.includes(`${root}/node_modules/cross-env/`)) return true;
  if (line.includes(`${root}/node_modules/electron/cli.js`)) return true;
  if (line.includes(`${root}/node_modules/.bin/electron`)) return true;
  if (line.includes('VITE_DEV_SERVER_URL=')) return true;
  const run = argv.indexOf('run');
  if (run < 0) return false;
  const script = argv[run + 1] || '';
  return script === 'dev' || script === 'dev:vite' || script === 'dev:electron';
}

function trackedPids(children) {
  const keep = ownTree();
  const found = [];
  for (const pid of listPids()) {
    if (keep.has(pid)) continue;
    const argv = cmdline(pid);
    if (!argv) continue;
    if (isTrackedProcess(argv, cwdOf(pid), children)) found.push(pid);
  }
  return found;
}

function readInstances() {
  const home = configHome();
  const found = [];
  for (const name of dataNames) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(home, name, 'instance.json'), 'utf8'));
      const port = Number(raw.port);
      const pid = Number(raw.pid);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
      found.push({ port, pid: Number.isInteger(pid) && pid > 1 ? pid : 0 });
    } catch {
      /* no instance file */
    }
  }
  return found;
}

function requestTakeover(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(`${JSON.stringify({ takeover: true })}\n`);
    });
    let data = '';
    socket.setTimeout(800);
    socket.on('data', (buf) => {
      data += buf.toString();
    });
    socket.on('timeout', () => {
      socket.destroy();
      finish(data.trim());
    });
    socket.on('error', () => finish(''));
    socket.on('close', () => finish(data.trim()));
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      finish(true);
    });
    socket.setTimeout(200);
    socket.on('timeout', () => {
      socket.destroy();
      finish(false);
    });
    socket.on('error', () => finish(false));
  });
}

async function waitGone(pids, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !alive(pid))) return;
    await sleep(150);
  }
}

async function waitPortClosed(port, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return true;
    await sleep(150);
  }
  return !(await portOpen(port));
}

export async function stopRunning({ freeDevPort = false } = {}) {
  const instances = readInstances();
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    console.log('Закрываю уже запущенный BroTeam.');
  };

  const replies = [];
  for (const inst of instances) {
    replies.push({ ...inst, answer: await requestTakeover(inst.port) });
  }
  const yielded = replies.filter((inst) => inst.answer === 'yield' && inst.pid);
  if (yielded.length) {
    announce();
    await waitGone(
      yielded.map((inst) => inst.pid),
      politeMs,
    );
  }

  let targets = trackedPids(false);
  if (targets.length) {
    announce();
    signal(targets, 'SIGTERM');
    await waitGone(targets, termMs);
  }

  let stuck = trackedPids(true);
  if (stuck.length) {
    announce();
    signal(stuck, 'SIGKILL');
    await waitGone(stuck, killMs);
    stuck = trackedPids(true);
    if (stuck.length) {
      throw new Error(`Не удалось закрыть BroTeam (pid ${stuck.join(', ')}).`);
    }
  }

  for (const inst of instances) {
    if (await portOpen(inst.port)) {
      throw new Error('Не удалось закрыть BroTeam.');
    }
  }
  if (freeDevPort && !(await waitPortClosed(devPort, killMs))) {
    throw new Error(`Порт ${devPort} занят другим процессом. Окно не запущено.`);
  }
}
