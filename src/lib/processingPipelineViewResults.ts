export type ProcessingPipelineViewResults<Row> = {
  queryKey: string;
  rows: Row[];
  total: number;
  remainingCount: number;
};

/** Header sorting reorders loaded rows locally; it does not change their membership. */
export function processingPipelineResultsQueryKey(view: Record<string, unknown> | undefined): string {
  const membership = { ...view };
  delete membership.sortBy;
  delete membership.sortDirection;
  return JSON.stringify(membership);
}

/** Rows and counts belong to the accepted query, not the currently selected tab. */
export function selectProcessingPipelineViewResults<Row>(
  selectedQueryKey: string,
  results: ProcessingPipelineViewResults<Row>,
): ProcessingPipelineViewResults<Row> | null {
  return results.queryKey === selectedQueryKey ? results : null;
}
