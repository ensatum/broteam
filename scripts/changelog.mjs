import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unreleasedPath = path.join(root, 'changelog/unreleased.md');

export const TYPES = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'chore'];
export const SCOPES = ['board', 'summary', 'notes', 'update', 'db', 'tray', 'settings', 'tracker', 'build'];
const taskSubject = new RegExp(`^(?:${TYPES.join('|')})\\((?:${SCOPES.join('|')})\\): [a-z0-9].+`);
const newBuildSubject = /^build: compile release artifacts for \d+\.\d+\.\d+$/;
const oldBuildSubject = /^Build \d+\.\d+\.\d+$/;
const releaseHeader = /^chore\(release\): \d+\.\d+$/;
export const changesHeader = 'Included changes since last build:';

export function messageProblems(header, body) {
  const h = String(header ?? '').trim();
  const b = String(body ?? '').trim();
  if (newBuildSubject.test(h)) {
    if (b.startsWith(changesHeader)) return '';
    return 'build body must start with "Included changes since last build:"';
  }
  if (releaseHeader.test(h)) {
    const tag = h.slice('chore(release): '.length);
    if (b.includes(`Full changelog: changelog/${tag}.md`) && /(^|\n)- /.test(b)) return '';
    return 'release body must list the changes and point at changelog/год.релиз.md';
  }
  if (taskSubject.test(h)) {
    if (/(^|\n)- /.test(b)) return '';
    return 'task body must list what changed, one "- " item per line';
  }
  return 'header must be type(scope): subject, build: compile release artifacts for X.Y.Z, or chore(release): X.Y';
}

export function unreleasedNotes() {
  if (!fs.existsSync(unreleasedPath)) return '';
  return fs.readFileSync(unreleasedPath, 'utf8').trim();
}

export function writeUnreleased(text) {
  const notes = String(text ?? '').trim();
  fs.mkdirSync(path.dirname(unreleasedPath), { recursive: true });
  fs.writeFileSync(unreleasedPath, notes ? `${notes}\n` : '');
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function readCommits(range) {
  const raw = git(['log', '-z', '--reverse', '--no-merges', '--format=%s%x1e%b', range]);
  const commits = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const sep = record.indexOf('\x1e');
    commits.push({
      subject: (sep === -1 ? record : record.slice(0, sep)).trim(),
      body: sep === -1 ? '' : record.slice(sep + 1).replace(/\s+$/, ''),
    });
  }
  return commits;
}

export function isBuildSubject(subject) {
  const line = String(subject ?? '').trim();
  return newBuildSubject.test(line) || oldBuildSubject.test(line);
}

export function isTaskSubject(subject) {
  return taskSubject.test(String(subject ?? '').trim());
}

function lastBuildSha() {
  const raw = git(['log', '--format=%H%x1f%s']);
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const sep = line.indexOf('\x1f');
    const sha = sep === -1 ? '' : line.slice(0, sep);
    const subject = sep === -1 ? line : line.slice(sep + 1);
    if (sha && isBuildSubject(subject)) return sha;
  }
  return '';
}

export function subjectsSinceLastBuild() {
  const last = lastBuildSha();
  const range = last ? `${last}..HEAD` : 'HEAD';
  return readCommits(range).map((commit) => commit.subject).filter(isTaskSubject);
}

export function forecastBody(subjects) {
  if (!subjects.length) return '';
  return [changesHeader, ...subjects.map((subject) => `- ${subject}`)].join('\n');
}

export function buildMessage(version, subjects) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Версия не в виде год.релиз.сборка: ${version}`);
  }
  const body = subjects.length ? forecastBody(subjects) : changesHeader;
  return `build: compile release artifacts for ${version}\n\n${body}`;
}

export function bulletsFromBuild(commit) {
  if (newBuildSubject.test(commit.subject)) {
    return commit.body
      .split('\n')
      .map((line) => line.replace(/^- /, '').trim())
      .filter(isTaskSubject);
  }
  if (oldBuildSubject.test(commit.subject)) {
    return commit.body
      .split('\n')
      .map((line) => line.trim())
      .filter(isTaskSubject);
  }
  return [];
}

function previousTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0', 'develop']).trim();
  } catch {
    return '';
  }
}

export function releaseBullets() {
  const prev = previousTag();
  const range = prev ? `${prev}..HEAD` : 'HEAD';
  const bullets = [];
  for (const commit of readCommits(range)) {
    for (const subject of bulletsFromBuild(commit)) bullets.push(subject);
  }
  return bullets;
}

export function releaseNotes(tag) {
  if (!/^\d+\.\d+$/.test(tag)) throw new Error(`Тег релиза не в виде год.релиз: ${tag}`);
  const lines = releaseBullets().map((subject) => `- ${subject}`);
  return [...lines, '', `Full changelog: changelog/${tag}.md`].join('\n').trim();
}

export function writeReleaseNotes(tag) {
  const bullets = releaseBullets().map((subject) => `- ${subject}`).join('\n');
  const file = path.join(root, 'changelog', `${tag}.md`);
  const contents = bullets ? `${bullets}\n` : '';
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (current !== contents) {
      throw new Error(`changelog/${tag}.md уже есть и не совпадает с собранными заметками. Файл не переписан.`);
    }
    return file;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

export function forecastMatches() {
  return unreleasedNotes() === forecastBody(subjectsSinceLastBuild());
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const cmd = process.argv[2];
  if (cmd === 'unreleased' || cmd === 'forecast') {
    const text = cmd === 'forecast' ? forecastBody(subjectsSinceLastBuild()) : unreleasedNotes();
    process.stdout.write(text);
  } else if (cmd === 'check') {
    const expected = forecastBody(subjectsSinceLastBuild());
    const actual = unreleasedNotes();
    if (actual === expected) process.exit(0);
    console.error('changelog/unreleased.md не совпадает с заголовками коммитов с прошлой сборки.');
    console.error('Ожидается:');
    console.error(expected || '(пусто)');
    process.exit(1);
  } else if (cmd === 'clear') {
    writeUnreleased('');
  } else if (cmd === 'restore') {
    writeUnreleased(await readStdin());
  } else if (cmd === 'build-message') {
    process.stdout.write(buildMessage(process.argv[3], subjectsSinceLastBuild()));
  } else if (cmd === 'release') {
    const tag = process.argv[3];
    writeReleaseNotes(tag);
    process.stdout.write(`chore(release): ${tag}\n\n${releaseNotes(tag)}`);
  } else {
    console.error(
      'Использование: node scripts/changelog.mjs [forecast|check|clear|restore|build-message <версия>|release <год.релиз>]',
    );
    process.exit(1);
  }
}
