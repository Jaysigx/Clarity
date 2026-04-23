export type ProviderName = "lmstudio" | "ollama" | "openai_compatible" | "cloud";
export type TaskType = "chat" | "composer" | "embeddings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  responseFormat?: "text" | "json";
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  reason?: string;
}

export interface ModelProvider {
  name: ProviderName;
  healthCheck(): Promise<ProviderHealth>;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  embed(inputs: string[], model: string, signal?: AbortSignal): Promise<number[][]>;
}

export interface RegisteredModel {
  id: string;
  displayName: string;
  provider: ProviderName;
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
  defaults?: {
    temperature?: number;
    topP?: number;
  };
  status: "healthy" | "warming" | "unavailable";
}

export interface ProviderRoute {
  task: TaskType;
  preferredProviders: ProviderName[];
}

export interface RoutingPolicy {
  chat: ProviderName[];
  composer: ProviderName[];
  embeddings: ProviderName[];
}
