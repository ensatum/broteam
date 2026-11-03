#!/usr/bin/env node
/** Refresh the year and bump build or release. A release bump does not reset the build. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackage, writePackageVersion } from './version-lib.mjs';

const level = process.argv[2];
if (level !== 'build' && level !== 'release') {
  console.error('Использование: node scripts/bump-version.mjs [build|release]');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const current = readPackage(root);
const release = level === 'release' ? current.release + 1 : current.release;
const build = level === 'build' ? current.build + 1 : current.build;
process.stdout.write(writePackageVersion(root, release, build));
