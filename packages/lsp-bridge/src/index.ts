export interface DocumentKey {
  uri: string;
  version: number;
}

export interface LspRangePosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspRangePosition;
  end: LspRangePosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  message: string;
}

export interface DiagnosticsSnapshot {
  uri: string;
  version: number;
  diagnostics: LspDiagnostic[];
  updatedAtMs: number;
}

export class DiagnosticsCache {
  private readonly byUri = new Map<string, Map<number, DiagnosticsSnapshot>>();

  upsert(snapshot: DiagnosticsSnapshot): void {
    const versionMap = this.byUri.get(snapshot.uri) ?? new Map<number, DiagnosticsSnapshot>();
    versionMap.set(snapshot.version, snapshot);
    this.byUri.set(snapshot.uri, versionMap);
    this.compactOldVersions(snapshot.uri, 5);
  }

  get(uri: string, version: number): DiagnosticsSnapshot | undefined {
    return this.byUri.get(uri)?.get(version);
  }

  getLatest(uri: string): DiagnosticsSnapshot | undefined {
    const versions = this.byUri.get(uri);
    if (!versions || versions.size === 0) return undefined;
    let latest: DiagnosticsSnapshot | undefined;
    for (const snapshot of versions.values()) {
      if (!latest || snapshot.version > latest.version) {
        latest = snapshot;
      }
    }
    return latest;
  }

  isFresh(uri: string, version: number): boolean {
    return this.byUri.get(uri)?.has(version) ?? false;
  }

  clearUri(uri: string): void {
    this.byUri.delete(uri);
  }

  private compactOldVersions(uri: string, keep: number): void {
    const versionMap = this.byUri.get(uri);
    if (!versionMap || versionMap.size <= keep) return;

    const versions = [...versionMap.keys()].sort((a, b) => b - a);
    const keepSet = new Set(versions.slice(0, keep));
    for (const version of versions) {
      if (!keepSet.has(version)) {
        versionMap.delete(version);
      }
    }
  }
}
