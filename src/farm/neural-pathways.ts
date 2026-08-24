import type { VectorState } from "./hive-topology";

/** A directed synaptic link between two AI agents. */
export type NeuralPathway = {
  from: string;
  to: string;
  /** Synaptic strength 0..1; grows with co-activation (Hebbian), decays when idle. */
  weight: number;
  activations: number;
  lastActivatedAt: number;
};

/** A signal delivered to an agent through a pathway, attenuated by synaptic strength. */
export type PathwaySignal = {
  sourceId: string;
  nodeId: string;
  via: [string, string];
  hops: number;
  vector: VectorState;
  strength: number;
};

export type NeuralPathwayOptions = {
  learningRate?: number;
  decayRate?: number;
  minWeight?: number;
  initialWeight?: number;
};

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

const attenuate = (vector: VectorState, factor: number): VectorState => ({
  confidence: clamp(vector.confidence * factor),
  novelty: vector.novelty,
  urgency: clamp(vector.urgency * factor),
  strategy: vector.strategy.map((s) => clamp(s * factor)),
});

/**
 * Neural pathways between AI agents.
 *
 * Agents that fire together wire together: co-selection for a task or a reward
 * event strengthens the synapse between them; idle synapses decay and are
 * pruned below `minWeight`. Signals propagate through the network with
 * attenuation proportional to synaptic strength, so strongly-coupled agents
 * receive near-lossless vectors while weakly-coupled ones receive hints.
 */
export class NeuralPathwayNetwork {
  private readonly learningRate: number;
  private readonly decayRate: number;
  private readonly minWeight: number;
  private readonly initialWeight: number;
  private readonly synapses = new Map<string, NeuralPathway>();
  private clock = 0;

  constructor(options: NeuralPathwayOptions = {}) {
    this.learningRate = clamp(options.learningRate ?? 0.2);
    this.decayRate = clamp(options.decayRate ?? 0.02);
    this.minWeight = clamp(options.minWeight ?? 0.05);
    this.initialWeight = clamp(options.initialWeight ?? 0.1);
  }

  /** Create (or return) the directed pathway a -> b. No-op for self-loops. */
  connect(a: string, b: string, weight?: number): NeuralPathway | null {
    if (a === b) return null;
    const key = `${a}->${b}`;
    const existing = this.synapses.get(key);
    if (existing) return existing;
    const pathway: NeuralPathway = {
      from: a,
      to: b,
      weight: clamp(weight ?? this.initialWeight),
      activations: 0,
      lastActivatedAt: this.clock,
    };
    this.synapses.set(key, pathway);
    return pathway;
  }

  /** Wire a group of agents bidirectionally; returns the created/touched pathways. */
  wireGroup(nodeIds: string[]): NeuralPathway[] {
    const touched: NeuralPathway[] = [];
    for (const a of nodeIds) {
      for (const b of nodeIds) {
        const pathway = this.connect(a, b);
        if (pathway) touched.push(pathway);
      }
    }
    return touched;
  }

  /** Hebbian update: w += lr * reward * w * (1 - w). Creates the pathway if missing. */
  strengthen(a: string, b: string, reward = 1): number {
    const pathway = this.connect(a, b);
    if (!pathway) return 0;
    const delta = this.learningRate * clamp(reward) * pathway.weight * (1 - pathway.weight);
    pathway.weight = clamp(pathway.weight + delta);
    pathway.activations += 1;
    pathway.lastActivatedAt = ++this.clock;
    return pathway.weight;
  }

  /** Passive decay of every synapse; prunes links that fall below minWeight. */
  decay(): number {
    let pruned = 0;
    for (const [key, pathway] of this.synapses) {
      pathway.weight = clamp(pathway.weight * (1 - this.decayRate));
      if (pathway.weight < this.minWeight) {
        this.synapses.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  /**
   * Breadth-first propagation from a source agent. Each hop attenuates the
   * vector by the synapse weight; pathways below minWeight do not conduct.
   */
  propagate(sourceId: string, vector: VectorState, maxHops = 2): PathwaySignal[] {
    const delivered: PathwaySignal[] = [];
    const visited = new Set<string>([sourceId]);
    let frontier: { nodeId: string; vector: VectorState; strength: number; hops: number }[] = [
      { nodeId: sourceId, vector, strength: 1, hops: 0 },
    ];

    while (frontier.length) {
      const next: typeof frontier = [];
      for (const current of frontier) {
        if (current.hops >= maxHops) continue;
        for (const pathway of this.outgoing(current.nodeId)) {
          if (visited.has(pathway.to) || pathway.weight < this.minWeight) continue;
          visited.add(pathway.to);
          const strength = current.strength * pathway.weight;
          const signal: PathwaySignal = {
            sourceId,
            nodeId: pathway.to,
            via: [pathway.from, pathway.to],
            hops: current.hops + 1,
            vector: attenuate(current.vector, pathway.weight),
            strength,
          };
          delivered.push(signal);
          next.push({ nodeId: pathway.to, vector: signal.vector, strength, hops: signal.hops });
        }
      }
      frontier = next;
    }
    return delivered;
  }

  pathwaysFor(nodeId: string): NeuralPathway[] {
    return [...this.synapses.values()]
      .filter((p) => p.from === nodeId || p.to === nodeId)
      .map((p) => ({ ...p }));
  }

  /** Remove every synapse touching a node; returns how many were removed. */
  removeNode(nodeId: string): number {
    let removed = 0;
    for (const [key, pathway] of this.synapses) {
      if (pathway.from === nodeId || pathway.to === nodeId) {
        this.synapses.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  outgoing(nodeId: string): NeuralPathway[] {
    return [...this.synapses.values()].filter((p) => p.from === nodeId);
  }

  strongest(limit = 10): NeuralPathway[] {
    return [...this.synapses.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, Math.max(0, limit))
      .map((p) => ({ ...p }));
  }

  snapshot(): NeuralPathway[] {
    return [...this.synapses.values()].map((p) => ({ ...p }));
  }

  stats(): { pathways: number; averageWeight: number; totalActivations: number } {
    const all = [...this.synapses.values()];
    const weight = all.reduce((sum, p) => sum + p.weight, 0);
    return {
      pathways: all.length,
      averageWeight: all.length ? +(weight / all.length).toFixed(4) : 0,
      totalActivations: all.reduce((sum, p) => sum + p.activations, 0),
    };
  }
}
