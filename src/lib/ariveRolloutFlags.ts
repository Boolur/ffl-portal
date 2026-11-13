export const ariveRolloutEnvironmentEnabled = () => process.env.ARIVE_ROLLOUT_ENABLED === 'true'
  && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production');

/** Pilot appearance and read-only collection do not authorize shared writes. */
export const ariveCanonicalWritesEnabled = () => ariveRolloutEnvironmentEnabled()
  && process.env.ARIVE_CANONICAL_APPLY_ENABLED === 'true';
