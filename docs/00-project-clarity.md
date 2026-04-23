# clarity

`clarity` is an AI-native IDE focused on:

1. **Low interaction latency** (sub-200ms local operations where possible; bounded remote model latency).
2. **High context accuracy** (fresh codebase state + language-server truth + relevance-ranked retrieval).
3. **Safe multi-file editing** (structured diffs, deterministic patching, and rollback).

This document set is the implementation reference for a Cursor-style / AntiGravity-style architecture.

## Why this architecture

Traditional IDEs optimize static editing and compile loops. AI-native IDEs must additionally optimize:

- **Context assembly latency**: collect relevant snippets, diagnostics, and symbols in <300ms median.
- **Context staleness**: ensure prompts reflect unsaved buffer state, not only on-disk files.
- **Edit reliability**: avoid malformed rewrites, patch drift, and accidental cross-file breakage.

## Docs map

- `docs/01-system-architecture.md` — end-to-end architecture and sequence design.
- `docs/02-indexing-rag-lsp.md` — indexing, embedding, vector retrieval, and LSP bridge internals.
- `docs/03-composer-and-context-ranking.md` — multi-file composer agent, patching strategy, ranking algorithm.
- `docs/04-implementation-boilerplate.md` — project file structure, TypeScript `CodeIndexer` boilerplate, prompt templates.
- `docs/05-vscode-foundation-plan.md` — VS Code-first bootstrap strategy and migration path for AI-native behavior.
- `docs/06-local-model-integration-lmstudio-ollama.md` — local inference architecture, routing, and failover for LM Studio and Ollama.
