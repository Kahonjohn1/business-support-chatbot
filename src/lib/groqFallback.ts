// Model-fallback and provider error-classification helpers.
//
// Kept dependency-free (no SDK / server-only imports) so the retry decision can
// be unit tested directly. `src/lib/groq.ts` wires these to the real HTTP calls.

/**
 * Reads the HTTP status from a thrown provider error. Groq's OpenAI-compatible
 * API surfaces it on `.status` (and `.statusCode` for wrapped variants);
 * network, abort, and timeout failures carry neither.
 */
export function readProviderErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const candidate = error as { status?: unknown; statusCode?: unknown };
  for (const value of [candidate.status, candidate.statusCode]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * True for client cancellation or client-side timeouts, whether raised by
 * fetch (`AbortError` / `TimeoutError`) or by a wrapping SDK layer.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && /abort|timeout/i.test(error.name);
}

export function isAbortLike(error: unknown): boolean {
  return isAbortError(error);
}

/**
 * Whether a failed model call is worth retrying on another model.
 *
 * Recoverable: rate limits, transient server/network failures, request
 * timeouts, and a not-found model name (a different model may exist).
 *
 * Not recoverable — a second model cannot fix these, so we fail fast: invalid
 * requests, authentication/permission errors, unprocessable payloads
 * (oversized or unsupported files), and cancellations/timeouts.
 */
export function isRecoverableProviderError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false;
  }
  const status = readProviderErrorStatus(error);
  if (status === undefined) {
    return true;
  }
  if (status === 429 || status === 408 || status === 404 || status === 409) {
    return true;
  }
  return status >= 500;
}

/**
 * Resolves the fallback model, or `null` when there is nothing distinct to
 * retry with. A missing, blank, or primary-identical value disables the
 * fallback, so the caller never makes a duplicate attempt.
 */
export function resolveFallbackModel(
  primaryModel: string,
  fallbackModel?: string | null
): string | null {
  const primary = primaryModel.trim();
  const fallback = fallbackModel?.trim();
  if (!fallback || fallback === primary) {
    return null;
  }
  return fallback;
}

/** Details passed to {@link RunWithModelFallbackOptions.onFallback}. */
export interface FallbackNotice {
  failedModel: string;
  nextModel: string;
  status?: number;
}

export interface RunWithModelFallbackOptions<T> {
  primaryModel: string;
  /** A distinct fallback model, or `null` to attempt the primary alone. */
  fallbackModel: string | null;
  /** Performs one model call, rejecting with the raw provider error on failure. */
  attempt: (model: string) => Promise<T>;
  /** Overrides the recoverability check (defaults to {@link isRecoverableProviderError}). */
  isRecoverable?: (error: unknown) => boolean;
  /**
   * Abort signal for the operation. When it is already aborted, the fallback is
   * not attempted and the primary error is rethrown, so cancellation is honored.
   */
  signal?: AbortSignal;
  /** Optional hook invoked once, just before the fallback attempt. */
  onFallback?: (notice: FallbackNotice) => void;
}

/**
 * Runs the primary model and, only if it fails recoverably and a distinct
 * fallback is configured, retries exactly once on the fallback. The original
 * error is rethrown when there is no fallback, the failure is not recoverable,
 * the operation was aborted, or the fallback also fails — so callers map a
 * single error safely.
 */
export async function runWithModelFallback<T>(
  options: RunWithModelFallbackOptions<T>
): Promise<T> {
  const { primaryModel, fallbackModel, attempt } = options;
  const isRecoverable = options.isRecoverable ?? isRecoverableProviderError;

  try {
    return await attempt(primaryModel);
  } catch (error) {
    const cancelled = options.signal?.aborted ?? false;
    if (!fallbackModel || cancelled || !isRecoverable(error)) {
      throw error;
    }
    options.onFallback?.({
      failedModel: primaryModel,
      nextModel: fallbackModel,
      status: readProviderErrorStatus(error),
    });
    return attempt(fallbackModel);
  }
}
