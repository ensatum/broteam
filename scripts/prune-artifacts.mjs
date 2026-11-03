#!/usr/bin/env node
/**
 * Drop packaged files, keeping the newest versions.
 * Newest is a higher build number. The year does not decide order.
 *
 * node scripts/prune-artifacts.mjs <dir> <keep>
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '');
const keep = Number(process.argv[3] || '1');
if (!dir || !Number.isInteger(keep) || keep < 1) {
  console.error('Использование: node scripts/prune-artifacts.mjs <dir> <keep>');
  process.exit(1);
}
if (!fs.existsSync(dir)) process.exit(0);

function versionIn(name) {
  const matches = name.match(/\d+\.\d+\.\d+(?:\.\d+)?/g) || [];
  return matches.find((item) => /^20\d\d\./.test(item)) || null;
}

function parse(version) {
  const parts = version.split('.').map(Number);
  return { release: parts[1] || 0, build: parts[parts.length - 1] || 0 };
}

function compare(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (left.release !== right.release) return left.release - right.release;
  return left.build - right.build;
}

/** @type {Map<string, string[]>} */
const byVersion = new Map();
for (const name of fs.readdirSync(dir)) {
  const version = versionIn(name);
  if (!version) continue;
  const full = path.join(dir, name);
  if (!fs.statSync(full).isFile()) continue;
  if (!byVersion.has(version)) byVersion.set(version, []);
  byVersion.get(version).push(full);
}

const versions = [...byVersion.keys()].sort(compare);
const remove = versions.slice(0, Math.max(0, versions.length - keep));
for (const version of remove) {
  for (const file of byVersion.get(version) || []) {
    fs.unlinkSync(file);
    console.log(`pruned ${path.basename(file)}`);
  }
}
const kept = versions.slice(-keep);
console.log(
  remove.length
    ? `prune: kept ${kept.join(', ')}, removed ${remove.join(', ')}`
    : `prune: keeping all ${versions.length} version(s)`,
);
