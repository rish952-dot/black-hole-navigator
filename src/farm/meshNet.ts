import type { Agent, MeshField } from "./types";
import { deriveRole } from "./roles";

/**
 * Adaptive vector-based mesh: every agent is embedded as a fixed-width vector,
 * links are formed by cosine similarity (kNN), and link weights adapt with the
 * performance delta of the endpoints. Messages are vectors, so communication is
 * O(dim) per link and stays cheap on mobile.
 */
export const VECTOR_DIM = 8;

export interface MeshLink {
  a: string;
  b: string;
  weight: number;     // 0..1 adaptive
  similarity: number; // cosine at last rebuild
}

export interface MeshMessage {
  from: string;
  to: string;
  vector: number[];
  kind: "signal" | "recovery" | "capital" | "alert";
}

export interface MeshTopology {
  vectors: Map<string, number[]>;
  links: MeshLink[];
  degree: Map<string, number>;
  avgDegree: number;
  clustering: number;
  components: number;
}

const ROLE_INDEX: Record<string, number> = {
  scout: 0, executor: 0.2, verifier: 0.4, treasurer: 0.6, healer: 0.8, governor: 1,
};

export function embed(a: Agent): number[] {
  const g = a.genome;
  const v = [
    g.riskTolerance,
    g.verificationLevel,
    g.researchDepth,
    Math.min(1, g.parallelism / 8),
    Math.min(1, g.maximumTaskDuration / 120),
    Math.min(1, Math.max(-1, a.stats.roi / 4)) * 0.5 + 0.5,
    Math.min(1, Math.max(0, a.stats.successRate)),
    ROLE_INDEX[deriveRole(a)] ?? 0.5,
  ];
  return normalize(v);
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => +(x / n).toFixed(6));
}

export function cosine(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += a[i] * b[i];
  return +d.toFixed(6);
}

/**
 * Builds a kNN topology. `maxLinksPerNode` is the mobile/perf lever, and
 * `field` (from the black hole mesh) adapts how tight the neighbourhoods are.
 */
export function buildTopology(agents: Agent[], maxLinksPerNode = 4, field?: MeshField): MeshTopology {
  const vectors = new Map<string, number[]>();
  for (const a of agents) vectors.set(a.id, embed(a));

  const tighten = field ? 0.85 + field.curvature * 0.3 : 1;
  const k = Math.max(1, Math.round(maxLinksPerNode * (field ? Math.max(0.5, field.stability) : 1)));

  const links: MeshLink[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>(agents.map((a) => [a.id, 0]));

  for (const a of agents) {
    const va = vectors.get(a.id)!;
    const scored = agents
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, s: cosine(va, vectors.get(b.id)!) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, k);
    for (const { b, s } of scored) {
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: a.id, b: b.id, similarity: s, weight: +Math.min(1, Math.max(0.05, s * tighten)).toFixed(4) });
      degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
      degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
    }
  }

  const avgDegree = agents.length ? +((links.length * 2) / agents.length).toFixed(2) : 0;
  return {
    vectors,
    links,
    degree,
    avgDegree,
    clustering: clusteringCoefficient(links, degree),
    components: countComponents(agents.map((a) => a.id), links),
  };
}

/** Adapts link weights toward the better-performing endpoint (Hebbian-ish). */
export function adaptWeights(topo: MeshTopology, agents: Agent[], lr = 0.2): MeshTopology {
  const fit = new Map(agents.map((a) => [a.id, a.stats.fitness]));
  const links = topo.links.map((l) => {
    const fa = fit.get(l.a) ?? 0;
    const fb = fit.get(l.b) ?? 0;
    const signal = Math.tanh((fa + fb) / 2000);
    const w = l.weight + lr * (signal - (l.weight - 0.5));
    return { ...l, weight: +Math.min(1, Math.max(0.02, w)).toFixed(4) };
  });
  return { ...topo, links };
}

/** One round of weighted vector message passing (mean aggregation). */
export function propagate(topo: MeshTopology, damping = 0.5): Map<string, number[]> {
  const acc = new Map<string, { sum: number[]; w: number }>();
  const push = (id: string, v: number[], w: number) => {
    const e = acc.get(id) ?? { sum: new Array(VECTOR_DIM).fill(0), w: 0 };
    for (let i = 0; i < VECTOR_DIM; i++) e.sum[i] += (v[i] ?? 0) * w;
    e.w += w;
    acc.set(id, e);
  };
  for (const l of topo.links) {
    const va = topo.vectors.get(l.a);
    const vb = topo.vectors.get(l.b);
    if (!va || !vb) continue;
    push(l.b, va, l.weight);
    push(l.a, vb, l.weight);
  }
  const out = new Map<string, number[]>();
  for (const [id, v] of topo.vectors) {
    const e = acc.get(id);
    if (!e || e.w === 0) {
      out.set(id, v);
      continue;
    }
    const mixed = v.map((x, i) => x * (1 - damping) + (e.sum[i] / e.w) * damping);
    out.set(id, normalize(mixed));
  }
  return out;
}

/** Routes a message along the highest-weight path (1 hop fan-out). */
export function route(topo: MeshTopology, from: string, kind: MeshMessage["kind"]): MeshMessage[] {
  const v = topo.vectors.get(from);
  if (!v) return [];
  return topo.links
    .filter((l) => l.a === from || l.b === from)
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 3)
    .map((l) => ({ from, to: l.a === from ? l.b : l.a, vector: v, kind }));
}

function clusteringCoefficient(links: MeshLink[], degree: Map<string, number>): number {
  const adj = new Map<string, Set<string>>();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, new Set());
    if (!adj.has(l.b)) adj.set(l.b, new Set());
    adj.get(l.a)!.add(l.b);
    adj.get(l.b)!.add(l.a);
  }
  let total = 0;
  let n = 0;
  for (const [id, nb] of adj) {
    const d = degree.get(id) ?? nb.size;
    if (d < 2) continue;
    const arr = [...nb];
    let tri = 0;
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) if (adj.get(arr[i])?.has(arr[j])) tri++;
    total += (2 * tri) / (d * (d - 1));
    n++;
  }
  return n ? +(total / n).toFixed(3) : 0;
}

function countComponents(ids: string[], links: MeshLink[]): number {
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const l of links) {
    const ra = find(l.a);
    const rb = find(l.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return new Set(ids.map(find)).size;
}
