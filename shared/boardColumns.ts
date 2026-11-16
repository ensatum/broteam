import { COLUMN_COLORS, type BoardColumnConfig, type TrackerBoardColumn } from './types';

export type SourceStatus = { key: string; display: string };

export function shortAlias(name: string): string {
  const map: Record<string, string> = {
    Новая: 'New',
    Открыт: 'Open',
    'Требуется информация': 'Info',
    'Цель заблокирована': 'Hold',
    'На доработку': 'Hold',
    'В работе': 'Active',
    'В работе, Разработка': 'Active',
    Ревью: 'Review',
    'Тестирование на DEV': 'Test',
    'Готово к релизу': 'Pre-Prod',
    'Можно тестировать': 'QA',
    'В тестирование': 'QA',
    Тестируется: 'Testing',
    Решен: 'Accept',
    Приемка: 'Accept',
    Закрыт: 'Closed',
  };
  return map[name] || name.slice(0, 10);
}

export function parseSourceStatuses(raw: string | null | undefined): SourceStatus[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const statuses: SourceStatus[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const key = String((item as { key?: string }).key || '').trim();
      if (!key) continue;
      const display = String((item as { display?: string }).display || key).trim() || key;
      statuses.push({ key, display });
    }
    return statuses;
  } catch {
    return [];
  }
}

/** Statuses that land in this column. Older rows only know their own status key. */
export function sourceStatusesOf(column: {
  statusKey: string;
  statusDisplay?: string;
  sourceStatuses?: SourceStatus[];
}): SourceStatus[] {
  const listed = (column.sourceStatuses || []).filter((status) => status.key);
  if (listed.length) return listed;
  return [{ key: column.statusKey, display: column.statusDisplay || column.statusKey }];
}

export function columnForStatus<T extends { statusKey: string; statusDisplay?: string; sourceStatuses?: SourceStatus[] }>(
  columns: T[],
  statusKey: string,
): T | undefined {
  if (!statusKey) return undefined;
  return columns.find(
    (column) =>
      column.statusKey === statusKey || sourceStatusesOf(column).some((status) => status.key === statusKey),
  );
}

export function statusColumnMap<T extends { statusKey: string; statusDisplay?: string; sourceStatuses?: SourceStatus[] }>(
  columns: T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const column of columns) {
    map.set(column.statusKey, column);
    for (const status of sourceStatusesOf(column)) map.set(status.key, column);
  }
  return map;
}

/**
 * One visible column per board column. Source statuses from several queues
 * stay inside it, and the label is the column name.
 */
export function viewColumns(columns: BoardColumnConfig[]): BoardColumnConfig[] {
  const groups = new Map<string, BoardColumnConfig>();
  const order: string[] = [];
  for (const column of columns) {
    const id = `${column.boardLocalId}:${column.columnId || column.statusKey}`;
    const prev = groups.get(id);
    const sources = new Map<string, SourceStatus>();
    for (const status of [...(prev ? sourceStatusesOf(prev) : []), ...sourceStatusesOf(column)]) {
      if (!sources.has(status.key)) sources.set(status.key, status);
    }
    const sourceStatuses = [...sources.values()];
    if (!prev) {
      order.push(id);
      groups.set(id, {
        ...column,
        statusDisplay: column.columnName || column.statusDisplay,
        sourceStatuses,
      });
      continue;
    }
    const named =
      column.statusDisplay === column.columnName || column.statusKey === column.columnId ? column : prev;
    groups.set(id, {
      ...prev,
      alias: named.alias || prev.alias,
      color: named.color || prev.color,
      duty: named.duty || prev.duty,
      ownerRole: named.ownerRole || prev.ownerRole,
      statusDisplay: column.columnName || prev.statusDisplay,
      sourceStatuses,
    });
  }
  return order.map((id) => groups.get(id)!);
}

/** Drop statuses that are not steps of the selected issue-type workflows. */
export function keepStatuses(
  remote: TrackerBoardColumn[],
  allowed: ReadonlySet<string>,
): TrackerBoardColumn[] {
  const kept: TrackerBoardColumn[] = [];
  for (const column of remote) {
    const statuses = column.statuses.filter((status) => allowed.has(status.key));
    if (!statuses.length) continue;
    kept.push(statuses.length === column.statuses.length ? column : { ...column, statuses });
  }
  return kept;
}

/** One row per board column. Its source statuses are the queue statuses the column accepts. */
export function freshBoardColumns(
  remote: TrackerBoardColumn[],
  boardLocalId: number,
): Array<Omit<BoardColumnConfig, 'id'>> {
  const rows: Array<Omit<BoardColumnConfig, 'id'>> = [];
  for (const column of remote) {
    const statuses = column.statuses.length
      ? column.statuses
      : [{ key: column.id, display: column.name }];
    rows.push({
      columnId: column.id,
      columnName: column.name,
      statusKey: `col:${column.id}`,
      statusDisplay: column.name,
      sourceStatuses: statuses.map((status) => ({
        key: status.key,
        display: status.display || column.name,
      })),
      alias: shortAlias(column.name),
      color: COLUMN_COLORS[rows.length % COLUMN_COLORS.length],
      duty: '',
      ownerRole: '',
      enabled: true,
      sortOrder: rows.length,
      boardLocalId,
    });
  }
  return rows;
}
