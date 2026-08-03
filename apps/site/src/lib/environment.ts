export const RUNTIME_ENVIRONMENT =
  process.env.NEXT_PUBLIC_MNEIA_ENV ??
  (process.env.NODE_ENV === 'production' ? 'production' : 'development');
