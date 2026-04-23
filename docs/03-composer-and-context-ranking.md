# Composer and Context Ranking

## 1) Multi-file Composer architecture

Composer stages:

1. **Plan**
   - Classify request: bugfix/refactor/feature/test-only.
   - Predict affected files via retrieval + symbol graph + git heuristics.

2. **Propose edits**
   - Ask model for structured patch format (search/replace or unified diff).
   - Enforce schema and file allowlist.

3. **Validate**
   - Ensure search anchors still exist.
   - Apply patch in memory to shadow workspace.
   - Run syntax + LSP diagnostics + optional tests.

4. **Commit to editor**
   - If clean, apply edits to live buffers.
   - If partial failures, present per-file conflict resolution UI.

## Aider-style edits vs whole-file rewrites

**Aider-style search/replace edits**
- Pros: lower token usage, less drift, better merge conflict behavior, easier provenance.
- Cons: anchor mismatch risk when file changed, needs robust fuzzy matching fallback.
- Best for: mature codebases, incremental fixes, multi-file small-medium changes.

**Whole-file rewrites**
- Pros: simpler generation contract, fewer anchor issues.
- Cons: high token/latency cost, higher accidental regressions, harder review.
- Best for: small files, generated code, initial scaffolding.

Recommended default:
- Prefer search/replace (or hunk diffs).
- Fallback to whole-file only when patch confidence is low and file is below size threshold.

## 2) Safe diff apply model

- Parse model output into typed operations:
  - `replace_span`, `search_replace`, `insert_after_symbol`, `delete_range`
- Precondition checks:
  - `fileExists`
  - `versionMatch`
  - `searchSnippetUnique`
- If exact search fails, optional fuzzy match with similarity threshold + human confirmation.
- Apply on shadow tree first, then atomic write to editor buffers.
- Persist rollback snapshot per compose run.

## 3) Context window ranking algorithm

Goal: maximize answer/edit correctness per token.

Candidate sources:
- Active file slices around cursor/selection
- Recently edited files
- LSP diagnostics-linked regions
- Vector retrieval chunks
- Symbol graph neighbors (defs/refs/callees/callers)
- Git diff context

Scoring:

`score = w_sem*semantic + w_prox*cursor_proximity + w_diag*diagnostic_weight + w_recency*recency + w_graph*symbol_graph + w_path*path_prior - w_stale*staleness`

Practical defaults:
- `w_sem=0.35`, `w_diag=0.20`, `w_graph=0.15`, `w_prox=0.15`, `w_recency=0.10`, `w_path=0.05`

Packing strategy:
- Reserve fixed budget for:
  - system/tool instructions (15%)
  - user request + conversation (15-25%)
  - code context (remaining budget)
- Add snippets greedily by score density (`score / tokens`) with diversity constraints:
  - max chunks per file
  - max files per directory cluster
  - ensure at least one diagnostic chunk when errors exist

Latency optimization:
- Two-stage retrieval:
  1. fast approximate vector recall top-40
  2. cheap rerank (BM25/symbol overlap/diagnostic proximity) to top-8..16
