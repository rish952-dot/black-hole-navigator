import type { Agent, MeshField } from "./types";
import { deriveRole } from "./roles";

/**
 * Adaptive vector-based mesh: fixed-width agent embeddings, kNN links,
 * adaptive weights, vector propagation and bounded fan-out routing.
 */
export const VECTOR_DIM = 8;

export interface MeshLink {
  a: string;
  b: string;
  weight: number;
  similarity: number;
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
  scout: 0,
  executor: 0.2,
  verifier: 0.4,
  treasurer: 0.6,
  healer: 0.8,
  governor: 1,
};

export function embed(a: Agent): number[] {
  const g = a.genome;
  return normalize([
    g.riskTolerance,
    g.verificationLevel,
    g.researchDepth,
    Math.min(1, g.parallelism / 8),
    Math.min(1, g.maximumTaskDuration / 120),
    Math.min(1, Math.max(-1, a.stats.roi / 4)) * 0.5 + 0.5,
    Math.min(1, Math.max(0, a.stats.successRate)),
    ROLE_INDEX[deriveRole(a)] ?? 0.5,
  ]);
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

/** Builds a bounded kNN topology. */
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
      .map((b) => ({ id: b.id, vector: vectors.get(b.id)!, score: cosine(va, vectors.get(b.id)!) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, k);

    for (const { id: bid, score } of scored) {
      const key = a.id < bid ? `${a.id}|${bid}` : `${bid}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        a: a.id,
        b: bid,
        similarity: score,
        weight: +Math.min(1, Math.max(0.05, score * tighten)).toFixed(4),
      });
      degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
      degree.set(bid, (degree.get(bid) ?? 0) + 1);
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

/** Adapts link weights from endpoint fitness. */
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

/** One weighted vector-message propagation round. */
export function propagate(topo: MeshTopology, damping = 0.5): Map<string, number[]> {
  const acc = new Map<string, { sum: number[]; w: number }>();
  const push = (id: string, vector: number[], weight: number) => {
    const entry = acc.get(id) ?? { sum: new Array(VECTOR_DIM).fill(0), w: 0 };
    for (let i = 0; i < VECTOR_DIM; i++) entry.sum[i] += (vector[i] ?? 0) * weight;
    entry.w += weight;
    acc.set(id, entry);
  };

  for (const link of topo.links) {
    const va = topo.vectors.get(link.a);
    const vb = topo.vectors.get(link.b);
    if (!va || !vb) continue;
    push(link.b, va, link.weight);
    push(link.a, vb, link.weight);
  }

  const out = new Map<string, number[]>();
  for (const [id, vector] of topo.vectors) {
    const entry = acc.get(id);
    if (!entry || entry.w === 0) {
      out.set(id, [...vector]);
      continue;
    }
    out.set(id, normalize(vector.map((x, i) => x * (1 - damping) + (entry.sum[i] / entry.w) * damping)));
  }
  return out;
}

/** One-hop bounded fan-out by strongest current links. */
export function route(topo: MeshTopology, from: string, kind: MeshMessage["kind"]): MeshMessage[] {
  const vector = topo.vectors.get(from);
  if (!vector) return [];
  return topo.links
    .filter((l) => l.a === from || l.b === from)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((l) => ({ from, to: l.a === from ? l.b : l.a, vector: [...vector], kind }));
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
  for (const [id, neighbors] of adj) {
    const d = degree.get(id) ?? neighbors.size;
    if (d < 2) continue;
    const list = [...neighbors];
    let triangles = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (adj.get(list[i])?.has(list[j])) triangles++;
      }
    }
    total += (2 * triangles) / (d * (d - 1));
    n++;
  }
  return n ? +(total / n).toFixed(3) : 0;
}

function countComponents(ids: string[], links: MeshLink[]): number {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (start: string): string => {
    let node = start;
    while (parent.get(node) !== node) {
      parent.set(node, parent.get(parent.get(node)!)!);
      node = parent.get(node)!;
    }
    return node;
  };

  for (const link of links) {
    const a = find(link.a);
    const b = find(link.b);
    if (a !== b) parent.set(a, b);
  }
  return new Set(ids.map(find)).size;
}
