declare const lucide: any;
declare const hljs: any;

type AgentViewId = "chat" | "composer" | "context" | "models";

// ── API types ─────────────────────────────────────────────────────────────────
interface ApiFile { path: string; name: string; lang: string; size: number; modifiedMs: number; }
interface ApiModel { id: string; provider: string; displayName: string; }
interface ProviderHealth { ok: boolean; reason?: string; }
interface ContextChunk {
  rank: number; filePath: string; startLine: number; endLine: number;
  tokens: number; score: number; lang: string; preview: string; content: string;
}

// ── Settings schema ───────────────────────────────────────────────────────────
interface Settings {
  groqApiKey: string;
  openrouterApiKey: string;
  theme: string;
  accent: string;
  fontSize: number;
  fontFamily: string;
  scanlines: boolean;
  sidebarWidth: number;
  agentWidth: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  syntaxHl: boolean;
  autoSave: boolean;
  systemPrompt: string;
  ctxTokens: number;
  ctxChunks: number;
  streaming: boolean;
  injectFile: boolean;
  bm25Weight: number;
  chunkTokens: number;
  maxFiles: number;
  chunksPerFile: number;
  lmstudioUrl: string;
  ollamaUrl: string;
  healthInterval: number;
  reqTimeout: number;
  telemetry: boolean;
  logLevel: string;
  vectorCtx: boolean;
  lspDiag: boolean;
  multifile: boolean;
  advancedMode: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  groqApiKey: "", openrouterApiKey: "",
  theme: "dark", accent: "#3b82f6", fontSize: 13, fontFamily: "'Geist Mono', monospace",
  scanlines: true, sidebarWidth: 260, agentWidth: 400,
  tabSize: 4, wordWrap: false, lineNumbers: true, syntaxHl: true, autoSave: true,
  systemPrompt: "You are an expert coding assistant in Clarity IDE. Be concise. Use triple-backtick fences for code.",
  ctxTokens: 2000, ctxChunks: 8, streaming: true, injectFile: true,
  bm25Weight: 0.3, chunkTokens: 180, maxFiles: 60, chunksPerFile: 3,
  lmstudioUrl: "http://127.0.0.1:1234/v1", ollamaUrl: "http://127.0.0.1:11434",
  healthInterval: 8, reqTimeout: 3, telemetry: false, logLevel: "warn",
  vectorCtx: false, lspDiag: false, multifile: false, advancedMode: false,
};

// ── Session / History types ───────────────────────────────────────────────────
interface ChatMessage { role: string; content: string; ts?: number; }
interface ChatSession {
  id: string;
  title: string;
  createdMs: number;
  updatedMs: number;
  messages: ChatMessage[];
  summaryBlock?: string;   // rolling summary of compressed history
}

// ── Context rank result ───────────────────────────────────────────────────────
interface ContextRankResult {
  totalTokens: number;
  budgetTokens: number;
  chunks: ContextChunk[];
}

// ── App State ─────────────────────────────────────────────────────────────────
const API = "";
let settings: Settings = { ...DEFAULT_SETTINGS };
let activeFilePath = "";
let activeLang = "text";
let selectedModel: ApiModel | null = null;
let allModels: ApiModel[] = [];

// Session management
let sessions: ChatSession[] = [];
let activeSessionId = "";
let chatHistory: ChatMessage[] = [];   // live messages for current session

let chatAbort: AbortController | null = null;
let composerAbort: AbortController | null = null;

// Chat attachments (AI Vision, file context, selection)
interface ChatAttachment {
  type: "file" | "vision" | "selection";
  content: string;
  label: string;
}
let activeAttachments: ChatAttachment[] = [];

function getAttachmentsContext(): string {
  if (activeAttachments.length === 0) return "";
  return activeAttachments.map(att => {
    if (att.type === "file") return `Current file (${att.label}):\n\`\`\`\n${att.content}\n\`\`\``;
    if (att.type === "vision") return `Current editor view:\n\`\`\`\n${att.content}\n\`\`\``;
    if (att.type === "selection") return `Selected code (${att.label}):\n\`\`\`\n${att.content}\n\`\`\``;
    return "";
  }).join("\n\n");
}

function clearAttachments(): void {
  activeAttachments = [];
  const container = $("chat-attachments");
  if (container) container.style.display = "none";
  const fileChip = $("chat-attach-file-chip");
  const visionChip = $("chat-attach-vision-chip");
  const selectionChip = $("chat-attach-selection-chip");
  const badge = $("chat-context-badge");
  if (fileChip) fileChip.style.display = "none";
  if (visionChip) visionChip.style.display = "none";
  if (selectionChip) selectionChip.style.display = "none";
  if (badge) badge.style.display = "none";
}
let composerPatchText = "";
let consoleErrors: string[] = [];
let allFiles: ApiFile[] = [];
let explorerFilter = "";
let healthTimer = 0;

// Auto-ranked context chunks for current file
let lastRankedChunks: ContextChunk[] = [];
let lastRankedTokens = 0;
let ctxAutoAbort: AbortController | null = null;

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(v: string): string {
  const m: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return v.replace(/[&<>"']/g, c => m[c] ?? c);
}
function ri(): void { if (typeof lucide !== "undefined") lucide.createIcons(); }
function $(id: string): HTMLElement | null { return document.getElementById(id); }
function $el<T extends HTMLElement>(id: string): T | null { return document.getElementById(id) as T | null; }

// ── File type icons (inline SVG) ──────────────────────────────────────────────
interface FileIcon { svg: string; color: string; }

const FILE_ICONS: Record<string, FileIcon> = {
  // TypeScript
  ts:   { color: "#3178c6", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#3178c6"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="white">TS</text></svg>` },
  tsx:  { color: "#3178c6", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1e3a5f"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#7dd3fc">TSX</text></svg>` },
  // JavaScript
  js:   { color: "#f7df1e", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#f7df1e"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#333">JS</text></svg>` },
  jsx:  { color: "#f0a500", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d2d00"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#f7df1e">JSX</text></svg>` },
  mjs:  { color: "#f7df1e", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d2d00"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#f7df1e">MJS</text></svg>` },
  // Python
  py:   { color: "#3572a5", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#3572a5"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#ffd43b">PY</text></svg>` },
  // Rust
  rs:   { color: "#dea584", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d1b00"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#dea584">RS</text></svg>` },
  // Go
  go:   { color: "#00add8", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#003a4d"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#00add8">GO</text></svg>` },
  // CSS
  css:  { color: "#663399", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1a0033"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#bf87ff">CSS</text></svg>` },
  scss: { color: "#c6538c", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d0016"/><text x="0" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#c6538c">SCSS</text></svg>` },
  // HTML
  html: { color: "#e34c26", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#3d0e00"/><text x="0" y="17" font-family="monospace" font-size="8" font-weight="bold" fill="#e34c26">HTML</text></svg>` },
  // JSON
  json: { color: "#cbcb41", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1e1e00"/><text x="1" y="17" font-family="monospace" font-size="8.5" font-weight="bold" fill="#cbcb41">JSON</text></svg>` },
  // Markdown
  md:   { color: "#519aba", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#001f2d"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#519aba">MD</text></svg>` },
  // YAML/TOML
  yaml: { color: "#cb171e", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d0000"/><text x="0" y="17" font-family="monospace" font-size="8.5" font-weight="bold" fill="#cb171e">YAML</text></svg>` },
  yml:  { color: "#cb171e", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d0000"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#cb171e">YML</text></svg>` },
  toml: { color: "#9c4221", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#2d1000"/><text x="0" y="17" font-family="monospace" font-size="8.5" font-weight="bold" fill="#fb923c">TOML</text></svg>` },
  // Shell
  sh:   { color: "#4eaa25", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#001a00"/><text x="3" y="17" font-family="monospace" font-size="11" font-weight="bold" fill="#4eaa25">SH</text></svg>` },
  // Lock
  lock: { color: "#bbbbbb", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#111"/><text x="1" y="17" font-family="monospace" font-size="8" font-weight="bold" fill="#888">LOCK</text></svg>` },
  // Config
  env:  { color: "#ecc94b", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1a1500"/><text x="1" y="17" font-family="monospace" font-size="9" font-weight="bold" fill="#ecc94b">ENV</text></svg>` },
  // Ignore
  gitignore: { color: "#f14e32", svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1a0000"/><text x="0" y="13" font-family="monospace" font-size="7" font-weight="bold" fill="#f14e32">.GIT</text><text x="0" y="21" font-family="monospace" font-size="7" font-weight="bold" fill="#888">IGN</text></svg>` },
};

const DEFAULT_ICON: FileIcon = {
  color: "#555577",
  svg: `<svg viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="3" fill="#1a1a2e"/><path d="M7 6h6l4 4v8H7V6z" stroke="#555577" stroke-width="1.5" fill="none"/></svg>`,
};

function fileIconFor(name: string): FileIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const fullName = name.toLowerCase();
  // Special full-name matches
  if (fullName === ".gitignore" || fullName === ".gitattributes") return FILE_ICONS.gitignore;
  if (fullName === ".env" || fullName.startsWith(".env.")) return FILE_ICONS.env;
  if (fullName === "package.json" || fullName === "package-lock.json") return { ...FILE_ICONS.json, color: "#cc3534" };
  if (fullName === "tsconfig.json") return { ...FILE_ICONS.json, color: "#3178c6" };
  return FILE_ICONS[ext] ?? DEFAULT_ICON;
}

function langColor(lang: string): string {
  const m: Record<string, string> = {
    typescript: "#3178c6", javascript: "#f7df1e", python: "#3572a5",
    rust: "#dea584", go: "#00add8", markdown: "#558b7a", json: "#cbcb41",
    css: "#563d7c", html: "#e34c26", bash: "#4eaa25", toml: "#9c4221", yaml: "#cb171e",
  };
  return m[lang] ?? "#555577";
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}K`;
  return `${(b / 1048576).toFixed(1)}M`;
}

function hl(code: string, lang: string): string {
  if (settings.syntaxHl && typeof hljs !== "undefined") {
    try { return hljs.highlight(code, { language: lang }).value; } catch { /**/ }
    try { return hljs.highlightAuto(code).value; } catch { /**/ }
  }
  return esc(code);
}

// ── SSE stream consumer ───────────────────────────────────────────────────────
async function consumeSSE(
  url: string, body: unknown, onDelta: (d: string) => void, signal: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data: ")) continue;
      const data = t.slice(6);
      if (data === "[DONE]") return;
      let p: { delta?: string; error?: string } | null = null;
      try { p = JSON.parse(data) as { delta?: string; error?: string }; } catch { continue; }
      if (p?.error) throw new Error(p.error);
      if (p?.delta) onDelta(p.delta);
    }
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings(): void {
  try {
    const raw = localStorage.getItem("clarity:settings");
    if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* */ }
}

function saveSettings(): void {
  localStorage.setItem("clarity:settings", JSON.stringify(settings));
  applySettings();
}

function applySettings(): void {
  const r = document.documentElement.style;
  r.setProperty("--accent", settings.accent);
  r.setProperty("--accent-glow", settings.accent + "40");
  r.setProperty("--accent-dim", settings.accent + "1a");
  r.setProperty("--accent-border", settings.accent + "4d");
  r.setProperty("--editor-size", settings.fontSize + "px");
  r.setProperty("--left-pane", settings.sidebarWidth + "px");
  r.setProperty("--right-pane", settings.agentWidth + "px");
  document.documentElement.setAttribute("data-theme", settings.theme || "dark");
  document.body.classList.toggle("no-scanlines", !settings.scanlines);
  document.body.classList.toggle("advanced-mode", settings.advancedMode);

  const ta = $el<HTMLTextAreaElement>("editor-content");
  const hi = $el<HTMLPreElement>("editor-highlight");
  const codeEl = hi?.querySelector("code");

  if (ta) {
    ta.style.fontFamily = settings.fontFamily;
    ta.style.whiteSpace = settings.wordWrap ? "pre-wrap" : "pre";
    ta.style.tabSize = String(settings.tabSize);
  }
  if (hi) {
    hi.style.fontFamily = settings.fontFamily;
    hi.style.whiteSpace = settings.wordWrap ? "pre-wrap" : "pre";
    hi.style.tabSize = String(settings.tabSize);
  }
  if (codeEl) {
    codeEl.style.tabSize = String(settings.tabSize);
  }

  const ln = $("line-numbers");
  if (ln) ln.style.display = settings.lineNumbers ? "block" : "none";

  // Re-sync highlight to apply font changes
  syncHighlight();
}

function syncSettingsUI(): void {
  const set = <T extends HTMLElement>(id: string, fn: (el: T) => void) => {
    const el = $el<T>(id); if (el) fn(el);
  };
  set<HTMLSelectElement>("s-theme",           el => el.value = settings.theme);
  set<HTMLInputElement>("s-font-size",        el => el.value = String(settings.fontSize));
  set<HTMLSelectElement>("s-font-family",     el => el.value = settings.fontFamily);
  set<HTMLInputElement>("s-scanlines",        el => el.checked = settings.scanlines);
  set<HTMLInputElement>("s-sidebar-width",    el => el.value = String(settings.sidebarWidth));
  set<HTMLInputElement>("s-agent-width",      el => el.value = String(settings.agentWidth));
  set<HTMLSelectElement>("s-tab-size",        el => el.value = String(settings.tabSize));
  set<HTMLInputElement>("s-word-wrap",        el => el.checked = settings.wordWrap);
  set<HTMLInputElement>("s-line-numbers",     el => el.checked = settings.lineNumbers);
  set<HTMLInputElement>("s-syntax-hl",        el => el.checked = settings.syntaxHl);
  set<HTMLInputElement>("s-auto-save",        el => el.checked = settings.autoSave);
  set<HTMLTextAreaElement>("s-system-prompt", el => el.value = settings.systemPrompt);
  set<HTMLInputElement>("s-ctx-tokens",       el => el.value = String(settings.ctxTokens));
  set<HTMLInputElement>("s-ctx-chunks",       el => el.value = String(settings.ctxChunks));
  set<HTMLInputElement>("s-streaming",        el => el.checked = settings.streaming);
  set<HTMLInputElement>("s-inject-file",      el => el.checked = settings.injectFile);
  set<HTMLInputElement>("s-bm25-weight",      el => el.value = String(settings.bm25Weight));
  set<HTMLInputElement>("s-chunk-tokens",     el => el.value = String(settings.chunkTokens));
  set<HTMLInputElement>("s-max-files",        el => el.value = String(settings.maxFiles));
  set<HTMLInputElement>("s-chunks-per-file",  el => el.value = String(settings.chunksPerFile));
  set<HTMLInputElement>("s-lmstudio-url",     el => el.value = settings.lmstudioUrl);
  set<HTMLInputElement>("s-ollama-url",       el => el.value = settings.ollamaUrl);
  set<HTMLInputElement>("s-health-interval",  el => el.value = String(settings.healthInterval));
  set<HTMLInputElement>("s-req-timeout",      el => el.value = String(settings.reqTimeout));
  set<HTMLInputElement>("s-telemetry",        el => el.checked = settings.telemetry);
  set<HTMLSelectElement>("s-log-level",       el => el.value = settings.logLevel);
  set<HTMLInputElement>("s-vector-ctx",       el => el.checked = settings.vectorCtx);
  set<HTMLInputElement>("s-lsp-diag",         el => el.checked = settings.lspDiag);
  set<HTMLInputElement>("s-multifile",        el => el.checked = settings.multifile);
  set<HTMLInputElement>("s-groq-api-key",         el => el.value = settings.groqApiKey);
  set<HTMLInputElement>("s-openrouter-api-key",  el => el.value = settings.openrouterApiKey);
  // accent swatches
  document.querySelectorAll<HTMLElement>(".color-swatch").forEach(sw => {
    sw.classList.toggle("active", sw.dataset.color === settings.accent);
  });
  // mode toggle
  $("mode-basic")?.classList.toggle("active", !settings.advancedMode);
  $("mode-advanced")?.classList.toggle("active", settings.advancedMode);
}

function readSettingsUI(): void {
  const str = (id: string) => ($el<HTMLInputElement>(id))?.value ?? "";
  const num = (id: string) => Number(str(id));
  const chk = (id: string) => ($el<HTMLInputElement>(id))?.checked ?? false;
  settings.theme         = ($el<HTMLSelectElement>("s-theme"))?.value ?? settings.theme;
  settings.fontSize      = num("s-font-size") || settings.fontSize;
  settings.fontFamily    = ($el<HTMLSelectElement>("s-font-family"))?.value ?? settings.fontFamily;
  settings.scanlines     = chk("s-scanlines");
  settings.sidebarWidth  = num("s-sidebar-width") || settings.sidebarWidth;
  settings.agentWidth    = num("s-agent-width") || settings.agentWidth;
  settings.tabSize       = num("s-tab-size") || 4;
  settings.wordWrap      = chk("s-word-wrap");
  settings.lineNumbers   = chk("s-line-numbers");
  settings.syntaxHl      = chk("s-syntax-hl");
  settings.autoSave      = chk("s-auto-save");
  settings.systemPrompt  = ($el<HTMLTextAreaElement>("s-system-prompt"))?.value ?? settings.systemPrompt;
  settings.ctxTokens     = num("s-ctx-tokens") || 2000;
  settings.ctxChunks     = num("s-ctx-chunks") || 8;
  settings.streaming     = chk("s-streaming");
  settings.injectFile    = chk("s-inject-file");
  settings.bm25Weight    = num("s-bm25-weight");
  settings.chunkTokens   = num("s-chunk-tokens") || 180;
  settings.maxFiles      = num("s-max-files") || 60;
  settings.chunksPerFile = num("s-chunks-per-file") || 3;
  settings.lmstudioUrl   = str("s-lmstudio-url");
  settings.ollamaUrl     = str("s-ollama-url");
  settings.healthInterval= num("s-health-interval") || 8;
  settings.reqTimeout    = num("s-req-timeout") || 3;
  settings.telemetry     = chk("s-telemetry");
  settings.logLevel      = ($el<HTMLSelectElement>("s-log-level"))?.value ?? settings.logLevel;
  settings.vectorCtx     = chk("s-vector-ctx");
  settings.lspDiag       = chk("s-lsp-diag");
  settings.multifile     = chk("s-multifile");
  settings.groqApiKey        = str("s-groq-api-key");
  settings.openrouterApiKey  = str("s-openrouter-api-key");
}

function initSettings(): void {
  // Open / close
  const openSettings = () => {
    const ov = $("settings-overlay"); if (ov) { ov.classList.add("open"); syncSettingsUI(); ri(); }
  };
  const closeSettings = () => $("settings-overlay")?.classList.remove("open");

  $("btn-settings")?.addEventListener("click", openSettings);
  $("ab-settings")?.addEventListener("click", openSettings);
  $("settings-close")?.addEventListener("click", closeSettings);
  $("settings-overlay")?.addEventListener("click", e => { if (e.target === $("settings-overlay")) closeSettings(); });

  // Mode toggle
  $("mode-basic")?.addEventListener("click", () => {
    settings.advancedMode = false; document.body.classList.remove("advanced-mode");
    $("mode-basic")?.classList.add("active"); $("mode-advanced")?.classList.remove("active");
  });
  $("mode-advanced")?.addEventListener("click", () => {
    settings.advancedMode = true; document.body.classList.add("advanced-mode");
    $("mode-advanced")?.classList.add("active"); $("mode-basic")?.classList.remove("active");
  });

  // Nav
  document.querySelectorAll<HTMLButtonElement>(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav-item").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".settings-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      $("sec-" + btn.dataset.section)?.classList.add("active");
    });
  });

  // Accent swatches
  document.querySelectorAll<HTMLElement>(".color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      settings.accent = sw.dataset.color ?? settings.accent;
      document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
      sw.classList.add("active");
      applySettings();
    });
  });

  // Live settings - apply immediately on change
  const liveInputs = [
    "s-word-wrap", "s-line-numbers", "s-auto-save", "s-tab-size",
    "s-font-size", "s-font-family", "s-theme", "s-scanlines", "s-syntax-hl"
  ];
  liveInputs.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      readSettingsUI();
      applySettings();
      saveSettings();
    });
  });

  // Save / Reset
  $("settings-save")?.addEventListener("click", () => { readSettingsUI(); saveSettings(); closeSettings(); });
  $("settings-reset")?.addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS };
    syncSettingsUI(); saveSettings(); applySettings();
  });
}

// ── View switching ────────────────────────────────────────────────────────────
function switchView(target: AgentViewId): void {
  document.querySelectorAll<HTMLButtonElement>(".agent-tab").forEach(t =>
    t.classList.toggle("active", t.dataset.agentView === target));
  document.querySelectorAll<HTMLElement>(".agent-view").forEach(v =>
    v.classList.toggle("active", v.id === target));
}

// ── Activity bar ──────────────────────────────────────────────────────────────
const SIDE_PANELS: Record<string, string> = {
  explorer: "explorer-panel",
  search:   "search-panel",
  git:      "git-panel",
};

function switchSidePanel(panel: string): void {
  Object.values(SIDE_PANELS).forEach(id => {
    const el = $(id); if (el) el.style.display = "none";
  });
  document.querySelectorAll(".activity-btn").forEach(b => b.classList.remove("active"));
  const target = SIDE_PANELS[panel];
  if (target) {
    const el = $(target);
    if (el) el.style.display = "flex";
  }
  document.querySelector<HTMLElement>(`.activity-btn[data-panel="${panel}"]`)?.classList.add("active");
}

function initActivityBar(): void {
  document.querySelectorAll<HTMLButtonElement>(".activity-btn[data-panel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel ?? "";
      if (panel === "settings-btn") { $("settings-overlay")?.classList.add("open"); syncSettingsUI(); ri(); return; }
      switchSidePanel(panel);
      if (panel === "git") loadGitStatus();
      if (panel === "search") $el<HTMLInputElement>("search-query")?.focus();
    });
  });
}

// ── Folder tree ───────────────────────────────────────────────────────────────
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
  file?: ApiFile;
}

function buildTree(files: ApiFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          isDir: !isLast,
          children: new Map(),
          file: isLast ? f : undefined,
        });
      }
      const child = node.children.get(part)!;
      if (!isLast) child.isDir = true;
      node = child;
    }
  }
  return root;
}

// Track which dirs are open (persisted in sessionStorage)
const openDirs = new Set<string>(JSON.parse(sessionStorage.getItem("clarity:openDirs") ?? "[]") as string[]);

function saveOpenDirs(): void {
  sessionStorage.setItem("clarity:openDirs", JSON.stringify([...openDirs]));
}

function renderTree(node: TreeNode, depth: number, filter: string): string {
  const indent = `tree-indent-${Math.min(depth, 5)}`;
  const parts: string[] = [];
  void indent; // indent is used on rows directly via depth param

  // Sort: dirs first, then files, both alpha
  const entries = [...node.children.values()].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of entries) {
    if (filter) {
      // In filter mode: show only matching files (flat, no folders)
      if (!child.isDir) {
        if (child.path.toLowerCase().includes(filter) || child.name.toLowerCase().includes(filter)) {
          parts.push(renderFileRow(child, depth, filter));
        }
      } else {
        // recurse into dirs
        parts.push(renderTree(child, depth, filter));
      }
      continue;
    }

    if (child.isDir) {
      const isOpen = openDirs.has(child.path);
      const depthClass = `tree-indent-${Math.min(depth, 5)}`;
      parts.push(`
        <div class="tree-dir ${isOpen ? "open" : ""} ${depthClass}" data-dir="${esc(child.path)}">
          <i data-lucide="chevron-right" class="tree-dir-chevron"></i>
          <i data-lucide="${isOpen ? "folder-open" : "folder"}" class="tree-dir-icon"></i>
          <span class="tree-dir-name">${esc(child.name)}</span>
        </div>
        <div class="tree-children">${isOpen ? renderTree(child, depth + 1, "") : ""}</div>
      `);
    } else {
      parts.push(renderFileRow(child, depth, ""));
    }
  }
  return parts.join("");
}

function countFiles(node: TreeNode): number {
  let n = 0;
  for (const c of node.children.values()) {
    n += c.isDir ? countFiles(c) : 1;
  }
  return n;
}

function renderFileRow(node: TreeNode, depth: number, _filter: string): string {
  const indent = `tree-indent-${Math.min(depth, 5)}`;
  const icon = fileIconFor(node.name);
  const isActive = node.path === activeFilePath;
  return `<div class="tree-file ${indent}${isActive ? " active" : ""}" data-file="${esc(node.path)}" title="${esc(node.path)}">
    <span class="tree-file-icon">${icon.svg}</span>
    <span class="file-label">${esc(node.name)}</span>
  </div>`;
}

let treeRoot: TreeNode | null = null;

function renderFileTree(): void {
  const container = $("file-tree");
  if (!container) return;
  if (!treeRoot) { container.innerHTML = `<div class="tree-empty">No files loaded.</div>`; return; }

  const filtered = explorerFilter
    ? allFiles.filter(f => f.path.toLowerCase().includes(explorerFilter) || f.name.toLowerCase().includes(explorerFilter))
    : null;

  const countEl = $("explorer-count");
  if (countEl) countEl.textContent = filtered ? `${filtered.length} matches` : `${allFiles.length} files`;

  if (filtered && filtered.length === 0) {
    container.innerHTML = `<div class="tree-empty">No files match "${esc(explorerFilter)}"</div>`; return;
  }

  const rootToRender = filtered ? buildTree(filtered) : treeRoot;
  container.innerHTML = renderTree(rootToRender, 0, explorerFilter);

  // Wire folder click
  container.querySelectorAll<HTMLElement>(".tree-dir").forEach(dir => {
    dir.addEventListener("click", () => {
      const dirPath = dir.dataset.dir ?? "";
      const isOpen = openDirs.has(dirPath);
      if (isOpen) openDirs.delete(dirPath); else openDirs.add(dirPath);
      saveOpenDirs();
      renderFileTree(); // re-render
      ri();
    });
  });

  // Wire file click
  container.querySelectorAll<HTMLElement>(".tree-file").forEach(f => {
    f.addEventListener("click", () => openFile(f.dataset.file ?? ""));
  });

  // Keep agent sidebar tree in sync
  renderAgentFileTree();

  ri();
}

// ── Agent sidebar file tree (mirrors left explorer) ───────────────────────────
let agentFileFilter = "";

function renderAgentFileTree(): void {
  const container = $("agent-file-tree");
  if (!container) return;
  if (!treeRoot) { container.innerHTML = `<div class="tree-empty">No files loaded.</div>`; return; }

  const filter = agentFileFilter;
  const filtered = filter
    ? allFiles.filter(f => f.path.toLowerCase().includes(filter) || f.name.toLowerCase().includes(filter))
    : null;

  if (filtered && filtered.length === 0) {
    container.innerHTML = `<div class="tree-empty">No files match "${esc(filter)}"</div>`; return;
  }

  const rootToRender = filtered ? buildTree(filtered) : treeRoot;
  container.innerHTML = renderTree(rootToRender, 0, filter);

  container.querySelectorAll<HTMLElement>(".tree-dir").forEach(dir => {
    dir.addEventListener("click", () => {
      const dirPath = dir.dataset.dir ?? "";
      if (openDirs.has(dirPath)) openDirs.delete(dirPath); else openDirs.add(dirPath);
      saveOpenDirs();
      renderFileTree();
      renderAgentFileTree();
      ri();
    });
  });

  container.querySelectorAll<HTMLElement>(".tree-file").forEach(f => {
    f.addEventListener("click", () => openFile(f.dataset.file ?? ""));
  });

  ri();
}

function updateAgentFilesRootLabel(): void {
  const rootLbl = $("agent-files-root");
  if (!rootLbl) return;
  // Derive workspace folder name from the first file path's top-level segment
  const firstFile = allFiles[0];
  if (firstFile) {
    const top = firstFile.path.split("/")[0];
    rootLbl.textContent = top || "workspace";
  } else {
    rootLbl.textContent = "workspace";
  }
}

function initAgentFiles(): void {
  const panel  = $("agent-files");
  const toggle = $("agent-files-toggle");
  const search = $el<HTMLInputElement>("agent-files-search");

  // Collapse / expand toggle on the header row
  toggle?.addEventListener("click", () => {
    panel?.classList.toggle("collapsed");
  });

  // Live filter
  search?.addEventListener("input", () => {
    agentFileFilter = search.value.trim().toLowerCase();
    renderAgentFileTree();
  });

  // Initial render (tree may already be loaded)
  renderAgentFileTree();
}

async function loadFileTree(): Promise<void> {
  const container = $("file-tree");
  if (container) container.innerHTML = `<div class="tree-loading"><i data-lucide="loader-2" class="spin"></i> Loading…</div>`;
  ri();

  try {
    const raw: ApiFile[] = await fetch(`${API}/api/files`).then(r => r.json());
    const codeExts = new Set(["ts","tsx","js","jsx","py","rs","go","md","json","css","html","toml","yaml","sh","mjs","cjs","lock","gitignore"]);
    allFiles = raw.filter(f => codeExts.has((f.name.split(".").pop() ?? "").toLowerCase()) || f.name.startsWith("."))
      .sort((a, b) => a.path.localeCompare(b.path));

    treeRoot = buildTree(allFiles);
    updateAgentFilesRootLabel();

    // Auto-open top-level dirs
    if (treeRoot) {
      for (const child of treeRoot.children.values()) {
        if (child.isDir) openDirs.add(child.path);
      }
    }

    const search = $el<HTMLInputElement>("explorer-search");
    if (search) {
      search.addEventListener("input", () => {
        explorerFilter = search.value.trim().toLowerCase();
        renderFileTree();
      });
    }

    $("explorer-refresh")?.addEventListener("click", () => { allFiles = []; treeRoot = null; loadFileTree(); });
    $("explorer-collapse")?.addEventListener("click", () => { openDirs.clear(); saveOpenDirs(); renderFileTree(); });

    renderFileTree();

    const first = allFiles.find(f => f.lang === "typescript");
    if (first) openFile(first.path);
  } catch {
    const container2 = $("file-tree");
    if (container2) container2.innerHTML = `<div class="tree-empty" style="color:var(--error)">Failed to load workspace.</div>`;
  }
}

// ── File opening ──────────────────────────────────────────────────────────────
let openTabs: string[] = [];

function renderTabs(): void {
  const bar = $("editor-tabs"); if (!bar) return;
  bar.innerHTML = openTabs.map(p => {
    const name = p.split("/").pop() ?? p;
    const isActive = p === activeFilePath;
    return `<button class="tab ${isActive ? "active" : ""}" data-file="${esc(p)}" title="${esc(p)}">
      <i data-lucide="file-code" class="tab-icon"></i>
      <span>${esc(name)}</span>
      <i data-lucide="x" class="tab-close" data-close="${esc(p)}"></i>
    </button>`;
  }).join("");
  bar.querySelectorAll<HTMLButtonElement>(".tab").forEach(tab => {
    tab.addEventListener("click", e => {
      const closeBtn = (e.target as HTMLElement).closest("[data-close]") as HTMLElement | null;
      if (closeBtn) {
        e.stopPropagation();
        const p = closeBtn.dataset.close ?? "";
        openTabs = openTabs.filter(t => t !== p);
        if (activeFilePath === p) {
          const next = openTabs[openTabs.length - 1];
          if (next) openFile(next); else { activeFilePath = ""; renderTabs(); renderFileTree(); updateWelcome(); }
        } else renderTabs();
        return;
      }
      openFile(tab.dataset.file ?? "");
    });
  });
  ri();
}

// ── Editor ────────────────────────────────────────────────────────────────────
let editorContent = "";          // raw text currently in editor
let editorSaveTimer = 0;
let editorDirty = false;

function getEditorEls(): { ta: HTMLTextAreaElement | null; hi: HTMLElement | null } {
  return {
    ta: $el<HTMLTextAreaElement>("editor-content"),
    hi: $el<HTMLElement>("editor-highlight"),
  };
}

function syncHighlight(): void {
  const { ta, hi } = getEditorEls(); if (!ta || !hi) return;
  // Get or create code element
  let codeEl = hi.querySelector("code");
  if (!codeEl) {
    codeEl = document.createElement("code");
    hi.appendChild(codeEl);
  }
  // Apply highlighting
  codeEl.innerHTML = hl(ta.value, activeLang);
  // Ensure dimensions match
  autoResizeTextarea(ta);
}

function syncLineNumbers(): void {
  const { ta } = getEditorEls(); if (!ta) return;
  const count = (ta.value.match(/\n/g)?.length ?? 0) + 1;
  renderLineNumbers(count);
  const slines = $("status-lines"); if (slines) slines.textContent = `${count} lines`;
}

function syncScroll(): void {
  const wrap = $("editor-layer-wrap");
  const ln = $("line-numbers");
  if (!wrap) return;

  // Sync line numbers scroll with editor scroll
  if (ln) ln.scrollTop = wrap.scrollTop;
}

function autoResizeTextarea(ta: HTMLTextAreaElement): void {
  // Reset to auto to measure true scrollHeight
  ta.style.height = "auto";

  // Calculate new height based on content
  const contentHeight = ta.scrollHeight;
  const newHeight = Math.max(contentHeight, 300);

  // Apply height to textarea
  ta.style.height = newHeight + "px";

  // Sync highlight layer height
  const hi = $("editor-highlight");
  if (hi) {
    hi.style.height = newHeight + "px";
    hi.style.minHeight = newHeight + "px";
  }

  // Ensure code element inside highlight also matches
  const codeEl = hi?.querySelector("code");
  if (codeEl) {
    (codeEl as HTMLElement).style.height = newHeight + "px";
    (codeEl as HTMLElement).style.minHeight = newHeight + "px";
  }
}

function markDirty(): void {
  editorDirty = true;
  clearTimeout(editorSaveTimer);
  editorSaveTimer = window.setTimeout(saveCurrentFile, settings.autoSave ? 800 : 0);
  // dim the tab to show unsaved
  const tab = document.querySelector<HTMLElement>(`.tab[data-file="${CSS.escape(activeFilePath)}"] .tab-label`);
  if (tab && !tab.textContent?.startsWith("●")) tab.textContent = "● " + (tab.textContent ?? "");
}

// ── Editor Commands ──────────────────────────────────────────────────────────
function getCurrentLineInfo(ta: HTMLTextAreaElement): { lineStart: number; lineEnd: number; lineText: string; lineIndex: number } {
  const text = ta.value;
  const pos = ta.selectionStart;
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const lineEnd = text.indexOf("\n", pos);
  const endIdx = lineEnd === -1 ? text.length : lineEnd;
  const lineText = text.substring(lineStart, endIdx);
  const lineIndex = text.substring(0, lineStart).split("\n").length - 1;
  return { lineStart, lineEnd: endIdx, lineText, lineIndex };
}

function deleteCurrentLine(ta: HTMLTextAreaElement): void {
  const { lineStart, lineEnd, lineText } = getCurrentLineInfo(ta);
  const text = ta.value;
  // Include the newline if not the last line
  const deleteEnd = lineEnd < text.length ? lineEnd + 1 : lineEnd;
  ta.value = text.substring(0, lineStart) + text.substring(deleteEnd);
  ta.selectionStart = ta.selectionEnd = lineStart;
  syncHighlight(); markDirty();
}

function copyLine(ta: HTMLTextAreaElement, direction: "up" | "down"): void {
  const { lineStart, lineEnd, lineText } = getCurrentLineInfo(ta);
  const text = ta.value;
  const hasNewline = lineEnd < text.length;
  const lineWithNewline = lineText + (hasNewline ? "\n" : "");

  if (direction === "up") {
    ta.value = text.substring(0, lineStart) + lineWithNewline + lineText + text.substring(lineEnd);
    ta.selectionStart = ta.selectionEnd = lineStart;
  } else {
    ta.value = text.substring(0, lineEnd) + "\n" + lineText + text.substring(lineEnd);
    ta.selectionStart = ta.selectionEnd = lineEnd + 1 + lineText.length;
  }
  syncHighlight(); markDirty();
}

function moveLine(ta: HTMLTextAreaElement, direction: "up" | "down"): void {
  const text = ta.value;
  const lines = text.split("\n");
  const { lineIndex } = getCurrentLineInfo(ta);

  if (direction === "up" && lineIndex > 0) {
    [lines[lineIndex - 1], lines[lineIndex]] = [lines[lineIndex], lines[lineIndex - 1]];
    ta.value = lines.join("\n");
    // Move cursor to moved line position
    const prevLineStart = lines.slice(0, lineIndex - 1).join("\n").length + (lineIndex > 1 ? 1 : 0);
    ta.selectionStart = ta.selectionEnd = prevLineStart;
  } else if (direction === "down" && lineIndex < lines.length - 1) {
    [lines[lineIndex], lines[lineIndex + 1]] = [lines[lineIndex + 1], lines[lineIndex]];
    ta.value = lines.join("\n");
    // Move cursor to moved line position
    const nextLineStart = lines.slice(0, lineIndex + 1).join("\n").length + 1;
    ta.selectionStart = ta.selectionEnd = nextLineStart;
  }
  syncHighlight(); markDirty();
}

function selectNextOccurrence(ta: HTMLTextAreaElement): void {
  const text = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = text.substring(start, end);

  if (!selected) return;

  // Find next occurrence after current selection
  const nextIndex = text.indexOf(selected, end);
  if (nextIndex !== -1) {
    ta.selectionStart = nextIndex;
    ta.selectionEnd = nextIndex + selected.length;
    ta.focus();
  }
}

async function saveCurrentFile(): Promise<void> {
  if (!activeFilePath || !editorDirty) return;
  const { ta } = getEditorEls(); if (!ta) return;
  editorDirty = false;
  editorContent = ta.value;
  try {
    await fetch(`${API}/api/file/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: activeFilePath, content: ta.value }),
    });
    // Clear dirty marker on tab
    const tab = document.querySelector<HTMLElement>(`.tab[data-file="${CSS.escape(activeFilePath)}"] .tab-label`);
    if (tab) tab.textContent = tab.textContent?.replace(/^● /, "") ?? "";
    const sl = $("status-lang"); if (sl) sl.textContent = activeLang;
  } catch { /* save failed silently */ }
}

function updateCursorStatus(): void {
  const { ta } = getEditorEls(); if (!ta) return;
  const text = ta.value.substring(0, ta.selectionStart);
  const line = (text.match(/\n/g)?.length ?? 0) + 1;
  const col  = ta.selectionStart - text.lastIndexOf("\n");
  const slines = $("status-lines");
  if (slines) slines.textContent = `Ln ${line}, Col ${col}`;
}

// ── Ghost-text autocomplete state ────────────────────────────────────────────
let ghostText       = "";
let ghostAbort: AbortController | null = null;
let ghostTimer: ReturnType<typeof setTimeout> | null = null;

function getGhostEl(): HTMLElement | null {
  return document.getElementById("editor-ghost");
}

function clearGhost(): void {
  ghostText = "";
  ghostAbort?.abort();
  ghostAbort = null;
  const g = getGhostEl(); if (g) g.textContent = "";
}

function acceptGhost(): void {
  if (!ghostText) return;
  const { ta } = getEditorEls(); if (!ta) return;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + ghostText + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = pos + ghostText.length;
  clearGhost();
  syncHighlight(); markDirty();
}

async function triggerAutocomplete(): Promise<void> {
  if (!settings.autoSave) return; // reuse autoSave as "AI features on" proxy
  const { ta } = getEditorEls(); if (!ta) return;
  const pos    = ta.selectionStart;
  const prefix = ta.value.slice(0, pos);
  const suffix = ta.value.slice(pos);
  // Don't suggest inside comments or strings (heuristic)
  const lastLine = prefix.split("\n").pop() ?? "";
  if (lastLine.trimStart().startsWith("//") || lastLine.trimStart().startsWith("#")) return;

  ghostAbort?.abort();
  ghostAbort = new AbortController();
  const ctrl = ghostAbort;

  try {
    const resp = await fetch(`${API}/api/autocomplete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prefix: prefix.slice(-1500), // last 1500 chars
        suffix: suffix.slice(0, 300),
        language: activeLang || "text",
        model: selectedModel?.id,
        provider: selectedModel?.provider,
        maxTokens: 60,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok || !resp.body || ctrl.signal.aborted) return;

    let completion = "";
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done || ctrl.signal.aborted) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.replace(/^data:\s*/, "");
        if (line === "[DONE]") break;
        try { completion += JSON.parse(line).choices?.[0]?.delta?.content ?? ""; } catch { /* ok */ }
      }
    }
    if (ctrl.signal.aborted) return;

    // Show only first line if completion is multi-line and don't show if empty
    const firstLine = completion.split("\n")[0].trimEnd();
    if (!firstLine) return;

    ghostText = firstLine;
    const g = getGhostEl();
    if (g && ta) {
      // Position ghost after the cursor using a ruler mirror technique
      const style = window.getComputedStyle(ta);
      const ruler = document.createElement("div");
      Object.assign(ruler.style, {
        position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap",
        wordWrap: "break-word", overflow: "hidden",
        font: style.font, padding: style.padding, border: style.border,
        width: ta.offsetWidth + "px",
      });
      const textBeforeCursor = ta.value.slice(0, ta.selectionStart);
      const span = document.createElement("span");
      span.textContent = textBeforeCursor || ".";
      ruler.appendChild(span);
      document.body.appendChild(ruler);
      const rect = span.getBoundingClientRect();
      const taRect = ta.getBoundingClientRect();
      ruler.remove();
      const cursorTop  = rect.bottom - taRect.top + ta.scrollTop;
      const cursorLeft = rect.right  - taRect.left;
      g.style.top    = cursorTop + "px";
      g.style.left   = cursorLeft + "px";
      g.textContent  = firstLine;
      g.style.display = "block";
    }
  } catch {
    /* network error or abort — silent */
  }
}

function initEditor(): void {
  const { ta, hi } = getEditorEls(); if (!ta || !hi) return;

  // Ghost-text overlay element (injected once)
  if (!document.getElementById("editor-ghost")) {
    const g = document.createElement("div");
    g.id = "editor-ghost";
    g.className = "editor-ghost";
    ta.parentElement?.appendChild(g);
  }

  // Sync highlight + scroll on every input
  ta.addEventListener("input", () => {
    syncHighlight();
    syncLineNumbers();
    markDirty();
    // Trigger ghost text after debounce
    clearGhost();
    if (ghostTimer) clearTimeout(ghostTimer);
    ghostTimer = setTimeout(() => { void triggerAutocomplete(); }, 420);
  });

  // Scroll only happens on the layer-wrap container (textarea has overflow:hidden)
  const wrap = $("editor-layer-wrap");
  if (wrap) {
    wrap.addEventListener("scroll", syncScroll);
  }

  // Wheel events on textarea should scroll the container
  ta.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (wrap) {
      wrap.scrollTop += e.deltaY;
      wrap.scrollLeft += e.deltaX;
    }
  }, { passive: false });

  ta.addEventListener("keyup",   updateCursorStatus);
  ta.addEventListener("click",   updateCursorStatus);
  ta.addEventListener("mouseup", updateCursorStatus);

  // Clear ghost on cursor movement / escape
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") { clearGhost(); return; }
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) { clearGhost(); }
  });

  // Tab key inserts spaces instead of switching focus
  ta.addEventListener("keydown", e => {
    // Accept ghost text with Tab if suggestion is showing
    if (e.key === "Tab" && ghostText) {
      e.preventDefault();
      acceptGhost();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const spaces = " ".repeat(settings.tabSize);
      if (start === end) {
        // simple indent
        ta.value = ta.value.substring(0, start) + spaces + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + spaces.length;
      } else {
        // block indent / dedent
        const lines = ta.value.substring(start, end).split("\n");
        const indented = e.shiftKey
          ? lines.map(l => l.startsWith(spaces) ? l.slice(spaces.length) : l.replace(/^ {1,4}/, ""))
          : lines.map(l => spaces + l);
        ta.value = ta.value.substring(0, start) + indented.join("\n") + ta.value.substring(end);
        ta.selectionStart = start;
        ta.selectionEnd   = start + indented.join("\n").length;
      }
      syncHighlight(); markDirty();
    }

    // Ctrl/Cmd+S = force save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      clearTimeout(editorSaveTimer);
      saveCurrentFile();
    }

    // Ctrl+/ = toggle line comment
    if ((e.ctrlKey || e.metaKey) && e.key === "/") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = ta.value;
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = text.indexOf("\n", end);
      const endIdx = lineEnd === -1 ? text.length : lineEnd;
      const lines = text.substring(lineStart, endIdx).split("\n");

      // Check if all lines are commented
      const allCommented = lines.every(l => l.trim().startsWith("//") || l.trim() === "");
      const newLines = lines.map(l => {
        if (allCommented) {
          // Uncomment
          const idx = l.indexOf("//");
          if (idx === -1) return l;
          return l.slice(0, idx) + l.slice(idx + 2);
        } else {
          // Comment
          return "//" + l;
        }
      });

      ta.value = text.substring(0, lineStart) + newLines.join("\n") + text.substring(endIdx);
      ta.selectionStart = start + (allCommented ? -2 : 2);
      ta.selectionEnd = end + newLines.join("\n").length - lines.join("\n").length;
      syncHighlight(); markDirty();
    }

    // Auto-close brackets
    const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
    if (PAIRS[e.key] && ta.selectionStart === ta.selectionEnd) {
      e.preventDefault();
      const s = ta.selectionStart;
      const close = PAIRS[e.key];
      ta.value = ta.value.substring(0, s) + e.key + close + ta.value.substring(s);
      ta.selectionStart = ta.selectionEnd = s + 1;
      syncHighlight(); markDirty();
    }

    // Ctrl+Shift+K = delete line
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "K") {
      e.preventDefault();
      deleteCurrentLine(ta);
    }

    // Ctrl+D = select next occurrence
    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      selectNextOccurrence(ta);
    }

    // Alt+Up/Down = move line
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveLine(ta, e.key === "ArrowUp" ? "up" : "down");
    }

    // Shift+Alt+Up/Down = copy line
    if (e.shiftKey && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      copyLine(ta, e.key === "ArrowUp" ? "up" : "down");
    }

    // Enter key — auto-indent to match current line
    if (e.key === "Enter") {
      const s = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
      const currentLine = ta.value.substring(lineStart, s);
      const indent = currentLine.match(/^(\s+)/)?.[1] ?? "";
      // Extra indent after opening bracket
      const lastChar = currentLine.trimEnd().slice(-1);
      const extra = "({[".includes(lastChar) ? " ".repeat(settings.tabSize) : "";
      e.preventDefault();
      const insert = "\n" + indent + extra;
      ta.value = ta.value.substring(0, s) + insert + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + insert.length;
      syncHighlight(); syncLineNumbers(); markDirty();
    }
  });

  // Initial sync to ensure editor is ready
  syncHighlight();
  syncLineNumbers();
}

async function openFile(filePath: string): Promise<void> {
  if (!filePath) return;

  // Save current file before switching if dirty
  if (editorDirty) await saveCurrentFile();

  activeFilePath = filePath;
  updateWelcome();
  if (!openTabs.includes(filePath)) openTabs.push(filePath);

  const name = filePath.split("/").pop() ?? filePath;
  const tabEl = $el<HTMLSpanElement>("active-tab-label");
  if (tabEl) tabEl.textContent = name;

  const crumb = document.getElementById("crumb-path"); if (crumb) crumb.textContent = filePath.replace(/\//g, " / ");
  const sf = $("status-file"); if (sf) sf.textContent = name;
  const sm = $("status-model"); if (sm) sm.textContent = selectedModel ? `${selectedModel.displayName}` : "No model";
  const badge = $("composer-file-name"); if (badge) badge.textContent = name;

  renderTabs();
  renderFileTree();

  const { ta, hi } = getEditorEls();
  if (ta) ta.value = "";
  if (hi) hi.innerHTML = `<code><span style="opacity:0.3">Loading…</span></code>`;

  try {
    const data = await fetch(`${API}/api/file/${encodeURIComponent(filePath)}`).then(r => r.json()) as
      { content: string; lang: string; lines: number };
    activeLang = data.lang;
    editorContent = data.content;
    editorDirty = false;
    const sl = $("status-lang"); if (sl) sl.textContent = data.lang;
    if (ta) {
      ta.value = data.content;
      ta.style.whiteSpace = settings.wordWrap ? "pre-wrap" : "pre";
    }
    // Delay sync to ensure DOM has updated with new content
    requestAnimationFrame(() => {
      syncHighlight();
      syncLineNumbers();
    });
    autoRankContext(filePath);
  } catch {
    if (ta) ta.value = `// Could not read ${filePath}`;
    syncHighlight();
  }
}

function renderLineNumbers(count: number): void {
  const ln = $("line-numbers"); if (!ln || !settings.lineNumbers) return;
  ln.innerHTML = Array.from({ length: count }, (_, i) => `<div>${i + 1}</div>`).join("");
}

// ── Session management ────────────────────────────────────────────────────────
const SESSION_KEY = "clarity:sessions";
const MAX_SESSIONS = 20;

function loadSessions(): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    sessions = raw ? JSON.parse(raw) : [];
  } catch { sessions = []; }
}

function saveSessions(): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessions.slice(-MAX_SESSIONS)));
}

function newSession(): ChatSession {
  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    title: "New chat",
    createdMs: Date.now(),
    updatedMs: Date.now(),
    messages: [],
    summaryBlock: "",
  };
}

function getActiveSession(): ChatSession | null {
  return sessions.find(s => s.id === activeSessionId) ?? null;
}

function autoTitle(messages: ChatMessage[]): string {
  const first = messages.find(m => m.role === "user")?.content ?? "";
  return first.slice(0, 40).trim() || "Chat " + new Date().toLocaleTimeString();
}

function activateSession(id: string): void {
  activeSessionId = id;
  const sess = getActiveSession();
  if (!sess) return;
  chatHistory = sess.messages;
  renderSessionList();
  replayLogFromHistory(sess);
  updateTokenMeter();
}

function createNewSession(): void {
  const sess = newSession();
  sessions.push(sess);
  saveSessions();
  activeSessionId = sess.id;
  chatHistory = [];
  const log = $("chat-log"); if (log) log.innerHTML = "";
  renderSessionList();
  appendMsg("assistant", "New session started. Ask anything about your code.");
  updateTokenMeter();
}

function deleteSession(id: string): void {
  sessions = sessions.filter(s => s.id !== id);
  saveSessions();
  if (id === activeSessionId) {
    if (sessions.length) activateSession(sessions[sessions.length - 1].id);
    else createNewSession();
  } else {
    renderSessionList();
  }
}

function persistCurrentSession(): void {
  const sess = getActiveSession();
  if (!sess) return;
  sess.messages = chatHistory;
  sess.updatedMs = Date.now();
  if (chatHistory.length > 0) sess.title = autoTitle(chatHistory);
  saveSessions();
  renderSessionList();
  updateTokenMeter();
}

function replayLogFromHistory(sess: ChatSession): void {
  const log = $("chat-log"); if (!log) return;
  log.innerHTML = "";
  if (sess.summaryBlock) {
    const row = document.createElement("div");
    row.className = "msg system summary-block";
    row.innerHTML = `<div class="msg-role"><i data-lucide="archive"></i>SUMMARY</div>
      <div class="msg-content summary-content">${esc(sess.summaryBlock)}</div>`;
    log.appendChild(row);
  }
  sess.messages.forEach(m => appendMsgDom(m.role as "user"|"assistant"|"system", m.content));
  log.scrollTop = log.scrollHeight;
  ri();
}

function renderSessionList(): void {
  const list = $("session-list"); if (!list) return;
  if (!sessions.length) {
    list.innerHTML = `<div class="session-empty">No sessions yet</div>`; return;
  }
  list.innerHTML = [...sessions].reverse().map(s => {
    const isActive = s.id === activeSessionId;
    const date = new Date(s.updatedMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const msgCount = s.messages.length;
    return `<div class="session-item ${isActive ? "active" : ""}" data-id="${esc(s.id)}">
      <div class="session-item-body">
        <span class="session-title">${esc(s.title)}</span>
        <span class="session-meta">${msgCount} msgs · ${date}</span>
      </div>
      <button class="session-del icon-btn xs" data-del="${esc(s.id)}" title="Delete"><i data-lucide="x"></i></button>
    </div>`;
  }).join("");
  list.querySelectorAll<HTMLElement>(".session-item").forEach(el => {
    el.addEventListener("click", e => {
      const delBtn = (e.target as HTMLElement).closest("[data-del]") as HTMLElement | null;
      if (delBtn) { e.stopPropagation(); deleteSession(delBtn.dataset.del ?? ""); return; }
      activateSession(el.dataset.id ?? "");
      $("session-drawer")?.classList.remove("open");
    });
  });
  ri();
}

// ── Context window management ─────────────────────────────────────────────────
const TOKEN_LIMIT_SAFETY = 0.85;  // use 85% of budget for history

function estimateTokensClient(text: string): number {
  return Math.ceil(text.length / 4);
}

function historyTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((s, m) => s + estimateTokensClient(m.content), 0);
}

/** Trim history to fit within token budget, oldest messages first.
 *  Returns the trimmed array — does NOT mutate the original. */
function trimHistory(msgs: ChatMessage[], budget: number): ChatMessage[] {
  let total = msgs.reduce((s, m) => s + estimateTokensClient(m.content), 0);
  if (total <= budget) return msgs;
  const trimmed = [...msgs];
  while (trimmed.length > 2 && total > budget) {
    const removed = trimmed.shift()!;
    total -= estimateTokensClient(removed.content);
  }
  return trimmed;
}

/** Build system prompt with optional summary block + BM25 context chunks */
function buildSystemPrompt(summaryBlock: string): string {
  let sys = settings.systemPrompt;
  if (activeFilePath) sys += `\n\nActive file: \`${activeFilePath}\` (${activeLang})`;
  if (summaryBlock) sys += `\n\n## Earlier conversation summary\n${summaryBlock}`;
  if (lastRankedChunks.length > 0 && settings.injectFile) {
    const ctxBlock = lastRankedChunks.slice(0, settings.ctxChunks).map(c =>
      `### ${c.filePath} L${c.startLine + 1}–${c.endLine + 1}\n\`\`\`${c.lang}\n${c.content}\n\`\`\``
    ).join("\n\n");
    sys += `\n\n## Relevant code context\n${ctxBlock}`;
  }
  return sys;
}

function updateTokenMeter(): void {
  const histToks = historyTokens(chatHistory);
  const ctxToks = lastRankedTokens;
  const total = histToks + ctxToks;
  const budget = settings.ctxTokens;
  const pct = Math.min(100, Math.round((total / budget) * 100));
  const el = $("token-meter-bar");
  const label = $("token-meter-label");
  if (el) {
    (el as HTMLElement).style.width = pct + "%";
    el.className = `token-meter-fill ${pct > 90 ? "danger" : pct > 70 ? "warn" : "ok"}`;
  }
  if (label) label.textContent = `${total.toLocaleString()} / ${budget.toLocaleString()} tokens`;
}

// ── Auto-rank context on file open ────────────────────────────────────────────
async function autoRankContext(filePath: string): Promise<void> {
  ctxAutoAbort?.abort();
  ctxAutoAbort = new AbortController();
  const query = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  try {
    const result: ContextRankResult = await fetch(`${API}/api/context/rank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query, maxTokens: settings.ctxTokens, maxChunks: settings.ctxChunks,
        chunksPerFile: settings.chunksPerFile, maxFiles: settings.maxFiles,
        includeContent: true,
      }),
      signal: ctxAutoAbort.signal,
    }).then(r => r.json());
    lastRankedChunks = result.chunks ?? [];
    lastRankedTokens = result.totalTokens ?? 0;
    updateTokenMeter();
    updateContextIndicator();
  } catch (e: unknown) {
    if ((e as Error).name !== "AbortError") lastRankedChunks = [];
  }
}

function updateContextIndicator(): void {
  const ind = $("ctx-inject-count");
  if (ind) ind.textContent = lastRankedChunks.length > 0
    ? `${lastRankedChunks.length} chunks · ${lastRankedTokens} tok`
    : "no context";
}

// ── Rolling summary compression ───────────────────────────────────────────────
async function compressHistory(): Promise<void> {
  if (!selectedModel || chatHistory.length < 8) return;
  const sess = getActiveSession(); if (!sess) return;
  const keepLast = 4;
  appendMsg("system", "⟳ Compressing older conversation into summary…");
  let summary = "";
  try {
    await consumeSSE(`${API}/api/chat/summarize`,
      { messages: chatHistory, model: selectedModel.id, provider: selectedModel.provider, keepLast, groqApiKey: settings.groqApiKey, openrouterApiKey: settings.openrouterApiKey },
      d => { summary += d; },
      new AbortController().signal
    );
    sess.summaryBlock = (sess.summaryBlock ? sess.summaryBlock + "\n" : "") + summary;
    chatHistory = chatHistory.slice(-keepLast);
    sess.messages = chatHistory;
    saveSessions();
    replayLogFromHistory(sess);
    appendMsg("system", "✓ History compressed. Older context preserved as summary.");
  } catch { /* compression failed silently */ }
}

// ── Chat rendering ────────────────────────────────────────────────────────────
function appendMsgDom(role: "user" | "assistant" | "system", content: string): void {
  const log = $("chat-log"); if (!log) return;
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const icons: Record<string, string> = { user: "user", assistant: "bot", system: "alert-triangle" };
  const labels: Record<string, string> = { user: "YOU", assistant: "AGENT", system: "SYSTEM" };
  const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const modelBadge = (role === "assistant" && selectedModel)
    ? `<span class="msg-model-badge">${esc(selectedModel.displayName)}</span>` : "";
  const rendered = renderMsgContent(content);
  row.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar"><i data-lucide="${icons[role] ?? "info"}"></i></div>
      <span class="msg-role-label">${labels[role] ?? role.toUpperCase()}</span>
      ${modelBadge}
      <span class="msg-time">${ts}</span>
    </div>
    <div class="msg-content">${rendered}</div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  ri();
}

function appendMsg(role: "user" | "assistant" | "system", content: string): void {
  appendMsgDom(role, content);
}

function renderMsgContent(text: string): string {
  // Replace ```lang\n...\n``` code fences with styled pre blocks
  const fenced = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const highlighted = lang && typeof hljs !== "undefined"
      ? (() => { try { return hljs.highlight(code, { language: lang }).value; } catch { return esc(code); } })()
      : esc(code);
    return `<div class="msg-code-block"><div class="msg-code-lang">${esc(lang||"code")}</div><pre class="msg-code">${highlighted}</pre><button class="msg-code-copy" onclick="navigator.clipboard.writeText(${JSON.stringify(code)})"><i data-lucide="copy"></i></button></div>`;
  });
  // Inline code
  const inlined = fenced.replace(/`([^`]+)`/g, (_, c) => `<code class="msg-inline-code">${esc(c)}</code>`);
  // Newlines to <br> outside of code blocks (simple heuristic)
  return inlined.replace(/\n/g, "<br>");
}

function appendStreamMsg(): { append: (d: string) => void; done: () => void } {
  const log = $("chat-log"); if (!log) return { append: () => {}, done: () => {} };
  const row = document.createElement("div");
  row.className = "msg assistant streaming";
  const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const modelBadge = selectedModel ? `<span class="msg-model-badge">${esc(selectedModel.displayName)}</span>` : "";
  row.innerHTML = `
    <div class="msg-header">
      <div class="msg-avatar"><i data-lucide="bot"></i></div>
      <span class="msg-role-label">AGENT</span>
      ${modelBadge}
      <span class="msg-time">${ts}</span>
    </div>
    <div class="msg-content"></div>`;
  log.appendChild(row);
  const el = row.querySelector<HTMLElement>(".msg-content")!;
  const stopBtn = $("btn-stop-chat");
  if (stopBtn) stopBtn.style.display = "";
  let text = "";
  return {
    append: d => {
      text += d;
      el.innerHTML = renderMsgContent(text);
      log.scrollTop = log.scrollHeight;
      ri();
    },
    done: () => {
      row.classList.remove("streaming");
      if (stopBtn) stopBtn.style.display = "none";
      chatHistory.push({ role: "assistant", content: text, ts: Date.now() });
      persistCurrentSession();
      updateTokenMeter();
      if (historyTokens(chatHistory) > settings.ctxTokens * TOKEN_LIMIT_SAFETY) {
        compressHistory();
      }
      ri();
    },
  };
}

function showDots(): () => void {
  const log = $("chat-log"); if (!log) return () => {};
  const row = document.createElement("div");
  row.className = "msg assistant typing-indicator";
  row.innerHTML = `<div class="msg-role"><i data-lucide="bot"></i>AGENT</div>
    <div class="msg-content"><div class="dots"><span></span><span></span><span></span></div></div>`;
  log.appendChild(row); log.scrollTop = log.scrollHeight; ri();
  return () => row.remove();
}

async function sendChat(text: string): Promise<void> {
  if (!selectedModel) { appendMsg("system", "No model selected — go to Models tab."); return; }
  chatAbort?.abort();
  chatAbort = new AbortController();

  // Build message with attachments context
  const attachmentsContext = getAttachmentsContext();
  const fullMessage = attachmentsContext ? `${text}\n\n${attachmentsContext}` : text;

  chatHistory.push({ role: "user", content: fullMessage, ts: Date.now() });
  persistCurrentSession();

  // Clear attachments after sending
  clearAttachments();
  $("btn-ai-vision")?.classList.remove("active");

  const sess = getActiveSession();
  const sys = buildSystemPrompt(sess?.summaryBlock ?? "");

  // Trim history to fit in context window (leave room for system + response)
  const histBudget = Math.floor(settings.ctxTokens * TOKEN_LIMIT_SAFETY) - estimateTokensClient(sys);
  const trimmed = trimHistory(chatHistory, Math.max(histBudget, 400));

  const removeDots = showDots();
  const stream = appendStreamMsg();
  removeDots();

  try {
    await consumeSSE(`${API}/api/chat`,
      { messages: [{ role: "system", content: sys }, ...trimmed], model: selectedModel.id, provider: selectedModel.provider, groqApiKey: settings.groqApiKey, openrouterApiKey: settings.openrouterApiKey },
      d => stream.append(d), chatAbort.signal);
    stream.done();
  } catch (e: unknown) {
    const msg = (e instanceof Error) ? e.message : String(e);
    if (!msg.includes("abort")) { stream.append(`\nError: ${msg}`); stream.done(); }
  }
}

function initChat(): void {
  loadSessions();

  // Bootstrap session
  if (sessions.length === 0) {
    const sess = newSession();
    sessions.push(sess);
    saveSessions();
    activeSessionId = sess.id;
    chatHistory = [];
  } else {
    activeSessionId = sessions[sessions.length - 1].id;
    chatHistory = getActiveSession()?.messages ?? [];
  }

  const form = $el<HTMLFormElement>("chat-form");
  const input = $el<HTMLTextAreaElement>("chat-input");
  if (!form || !input) return;

  // Replay existing history
  const sess = getActiveSession();
  if (sess && sess.messages.length > 0) replayLogFromHistory(sess);
  else appendMsg("assistant", "Ready. Select a Groq model in **Models** tab for instant free responses, or start LM Studio/Ollama locally.");

  renderSessionList();
  updateTokenMeter();

  // Enter = send, Shift+Enter = newline
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim(); if (!text) return;
      input.value = ""; input.style.height = "";
      appendMsgDom("user", text);
      sendChat(text);
    }
  });

  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = ""; input.style.height = "";
    appendMsgDom("user", text);
    sendChat(text);
  });

  $("btn-new-session")?.addEventListener("click", createNewSession);
  $("btn-new-session-drawer")?.addEventListener("click", () => { createNewSession(); $("session-drawer")?.classList.remove("open"); });

  $("btn-session-history")?.addEventListener("click", () => {
    $("session-drawer")?.classList.toggle("open");
    renderSessionList();
    ri();
  });

  $("session-drawer-close")?.addEventListener("click", () => {
    $("session-drawer")?.classList.remove("open");
  });

  $("btn-send-errors")?.addEventListener("click", () => {
    if (!consoleErrors.length) { appendMsg("system", "No errors captured yet."); return; }
    const ctx = consoleErrors.slice(-5).join("\n");
    appendMsgDom("user", `Fix these errors:\n${ctx}`);
    sendChat(`Fix these runtime errors:\n${ctx}`);
  });

  $("btn-compress")?.addEventListener("click", () => compressHistory());

  $("btn-clear-chat")?.addEventListener("click", () => {
    chatHistory = [];
    const sess2 = getActiveSession();
    if (sess2) { sess2.messages = []; sess2.summaryBlock = ""; saveSessions(); }
    const log = $("chat-log"); if (log) log.innerHTML = "";
    appendMsg("assistant", "Chat cleared.");
    updateTokenMeter();
  });

  // Stop generation button
  $("btn-stop-chat")?.addEventListener("click", () => {
    chatAbort?.abort();
    const stopBtn = $("btn-stop-chat");
    if (stopBtn) stopBtn.style.display = "none";
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // ATTACHMENT SYSTEM - File, Vision (editor view), Selection
  // ═══════════════════════════════════════════════════════════════════════════════

  function updateAttachmentUI(): void {
    const container = $("chat-attachments");
    const fileChip = $("chat-attach-file-chip");
    const visionChip = $("chat-attach-vision-chip");
    const selectionChip = $("chat-attach-selection-chip");
    const fileLabel = $("chat-attach-file-label");
    const selectionLabel = $("chat-attach-selection-label");
    const contextBadge = $("chat-context-badge");
    const contextCount = $("chat-context-count");

    if (!container) return;

    // Show container if any attachments
    const hasAttachments = activeAttachments.length > 0;
    container.style.display = hasAttachments ? "flex" : "none";

    // Update file chip
    const fileAtt = activeAttachments.find(a => a.type === "file");
    if (fileChip) fileChip.style.display = fileAtt ? "flex" : "none";
    if (fileLabel && fileAtt) fileLabel.textContent = fileAtt.label;

    // Update vision chip
    const visionAtt = activeAttachments.find(a => a.type === "vision");
    if (visionChip) visionChip.style.display = visionAtt ? "flex" : "none";

    // Update selection chip
    const selectionAtt = activeAttachments.find(a => a.type === "selection");
    if (selectionChip) selectionChip.style.display = selectionAtt ? "flex" : "none";
    if (selectionLabel && selectionAtt) selectionLabel.textContent = selectionAtt.label;

    // Update context badge
    if (contextBadge) contextBadge.style.display = hasAttachments ? "inline-flex" : "none";
    if (contextCount) contextCount.textContent = `${activeAttachments.length} context`;
  }

  function addAttachment(type: ChatAttachment["type"], content: string, label: string): void {
    // Remove existing of same type
    activeAttachments = activeAttachments.filter(a => a.type !== type);
    // Add new
    activeAttachments.push({ type, content, label });
    updateAttachmentUI();
  }

  function removeAttachment(type: ChatAttachment["type"]): void {
    activeAttachments = activeAttachments.filter(a => a.type !== type);
    updateAttachmentUI();
  }

  // Attach current file
  $("btn-attach-file")?.addEventListener("click", async () => {
    if (!activeFilePath) { toast("No file is open in the editor.", "error"); return; }
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) return;
    const content = ta.value;
    addAttachment("file", content, activeFilePath.split("/").pop() ?? activeFilePath);
    toast("File attached to context", "success");
  });

  // AI Vision - attach current editor view
  $("btn-ai-vision")?.addEventListener("click", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) { toast("No editor content to capture.", "error"); return; }

    // Get visible content (simplified - gets all for now)
    const content = ta.value;
    const cursorPos = ta.selectionStart;
    const lines = content.split("\n");

    // Find context around cursor (50 lines before, 20 after)
    let lineNum = 0;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1;
      if (charCount > cursorPos) { lineNum = i; break; }
    }

    const startLine = Math.max(0, lineNum - 50);
    const endLine = Math.min(lines.length, lineNum + 20);
    const visibleContent = lines.slice(startLine, endLine).join("\n");

    addAttachment("vision", visibleContent, `Lines ${startLine + 1}-${endLine + 1}`);
    $("btn-ai-vision")?.classList.add("active");
    toast("AI Vision enabled - editor view captured", "success");
  });

  // Attach selected code
  $("btn-attach-selection")?.addEventListener("click", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) return;

    const selection = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (!selection.trim()) { toast("No code selected. Select some code first.", "error"); return; }

    const lines = selection.split("\n").length;
    addAttachment("selection", selection, `${lines} line${lines > 1 ? "s" : ""}`);
    toast("Selection attached to context", "success");
  });

  // Remove buttons
  $("chat-attach-file-remove")?.addEventListener("click", () => removeAttachment("file"));
  $("chat-attach-vision-remove")?.addEventListener("click", () => {
    removeAttachment("vision");
    $("btn-ai-vision")?.classList.remove("active");
  });
  $("chat-attach-selection-remove")?.addEventListener("click", () => removeAttachment("selection"));

  // Auto-resize textarea up to 160px
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });
}

// ── Composer ──────────────────────────────────────────────────────────────────
function diffToHtml(raw: string): string {
  let lineNum = 0;
  return `<div class="diff-body">${raw.split("\n").map(line => {
    if (line.startsWith("---") || line.startsWith("+++")) {
      return `<div class="diff-line hdr"><span class="diff-line-gutter"></span><span class="diff-line-sign"></span><span class="diff-line-text">${esc(line)}</span></div>`;
    }
    if (line.startsWith("@@")) {
      lineNum = 0;
      return `<div class="diff-line hunk"><span class="diff-line-gutter">⋯</span><span class="diff-line-sign"></span><span class="diff-line-text">${esc(line)}</span></div>`;
    }
    if (line.startsWith("+")) {
      lineNum++;
      return `<div class="diff-line add"><span class="diff-line-gutter">${lineNum}</span><span class="diff-line-sign">+</span><span class="diff-line-text">${esc(line.slice(1))}</span></div>`;
    }
    if (line.startsWith("-")) {
      return `<div class="diff-line del"><span class="diff-line-gutter"></span><span class="diff-line-sign">−</span><span class="diff-line-text">${esc(line.slice(1))}</span></div>`;
    }
    lineNum++;
    return `<div class="diff-line ctx"><span class="diff-line-gutter">${lineNum}</span><span class="diff-line-sign"></span><span class="diff-line-text">${esc(line.startsWith(" ") ? line.slice(1) : line)}</span></div>`;
  }).join("")}</div>`;
}

function initComposer(): void {
  const button = $el<HTMLButtonElement>("composer-generate");
  const request = $el<HTMLTextAreaElement>("composer-request");
  const diffEl = $el<HTMLElement>("composer-diff");
  const diffWrap = $el<HTMLElement>("composer-diff-wrap");
  const patchActions = $el<HTMLElement>("patch-actions");
  const applyBtn = $el<HTMLButtonElement>("patch-apply");
  const discardBtn = $el<HTMLButtonElement>("patch-discard");
  if (!button || !request || !diffEl) return;

  // Mode switcher
  document.querySelectorAll<HTMLButtonElement>(".composer-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".composer-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mode ?? "patch";
      const genLabel = $("composer-gen-label");
      if (genLabel) genLabel.textContent = mode === "patch" ? "Generate Patch" : mode === "rewrite" ? "Rewrite File" : "Explain Code";
      request.placeholder = mode === "patch"
        ? "Describe the change you want…\n\ne.g. Add error handling to the fetchUser function and return null on failure"
        : mode === "rewrite"
        ? "Describe what the rewritten file should do…"
        : "What do you want explained about this file?";
    });
  });

  function showDiffWrap(show: boolean): void {
    if (diffWrap) diffWrap.style.display = show ? "flex" : "none";
    if (patchActions) patchActions.style.display = "none";
  }

  button.addEventListener("click", async () => {
    if (!selectedModel) { appendMsg("system", "Select a model in the Models tab first."); switchView("chat"); return; }
    if (!activeFilePath) { appendMsg("system", "Open a file in the explorer first."); switchView("chat"); return; }
    const prompt = request.value.trim() || `Improve error handling in ${activeFilePath.split("/").pop()}`;
    composerAbort?.abort(); composerAbort = new AbortController();
    button.disabled = true;
    button.innerHTML = `<i data-lucide="loader-2" class="spin"></i><span id="composer-gen-label">Generating…</span>`;
    ri();
    showDiffWrap(true);
    diffEl.innerHTML = `<div class="diff-body"><div class="diff-line ctx"><span class="diff-line-gutter"></span><span class="diff-line-sign"></span><span class="diff-line-text">Streaming from ${esc(selectedModel.displayName)}…</span></div></div>`;
    composerPatchText = "";
    try {
      await consumeSSE(`${API}/api/composer/patch`,
        { filePath: activeFilePath, prompt, model: selectedModel.id, provider: selectedModel.provider },
        d => { composerPatchText += d; diffEl.innerHTML = diffToHtml(composerPatchText); },
        composerAbort.signal);
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : String(e);
      if (!msg.includes("abort")) diffEl.innerHTML = `<div class="diff-body"><div class="diff-line del"><span class="diff-line-gutter"></span><span class="diff-line-sign">−</span><span class="diff-line-text">Error: ${esc(msg)}</span></div></div>`;
    } finally {
      button.disabled = false;
      const genLbl = button.querySelector("span") ?? button;
      genLbl.textContent = "Generate Patch";
      button.innerHTML = `<i data-lucide="sparkles"></i><span id="composer-gen-label">Generate Patch</span>`; ri();
    }
  });

  applyBtn?.addEventListener("click", async () => {
    if (!composerPatchText || !activeFilePath) return;
    applyBtn.disabled = true; applyBtn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Applying…`; ri();
    try {
      const res = await fetch(`${API}/api/composer/apply`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath: activeFilePath, patch: composerPatchText }),
      });
      const data = await res.json() as { ok?: boolean; content?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.content && settings.autoSave) {
        await fetch(`${API}/api/file/write`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: activeFilePath, content: data.content }),
        });
        await openFile(activeFilePath);
      }
      appendMsg("assistant", `Patch applied to \`${activeFilePath}\`. File saved.`);
      switchView("chat");
      composerPatchText = ""; diffEl.innerHTML = ""; showDiffWrap(false);
    } catch (e: unknown) {
      appendMsg("assistant", `Patch apply failed: ${(e instanceof Error) ? e.message : String(e)}`);
    } finally {
      applyBtn.disabled = false; applyBtn.innerHTML = `<i data-lucide="check"></i> Apply`; ri();
    }
  });

  discardBtn?.addEventListener("click", () => {
    composerPatchText = ""; diffEl.innerHTML = ""; showDiffWrap(false);
  });
}

// ── Context ───────────────────────────────────────────────────────────────────
function updateCtxGauge(totalTokens: number, budgetTokens: number, chunkCount: number): void {
  const pct = budgetTokens > 0 ? Math.min(100, Math.round((totalTokens / budgetTokens) * 100)) : 0;
  const circumference = 2 * Math.PI * 16; // r=16 → 100.53
  const offset = circumference * (1 - pct / 100);
  const ring = document.getElementById("ctx-ring-fill");
  if (ring) {
    (ring as unknown as SVGCircleElement).style.strokeDashoffset = String(offset);
    ring.classList.toggle("warn", pct > 70 && pct <= 90);
    ring.classList.toggle("crit", pct > 90);
  }
  const pctEl = $("ctx-gauge-pct"); if (pctEl) pctEl.textContent = `${pct}%`;
  const detEl = $("ctx-gauge-detail"); if (detEl) detEl.textContent = `${totalTokens.toLocaleString()} / ${budgetTokens.toLocaleString()} tokens`;
  const chnkEl = $("ctx-gauge-chunks"); if (chnkEl) chnkEl.textContent = `${chunkCount} chunk${chunkCount !== 1 ? "s" : ""} ranked`;
}

function renderContextChunks(data: ContextRankResult, container: HTMLElement): void {
  const { chunks, totalTokens, budgetTokens } = data;

  updateCtxGauge(totalTokens, budgetTokens, chunks.length);

  if (!chunks.length) { container.innerHTML = `<div class="ctx-empty">No chunks matched your query.<br>Try a broader search term or increase the token budget.</div>`; return; }

  const html = chunks.map(c => `
    <div class="ctx-card" data-path="${esc(c.filePath)}">
      <div class="ctx-card-header">
        <span class="ctx-card-rank">#${c.rank}</span>
        <div class="ctx-card-body">
          <div class="ctx-card-file">
            <i data-lucide="file-code"></i>
            <code>${esc(c.filePath.split("/").pop() ?? "")}</code>
            <span class="ctx-lines">L${c.startLine + 1}–${c.endLine + 1}</span>
          </div>
          <div class="ctx-card-preview">${esc(c.preview.slice(0, 180))}</div>
          <div class="ctx-card-meta">
            <span class="chip">${c.tokens} tok</span>
            <span class="chip score-chip">BM25 ${c.score.toFixed(3)}</span>
          </div>
        </div>
        <div class="ctx-card-actions">
          <button class="icon-btn sm ctx-goto" data-path="${esc(c.filePath)}" title="Open file"><i data-lucide="external-link"></i></button>
          <button class="icon-btn sm ctx-inject-one" data-idx="${c.rank - 1}" title="Inject this chunk"><i data-lucide="zap"></i></button>
        </div>
      </div>
      <div class="ctx-card-expand">${esc(c.content?.slice(0, 1200) ?? c.preview)}</div>
    </div>`).join("");

  container.innerHTML = html;

  container.querySelectorAll<HTMLElement>(".ctx-goto").forEach(btn =>
    btn.addEventListener("click", () => openFile(btn.dataset.path ?? "")));

  container.querySelectorAll<HTMLElement>(".ctx-inject-one").forEach(btn =>
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const chunk = chunks[idx];
      if (!chunk) return;
      const text = `Context from \`${chunk.filePath}\` L${chunk.startLine+1}–${chunk.endLine+1}:\n\`\`\`${chunk.lang}\n${chunk.content}\n\`\`\``;
      const inp = $el<HTMLTextAreaElement>("chat-input");
      if (inp) { inp.value = (inp.value ? inp.value + "\n\n" : "") + text; inp.focus(); switchView("chat"); }
    }));

  // Expand/collapse chunk content on card header click
  container.querySelectorAll<HTMLElement>(".ctx-card-header").forEach(hdr => {
    hdr.addEventListener("click", (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest(".ctx-goto") || tgt.closest(".ctx-inject-one")) return;
      hdr.closest(".ctx-card")?.classList.toggle("expanded");
    });
  });

  ri();
}

function initContext(): void {
  const button = $el<HTMLButtonElement>("ctx-rank");
  const result = $el<HTMLElement>("ctx-result");
  if (!button || !result) return;

  async function doRank(): Promise<void> {
    const btn = button!; const res = result!;
    const query = $el<HTMLInputElement>("ctx-query")?.value.trim() || activeFilePath.split("/").pop() || "code";
    const maxTokens = Number($el<HTMLInputElement>("ctx-max-tokens")?.value) || settings.ctxTokens;
    const maxChunks = Number($el<HTMLInputElement>("ctx-max-chunks")?.value) || settings.ctxChunks;
    const chunksPerFile = Number($el<HTMLInputElement>("ctx-chunks-per-file")?.value) || settings.chunksPerFile;
    btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i><span>Ranking…</span>`; ri();
    res.innerHTML = `<div class="ctx-empty">Scanning ${allFiles.length} files…</div>`;
    try {
      const data: ContextRankResult = await fetch(`${API}/api/context/rank`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, maxTokens, maxChunks, chunksPerFile, maxFiles: settings.maxFiles, includeContent: true }),
      }).then(r => r.json());
      lastRankedChunks = data.chunks ?? [];
      lastRankedTokens = data.totalTokens ?? 0;
      renderContextChunks(data, res);
      updateTokenMeter(); updateContextIndicator();
    } catch (e: unknown) {
      res.innerHTML = `<div class="ctx-empty">Error: ${esc((e as Error).message)}</div>`;
    } finally {
      btn.disabled = false; btn.innerHTML = `<i data-lucide="sparkles"></i><span>Rank Context</span>`; ri();
    }
  }

  button.addEventListener("click", doRank);

  // Inject-all button (in gauge strip)
  $("ctx-inject-all")?.addEventListener("click", () => {
    if (!lastRankedChunks.length) { doRank(); return; }
    const allCtx = lastRankedChunks.map(c =>
      `Context from \`${c.filePath}\` L${c.startLine+1}–${c.endLine+1}:\n\`\`\`${c.lang ?? ""}\n${c.content ?? c.preview}\n\`\`\``
    ).join("\n\n");
    const inp = $el<HTMLTextAreaElement>("chat-input");
    if (inp) { inp.value = allCtx; inp.focus(); switchView("chat"); }
    updateTokenMeter(); updateContextIndicator();
  });

  // Allow Enter in query input to trigger rank
  $el<HTMLInputElement>("ctx-query")?.addEventListener("keydown", e => {
    if (e.key === "Enter") doRank();
  });
}

// ── Models ────────────────────────────────────────────────────────────────────
async function loadModels(): Promise<void> {
  const list = $("model-list"); if (!list) return;
  list.innerHTML = `<li class="model-empty">Querying providers…</li>`;
  try {
    allModels = await fetch(`${API}/api/models/list`).then(r => r.json());
    if (!allModels.length) { list.innerHTML = `<li class="model-empty">No models found. Is LM Studio or Ollama running?</li>`; return; }
    const saved = localStorage.getItem("clarity:model");
    selectedModel = (saved ? allModels.find(m => m.id === saved) : null) ?? allModels[0];
    renderModels(list); updateModelBadge();
  } catch { list.innerHTML = `<li class="model-empty">Failed to reach providers.</li>`; }
}

const PROVIDER_META: Record<string, { label: string; color: string; icon: string }> = {
  groq:     { label: "Groq Cloud", color: "#f55036", icon: "cloud" },
  lmstudio: { label: "LM Studio",  color: "#8b5cf6", icon: "monitor" },
  ollama:   { label: "Ollama",     color: "#22c55e", icon: "cpu" },
};


function updateModelBadge(): void {
  const nameEl = $("active-model-name");
  const provEl = $("active-model-provider");
  const dotEl  = $("model-sel-dot");
  const sm     = $("status-model");
  if (selectedModel) {
    if (nameEl) nameEl.textContent = selectedModel.displayName;
    const pm = PROVIDER_META[selectedModel.provider];
    if (provEl) provEl.textContent = pm ? pm.label : selectedModel.provider;
    if (dotEl) {
      dotEl.className = "model-sel-dot";
      if (selectedModel.provider === "groq") dotEl.classList.add("cloud");
      else dotEl.classList.add("ok");
    }
    if (sm) sm.textContent = selectedModel.displayName;
  } else {
    if (nameEl) nameEl.textContent = "No model selected";
    if (provEl) provEl.textContent = "— select a model →";
    if (dotEl) dotEl.className = "model-sel-dot";
    if (sm) sm.textContent = "No model";
  }
}

function renderModels(list: HTMLElement, filter = ""): void {
  if (!allModels.length) {
    list.innerHTML = `<li class="model-empty">No models found.<br>Is LM Studio / Ollama running?<br>Groq models always available.</li>`;
    return;
  }
  const lf = filter.toLowerCase();
  const filtered = lf ? allModels.filter(m =>
    m.displayName.toLowerCase().includes(lf) || m.id.toLowerCase().includes(lf) || m.provider.toLowerCase().includes(lf)
  ) : allModels;

  if (!filtered.length) {
    list.innerHTML = `<li class="model-empty">No models match "${esc(filter)}".</li>`;
    ri(); return;
  }

  // Group by provider
  const groups: Record<string, typeof allModels> = {};
  filtered.forEach(m => { (groups[m.provider] ??= []).push(m); });

  let html = "";
  for (const [provider, models] of Object.entries(groups)) {
    const pm = PROVIDER_META[provider] ?? { label: provider, color: "#888", icon: "server" };
    html += `<li class="model-group-label">${esc(pm.label)}</li>`;
    html += models.map(m => {
      const active = m.id === selectedModel?.id;
      return `<li class="model-card ${active ? "active-model" : ""}" data-id="${esc(m.id)}">
        <div class="model-card-top">
          <div class="model-card-name-wrap">
            <span class="model-card-name">${esc(m.displayName)}</span>
            <span class="model-card-id">${esc(m.id.length > 28 ? m.id.slice(0,28)+"…" : m.id)}</span>
          </div>
          <div class="model-card-badges">
            ${active ? `<span class="chip active-chip"><i data-lucide="check"></i>active</span>` : ""}
            <span class="chip" style="color:${pm.color};border-color:${pm.color}33;background:${pm.color}11">
              <i data-lucide="${pm.icon}"></i>${esc(pm.label)}
            </span>
          </div>
        </div>
        <div class="model-card-footer">
          ${!active ? `<button class="btn primary sm model-select" data-id="${esc(m.id)}" style="margin-left:auto">Use this model</button>` : `<span class="chip active-chip" style="margin-left:auto"><i data-lucide="check"></i>Currently active</span>`}
        </div>
      </li>`;
    }).join("");
  }

  list.innerHTML = html;
  list.querySelectorAll<HTMLButtonElement>(".model-select").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = allModels.find(x => x.id === btn.dataset.id);
      if (m) {
        selectedModel = m;
        localStorage.setItem("clarity:model", m.id);
        renderModels(list, $el<HTMLInputElement>("models-search")?.value ?? "");
        updateModelBadge();
      }
    });
  });
  ri();
}

function initModels(): void {
  $("models-refresh")?.addEventListener("click", loadModels);

  // Live filter
  $el<HTMLInputElement>("models-search")?.addEventListener("input", e => {
    const list = $("model-list"); if (!list) return;
    renderModels(list, (e.target as HTMLInputElement).value);
  });

  loadModels();
}

// Model selector click on badge → switch to models tab
function initModelBadge(): void {
  const wrap = document.querySelector<HTMLElement>(".model-selector-wrap");
  wrap?.addEventListener("click", () => switchView("models"));
}

// ── Provider health ───────────────────────────────────────────────────────────
async function pollHealth(): Promise<void> {
  try {
    const health = await fetch(`${API}/api/providers/health`).then(r => r.json()) as Record<string, ProviderHealth>;
    const indicator = $("provider-health"); if (!indicator) return;
    const vals = Object.values(health);
    const allOk = vals.every(h => h.ok), anyOk = vals.some(h => h.ok);
    indicator.innerHTML = Object.entries(health).map(([name, h]) =>
      `<span class="health-dot ${h.ok ? "ok" : "dead"}" title="${name}: ${h.ok ? "online" : (h.reason ?? "offline")}">${name.slice(0,2).toUpperCase()}</span>`
    ).join("");
    const dot = document.querySelector<HTMLElement>(".dot");
    if (dot) {
      dot.style.background = allOk ? "var(--success)" : anyOk ? "var(--warning)" : "var(--error)";
      dot.style.boxShadow = `0 0 6px ${allOk ? "var(--success)" : anyOk ? "var(--warning)" : "var(--error)"}`;
    }
  } catch { /* offline */ }
}

function startHealthPolling(): void {
  pollHealth();
  if (healthTimer) clearInterval(healthTimer);
  healthTimer = window.setInterval(pollHealth, settings.healthInterval * 1000);
}

// ── Editor actions ────────────────────────────────────────────────────────────
function initEditorActions(): void {
  $("action-ask")?.addEventListener("click", () => {
    switchView("chat");
    const inp = $el<HTMLTextAreaElement>("chat-input");
    if (inp && activeFilePath) { inp.value = `Explain ${activeFilePath.split("/").pop()} — what does it do, what are the risks?`; inp.focus(); }
  });
  $("action-compose")?.addEventListener("click", () => {
    switchView("composer");
    const req = $el<HTMLTextAreaElement>("composer-request");
    if (req && activeFilePath) { req.value = `Improve error handling in ${activeFilePath.split("/").pop()}`; req.focus(); }
  });
}

// ── Topbar run-composer ───────────────────────────────────────────────────────
function initTopbar(): void {
  $("btn-run-composer")?.addEventListener("click", () => {
    switchView("composer");
    const req = $el<HTMLTextAreaElement>("composer-request");
    if (req && !req.value.trim() && activeFilePath) req.value = `Improve error handling in ${activeFilePath.split("/").pop()}`;
    setTimeout(() => $("composer-generate")?.click(), 80);
  });
}

// ── Command Palette ───────────────────────────────────────────────────────────
interface PaletteCommand {
  label?: string;
  icon?: string;
  cat?: string;
  action?: () => void | Promise<void>;
  type?: string;
}

const PALETTE_BASE: PaletteCommand[] = [
  { label: "File: Open Folder…",          icon: "folder-open",    cat: "action",  action: () => {
    const desktop = (window as any).clarityDesktop;
    if (desktop?.openFolder) desktop.openFolder();
  }},
  { label: "File: Open File…",            icon: "file-plus",      cat: "action",  action: () => {
    const desktop = (window as any).clarityDesktop;
    if (desktop?.openFile) desktop.openFile();
  }},
  { label: "File: Show Welcome",          icon: "home",           cat: "action",  action: () => showWelcomeScreen() },
  { type: "separator" },
  { label: "Chat: Ask Agent",             icon: "message-circle", cat: "panel",   action: () => switchView("chat") },
  { label: "Composer: Generate Patch",    icon: "edit-3",         cat: "panel",   action: () => { switchView("composer"); $("composer-generate")?.click(); } },
  { label: "Context: Rank",               icon: "database",       cat: "panel",   action: () => { switchView("context"); $("ctx-rank")?.click(); } },
  { label: "Models: Refresh",             icon: "layers",         cat: "panel",   action: () => { switchView("models"); loadModels(); } },
  { label: "Settings: Open",              icon: "settings-2",     cat: "action",  action: () => { $("settings-overlay")?.classList.add("open"); syncSettingsUI(); ri(); } },
  { label: "Explorer: Collapse All",      icon: "chevrons-up-down",cat:"action",  action: () => { openDirs.clear(); saveOpenDirs(); renderFileTree(); } },
  { label: "Explorer: Refresh",           icon: "refresh-cw",     cat: "action",  action: () => loadFileTree() },
];

function showWelcomeScreen(): void {
  activeFilePath = "";
  renderTabs();
  updateWelcome();
}

function openPalette(): void {
  const ov = $("palette-overlay"), inp = $el<HTMLInputElement>("palette-input"); if (!ov || !inp) return;
  ov.classList.add("open"); inp.value = ""; renderPalette(""); inp.focus();
}
function closePalette(): void { $("palette-overlay")?.classList.remove("open"); }

function renderPalette(query: string): void {
  const list = $("palette-results"); if (!list) return;
  const fileCmds: PaletteCommand[] = allFiles.slice(0, 200).map(f => ({
    label: `Open: ${f.path}`, icon: "file-code", cat: "file", action: () => openFile(f.path),
  }));
  const all: PaletteCommand[] = [...PALETTE_BASE, ...fileCmds];
  const q = query.toLowerCase();
  // Filter out separators when searching, but keep them when not searching
  const filtered = (q ? all.filter(c => c.label?.toLowerCase().includes(q)) : all).slice(0, 24)
    .filter(c => c.type !== "separator");
  list.innerHTML = filtered.length === 0
    ? `<li class="palette-empty">No results for "${esc(query)}"</li>`
    : filtered.map((c, i) =>
        `<li class="palette-item ${i === 0 ? "focused" : ""}" data-i="${i}">
          <i data-lucide="${c.icon ?? "file"}"></i>
          <span>${esc(c.label ?? "")}</span>
          <span class="palette-cat">${esc(c.cat ?? "")}</span>
        </li>`
      ).join("");
  list.querySelectorAll<HTMLLIElement>(".palette-item").forEach(li => {
    li.addEventListener("click", () => {
      const cmd = filtered[Number(li.dataset.i)];
      if (cmd?.action) { closePalette(); cmd.action(); }
    });
    li.addEventListener("mouseenter", () => { list.querySelectorAll(".palette-item").forEach(x => x.classList.remove("focused")); li.classList.add("focused"); });
  });
  ri();
}

function initCommandPalette(): void {
  const inp = $el<HTMLInputElement>("palette-input"), ov = $("palette-overlay"); if (!inp || !ov) return;
  $("btn-palette")?.addEventListener("click", openPalette);
  inp.addEventListener("input", () => renderPalette(inp.value));
  inp.addEventListener("keydown", e => {
    const items = [...ov.querySelectorAll<HTMLLIElement>(".palette-item")];
    const fi = items.findIndex(x => x.classList.contains("focused"));
    if (e.key === "ArrowDown") { e.preventDefault(); items.forEach(x => x.classList.remove("focused")); (items[fi + 1] ?? items[0])?.classList.add("focused"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items.forEach(x => x.classList.remove("focused")); (items[fi - 1] ?? items[items.length - 1])?.classList.add("focused"); }
    else if (e.key === "Enter") { e.preventDefault(); items[fi]?.click(); }
    else if (e.key === "Escape") closePalette();
  });
  ov.addEventListener("click", e => { if (e.target === ov) closePalette(); });
}

// ── Splitters ─────────────────────────────────────────────────────────────────
function initSplitters(): void {
  const ws = document.querySelector<HTMLElement>(".workspace");
  const left = $("split-left"), right = $("split-right");
  if (!ws || !left || !right) return;
  const drag = (side: "left" | "right", sp: HTMLElement) => {
    sp.classList.add("dragging");
    const onMove = (ev: MouseEvent) => {
      const r = ws.getBoundingClientRect();
      if (side === "left") {
        const w = Math.max(160, Math.min(500, ev.clientX - r.left - 44));
        document.documentElement.style.setProperty("--left-pane", `${w}px`);
        settings.sidebarWidth = w;
      } else {
        const w = Math.max(260, Math.min(700, r.right - ev.clientX));
        document.documentElement.style.setProperty("--right-pane", `${w}px`);
        settings.agentWidth = w;
      }
    };
    const up = () => { sp.classList.remove("dragging"); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", up);
  };
  left.addEventListener("mousedown", () => drag("left", left));
  right.addEventListener("mousedown", () => drag("right", right));
}

// ── Agent tabs ────────────────────────────────────────────────────────────────
function initAgentTabs(): void {
  document.querySelectorAll<HTMLButtonElement>(".agent-tab").forEach(tab =>
    tab.addEventListener("click", () => switchView(tab.dataset.agentView as AgentViewId)));
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function initKeyboard(): void {
  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "k") { e.preventDefault(); $("palette-overlay")?.classList.contains("open") ? closePalette() : openPalette(); }
    if (mod && e.key === ",") { e.preventDefault(); $("settings-overlay")?.classList.add("open"); syncSettingsUI(); ri(); }
    if (mod && e.shiftKey && e.key.toUpperCase() === "A") { e.preventDefault(); switchView("chat"); $el<HTMLTextAreaElement>("chat-input")?.focus(); }
    if (mod && e.shiftKey && e.key.toUpperCase() === "P") { e.preventDefault(); $("btn-run-composer")?.click(); }
    if (mod && e.shiftKey && e.key.toUpperCase() === "X") { e.preventDefault(); switchView("context"); $("ctx-rank")?.click(); }
    if (mod && e.shiftKey && e.key.toUpperCase() === "E") { e.preventDefault(); $el<HTMLInputElement>("explorer-search")?.focus(); }
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
interface SearchMatch   { start: number; end: number; }
interface SearchLine    { lineNo: number; text: string; matches: SearchMatch[]; }
interface SearchFileResult { filePath: string; name: string; lang: string; lines: SearchLine[]; }
interface SearchResponse   { results: SearchFileResult[]; totalMatches: number; }

let searchAbort: AbortController | null = null;
let searchOpts = { caseSensitive: false, wholeWord: false, regex: false };

function highlightSearchLine(text: string, matches: SearchMatch[]): string {
  if (!matches.length) return esc(text);
  let out = ""; let pos = 0;
  for (const m of matches) {
    out += esc(text.slice(pos, m.start));
    out += `<mark class="search-match">${esc(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  out += esc(text.slice(pos));
  return out;
}

function renderSearchResults(data: SearchResponse, container: HTMLElement): void {
  const meta = $("search-meta");
  const toolbar = $("search-toolbar");

  if (!data.results.length) {
    if (meta) meta.textContent = "No results";
    if (toolbar) toolbar.style.display = "none";
    container.innerHTML = `<div class="search-empty"><i data-lucide="search-x"></i><span>No results found</span></div>`;
    ri(); return;
  }

  if (meta) meta.innerHTML = `<strong>${data.totalMatches}</strong> match${data.totalMatches !== 1 ? "es" : ""} in <strong>${data.results.length}</strong> file${data.results.length !== 1 ? "s" : ""}`;
  if (toolbar) toolbar.style.display = "flex";

  container.innerHTML = data.results.map(f => {
    const icon = fileIconFor(f.name);
    const dir = f.filePath.includes("/") ? f.filePath.slice(0, f.filePath.lastIndexOf("/")) : "";
    const rows = f.lines.map(l =>
      `<div class="search-line" data-path="${esc(f.filePath)}" data-line="${l.lineNo}">
        <span class="search-lineno">${l.lineNo}</span>
        <span class="search-linetext">${highlightSearchLine(l.text.trim(), l.matches)}</span>
      </div>`
    ).join("");
    return `<div class="search-file-group">
      <div class="search-file-header" data-path="${esc(f.filePath)}">
        <i data-lucide="chevron-down" class="search-file-chevron"></i>
        <span class="tree-file-icon">${icon.svg}</span>
        <span class="search-file-name">${esc(f.name)}</span>
        <span class="search-file-dir">${esc(dir)}</span>
        <span class="search-file-count">${f.lines.length}</span>
      </div>
      <div class="search-file-lines">${rows}</div>
    </div>`;
  }).join("");

  // File header: open file OR collapse group
  container.querySelectorAll<HTMLElement>(".search-file-header").forEach(hdr => {
    hdr.addEventListener("click", () => {
      hdr.closest(".search-file-group")?.classList.toggle("collapsed");
      ri();
    });
    hdr.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      openFile(hdr.dataset.path ?? "");
    });
  });

  // Match line: open file and jump to line
  container.querySelectorAll<HTMLElement>(".search-line").forEach(el => {
    el.addEventListener("click", async () => {
      const line = Number(el.dataset.line ?? "1");
      await openFile(el.dataset.path ?? "");
      // After file loads, scroll editor textarea to the line
      setTimeout(() => {
        const ta = $el<HTMLTextAreaElement>("editor-textarea");
        if (!ta) return;
        const lines = ta.value.split("\n");
        let pos = 0;
        for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
        ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
        ta.focus();
        // Scroll line into view
        const lineHeight = ta.scrollHeight / (lines.length || 1);
        ta.scrollTop = Math.max(0, lineHeight * (line - 1) - ta.clientHeight / 2);
        // Highlight the clicked row briefly
        container.querySelectorAll(".search-line").forEach(r => r.classList.remove("focused"));
        el.classList.add("focused");
      }, 120);
    });
  });

  ri();
}

function initSearch(): void {
  const input     = $el<HTMLInputElement>("search-query");
  const resultsEl = $el<HTMLElement>("search-results");
  if (!input || !resultsEl) return;

  const setLoading = (on: boolean) => {
    const ld = $("search-loading");
    if (ld) ld.style.display = on ? "flex" : "none";
    if (on) { const tb = $("search-toolbar"); if (tb) tb.style.display = "none"; }
    ri();
  };

  const runSearch = async () => {
    const query = input.value.trim();
    if (!query) {
      resultsEl.innerHTML = "";
      const m = $("search-meta"); if (m) m.textContent = "";
      const tb = $("search-toolbar"); if (tb) tb.style.display = "none";
      setLoading(false); return;
    }
    searchAbort?.abort();
    searchAbort = new AbortController();
    setLoading(true);
    resultsEl.innerHTML = "";
    try {
      const data: SearchResponse = await fetch(`${API}/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query, ...searchOpts,
          includeGlob: $el<HTMLInputElement>("search-include")?.value.trim() ?? "",
          excludeGlob: $el<HTMLInputElement>("search-exclude")?.value.trim() ?? "",
        }),
        signal: searchAbort.signal,
      }).then(r => r.json());
      setLoading(false);
      renderSearchResults(data, resultsEl);
    } catch (e: unknown) {
      setLoading(false);
      if ((e as Error).name !== "AbortError")
        resultsEl.innerHTML = `<div class="search-empty"><i data-lucide="alert-triangle"></i><span>Error: ${esc((e as Error).message)}</span></div>`;
    }
  };

  // Debounced input
  let debounce = 0;
  input.addEventListener("input", () => {
    // Show/hide inline clear button
    const clr = $("search-input-clear");
    if (clr) clr.classList.toggle("visible", input.value.length > 0);
    clearTimeout(debounce); debounce = window.setTimeout(runSearch, 320);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(debounce); runSearch(); }
  });

  // Run button
  $("search-run")?.addEventListener("click", () => { clearTimeout(debounce); runSearch(); });

  // Inline clear
  $("search-input-clear")?.addEventListener("click", () => {
    input.value = ""; input.focus();
    const clr = $("search-input-clear"); if (clr) clr.classList.remove("visible");
    resultsEl.innerHTML = "";
    const m = $("search-meta"); if (m) m.textContent = "";
    const tb = $("search-toolbar"); if (tb) tb.style.display = "none";
  });

  // Option toggles
  const toggleOpt = (id: string, key: keyof typeof searchOpts) => {
    const btn = $(id); if (!btn) return;
    btn.addEventListener("click", () => {
      searchOpts[key] = !searchOpts[key];
      btn.classList.toggle("active", searchOpts[key]);
      if (input.value.trim()) runSearch();
    });
  };
  toggleOpt("sopt-case",  "caseSensitive");
  toggleOpt("sopt-word",  "wholeWord");
  toggleOpt("sopt-regex", "regex");

  // Alt+C / Alt+W / Alt+R shortcuts
  input.addEventListener("keydown", e => {
    if (e.altKey && e.key.toUpperCase() === "C") { $("sopt-case")?.click(); }
    if (e.altKey && e.key.toUpperCase() === "W") { $("sopt-word")?.click(); }
    if (e.altKey && e.key.toUpperCase() === "R") { $("sopt-regex")?.click(); }
  });

  // Replace toggle
  $("search-replace-toggle")?.addEventListener("click", () => {
    const row = $("search-replace-row");
    if (!row) return;
    const open = row.style.display !== "none";
    row.style.display = open ? "none" : "flex";
    if (!open) $el<HTMLInputElement>("search-replace")?.focus();
    ri();
  });
  // Ctrl+H opens replace
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "h") {
      e.preventDefault();
      switchSidePanel("search"); input.focus();
      const row = $("search-replace-row"); if (row) row.style.display = "flex";
      $el<HTMLInputElement>("search-replace")?.focus();
      ri();
    }
  });

  // Replace-all (client-side annotation — actual write per file)
  $("search-replace-all-btn")?.addEventListener("click", async () => {
    const replaceVal = $el<HTMLInputElement>("search-replace")?.value ?? "";
    const groups = resultsEl.querySelectorAll<HTMLElement>(".search-file-group");
    if (!groups.length) return;
    let count = 0;
    for (const g of Array.from(groups)) {
      const hdr = g.querySelector<HTMLElement>(".search-file-header");
      const path = hdr?.dataset.path ?? "";
      const lineEls = g.querySelectorAll<HTMLElement>(".search-line");
      if (!path || !lineEls.length) continue;
      try {
        const fileData = await fetch(`${API}/api/file/${encodeURIComponent(path)}`).then(r => r.json()) as { content: string };
        let newContent = fileData.content;
        const query = input.value.trim();
        const flags = searchOpts.caseSensitive ? "g" : "gi";
        const pattern = searchOpts.regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        newContent = newContent.replace(pattern, replaceVal);
        count += lineEls.length;
        await fetch(`${API}/api/file/write`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, content: newContent }),
        });
      } catch { /* skip file on error */ }
    }
    appendMsg("system", `Replaced in ${count} occurrences across ${groups.length} files.`);
    runSearch();
  });

  // Collapse all / Expand all
  $("search-collapse-all")?.addEventListener("click", () => {
    resultsEl.querySelectorAll(".search-file-group").forEach(g => g.classList.add("collapsed"));
    ri();
  });
  $("search-expand-all")?.addEventListener("click", () => {
    resultsEl.querySelectorAll(".search-file-group").forEach(g => g.classList.remove("collapsed"));
    ri();
  });

  // Clear all
  $("search-clear-btn")?.addEventListener("click", () => {
    input.value = ""; resultsEl.innerHTML = "";
    const m = $("search-meta"); if (m) m.textContent = "";
    const tb = $("search-toolbar"); if (tb) tb.style.display = "none";
    const clr = $("search-input-clear"); if (clr) clr.classList.remove("visible");
    searchAbort?.abort();
    input.focus();
  });

  // Filter inputs also trigger re-search (debounced)
  [$el<HTMLInputElement>("search-include"), $el<HTMLInputElement>("search-exclude")].forEach(el => {
    el?.addEventListener("input", () => { clearTimeout(debounce); debounce = window.setTimeout(runSearch, 500); });
    el?.addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(debounce); runSearch(); } });
  });

  // Keyboard: Ctrl+Shift+F / F3 navigation
  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key.toUpperCase() === "F") {
      e.preventDefault();
      switchSidePanel("search");
      input.focus(); input.select();
    }
    // F3 / Shift+F3 — jump through focused results
    if (e.key === "F3") {
      e.preventDefault();
      const all = Array.from(resultsEl.querySelectorAll<HTMLElement>(".search-line"));
      if (!all.length) return;
      const cur = resultsEl.querySelector<HTMLElement>(".search-line.focused");
      const idx = cur ? all.indexOf(cur) : -1;
      const next = e.shiftKey ? all[(idx - 1 + all.length) % all.length] : all[(idx + 1) % all.length];
      next?.click();
      next?.scrollIntoView({ block: "nearest" });
    }
  });
}

// ── Git / Source Control ───────────────────────────────────────────────────────
interface GitFile    { xy: string; path: string; staged: boolean; unstaged: boolean; untracked: boolean; }
interface GitStatus  { branch: string; files: GitFile[]; ahead: number; behind: number; }
interface GitCommit  { hash: string; short: string; subject: string; author: string; rel: string; }

let gitStatus: GitStatus | null = null;
let gitDiffOpenPath = "";
let gitSectionOpen: Record<string, boolean> = { staged: true, changes: true, untracked: true, log: false };

const XY_LABEL: Record<string, string> = {
  M: "M", A: "A", D: "D", R: "R", C: "C", U: "U", "?": "?", "!": "!",
};
function xyLabel(xy: string): string { return (XY_LABEL[xy[0]] ?? xy[0]) + (xy[1] !== " " ? xy[1] : ""); }
function xyColor(xy: string): string {
  const x = xy[0];
  if (x === "M") return "var(--warning)";
  if (x === "A") return "var(--success)";
  if (x === "D") return "var(--error)";
  if (x === "?") return "var(--text-dim)";
  return "var(--accent)";
}

function gitPost(endpoint: string, body: object): Promise<{ ok?: boolean; error?: string }> {
  return fetch(`${API}${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

async function loadGitStatus(): Promise<void> {
  const branchEl = $("git-branch-name");
  const syncEl   = $("git-sync-badge");
  if (branchEl) branchEl.textContent = "loading…";

  try {
    gitStatus = await fetch(`${API}/api/git/status`).then(r => r.json());
    if (!gitStatus) return;

    showGitNoRepo(false);
    if (branchEl) branchEl.textContent = gitStatus.branch;
    if (syncEl) {
      const parts = [];
      if (gitStatus.ahead)  parts.push(`↑${gitStatus.ahead}`);
      if (gitStatus.behind) parts.push(`↓${gitStatus.behind}`);
      syncEl.textContent = parts.join(" ");
      syncEl.style.display = parts.length ? "" : "none";
    }

    const staged    = gitStatus.files.filter(f => f.staged && !f.untracked);
    const unstaged  = gitStatus.files.filter(f => f.unstaged && !f.untracked);
    const untracked = gitStatus.files.filter(f => f.untracked);

    const stCount = $("git-staged-count");    if (stCount) stCount.textContent = String(staged.length);
    const chCount = $("git-changes-count");   if (chCount) chCount.textContent = String(unstaged.length);
    const utCount = $("git-untracked-count"); if (utCount) utCount.textContent = String(untracked.length);

    renderGitFileList("git-staged-list",    staged,    true);
    renderGitFileList("git-changes-list",   unstaged,  false);
    renderGitFileList("git-untracked-list", untracked, false);

    // Update activity bar badge
    const total = gitStatus.files.length;
    const badge = document.querySelector<HTMLElement>(".activity-btn[data-panel='git']");
    if (badge) {
      let b = badge.querySelector<HTMLElement>(".git-badge");
      if (!b) { b = document.createElement("span"); b.className = "git-badge"; badge.appendChild(b); }
      b.textContent = total > 0 ? String(total) : "";
      b.style.display = total > 0 ? "" : "none";
    }
  } catch (e: unknown) {
    showGitNoRepo(true);
  }
}

function showGitNoRepo(yes: boolean): void {
  const noRepo   = $("git-no-repo");
  const gitUi    = ["git-branch-row", "git-commit-box",
                    "git-staged-head", "git-staged-list",
                    "git-changes-head", "git-changes-list",
                    "git-untracked-head", "git-untracked-list",
                    "git-diff-view", "git-log-head", "git-log-list"];
  if (noRepo) noRepo.style.display = yes ? "flex" : "none";
  gitUi.forEach(id => { const el = $(id); if (el) el.style.display = yes ? "none" : ""; });
}

async function loadGitLog(): Promise<void> {
  const list = $("git-log-list"); if (!list) return;
  list.innerHTML = `<div class="git-empty">Loading…</div>`;
  try {
    const commits: GitCommit[] = await fetch(`${API}/api/git/log`).then(r => r.json());
    if (!commits.length) { list.innerHTML = `<div class="git-empty">No commits yet.</div>`; return; }
    list.innerHTML = commits.map(c =>
      `<div class="git-commit" data-hash="${esc(c.hash)}">
        <span class="git-commit-short">${esc(c.short)}</span>
        <span class="git-commit-msg">${esc(c.subject)}</span>
        <span class="git-commit-meta">${esc(c.author)} · ${esc(c.rel)}</span>
      </div>`
    ).join("");
    ri();
  } catch { list.innerHTML = `<div class="git-empty">Failed to load log.</div>`; }
}

async function loadGitDiff(filePath: string, staged: boolean): Promise<void> {
  const view = $("git-diff-view"); if (!view) return;
  if (gitDiffOpenPath === filePath) { view.innerHTML = ""; gitDiffOpenPath = ""; return; }
  gitDiffOpenPath = filePath;
  view.innerHTML = `<div class="git-diff-loading">Loading diff…</div>`;
  try {
    const { diff } = await gitPost("/api/git/diff", { filePath, staged }) as { diff: string };
    view.innerHTML = `<div class="diff-body">${diff.split("\n").map(line => {
      if (line.startsWith("---") || line.startsWith("+++")) return `<div class="diff-line hdr">${esc(line)}</div>`;
      if (line.startsWith("@@")) return `<div class="diff-line hunk">${esc(line)}</div>`;
      if (line.startsWith("+")) return `<div class="diff-line add">${esc(line)}</div>`;
      if (line.startsWith("-")) return `<div class="diff-line del">${esc(line)}</div>`;
      return `<div class="diff-line ctx">${esc(line)}</div>`;
    }).join("")}</div>`;
  } catch (e: unknown) { view.innerHTML = `<div class="git-diff-loading">Error: ${esc((e as Error).message)}</div>`; }
}

function renderGitFileList(containerId: string, files: GitFile[], isStaged: boolean): void {
  const list = $(containerId); if (!list) return;
  if (!gitSectionOpen[containerId.replace("git-","").replace("-list","")]) { list.style.display = "none"; return; }
  list.style.display = "";
  if (!files.length) { list.innerHTML = `<div class="git-empty">No files</div>`; return; }
  list.innerHTML = files.map(f => {
    const icon = fileIconFor(f.path.split("/").pop() ?? f.path);
    const label = xyLabel(f.xy);
    const color = xyColor(f.xy);
    const fname = f.path.split("/").pop() ?? f.path;
    const dir   = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    return `<div class="git-file-item" data-path="${esc(f.path)}" data-staged="${isStaged}">
      <span class="tree-file-icon">${icon.svg}</span>
      <span class="git-file-name">${esc(fname)}</span>
      ${dir ? `<span class="git-file-dir">${esc(dir)}</span>` : ""}
      <span class="git-file-xy" style="color:${color}">${label}</span>
      <div class="git-file-actions">
        ${isStaged
          ? `<button class="icon-btn xs git-unstage-btn" data-path="${esc(f.path)}" title="Unstage"><i data-lucide="minus"></i></button>`
          : f.untracked
            ? `<button class="icon-btn xs git-stage-btn" data-path="${esc(f.path)}" title="Stage"><i data-lucide="plus"></i></button>`
            : `<button class="icon-btn xs git-stage-btn" data-path="${esc(f.path)}" title="Stage"><i data-lucide="plus"></i></button>
               <button class="icon-btn xs git-discard-btn" data-path="${esc(f.path)}" title="Discard"><i data-lucide="rotate-ccw"></i></button>`
        }
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll<HTMLElement>(".git-file-item").forEach(el => {
    el.addEventListener("click", e => {
      if ((e.target as HTMLElement).closest("button")) return;
      loadGitDiff(el.dataset.path ?? "", el.dataset.staged === "true");
      list.querySelectorAll(".git-file-item").forEach(i => i.classList.remove("active"));
      el.classList.add("active");
    });
  });
  list.querySelectorAll<HTMLElement>(".git-stage-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      await gitPost("/api/git/stage", { filePath: btn.dataset.path }); loadGitStatus();
    });
  });
  list.querySelectorAll<HTMLElement>(".git-unstage-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      await gitPost("/api/git/unstage", { filePath: btn.dataset.path }); loadGitStatus();
    });
  });
  list.querySelectorAll<HTMLElement>(".git-discard-btn").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm(`Discard changes to ${btn.dataset.path}?`)) return;
      await gitPost("/api/git/discard", { filePath: btn.dataset.path }); loadGitStatus();
    });
  });
  ri();
}

function initGitSectionToggles(): void {
  const sections: [string, string][] = [
    ["git-staged-head",   "staged"],
    ["git-changes-head",  "changes"],
    ["git-untracked-head","untracked"],
    ["git-log-head",      "log"],
  ];
  sections.forEach(([headId, key]) => {
    $(headId)?.addEventListener("click", e => {
      if ((e.target as HTMLElement).closest("button")) return;
      gitSectionOpen[key] = !gitSectionOpen[key];
      const listId = key === "log" ? "git-log-list" : `git-${key}-list`;
      const list = $(listId);
      if (list) list.style.display = gitSectionOpen[key] ? "" : "none";
      const icon = document.querySelector(`#${headId} .git-toggle-icon`) as HTMLElement | null;
      if (icon) { icon.setAttribute("data-lucide", gitSectionOpen[key] ? "chevron-down" : "chevron-right"); ri(); }
      if (key === "log" && gitSectionOpen.log) loadGitLog();
    });
  });
}

function initGit(): void {
  initGitSectionToggles();

  $("git-refresh-btn")?.addEventListener("click", () => loadGitStatus());

  $("git-init-btn")?.addEventListener("click", async () => {
    const btn = $el<HTMLButtonElement>("git-init-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Initializing…`; ri(); }
    const res = await gitPost("/api/git/init", {}) as { ok?: boolean; error?: string };
    if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="git-branch"></i> Initialize Repository`; ri(); }
    if (res.ok) loadGitStatus();
    else appendMsg("system", `git init failed: ${res.error ?? "unknown error"}`);
  });

  $("git-publish-btn")?.addEventListener("click", () => {
    window.open("https://github.com/new", "_blank", "noopener");
  });

  $("git-commit-btn")?.addEventListener("click", async () => {
    const msgEl = $el<HTMLTextAreaElement>("git-commit-msg");
    const msg = msgEl?.value.trim() ?? "";
    if (!msg) { appendMsg("system", "Enter a commit message first."); return; }
    const btn = $el<HTMLButtonElement>("git-commit-btn");
    if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Committing…`; ri(); }
    const res = await gitPost("/api/git/commit", { message: msg }) as { ok?: boolean; error?: string };
    if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="check"></i> Commit staged`; ri(); }
    if (res.ok) { if (msgEl) msgEl.value = ""; loadGitStatus(); }
    else appendMsg("system", `Commit failed: ${res.error ?? "unknown error"}`);
  });

  $("git-stage-all")?.addEventListener("click", async () => {
    if (!gitStatus) return;
    const unstaged = gitStatus.files.filter(f => f.unstaged && !f.untracked);
    await Promise.all(unstaged.map(f => gitPost("/api/git/stage", { filePath: f.path })));
    loadGitStatus();
  });

  $("git-stage-untracked")?.addEventListener("click", async () => {
    if (!gitStatus) return;
    const untracked = gitStatus.files.filter(f => f.untracked);
    await Promise.all(untracked.map(f => gitPost("/api/git/stage", { filePath: f.path })));
    loadGitStatus();
  });

  $("git-unstage-all")?.addEventListener("click", async () => {
    if (!gitStatus) return;
    const staged = gitStatus.files.filter(f => f.staged && !f.untracked);
    await Promise.all(staged.map(f => gitPost("/api/git/unstage", { filePath: f.path })));
    loadGitStatus();
  });

  $("git-discard-all")?.addEventListener("click", async () => {
    if (!gitStatus) return;
    const unstaged = gitStatus.files.filter(f => f.unstaged && !f.untracked);
    if (!unstaged.length) return;
    if (!confirm(`Discard changes to ${unstaged.length} file(s)?`)) return;
    await Promise.all(unstaged.map(f => gitPost("/api/git/discard", { filePath: f.path })));
    loadGitStatus();
  });
}

// ── Toast notification system ─────────────────────────────────────────────────
function toast(msg: string, type: "success" | "error" | "info" = "info", durationMs = 3500): void {
  const container = $("toast-container"); if (!container) return;
  const icon = type === "success" ? "check-circle" : type === "error" ? "alert-circle" : "info";
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${icon}"></i><span class="toast-msg">${esc(msg)}</span>`;
  container.appendChild(el);
  ri();
  const remove = () => {
    el.classList.add("hiding");
    setTimeout(() => el.remove(), 220);
  };
  el.addEventListener("click", remove);
  setTimeout(remove, durationMs);
}

// ── Go-to-line ────────────────────────────────────────────────────────────────
let openGotoLineFn: () => void = () => {};
function openGotoLine(): void { openGotoLineFn(); }

function initGotoLine(): void {
  const overlay = $("goto-overlay");
  const input   = $el<HTMLInputElement>("goto-input");
  const hint    = $("goto-hint");
  if (!overlay || !input) return;

  openGotoLineFn = () => {
    overlay.style.display = "flex";
    input.value = "";
    if (hint) hint.textContent = "";
    input.focus(); input.select();
    ri();
  };
  const close = () => { overlay.style.display = "none"; };

  const jump = () => {
    const line = parseInt(input.value, 10);
    if (isNaN(line) || line < 1) { if (hint) hint.textContent = "Enter a valid line number."; return; }
    const ta = $el<HTMLTextAreaElement>("editor-textarea");
    if (!ta) return;
    const lines = ta.value.split("\n");
    const clamp = Math.min(line, lines.length);
    let pos = 0;
    for (let i = 0; i < clamp - 1; i++) pos += lines[i].length + 1;
    ta.setSelectionRange(pos, pos + (lines[clamp - 1]?.length ?? 0));
    ta.focus();
    const lineH = ta.scrollHeight / (lines.length || 1);
    ta.scrollTop = Math.max(0, lineH * (clamp - 1) - ta.clientHeight / 2);
    close();
  };

  input.addEventListener("input", () => {
    const n = parseInt(input.value, 10);
    const ta = $el<HTMLTextAreaElement>("editor-textarea");
    const total = ta?.value.split("\n").length ?? 0;
    if (hint) hint.textContent = (!isNaN(n) && total) ? `Line ${Math.min(n, total)} of ${total}` : "";
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); jump(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "g") { e.preventDefault(); open(); }
  });
}

// ── Explorer context menu ─────────────────────────────────────────────────────
let ctxMenuTarget = { path: "", isDir: false };

function hideCtxMenu(): void {
  const m = $("ctx-menu"); if (m) m.style.display = "none";
}

function showCtxMenu(x: number, y: number, path: string, isDir: boolean): void {
  ctxMenuTarget = { path, isDir };
  const m = $("ctx-menu"); if (!m) return;
  m.style.display = "block";
  // Position: keep on screen
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = 180, h = 200;
  m.style.left = Math.min(x, vw - w - 8) + "px";
  m.style.top  = Math.min(y, vh - h - 8) + "px";
  ri();
}

function initExplorerContextMenu(): void {
  document.addEventListener("click", hideCtxMenu);
  document.addEventListener("contextmenu", e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".tree-file, .tree-dir");
    if (!el) { hideCtxMenu(); return; }
    e.preventDefault();
    const path = el.dataset.file ?? el.dataset.dir ?? "";
    const isDir = el.classList.contains("tree-dir");
    showCtxMenu(e.clientX, e.clientY, path, isDir);
  });

  // New File
  $("ctxm-new-file")?.addEventListener("click", async () => {
    hideCtxMenu();
    const base = ctxMenuTarget.isDir ? ctxMenuTarget.path : ctxMenuTarget.path.includes("/")
      ? ctxMenuTarget.path.slice(0, ctxMenuTarget.path.lastIndexOf("/")) : "";
    const name = prompt("New file name:");
    if (!name?.trim()) return;
    const rel = base ? `${base}/${name.trim()}` : name.trim();
    const res = await fetch(`${API}/api/file/create`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: rel, isDir: false }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast(`Created ${rel}`, "success"); loadFileTree().then(() => openFile(rel)); }
    else toast(res.error ?? "Failed to create file", "error");
  });

  // New Folder
  $("ctxm-new-folder")?.addEventListener("click", async () => {
    hideCtxMenu();
    const base = ctxMenuTarget.isDir ? ctxMenuTarget.path : ctxMenuTarget.path.includes("/")
      ? ctxMenuTarget.path.slice(0, ctxMenuTarget.path.lastIndexOf("/")) : "";
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    const rel = base ? `${base}/${name.trim()}` : name.trim();
    const res = await fetch(`${API}/api/file/create`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: rel, isDir: true }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast(`Created folder ${rel}`, "success"); loadFileTree(); }
    else toast(res.error ?? "Failed to create folder", "error");
  });

  // Rename
  $("ctxm-rename")?.addEventListener("click", async () => {
    hideCtxMenu();
    const oldPath = ctxMenuTarget.path;
    const parts = oldPath.split("/");
    const newName = prompt("Rename to:", parts[parts.length - 1]);
    if (!newName?.trim() || newName.trim() === parts[parts.length - 1]) return;
    parts[parts.length - 1] = newName.trim();
    const newPath = parts.join("/");
    const res = await fetch(`${API}/api/file/rename`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: oldPath, to: newPath }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast(`Renamed to ${newPath}`, "success"); loadFileTree(); }
    else toast(res.error ?? "Rename failed", "error");
  });

  // Delete
  $("ctxm-delete")?.addEventListener("click", async () => {
    hideCtxMenu();
    const p = ctxMenuTarget.path;
    if (!confirm(`Delete "${p}"? This cannot be undone.`)) return;
    const res = await fetch(`${API}/api/file/delete`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: p }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast(`Deleted ${p}`, "success"); loadFileTree(); }
    else toast(res.error ?? "Delete failed", "error");
  });

  // Copy path
  $("ctxm-copy-path")?.addEventListener("click", () => {
    hideCtxMenu();
    navigator.clipboard.writeText(ctxMenuTarget.path).then(
      () => toast("Path copied to clipboard", "success"),
      () => toast("Clipboard not available", "error")
    );
  });
}

// ── Git push / pull / branch switcher ────────────────────────────────────────
interface BranchInfo { name: string; active: boolean; remote: boolean; }

async function loadBranches(): Promise<void> {
  const dropdown = $("git-branch-dropdown");
  const list     = $("git-branch-list");
  const search   = $el<HTMLInputElement>("git-branch-search");
  if (!dropdown || !list) return;

  let allBranches: BranchInfo[] = [];
  try {
    const data = await fetch(`${API}/api/git/branches`).then(r => r.json()) as { branches: BranchInfo[]; current: string };
    allBranches = data.branches.filter(b => !b.remote);
  } catch { list.innerHTML = `<li style="color:var(--text-dim);padding:8px 12px">Failed to load branches</li>`; return; }

  const render = (filter = "") => {
    const q = filter.toLowerCase();
    const filtered = allBranches.filter(b => b.name.toLowerCase().includes(q));
    const showCreate = q && !allBranches.some(b => b.name === q);
    list.innerHTML = filtered.map(b =>
      `<li class="${b.active ? "active" : ""}" data-branch="${esc(b.name)}">
        <i data-lucide="git-branch" class="branch-icon"></i>${esc(b.name)}
        ${b.active ? `<i data-lucide="check" style="width:11px;height:11px;margin-left:auto;color:var(--accent)"></i>` : ""}
      </li>`
    ).join("") + (showCreate
      ? `<li class="create-branch" data-create="${esc(q)}"><i data-lucide="plus" class="branch-icon"></i>Create "${esc(q)}"</li>`
      : "");
    list.querySelectorAll<HTMLElement>("li[data-branch]").forEach(li => {
      li.addEventListener("click", async () => {
        const branch = li.dataset.branch ?? "";
        const res = await fetch(`${API}/api/git/checkout`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ branch }),
        }).then(r => r.json()) as { ok?: boolean; error?: string };
        if (res.ok) { toast(`Switched to ${branch}`, "success"); dropdown.style.display = "none"; loadGitStatus(); fetchGitBranch(); ri(); }
        else toast(res.error ?? "Checkout failed", "error");
      });
    });
    list.querySelectorAll<HTMLElement>("li[data-create]").forEach(li => {
      li.addEventListener("click", async () => {
        const branch = li.dataset.create ?? "";
        const res = await fetch(`${API}/api/git/checkout`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ branch, create: true }),
        }).then(r => r.json()) as { ok?: boolean; error?: string };
        if (res.ok) { toast(`Created and switched to ${branch}`, "success"); dropdown.style.display = "none"; loadGitStatus(); fetchGitBranch(); ri(); }
        else toast(res.error ?? "Branch creation failed", "error");
      });
    });
    ri();
  };

  render(search?.value ?? "");
  search?.addEventListener("input", () => render(search.value));
}

function initGitExtra(): void {
  // Push
  $("git-push-btn")?.addEventListener("click", async () => {
    const btn = $el<HTMLButtonElement>("git-push-btn");
    if (btn) { btn.disabled = true; ri(); }
    const res = await fetch(`${API}/api/git/push`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(r => r.json()) as { ok?: boolean; output?: string; error?: string };
    if (btn) { btn.disabled = false; ri(); }
    if (res.ok) toast(res.output || "Pushed successfully", "success");
    else toast(res.error ?? "Push failed", "error");
    loadGitStatus();
  });

  // Pull
  $("git-pull-btn")?.addEventListener("click", async () => {
    const btn = $el<HTMLButtonElement>("git-pull-btn");
    if (btn) { btn.disabled = true; ri(); }
    const res = await fetch(`${API}/api/git/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(r => r.json()) as { ok?: boolean; output?: string; error?: string };
    if (btn) { btn.disabled = false; ri(); }
    if (res.ok) toast(res.output || "Pulled successfully", "success");
    else toast(res.error ?? "Pull failed", "error");
    loadGitStatus();
  });

  // Branch switcher toggle
  const branchBtn = $("git-branch-btn");
  const dropdown  = $("git-branch-dropdown");
  branchBtn?.addEventListener("click", () => {
    if (!dropdown) return;
    const open = dropdown.style.display !== "none";
    dropdown.style.display = open ? "none" : "flex";
    if (!open) { loadBranches(); $el<HTMLInputElement>("git-branch-search")?.focus(); }
  });

  // Fetch
  $("git-fetch-btn")?.addEventListener("click", async () => {
    const btn = $el<HTMLButtonElement>("git-fetch-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; ri(); }
    const res = await fetch(`${API}/api/git/fetch`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(r => r.json()) as { ok?: boolean; error?: string };
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="download-cloud"></i> Fetch'; ri(); }
    if (res.ok) toast("Fetched remote refs", "success");
    else toast(res.error ?? "Fetch failed", "error");
    loadGitStatus();
  });

  // Stash push
  $("git-stash-btn")?.addEventListener("click", async () => {
    const res = await fetch(`${API}/api/git/stash`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "push" }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast("Stashed changes", "success"); loadGitStatus(); }
    else toast(res.error ?? "Stash failed", "error");
  });

  // Stash pop
  $("git-stash-pop-btn")?.addEventListener("click", async () => {
    const res = await fetch(`${API}/api/git/stash`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pop" }),
    }).then(r => r.json()) as { ok?: boolean; error?: string };
    if (res.ok) { toast("Stash popped", "success"); loadGitStatus(); }
    else toast(res.error ?? "Pop stash failed", "error");
  });

  // AI commit message generation
  $("git-ai-commit-msg-btn")?.addEventListener("click", async () => {
    const btn = $el<HTMLButtonElement>("git-ai-commit-msg-btn");
    const ta  = $el<HTMLTextAreaElement>("git-commit-msg");
    if (!ta) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Generating…'; ri(); }
    try {
      const resp = await fetch(`${API}/api/git/commit-message`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: selectedModel?.id, provider: selectedModel?.provider }),
      });
      if (!resp.ok || !resp.body) { toast("No staged changes to generate from", "error"); return; }
      ta.value = "";
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, "");
          if (line === "[DONE]") break;
          try { const d = JSON.parse(line); ta.value += d.choices?.[0]?.delta?.content ?? ""; } catch { /* ok */ }
        }
      }
      ta.value = ta.value.trim();
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "AI commit message failed", "error");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="sparkles"></i> AI Message'; ri(); }
    }
  });
}

// ── Terminal panel ─────────────────────────────────────────────────────────────
interface TermSession { id: number; term: unknown; ws: WebSocket; container: HTMLElement; }
let termSessions: TermSession[] = [];
let activeTermId = 0;
let termCounter  = 0;
let createTerminalTabFn: () => void = () => {};
let focusTerminalFn: (id: number) => void = () => {};
let killTerminalFn: (id: number) => void = () => {};

function createTerminalTab(): void { createTerminalTabFn(); }
function focusTerminal(id: number): void { focusTerminalFn(id); }
function killTerminal(id: number): void { killTerminalFn(id); }

function initTerminal(): void {
  const panel     = $("terminal-panel");
  const tabsEl    = $("terminal-tabs");
  const body      = $("terminal-body");
  if (!panel || !tabsEl || !body) return;

  const XTerm = (window as unknown as Record<string, unknown>)["Terminal"] as (new (opts: unknown) => unknown) | undefined;
  const FitAddon = ((window as unknown as Record<string, unknown>)["FitAddon"] as Record<string, unknown> | undefined)?.["FitAddon"] as (new () => unknown) | undefined;
  if (!XTerm) { console.warn("xterm.js not loaded — terminal unavailable"); return; }

  createTerminalTabFn = () => {
    const id = ++termCounter;
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0;display:none;";
    body!.style.position = "relative";
    body!.appendChild(container);

    const term = new XTerm!({ cursorBlink: true, fontSize: 13, fontFamily: "var(--font-mono)", theme: {
      background: "transparent", foreground: "#e8e8f0", cursor: "#3b82f6",
      selectionBackground: "rgba(59,130,246,0.3)",
    }});
    const fit = FitAddon ? new FitAddon!() : null;
    if (fit) (term as Record<string, (a: unknown) => void>)["loadAddon"](fit);
    (term as Record<string, (el: HTMLElement) => void>)["open"](container);
    if (fit) (fit as Record<string, () => void>)["fit"]();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const cols  = (term as Record<string, number>)["cols"]  || 80;
    const rows  = (term as Record<string, number>)["rows"]  || 24;
    const ws    = new WebSocket(`${proto}://${location.host}/terminal?cols=${cols}&rows=${rows}`);
    ws.binaryType = "arraybuffer";

    ws.onmessage = ev => {
      const data = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
      (term as Record<string, (d: string) => void>)["write"](data);
    };
    ws.onclose = () => { (term as Record<string, (d: string) => void>)["write"]("\r\n\x1b[31m[disconnected]\x1b[0m\r\n"); };
    (term as Record<string, (cb: (d: string) => void) => void>)["onData"]((data: string) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const session: TermSession = { id, term, ws, container };
    termSessions.push(session);
    activateTermSession(id);

    // Tab chip
    const chip = document.createElement("div");
    chip.className = "terminal-tab-chip";
    chip.dataset["termId"] = String(id);
    chip.innerHTML = `<span>Terminal ${id}</span><span class="term-close">✕</span>`;
    chip.addEventListener("click", e => {
      const t = e.target as HTMLElement;
      if (t.classList.contains("term-close")) { closeTermSession(id); }
      else { activateTermSession(id); }
    });
    tabsEl!.appendChild(chip);

    // Resize observer
    const ro = new ResizeObserver(() => { if (fit) (fit as Record<string, () => void>)["fit"](); });
    ro.observe(container);
  }

  focusTerminalFn = (id: number) => {
    activateTermSession(id);
  };

  killTerminalFn = (id: number) => {
    closeTermSession(id);
  };

  function activateTermSession(id: number): void {
    activeTermId = id;
    termSessions.forEach(s => {
      s.container.style.display = s.id === id ? "block" : "none";
    });
    tabsEl!.querySelectorAll<HTMLElement>(".terminal-tab-chip").forEach(el => {
      el.classList.toggle("active", el.dataset["termId"] === String(id));
    });
  }

  function closeTermSession(id: number): void {
    const s = termSessions.find(s => s.id === id);
    if (!s) return;
    s.ws.close();
    (s.term as Record<string, () => void>)["dispose"]();
    s.container.remove();
    termSessions = termSessions.filter(s => s.id !== id);
    tabsEl!.querySelector(`[data-term-id="${id}"]`)?.remove();
    if (termSessions.length > 0) activateTermSession(termSessions[termSessions.length - 1].id);
    else { panel!.style.display = "none"; }
  }

  function togglePanel(): void {
    const hidden = panel!.style.display === "none";
    panel!.style.display = hidden ? "flex" : "none";
    if (hidden && termSessions.length === 0) createTerminalTabFn();
    if (hidden && termSessions.length > 0) activateTermSession(activeTermId || termSessions[0].id);
  }

  $("terminal-new-tab")?.addEventListener("click", () => createTerminalTabFn());
  $("terminal-clear")?.addEventListener("click", () => {
    const s = termSessions.find(s => s.id === activeTermId);
    if (s) (s.term as Record<string, () => void>)["clear"]();
  });
  $("terminal-close")?.addEventListener("click", () => { panel!.style.display = "none"; });

  // Ctrl+` shortcut
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); togglePanel(); }
  });

  // Expose globally for command palette
  (window as unknown as Record<string, unknown>)["clarityToggleTerminal"] = togglePanel;
}

// ── In-editor find / replace ──────────────────────────────────────────────────
interface FindState { matches: [number,number][]; idx: number; caseS: boolean; word: boolean; regex: boolean; }
const findState: FindState = { matches: [], idx: 0, caseS: false, word: false, regex: false };
let openFindFn: (showReplace?: boolean) => void = () => {};
function openFind(showReplace = false): void { openFindFn(showReplace); }

function buildFindPattern(q: string): RegExp | null {
  if (!q) return null;
  try {
    const src = findState.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordSrc = findState.word ? `\\b${src}\\b` : src;
    return new RegExp(wordSrc, findState.caseS ? "g" : "gi");
  } catch { return null; }
}

function runFind(q: string): void {
  const ta = $el<HTMLTextAreaElement>("editor-content");
  const countEl = $("find-count");
  if (!ta) return;
  findState.matches = [];
  const pat = buildFindPattern(q);
  if (pat) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(ta.value)) !== null) findState.matches.push([m.index, m.index + m[0].length]);
  }
  if (countEl) countEl.textContent = findState.matches.length ? `${findState.idx + 1}/${findState.matches.length}` : (q ? "0 results" : "");
}

function jumpToMatch(idx: number): void {
  const ta = $el<HTMLTextAreaElement>("editor-content");
  const countEl = $("find-count");
  if (!ta || !findState.matches.length) return;
  findState.idx = ((idx % findState.matches.length) + findState.matches.length) % findState.matches.length;
  const [start, end] = findState.matches[findState.idx];
  ta.focus();
  ta.setSelectionRange(start, end);
  const lineH = ta.scrollHeight / (ta.value.split("\n").length || 1);
  const lineIdx = ta.value.slice(0, start).split("\n").length - 1;
  ta.scrollTop = Math.max(0, lineH * lineIdx - ta.clientHeight / 2);
  if (countEl) countEl.textContent = `${findState.idx + 1}/${findState.matches.length}`;
}

function initEditorFind(): void {
  const bar     = $("editor-find-bar");
  const findIn  = $el<HTMLInputElement>("find-input");
  const replIn  = $el<HTMLInputElement>("replace-input");
  const repFld  = $("find-replace-field");
  if (!bar || !findIn) return;

  openFindFn = (showReplace = false) => {
    bar.style.display = "";
    if (repFld) repFld.style.display = showReplace ? "" : "none";
    const ta = $el<HTMLTextAreaElement>("editor-content");
    const sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
    if (sel) findIn.value = sel;
    findIn.focus(); findIn.select();
    runFind(findIn.value);
  };
  const openLocal = openFindFn;
  const closeFind = () => { bar.style.display = "none"; $el<HTMLTextAreaElement>("editor-content")?.focus(); };

  $("find-close")?.addEventListener("click", closeFind);

  const toggleOpt = (key: "caseS"|"word"|"regex", id: string) => {
    findState[key] = !findState[key];
    $(`find-opt-${id === "find-opt-case" ? "case" : id === "find-opt-word" ? "word" : "regex"}`)?.classList.toggle("active", findState[key]);
    runFind(findIn.value);
  };
  $("find-opt-case")?.addEventListener("click",  () => { findState.caseS = !findState.caseS;  $("find-opt-case")?.classList.toggle("active", findState.caseS);  runFind(findIn.value); });
  $("find-opt-word")?.addEventListener("click",  () => { findState.word  = !findState.word;   $("find-opt-word")?.classList.toggle("active", findState.word);   runFind(findIn.value); });
  $("find-opt-regex")?.addEventListener("click", () => { findState.regex = !findState.regex;  $("find-opt-regex")?.classList.toggle("active", findState.regex); runFind(findIn.value); });
  void toggleOpt; // suppress unused warning

  findIn.addEventListener("input", () => { findState.idx = 0; runFind(findIn.value); });
  findIn.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); jumpToMatch(e.shiftKey ? findState.idx - 1 : findState.idx + 1); }
    if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  $("find-prev")?.addEventListener("click", () => jumpToMatch(findState.idx - 1));
  $("find-next")?.addEventListener("click", () => jumpToMatch(findState.idx + 1));

  // Replace one
  $("replace-one")?.addEventListener("click", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta || !findState.matches.length || !replIn) return;
    const [s, e2] = findState.matches[findState.idx];
    ta.setSelectionRange(s, e2);
    ta.focus();
    document.execCommand("insertText", false, replIn.value);
    runFind(findIn.value);
    jumpToMatch(findState.idx);
  });

  // Replace all
  $("replace-all")?.addEventListener("click", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta || !replIn) return;
    const pat = buildFindPattern(findIn.value);
    if (!pat) return;
    ta.value = ta.value.replace(pat, replIn.value);
    ta.dispatchEvent(new Event("input"));
    runFind(findIn.value);
    toast(`Replaced all occurrences`, "success");
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "f") { e.preventDefault(); openLocal(false); }
    if (mod && e.key === "h") { e.preventDefault(); openLocal(true); }
    if (e.key === "F3" && bar.style.display !== "none") {
      e.preventDefault(); jumpToMatch(e.shiftKey ? findState.idx - 1 : findState.idx + 1);
    }
    if (e.key === "Escape" && bar.style.display !== "none") closeFind();
  });
}

// ── Welcome screen ────────────────────────────────────────────────────────────
async function updateWelcome(): Promise<void> {
  const welcome = $("editor-welcome");
  if (!welcome) return;
  if (activeFilePath) { welcome.classList.add("hidden"); return; }
  welcome.classList.remove("hidden");

  const container = $("welcome-recent");
  if (!container) return;

  const desktop = (window as any).clarityDesktop;
  let recentHTML = "";

  // Get recents from desktop API if available
  if (desktop?.getRecents) {
    try {
      const recents = await desktop.getRecents();

      // Recent Folders
      if (recents.folders?.length > 0) {
        recentHTML += `<div class="welcome-recent-title">Recent Folders</div>` +
          recents.folders.map((folder: string) => {
            const name = folder.split(/[/\\]/).pop() ?? folder;
            return `<div class="welcome-recent-item welcome-recent-folder" data-folder="${esc(folder)}">
              <i data-lucide="folder"></i><span>${esc(name)}</span>
              <span class="welcome-recent-path">${esc(folder)}</span>
            </div>`;
          }).join("");
      }

      // Recent Files
      if (recents.files?.length > 0) {
        if (recents.folders?.length > 0) recentHTML += `<div class="welcome-recent-separator"></div>`;
        recentHTML += `<div class="welcome-recent-title">Recent Files</div>` +
          recents.files.map((file: string) => {
            const name = file.split(/[/\\]/).pop() ?? file;
            const dir = file.includes("/") || file.includes("\\") ? file.slice(0, file.lastIndexOf(file.includes("/") ? "/" : "\\")) : "";
            return `<div class="welcome-recent-item welcome-recent-file" data-file="${esc(file)}">
              <i data-lucide="file-code"></i><span>${esc(name)}</span>
              ${dir ? `<span class="welcome-recent-path">${esc(dir)}</span>` : ""}
            </div>`;
          }).join("");
      }
    } catch (e) {
      console.error("[clarity] Failed to load desktop recents:", e);
    }
  }

  // Session recent files (open tabs from current session)
  const sessionRecent = openTabs.filter(Boolean);
  if (sessionRecent.length > 0) {
    if (recentHTML) recentHTML += `<div class="welcome-recent-separator"></div>`;
    recentHTML += `<div class="welcome-recent-title">Current Session</div>` +
      sessionRecent.map(p => {
        const name = p.split("/").pop() ?? p;
        const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
        return `<div class="welcome-recent-item" data-file="${esc(p)}">
          <i data-lucide="file-code"></i><span>${esc(name)}</span>
          ${dir ? `<span class="welcome-recent-path">${esc(dir)}</span>` : ""}
        </div>`;
      }).join("");
  }

  if (recentHTML) {
    container.innerHTML = recentHTML;

    // Wire up folder clicks
    container.querySelectorAll<HTMLElement>(".welcome-recent-folder").forEach(el => {
      el.addEventListener("click", () => {
        const folder = el.dataset.folder ?? "";
        if (desktop?.openFolder) {
          // Use desktop API to open folder
          desktop.openFolder().then(() => {
            // Folder change will trigger page reload via server restart
          });
        }
      });
    });

    // Wire up file clicks
    container.querySelectorAll<HTMLElement>(".welcome-recent-item[data-file]").forEach(el => {
      el.addEventListener("click", () => openFile(el.dataset.file ?? ""));
    });

    ri();
  } else {
    container.innerHTML = `<div class="welcome-empty">No recent files. Open a folder to get started.</div>`;
  }
}

function initWelcome(): void {
  $("welcome-open-palette")?.addEventListener("click", openPalette);
  $("welcome-open-search")?.addEventListener("click", () => {
    document.querySelector<HTMLElement>(".activity-btn[data-view='search']")?.click();
    $el<HTMLInputElement>("search-input")?.focus();
  });

  // Desktop integration for opening folders/files
  initDesktopIntegration();
}

// ── Desktop Integration ─────────────────────────────────────────────────────────
function initDesktopIntegration(): void {
  const desktop = (window as any).clarityDesktop;
  if (!desktop?.isDesktop) return;

  // Subscribe to show-welcome events from main process
  if (desktop.onShowWelcome) {
    desktop.onShowWelcome(() => {
      activeFilePath = "";
      openTabs = [];
      renderTabs();
      renderFileTree();
      updateWelcome();
      // Reload file tree for the new (empty) workspace
      loadFileTree();
    });
  }

  // Subscribe to file open events from main process
  if (desktop.onOpenFile) {
    desktop.onOpenFile((filePath: string) => {
      openFile(filePath);
    });
  }

  // Handle startup file if passed from CLI
  handleStartupFile();

  // Initialize menu event handlers
  initMenuHandlers();
}

// ── Menu Event Handlers ─────────────────────────────────────────────────────────
function initMenuHandlers(): void {
  const desktop = (window as any).clarityDesktop;
  if (!desktop?.onMenuEvent) return;

  const on = (channel: string, handler: (...args: any[]) => void) => {
    desktop.onMenuEvent(channel, handler);
  };

  // File menu handlers
  on("menu-new-file", () => {
    // Create a new untitled file
    const untitled = "untitled-" + Date.now() + ".txt";
    activeFilePath = untitled;
    openTabs.push(untitled);
    renderTabs();
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (ta) {
      ta.value = "";
      ta.focus();
    }
    editorDirty = true;
    renderTabs();
  });

  on("menu-save", () => saveCurrentFile());
  on("menu-save-all", () => saveAllFiles());
  on("menu-auto-save", (checked: boolean) => {
    settings.autoSave = checked;
    saveSettings();
  });
  on("menu-close-file", () => {
    if (activeFilePath) closeTab(activeFilePath);
  });
  on("menu-close-all", () => {
    [...openTabs].forEach(tab => closeTab(tab));
  });

  // Edit menu handlers
  on("menu-find", () => openFindFn(false));
  on("menu-find-replace", () => openFindFn(true));
  on("menu-find-next", () => jumpToMatch(findState.idx + 1));
  on("menu-find-prev", () => jumpToMatch(findState.idx - 1));
  on("menu-goto-line", () => openGotoLine());
  on("menu-goto-file", () => openPalette());
  on("menu-goto-symbol", () => { /* Hide - requires LSP */ });
  on("menu-paste-plain", () => {
    // Paste as plain text by default (browser handles this)
    document.execCommand("paste");
  });
  on("menu-select-all", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (ta) ta.select();
  });

  // Selection menu handlers
  on("menu-select-line", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) return;
    const lines = ta.value.split("\n");
    let pos = ta.selectionStart;
    let lineStart = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineEnd = lineStart + lines[i].length + 1;
      if (pos >= lineStart && pos < lineEnd) {
        ta.setSelectionRange(lineStart, lineEnd - 1);
        break;
      }
      lineStart = lineEnd;
    }
  });

  on("menu-select-word", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) return;
    const text = ta.value;
    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    // Expand to word boundaries
    while (start > 0 && /\w/.test(text[start - 1])) start--;
    while (end < text.length && /\w/.test(text[end])) end++;
    ta.setSelectionRange(start, end);
  });

  on("menu-expand-selection", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    const text = ta.value;
    let start = ta.selectionStart;
    let end = ta.selectionEnd;
    // Simple expand: word -> line -> paragraph -> all
    if (start === end) {
      // Expand to word
      while (start > 0 && /\w/.test(text[start - 1])) start--;
      while (end < text.length && /\w/.test(text[end])) end++;
    } else if (end < text.length && text[end] !== "\n") {
      // Expand to line
      while (start > 0 && text[start - 1] !== "\n") start--;
      while (end < text.length && text[end] !== "\n") end++;
    }
    ta.setSelectionRange(start, end);
  });
  on("menu-shrink-selection", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const len = end - start;
    if (len > 0) ta.setSelectionRange(start + Math.floor(len * 0.1), end - Math.floor(len * 0.1));
  });
  on("menu-select-next", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    selectNextOccurrence(ta);
  });
  on("menu-copy-line-up", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    copyLine(ta, "up");
  });
  on("menu-copy-line-down", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    copyLine(ta, "down");
  });
  on("menu-move-line-up", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    moveLine(ta, "up");
  });
  on("menu-move-line-down", () => {
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    moveLine(ta, "down");
  });
  on("menu-cursor-above", () => { /* TODO: Multi-cursor support */ });
  on("menu-cursor-below", () => { /* TODO: Multi-cursor support */ });
  on("menu-cursor-ends", () => { /* TODO: Multi-cursor support */ });

  // View menu handlers
  on("menu-command-palette", () => openPalette());
  on("menu-quick-open", () => openPalette());
  on("menu-toggle-explorer", () => switchSidePanel("explorer"));
  on("menu-toggle-search", () => switchSidePanel("search"));
  on("menu-toggle-git", () => switchSidePanel("git"));
  on("menu-toggle-chat", () => switchView("chat"));
  on("menu-toggle-terminal", () => toggleTerminal());
  on("menu-toggle-problems", () => { /* Hide - requires LSP */ });
  on("menu-show-commands", () => openPalette());
  on("menu-toggle-sidebar", () => {
    const sidebar = $("sidebar");
    if (sidebar) sidebar.classList.toggle("hidden");
  });
  on("menu-toggle-ai-panel", () => {
    const agent = $("agent-sidebar");
    if (agent) agent.classList.toggle("hidden");
  });
  on("menu-toggle-status-bar", () => {
    const sb = $("status-bar");
    if (sb) sb.classList.toggle("hidden");
  });
  on("menu-zoom-in", () => {
    settings.fontSize = Math.min(settings.fontSize + 1, 24);
    applySettings();
    saveSettings();
  });
  on("menu-zoom-out", () => {
    settings.fontSize = Math.max(settings.fontSize - 1, 8);
    applySettings();
    saveSettings();
  });
  on("menu-zoom-reset", () => {
    settings.fontSize = 13;
    applySettings();
    saveSettings();
  });
  on("menu-word-wrap", (checked: boolean) => {
    settings.wordWrap = checked;
    applySettings();
    saveSettings();
  });
  on("menu-line-numbers", (checked: boolean) => {
    settings.lineNumbers = checked;
    applySettings();
    saveSettings();
  });
  on("menu-minimap", () => { /* Hide - planned for v1.2 */ });
  on("menu-breadcrumbs", () => { /* Hide - planned for v1.2 */ });
  on("menu-whitespace", () => { /* Hide - visual preference only */ });

  // Go menu handlers
  on("menu-nav-back", () => { /* TODO: Editor history stack */ });
  on("menu-nav-forward", () => { /* TODO: Editor history stack */ });
  on("menu-last-edit", () => { /* TODO: Track last edit position */ });
  on("menu-next-editor", () => {
    if (openTabs.length < 2) return;
    const idx = openTabs.indexOf(activeFilePath);
    const next = openTabs[(idx + 1) % openTabs.length];
    if (next) openFile(next);
  });
  on("menu-prev-editor", () => {
    if (openTabs.length < 2) return;
    const idx = openTabs.indexOf(activeFilePath);
    const prev = openTabs[(idx - 1 + openTabs.length) % openTabs.length];
    if (prev) openFile(prev);
  });
  on("menu-next-used", () => { /* Hide - requires editor history */ });
  on("menu-prev-used", () => { /* Hide - requires editor history */ });
  on("menu-group", () => { /* Hide - requires editor groups */ });
  on("menu-goto-symbol-workspace", () => { /* Hide - requires LSP */ });
  on("menu-goto-def", () => { /* Hide - requires LSP */ });
  on("menu-goto-type-def", () => { /* Hide - requires LSP */ });
  on("menu-goto-impl", () => { /* Hide - requires LSP */ });
  on("menu-goto-refs", () => { /* Hide - requires LSP */ });
  on("menu-goto-bracket", () => {
    // Jump between matching brackets
    const ta = $el<HTMLTextAreaElement>("editor-content"); if (!ta) return;
    const text = ta.value;
    const pos = ta.selectionStart;
    const PAIRS: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{" };
    const char = text[pos];
    const match = PAIRS[char];
    if (!match) return;
    let depth = 1;
    if ("({[".includes(char)) {
      // Forward search
      for (let i = pos + 1; i < text.length; i++) {
        if (text[i] === char) depth++;
        else if (text[i] === match) { depth--; if (depth === 0) { ta.selectionStart = ta.selectionEnd = i; break; } }
      }
    } else {
      // Backward search
      for (let i = pos - 1; i >= 0; i--) {
        if (text[i] === char) depth++;
        else if (text[i] === match) { depth--; if (depth === 0) { ta.selectionStart = ta.selectionEnd = i; break; } }
      }
    }
  });

  // Run menu handlers (hide until implemented)
  on("menu-debug-start", () => { /* Hide - debugger not implemented */ });
  on("menu-run", () => { /* Hide - runner not implemented */ });
  on("menu-stop", () => { /* Hide - runner not implemented */ });
  on("menu-restart", () => { /* Hide - runner not implemented */ });
  on("menu-build", () => { /* Hide - build system not implemented */ });
  on("menu-test", () => { /* Hide - test runner not implemented */ });
  on("menu-ai-explain", () => {
    switchView("chat");
    addSlashCommand("/explain");
  });
  on("menu-ai-fix", () => {
    switchView("chat");
    addSlashCommand("/fix");
  });
  on("menu-ai-test", () => {
    switchView("chat");
    addSlashCommand("/test");
  });
  on("menu-ai-docstring", () => {
    switchView("chat");
    addSlashCommand("/docstring");
  });
  on("menu-ai-improve", () => {
    switchView("chat");
    addSlashCommand("/improve");
  });
  on("menu-composer", () => {
    switchView("composer");
    setTimeout(() => $("composer-generate")?.click(), 80);
  });

  // Terminal menu handlers
  on("menu-new-terminal", () => {
    const panel = $("terminal-panel");
    if (panel) panel.style.display = "flex";
    createTerminalTab();
  });
  on("menu-split-terminal", () => { /* Hide - split terminal not implemented */ });
  on("menu-kill-terminal", () => {
    if (activeTermId) killTerminal(activeTermId);
  });
  on("menu-focus-terminal", () => {
    const panel = $("terminal-panel");
    if (panel) {
      panel.style.display = "flex";
      focusTerminal(activeTermId);
    }
  });
  on("menu-focus-editor", () => {
    $el<HTMLTextAreaElement>("editor-content")?.focus();
  });
  on("menu-clear-terminal", () => {
    const s = termSessions.find(s => s.id === activeTermId);
    if (s) {
      (s.term as Record<string, (d: string) => void>)["write"]("\r\n\x1b[2J\x1b[H");
    }
  });
  on("menu-select-all-terminal", () => { /* TODO: Terminal select all */ });
  on("menu-run-selected", () => {
    // Run selected text in terminal
    const ta = $el<HTMLTextAreaElement>("editor-content");
    if (!ta) return;
    const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    if (!selected) { toast("No text selected", "error"); return; }
    const panel = $("terminal-panel");
    if (panel) panel.style.display = "flex";
    createTerminalTab();
    setTimeout(() => {
      const s = termSessions.find(s => s.id === activeTermId);
      if (s && selected) {
        const term = s.term as unknown as { paste: (d: string) => void; keyDown: (e: { key: string; domEvent: KeyboardEvent }) => void };
        if (term.paste) {
          term.paste(selected);
          // Simulate Enter key
          setTimeout(() => term.keyDown?.({ key: "Enter", domEvent: new KeyboardEvent("keydown", { key: "Enter" }) }), 50);
        }
      }
    }, 200);
  });
  on("menu-run-file", () => { /* Hide - requires language detection */ });

  // Help menu handlers
  on("menu-ai-ask", () => {
    switchView("chat");
    $el<HTMLTextAreaElement>("chat-input")?.focus();
  });
  on("menu-toggle-context", () => switchView("context"));
  on("menu-check-update", () => { /* Hide - auto-updater not implemented */ });
  on("menu-keyboard-ref", () => { $("settings-overlay")?.classList.add("open"); $("sec-keybindings")?.classList.add("active"); });
  on("menu-process-explorer", () => { /* Hide - process explorer not implemented */ });
}

// Helper function to add slash command to chat input
function addSlashCommand(cmd: string): void {
  const input = $el<HTMLTextAreaElement>("chat-input");
  if (!input) return;
  input.value = cmd + " " + input.value;
  input.focus();
}

// Helper function to save all files
async function saveAllFiles(): Promise<void> {
  // In a real implementation, this would track all dirty tabs
  await saveCurrentFile();
  showToast("All files saved");
}

// Helper toast function for compatibility
function showToast(msg: string, type: "success" | "error" | "info" = "info"): void {
  toast(msg, type);
}

// Helper to close a tab
function closeTab(path: string): void {
  const idx = openTabs.indexOf(path);
  if (idx === -1) return;
  // Check if dirty and confirm
  if (path === activeFilePath && editorDirty) {
    // Could add confirm dialog here
    saveCurrentFile();
  }
  openTabs.splice(idx, 1);
  if (activeFilePath === path) {
    activeFilePath = openTabs[openTabs.length - 1] || "";
    if (activeFilePath) openFile(activeFilePath);
    else {
      renderTabs();
      updateWelcome();
    }
  } else {
    renderTabs();
  }
}

// Helper function to toggle terminal
function toggleTerminal(): void {
  const panel = $("terminal-panel");
  if (!panel) return;
  const isVisible = panel.style.display !== "none";
  panel.style.display = isVisible ? "none" : "flex";
  if (!isVisible) {
    focusTerminal(activeTermId);
  }
}

async function handleStartupFile(): Promise<void> {
  const desktop = (window as any).clarityDesktop;
  if (!desktop?.getStartupFile) return;

  try {
    const startupFile = await desktop.getStartupFile();
    if (startupFile) {
      // Small delay to ensure file tree is loaded
      setTimeout(() => openFile(startupFile), 500);
    }
  } catch (e) {
    console.error("[clarity] Failed to get startup file:", e);
  }
}

// ── Slash commands ────────────────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: "/explain", icon: "help-circle",  desc: "Explain the selected code or active file" },
  { cmd: "/fix",     icon: "wrench",       desc: "Find and fix bugs in the active file" },
  { cmd: "/test",    icon: "flask-conical",desc: "Generate unit tests for the active file" },
  { cmd: "/summarize", icon: "archive",    desc: "Summarize the conversation history" },
  { cmd: "/improve", icon: "sparkles",     desc: "Improve code quality and readability" },
  { cmd: "/docstring", icon: "book-open",  desc: "Generate docstrings for functions in active file" },
] as const;

type SlashCmd = typeof SLASH_COMMANDS[number];

function expandSlashCommand(cmd: string): string {
  const fileName = activeFilePath ? `\`${activeFilePath.split("/").pop()}\`` : "the active file";
  const map: Record<string, string> = {
    "/explain":   `Explain the code in ${fileName}. Break down what it does, how it works, and any notable patterns.`,
    "/fix":       `Review ${fileName} for bugs, errors, and issues. List each problem and provide a corrected version.`,
    "/test":      `Generate comprehensive unit tests for ${fileName}. Cover edge cases and main functionality.`,
    "/summarize": `Summarize our conversation so far into key points and decisions made.`,
    "/improve":   `Review ${fileName} and suggest improvements for code quality, readability, and performance.`,
    "/docstring": `Generate JSDoc/docstring comments for all functions and classes in ${fileName}.`,
  };
  return map[cmd] ?? cmd;
}

let slashIdx = 0;

function initSlashCommands(): void {
  const input  = $el<HTMLTextAreaElement>("chat-input");
  const popup  = $("slash-popup");
  if (!input || !popup) return;

  const hide = () => { popup.style.display = "none"; slashIdx = 0; };
  const show = (cmds: readonly SlashCmd[]) => {
    if (!cmds.length) { hide(); return; }
    popup.style.display = "block";
    popup.innerHTML = cmds.map((c, i) =>
      `<div class="slash-item${i === slashIdx ? " selected" : ""}" data-cmd="${esc(c.cmd)}">
        <i data-lucide="${c.icon}"></i>
        <span class="slash-cmd">${esc(c.cmd)}</span>
        <span class="slash-desc">${esc(c.desc)}</span>
      </div>`
    ).join("");
    popup.querySelectorAll<HTMLElement>(".slash-item").forEach(el => {
      el.addEventListener("click", () => {
        const cmd = el.dataset.cmd ?? "";
        input.value = expandSlashCommand(cmd);
        input.dispatchEvent(new Event("input"));
        hide();
        input.focus();
      });
    });
    ri();
  };

  input.addEventListener("input", () => {
    const val = input.value;
    if (!val.startsWith("/")) { hide(); return; }
    const q = val.toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q));
    slashIdx = 0;
    show(filtered);
  });

  input.addEventListener("keydown", e => {
    if (popup.style.display === "none") return;
    const items = popup.querySelectorAll<HTMLElement>(".slash-item");
    if (e.key === "ArrowDown")  { e.preventDefault(); slashIdx = (slashIdx + 1) % items.length; show(SLASH_COMMANDS.filter(c => c.cmd.startsWith(input.value.toLowerCase()))); }
    if (e.key === "ArrowUp")    { e.preventDefault(); slashIdx = (slashIdx - 1 + items.length) % items.length; show(SLASH_COMMANDS.filter(c => c.cmd.startsWith(input.value.toLowerCase()))); }
    if (e.key === "Tab" || e.key === "Enter") {
      if (popup.style.display !== "none" && items.length) {
        e.preventDefault();
        const cmd = items[slashIdx]?.dataset.cmd ?? "";
        input.value = expandSlashCommand(cmd);
        input.dispatchEvent(new Event("input"));
        hide();
      }
    }
    if (e.key === "Escape") hide();
  });

  document.addEventListener("click", e => {
    if (!popup.contains(e.target as Node) && e.target !== input) hide();
  });
}

// ── Export session as Markdown ────────────────────────────────────────────────
function initExportSession(): void {
  $("btn-export-session")?.addEventListener("click", () => {
    const sess = getActiveSession();
    if (!sess || !sess.messages.length) { toast("Nothing to export", "info"); return; }
    let md = `# ${sess.title}\n\n`;
    md += `*Exported from Clarity IDE — ${new Date().toLocaleString()}*\n\n---\n\n`;
    if (sess.summaryBlock) md += `## Summary\n${sess.summaryBlock}\n\n---\n\n`;
    for (const m of sess.messages) {
      const role = m.role === "user" ? "**You**" : m.role === "assistant" ? "**Agent**" : "_System_";
      const time = m.ts ? `*${new Date(m.ts).toLocaleTimeString()}*` : "";
      md += `### ${role} ${time}\n\n${m.content}\n\n---\n\n`;
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${sess.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click(); URL.revokeObjectURL(url);
    toast("Session exported as Markdown", "success");
  });
}

// ── Settings search ───────────────────────────────────────────────────────────
function initSettingsSearch(): void {
  const input = $el<HTMLInputElement>("settings-search");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    document.querySelectorAll<HTMLElement>(".setting-row").forEach(row => {
      if (!q) { row.classList.remove("search-hidden"); return; }
      const text = row.textContent?.toLowerCase() ?? "";
      row.classList.toggle("search-hidden", !text.includes(q));
    });
    // Show all sections when searching
    if (q) {
      document.querySelectorAll<HTMLElement>(".settings-section").forEach(s => s.style.display = "");
    }
  });
}

// ── Console capture ───────────────────────────────────────────────────────────
function initErrorCapture(): void {
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(" "));
    if (consoleErrors.length > 50) consoleErrors.shift();
    orig(...args);
  };
  window.addEventListener("error", ev => { consoleErrors.push(`${ev.message} @ ${ev.filename}:${ev.lineno}`); });
  window.addEventListener("unhandledrejection", ev => { consoleErrors.push(`Unhandled: ${ev.reason}`); });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function fetchGitBranch(): Promise<void> {
  try {
    const data = await fetch(`${API}/api/git/branch`).then(r => r.json()) as { branch: string };
    const el = $("status-branch");
    if (el) el.innerHTML = `<i data-lucide="git-branch"></i><span>${esc(data.branch)}</span>`;
    ri();
  } catch { /* keep default */ }
}

async function bootstrap(): Promise<void> {
  loadSettings();
  applySettings();
  initErrorCapture();
  initSettings();
  initActivityBar();
  initSplitters();
  initAgentTabs();
  initEditorActions();
  initTopbar();
  initCommandPalette();
  initChat();
  initComposer();
  initContext();
  initEditor();
  initModels();
  initModelBadge();
  initAgentFiles();
  initKeyboard();
  initSearch();
  initGit();
  initGitExtra();
  initTerminal();
  initTitlebar();
  initGotoLine();
  initExplorerContextMenu();
  initEditorFind();
  initMenuBar();
  initPanelDropdowns();
  initWelcome();
  initSlashCommands();
  initExportSession();
  initSettingsSearch();
  await updateWelcome();
  ri();
  await Promise.all([loadFileTree(), fetchGitBranch()]);
  startHealthPolling();
}

// ── Custom Electron titlebar ──────────────────────────────────────────────────
function initTitlebar(): void {
  const desktop = (window as any).clarityDesktop;
  if (!desktop?.isDesktop) return;

  // macOS-specific titlebar (hidden on other platforms now that we use frameless)
  const bar = document.getElementById("clarity-titlebar");
  if (bar) {
    // Only show macOS titlebar on macOS
    const isMac = navigator.platform.toLowerCase().includes("mac");
    if (isMac) {
      bar.style.display = "flex";
      document.body.classList.add("has-titlebar");

      // Wire macOS titlebar buttons
      document.getElementById("tb-minimize")?.addEventListener("click", () => desktop.minimize());
      document.getElementById("tb-maximize")?.addEventListener("click", () => desktop.maximize());
      document.getElementById("tb-close")?.addEventListener("click",    () => desktop.close());

      // Update maximize icon when state changes
      const updateMaxIcon = async () => {
        const isMax = await desktop.isMaximized();
        const btn = document.getElementById("tb-maximize");
        if (!btn) return;
        btn.title = isMax ? "Restore" : "Maximize";
        btn.innerHTML = isMax
          ? `<svg width="11" height="11" viewBox="0 0 12 12"><rect x="3" y="1.5" width="7.5" height="7.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="1.5" y="3" width="7.5" height="7.5" rx="1.2" fill="var(--bg-panel)" stroke="currentColor" stroke-width="1.2"/></svg>`
          : `<svg width="11" height="11" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
      };
      document.getElementById("tb-maximize")?.addEventListener("click", () => setTimeout(updateMaxIcon, 80));
      updateMaxIcon();
    }
  }

  // Wire up main window controls (in topbar) - used on Linux/Windows
  const winControls = $("window-controls");
  if (winControls) {
    $("win-minimize")?.addEventListener("click", () => desktop.minimize());
    $("win-maximize")?.addEventListener("click", () => {
      desktop.maximize();
      setTimeout(updateWinMaxIcon, 80);
    });
    $("win-close")?.addEventListener("click", () => desktop.close());

    // Update maximize icon
    const updateWinMaxIcon = async () => {
      const isMax = await desktop.isMaximized();
      const btn = $("win-maximize");
      if (!btn) return;
      btn.title = isMax ? "Restore" : "Maximize";
      // Toggle between square (maximize) and overlapping squares (restore)
      const icon = btn.querySelector("i");
      if (icon) {
        icon.setAttribute("data-lucide", isMax ? "copy" : "square");
        // Re-render icon if lucide is available
        if ((window as any).lucide) {
          (window as any).lucide.createIcons({ nodes: [btn] });
        }
      }
    };
    updateWinMaxIcon();
  }

  // Show workspace root in center (macOS only, since Linux/Windows use main topbar)
  const label = document.getElementById("tb-workspace-label");
  if (label) {
    fetch(`${API}/api/settings`).then(r => r.json()).then((s: any) => {
      const root = s?.workspaceRoot ?? "";
      label.textContent = root ? root.split("/").pop() ?? root : "Clarity IDE";
      label.title = root;
    }).catch(() => { label.textContent = "Clarity IDE"; });
  }
}

// ── Menu Bar Initialization ───────────────────────────────────────────────────
function initMenuBar(): void {
  const menubar = $("menubar");
  if (!menubar) return;

  // Position dropdowns using fixed positioning
  function positionDropdown(item: HTMLElement): void {
    const dropdown = item.querySelector<HTMLElement>(".menu-dropdown");
    if (!dropdown) return;

    const rect = item.getBoundingClientRect();
    dropdown.style.position = "fixed";
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
  }

  // Close all dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".menu-item")) {
      menubar.querySelectorAll(".menu-item.active").forEach(el => {
        el.classList.remove("active");
      });
    }
  });

  // Wire up menu items
  menubar.querySelectorAll<HTMLElement>(".menu-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const isActive = item.classList.contains("active");
      // Close all others
      menubar.querySelectorAll(".menu-item.active").forEach(el => el.classList.remove("active"));
      // Toggle current and position dropdown
      if (!isActive) {
        item.classList.add("active");
        positionDropdown(item);
      }
    });
  });

  // Wire up menu options
  menubar.querySelectorAll<HTMLElement>(".menu-option").forEach(opt => {
    opt.addEventListener("click", (e) => {
      const action = opt.dataset.action;
      const desktop = (window as any).clarityDesktop;
      const menuItem = (e.target as HTMLElement).closest(".menu-item");

      // Map actions to menu event channels
      const actionMap: Record<string, string> = {
        "new-file": "menu-new-file",
        "new-window": "menu-new-file",
        "open-folder": "menu-toggle-explorer",
        "open-file": "menu-goto-file",
        "save": "menu-save",
        "save-all": "menu-save-all",
        "close-file": "menu-close-file",
        "quit": "menu-close-all",
        "undo": "menu-undo",
        "redo": "menu-redo",
        "cut": "menu-cut",
        "copy": "menu-copy",
        "paste": "menu-paste",
        "find": "menu-find",
        "find-replace": "menu-find-replace",
        "goto-line": "menu-goto-line",
        "select-all": "menu-select-all",
        "select-line": "menu-select-line",
        "select-word": "menu-select-word",
        "command-palette": "menu-command-palette",
        "toggle-explorer": "menu-toggle-explorer",
        "toggle-search": "menu-toggle-search",
        "toggle-git": "menu-toggle-git",
        "toggle-chat": "menu-toggle-chat",
        "toggle-terminal": "menu-toggle-terminal",
        "toggle-sidebar": "menu-toggle-sidebar",
        "toggle-ai-panel": "menu-toggle-ai-panel",
        "toggle-status-bar": "menu-toggle-status-bar",
        "zoom-in": "menu-zoom-in",
        "zoom-out": "menu-zoom-out",
        "zoom-reset": "menu-zoom-reset",
        "goto-file": "menu-goto-file",
        "goto-symbol": "menu-goto-symbol",
        "next-editor": "menu-next-editor",
        "prev-editor": "menu-prev-editor",
        "debug-start": "menu-debug-start",
        "run": "menu-run",
        "ai-explain": "menu-ai-explain",
        "ai-fix": "menu-ai-fix",
        "ai-test": "menu-ai-test",
        "composer": "menu-composer",
        "new-terminal": "menu-new-terminal",
        "focus-terminal": "menu-focus-terminal",
        "clear-terminal": "menu-clear-terminal",
        "kill-terminal": "menu-kill-terminal",
        "welcome": "show-welcome",
        "show-commands": "menu-command-palette",
        "ai-ask": "menu-ai-ask",
        "documentation": "menu-documentation",
        "keyboard-ref": "menu-keyboard-ref",
        "about": "menu-about",
      };

      const channel = actionMap[action ?? ""];
      if (channel) {
        // Trigger via IPC if desktop, or call handler directly
        if (desktop?.onMenuEvent) {
          // Send to main process to come back through onMenuEvent
          // For now, trigger directly through the handlers we set up
          const handlers = (window as any)._menuHandlers?.get(channel);
          if (handlers) {
            handlers.forEach((cb: Function) => cb());
          } else {
            // Try to trigger common actions directly
            handleMenuAction(action ?? "");
          }
        } else {
          handleMenuAction(action ?? "");
        }
      }

      // Close dropdown
      menuItem?.classList.remove("active");
    });
  });
}

// Handle menu actions directly when not using IPC
function handleMenuAction(action: string): void {
  switch (action) {
    case "new-file": {
      const untitled = "untitled-" + Date.now() + ".txt";
      activeFilePath = untitled;
      openTabs.push(untitled);
      renderTabs();
      const ta = $el<HTMLTextAreaElement>("editor-content");
      if (ta) { ta.value = ""; ta.focus(); }
      editorDirty = true;
      renderTabs();
      break;
    }
    case "save": saveCurrentFile(); break;
    case "save-all": saveAllFiles(); break;
    case "close-file": if (activeFilePath) closeTab(activeFilePath); break;
    case "find": openFindFn(false); break;
    case "find-replace": openFindFn(true); break;
    case "goto-line": openGotoLineFn(); break;
    case "select-all": {
      const ta = $el<HTMLTextAreaElement>("editor-content");
      if (ta) ta.select();
      break;
    }
    case "select-line": {
      const ta = $el<HTMLTextAreaElement>("editor-content");
      if (!ta) break;
      const lines = ta.value.split("\n");
      let pos = ta.selectionStart;
      let lineStart = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineEnd = lineStart + lines[i].length + 1;
        if (pos >= lineStart && pos < lineEnd) {
          ta.setSelectionRange(lineStart, lineEnd - 1);
          break;
        }
        lineStart = lineEnd;
      }
      break;
    }
    case "select-word": {
      const ta = $el<HTMLTextAreaElement>("editor-content");
      if (!ta) break;
      const text = ta.value;
      let start = ta.selectionStart;
      let end = ta.selectionEnd;
      while (start > 0 && /\w/.test(text[start - 1])) start--;
      while (end < text.length && /\w/.test(text[end])) end++;
      ta.setSelectionRange(start, end);
      break;
    }
    case "command-palette":
    case "show-commands":
    case "goto-file": openPalette(); break;
    case "toggle-explorer": switchSidePanel("explorer"); break;
    case "toggle-search": switchSidePanel("search"); break;
    case "toggle-git": switchSidePanel("git"); break;
    case "toggle-chat": switchView("chat"); break;
    case "toggle-terminal": toggleTerminal(); break;
    case "toggle-sidebar": {
      const sidebar = $("sidebar");
      if (sidebar) sidebar.classList.toggle("hidden");
      break;
    }
    case "toggle-ai-panel": {
      const agent = $("agent-sidebar");
      if (agent) agent.classList.toggle("hidden");
      break;
    }
    case "toggle-status-bar": {
      const sb = $("status-bar");
      if (sb) sb.classList.toggle("hidden");
      break;
    }
    case "zoom-in":
      settings.fontSize = Math.min(settings.fontSize + 1, 24);
      applySettings(); saveSettings();
      break;
    case "zoom-out":
      settings.fontSize = Math.max(settings.fontSize - 1, 8);
      applySettings(); saveSettings();
      break;
    case "zoom-reset":
      settings.fontSize = 13;
      applySettings(); saveSettings();
      break;
    case "next-editor": {
      if (openTabs.length < 2) break;
      const idx = openTabs.indexOf(activeFilePath);
      const next = openTabs[(idx + 1) % openTabs.length];
      if (next) openFile(next);
      break;
    }
    case "prev-editor": {
      if (openTabs.length < 2) break;
      const idx = openTabs.indexOf(activeFilePath);
      const prev = openTabs[(idx - 1 + openTabs.length) % openTabs.length];
      if (prev) openFile(prev);
      break;
    }
    case "ai-explain":
      switchView("chat");
      addSlashCommand("/explain");
      break;
    case "ai-fix":
      switchView("chat");
      addSlashCommand("/fix");
      break;
    case "ai-test":
      switchView("chat");
      addSlashCommand("/test");
      break;
    case "composer":
      switchView("composer");
      setTimeout(() => $("composer-generate")?.click(), 80);
      break;
    case "ai-ask":
      switchView("chat");
      $el<HTMLTextAreaElement>("chat-input")?.focus();
      break;
    case "welcome": showWelcomeScreen(); break;
    case "new-terminal":
      createTerminalTabFn();
      break;
    case "focus-terminal":
      toggleTerminal();
      break;
    case "clear-terminal": {
      const s = termSessions.find(s => s.id === activeTermId);
      if (s) (s.term as Record<string, (d: string) => void>)["write"]("\r\n\x1b[2J\x1b[H");
      break;
    }
    case "kill-terminal":
      if (activeTermId) killTerminalFn(activeTermId);
      break;
    case "documentation":
      window.open("https://github.com/yourusername/clarity-ide#readme", "_blank");
      break;
    case "keyboard-ref":
      $("settings-overlay")?.classList.add("open");
      break;
    case "about":
      alert("Clarity IDE v1.0.0\nThe AI-native code editor\nMIT License");
      break;
    case "debug-start":
    case "run":
    case "goto-symbol":
      // Hidden - not implemented for v1.0
      break;
  }
}

// ── Panel Dropdowns ────────────────────────────────────────────────────────────
function initPanelDropdowns(): void {
  // Track active dropdown
  let activeDropdown: HTMLElement | null = null;
  let activeBtn: HTMLElement | null = null;

  // Hide all dropdowns
  const hideAll = () => {
    document.querySelectorAll<HTMLElement>(".panel-dropdown").forEach(d => {
      d.style.display = "none";
    });
    document.querySelectorAll<HTMLElement>(".panel-more-btn").forEach(b => {
      b.classList.remove("active");
    });
    activeDropdown = null;
    activeBtn = null;
  };

  // Position dropdown near button
  const positionDropdown = (dropdown: HTMLElement, btn: HTMLElement) => {
    const rect = btn.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
  };

  // Wire up more buttons
  document.querySelectorAll<HTMLElement>(".panel-more-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = btn.dataset.panel;
      const dropdown = $(`panel-dropdown-${panel}`);
      if (!dropdown) return;

      // If already active, hide it
      if (activeDropdown === dropdown) {
        hideAll();
        return;
      }

      // Hide any active dropdown
      hideAll();

      // Show this one
      dropdown.style.display = "block";
      btn.classList.add("active");
      positionDropdown(dropdown, btn);
      activeDropdown = dropdown;
      activeBtn = btn;
    });
  });

  // Handle dropdown item clicks
  document.querySelectorAll<HTMLElement>(".panel-dropdown-item").forEach(item => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      const panel = item.closest<HTMLElement>(".panel-dropdown")?.id?.replace("panel-dropdown-", "");

      // Handle actions
      switch (action) {
        case "refresh":
          if (panel === "explorer") loadFileTree();
          break;
        case "collapse":
          if (panel === "explorer") collapseAllTree();
          break;
        case "new-file":
          if (panel === "explorer") showNewFilePrompt();
          break;
        case "new-folder":
          if (panel === "explorer") showNewFolderPrompt();
          break;
        case "undock":
        case "move-right":
          // Hidden - panel management not implemented for v1.0
          break;
        case "hide":
          if (panel) switchSidePanel(panel);
          break;
        case "toggle-replace":
          $("search-replace-container")?.classList.toggle("hidden");
          break;
        case "clear":
          $("search-results")!.innerHTML = "";
          $("search-result-count")!.textContent = "";
          break;
        case "case-sensitive":
        case "whole-word":
        case "regex":
          // Toggle search flags
          item.classList.toggle("active");
          (item as HTMLElement).style.opacity = item.classList.contains("active") ? "1" : "0.5";
          // Update search options and trigger refresh
          if (action === "case-sensitive") searchOpts.caseSensitive = item.classList.contains("active");
          if (action === "whole-word") searchOpts.wholeWord = item.classList.contains("active");
          if (action === "regex") searchOpts.regex = item.classList.contains("active");
          // Trigger search by dispatching input event
          const searchInput = $el<HTMLInputElement>("search-query");
          if (searchInput?.value) searchInput.dispatchEvent(new Event("input"));
          break;
        case "pull":
          $("git-pull-btn")?.click();
          break;
        case "push":
          $("git-push-btn")?.click();
          break;
        case "fetch":
          $("git-fetch-btn")?.click();
          break;
        case "stash":
          $("git-stash-btn")?.click();
          break;
        case "stash-pop":
          $("git-stash-pop-btn")?.click();
          break;
      }

      hideAll();
    });
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".panel-dropdown") &&
        !(e.target as HTMLElement).closest(".panel-more-btn")) {
      hideAll();
    }
  });

  // Update positions on scroll/resize
  window.addEventListener("scroll", hideAll, true);
  window.addEventListener("resize", hideAll);
}

// Helper functions for panel actions
function collapseAllTree(): void {
  document.querySelectorAll<HTMLElement>(".tree-dir.expanded").forEach(el => {
    el.classList.remove("expanded");
  });
  toast("All folders collapsed");
}

function showNewFilePrompt(): void {
  const name = prompt("Enter file name:");
  if (name) createNewFile(name);
}

function showNewFolderPrompt(): void {
  const name = prompt("Enter folder name:");
  if (name) createNewFolder(name);
}

async function createNewFile(name: string): Promise<void> {
  const rel = name;
  const res = await fetch(`${API}/api/fs/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, isDir: false }),
  }).then(r => r.json()) as { ok?: boolean; error?: string };
  if (res.ok) {
    toast(`Created ${rel}`, "success");
    await loadFileTree();
    await openFile(rel);
  } else {
    toast(res.error ?? "Failed to create file", "error");
  }
}

async function createNewFolder(name: string): Promise<void> {
  const rel = name;
  const res = await fetch(`${API}/api/fs/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, isDir: true }),
  }).then(r => r.json()) as { ok?: boolean; error?: string };
  if (res.ok) {
    toast(`Created folder ${rel}`, "success");
    await loadFileTree();
  } else {
    toast(res.error ?? "Failed to create folder", "error");
  }
}

// ── Floating Panels Manager ────────────────────────────────────────────────────
interface FloatingPanel {
  id: string;
  originalPanel: HTMLElement;
  floatingEl: HTMLElement;
  contentEl: HTMLElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

const floatingPanels = new Map<string, FloatingPanel>();
let panelCounter = 0;

function undockPanel(panelId: string): void {
  const originalPanel = $(`${panelId}-panel`);
  if (!originalPanel) return;

  // Check if already undocked
  if (floatingPanels.has(panelId)) return;

  const container = $("floating-panels-container");
  const template = document.getElementById("floating-panel-template") as HTMLTemplateElement;
  if (!container || !template) return;

  // Clone template
  const clone = template.content.cloneNode(true) as DocumentFragment;
  const floatingEl = clone.querySelector(".floating-panel") as HTMLElement;
  if (!floatingEl) return;

  // Set unique ID
  const instanceId = `floating-${panelId}-${++panelCounter}`;
  floatingEl.id = instanceId;

  // Position near the original panel
  const rect = originalPanel.getBoundingClientRect();
  const x = Math.min(rect.left + 50, window.innerWidth - 340);
  const y = Math.min(rect.top + 50, window.innerHeight - 420);

  floatingEl.style.left = `${x}px`;
  floatingEl.style.top = `${y}px`;

  // Set title
  const titleEl = floatingEl.querySelector(".floating-panel-title");
  if (titleEl) {
    titleEl.textContent = panelId === "explorer" ? "Explorer" :
                         panelId === "search" ? "Search" :
                         panelId === "git" ? "Source Control" : panelId;
  }

  // Move content
  const contentEl = floatingEl.querySelector(".floating-panel-content") as HTMLElement;
  if (contentEl) {
    // Clone the panel content
    const panelContent = originalPanel.cloneNode(true) as HTMLElement;
    panelContent.style.display = "flex";
    panelContent.style.height = "100%";
    contentEl.appendChild(panelContent);
  }

  // Wire up buttons
  const dockBtn = floatingEl.querySelector(".dock-btn");
  dockBtn?.addEventListener("click", () => dockPanel(panelId));

  const closeBtn = floatingEl.querySelector(".close-btn");
  closeBtn?.addEventListener("click", () => closeFloatingPanel(panelId));

  // Make draggable
  makePanelDraggable(floatingEl, instanceId);

  // Make resizable
  makePanelResizable(floatingEl, instanceId);

  // Add to container
  container.appendChild(floatingEl);

  // Store reference
  floatingPanels.set(panelId, {
    id: instanceId,
    originalPanel,
    floatingEl,
    contentEl: contentEl!,
    x,
    y,
    width: 320,
    height: 400
  });

  // Hide original
  originalPanel.style.display = "none";

  // Re-initialize icons
  if ((window as any).lucide) {
    (window as any).lucide.createIcons({ nodes: [floatingEl] });
  }

  toast(`${panelId} panel undocked`, "success");
}

function dockPanel(panelId: string): void {
  const panel = floatingPanels.get(panelId);
  if (!panel) return;

  // Show original
  panel.originalPanel.style.display = "";

  // Remove floating
  panel.floatingEl.remove();

  // Remove from map
  floatingPanels.delete(panelId);

  // If this panel was active, make sure it's visible
  switchSidePanel(panelId);

  toast(`${panelId} panel docked`, "success");
}

function closeFloatingPanel(panelId: string): void {
  const panel = floatingPanels.get(panelId);
  if (!panel) return;

  // Remove floating panel
  panel.floatingEl.remove();

  // Remove from map
  floatingPanels.delete(panelId);

  // Show original back
  panel.originalPanel.style.display = "";
}

function makePanelDraggable(el: HTMLElement, id: string): void {
  const header = el.querySelector(".floating-panel-header") as HTMLElement | null;
  if (!header) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialX = 0;
  let initialY = 0;

  header.addEventListener("mousedown", (e) => {
    const evt = e as MouseEvent;
    isDragging = true;
    startX = evt.clientX;
    startY = evt.clientY;
    initialX = el.offsetLeft;
    initialY = el.offsetTop;
    el.classList.add("dragging");
    evt.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const evt = e as MouseEvent;
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;

    el.style.left = `${initialX + dx}px`;
    el.style.top = `${initialY + dy}px`;

    // Update stored position
    const panel = Array.from(floatingPanels.values()).find(p => p.floatingEl === el);
    if (panel) {
      panel.x = initialX + dx;
      panel.y = initialY + dy;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      el.classList.remove("dragging");
    }
  });
}

function makePanelResizable(el: HTMLElement, id: string): void {
  const handle = el.querySelector(".floating-panel-resize-handle") as HTMLElement | null;
  if (!handle) return;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let initialWidth = 0;
  let initialHeight = 0;

  handle.addEventListener("mousedown", (e) => {
    const evt = e as MouseEvent;
    isResizing = true;
    startX = evt.clientX;
    startY = evt.clientY;
    initialWidth = el.offsetWidth;
    initialHeight = el.offsetHeight;
    evt.preventDefault();
    evt.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const evt = e as MouseEvent;
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;

    const newWidth = Math.max(240, initialWidth + dx);
    const newHeight = Math.max(200, initialHeight + dy);

    el.style.width = `${newWidth}px`;
    el.style.height = `${newHeight}px`;

    // Update stored size
    const panel = Array.from(floatingPanels.values()).find(p => p.floatingEl === el);
    if (panel) {
      panel.width = newWidth;
      panel.height = newHeight;
    }
  });

  document.addEventListener("mouseup", () => {
    isResizing = false;
  });
}

// Update the undock action in panel dropdowns
function initUndockFeature(): void {
  // Hook into existing dropdown handler
  document.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".panel-dropdown-item");
    if (!item) return;

    const action = item.dataset.action;
    const dropdown = item.closest<HTMLElement>(".panel-dropdown");
    const panelId = dropdown?.id?.replace("panel-dropdown-", "");

    if (action === "undock" && panelId) {
      undockPanel(panelId);
    }
  });
}

// Initialize undock feature
document.addEventListener("DOMContentLoaded", initUndockFeature);

bootstrap();
