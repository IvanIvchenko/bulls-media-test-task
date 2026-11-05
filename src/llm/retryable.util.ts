/**
 * Whether a failed model call is worth repeating. Rate limits, timeouts and server errors pass. A rejected
 * request (bad key, bad request, forbidden, not found) will fail the same way again, so retrying only delays the
 * answer. Anything without an HTTP status (a dropped connection, a timeout, output that failed validation) is
 * retried.
 */
export function isRetryableLlmError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== 'number') return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
