import { ChatChunk } from "../types/models.js";

export function resolveSignal(
  signal?: AbortSignal,
  timeoutMs?: number
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!signal && !timeoutMs) return { signal: undefined, cleanup: () => {} };

  const controller = new AbortController();

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs != null) {
    timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  }

  const cleanup = () => {
    if (timer != null) clearTimeout(timer);
  };

  return { signal: controller.signal, cleanup };
}

interface SseDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

export async function* parseSseStream(res: Response): AsyncIterable<ChatChunk> {
  const body = res.body;
  if (!body) return;

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ":") continue;

        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") {
            yield { delta: "", done: true };
            return;
          }
          try {
            const parsed = JSON.parse(data) as SseDelta;
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            const finishReason = parsed.choices?.[0]?.finish_reason;
            const isDone = finishReason != null && finishReason !== "";
            if (delta || isDone) {
              yield { delta, done: isDone };
            }
          } catch {
            // skip malformed SSE data lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface OllamaNdjsonLine {
  message?: { content?: string };
  done?: boolean;
}

export async function* parseOllamaStream(res: Response): AsyncIterable<ChatChunk> {
  const body = res.body;
  if (!body) return;

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as OllamaNdjsonLine;
          const delta = parsed.message?.content ?? "";
          const isDone = parsed.done ?? false;
          yield { delta, done: isDone };
          if (isDone) return;
        } catch {
          // skip malformed NDJSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
