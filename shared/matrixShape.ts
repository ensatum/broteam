/** Compact, secret-free description of a cached board matrix for session logs. */
export function describeMatrix(matrix: unknown): Record<string, unknown> {
  if (!matrix || typeof matrix !== 'object') return { empty: true };
  const row = matrix as {
    sourceBoardLocalId?: number | null;
    developers?: unknown;
    columns?: unknown;
    grandTotal?: number;
    fetchedAt?: string;
    issueNotes?: unknown;
    sprintCounts?: unknown;
  };
  const developers = Array.isArray(row.developers) ? row.developers : null;
  const columns = Array.isArray(row.columns) ? row.columns : null;
  let missingIssues = 0;
  let missingDeveloper = 0;
  if (developers) {
    for (const item of developers) {
      if (!item || typeof item !== 'object') {
        missingDeveloper++;
        continue;
      }
      const cell = item as { developer?: unknown; issuesByColumn?: unknown };
      if (!cell.developer) missingDeveloper++;
      if (!cell.issuesByColumn || typeof cell.issuesByColumn !== 'object') missingIssues++;
    }
  }
  let missingColor = 0;
  if (columns) {
    for (const item of columns) {
      if (!item || typeof item !== 'object' || !(item as { color?: unknown }).color) missingColor++;
    }
  }
  return {
    source: row.sourceBoardLocalId ?? null,
    devs: developers ? developers.length : typeof row.developers,
    cols: columns ? columns.length : typeof row.columns,
    missingIssues,
    missingDeveloper,
    missingColor,
    grand: row.grandTotal ?? null,
    fetchedAt: row.fetchedAt ?? null,
    notes: row.issueNotes == null ? 'missing' : 'ok',
    sprints: Array.isArray(row.sprintCounts) ? row.sprintCounts.length : typeof row.sprintCounts,
  };
}
