import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unreleasedPath = path.join(root, 'changelog/unreleased.md');

export function unreleasedNotes() {
  if (!fs.existsSync(unreleasedPath)) return '';
  return fs.readFileSync(unreleasedPath, 'utf8').trim();
}

export function writeUnreleased(text) {
  const notes = String(text ?? '').trim();
  fs.mkdirSync(path.dirname(unreleasedPath), { recursive: true });
  fs.writeFileSync(unreleasedPath, notes ? `${notes}\n` : '');
}

const buildSubject = /^Build \d+\.\d+\.\d+$/;

export function notesFromBuildCommits(commits) {
  const notes = [];
  for (const { subject, body } of commits) {
    if (!buildSubject.test(String(subject).trim())) continue;
    const text = String(body ?? '').trim();
    if (text) notes.push(text);
  }
  return notes.join('\n\n');
}

function previousTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', 'develop'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

export function buildNotesSinceLastTag() {
  const prev = previousTag();
  const range = prev ? `${prev}..develop` : 'develop';
  const raw = execFileSync(
    'git',
    ['log', '-z', '--reverse', '--format=%s%x1e%b', range],
    { cwd: root, encoding: 'utf8' },
  );
  const commits = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const sep = record.indexOf('\x1e');
    commits.push({
      subject: sep === -1 ? record : record.slice(0, sep),
      body: sep === -1 ? '' : record.slice(sep + 1),
    });
  }
  return notesFromBuildCommits(commits);
}

export function writeReleaseNotes(tag, notes) {
  if (!/^\d+\.\d+$/.test(tag)) {
    throw new Error(`Тег релиза не в виде год.релиз: ${tag}`);
  }
  const file = path.join(root, 'changelog', `${tag}.md`);
  const contents = notes ? `${notes}\n` : '';
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

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const cmd = process.argv[2];
  if (cmd === 'unreleased') {
    process.stdout.write(unreleasedNotes());
  } else if (cmd === 'clear') {
    writeUnreleased('');
  } else if (cmd === 'restore') {
    writeUnreleased(await readStdin());
  } else if (cmd === 'release') {
    const tag = process.argv[3];
    const notes = buildNotesSinceLastTag();
    writeReleaseNotes(tag, notes);
    process.stdout.write(notes);
  } else {
    console.error('Использование: node scripts/changelog.mjs [unreleased|clear|restore|release <год.релиз>]');
    process.exit(1);
  }
}
