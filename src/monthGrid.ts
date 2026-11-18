export function monthOf(iso: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

export function buildCalendar(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1);
  let weekday = first.getDay();
  weekday = weekday === 0 ? 6 : weekday - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array(weekday).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function toIso(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}
