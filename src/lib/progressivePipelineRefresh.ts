import { createPipelineRefresh } from './pipelineRefresh';
import { PIPELINE_ROW_BATCH_SIZE } from './processingPipelinePagination';

type Failure = { success: false; error: string };
type InitialPage<Row> = { success: true; rows: Row[]; total: number; remainingIds: string[] };
type MoreRows<Row> = { success: true; rows: Row[] };

/** Share the Mindy single-flight/timeout guard across searches and their continuations. */
export function createProgressivePipelineRefresh<View, Row>(options: {
  loadInitial: (view: View) => Promise<InitialPage<Row> | Failure>;
  loadMore: (ids: string[], view: View) => Promise<MoreRows<Row> | Failure>;
  onStart: () => void;
  onPage: (page: { view: View; rows: Row[]; append: boolean; remaining: number; remainingIds: string[]; total?: number; removed: number }) => void | boolean;
  onFailure: (error: string) => void;
  onError: (timedOut: boolean) => void;
  onIdle: () => void;
}) {
  type Request = { view: View; ids?: string[]; remainingIds?: string[] };
  type Response = { request: Request; result: InitialPage<Row> | MoreRows<Row> | Failure };
  let stopped = false;
  const refresh = createPipelineRefresh<Request, Response>({
    load: async (request) => ({
      request,
      result: request.ids
        ? await options.loadMore(request.ids, request.view)
        : await options.loadInitial(request.view),
    }),
    onStart: () => {},
    onSuccess: ({ request, result }) => {
      if (!result.success) { options.onFailure(result.error); return; }
      const remainingIds = 'remainingIds' in result ? result.remainingIds : request.remainingIds || [];
      const accepted = options.onPage({
        view: request.view,
        rows: result.rows,
        append: Boolean(request.ids),
        remaining: remainingIds.length,
        remainingIds,
        total: 'total' in result ? result.total : undefined,
        removed: request.ids ? Math.max(0, request.ids.length - result.rows.length) : 0,
      });
      if (accepted !== false) enqueueRemaining(request.view, remainingIds);
    },
    onError: (timedOut) => { stopped = timedOut; options.onError(timedOut); },
    onIdle: options.onIdle,
  });
  function enqueueRemaining(view: View, remainingIds: string[]) {
    if (stopped || !remainingIds.length) return;
    refresh.request({ view, ids: remainingIds.slice(0, PIPELINE_ROW_BATCH_SIZE), remainingIds: remainingIds.slice(PIPELINE_ROW_BATCH_SIZE) });
  }
  return {
    request(view: View) { if (!stopped) { options.onStart(); refresh.request({ view }); } },
    resume: enqueueRemaining,
    isBusy: refresh.isBusy,
    dispose() { stopped = true; refresh.dispose(); },
  };
}
