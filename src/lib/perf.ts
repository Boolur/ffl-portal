type PerfMetricEntry = {
  durationMs: number;
  at: number;
};

type PerfBucket = {
  entries: PerfMetricEntry[];
};

const globalPerfStore = globalThis as typeof globalThis & {
  __fflPerfBuckets?: Map<string, PerfBucket>;
};

function getPerfBuckets() {
  if (!globalPerfStore.__fflPerfBuckets) {
    globalPerfStore.__fflPerfBuckets = new Map<string, PerfBucket>();
  }
  return globalPerfStore.__fflPerfBuckets;
}

function isPerfLoggingEnabled() {
  const value = String(process.env.PERF_LOG_ENABLED || 'true')
    .trim()
    .toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p))
  );
  return sorted[index];
}

export function recordPerfMetric(
  metric: string,
  durationMs: number,
  context?: Record<string, unknown>
) {
  if (!isPerfLoggingEnabled()) return;
  const buckets = getPerfBuckets();
  const bucket = buckets.get(metric) || { entries: [] };
  bucket.entries.push({
    durationMs,
    at: Date.now(),
  });
  // Keep rolling local sample window per server instance.
  if (bucket.entries.length > 200) {
    bucket.entries = bucket.entries.slice(bucket.entries.length - 200);
  }
  buckets.set(metric, bucket);

  const durations = bucket.entries.map((entry) => entry.durationMs);
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);

  console.info('[perf]', {
    metric,
    durationMs: Math.round(durationMs),
    sampleSize: durations.length,
    p50Ms: Math.round(p50),
    p95Ms: Math.round(p95),
    ...(context ? { context } : {}),
  });
}

export async function withPerfMetric<T>(
  metric: string,
  action: () => Promise<T>,
  context?: Record<string, unknown>
) {
  const startedAt = Date.now();
  try {
    const result = await action();
    recordPerfMetric(metric, Date.now() - startedAt, {
      ...(context || {}),
      outcome: 'success',
    });
    return result;
  } catch (error) {
    recordPerfMetric(metric, Date.now() - startedAt, {
      ...(context || {}),
      outcome: 'error',
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }
}

export function startPerfTimer(metric: string, baseContext?: Record<string, unknown>) {
  const startedAt = Date.now();
  return (context?: Record<string, unknown>) => {
    recordPerfMetric(metric, Date.now() - startedAt, {
      ...(baseContext || {}),
      ...(context || {}),
    });
  };
}
