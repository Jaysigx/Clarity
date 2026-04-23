import {
  ChatChunk,
  ChatRequest,
  ModelProvider,
  ProviderHealth,
} from "../types/models.js";
import { parseOllamaStream, resolveSignal } from "./sseUtils.js";

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama" as const;

  constructor(private readonly baseUrl = "http://127.0.0.1:11434") {}

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok ? { ok: true } : { ok: false, reason: `status ${res.status}` };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const stream = req.stream ?? false;
    const { signal, cleanup } = resolveSignal(req.signal, req.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream,
          options: {
            temperature: req.temperature,
            num_predict: req.maxTokens,
          },
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama chat failed: ${res.status}`);
      }

      if (stream) {
        yield* parseOllamaStream(res);
      } else {
        const payload = (await res.json()) as { message?: { content?: string } };
        yield { delta: payload.message?.content ?? "", done: true };
      }
    } finally {
      cleanup();
    }
  }

  async embed(inputs: string[], model: string, signal?: AbortSignal): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const input of inputs) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: input }),
        signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed: ${res.status}`);
      }
      const payload = (await res.json()) as { embedding?: number[] };
      vectors.push(payload.embedding ?? []);
    }
    return vectors;
  }
}
