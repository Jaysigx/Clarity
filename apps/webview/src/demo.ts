import os from "node:os";
import path from "node:path";
import {
  ChatChunk,
  ChatRequest,
  ModelImportService,
  ModelProvider,
  ModelRegistry,
  ProviderRouter,
  RoutingPolicy,
} from "../../../packages/model-gateway/src/index.js";
import {
  ContextCandidate,
  packContext,
  rankCandidates,
} from "../../../packages/context-engine/src/index.js";

class MockProvider implements ModelProvider {
  constructor(
    public readonly name: "lmstudio" | "ollama" | "openai_compatible" | "cloud",
    private readonly healthy: boolean,
    private readonly responsePrefix: string
  ) {}

  async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
    return this.healthy ? { ok: true } : { ok: false, reason: "mock unhealthy" };
  }

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const userText = req.messages[req.messages.length - 1]?.content ?? "";
    yield { delta: `${this.responsePrefix}:${req.model}:${userText}`, done: true };
  }

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map((text) => [text.length / 100, 0.42, 0.13]);
  }
}

async function runDemo(): Promise<void> {
  const policy: RoutingPolicy = {
    chat: ["lmstudio", "ollama", "openai_compatible"],
    composer: ["lmstudio", "openai_compatible", "ollama"],
    embeddings: ["ollama", "lmstudio", "openai_compatible"],
  };

  const providers = [
    new MockProvider("lmstudio", true, "lmstudio"),
    new MockProvider("ollama", true, "ollama"),
    new MockProvider("openai_compatible", false, "openai"),
  ];

  const router = new ProviderRouter(providers, policy);
  const registryPath = path.join(os.tmpdir(), "clarity-model-registry-demo.json");
  const registry = new ModelRegistry(registryPath);
  const importService = new ModelImportService(
    registry,
    new Map(providers.map((p) => [p.name, p]))
  );

  const imported = await importService.importCustomModel({
    displayName: "Demo Local Coder",
    provider: "lmstudio",
    providerModelId: "demo-coder-7b",
    maxContextTokens: 16384,
    maxOutputTokens: 2048,
    supportsEmbeddings: true,
    supportsJsonMode: true,
    supportsToolCalls: false,
  });

  const chatChunks: string[] = [];
  for await (const chunk of router.chat(
    {
      model: imported.providerModelId,
      messages: [{ role: "user", content: "hello from clarity demo" }],
      maxTokens: 128,
    },
    "composer"
  )) {
    chatChunks.push(chunk.delta);
  }

  const candidates: ContextCandidate[] = [
    {
      id: "a",
      filePath: "src/router.ts",
      content: "provider routing policy and fallback order",
      tokens: 80,
      semanticScore: 0.9,
      cursorProximity: 0.7,
      diagnosticWeight: 0.2,
      recency: 0.8,
      symbolGraph: 0.9,
      pathPrior: 0.7,
      staleness: 0.1,
    },
    {
      id: "b",
      filePath: "src/lsp.ts",
      content: "diagnostic payload mapping and document version checks",
      tokens: 95,
      semanticScore: 0.72,
      cursorProximity: 0.5,
      diagnosticWeight: 0.95,
      recency: 0.6,
      symbolGraph: 0.5,
      pathPrior: 0.6,
      staleness: 0.05,
    },
    {
      id: "c",
      filePath: "src/indexer.ts",
      content: "chunking and embedding upsert logic",
      tokens: 120,
      semanticScore: 0.84,
      cursorProximity: 0.4,
      diagnosticWeight: 0.3,
      recency: 0.7,
      symbolGraph: 0.65,
      pathPrior: 0.8,
      staleness: 0.2,
    },
  ];

  const ranked = rankCandidates(candidates);
  const packed = packContext(ranked, {
    maxChunks: 2,
    maxChunksPerFile: 1,
    maxTokens: 190,
  });

  console.log("Imported model:", imported);
  console.log("Composer route response:", chatChunks.join(""));
  console.log(
    "Packed context IDs:",
    packed.map((p) => p.candidate.id).join(", ")
  );
}

void runDemo();
