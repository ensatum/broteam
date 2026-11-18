export const STORY_POINT_MARKS = [0, 1, 2, 3, 5, 8, 13, 21] as const;

const STORY_POINT_COLOR: Record<(typeof STORY_POINT_MARKS)[number], string> = {
  0: '#b8c2cc',
  1: '#2e3fff',
  2: '#089eb4',
  3: '#169624',
  5: '#a4a91e',
  8: '#ee7638',
  13: '#dc2626',
  21: '#991111',
};

export function storyPointColor(value: number): string {
  const mark = nearestStoryPoint(value) as (typeof STORY_POINT_MARKS)[number];
  return STORY_POINT_COLOR[mark];
}

export type StoryPointsSum = { sum: number; tasks: number };

export function storyPointsTotal(
  issues: Iterable<{ key?: string; storyPoints?: number | null }>,
): StoryPointsSum | null {
  const seen = new Set<string>();
  let sum = 0;
  let tasks = 0;
  let any = false;
  for (const issue of issues) {
    if (issue.key) {
      if (seen.has(issue.key)) continue;
      seen.add(issue.key);
    }
    tasks += 1;
    if (issue.storyPoints == null || !Number.isFinite(issue.storyPoints)) continue;
    any = true;
    sum += issue.storyPoints;
  }
  if (!any || tasks === 0) return null;
  return { sum, tasks };
}

export function nearestStoryPoint(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return STORY_POINT_MARKS[0];
  let best: number = STORY_POINT_MARKS[0];
  let dist = Infinity;
  for (const mark of STORY_POINT_MARKS) {
    const gap = Math.abs(mark - value);
    if (gap < dist) {
      dist = gap;
      best = mark;
    }
  }
  return best;
}
