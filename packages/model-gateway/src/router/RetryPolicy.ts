export type ErrorClass = "transient" | "rate_limit" | "auth" | "not_found" | "fatal";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  jitter: true,
};

export function classifyError(error: unknown): ErrorClass {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit")
  ) {
    return "rate_limit";
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) {
    return "auth";
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return "not_found";
  }
  if (
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timed out")
  ) {
    return "transient";
  }
  return "fatal";
}

export function isRetryable(errorClass: ErrorClass): boolean {
  return errorClass === "transient" || errorClass === "rate_limit";
}

function delayMs(attempt: number, opts: RetryOptions): number {
  const exp = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
  if (!opts.jitter) return exp;
  return exp * (0.5 + Math.random() * 0.5);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = DEFAULT_RETRY_OPTIONS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const cls = classifyError(error);
      if (!isRetryable(cls) || attempt === opts.maxAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs(attempt, opts)));
    }
  }
  throw lastError;
}
