export const PIPELINE_ROW_BATCH_SIZE = 100;

/** Preserve the initial global ordering, including when records disappear mid-load. */
export function orderPipelineRows<Row extends { id: string }>(ids: string[], rows: Row[]): Row[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Appending a batch must never undo an edit already applied to a visible row. */
export function appendPipelineRows<Row extends { id: string }>(current: Row[], incoming: Row[]): Row[] {
  const seen = new Set(current.map((row) => row.id));
  const next = [...current];
  for (const row of incoming) {
    if (!seen.has(row.id)) { next.push(row); seen.add(row.id); }
  }
  return next;
}
