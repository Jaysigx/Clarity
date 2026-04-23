import { ChunkOptions, SourceChunk, chunkFile } from "./chunker.js";
import { InMemoryVectorStore, VectorEntry } from "./vectorStore.js";

export type EmbedFn = (inputs: string[]) => Promise<number[][]>;

export interface IndexingOptions {
  chunkOptions?: ChunkOptions;
  batchSize?: number;
}

export interface IndexFileResult {
  filePath: string;
  chunksIndexed: number;
  chunksSkipped: number;
  durationMs: number;
}

export class IndexingPipeline {
  constructor(
    private readonly store: InMemoryVectorStore,
    private readonly embed: EmbedFn,
    private readonly opts: IndexingOptions = {}
  ) {}

  async indexFile(filePath: string, content: string): Promise<IndexFileResult> {
    const startMs = Date.now();
    const chunks = chunkFile(filePath, content, this.opts.chunkOptions);
    const batchSize = this.opts.batchSize ?? 16;

    let chunksIndexed = 0;
    let chunksSkipped = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.content);

      let embeddings: number[][];
      try {
        embeddings = await this.embed(texts);
      } catch {
        chunksSkipped += batch.length;
        continue;
      }

      const entries: VectorEntry[] = batch.map((chunk, j) => ({
        id: chunk.id,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding: embeddings[j] ?? [],
        content: chunk.content,
        tokens: chunk.tokens,
        language: chunk.language,
        indexedAtMs: Date.now(),
      }));

      this.store.upsertBatch(entries);
      chunksIndexed += entries.length;
    }

    return {
      filePath,
      chunksIndexed,
      chunksSkipped,
      durationMs: Date.now() - startMs,
    };
  }

  async indexFiles(files: Array<{ filePath: string; content: string }>): Promise<IndexFileResult[]> {
    const results: IndexFileResult[] = [];
    for (const file of files) {
      results.push(await this.indexFile(file.filePath, file.content));
    }
    return results;
  }

  removeFile(filePath: string): void {
    this.store.deleteByFile(filePath);
  }

  getChunksForFile(filePath: string): SourceChunk[] {
    return chunkFile(filePath, "", this.opts.chunkOptions);
  }
}
