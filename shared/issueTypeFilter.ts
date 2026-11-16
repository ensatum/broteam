/** Type keys the board leaves out. An empty field keeps every type. */
export function excludedTypeKeys(filter: string | readonly string[] | null | undefined): string[] {
  const raw = typeof filter === 'string' ? filter : (filter || []).join(',');
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function typeIsExcluded(filter: string | null | undefined, typeKey: string): boolean {
  const needle = typeKey.trim().toLowerCase();
  if (!needle) return false;
  return excludedTypeKeys(filter).some((key) => key.toLowerCase() === needle);
}
