import type { BoardMatrix, Developer, TrackerIssue } from './types';

/** Tracker user reference fields we may see on assignee / kodRevu / qaEngineer. */
export type TrackerPersonRef = {
  id?: string | number | null;
  display?: string | null;
  login?: string | null;
  cloudUid?: string | null;
  passportUid?: string | number | null;
} | null | undefined;

/** Collect all id/login variants for matching against app developers. */
export function collectPersonMatchKeys(person: TrackerPersonRef): string[] {
  if (!person) return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (v == null || v === '') return;
    const s = String(v);
    if (!out.includes(s)) out.push(s);
  };
  add(person.id);
  add(person.passportUid);
  add(person.cloudUid);
  add(person.login);
  return out;
}

function findDeveloperByKeys(keys: string[], developers: Developer[]): Developer | undefined {
  for (const key of keys) {
    if (!key) continue;
    const lower = key.toLowerCase();
    const hit = developers.find(
      (d) => String(d.uid) === key || d.login.toLowerCase() === lower,
    );
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Soft fallback when Tracker person ids are missing (old cache):
 * every token of the app displayName appears in the Tracker display.
 * Only used when the match is unique among configured developers.
 */
function findDeveloperByDisplayHint(
  trackerDisplay: string,
  developers: Developer[],
): Developer | undefined {
  const tracker = trackerDisplay.trim().toLowerCase();
  if (!tracker) return undefined;
  const hits = developers.filter((d) => {
    const name = d.displayName?.trim();
    if (!name) return false;
    const tokens = name
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    return tokens.length >= 2 && tokens.every((t) => tracker.includes(t));
  });
  return hits.length === 1 ? hits[0] : undefined;
}

/** Prefer app displayName when any Tracker person key matches a configured developer (uid or login). */
export function resolvePersonDisplayName(
  keys: string[] | string | null | undefined,
  trackerDisplay: string | null | undefined,
  developers: Developer[],
): string | null {
  const trimmed = trackerDisplay?.trim() || null;
  const list = Array.isArray(keys)
    ? keys
    : keys != null && String(keys) !== ''
      ? [String(keys)]
      : [];
  const byKey = findDeveloperByKeys(list, developers);
  if (byKey?.displayName?.trim()) return byKey.displayName.trim();
  if (trimmed) {
    const byHint = findDeveloperByDisplayHint(trimmed, developers);
    if (byHint?.displayName?.trim()) return byHint.displayName.trim();
  }
  return trimmed;
}

export function applyDeveloperDisplayNames(
  issue: TrackerIssue,
  developers: Developer[],
): TrackerIssue {
  const reviewerKeys = [
    ...(issue.reviewerMatchKeys || []),
    ...(issue.reviewerUid ? [issue.reviewerUid] : []),
  ];
  const qaKeys = [...(issue.qaMatchKeys || []), ...(issue.qaUid ? [issue.qaUid] : [])];
  const assigneeKeys = [
    ...(issue.assigneeUid ? [issue.assigneeUid] : []),
    ...(issue.assigneeLogin ? [issue.assigneeLogin] : []),
  ];

  const reviewerDisplay = resolvePersonDisplayName(
    reviewerKeys,
    issue.reviewerDisplay,
    developers,
  );
  const qaDisplay = resolvePersonDisplayName(qaKeys, issue.qaDisplay, developers);
  const assigneeDisplay = resolvePersonDisplayName(
    assigneeKeys,
    issue.assigneeDisplay,
    developers,
  );
  const updatedByDisplay = resolvePersonDisplayName(
    issue.updatedByMatchKeys,
    issue.updatedByDisplay,
    developers,
  );

  if (
    reviewerDisplay === issue.reviewerDisplay &&
    qaDisplay === issue.qaDisplay &&
    assigneeDisplay === issue.assigneeDisplay &&
    updatedByDisplay === (issue.updatedByDisplay ?? null)
  ) {
    return issue;
  }
  return { ...issue, reviewerDisplay, qaDisplay, assigneeDisplay, updatedByDisplay };
}

function recountPeople(
  issues: TrackerIssue[],
): Pick<BoardMatrix, 'reviewerCounts' | 'qaCounts'> {
  const reviewerMap = new Map<string, number>();
  const qaMap = new Map<string, number>();
  for (const issue of issues) {
    if (issue.reviewerDisplay?.trim()) {
      const name = issue.reviewerDisplay.trim();
      reviewerMap.set(name, (reviewerMap.get(name) || 0) + 1);
    }
    if (issue.qaDisplay?.trim()) {
      const name = issue.qaDisplay.trim();
      qaMap.set(name, (qaMap.get(name) || 0) + 1);
    }
  }
  const byCountThenName = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || a[0].localeCompare(b[0], 'ru');
  return {
    reviewerCounts: [...reviewerMap.entries()]
      .sort(byCountThenName)
      .map(([name, count]) => ({ name, count })),
    qaCounts: [...qaMap.entries()]
      .sort(byCountThenName)
      .map(([name, count]) => ({ name, count })),
  };
}

/**
 * Re-apply settings displayNames to every issue in a matrix and rebuild Reviewers/QA tallies.
 * Safe to call on cached lastMatrix (e.g. after upgrade or displayName edit).
 */
export function remapMatrixPersonNames(
  matrix: BoardMatrix,
  developers?: Developer[],
): BoardMatrix {
  const devs = developers ?? matrix.developers.map((r) => r.developer);
  const visibleIssues: TrackerIssue[] = [];
  const developersRows = matrix.developers.map((row) => {
    const issuesByColumn: BoardMatrix['developers'][number]['issuesByColumn'] = {};
    for (const [statusKey, list] of Object.entries(row.issuesByColumn || {})) {
      issuesByColumn[statusKey] = (list || []).map((issue) => {
        const resolved = applyDeveloperDisplayNames(issue, devs);
        visibleIssues.push(resolved);
        return resolved;
      });
    }
    return { ...row, issuesByColumn };
  });
  return {
    ...matrix,
    developers: developersRows,
    ...recountPeople(visibleIssues),
  };
}
