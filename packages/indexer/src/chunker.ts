import crypto from "node:crypto";

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
  language?: string;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 200,
  overlapTokens: 20,
};

export interface SourceChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  tokens: number;
  language: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cs: "csharp",
    cpp: "cpp",
    c: "c",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
  };
  return map[ext] ?? "text";
}

function chunkId(filePath: string, startLine: number, content: string): string {
  return crypto
    .createHash("sha256")
    .update(`${filePath}:${startLine}:${content.slice(0, 64)}`)
    .digest("hex")
    .slice(0, 16);
}

const SEMANTIC_BOUNDARIES: Record<string, RegExp> = {
  typescript: /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+/,
  javascript: /^(export\s+)?(async\s+)?(function|class|const|let|var)\s+/,
  python: /^(async\s+)?def\s+|^class\s+/,
  rust: /^(pub\s+)?(async\s+)?fn\s+|^(pub\s+)?struct\s+|^(pub\s+)?enum\s+|^(pub\s+)?impl\s+/,
  go: /^func\s+|^type\s+/,
};

function findSemanticSplits(lines: string[], language: string): number[] {
  const pattern = SEMANTIC_BOUNDARIES[language];
  const splits: number[] = [0];
  if (!pattern) return splits;
  for (let i = 1; i < lines.length; i++) {
    if (pattern.test(lines[i].trimStart())) {
      splits.push(i);
    }
  }
  return splits;
}

export function chunkFile(
  filePath: string,
  content: string,
  opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS
): SourceChunk[] {
  const language = opts.language ?? detectLanguage(filePath);
  const lines = content.split("\n");
  const splits = findSemanticSplits(lines, language);

  const segments: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < splits.length; i++) {
    segments.push({ start: splits[i], end: (splits[i + 1] ?? lines.length) - 1 });
  }

  const chunks: SourceChunk[] = [];

  for (const seg of segments) {
    let start = seg.start;
    while (start <= seg.end) {
      const segLines: string[] = [];
      let usedTokens = 0;
      let end = start;

      while (end <= seg.end) {
        const lineTokens = estimateTokens(lines[end]);
        if (usedTokens + lineTokens > opts.maxTokens && segLines.length > 0) break;
        segLines.push(lines[end]);
        usedTokens += lineTokens;
        end++;
      }

      if (segLines.length === 0) {
        end = start + 1;
      }

      const chunkContent = segLines.join("\n");
      if (chunkContent.trim().length > 0) {
        chunks.push({
          id: chunkId(filePath, start, chunkContent),
          filePath,
          content: chunkContent,
          startLine: start,
          endLine: end - 1,
          tokens: usedTokens,
          language,
        });
      }

      const overlap = Math.max(0, end - opts.overlapTokens);
      start = overlap > start ? overlap : end;
    }
  }

  return chunks;
}
