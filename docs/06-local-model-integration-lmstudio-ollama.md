# Local Model Integration: LM Studio + Ollama

This defines how `clarity` runs with local inference providers first-class, not via ad-hoc HTTP calls.

## Provider strategy

Implement a provider-neutral `ModelGateway` with adapters:

- `OpenAICompatibleProvider` (for LM Studio OpenAI-style API)
- `OllamaProvider` (for native Ollama `/api/chat` and `/api/embeddings`)
- optional `CloudProvider` fallback for overflow or unavailable local models

Local-first routing order:
1. Use local provider if model is healthy and fits context size.
2. Fall back to secondary local provider.
3. Optional cloud fallback (policy-controlled).

## Custom model import and registry

`clarity` should support user-managed model onboarding beyond defaults.

Supported import paths:
- **Ollama local tags**: register any pulled model tag.
- **LM Studio loaded models**: discover currently served model IDs from endpoint.
- **OpenAI-compatible custom endpoints**: user-supplied base URL + auth + model list.
- **Local file-backed model metadata** (for UX/catalog): GGUF path + recommended runtime/provider.

Registry record shape:
- `id` (internal stable ID)
- `displayName`
- `provider` (`lmstudio` | `ollama` | `openai_compatible`)
- `providerModelId`
- `capabilities` (`chat`, `embeddings`, `jsonMode`, `toolCalls`)
- `limits` (`maxContextTokens`, `maxOutputTokens`)
- `defaults` (`temperature`, `topP`)
- `status` (`healthy`, `warming`, `unavailable`)

Import UX requirements:
- "Add Custom Model" command in command palette.
- Validate connectivity + model presence before save.
- Run a smoke test prompt and optional JSON test for Composer compatibility.
- Persist per-workspace override or global profile.

## Endpoint contracts

## LM Studio

- Base URL typically: `http://127.0.0.1:1234/v1`
- Chat completions: `/chat/completions`
- Embeddings: `/embeddings`
- Compatible with OpenAI request/response semantics (streaming included).

## Ollama

- Base URL typically: `http://127.0.0.1:11434`
- Chat: `/api/chat` (streaming JSON lines)
- Embeddings: `/api/embeddings`
- Model names are local tags (example: `qwen2.5-coder:7b`).

## Latency controls (critical)

- Keep-alive/warm model checks at startup and on inactivity thresholds.
- Token budget prediction before dispatch; downshift context size for smaller local models.
- Request hedging (optional): start on primary, race secondary if TTFB exceeds threshold.
- Cancellable streaming requests when user edits/query changes.

Suggested SLOs:
- Local model TTFB target: <700ms
- First useful chunk target: <1.2s
- Composer hard timeout with retry: 20-35s depending on patch size

## Model profile registry

Store per-model capabilities to avoid bad routing:

- `maxContextTokens`
- `supportsJsonMode`
- `supportsToolCalls`
- `qualityTier` (fast/standard/high)
- `preferredTasks` (chat, composer, embeddings)

Example policy:
- Fast chat: small local model (Ollama)
- High-precision composer patches: stronger local model in LM Studio
- Embeddings: local embedding model in LM Studio or Ollama if quality validated
- Custom imported models are eligible only after capability and health checks pass.

## Safety and correctness

- Normalize all provider responses into one internal schema.
- Require strict JSON validation for Composer outputs regardless of provider.
- Track per-provider failure classes:
  - timeout
  - malformed stream
  - invalid JSON payload
  - model unavailable
- Automatic retry with backoff and provider switch on non-deterministic failures.

## Import validation pipeline

1. **Schema validation** of user config.
2. **Endpoint probe** (`/models` or provider-specific equivalent).
3. **Capability probe**:
   - short chat completion
   - optional JSON-constrained completion
   - optional embeddings probe
4. **Performance probe**:
   - measure TTFB and tokens/sec against baseline threshold.
5. **Registration** in model registry with health state.

## Minimal gateway interfaces (TypeScript)

```ts
export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  responseFormat?: "text" | "json";
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface ModelProvider {
  name: "lmstudio" | "ollama" | "cloud";
  healthCheck(): Promise<boolean>;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  embed(inputs: string[], model: string): Promise<number[][]>;
}

export interface RegisteredModel {
  id: string;
  displayName: string;
  provider: "lmstudio" | "ollama" | "openai_compatible";
  providerModelId: string;
  supports: {
    chat: boolean;
    embeddings: boolean;
    jsonMode: boolean;
    toolCalls: boolean;
  };
  limits: {
    maxContextTokens: number;
    maxOutputTokens: number;
  };
}
```

## Ops and developer experience

- Provider config in workspace or user settings:
  - base URLs
  - preferred models per task
  - fallback policy
  - custom model registry entries and task mapping
- Diagnostic panel:
  - active provider
  - model latency
  - token usage
  - failure reasons
