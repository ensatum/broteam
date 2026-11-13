import { COLUMN_COLORS, type BoardColumnConfig, type TrackerBoardColumn } from './types';

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

/** One row per status, in the order Tracker lists the board columns. */
export function freshBoardColumns(
  remote: TrackerBoardColumn[],
  boardLocalId: number,
): Array<Omit<BoardColumnConfig, 'id'>> {
  const rows: Array<Omit<BoardColumnConfig, 'id'>> = [];
  for (const column of remote) {
    const statuses = column.statuses.length
      ? column.statuses
      : [{ key: column.id, display: column.name }];
    for (const status of statuses) {
      rows.push({
        columnId: column.id,
        columnName: column.name,
        statusKey: status.key,
        statusDisplay: status.display || column.name,
        alias: shortAlias(status.display || column.name),
        color: COLUMN_COLORS[rows.length % COLUMN_COLORS.length],
        duty: '',
        ownerRole: '',
        enabled: true,
        sortOrder: rows.length,
        boardLocalId,
      });
    }
  }
  return rows;
}
