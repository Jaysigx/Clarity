# VS Code-First Foundation Plan

Starting from VS Code architecture gives `clarity` three immediate wins:

1. Mature editor + workspace model.
2. Stable LSP and debug protocol integrations.
3. Existing extension ecosystem compatibility (critical for adoption).

## What to reuse vs replace

## Reuse directly (initially)

- Monaco model semantics and text buffer behaviors.
- Workbench concepts: explorer, tabs, command palette, settings.
- LSP/DAP client patterns and process lifecycle handling.
- File watching, search indexing hooks, and workspace trust model.

## Replace / augment for AI-native behavior

- **Context engine**: VS Code does not do retrieval-first prompt assembly.
- **Composer pipeline**: add structured, multi-file AI edits with safety gates.
- **Buffer-aware RAG**: include unsaved editor content in retrieval path.
- **AI telemetry**: token budget, context hit-rate, patch success/failure traces.

## Architecture alignment to VS Code ideas

Split into VS Code-like process boundaries:

- **UI process**: workbench + chat/composer views.
- **Extension/agent host**: tools, commands, model orchestration entrypoints.
- **Language process(es)**: LSP server sidecars.
- **Indexer process**: chunk + embed + vector DB writer (isolated to protect UI latency).

Keep AI services outside the UI thread; treat them like language service peers.

## Practical bootstrap options

## Option A: Fork `code-oss` (fastest full IDE parity)

Pros:
- Maximum compatibility with extension APIs.
- Native workbench behavior from day one.

Cons:
- Higher maintenance burden with upstream rebases.
- More complexity early.

Use when:
- You need strong “drop-in VS Code alternative” positioning immediately.

## Option B: Monaco + custom shell (cleaner long-term architecture)

Pros:
- Smaller core, faster experimentation on AI-first UX.
- Easier to harden latency budgets around agent workflows.

Cons:
- You must rebuild many workbench features yourself.
- Extension compatibility is limited unless emulation layer added.

Use when:
- AI-native behavior is prioritized over VS Code parity in v1.

## Recommended path for clarity

1. Start with **Option A (code-oss base)** to get:
   - editor/workspace stability
   - extension compatibility
   - mature LSP wiring
2. Add `clarity` subsystems as isolated services:
   - `indexer`, `context-engine`, `composer`, `model-gateway`
   - first-class local adapters for `lmstudio` and `ollama`
   - custom model registry + import command for user-defined model endpoints
3. Gradually replace weak points:
   - default quick fix flows -> Composer actions
   - static search results -> retrieval-ranked AI context views
4. Keep an internal abstraction layer so future migration to lighter shell remains possible.

## First technical checkpoint (2-3 weeks)

- Build a VS Code command: `Clarity: Compose Fix From Diagnostics`.
- Flow:
  1. collect current file + diagnostics + nearby symbols
  2. retrieve ranked snippets from local vector index
  3. request structured patch from local model gateway (LM Studio primary, Ollama fallback)
  4. preview diff in editor
  5. apply with rollback snapshot

Success criteria:
- Median end-to-end latency < 4s for small fixes
- >85% patch apply success without manual conflicts
- No UI freezes during indexing or composition
