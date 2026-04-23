# Initial Implementation Plan and Boilerplate

## Recommended stack

- Shell: **Tauri** (Rust core + lighter memory) or **Electron** (ecosystem speed)
- Editor: **Monaco** for VSCode-like model APIs and tokenization ecosystem
- Orchestration: **Node.js TypeScript** (rapid iteration) with optional Rust workers for indexing
- Vector DB: **LanceDB** local-first
- LSP: `vscode-languageserver-protocol` + per-language server adapters
- Local inference: **LM Studio** (OpenAI-compatible API) + **Ollama** adapters via `model-gateway`

## Project file structure

```text
clarity/
  apps/
    desktop/                  # Electron/Tauri host
    webview/                  # UI shell, panels, chat
  packages/
    editor-bridge/            # Monaco/CodeMirror adapter, buffer events
    lsp-bridge/               # LSP client manager, diagnostics cache
    indexer/                  # chunking, embeddings, vector store
    context-engine/           # ranking, token budgeting, packing
      src/index.ts            # candidate scoring and context packing
    composer/                 # plan->patch->validate->apply pipeline
    model-gateway/            # LLM provider abstraction, streaming
      src/providers/          # lmstudio.ts, ollama.ts, cloud.ts
      src/router/             # provider selection and fallback policy
      src/registry/           # custom model import, validation, persistence
    shared-types/             # protocol types, schema, telemetry contracts
  docs/
    00-project-clarity.md
    01-system-architecture.md
    02-indexing-rag-lsp.md
    03-composer-and-context-ranking.md
    04-implementation-boilerplate.md
    05-vscode-foundation-plan.md
    06-local-model-integration-lmstudio-ollama.md
```

## TypeScript boilerplate: `CodeIndexer`

```ts
// packages/indexer/src/CodeIndexer.ts
import crypto from "node:crypto";

export interface SourceDocument {
  path: string;
  language: string;
  content: string;
  version: number; // editor buffer version
  modifiedAtMs: number;
}

export interface CodeChunk {
  id: string;
  repoId: string;
  filePath: string;
  language: string;
  text: string;
  startLine: number;
  endLine: number;
  symbolName?: string;
  symbolKind?: string;
  docVersion: number;
  chunkHash: string;
}

export interface EmbeddingProvider {
  embed(inputs: string[]): Promise<number[][]>;
}

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  deleteByFilePath(filePath: string): Promise<void>;
}

export interface Chunker {
  chunk(doc: SourceDocument): CodeChunk[];
}

export class CodeIndexer {
  constructor(
    private readonly repoId: string,
    private readonly chunker: Chunker,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectorStore: VectorStore
  ) {}

  async indexDocument(doc: SourceDocument): Promise<CodeChunk[]> {
    const chunks = this.chunker.chunk(doc).map((c) => ({
      ...c,
      repoId: this.repoId,
      docVersion: doc.version,
      chunkHash: this.hash(c.text),
    }));

    if (!chunks.length) return [];

    const vectors = await this.embeddings.embed(chunks.map((c) => c.text));
    const records: VectorRecord[] = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i],
      metadata: {
        repoId: chunk.repoId,
        filePath: chunk.filePath,
        language: chunk.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbolName: chunk.symbolName ?? null,
        symbolKind: chunk.symbolKind ?? null,
        docVersion: chunk.docVersion,
        chunkHash: chunk.chunkHash,
      },
    }));

    await this.vectorStore.deleteByFilePath(doc.path);
    await this.vectorStore.upsert(records);
    return chunks;
  }

  private hash(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }
}
```

## Prompt template for structured edits (search-and-replace / diff)

```text
SYSTEM:
You are a code-editing engine. Return ONLY valid JSON that matches the schema.
Do not include markdown fences or explanations.

SCHEMA:
{
  "edits": [
    {
      "filePath": "string",
      "mode": "search_replace" | "unified_diff",
      "search": "string (required when mode=search_replace)",
      "replace": "string (required when mode=search_replace)",
      "diff": "string (required when mode=unified_diff)"
    }
  ],
  "notes": "string"
}

RULES:
- Prefer search_replace for minimal safe edits.
- Keep edits idempotent when possible.
- Never touch files not listed in ALLOWED_FILES.
- If uncertain, return an empty edits array and explain uncertainty in notes.

ALLOWED_FILES:
{{allowed_files}}

USER_REQUEST:
{{user_request}}

CONTEXT_SNIPPETS:
{{ranked_context_snippets}}
```

Provider notes:
- LM Studio should be called via OpenAI-compatible chat endpoint for strict JSON mode where supported.
- Ollama responses should be normalized before schema validation due to streaming format differences.

## Phased implementation plan (first 4 milestones)

1. **M1: Editor + LSP baseline**
   - Monaco wiring, open/save buffers, diagnostics stream.
   - Latency target: diagnostics visible <500ms after pause.

2. **M2: Indexing + retrieval**
   - Semantic chunker + embedding + vector upsert.
   - Query API returns top-K with metadata and source spans.

3. **M3: Context engine**
   - Ranking formula + token budgeting + prompt assembly.
   - Add telemetry for retrieval hit quality and latency.

4. **M4: Composer safe apply**
   - Structured edit output, shadow apply, conflict handling, rollback.
   - LSP/test validation gate before final apply.

5. **M5: Local model gateway**
   - Add LM Studio and Ollama adapters.
   - Implement health checks, routing policy, and provider failover.
   - Add per-task model mapping (`chat`, `composer`, `embeddings`).

6. **M6: Custom model import**
   - Add model registry (workspace + global scope).
   - Support importing OpenAI-compatible endpoints and provider model IDs.
   - Run capability probes (chat/json/embeddings) before enabling routing.
