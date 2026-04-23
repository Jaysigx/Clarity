import {
  ChatChunk,
  ChatRequest,
  ModelProvider,
  ProviderName,
  RoutingPolicy,
  TaskType,
} from "../types/models.js";
import { DEFAULT_RETRY_OPTIONS, RetryOptions, classifyError, isRetryable } from "./RetryPolicy.js";
import { TelemetryCollector } from "./Telemetry.js";

export class ProviderRouter {
  private readonly providers = new Map<ProviderName, ModelProvider>();
  readonly telemetry = new TelemetryCollector();

  constructor(
    providerList: ModelProvider[],
    private readonly policy: RoutingPolicy,
    private readonly retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
  ) {
    for (const provider of providerList) {
      this.providers.set(provider.name, provider);
    }
  }

  async *chat(req: ChatRequest, task: TaskType = "chat"): AsyncIterable<ChatChunk> {
    const order = this.orderFor(task);
    let lastError: Error | undefined;
    let isFailover = false;

    for (const providerName of order) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      const health = await provider.healthCheck();
      if (!health.ok) continue;

      const startMs = Date.now();
      let ttfbMs: number | null = null;
      let tokenCount = 0;
      let routeError = false;

      let attempt = 0;
      let succeeded = false;

      while (attempt < this.retryOptions.maxAttempts) {
        try {
          for await (const chunk of provider.chat(req)) {
            if (ttfbMs === null) ttfbMs = Date.now() - startMs;
            if (chunk.delta) tokenCount += this.estimateTokens(chunk.delta);
            yield chunk;
          }
          succeeded = true;
          break;
        } catch (error) {
          lastError = error as Error;
          const cls = classifyError(error);
          if (!isRetryable(cls) || attempt >= this.retryOptions.maxAttempts - 1) {
            routeError = true;
            break;
          }
          const delay = Math.min(
            this.retryOptions.baseDelayMs * 2 ** attempt,
            this.retryOptions.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        }
      }

      const totalMs = Date.now() - startMs;
      const tokensPerSec = ttfbMs !== null && totalMs > 0
        ? (tokenCount / totalMs) * 1000
        : null;

      this.telemetry.record({
        provider: providerName,
        task,
        ttfbMs,
        totalMs,
        tokenCount,
        tokensPerSec,
        failover: isFailover,
        error: routeError,
      });

      if (succeeded) return;
      isFailover = true;
    }

    throw lastError ?? new Error("No healthy provider available for chat");
  }

  async embed(inputs: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const order = this.orderFor("embeddings");
    let lastError: Error | undefined;
    let isFailover = false;

    for (const providerName of order) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;
      const health = await provider.healthCheck();
      if (!health.ok) continue;

      const startMs = Date.now();
      let routeError = false;
      let attempt = 0;

      while (attempt < this.retryOptions.maxAttempts) {
        try {
          const result = await provider.embed(inputs, model, signal);
          const totalMs = Date.now() - startMs;
          this.telemetry.record({
            provider: providerName,
            task: "embeddings",
            ttfbMs: totalMs,
            totalMs,
            tokenCount: inputs.length,
            tokensPerSec: null,
            failover: isFailover,
            error: false,
          });
          return result;
        } catch (error) {
          lastError = error as Error;
          const cls = classifyError(error);
          if (!isRetryable(cls) || attempt >= this.retryOptions.maxAttempts - 1) {
            routeError = true;
            break;
          }
          const delay = Math.min(
            this.retryOptions.baseDelayMs * 2 ** attempt,
            this.retryOptions.maxDelayMs
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        }
      }

      const totalMs = Date.now() - startMs;
      this.telemetry.record({
        provider: providerName,
        task: "embeddings",
        ttfbMs: null,
        totalMs,
        tokenCount: 0,
        tokensPerSec: null,
        failover: isFailover,
        error: routeError,
      });
      isFailover = true;
    }

    throw lastError ?? new Error("No healthy provider available for embeddings");
  }

  private orderFor(task: TaskType): ProviderName[] {
    if (task === "composer") return this.policy.composer;
    if (task === "embeddings") return this.policy.embeddings;
    return this.policy.chat;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
