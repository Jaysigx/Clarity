import {
  ChatChunk,
  ChatRequest,
  ModelProvider,
  ProviderHealth,
} from "../types/models.js";
import { parseSseStream, resolveSignal } from "./sseUtils.js";

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = "openai_compatible" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.authHeaders(),
      });
      return res.ok ? { ok: true } : { ok: false, reason: `status ${res.status}` };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const stream = req.stream ?? false;
    const { signal, cleanup } = resolveSignal(req.signal, req.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream,
          temperature: req.temperature,
          max_tokens: req.maxTokens,
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`OpenAI-compatible chat failed: ${res.status}`);
      }

      if (stream) {
        yield* parseSseStream(res);
      } else {
        const payload = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        yield { delta: payload.choices?.[0]?.message?.content ?? "", done: true };
      }
    } finally {
      cleanup();
    }
  }

  async embed(inputs: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.authHeaders(),
      },
      body: JSON.stringify({ model, input: inputs }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`OpenAI-compatible embeddings failed: ${res.status}`);
    }

    const payload = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    return (payload.data ?? []).map((d) => d.embedding);
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    return { authorization: `Bearer ${this.apiKey}` };
  }
}
