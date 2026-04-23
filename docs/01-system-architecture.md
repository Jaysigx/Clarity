# clarity System Architecture

## High-level system diagram (textual)

```text
+----------------------+          +-----------------------------+
|  Electron/Tauri UI   | <------> |  Editor Runtime (Monaco/CM6)|
|  - Panels/Chat       |          |  - Text buffers             |
|  - Command palette   |          |  - Selection/cursor state   |
+----------+-----------+          +---------------+-------------+
           |                                      |
           | IPC / RPC                            | Buffer events
           v                                      v
+---------------------------------------------------------------+
|                   Local Orchestrator (Node/Rust)              |
| - Context Builder                                               |
| - Prompt Planner                                                |
| - Composer (multi-file edits)                                  |
| - Safety Engine (diff verify/apply/rollback)                   |
+------------+------------------+-----------------+--------------+
             |                  |                 |
             |                  |                 |
             v                  v                 v
  +------------------+  +------------------+  +----------------------+
  | LSP Bridge       |  | Indexing/RAG     |  | Model Gateway        |
  | - diagnostics    |  | - chunking        |  | - local/remote LLM   |
  | - symbols/hover  |  | - embeddings      |  | - retries/timeouts   |
  | - refs/defs      |  | - vector DB       |  | - telemetry          |
  +--------+---------+  +---------+---------+  +----------+-----------+
           |                      |                       |
           v                      v                       v
   +---------------+      +---------------+       +-------------------+
   | Language      |      | LanceDB/      |       | OpenAI/other API |
   | Servers       |      | Chroma local  |       | (streaming)      |
   +---------------+      +---------------+       +-------------------+
```

## Primary data flows

1. **Edit loop**
   - Buffer change event -> incremental parser/index update -> possible LSP debounce refresh.
   - UI remains responsive because retrieval and embedding are off main thread.

2. **Ask/Chat loop**
   - User query -> Context Builder merges: active buffer slices + LSP diagnostics + vector hits + git diff.
   - Prompt Planner budgets tokens and ranks snippets.
   - Model Gateway streams response to UI.

3. **Composer loop**
   - Planner asks model for structured edits (search/replace or unified diff).
   - Safety Engine validates edits against current buffer hashes.
   - Apply staged patches -> run diagnostics/tests -> summarize outcome.

## Latency-critical design choices

- Keep **hot index** in memory (recent files/chunks) and persist asynchronously to vector DB.
- Maintain **document version IDs** from editor buffers; never block on disk flush for prompt context.
- Use **incremental indexing** with debounce (e.g., 400-800ms per file) and batch embeddings.
- Parallelize LSP + vector retrieval; merge late with deterministic ranking.

## Reliability-critical design choices

- Structured model outputs only (JSON schema + retry if invalid).
- Patch application on shadow copy before live write.
- Conflict detection uses `(filePath, documentVersion, contentHash)` tuples.
- Full audit trail: prompt context IDs, applied hunks, rollback snapshot.
