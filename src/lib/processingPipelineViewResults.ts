export type ProcessingPipelineViewResults<Row> = {
  queryKey: string;
  rows: Row[];
  total: number;
  remainingCount: number;
};

/** Rows and counts belong to the accepted query, not the currently selected tab. */
export function selectProcessingPipelineViewResults<Row>(
  selectedQueryKey: string,
  results: ProcessingPipelineViewResults<Row>,
): ProcessingPipelineViewResults<Row> | null {
  return results.queryKey === selectedQueryKey ? results : null;
}
