export const STORY_POINT_MARKS = [0, 1, 2, 3, 5, 8, 13, 21] as const;

export type StoryPointMark = (typeof STORY_POINT_MARKS)[number];

export type StoryPointColors = Record<StoryPointMark, string>;

export const DEFAULT_STORY_POINT_COLORS: StoryPointColors = {
  0: '#c5ced6',
  1: '#8eb4e6',
  2: '#5b94da',
  3: '#3d82d2',
  5: '#b06a09',
  8: '#c44710',
  13: '#c42222',
  21: '#8b1218',
};

export const STORY_POINT_MEANING: Record<StoryPointMark, string> = {
  0: 'Уже сделано или усилий не требует.',
  1: 'Мелочь: опечатка, подпись, тултип.',
  2: 'Небольшая доработка: одно новое поле и его проверка.',
  3: 'Обычная доработка: правило, расчёт или поведение уже существующей части.',
  5: 'Отдельная разработка: новый список со своим просмотром, фильтрами и действиями.',
  8: 'Средняя разработка: чужой сервис, с ошибками, повторами и наблюдением за ним.',
  13: 'Сложная разработка: переписать целый модуль, с рефакторингом и миграциями.',
  21: 'Масштабная разработка: новый вид данных, другая схема и перенос того, что уже лежит.',
};

export function storyPointColors(raw: unknown): StoryPointColors {
  const next: StoryPointColors = { ...DEFAULT_STORY_POINT_COLORS };
  if (!raw || typeof raw !== 'object') return next;
  const record = raw as Record<string, unknown>;
  for (const mark of STORY_POINT_MARKS) {
    const value = record[String(mark)];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) next[mark] = value.toLowerCase();
  }
  return next;
}

export function storyPointColor(value: number, colors: StoryPointColors = DEFAULT_STORY_POINT_COLORS): string {
  const mark = nearestStoryPoint(value) as StoryPointMark;
  return colors[mark];
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
