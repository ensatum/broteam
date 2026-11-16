/** Statuses of these issue types stay when a board does not name its own. */
export const DEFAULT_ISSUE_TYPE_NAMES = ['Задача', 'Ошибка'];

/** Names from a board field. An empty field keeps the default pair. */
export function issueTypeNames(filter: string | readonly string[] | null | undefined): string[] {
  const raw = typeof filter === 'string' ? filter : (filter || []).join(',');
  const names = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return names.length ? names : [...DEFAULT_ISSUE_TYPE_NAMES];
}

export function sameIssueTypeName(typeKey: string, typeDisplay: string, name: string): boolean {
  const needle = name.trim().toLowerCase();
  if (!needle) return false;
  return needle === typeKey.trim().toLowerCase() || needle === typeDisplay.trim().toLowerCase();
}
