import { ProviderName } from "../types/models.js";

export interface RequestTelemetry {
  provider: ProviderName;
  task: string;
  ttfbMs: number | null;
  totalMs: number;
  tokenCount: number;
  tokensPerSec: number | null;
  failover: boolean;
  error: boolean;
}

export class TelemetryCollector {
  private readonly records: RequestTelemetry[] = [];
  private failoverCount = 0;

  record(entry: RequestTelemetry): void {
    this.records.push(entry);
    if (entry.failover) this.failoverCount++;
  }

  getAll(): readonly RequestTelemetry[] {
    return this.records;
  }

  getFailoverCount(): number {
    return this.failoverCount;
  }

  summarize(): {
    totalRequests: number;
    failoverCount: number;
    errorCount: number;
    avgTtfbMs: number | null;
    avgTokensPerSec: number | null;
  } {
    const total = this.records.length;
    const errors = this.records.filter((r) => r.error).length;

    const ttfbSamples = this.records.filter((r) => r.ttfbMs !== null).map((r) => r.ttfbMs as number);
    const avgTtfbMs = ttfbSamples.length > 0
      ? ttfbSamples.reduce((a, b) => a + b, 0) / ttfbSamples.length
      : null;

    const tpsSamples = this.records.filter((r) => r.tokensPerSec !== null).map((r) => r.tokensPerSec as number);
    const avgTokensPerSec = tpsSamples.length > 0
      ? tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length
      : null;

    return { totalRequests: total, failoverCount: this.failoverCount, errorCount: errors, avgTtfbMs, avgTokensPerSec };
  }
}
