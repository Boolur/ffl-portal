/**
 * Integration services public facade.
 *
 * The real work now lives in `dispatch.ts` (dispatch + batching + triggers)
 * and `template.ts` (merge-field rendering). This file re-exports them so
 * older callers importing from `@/lib/services` keep compiling while we
 * roll out the new dispatcher.
 */

export {
  dispatchServiceToLead,
  runDispatchBatch,
  runServiceTriggers,
  drainDueDispatches,
  summarizeBatch,
  type BatchSummary,
  type DispatchOutcome,
  type DispatchOptions,
  type DrainDueResult,
  type ServiceWithCredentialFields,
  type SkipReason,
  type FailReason,
} from './dispatch';

export {
  render,
  renderString,
  listAvailableTokens,
  type TemplateContext,
  type TemplateLead,
  type TemplateUser,
  type TemplateCampaign,
  type TemplateVendor,
  type TokenSpec,
} from './template';
