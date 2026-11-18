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

export const STORY_POINT_BRIEF: Record<StoryPointMark, string> = {
  0: 'Уже сделано или делать нечего.',
  1: 'Мелочь в одном месте.',
  2: 'Небольшая доработка или та же мелочь в нескольких местах.',
  3: 'Обычная доработка или проход по обозримому списку мест.',
  5: 'Отдельная разработка или большой однотипный проход.',
  8: 'Средняя разработка или долгая рутина, где важен объём.',
  13: 'Переписать модуль или перенести очень большой однотипный объём.',
  21: 'Новый вид данных и перенос всего, что уже лежит.',
};

export const STORY_POINT_DETAIL: Record<StoryPointMark, string> = {
  0: 'Уже сделано, либо делать нечего: ни разбираться, ни повторять.',
  1: 'Одна мелочь в одном месте: опечатка, подпись, тултип. Повторять нечего.',
  2: 'Небольшая доработка в одном месте, например новое поле и его проверка. Либо та же мелочь, но в нескольких похожих местах.',
  3: 'Обычная доработка уже существующей части: правило, расчёт, поведение. Либо понятная правка, которую нужно пройти по заметному, но обозримому списку мест.',
  5: 'Отдельная разработка со своим просмотром и действиями. Либо простая по сути работа на большой набор однотипных мест: много повторов, мало новых решений.',
  8: 'Средняя разработка: чужой сервис, ошибки, повторы и наблюдение. Либо долгая рутина, где объём и аккуратность важнее головоломки.',
  13: 'Сложная разработка: переписать модуль, с рефакторингом и миграциями. Либо очень большой перенос однотипных данных, где рутина тянется на весь объём.',
  21: 'Масштабная разработка: новый вид данных, другая схема и перенос того, что уже лежит. Объём и неизвестность вместе.',
};

export function storyPointBrief(value: number, copy: StoryPointCopy = defaultStoryPointCopy()): string {
  return copy.brief[nearestStoryPoint(value) as StoryPointMark];
}

export function storyPointDetail(value: number, copy: StoryPointCopy = defaultStoryPointCopy()): string {
  return copy.detail[nearestStoryPoint(value) as StoryPointMark];
}

export type StoryPointCopy = {
  brief: Record<StoryPointMark, string>;
  detail: Record<StoryPointMark, string>;
};

export function defaultStoryPointCopy(): StoryPointCopy {
  return {
    brief: { ...STORY_POINT_BRIEF },
    detail: { ...STORY_POINT_DETAIL },
  };
}

export function storyPointCopy(raw: unknown): StoryPointCopy {
  const next = defaultStoryPointCopy();
  if (!raw || typeof raw !== 'object') return next;
  const record = raw as { brief?: unknown; detail?: unknown };
  takeCopy(next.brief, record.brief);
  takeCopy(next.detail, record.detail);
  return next;
}

function takeCopy(target: Record<StoryPointMark, string>, raw: unknown) {
  if (!raw || typeof raw !== 'object') return;
  const record = raw as Record<string, unknown>;
  for (const mark of STORY_POINT_MARKS) {
    const value = record[String(mark)];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) target[mark] = text;
  }
}

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
