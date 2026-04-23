# IDE Feature Comparison
> **Goal:** Use this matrix to identify every gap in Clarity IDE and drive it to be the **best IDE with zero accounts, zero payment, and fully open source**.
>
> Legend: ✅ Full · 🟡 Partial · ❌ None · ✅* Recently shipped · 🎯 Planned
>
> **Clarity design constraints:** No login · No cloud dependency · No payment · Fully OSS · Self-hostable · Works offline with local models

---

## Competitors at a Glance

| IDE | Type | AI-native | Free / Open-source | No account needed |
|-----|------|-----------|-------------------|-------------------|
| **VS Code** | Desktop (Electron) | Via extensions | ✅ Free, OSS | ✅ |
| **Cursor** | Desktop (Electron) | Yes — core feature | ❌ Freemium, closed | ❌ Account required |
| **Windsurf** | Desktop (Electron) | Yes — Cascade agent | ❌ Freemium, closed | ❌ Account required |
| **Zed** | Desktop (native Rust) | Yes — inline + panel | ✅ OSS (AGPL) | 🟡 Optional account |
| **JetBrains IDEs** | Desktop (JVM) | Via AI Assistant | ❌ Paid (free tiers) | ❌ Account required |
| **Neovim + plugins** | Terminal | Via plugins | ✅ Free, OSS | ✅ |
| **GitHub Codespaces** | Browser | Copilot | ❌ Paid cloud | ❌ GitHub account |
| **Replit** | Browser | Yes — Ghostwriter | ❌ Freemium | ❌ Account required |
| **Helix** | Terminal (native Rust) | None yet | ✅ Free, OSS | ✅ |
| **Lapce** | Desktop (native Rust) | Via plugins | ✅ Free, OSS | ✅ |
| **Clarity** *(this project)* | Browser + Desktop (Tauri) | Yes — core, BYOM | ✅ **Free, fully OSS, MIT** | ✅ **Zero accounts ever** |

---

## 1. Editor Core

| Feature | VS Code | Cursor | Zed | Neovim | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----|--------|-------------------|----------------------|
| Syntax highlighting | ✅ Tree-sitter | ✅ | ✅ Tree-sitter | ✅ Tree-sitter | 🟡 highlight.js | 🎯 Tree-sitter WASM |
| Multi-cursor | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 Alt+Click / Ctrl+D |
| Code folding | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 brace/indent depth |
| Minimap | ✅ | ✅ | ❌ | plugin | ❌ | 🎯 pixel-density canvas |
| Word wrap | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Line numbers | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Go to line (Ctrl+G) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Find & replace in file | ✅ | ✅ | ✅ | ✅ | ✅* shipped | — |
| Bracket pair colorization | ✅ | ✅ | ✅ | plugin | ❌ | 🎯 CSS depth cycling |
| Indent guides | ✅ | ✅ | ✅ | plugin | ❌ | 🎯 canvas overlay |
| Sticky scroll | ✅ | ✅ | ❌ | ❌ | ❌ | 🎯 pinned header |
| Auto-close brackets | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Auto-indent | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Tab / Shift+Tab indent | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Configurable tab size | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Font size / family | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Auto-save | ✅ | ✅ | ✅ | plugin | ✅ 800ms debounce | — |
| Multi-tab editing | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Split editor panes | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 Ctrl+\ |
| Vim keybindings | ✅ ext | ✅ ext | ✅ native | ✅ native | ❌ | 🎯 toggle in settings |
| Inline AI ghost text | ✅ Copilot | ✅ Tab | ✅ | plugin | ❌ | 🎯 `/api/autocomplete` + FIM |
| Format on save | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 LSP formatting |
| Diff editor | ✅ | ✅ | ✅ | ✅ | 🟡 composer only | 🎯 side-by-side diff view |
| Image preview | ✅ | ✅ | 🟡 | ❌ | ❌ | 🎯 inline PNG/SVG/GIF |

---

## 2. Language Intelligence (LSP)

| Feature | VS Code | Cursor | Zed | Neovim | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----|--------|-------------------|----------------------|
| LSP integration | ✅ | ✅ | ✅ | ✅ | ❌ scaffold only | 🎯 JSON-RPC over stdio |
| Autocomplete (LSP) | ✅ | ✅ + AI | ✅ + AI | ✅ | ❌ | 🎯 `textDocument/completion` |
| AI ghost-text complete | ✅ Copilot | ✅ | ✅ | plugin | ❌ | 🎯 FIM via local model |
| Hover docs | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 `textDocument/hover` |
| Go to definition | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 Ctrl+Click |
| Find all references | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 `textDocument/references` |
| Rename symbol | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 F2 |
| Inline error squiggles | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 canvas overlay |
| Problems panel | ✅ | ✅ | ✅ | plugin | ❌ | 🎯 diagnostics list |
| Quick fix / code actions | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 lightbulb menu |
| Signature help | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 `signatureHelp` |
| TypeScript (tsserver) | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 auto-start bundled |
| Python (Pyright) | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 auto-detect pip |
| Rust (rust-analyzer) | ✅ | ✅ | ✅ native | ✅ | ❌ | 🎯 detect from PATH |
| Go (gopls) | ✅ | ✅ | ✅ | ✅ | ❌ | 🎯 detect from PATH |
| HTML / CSS / JSON | ✅ built-in | ✅ | ✅ | plugin | ❌ | 🎯 VS Code servers (MIT) |

---

## 3. AI Features

| Feature | VS Code | Cursor | Windsurf | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|----------|-----|-------------------|----------------------|
| Chat panel | ✅ Copilot | ✅ | ✅ Cascade | ✅ | ✅ full sessions | — |
| Agent / multi-step edits | 🟡 ext | ✅ Agent | ✅ Cascade | 🟡 | ✅ Composer | 🎯 agent mode w/ approval |
| Codebase context (RAG) | ✅ ext | ✅ @codebase | ✅ | ✅ | ✅ BM25 ranked | 🎯 + vector embeddings |
| Streaming responses | ✅ | ✅ | ✅ | ✅ | ✅ SSE | — |
| Rolling summary compression | ❌ | 🟡 | 🟡 | ❌ | ✅ **unique** | — |
| Session history (20 sessions) | ✅ | ✅ | ✅ | 🟡 | ✅ localStorage | — |
| Slash commands | ✅ | ✅ | ✅ | 🟡 | ✅* shipped | 🎯 more commands |
| Diff preview + apply | ✅ | ✅ | ✅ | ✅ | ✅ | 🎯 hunk-by-hunk |
| Multi-file edits | ✅ ext | ✅ | ✅ | 🟡 | ❌ | 🎯 multi-file composer |
| Inline ghost-text autocomplete | ✅ Copilot | ✅ Tab | ✅ | ✅ | ❌ | 🎯 FIM + local model |
| AI commit messages | 🟡 ext | ✅ | 🟡 | ❌ | ❌ | 🎯 `/api/commit-message` |
| AI explain / generate tests | ✅ | ✅ | ✅ | ✅ | 🟡 via slash cmd | 🎯 dedicated endpoints |
| Export session as Markdown | ❌ | ❌ | ❌ | ❌ | ✅ **unique** | — |
| Voice input | ❌ | ❌ | ❌ | ❌ | ❌ | 🎯 Web Speech API |
| Image / screenshot in chat | ✅ | ✅ | ✅ | 🟡 | ❌ | 🎯 paste PNG |
| @filename mention | ✅ | ✅ | ✅ | 🟡 | ❌ | 🎯 |
| Tool use / function calling | 🟡 | ✅ | ✅ | 🟡 | ❌ | 🎯 model calls `/api/*` |
| **Free AI — no CC required** | ❌ Copilot paid | 🟡 limited | 🟡 limited | 🟡 | ✅ Groq + OpenRouter | 🎯 + Gemini + HF |
| **Local model support** | 🟡 ext | ✅ Ollama | ✅ Ollama | ✅ | ✅ Ollama + LM Studio | 🎯 + Jan + llamafile |
| **BYOM — any model** | 🟡 | ✅ | ✅ | ✅ | ✅ | — |
| **Zero account required** | ✅ | ❌ | ❌ | 🟡 | ✅ | — |

---

## 4. Source Control

| Feature | VS Code | Cursor | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----|-------------------|----------------------|
| Git status panel | ✅ | ✅ | ✅ | ✅ | — |
| Stage / unstage / discard | ✅ | ✅ | ✅ | ✅ | — |
| Commit | ✅ | ✅ | ✅ | ✅ | — |
| Push / Pull | ✅ | ✅ | ✅ | ✅ | — |
| Branch switcher + create | ✅ | ✅ | ✅ | ✅ | — |
| Inline diff (color-coded) | ✅ | ✅ | ✅ | ✅ | — |
| Commit log (30 entries) | ✅ | ✅ | 🟡 | ✅ | — |
| Stash / pop | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Merge conflict editor | ✅ | ✅ | ✅ | ❌ | 🎯 per-hunk accept |
| Git blame | ✅ | ✅ | ✅ | ❌ | 🎯 gutter annotations |
| Word-level diff | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Commit graph | ✅ ext | ✅ | 🟡 | ❌ | 🎯 SVG visualization |
| AI commit message | 🟡 | ✅ | ❌ | ❌ | 🎯 `/api/commit-message` |
| `.gitignore` quick-add | ✅ | ✅ | ❌ | ❌ | 🎯 context menu |
| Cherry-pick / tag | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Remote management | ✅ | ✅ | 🟡 | ❌ | 🎯 |

---

## 5. File Explorer

| Feature | VS Code | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|-----|-------------------|----------------------|
| Tree view | ✅ | ✅ | ✅ | — |
| 40+ file type icons | ✅ ext | ✅ | ✅ built-in | — |
| Right-click context menu | ✅ | ✅ | ✅ | — |
| New file / folder | ✅ | ✅ | ✅ | — |
| Rename / Delete | ✅ | ✅ | ✅ | — |
| Filter bar | ✅ | ✅ | ✅ | — |
| Drag-and-drop move | ✅ | ✅ | ❌ | 🎯 |
| Inline rename (double-click) | ✅ | ✅ | ❌ | 🎯 |
| Show/hide dotfiles | ✅ | ✅ | ❌ | 🎯 toggle |
| Hide `node_modules` | ✅ | ✅ | ❌ | 🎯 toggle |
| Dirty dot on tree items | ✅ | ✅ | ❌ | 🎯 |
| Multi-select + bulk ops | ✅ | ✅ | ❌ | 🎯 Ctrl+Click |

---

## 6. Search

| Feature | VS Code | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|-----|-------------------|----------------------|
| Workspace text search | ✅ ripgrep | ✅ | ✅ pure Node | 🎯 optional ripgrep |
| Regex / case / whole word | ✅ | ✅ | ✅ | — |
| Include / exclude globs | ✅ | ✅ | ✅ | — |
| Replace in files | ✅ | ✅ | ✅ client-side | 🎯 server-side |
| F3 match navigation | ✅ | ✅ | ✅ | — |
| Collapse / expand results | ✅ | ✅ | ✅ | — |
| In-file find (Ctrl+F) | ✅ | ✅ | ✅* shipped | — |
| In-file replace (Ctrl+H) | ✅ | ✅ | ✅* shipped | — |
| Symbol search | ✅ | ✅ | ❌ | 🎯 AST-aware |
| Search history | ✅ | ✅ | ❌ | 🎯 last 10 queries |
| Structural search | 🟡 ext | ❌ | ❌ | 🎯 |

---

## 7. Terminal

| Feature | VS Code | Zed | Neovim | **Clarity — now** | **Clarity — planned** |
|---------|---------|-----|--------|-------------------|----------------------|
| Integrated terminal | ✅ | ✅ | ✅ native | ❌ | 🎯 xterm.js + node-pty |
| Multiple terminal tabs | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Shell detection | ✅ | ✅ | ✅ | ❌ | 🎯 bash/zsh/fish/pwsh |
| AI command suggestions | ✅ ext | 🟡 | ❌ | ❌ | 🎯 right-click → explain |
| Split terminal panes | ✅ | ✅ | ✅ | ❌ | 🎯 horizontal split |
| Click file paths to open | ✅ | ✅ | ❌ | ❌ | 🎯 |

---

## 8. UI / UX

| Feature | VS Code | Cursor | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----|-------------------|----------------------|
| Command palette | ✅ | ✅ | ✅ | ✅ | — |
| Resizable panels | ✅ | ✅ | ✅ | ✅ | — |
| Status bar | ✅ | ✅ | ✅ | ✅ | — |
| Notification toasts | ✅ | ✅ | ✅ | ✅ | — |
| Welcome / start screen | ✅ | ✅ | ✅ | ✅* shipped | — |
| Settings UI + search | ✅ | ✅ | ✅ | ✅* shipped | — |
| Custom accent color | ❌ | ❌ | ❌ | ✅ **unique** | — |
| Slash command autocomplete | ✅ | ✅ | 🟡 | ✅* shipped | — |
| Export session as Markdown | ❌ | ❌ | ❌ | ✅ **unique** | — |
| Themes (dark variants) | ✅ 1000s | ✅ | ✅ | ✅ 3 dark + accent | — |
| Light theme | ✅ | ✅ | ✅ | ❌ | 🎯 CSS var swap |
| High-contrast a11y theme | ✅ | ✅ | 🟡 | ❌ | 🎯 WCAG AA |
| System color-scheme detect | ✅ | ✅ | ✅ | ❌ | 🎯 `prefers-color-scheme` |
| Breadcrumb nav | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Zen mode | ✅ | ✅ | ✅ | ❌ | 🎯 Ctrl+Shift+Z |
| Keyboard shortcut editor | ✅ | ✅ | ✅ | ❌ | 🎯 |
| Plugin / extension system | ✅ massive | ✅ VS Code | ✅ growing | ❌ | 🎯 ES module plugins |
| Mobile / tablet support | ❌ | ❌ | ❌ | ❌ | 🎯 responsive layout |
| CRT scanlines effect | ❌ | ❌ | ❌ | ✅ **unique** | — |

---

## 9. Desktop App

| Feature | VS Code | Cursor | Zed | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----|-------------------|----------------------|
| Desktop shell | ✅ Electron | ✅ Electron | ✅ native Rust | ✅* Tauri v2 scaffolded | 🎯 full bundle |
| Native menu bar | ✅ | ✅ | ✅ | ❌ | 🎯 OS native menu |
| System tray | ✅ | ✅ | ❌ | ❌ | 🎯 |
| Auto-update | ✅ | ✅ | ✅ | ❌ | 🎯 GitHub releases |
| macOS `.dmg` | ✅ | ✅ | ✅ | ❌ | 🎯 Tauri bundle |
| Linux `.AppImage` / `.deb` | ✅ | ✅ | ✅ | ❌ | 🎯 Tauri bundle |
| Windows `.msi` | ✅ | ✅ | ✅ | ❌ | 🎯 Tauri bundle |
| Bundle Node runtime | N/A | N/A | N/A | ❌ | 🎯 |
| Bundle Ollama (opt-in) | ❌ | ❌ | ❌ | ❌ | 🎯 one-click AI |
| Open-source desktop shell | ❌ Electron closed | ❌ | ✅ | ✅ Tauri MIT | — |
| Memory footprint | ❌ heavy | ❌ heavy | ✅ ~100MB | ✅ ~50MB | — |

---

## 10. Distribution & Access

| Feature | VS Code | Cursor | Codespaces | **Clarity — now** | **Clarity — planned** |
|---------|---------|--------|-----------|-------------------|----------------------|
| Works in browser | 🟡 vscode.dev | ❌ | ✅ | ✅ any browser | — |
| Zero install (browser) | ❌ | ❌ | ❌ | ✅ **unique** | — |
| Self-hosted | 🟡 code-server | ❌ | ❌ | ✅ **unique** | — |
| No account required | ✅ | ❌ | ❌ | ✅ **unique** | — |
| No payment ever | ✅ | ❌ | ❌ | ✅ **unique** | — |
| Fully open source (MIT) | ✅ | ❌ | ❌ | ✅ **unique** | — |
| Docker image | 🟡 | ❌ | N/A | ❌ | 🎯 `ghcr.io/clarity-ide/clarity` |
| `npx` zero-install launch | ❌ | ❌ | ❌ | ❌ | 🎯 |
| Homebrew / AUR / Flatpak | ✅ | ❌ | ❌ | ❌ | 🎯 all three |
| No cloud dependency | 🟡 | ❌ | ❌ | ✅ | — |

---

## 11. Privacy & Security

| Feature | VS Code | Cursor | Windsurf | **Clarity** |
|---------|---------|--------|----------|-------------|
| Zero telemetry possible | 🟡 opt-out | ❌ | ❌ | ✅ off by default |
| API keys stay local | ✅ | 🟡 | 🟡 | ✅ `.clarity-settings.json` only |
| No data sent to vendor servers | 🟡 | ❌ | ❌ | ✅ with local models |
| Works fully offline | 🟡 | ❌ | ❌ | ✅ Ollama / LM Studio |
| Open source (audit the code) | ✅ | ❌ | ❌ | ✅ MIT |
| Path traversal guards | N/A | N/A | N/A | ✅ all `/api/file/*` |
| CSP headers | ✅ | ✅ | ✅ | 🎯 planned |

---

## Priority Gap Analysis

### 🔴 P0 — Must ship for daily-driver usability

| Feature | Why | Estimate |
|---------|-----|----------|
| **Integrated terminal** (xterm.js + node-pty) | #1 pain point; devs alt-tab constantly | ~1 week |
| **Inline AI ghost-text** (`/api/autocomplete` + FIM) | Defining feature of modern AI IDEs | ~3 days |
| **LSP basics** (tsserver auto-start) | Go-to-def + hover + squiggles for TS/JS | ~1–2 weeks |
| **Light theme** | Half of all developers use light themes | ~1 day |
| **Tree-sitter WASM highlighting** | highlight.js has gaps; Tree-sitter is the standard | ~3 days |

### 🟡 P1 — Should ship in v0.2

| Feature | Why | Estimate |
|---------|-----|----------|
| **Multiple cursors** (Ctrl+D / Alt+Click) | Power user; massive productivity gain | ~3 days |
| **Code folding** | Navigate large files | ~2 days |
| **Split editor panes** (Ctrl+\\) | Essential for diff + test side-by-side | ~3 days |
| **Merge conflict editor** | Git panel incomplete without it | ~2 days |
| **Git blame** (gutter) | Most-used git feature after status | ~1 day |
| **Stash / pop stash** | Daily workflow for context-switching | ~1 day |
| **Multi-file composer** | Matches Cursor/Windsurf agent capability | ~1 week |
| **@filename mention in chat** | File context injection by reference | ~2 days |
| **Diff blocks in chat** (apply button) | Close the loop: model edits → apply in one click | ~2 days |
| **Vector embedding context** (Ollama embed) | Semantic retrieval beats BM25 for large codebases | ~1 week |
| **AI commit message** | Extremely high utility, trivially implemented | ~0.5 days |

### 🟢 P2 — Nice to have (v0.3+)

| Feature | Notes |
|---------|-------|
| Plugin / extension API | Needs stable surface first |
| Vim keybindings | Niche but vocal segment |
| Commit graph SVG | Nice visual; low utility delta |
| Real-time collaboration | Major infra; post-v1 |
| Mobile responsive layout | Very hard for an IDE |
| Voice input | Experimental; Web Speech API available free |
| PR integration | Requires GitHub OAuth token (optional, no account gate) |

---

## Clarity Unique Advantages — Double Down On These

| Advantage | Status | Why it matters |
|-----------|--------|---------------|
| **Zero accounts, zero payment, forever** | ✅ core promise | No Cursor/Windsurf can match this without breaking their business model |
| **Fully self-hosted** | ✅ | Full data sovereignty; GDPR-compliant by design |
| **Works offline** (local models) | ✅ Ollama + LM Studio | Airplane mode, air-gapped networks, no internet dependency |
| **Free AI out of the box** | ✅ Groq + OpenRouter free tier | No credit card, no trial timer — just a free API key |
| **Zero-install browser mode** | ✅ `node server.mjs` | Sub-30-second setup; works in Chromebook, any browser |
| **MIT licensed** | ✅ (LICENSE pending) | Can fork, modify, redistribute — fully open |
| **BM25 + vector context RAG** | 🟡 BM25 now | Intelligent context beats naive "send whole file" approach |
| **Rolling summary compression** | ✅ unique | Extends effective context window without hitting token limits |
| **Export session as Markdown** | ✅ unique | No competing IDE offers this |
| **Custom accent color** | ✅ unique | Small but memorable personalisation |
| **Single-file server (no deps)** | ✅ | `node server.mjs` — zero npm install for runtime |
| **Tauri desktop (not Electron)** | ✅ scaffolded | 50MB vs 300MB; no Chromium bloat |

---

## v0.2 Milestone Definition

Ship these to be **genuinely competitive with Cursor/Windsurf for TypeScript/JavaScript** while keeping every advantage unique to Clarity:

1. ✅ In-file find & replace (shipped)
2. ✅ Slash commands (shipped)
3. ✅ Export session as Markdown (shipped)
4. ✅ OpenRouter provider — 6 free models, no CC (shipped)
5. ✅ Welcome screen (shipped)
6. ✅ Settings search bar (shipped)
7. ✅ Tauri v2 desktop scaffold (shipped)
8. 🎯 Integrated terminal (xterm.js + node-pty) — **next**
9. 🎯 Inline AI ghost-text autocomplete
10. 🎯 LSP: tsserver auto-start + hover + squiggles
11. 🎯 Light theme
12. 🎯 Multiple cursors (Ctrl+D)
13. 🎯 Split editor panes
14. 🎯 AI commit message from staged diff
15. 🎯 Merge conflict editor
