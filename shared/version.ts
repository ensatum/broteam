/** Year.Release.Build. The year follows the clock. Release and build do not reset. */
export type AppVersion = {
  year: number;
  release: number;
  build: number;
  /** Previous Year.Quarter.Release.Build stamp. */
  legacy?: boolean;
};

/** New-scheme databases older than this release/build are cleared on startup. */
export const SETTINGS_COMPAT_FLOOR = '2026.2.186';

/** Previous scheme: Year.Quarter.Release.Build. That stamp stays compatible. */
const LEGACY_SETTINGS_COMPAT_FLOOR = '2026.04.2.185';

export function currentYear(date = new Date()): number {
  return date.getFullYear();
}

export function parseAppVersion(value: string): AppVersion | null {
  const parts = value
    .trim()
    .split('.')
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) return null;
  if (parts.length === 3) return { year: parts[0], release: parts[1], build: parts[2] };
  if (parts.length === 4) return { year: parts[0], release: parts[2], build: parts[3], legacy: true };
  return null;
}

/** Newer means a higher release, or the same release with a higher build. */
export function compareReleaseBuild(a: AppVersion, b: AppVersion): number {
  if (a.release !== b.release) return a.release - b.release;
  return a.build - b.build;
}

export function formatAppVersion(release: number, build: number, date = new Date(), withBuild = true): string {
  const stamp = `${currentYear(date)}.${release}`;
  return withBuild ? `${stamp}.${build}` : stamp;
}

export function liveVersion(baked: string, date = new Date()): { full: string; header: string } {
  const parsed = parseAppVersion(baked);
  const release = parsed?.release ?? 0;
  const build = parsed?.build ?? 0;
  return {
    full: formatAppVersion(release, build, date, true),
    header: formatAppVersion(release, build, date, false),
  };
}

export function versionLabels(value: string): string[] {
  const parsed = parseAppVersion(value);
  if (!parsed) return [value];
  const plain = `${parsed.year}.${parsed.release}.${parsed.build}`;
  return [...new Set([value, plain])];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseAppVersion(candidate);
  const installed = parseAppVersion(current);
  if (!next || !installed) return false;
  return compareReleaseBuild(next, installed) > 0;
}

export function settingsIncompatible(stored: string | null | undefined): boolean {
  const current = stored ? parseAppVersion(stored) : null;
  if (!current) return true;
  const floor = parseAppVersion(current.legacy ? LEGACY_SETTINGS_COMPAT_FLOOR : SETTINGS_COMPAT_FLOOR);
  if (!floor) return true;
  return compareReleaseBuild(current, floor) < 0;
}
