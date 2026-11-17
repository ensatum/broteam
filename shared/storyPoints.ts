export const STORY_POINT_MARKS = [0, 1, 2, 3, 5, 8, 13, 21] as const;

const STORY_POINT_COLOR: Record<(typeof STORY_POINT_MARKS)[number], string> = {
  0: '#94a3b8',
  1: '#475569',
  2: '#059669',
  3: '#0891b2',
  5: '#0284c7',
  8: '#d97706',
  13: '#dc2626',
  21: '#000000',
};

export function storyPointColor(value: number): string {
  const mark = nearestStoryPoint(value) as (typeof STORY_POINT_MARKS)[number];
  return STORY_POINT_COLOR[mark];
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
