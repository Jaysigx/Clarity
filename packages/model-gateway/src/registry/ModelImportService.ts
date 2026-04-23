import crypto from "node:crypto";
import { ModelProvider, ProviderName, RegisteredModel } from "../types/models.js";
import { ModelRegistry } from "./ModelRegistry.js";

export interface ImportModelInput {
  displayName: string;
  provider: ProviderName;
  providerModelId: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  supportsEmbeddings?: boolean;
  supportsJsonMode?: boolean;
  supportsToolCalls?: boolean;
}

export class ModelImportService {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly providers: Map<ProviderName, ModelProvider>
  ) {}

  async importCustomModel(input: ImportModelInput): Promise<RegisteredModel> {
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw new Error(`Provider not found: ${input.provider}`);
    }

    const health = await provider.healthCheck();
    if (!health.ok) {
      throw new Error(`Provider unhealthy: ${health.reason ?? "unknown"}`);
    }

    await this.runSmokeTest(provider, input.providerModelId);

    const model: RegisteredModel = {
      id: this.modelId(input.provider, input.providerModelId),
      displayName: input.displayName,
      provider: input.provider,
      providerModelId: input.providerModelId,
      supports: {
        chat: true,
        embeddings: input.supportsEmbeddings ?? false,
        jsonMode: input.supportsJsonMode ?? false,
        toolCalls: input.supportsToolCalls ?? false,
      },
      limits: {
        maxContextTokens: input.maxContextTokens,
        maxOutputTokens: input.maxOutputTokens,
      },
      status: "healthy",
    };

    await this.registry.upsert(model);
    return model;
  }

  private async runSmokeTest(provider: ModelProvider, modelId: string): Promise<void> {
    let sawContent = false;
    for await (const chunk of provider.chat({
      model: modelId,
      messages: [{ role: "user", content: "Reply with OK" }],
      maxTokens: 16,
      stream: false,
    })) {
      if (chunk.delta.trim().length > 0) {
        sawContent = true;
      }
    }
    if (!sawContent) {
      throw new Error("Model smoke test failed: no content returned");
    }
  }

  private modelId(provider: ProviderName, providerModelId: string): string {
    return crypto
      .createHash("sha256")
      .update(`${provider}:${providerModelId}`)
      .digest("hex")
      .slice(0, 16);
  }
}
