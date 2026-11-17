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
  const sourceGroup = list[from].groupId ?? null;
  const targetGroup = list[to].groupId ?? null;
  if (sourceGroup !== targetGroup && sourceGroup != null) return columns;
  const [item] = list.splice(from, 1);
  const insertAt = from < to ? to - 1 : to;
  list.splice(insertAt, 0, sourceGroup == null ? { ...item, groupId: targetGroup } : item);
  return coalesceColumns(list);
}

/** Put a column next to any other column. It takes that column's group, or leaves the group. */
export function placeColumnFree(
  columns: BoardColumnConfig[],
  fromKey: string,
  toKey: string,
): BoardColumnConfig[] {
  if (fromKey === toKey) return columns;
  const list = [...columns];
  const from = list.findIndex((column) => column.statusKey === fromKey);
  const to = list.findIndex((column) => column.statusKey === toKey);
  if (from < 0 || to < 0) return columns;
  const targetGroup = list[to].groupId ?? null;
  const [item] = list.splice(from, 1);
  const insertAt = from < to ? to - 1 : to;
  list.splice(insertAt, 0, { ...item, groupId: targetGroup });
  return coalesceColumns(list);
}

export type ColumnSection =
  | { kind: 'column'; column: BoardColumnConfig }
  | { kind: 'group'; group: ColumnGroup; columns: BoardColumnConfig[] };

/** Settings list: column order, with an empty group inserted at its own sort position. */
export function columnSections(columns: BoardColumnConfig[], groups: ColumnGroup[]): ColumnSection[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<number>();
  const sections: ColumnSection[] = [];
  const sorted = [...columns].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const column of sorted) {
    const group = column.groupId != null ? byId.get(column.groupId) : undefined;
    if (!group) {
      sections.push({ kind: 'column', column });
      continue;
    }
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    sections.push({
      kind: 'group',
      group,
      columns: sorted.filter((item) => item.groupId === group.id),
    });
  }
  const empty = groups
    .filter((group) => !seen.has(group.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const group of empty) {
    const at = Math.max(0, Math.min(group.sortOrder, sections.length));
    sections.splice(at, 0, { kind: 'group', group, columns: [] });
  }
  return sections;
}

function flattenSections(sections: ColumnSection[]): { columns: BoardColumnConfig[]; groups: ColumnGroup[] } {
  const columns: BoardColumnConfig[] = [];
  const groups: ColumnGroup[] = [];
  for (const section of sections) {
    if (section.kind === 'column') {
      columns.push({ ...section.column, groupId: null });
      continue;
    }
    groups.push(section.group);
    columns.push(...section.columns);
  }
  return {
    columns: columns.map((column, index) => ({ ...column, sortOrder: index })),
    groups: groups.map((group, index) => ({ ...group, sortOrder: index })),
  };
}

function shiftSection(sections: ColumnSection[], fromAt: number, toAt: number, where: 'above' | 'below'): ColumnSection[] {
  const next = [...sections];
  const [item] = next.splice(fromAt, 1);
  let insertAt = toAt;
  if (fromAt < toAt) insertAt -= 1;
  if (where === 'below') insertAt += 1;
  next.splice(insertAt, 0, item);
  return next;
}

function takeColumn(sections: ColumnSection[], fromKey: string): { sections: ColumnSection[]; column: BoardColumnConfig } | null {
  const next = sections.map((section) =>
    section.kind === 'column' ? section : { ...section, columns: [...section.columns] },
  );
  for (const section of next) {
    if (section.kind === 'column' && section.column.statusKey === fromKey) {
      return {
        column: section.column,
        sections: next.filter((item) => item.kind !== 'column' || item.column.statusKey !== fromKey),
      };
    }
    if (section.kind !== 'group') continue;
    const index = section.columns.findIndex((column) => column.statusKey === fromKey);
    if (index < 0) continue;
    const [column] = section.columns.splice(index, 1);
    return { column, sections: next };
  }
  return null;
}

/** Seat a column before or after a whole group and take it out of any group. */
export function placeColumnBesideGroup(
  columns: BoardColumnConfig[],
  groups: ColumnGroup[],
  fromKey: string,
  groupId: number,
  where: 'above' | 'below',
): { columns: BoardColumnConfig[]; groups: ColumnGroup[] } | null {
  const taken = takeColumn(columnSections(columns, groups), fromKey);
  if (!taken) return null;
  const toAt = taken.sections.findIndex((section) => section.kind === 'group' && section.group.id === groupId);
  if (toAt < 0) return null;
  const insertAt = where === 'below' ? toAt + 1 : toAt;
  taken.sections.splice(insertAt, 0, { kind: 'column', column: { ...taken.column, groupId: null } });
  return flattenSections(taken.sections);
}

/** Append a column to a group, including one that was in another group or in none. */
export function moveColumnIntoGroup(
  columns: BoardColumnConfig[],
  groups: ColumnGroup[],
  fromKey: string,
  groupId: number,
): { columns: BoardColumnConfig[]; groups: ColumnGroup[] } | null {
  const taken = takeColumn(columnSections(columns, groups), fromKey);
  if (!taken) return null;
  const host = taken.sections.find((section) => section.kind === 'group' && section.group.id === groupId);
  if (!host || host.kind !== 'group') return null;
  if (taken.column.groupId === groupId) return null;
  host.columns.push({ ...taken.column, groupId });
  return flattenSections(taken.sections);
}

/** Move a group before or after another group, or before or after an ungrouped column. */
export function moveGroupSection(
  columns: BoardColumnConfig[],
  groups: ColumnGroup[],
  fromId: number,
  target: { kind: 'group'; id: number } | { kind: 'column'; key: string },
  where: 'above' | 'below',
): { columns: BoardColumnConfig[]; groups: ColumnGroup[] } | null {
  const sections = columnSections(columns, groups);
  const fromAt = sections.findIndex((section) => section.kind === 'group' && section.group.id === fromId);
  const toAt = sections.findIndex((section) => {
    if (target.kind === 'group') return section.kind === 'group' && section.group.id === target.id;
    if (section.kind === 'column' && section.column.statusKey === target.key) return true;
    return section.kind === 'group' && section.columns.some((column) => column.statusKey === target.key);
  });
  if (fromAt < 0 || toAt < 0 || fromAt === toAt) return null;
  return flattenSections(shiftSection(sections, fromAt, toAt, where));
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
