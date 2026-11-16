import type { BoardColumnConfig, ColumnGroup } from './types';

export type TableSlot =
  | { kind: 'column'; column: BoardColumnConfig }
  | { kind: 'group'; group: ColumnGroup; columns: BoardColumnConfig[] };

export type GroupHeaderCell =
  | { kind: 'group'; group: ColumnGroup; colspan: number }
  | { kind: 'gap'; colspan: number };

/** Pull each group's columns into one block, in the order they already have. */
export function coalesceColumns(columns: BoardColumnConfig[]): BoardColumnConfig[] {
  const seen = new Set<number>();
  const result: BoardColumnConfig[] = [];
  for (const column of columns) {
    if (column.groupId == null) {
      result.push(column);
      continue;
    }
    if (seen.has(column.groupId)) continue;
    seen.add(column.groupId);
    result.push(...columns.filter((item) => item.groupId === column.groupId));
  }
  return result.map((column, index) => ({ ...column, sortOrder: index }));
}

/** Reorder a column inside its own group. A drop on another group does nothing. */
export function placeColumn(
  columns: BoardColumnConfig[],
  fromKey: string,
  toKey: string,
): BoardColumnConfig[] {
  if (fromKey === toKey) return columns;
  const list = [...columns];
  const from = list.findIndex((column) => column.statusKey === fromKey);
  const to = list.findIndex((column) => column.statusKey === toKey);
  if (from < 0 || to < 0) return columns;
  if ((list[from].groupId ?? null) !== (list[to].groupId ?? null)) return columns;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return coalesceColumns(list);
}

/** Move a whole group so it sits just before the column it was dropped on. */
export function moveGroupBefore(
  columns: BoardColumnConfig[],
  groupId: number,
  beforeKey: string,
): BoardColumnConfig[] {
  const packed = coalesceColumns(columns);
  const block = packed.filter((column) => column.groupId === groupId);
  if (!block.length) return columns;
  const rest = packed.filter((column) => column.groupId !== groupId);
  const target = rest.find((column) => column.statusKey === beforeKey);
  if (!target) return packed;
  const insertAt =
    target.groupId == null
      ? rest.findIndex((column) => column.statusKey === beforeKey)
      : rest.findIndex((column) => column.groupId === target.groupId);
  if (insertAt < 0) return packed;
  rest.splice(insertAt, 0, ...block);
  return rest.map((column, index) => ({ ...column, sortOrder: index }));
}

export function tableSlots(columns: BoardColumnConfig[], groups: ColumnGroup[]): TableSlot[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const sorted = [...columns].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const slots: TableSlot[] = [];
  const emitted = new Set<number>();
  for (const column of sorted) {
    const group = column.groupId != null ? byId.get(column.groupId) : undefined;
    if (!group?.collapsed) {
      slots.push({ kind: 'column', column });
      continue;
    }
    if (emitted.has(group.id)) continue;
    emitted.add(group.id);
    slots.push({
      kind: 'group',
      group,
      columns: sorted.filter((item) => item.groupId === group.id),
    });
  }
  return slots;
}

export function groupHeaderCells(slots: TableSlot[], groups: ColumnGroup[]): GroupHeaderCell[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const cells: GroupHeaderCell[] = [];
  for (const slot of slots) {
    const group =
      slot.kind === 'group'
        ? slot.group
        : slot.column.groupId != null
          ? byId.get(slot.column.groupId) ?? null
          : null;
    const last = cells[cells.length - 1];
    if (group && last?.kind === 'group' && last.group.id === group.id) {
      last.colspan += 1;
      continue;
    }
    if (!group && last?.kind === 'gap') {
      last.colspan += 1;
      continue;
    }
    cells.push(group ? { kind: 'group', group, colspan: 1 } : { kind: 'gap', colspan: 1 });
  }
  return cells;
}

export function groupStatusKey(groupId: number): string {
  return `group:${groupId}`;
}

export function issuesForGroup(
  issuesByColumn: Record<string, { key: string }[]>,
  members: BoardColumnConfig[],
): { key: string }[] {
  return members.flatMap((column) => issuesByColumn[column.statusKey] || []);
}
