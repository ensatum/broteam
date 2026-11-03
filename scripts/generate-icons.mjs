#!/usr/bin/env node
/**
 * Regenerates build/icon.png and build/icons/*.png from the application mark colors.
 * Gradient is #5073EE → #2C3DD0.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const iconsDir = path.join(buildDir, 'icons');
const outPng = path.join(buildDir, 'icon.png');
const iconSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const iconOutputs = [outPng, ...iconSizes.map((size) => path.join(iconsDir, `${size}x${size}.png`))];

if (!process.argv.includes('--force') && iconOutputs.every((file) => fs.existsSync(file))) {
  console.log('generate-icons: icons are up to date');
  process.exit(0);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bro-team-icon-'));

const fontsBold = [
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];
/** TEAM: bold (slightly heavier than previous SemiBold) for readability at small sizes */
const fontsTeam = [
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-SemiBold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

function firstExisting(paths) {
  return paths.find((p) => fs.existsSync(p));
}

const fontBold = firstExisting(fontsBold);
const fontTeam = firstExisting(fontsTeam);
if (!fontBold || !fontTeam) {
  console.error('generate-icons: no suitable TTF fonts found');
  process.exit(1);
}

const magick = firstExisting(['/usr/bin/magick', '/usr/bin/convert']) || 'magick';

function magickRun(args) {
  execFileSync(magick, args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

function magickOut(args) {
  return execFileSync(magick, args, { encoding: 'utf8' }).trim();
}

/** Render text to transparent PNG, trim to ink, return {file,width,height}. */
function renderText(file, { font, pointsize, fill, kerning, text }) {
  const raw = `${file}.raw.png`;
  const args = [
    '-background',
    'none',
    '-font',
    font,
    '-pointsize',
    String(pointsize),
    '-fill',
    fill,
  ];
  if (kerning != null) {
    args.push('-kerning', String(kerning));
  }
  args.push(`label:${text}`, `PNG32:${raw}`);
  magickRun(args);
  magickRun([raw, '-trim', '+repage', `PNG32:${file}`]);
  fs.unlinkSync(raw);
  const geo = magickOut([file, '-format', '%w %h', 'info:']);
  const [width, height] = geo.split(/\s+/).map(Number);
  return { file, width, height };
}

fs.mkdirSync(iconsDir, { recursive: true });

const CANVAS = 1024;
const BRO_SIZE = 440;
const GAP = 120;

const bro = renderText(path.join(tmpDir, 'bro.png'), {
  font: fontBold,
  pointsize: BRO_SIZE,
  fill: '#FFFFFF',
  text: 'bro',
});

// Size TEAM so natural width is close to bro, then exact-match via resize.
let teamSize = 140;
for (let size = 220; size >= 90; size -= 2) {
  const candidate = renderText(path.join(tmpDir, 'team-try.png'), {
    font: fontTeam,
    pointsize: size,
    fill: 'rgba(255,255,255,0.88)',
    kerning: 20,
    text: 'TEAM',
  });
  if (candidate.width <= bro.width * 1.05) {
    teamSize = size;
    break;
  }
}

const teamRaw = renderText(path.join(tmpDir, 'team-raw.png'), {
  font: fontTeam,
  pointsize: teamSize,
  fill: 'rgba(255,255,255,0.88)',
  kerning: 22,
  text: 'TEAM',
});

const teamFile = path.join(tmpDir, 'team.png');
magickRun([
  teamRaw.file,
  '-resize',
  `${bro.width}x!`,
  `PNG32:${teamFile}`,
]);
const teamGeo = magickOut([teamFile, '-format', '%w %h', 'info:']);
const [teamW, teamH] = teamGeo.split(/\s+/).map(Number);
const team = { file: teamFile, width: teamW, height: teamH };

const blockH = bro.height + GAP + team.height;
const topPad = Math.round((CANVAS - blockH) / 2);
const broX = Math.round((CANVAS - bro.width) / 2);
const broY = topPad;
const teamX = Math.round((CANVAS - team.width) / 2);
const teamY = broY + bro.height + GAP;

magickRun([
  '-size',
  `${CANVAS}x${CANVAS}`,
  'xc:',
  '-sparse-color',
  'Barycentric',
  '0,0 #5073EE  1023,1023 #2C3DD0',
  '(',
  '-size',
  `${CANVAS}x${CANVAS}`,
  'xc:none',
  '-fill',
  'white',
  '-draw',
  'roundrectangle 40,40 983,983 200,200',
  ')',
  '-alpha',
  'off',
  '-compose',
  'CopyOpacity',
  '-composite',
  bro.file,
  '-geometry',
  `+${broX}+${broY}`,
  '-compose',
  'over',
  '-composite',
  team.file,
  '-geometry',
  `+${teamX}+${teamY}`,
  '-compose',
  'over',
  '-composite',
  '-define',
  'png:exclude-chunks=date,tEXt,zTXt,iTXt',
  `PNG32:${outPng}`,
]);

for (const size of iconSizes) {
  magickRun([
    outPng,
    '-resize',
    `${size}x${size}`,
    '-define',
    'png:exclude-chunks=date,tEXt,zTXt,iTXt',
    `PNG32:${path.join(iconsDir, `${size}x${size}.png`)}`,
  ]);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

const bottomPad = CANVAS - topPad - blockH;
console.log(
  `generate-icons: bro ${bro.width}x${bro.height}, team ${team.width}x${team.height} (size=${teamSize}), gap=${GAP}, pad ${topPad}/${bottomPad}`,
);
console.log('generate-icons: wrote', outPng, 'and', iconsDir);
