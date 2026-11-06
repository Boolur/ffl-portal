'use server';

import { ProcessingPipelineSheet } from '@prisma/client';
import { getProcessingPipeline, getProcessingPipelineMetadata } from './processingPipelineActions';
import { getProcessingPipelineLayouts } from './processingPipelineLayoutActions';

/** Used on the initial processor page and on first opening the Processing tab. */
export async function getProcessingPipelineWorkspace() {
  const [layouts, metadata] = await Promise.all([
    getProcessingPipelineLayouts(),
    getProcessingPipelineMetadata(),
  ]);
  if (!layouts.success) return layouts;
  if (!metadata.success) return metadata;
  const activeLayout = layouts.layouts.find((layout) => layout.isActive);
  const data = await getProcessingPipeline({
    sheet: ProcessingPipelineSheet.PIPELINE,
    sortBy: 'pipelineStatus',
    sortDirection: 'asc',
    filters: activeLayout?.config.buckets.PIPELINE.filters,
    viewScope: activeLayout?.config.scope,
  });
  if (!data.success) return data;
  return { success: true as const, data: { ...data, ...metadata }, layouts: layouts.layouts };
}

export type ProcessingPipelineWorkspaceData = Extract<
  Awaited<ReturnType<typeof getProcessingPipelineWorkspace>>, { success: true }
>;
