export const STORY_POINT_MARKS = [0, 1, 2, 3, 5, 8, 13, 21] as const;

const STORY_POINT_COLOR: Record<(typeof STORY_POINT_MARKS)[number], string> = {
  0: '#b8c2cc',
  1: '#2e3fff',
  2: '#0ac5d6',
  3: '#1dbf2a',
  5: '#c2c729',
  8: '#ff9257',
  13: '#dc2626',
  21: '#991111',
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
