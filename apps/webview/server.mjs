import http from "node:http";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");
const argPort = (() => { const i = process.argv.indexOf("--port"); return i !== -1 ? Number(process.argv[i + 1]) : 0; })();
const requestedPort = argPort || Number(process.env.PORT || 5173);
const hasExplicitPort = Boolean(argPort || process.env.PORT);

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const envPath = path.join(workspaceRoot, ".env");
  const envText = fsSync.readFileSync(envPath, "utf-8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
} catch { /* no .env — fine */ }

// ── Provider config ──────────────────────────────────────────────────────────
let GROQ_API_KEY        = process.env.GROQ_API_KEY || "";
let OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY || "";
const GROQ_BASE          = "https://api.groq.com/openai/v1";
const OPENROUTER_BASE    = "https://openrouter.ai/api/v1";

// Fallback: read key saved in .clarity-settings.json at startup
try {
  const sf = JSON.parse(fsSync.readFileSync(path.join(workspaceRoot, ".clarity-settings.json"), "utf-8"));
  if (!GROQ_API_KEY && sf.groqApiKey) GROQ_API_KEY = sf.groqApiKey;
  if (!OPENROUTER_API_KEY && sf.openrouterApiKey) OPENROUTER_API_KEY = sf.openrouterApiKey;
} catch { /* no saved settings yet */ }

const GROQ_FREE_MODELS = [
  { id: "llama-3.3-70b-versatile",       displayName: "Llama 3.3 70B (Groq)" },
  { id: "llama-3.1-8b-instant",          displayName: "Llama 3.1 8B Instant (Groq)" },
  { id: "mixtral-8x7b-32768",            displayName: "Mixtral 8x7B (Groq)" },
  { id: "gemma2-9b-it",                  displayName: "Gemma 2 9B (Groq)" },
  { id: "qwen-qwq-32b",                  displayName: "Qwen QwQ 32B (Groq)" },
];

const OPENROUTER_FREE_MODELS = [
  { id: "meta-llama/llama-3.3-70b-instruct:free",    displayName: "Llama 3.3 70B (OpenRouter)" },
  { id: "meta-llama/llama-3.1-8b-instruct:free",     displayName: "Llama 3.1 8B (OpenRouter)" },
  { id: "google/gemma-3-27b-it:free",                displayName: "Gemma 3 27B (OpenRouter)" },
  { id: "mistralai/mistral-7b-instruct:free",        displayName: "Mistral 7B (OpenRouter)" },
  { id: "deepseek/deepseek-r1:free",                 displayName: "DeepSeek R1 (OpenRouter)" },
  { id: "qwen/qwen3-235b-a22b:free",                 displayName: "Qwen3 235B (OpenRouter)" },
];

const PROVIDERS = {
  lmstudio:    { base: "http://127.0.0.1:1234/v1",  kind: "openai"     },
  ollama:      { base: "http://127.0.0.1:11434",     kind: "ollama"     },
  groq:        { base: GROQ_BASE,                    kind: "groq"       },
  openrouter:  { base: OPENROUTER_BASE,              kind: "openrouter" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function err(res, msg, status = 500) {
  json(res, { error: msg }, status);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

const EXT_LANG = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", cs: "csharp",
  cpp: "cpp", c: "c", md: "markdown", json: "json",
  yaml: "yaml", yml: "yaml", toml: "toml", sh: "bash", html: "html", css: "css",
};

function langFor(filePath) {
  return EXT_LANG[filePath.split(".").pop()?.toLowerCase() ?? ""] ?? "text";
}

const IGNORE = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".cache"]);

async function walkDir(dir, base, results = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs);
    if (e.isDirectory()) {
      await walkDir(abs, base, results);
    } else {
      const stat = await fs.stat(abs).catch(() => null);
      results.push({
        path: rel,
        name: e.name,
        lang: langFor(e.name),
        size: stat?.size ?? 0,
        modifiedMs: stat?.mtimeMs ?? 0,
      });
    }
  }
  return results;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9_$]+/g) ?? []);
}

function bm25Score(queryTerms, docTerms, idf, avgDocLen, k1 = 1.5, b = 0.75) {
  const tf = new Map();
  for (const t of docTerms) tf.set(t, (tf.get(t) ?? 0) + 1);
  const docLen = docTerms.length;
  let score = 0;
  for (const term of new Set(queryTerms)) {
    const termIdf = idf.get(term) ?? 0;
    const termTf = tf.get(term) ?? 0;
    const num = termTf * (k1 + 1);
    const den = termTf + k1 * (1 - b + b * (docLen / avgDocLen));
    score += termIdf * (num / den);
  }
  return score;
}

function buildIdf(corpus) {
  const df = new Map();
  for (const doc of corpus) {
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map();
  const N = corpus.length;
  for (const [t, c] of df) {
    idf.set(t, Math.log((N - c + 0.5) / (c + 0.5) + 1));
  }
  return idf;
}

// Semantic chunking
const BOUNDARIES = {
  typescript: /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+\w/,
  javascript: /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var)\s+\w/,
  python: /^(async\s+)?def\s+\w|^class\s+\w/,
  rust: /^(pub(\s*\([^)]*\))?\s+)?(async\s+)?fn\s+\w|^(pub\s+)?(struct|enum|impl|trait)\s+\w/,
  go: /^func\s+\w|^type\s+\w/,
};

function chunkText(filePath, content, maxTokens = 180, overlap = 15) {
  const lang = langFor(filePath);
  const lines = content.split("\n");
  const pat = BOUNDARIES[lang];
  const splits = [0];
  if (pat) {
    for (let i = 1; i < lines.length; i++) {
      if (pat.test(lines[i].trimStart())) splits.push(i);
    }
  }
  const chunks = [];
  for (let si = 0; si < splits.length; si++) {
    const segEnd = (splits[si + 1] ?? lines.length) - 1;
    let start = splits[si];
    while (start <= segEnd) {
      const seg = [];
      let toks = 0, end = start;
      while (end <= segEnd) {
        const lt = estimateTokens(lines[end]);
        if (toks + lt > maxTokens && seg.length > 0) break;
        seg.push(lines[end]); toks += lt; end++;
      }
      if (seg.length === 0) { end = start + 1; }
      const txt = seg.join("\n");
      if (txt.trim()) {
        chunks.push({ filePath, startLine: start, endLine: end - 1, content: txt, tokens: toks, lang });
      }
      start = Math.max(end - overlap, end);
      if (start >= end) start = end;
    }
  }
  return chunks;
}

// ── Provider API calls ────────────────────────────────────────────────────────
async function providerHealth(name) {
  const p = PROVIDERS[name];
  if (!p) return { ok: false, reason: "unknown provider" };
  try {
    const url = (p.kind === "openai" || p.kind === "groq" || p.kind === "openrouter") ? `${p.base}/models` : `${p.base}/api/tags`;
    const headers = p.kind === "groq" && GROQ_API_KEY ? { Authorization: `Bearer ${GROQ_API_KEY}` }
      : p.kind === "openrouter" && OPENROUTER_API_KEY ? { Authorization: `Bearer ${OPENROUTER_API_KEY}` } : {};
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return r.ok ? { ok: true } : { ok: false, reason: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function listModels(name) {
  const p = PROVIDERS[name];
  if (!p) return [];
  try {
    if (p.kind === "openai") {
      const r = await fetch(`${p.base}/models`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.data ?? []).map(m => ({ id: m.id, provider: name, displayName: m.id }));
    } else {
      const r = await fetch(`${p.base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const d = await r.json();
      return (d.models ?? []).map(m => ({ id: m.name, provider: name, displayName: m.name }));
    }
  } catch { return []; }
}

// Stream Groq SSE (OpenAI-compatible but needs Bearer key)
async function streamGroq(body, res, apiKey) {
  const key = apiKey || GROQ_API_KEY;
  const headers = { "content-type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  if (!key) {
    res.write(`data: ${JSON.stringify({ error: "Groq API key required. Add it in Settings → Providers → Groq API Key." })}\n\n`);
    res.end(); return;
  }
  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!upstream.ok) {
    const txt = await upstream.text().catch(() => upstream.status);
    res.write(`data: ${JSON.stringify({ error: `Groq ${upstream.status}: ${txt}` })}

`);
    res.end(); return;
  }
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === ":") continue;
      if (t.startsWith("data: ")) {
        const data = t.slice(6).trim();
        if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) res.write(`data: ${JSON.stringify({ delta })}

`);
        } catch { /* skip */ }
      }
    }
  }
  res.end();
}

// Stream OpenRouter SSE (OpenAI-compatible + needs Bearer + site headers)
async function streamOpenRouter(body, res, apiKey) {
  const key = apiKey || OPENROUTER_API_KEY;
  if (!key) {
    res.write(`data: ${JSON.stringify({ error: "OpenRouter API key required. Add it in Settings → Providers → OpenRouter API Key." })}\n\n`);
    res.end(); return;
  }
  const upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": "https://clarity-ide.local",
      "X-Title": "Clarity IDE",
    },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!upstream.ok) {
    const txt = await upstream.text().catch(() => upstream.status);
    res.write(`data: ${JSON.stringify({ error: `OpenRouter ${upstream.status}: ${txt}` })}\n\n`);
    res.end(); return;
  }
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === ":") continue;
      if (t.startsWith("data: ")) {
        const data = t.slice(6).trim();
        if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch { /* skip */ }
      }
    }
  }
  res.end();
}

// Stream OpenAI-compatible SSE → pipe to client SSE
async function streamOpenAI(base, body, res) {
  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!upstream.ok) {
    res.write(`data: ${JSON.stringify({ error: `Upstream ${upstream.status}` })}\n\n`);
    res.end(); return;
  }
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === ":") continue;
      if (t.startsWith("data: ")) {
        const data = t.slice(6).trim();
        if (data === "[DONE]") { res.write("data: [DONE]\n\n"); continue; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content ?? "";
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch { /* skip */ }
      }
    }
  }
  res.end();
}

// Stream Ollama NDJSON → pipe to client SSE
async function streamOllama(base, body, res) {
  const upstream = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!upstream.ok) {
    res.write(`data: ${JSON.stringify({ error: `Upstream ${upstream.status}` })}\n\n`);
    res.end(); return;
  }
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const parsed = JSON.parse(t);
        const delta = parsed.message?.content ?? "";
        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        if (parsed.done) { res.write("data: [DONE]\n\n"); }
      } catch { /* skip */ }
    }
  }
  res.end();
}

// ── Route handlers ────────────────────────────────────────────────────────────
async function handleProvidersHealth(req, res) {
  // For Groq, health = we have a key OR we try a lightweight call
  const localKeys = ["lmstudio", "ollama"];
  const results = await Promise.all(
    Object.keys(PROVIDERS).map(async name => {
      if (name === "groq") {
        // Groq is always reachable from internet; treat as ok if key present, warn if not
        return [name, { ok: true, reason: GROQ_API_KEY ? "api key set" : "no key – rate limited" }];
      }
      const h = await providerHealth(name);
      return [name, h];
    })
  );
  json(res, Object.fromEntries(results));
}

async function handleModelsList(req, res) {
  const localResults = await Promise.all(
    ["lmstudio", "ollama"].map(name => listModels(name))
  );
  // Groq models are always available
  const groqModels       = GROQ_FREE_MODELS.map(m => ({ ...m, provider: "groq" }));
  const openrouterModels = OPENROUTER_FREE_MODELS.map(m => ({ ...m, provider: "openrouter" }));
  json(res, [...localResults.flat(), ...groqModels, ...openrouterModels]);
}

// ── Git helpers ───────────────────────────────────────────────────────────────
async function git(args, options = {}) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) =>
    execFile("git", ["-C", workspaceRoot, ...args], { maxBuffer: 4 * 1024 * 1024, ...options },
      (e, out, stderr) => e ? reject(Object.assign(e, { stderr })) : resolve(out))
  );
}

async function handleGitBranch(req, res) {
  try { json(res, { branch: (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim() }); }
  catch { json(res, { branch: "main" }); }
}

async function handleGitStatus(req, res) {
  try {
    const raw = await git(["status", "--porcelain=v1", "-u"]);
    const files = raw.trim().split("\n").filter(Boolean).map(line => ({
      xy: line.slice(0, 2),
      path: line.slice(3).trim(),
      staged:   !" ?!".includes(line[0]),
      unstaged: !" ?!".includes(line[1]),
      untracked: line[0] === "?" && line[1] === "?",
    }));
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    let ahead = 0, behind = 0;
    try {
      const counts = (await git(["rev-list", "--count", "--left-right", "@{u}...HEAD"])).trim();
      const [b, a] = counts.split("\t").map(Number);
      behind = b || 0; ahead = a || 0;
    } catch { /* no upstream */ }
    json(res, { branch, files, ahead, behind });
  } catch (e) { err(res, e.message); }
}

async function handleGitDiff(req, res) {
  const body = await readBody(req);
  const { filePath, staged = false } = body;
  try {
    const args = staged
      ? ["diff", "--cached", "--", filePath]
      : ["diff", "HEAD", "--", filePath];
    const diff = await git(args);
    json(res, { diff: diff || "(no changes)" });
  } catch (e) { err(res, e.message); }
}

async function handleGitLog(req, res) {
  try {
    const raw = await git(["log", "--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%ar", "-n", "30"]);
    const commits = raw.trim().split("\n").filter(Boolean).map(line => {
      const [hash, short, subject, author, rel] = line.split("\x1f");
      return { hash, short, subject, author, rel };
    });
    json(res, commits);
  } catch (e) { err(res, e.message); }
}

async function handleGitStage(req, res) {
  const { filePath } = await readBody(req);
  if (!filePath) return err(res, "filePath required", 400);
  try { await git(["add", "--", filePath]); json(res, { ok: true }); }
  catch (e) { err(res, e.message); }
}

async function handleGitUnstage(req, res) {
  const { filePath } = await readBody(req);
  if (!filePath) return err(res, "filePath required", 400);
  try { await git(["restore", "--staged", "--", filePath]); json(res, { ok: true }); }
  catch (e) { err(res, e.message); }
}

async function handleGitDiscard(req, res) {
  const { filePath } = await readBody(req);
  if (!filePath) return err(res, "filePath required", 400);
  const abs = path.resolve(workspaceRoot, filePath);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  try { await git(["restore", "--", filePath]); json(res, { ok: true }); }
  catch (e) { err(res, e.message); }
}

async function handleGitCommit(req, res) {
  const { message } = await readBody(req);
  if (!message?.trim()) return err(res, "message required", 400);
  try { await git(["commit", "-m", message]); json(res, { ok: true }); }
  catch (e) { err(res, e.stderr || e.message); }
}

async function handleGitInit(req, res) {
  try {
    await git(["init"]);
    json(res, { ok: true });
  } catch (e) { err(res, e.message); }
}

async function handleGitPush(req, res) {
  try {
    const out = await git(["push"]);
    json(res, { ok: true, output: out.trim() });
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

async function handleGitPull(req, res) {
  const body = await readBody(req);
  const { rebase = false } = body;
  try {
    const args = rebase ? ["pull", "--rebase"] : ["pull"];
    const out = await git(args);
    json(res, { ok: true, output: out.trim() });
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

async function handleGitBranches(req, res) {
  try {
    const raw = await git(["branch", "-a", "--format=%(refname:short)\t%(HEAD)"]);
    const branches = raw.trim().split("\n").filter(Boolean).map(line => {
      const [name, active] = line.split("\t");
      return { name: name.trim(), active: active === "*", remote: name.trim().startsWith("remotes/") };
    });
    const current = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    json(res, { branches, current });
  } catch (e) { err(res, e.message); }
}

async function handleGitCheckout(req, res) {
  const body = await readBody(req);
  const { branch, create = false } = body;
  if (!branch) return err(res, "branch required", 400);
  try {
    const args = create ? ["checkout", "-b", branch] : ["checkout", branch];
    await git(args);
    json(res, { ok: true, branch });
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

// ── Workspace text search ─────────────────────────────────────────────────────
async function handleSearch(req, res) {
  const body = await readBody(req);
  const { query, caseSensitive = false, wholeWord = false, regex = false,
          includeGlob = "", excludeGlob = "", maxResults = 200 } = body;
  if (!query?.trim()) return json(res, { results: [], totalMatches: 0 });

  // Read all relevant files and search line-by-line (no external deps)
  const allFiles = await walkDir(workspaceRoot, workspaceRoot);
  const SEARCH_EXTS = new Set(["ts","tsx","js","jsx","mjs","py","rs","go","java","cs","cpp","c",
    "md","json","yaml","yml","toml","sh","html","css","scss","env","txt"]);
  const toSearch = allFiles.filter(f => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!SEARCH_EXTS.has(ext)) return false;
    if (f.size > 500_000) return false;
    if (includeGlob && !f.path.includes(includeGlob)) return false;
    if (excludeGlob && f.path.includes(excludeGlob)) return false;
    return true;
  });

  let flags = caseSensitive ? "" : "i";
  let pattern;
  try {
    const raw = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bounded = wholeWord ? `\\b${raw}\\b` : raw;
    pattern = new RegExp(bounded, flags);
  } catch {
    return err(res, "Invalid regex", 400);
  }

  const results = [];
  let totalMatches = 0;

  await Promise.all(toSearch.map(async f => {
    try {
      const content = await fs.readFile(path.resolve(workspaceRoot, f.path), "utf-8");
      const lines = content.split("\n");
      const fileMatches = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (pattern.test(line)) {
          // Collect all match ranges for highlighting
          const matches = [];
          let m;
          const re = new RegExp(pattern.source, flags + "g");
          while ((m = re.exec(line)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length });
          }
          fileMatches.push({ lineNo: i + 1, text: line.slice(0, 300), matches });
          totalMatches++;
          if (totalMatches >= maxResults) break;
        }
      }
      if (fileMatches.length > 0) results.push({ filePath: f.path, name: f.name, lang: f.lang, lines: fileMatches });
    } catch { /* skip */ }
  }));

  // Sort by match count desc
  results.sort((a, b) => b.lines.length - a.lines.length);
  json(res, { results, totalMatches });
}

async function handleFiles(req, res) {
  const files = await walkDir(workspaceRoot, workspaceRoot);
  json(res, files);
}

async function handleFileRead(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath.replace(/^\/api\/file\//, ""));
  const abs = path.resolve(workspaceRoot, rel);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  try {
    const content = await fs.readFile(abs, "utf-8");
    json(res, { path: rel, content, lang: langFor(rel), lines: content.split("\n").length });
  } catch (e) {
    err(res, e.message, 404);
  }
}

async function handleFileWrite(req, res) {
  const body = await readBody(req);
  const { path: rel, content } = body;
  if (!rel || content == null) return err(res, "path and content required", 400);
  const abs = path.resolve(workspaceRoot, rel);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
  json(res, { ok: true });
}

async function handleFileCreate(req, res) {
  const body = await readBody(req);
  const { path: rel, isDir = false } = body;
  if (!rel) return err(res, "path required", 400);
  const abs = path.resolve(workspaceRoot, rel);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  try {
    if (isDir) {
      await fs.mkdir(abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", { flag: "wx" }); // fail if exists
    }
    json(res, { ok: true });
  } catch (e) {
    err(res, e.code === "EEXIST" ? "Already exists" : e.message, 400);
  }
}

async function handleFileRename(req, res) {
  const body = await readBody(req);
  const { from, to } = body;
  if (!from || !to) return err(res, "from and to required", 400);
  const absFrom = path.resolve(workspaceRoot, from);
  const absTo   = path.resolve(workspaceRoot, to);
  if (!absFrom.startsWith(workspaceRoot) || !absTo.startsWith(workspaceRoot))
    return err(res, "Forbidden", 403);
  try {
    await fs.mkdir(path.dirname(absTo), { recursive: true });
    await fs.rename(absFrom, absTo);
    json(res, { ok: true });
  } catch (e) { err(res, e.message); }
}

async function handleFileDelete(req, res) {
  const body = await readBody(req);
  const { path: rel } = body;
  if (!rel) return err(res, "path required", 400);
  const abs = path.resolve(workspaceRoot, rel);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  try {
    await fs.rm(abs, { recursive: true, force: true });
    json(res, { ok: true });
  } catch (e) { err(res, e.message); }
}

async function handleContextRank(req, res) {
  const body = await readBody(req);
  const query        = body.query ?? "";
  const maxTokens    = body.maxTokens ?? 2000;
  const maxChunks    = body.maxChunks ?? 8;
  const chunksPerFile= body.chunksPerFile ?? 3;
  const maxFiles     = body.maxFiles ?? 60;
  const fileFilter   = body.fileFilter;
  const includeContent = body.includeContent !== false; // default true

  const CODE_LANGS = new Set(["typescript","javascript","python","rust","go","markdown","json","css","html","bash"]);

  const allFiles = await walkDir(workspaceRoot, workspaceRoot);
  const codeFiles = allFiles.filter(f => {
    if (!CODE_LANGS.has(f.lang)) return false;
    if (f.size > 150_000) return false;
    if (fileFilter && !f.path.includes(fileFilter)) return false;
    return true;
  });

  const toRead = codeFiles.slice(0, maxFiles);
  const allChunks = [];
  await Promise.all(toRead.map(async (f) => {
    try {
      const content = await fs.readFile(path.resolve(workspaceRoot, f.path), "utf-8");
      allChunks.push(...chunkText(f.path, content));
    } catch { /* skip */ }
  }));

  if (allChunks.length === 0) return json(res, { totalTokens: 0, budgetTokens: maxTokens, chunks: [] });

  const queryTerms = tokenize(query);
  const corpus = allChunks.map(c => tokenize(c.content));
  const avgLen = corpus.reduce((s, d) => s + d.length, 0) / corpus.length;
  const idf = buildIdf(corpus);

  const scored = allChunks.map((chunk, i) => ({
    ...chunk,
    score: query.trim()
      ? bm25Score(queryTerms, corpus[i], idf, avgLen)
      : (estimateTokens(chunk.content) > 10 ? 1 : 0),
  })).sort((a, b) => b.score - a.score);

  const packed = [];
  let usedTokens = 0;
  const fileCounts = new Map();
  for (const chunk of scored) {
    if (packed.length >= maxChunks) break;
    if (usedTokens + chunk.tokens > maxTokens) continue;
    const fc = fileCounts.get(chunk.filePath) ?? 0;
    if (fc >= chunksPerFile) continue;
    packed.push(chunk);
    usedTokens += chunk.tokens;
    fileCounts.set(chunk.filePath, fc + 1);
  }

  json(res, {
    totalTokens: usedTokens,
    budgetTokens: maxTokens,
    chunks: packed.map((c, i) => ({
      rank: i + 1,
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      tokens: c.tokens,
      score: Math.round(c.score * 1000) / 1000,
      lang: c.lang,
      preview: c.content.slice(0, 300),
      content: includeContent ? c.content : "",
    })),
  });
}

async function handleChatSummarize(req, res) {
  const body = await readBody(req);
  const { messages, model, provider, keepLast = 4, groqApiKey } = body;
  if (!messages?.length || !model) return err(res, "messages and model required", 400);

  const providerName = provider ?? "groq";
  const p = PROVIDERS[providerName];
  if (!p) return err(res, `Unknown provider: ${providerName}`, 400);

  // Build a summarization prompt from the older messages
  const toSummarize = messages.slice(0, Math.max(0, messages.length - keepLast));
  if (toSummarize.length === 0) return json(res, { summary: "" });

  const transcript = toSummarize.map(m =>
    `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`
  ).join("\n\n");

  const summaryMessages = [
    { role: "system", content: "You are a summarizer. Summarize the following conversation excerpt into 2-4 concise bullet points covering key decisions, code changes, and open questions. Be extremely brief." },
    { role: "user", content: transcript },
  ];

  cors(res);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "connection": "keep-alive" });

  try {
    if (p.kind === "groq") {
      await streamGroq({ model, messages: summaryMessages }, res, groqApiKey);
    } else if (p.kind === "openrouter") {
      await streamOpenRouter({ model, messages: summaryMessages }, res, body.openrouterApiKey);
    } else if (p.kind === "openai") {
      await streamOpenAI(p.base, { model, messages: summaryMessages }, res);
    } else {
      await streamOllama(p.base, { model, messages: summaryMessages }, res);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const { messages, model, provider } = body;
  if (!messages || !model) return err(res, "messages and model required", 400);

  const providerName = provider ?? Object.keys(PROVIDERS)[0];
  const p = PROVIDERS[providerName];
  if (!p) return err(res, `Unknown provider: ${providerName}`, 400);

  cors(res);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "x-provider": providerName,
  });

  try {
    if (p.kind === "groq") {
      await streamGroq({ model, messages }, res, body.groqApiKey);
    } else if (p.kind === "openrouter") {
      await streamOpenRouter({ model, messages }, res, body.openrouterApiKey);
    } else if (p.kind === "openai") {
      await streamOpenAI(p.base, { model, messages }, res);
    } else {
      await streamOllama(p.base, { model, messages }, res);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

async function handleComposerPatch(req, res) {
  const body = await readBody(req);
  const { filePath, prompt, model, provider } = body;
  if (!filePath || !prompt || !model) return err(res, "filePath, prompt, model required", 400);

  const abs = path.resolve(workspaceRoot, filePath);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);

  let fileContent = "";
  try { fileContent = await fs.readFile(abs, "utf-8"); }
  catch { return err(res, `Cannot read file: ${filePath}`, 404); }

  const systemPrompt = `You are a code editor assistant. You will be given a file and a change request.
Respond ONLY with a unified diff patch (--- a/file, +++ b/file format).
Do not explain. Do not add markdown code fences. Output ONLY the raw diff.`;

  const userMsg = `File: ${filePath}

\`\`\`
${fileContent.slice(0, 6000)}
\`\`\`

Change request: ${prompt}`;

  const providerName = provider ?? Object.keys(PROVIDERS)[0];
  const p = PROVIDERS[providerName];
  if (!p) return err(res, `Unknown provider: ${providerName}`, 400);

  cors(res);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  });

  try {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg },
    ];
    if (p.kind === "groq") {
      await streamGroq({ model, messages }, res);
    } else if (p.kind === "openrouter") {
      await streamOpenRouter({ model, messages }, res);
    } else if (p.kind === "openai") {
      await streamOpenAI(p.base, { model, messages }, res);
    } else {
      await streamOllama(p.base, { model, messages }, res);
    }
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
}

// Apply unified diff patch
function applyPatch(original, patch) {
  const origLines = original.split("\n");
  const patchLines = patch.split("\n");
  const hunks = [];
  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i];
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        hunks.push({
          oldStart: parseInt(m[1]) - 1,
          oldCount: parseInt(m[2] ?? "1"),
          newStart: parseInt(m[3]) - 1,
          newCount: parseInt(m[4] ?? "1"),
          lines: [],
        });
      }
      i++;
      continue;
    }
    if (hunks.length > 0 && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      hunks[hunks.length - 1].lines.push(line);
    }
    i++;
  }
  if (hunks.length === 0) return { ok: false, error: "No valid hunks found in patch" };

  const result = [...origLines];
  let offset = 0;
  for (const hunk of hunks) {
    const start = hunk.oldStart + offset;
    const dels = hunk.lines.filter(l => l.startsWith("-")).length;
    const adds = hunk.lines.filter(l => l.startsWith("+"));
    result.splice(start, dels, ...adds.map(l => l.slice(1)));
    offset += adds.length - dels;
  }
  return { ok: true, content: result.join("\n") };
}

async function handleComposerApply(req, res) {
  const body = await readBody(req);
  const { filePath, patch } = body;
  if (!filePath || !patch) return err(res, "filePath and patch required", 400);
  const abs = path.resolve(workspaceRoot, filePath);
  if (!abs.startsWith(workspaceRoot)) return err(res, "Forbidden", 403);
  try {
    const original = await fs.readFile(abs, "utf-8");
    const result = applyPatch(original, patch);
    if (!result.ok) return json(res, result, 422);
    json(res, result);
  } catch (e) {
    err(res, e.message, 500);
  }
}

// ── Settings persistence ──────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(workspaceRoot, ".clarity-settings.json");

async function handleSettingsGet(_req, res) {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    json(res, JSON.parse(raw));
  } catch {
    json(res, {});
  }
}

async function handleSettingsPost(req, res) {
  const body = await readBody(req);
  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(body, null, 2), "utf-8");
    json(res, { ok: true });
  } catch (e) {
    err(res, e.message, 500);
  }
}

// ── Git: stash ────────────────────────────────────────────────────────────────
async function handleGitStash(req, res) {
  const body = await readBody(req);
  const { action = "push", message = "" } = body;
  try {
    if (action === "push") {
      const args = message ? ["stash", "push", "-m", message] : ["stash", "push"];
      await git(args);
      json(res, { ok: true });
    } else if (action === "pop") {
      await git(["stash", "pop"]);
      json(res, { ok: true });
    } else if (action === "list") {
      const raw = await git(["stash", "list", "--pretty=format:%gd\x1f%s\x1f%cr"]);
      const entries = raw.trim().split("\n").filter(Boolean).map(line => {
        const [ref, subject, rel] = line.split("\x1f");
        return { ref, subject, rel };
      });
      json(res, { entries });
    } else if (action === "drop") {
      const { ref = "stash@{0}" } = body;
      await git(["stash", "drop", ref]);
      json(res, { ok: true });
    } else {
      err(res, "Unknown stash action", 400);
    }
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

// ── Git: blame ────────────────────────────────────────────────────────────────
async function handleGitBlame(req, res) {
  const body = await readBody(req);
  const { filePath } = body;
  if (!filePath) return err(res, "filePath required", 400);
  try {
    const raw = await git(["blame", "--porcelain", "--", filePath]);
    const lines = [];
    const blocks = raw.split(/^([0-9a-f]{40})/m);
    // Simplified: parse line-by-line with incremental format
    const lineRe = /^([0-9a-f]{40}) \d+ (\d+)/;
    let currentHash = "", currentAuthor = "", currentTime = "";
    for (const line of raw.split("\n")) {
      const hm = lineRe.exec(line);
      if (hm) { currentHash = hm[1].slice(0, 7); continue; }
      if (line.startsWith("author ")) { currentAuthor = line.slice(7); continue; }
      if (line.startsWith("author-time ")) {
        const ts = Number(line.slice(12));
        currentTime = new Date(ts * 1000).toLocaleDateString();
        continue;
      }
      if (line.startsWith("\t")) {
        lines.push({ hash: currentHash, author: currentAuthor, date: currentTime, text: line.slice(1) });
      }
    }
    json(res, { lines });
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

// ── Git: fetch ────────────────────────────────────────────────────────────────
async function handleGitFetch(req, res) {
  try {
    await git(["fetch", "--prune"]);
    json(res, { ok: true });
  } catch (e) { err(res, (e.stderr || e.message).trim()); }
}

// ── Git: conflicts ────────────────────────────────────────────────────────────
async function handleGitConflicts(req, res) {
  try {
    const raw = await git(["diff", "--name-only", "--diff-filter=U"]);
    const files = raw.trim().split("\n").filter(Boolean);
    json(res, { files });
  } catch (e) { err(res, e.message); }
}

// ── Git: commit-message (AI-generated) ───────────────────────────────────────
async function handleCommitMessage(req, res) {
  const body = await readBody(req);
  const { model, provider } = body;
  try {
    const diff = await git(["diff", "--cached"]);
    if (!diff.trim()) return err(res, "No staged changes", 400);

    const messages = [
      { role: "system", content: "You are an expert at writing concise, conventional git commit messages. Output ONLY the commit message — one subject line (max 72 chars), optionally a blank line and bullet-point body. No backticks, no preamble." },
      { role: "user", content: `Write a commit message for this diff:\n\`\`\`diff\n${diff.slice(0, 6000)}\n\`\`\`` }
    ];

    const providerFn = { groq: streamGroq, lmstudio: streamOpenAI, ollama: streamOllama, openrouter: streamOpenRouter };
    const fn = providerFn[provider] || streamGroq;
    sseHeaders(res);
    await fn(res, messages, model, 256);
  } catch (e) { err(res, e.message); }
}

// ── File: copy ────────────────────────────────────────────────────────────────
async function handleFileCopy(req, res) {
  const body = await readBody(req);
  const { from, to } = body;
  if (!from || !to) return err(res, "from and to required", 400);
  const absFrom = path.resolve(workspaceRoot, from);
  const absTo   = path.resolve(workspaceRoot, to);
  if (!absFrom.startsWith(workspaceRoot) || !absTo.startsWith(workspaceRoot))
    return err(res, "Forbidden", 403);
  try {
    await fs.mkdir(path.dirname(absTo), { recursive: true });
    await fs.cp(absFrom, absTo, { recursive: true });
    json(res, { ok: true });
  } catch (e) { err(res, e.message); }
}

// ── Search: replace in files ──────────────────────────────────────────────────
async function handleSearchReplace(req, res) {
  const body = await readBody(req);
  const { query, replacement = "", caseSensitive = false, wholeWord = false,
          regex = false, includeGlob = "", excludeGlob = "", filePaths } = body;
  if (!query?.trim()) return err(res, "query required", 400);

  let flags = caseSensitive ? "g" : "gi";
  let pattern;
  try {
    const raw = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bounded = wholeWord ? `\\b${raw}\\b` : raw;
    pattern = new RegExp(bounded, flags);
  } catch { return err(res, "Invalid regex", 400); }

  const allFiles = filePaths
    ? filePaths.map(p => ({ path: p }))
    : (await walkDir(workspaceRoot, workspaceRoot)).filter(f => {
        if (includeGlob && !f.path.includes(includeGlob)) return false;
        if (excludeGlob && f.path.includes(excludeGlob)) return false;
        return true;
      });

  let replacedFiles = 0, replacedCount = 0;
  for (const f of allFiles) {
    try {
      const abs = path.resolve(workspaceRoot, f.path);
      const content = await fs.readFile(abs, "utf-8");
      const newContent = content.replace(pattern, replacement);
      if (newContent !== content) {
        await fs.writeFile(abs, newContent, "utf-8");
        replacedFiles++;
        const diff = (content.match(pattern) || []).length;
        replacedCount += diff;
      }
    } catch { /* skip binary / unreadable */ }
  }
  json(res, { ok: true, replacedFiles, replacedCount });
}

// ── AI: autocomplete (ghost text) ────────────────────────────────────────────
async function handleAutocomplete(req, res) {
  const body = await readBody(req);
  const { prefix, suffix = "", language = "typescript", model, provider, maxTokens = 80 } = body;
  if (!prefix) return json(res, { completion: "" });

  // FIM prompt — works with DeepSeek, CodeLlama, StarCoder; falls back gracefully
  const usesFIM = ["deepseek", "starcoder", "codellama", "codegemma", "stable-code"].some(
    n => (model || "").toLowerCase().includes(n)
  );

  let messages;
  if (usesFIM) {
    // Many models support <fim_prefix>/<fim_suffix>/<fim_middle> tokens
    messages = [
      { role: "user", content: `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>` }
    ];
  } else {
    // Generic completion prompt for chat models
    const lines = prefix.split("\n");
    const context = lines.slice(-30).join("\n");
    messages = [
      { role: "system", content: `You are a code completion engine for ${language}. Complete the code at the cursor. Output ONLY the completion text, no explanation, no markdown fences.` },
      { role: "user", content: context }
    ];
  }

  try {
    sseHeaders(res);
    const providerFn = { groq: streamGroq, lmstudio: streamOpenAI, ollama: streamOllama, openrouter: streamOpenRouter };
    const fn = providerFn[provider] || streamOllama;
    await fn(res, messages, model, maxTokens);
  } catch (e) { err(res, e.message); }
}

// ── AI: explain selection ─────────────────────────────────────────────────────
async function handleExplain(req, res) {
  const body = await readBody(req);
  const { code, language = "code", model, provider } = body;
  if (!code) return err(res, "code required", 400);
  const messages = [
    { role: "system", content: "You are an expert code reviewer. Explain what the provided code does in clear, concise language. Use bullet points for key points." },
    { role: "user", content: `Explain this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\`` }
  ];
  try {
    sseHeaders(res);
    const providerFn = { groq: streamGroq, lmstudio: streamOpenAI, ollama: streamOllama, openrouter: streamOpenRouter };
    const fn = providerFn[provider] || streamGroq;
    await fn(res, messages, model, 512);
  } catch (e) { err(res, e.message); }
}

// ── AI: generate tests ────────────────────────────────────────────────────────
async function handleGenerateTests(req, res) {
  const body = await readBody(req);
  const { code, language = "typescript", framework = "vitest", model, provider } = body;
  if (!code) return err(res, "code required", 400);
  const messages = [
    { role: "system", content: `You are a test-writing expert. Write comprehensive unit tests using ${framework} for the provided ${language} code. Output only the test file content, no explanation.` },
    { role: "user", content: `Write tests for:\n\`\`\`${language}\n${code}\n\`\`\`` }
  ];
  try {
    sseHeaders(res);
    const providerFn = { groq: streamGroq, lmstudio: streamOpenAI, ollama: streamOllama, openrouter: streamOpenRouter };
    const fn = providerFn[provider] || streamGroq;
    await fn(res, messages, model, 1024);
  } catch (e) { err(res, e.message); }
}

// ── AI: generate docstring ────────────────────────────────────────────────────
async function handleDocstring(req, res) {
  const body = await readBody(req);
  const { code, language = "typescript", model, provider } = body;
  if (!code) return err(res, "code required", 400);
  const messages = [
    { role: "system", content: `Write a JSDoc/docstring comment for the following ${language} function. Output ONLY the comment block, no code.` },
    { role: "user", content: code }
  ];
  try {
    sseHeaders(res);
    const providerFn = { groq: streamGroq, lmstudio: streamOpenAI, ollama: streamOllama, openrouter: streamOpenRouter };
    const fn = providerFn[provider] || streamGroq;
    await fn(res, messages, model, 256);
  } catch (e) { err(res, e.message); }
}

// ── Terminal WebSocket ────────────────────────────────────────────────────────
// Map of sessionId → pty process
const terminalSessions = new Map();

async function handleTerminalUpgrade(req, socket, head) {
  let pty;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    pty = require("node-pty");
  } catch {
    socket.write("HTTP/1.1 501 node-pty not installed\r\n\r\n");
    socket.destroy();
    return;
  }

  // Manual WebSocket handshake
  const key = req.headers["sec-websocket-key"];
  const acceptKey = (await import("node:crypto")).createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  const url = new URL(req.url, "http://localhost");
  const shell = url.searchParams.get("shell") ||
    process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "bash");
  const cols = Number(url.searchParams.get("cols") || 80);
  const rows = Number(url.searchParams.get("rows") || 24);

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: workspaceRoot,
    env: process.env,
  });

  const sessionId = Math.random().toString(36).slice(2);
  terminalSessions.set(sessionId, ptyProcess);

  // PTY output → WebSocket frame
  ptyProcess.onData(data => {
    if (socket.destroyed) return;
    const payload = Buffer.from(data);
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    socket.write(Buffer.concat([header, payload]));
  });

  ptyProcess.onExit(() => {
    terminalSessions.delete(sessionId);
    if (!socket.destroyed) socket.destroy();
  });

  // WebSocket frame → PTY input
  socket.on("data", buf => {
    try {
      let offset = 0;
      while (offset < buf.length) {
        const fin  = (buf[offset] & 0x80) !== 0;
        const opcode = buf[offset] & 0x0f;
        offset++;
        const masked = (buf[offset] & 0x80) !== 0;
        let payLen = buf[offset] & 0x7f;
        offset++;
        if (payLen === 126) { payLen = buf.readUInt16BE(offset); offset += 2; }
        else if (payLen === 127) { payLen = Number(buf.readBigUInt64BE(offset)); offset += 8; }
        const mask = masked ? buf.slice(offset, offset + 4) : null;
        if (masked) offset += 4;
        const payload = buf.slice(offset, offset + payLen);
        offset += payLen;
        if (opcode === 0x8) { socket.destroy(); return; } // close
        if (opcode === 0x1 || opcode === 0x2) {
          const decoded = masked
            ? Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))
            : payload;
          const msg = decoded.toString("utf-8");
          // Support JSON control messages: { type: "resize", cols, rows }
          if (msg.startsWith("{")) {
            try {
              const ctrl = JSON.parse(msg);
              if (ctrl.type === "resize") ptyProcess.resize(ctrl.cols, ctrl.rows);
            } catch { ptyProcess.write(msg); }
          } else {
            ptyProcess.write(msg);
          }
        }
      }
    } catch { /* malformed frame — ignore */ }
  });

  socket.on("close", () => {
    ptyProcess.kill();
    terminalSessions.delete(sessionId);
  });

  socket.on("error", () => {
    ptyProcess.kill();
    terminalSessions.delete(sessionId);
  });
}

// ── Static file serving ───────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ts":   "application/javascript; charset=utf-8",
};

async function handleStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const target = urlPath === "/" || urlPath === ""
    ? path.join(appRoot, "index.html")
    : path.join(appRoot, urlPath.replace(/^\/+/, ""));

  if (urlPath === "/favicon.ico") { res.writeHead(204); res.end(); return; }

  try {
    const file = await fs.readFile(target);
    const ext = path.extname(target);
    cors(res);
    res.writeHead(200, { "content-type": MIME[ext] ?? "text/plain; charset=utf-8" });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
const createServer = () =>
  http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

    try {
      if (url === "/api/providers/health" && method === "GET")
        return await handleProvidersHealth(req, res);

      if (url === "/api/models/list" && method === "GET")
        return await handleModelsList(req, res);

      if (url === "/api/files" && method === "GET")
        return await handleFiles(req, res);

      if (url.startsWith("/api/file/") && method === "GET")
        return await handleFileRead(req, res, url);

      if (url === "/api/file/write" && method === "POST")
        return await handleFileWrite(req, res);

      if (url === "/api/file/create" && method === "POST")
        return await handleFileCreate(req, res);

      if (url === "/api/file/rename" && method === "POST")
        return await handleFileRename(req, res);

      if (url === "/api/file/delete" && method === "POST")
        return await handleFileDelete(req, res);

      if (url === "/api/context/rank" && method === "POST")
        return await handleContextRank(req, res);

      if (url === "/api/chat/summarize" && method === "POST")
        return await handleChatSummarize(req, res);

      if (url === "/api/chat" && method === "POST")
        return await handleChat(req, res);

      if (url === "/api/composer/patch" && method === "POST")
        return await handleComposerPatch(req, res);

      if (url === "/api/composer/apply" && method === "POST")
        return await handleComposerApply(req, res);

      if (url === "/api/search" && method === "POST")
        return await handleSearch(req, res);

      if (url === "/api/git/branch" && method === "GET")
        return await handleGitBranch(req, res);

      if (url === "/api/git/status" && method === "GET")
        return await handleGitStatus(req, res);

      if (url === "/api/git/diff" && method === "POST")
        return await handleGitDiff(req, res);

      if (url === "/api/git/log" && method === "GET")
        return await handleGitLog(req, res);

      if (url === "/api/git/stage" && method === "POST")
        return await handleGitStage(req, res);

      if (url === "/api/git/unstage" && method === "POST")
        return await handleGitUnstage(req, res);

      if (url === "/api/git/commit" && method === "POST")
        return await handleGitCommit(req, res);

      if (url === "/api/git/discard" && method === "POST")
        return await handleGitDiscard(req, res);

      if (url === "/api/git/init" && method === "POST")
        return await handleGitInit(req, res);

      if (url === "/api/git/push" && method === "POST")
        return await handleGitPush(req, res);

      if (url === "/api/git/pull" && method === "POST")
        return await handleGitPull(req, res);

      if (url === "/api/git/branches" && method === "GET")
        return await handleGitBranches(req, res);

      if (url === "/api/git/checkout" && method === "POST")
        return await handleGitCheckout(req, res);

      if (url === "/api/settings" && method === "GET")
        return await handleSettingsGet(req, res);

      if (url === "/api/settings" && method === "POST")
        return await handleSettingsPost(req, res);

      if (url === "/api/git/stash" && method === "POST")
        return await handleGitStash(req, res);

      if (url === "/api/git/blame" && method === "POST")
        return await handleGitBlame(req, res);

      if (url === "/api/git/fetch" && method === "POST")
        return await handleGitFetch(req, res);

      if (url === "/api/git/conflicts" && method === "GET")
        return await handleGitConflicts(req, res);

      if (url === "/api/git/commit-message" && method === "POST")
        return await handleCommitMessage(req, res);

      if (url === "/api/file/copy" && method === "POST")
        return await handleFileCopy(req, res);

      if (url === "/api/search/replace" && method === "POST")
        return await handleSearchReplace(req, res);

      if (url === "/api/autocomplete" && method === "POST")
        return await handleAutocomplete(req, res);

      if (url === "/api/explain" && method === "POST")
        return await handleExplain(req, res);

      if (url === "/api/test/generate" && method === "POST")
        return await handleGenerateTests(req, res);

      if (url === "/api/docstring" && method === "POST")
        return await handleDocstring(req, res);

      return await handleStatic(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) err(res, e.message);
    }
  });

const startServer = (port, retries = 10) => {
  const server = createServer();
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/terminal")) {
      handleTerminalUpgrade(req, socket, head).catch(e => {
        console.error("Terminal WS error:", e.message);
        socket.destroy();
      });
    } else {
      socket.destroy();
    }
  });
  server.listen(port, () => {
    console.log(`clarity API + webview running at http://localhost:${port}`);
    console.log(`  workspace root: ${workspaceRoot}`);
  });
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      if (hasExplicitPort || retries <= 0) {
        console.error(`PORT ${port} is already in use.`);
        process.exit(1);
      }
      console.warn(`Port ${port} busy, retrying on ${port + 1}...`);
      startServer(port + 1, retries - 1);
      return;
    }
    throw error;
  });
};

startServer(requestedPort);
