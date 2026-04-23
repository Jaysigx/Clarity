export interface ContextCandidate {
  id: string;
  filePath: string;
  content: string;
  tokens: number;
  semanticScore: number;
  cursorProximity: number;
  diagnosticWeight: number;
  recency: number;
  symbolGraph: number;
  pathPrior: number;
  staleness: number;
}

export interface RankWeights {
  semantic: number;
  cursorProximity: number;
  diagnosticWeight: number;
  recency: number;
  symbolGraph: number;
  pathPrior: number;
  staleness: number;
}

export interface PackingConstraints {
  maxChunks: number;
  maxChunksPerFile: number;
  maxTokens: number;
}

export interface DiagnosticPackingOptions {
  requireDiagnosticChunk: boolean;
  diagnosticThreshold: number;
}

export interface RankedContext {
  candidate: ContextCandidate;
  score: number;
  scoreDensity: number;
}

export interface BufferVersionInfo {
  indexedVersion: number;
  currentVersion: number;
}

export function applyVersionDriftStaleness(
  candidates: ContextCandidate[],
  versionMap: Map<string, BufferVersionInfo>,
  maxPenalty = 0.8
): ContextCandidate[] {
  return candidates.map((candidate) => {
    const info = versionMap.get(candidate.filePath);
    if (!info) return candidate;
    const drift = Math.max(0, info.currentVersion - info.indexedVersion);
    if (drift === 0) return candidate;
    const penalty = Math.min(maxPenalty, drift / (drift + 5));
    const newStaleness = Math.min(1, candidate.staleness + penalty);
    return { ...candidate, staleness: newStaleness };
  });
}

export const DEFAULT_WEIGHTS: RankWeights = {
  semantic: 0.35,
  cursorProximity: 0.15,
  diagnosticWeight: 0.2,
  recency: 0.1,
  symbolGraph: 0.15,
  pathPrior: 0.05,
  staleness: 0.1,
};

export function scoreCandidate(
  candidate: ContextCandidate,
  weights: RankWeights = DEFAULT_WEIGHTS
): number {
  return (
    weights.semantic * candidate.semanticScore +
    weights.cursorProximity * candidate.cursorProximity +
    weights.diagnosticWeight * candidate.diagnosticWeight +
    weights.recency * candidate.recency +
    weights.symbolGraph * candidate.symbolGraph +
    weights.pathPrior * candidate.pathPrior -
    weights.staleness * candidate.staleness
  );
}

export function rankCandidates(
  candidates: ContextCandidate[],
  weights: RankWeights = DEFAULT_WEIGHTS
): RankedContext[] {
  return candidates
    .map((candidate) => {
      const score = scoreCandidate(candidate, weights);
      const scoreDensity = score / Math.max(1, candidate.tokens);
      return { candidate, score, scoreDensity };
    })
    .sort((a, b) => b.scoreDensity - a.scoreDensity);
}

export function packContext(
  ranked: RankedContext[],
  constraints: PackingConstraints
): RankedContext[] {
  const selected: RankedContext[] = [];
  const fileCounts = new Map<string, number>();
  let usedTokens = 0;

  for (const item of ranked) {
    if (selected.length >= constraints.maxChunks) break;
    if (usedTokens + item.candidate.tokens > constraints.maxTokens) continue;

    const currentFileCount = fileCounts.get(item.candidate.filePath) ?? 0;
    if (currentFileCount >= constraints.maxChunksPerFile) continue;

    selected.push(item);
    fileCounts.set(item.candidate.filePath, currentFileCount + 1);
    usedTokens += item.candidate.tokens;
  }

  return selected;
}

export interface Bm25Options {
  k1: number;
  b: number;
}

export const DEFAULT_BM25_OPTIONS: Bm25Options = { k1: 1.5, b: 0.75 };

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_$]+/g) ?? [];
}

function buildIdf(corpus: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  const N = corpus.length;
  for (const doc of corpus) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df) {
    idf.set(term, Math.log((N - count + 0.5) / (count + 0.5) + 1));
  }
  return idf;
}

function bm25Score(
  query: string[],
  doc: string[],
  idf: Map<string, number>,
  avgDocLen: number,
  opts: Bm25Options
): number {
  const tf = new Map<string, number>();
  for (const term of doc) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }
  const docLen = doc.length;
  let score = 0;
  for (const term of new Set(query)) {
    const termIdf = idf.get(term) ?? 0;
    const termTf = tf.get(term) ?? 0;
    const numerator = termTf * (opts.k1 + 1);
    const denominator = termTf + opts.k1 * (1 - opts.b + opts.b * (docLen / avgDocLen));
    score += termIdf * (numerator / denominator);
  }
  return score;
}

export function rerankedWithBm25(
  ranked: RankedContext[],
  query: string,
  opts: Bm25Options = DEFAULT_BM25_OPTIONS,
  weight = 0.3
): RankedContext[] {
  if (ranked.length === 0 || !query.trim()) return ranked;

  const queryTerms = tokenize(query);
  const corpus = ranked.map((r) => tokenize(r.candidate.content));
  const avgDocLen = corpus.reduce((sum, doc) => sum + doc.length, 0) / corpus.length;
  const idf = buildIdf(corpus);

  const withBm25 = ranked.map((item, i) => {
    const bm25 = bm25Score(queryTerms, corpus[i], idf, avgDocLen, opts);
    const combinedDensity = item.scoreDensity * (1 - weight) + (bm25 / Math.max(1, item.candidate.tokens)) * weight;
    return { ...item, scoreDensity: combinedDensity };
  });

  return withBm25.sort((a, b) => b.scoreDensity - a.scoreDensity);
}

export function packContextWithDiagnosticsGuarantee(
  ranked: RankedContext[],
  constraints: PackingConstraints,
  options: DiagnosticPackingOptions
): RankedContext[] {
  if (!options.requireDiagnosticChunk) {
    return packContext(ranked, constraints);
  }

  const diagnosticCandidate = ranked.find(
    (item) => item.candidate.diagnosticWeight >= options.diagnosticThreshold
  );
  if (!diagnosticCandidate) {
    return packContext(ranked, constraints);
  }
  if (diagnosticCandidate.candidate.tokens > constraints.maxTokens) {
    return packContext(ranked, constraints);
  }

  const selected: RankedContext[] = [diagnosticCandidate];
  const fileCounts = new Map<string, number>([[diagnosticCandidate.candidate.filePath, 1]]);
  let usedTokens = diagnosticCandidate.candidate.tokens;

  for (const item of ranked) {
    if (item.candidate.id === diagnosticCandidate.candidate.id) continue;
    if (selected.length >= constraints.maxChunks) break;
    if (usedTokens + item.candidate.tokens > constraints.maxTokens) continue;

    const currentFileCount = fileCounts.get(item.candidate.filePath) ?? 0;
    if (currentFileCount >= constraints.maxChunksPerFile) continue;

    selected.push(item);
    fileCounts.set(item.candidate.filePath, currentFileCount + 1);
    usedTokens += item.candidate.tokens;
  }

  return selected;
}
