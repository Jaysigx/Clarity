# Indexing, RAG, and LSP Bridge

## 1) Codebase indexing strategy (RAG)

## Ingestion pipeline

1. File walker (respect `.gitignore`, language filters, max file size).
2. Language-aware chunker (tree-sitter or parser AST if available).
3. Embedding batcher (`text-embedding-3-small` baseline).
4. Vector store upsert (LanceDB/Chroma) with metadata.

## Chunking policy (context-accuracy first)

- Prefer semantic units over fixed tokens:
  - Function/method/class blocks
  - Module-level constants/types/interfaces
  - Doc comments attached to symbol
- Fallback for parser failure: sliding windows (e.g., 120-200 lines, 20-line overlap).
- Store both:
  - `chunk_text` (retrieval body)
  - `symbol_signature` (for exact-match boosts)

Recommended target sizes:
- 300-1200 tokens/chunk
- 10-15% overlap for long implementations
- Hard cap by chars/tokens to prevent oversized chunks

## Embedding and storage schema

Embedding model:
- `text-embedding-3-small` for cost/latency baseline
- Optional upgrade path: dual-index (small for recall, larger for rerank)

Metadata fields:
- `repo_id`, `file_path`, `language`
- `symbol_name`, `symbol_kind`, `start_line`, `end_line`
- `git_commit`, `last_modified_ms`
- `doc_version` (buffer-aware), `chunk_hash`

Vector DB:
- LanceDB for local analytical speed and columnar metadata filtering
- Chroma for simpler initial setup

## Freshness model

- Index tracks both disk and editor-buffer versions.
- Unsaved buffers create ephemeral chunks in an in-memory side index.
- Retrieval merges: in-memory side index > persisted index precedence.

## 2) LSP bridge design

The bridge maps editor document lifecycle to LSP protocol:

- `didOpen` on file activation
- `didChange` on debounce with incremental sync
- `didSave` on write-through
- `didClose` on file eviction

Capabilities consumed for AI context:
- `textDocument/publishDiagnostics` -> error/warning grounding
- `textDocument/hover` -> inferred type/doc context
- `textDocument/definition` and `references` -> symbol graph expansion
- `workspace/symbol` -> global symbol candidate recall

## Buffer-LSP coherence

- Every request includes editor `documentVersion`.
- Responses tagged and dropped if stale relative to current version.
- Diagnostics cache keyed by `(uri, version)`.

## Practical latency constraints

- LSP requests must be budgeted (e.g., total 120ms soft budget per context build).
- Use adaptive strategy:
  - If diagnostics are fresh (<2s old), skip immediate refresh.
  - Resolve definitions/references only for top-ranked snippets, not all candidates.
