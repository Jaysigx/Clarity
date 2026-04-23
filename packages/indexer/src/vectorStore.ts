export interface VectorEntry {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  embedding: number[];
  content: string;
  tokens: number;
  language: string;
  indexedAtMs: number;
}

export interface VectorQuery {
  embedding: number[];
  topK: number;
  filePathFilter?: string;
}

export interface VectorQueryResult {
  entry: VectorEntry;
  score: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class InMemoryVectorStore {
  private readonly entries = new Map<string, VectorEntry>();

  upsert(entry: VectorEntry): void {
    this.entries.set(entry.id, entry);
  }

  upsertBatch(entries: VectorEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  deleteByFile(filePath: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.filePath === filePath) {
        this.entries.delete(id);
      }
    }
  }

  query(q: VectorQuery): VectorQueryResult[] {
    const results: VectorQueryResult[] = [];
    for (const entry of this.entries.values()) {
      if (q.filePathFilter && entry.filePath !== q.filePathFilter) continue;
      const score = cosineSimilarity(q.embedding, entry.embedding);
      results.push({ entry, score });
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, q.topK);
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
