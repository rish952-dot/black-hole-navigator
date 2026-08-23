export type FarmMetricName = "generationMs" | "tasksPerSecond" | "latencyMs" | "meshFps" | "providerErrors";

export interface FarmMetricSample {
  name: FarmMetricName;
  value: number;
  ts: number;
}

/** Lightweight in-process rolling metrics collector inspired by Cognitive Mesh performance monitoring. */
export class FarmPerformanceMonitor {
  private readonly samples = new Map<FarmMetricName, FarmMetricSample[]>();
  constructor(private readonly maxSamples = 60) {}

  record(name: FarmMetricName, value: number): void {
    if (!Number.isFinite(value)) return;
    const list = this.samples.get(name) ?? [];
    list.push({ name, value, ts: Date.now() });
    if (list.length > this.maxSamples) list.splice(0, list.length - this.maxSamples);
    this.samples.set(name, list);
  }

  latest(name: FarmMetricName): number | null {
    const list = this.samples.get(name);
    return list?.at(-1)?.value ?? null;
  }

  average(name: FarmMetricName): number | null {
    const list = this.samples.get(name);
    if (!list?.length) return null;
    return list.reduce((sum, sample) => sum + sample.value, 0) / list.length;
  }

  snapshot(): Record<FarmMetricName, { latest: number | null; average: number | null }> {
    return {
      generationMs: { latest: this.latest("generationMs"), average: this.average("generationMs") },
      tasksPerSecond: { latest: this.latest("tasksPerSecond"), average: this.average("tasksPerSecond") },
      latencyMs: { latest: this.latest("latencyMs"), average: this.average("latencyMs") },
      meshFps: { latest: this.latest("meshFps"), average: this.average("meshFps") },
      providerErrors: { latest: this.latest("providerErrors"), average: this.average("providerErrors") },
    };
  }
}
