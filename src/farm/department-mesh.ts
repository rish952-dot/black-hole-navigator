export type DepartmentId =
  | "central-mind"
  | "hive"
  | "ai"
  | "jobs"
  | "execution"
  | "evolution"
  | "finance"
  | "backend"
  | "observability";

export type DepartmentVector = {
  confidence: number;
  novelty: number;
  urgency: number;
  strategy: number[];
};

export type DepartmentSignal = {
  id: string;
  from: DepartmentId;
  to: DepartmentId;
  type: string;
  vector: DepartmentVector;
  createdAt: string;
};

const DEPARTMENTS: DepartmentId[] = [
  "central-mind", "hive", "ai", "jobs", "execution",
  "evolution", "finance", "backend", "observability",
];

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

const normalizeVector = (vector: DepartmentVector): DepartmentVector => ({
  confidence: clamp(vector.confidence),
  novelty: clamp(vector.novelty),
  urgency: clamp(vector.urgency),
  strategy: vector.strategy.slice(0, 8).map(clamp),
});

/**
 * Lightweight inter-department control plane.
 * Departments exchange compact vectors rather than model text by default.
 */
export class DepartmentMesh {
  private readonly links = new Map<DepartmentId, Set<DepartmentId>>();
  private readonly inboxes = new Map<DepartmentId, DepartmentSignal[]>();

  constructor() {
    for (const department of DEPARTMENTS) {
      this.links.set(department, new Set());
      this.inboxes.set(department, []);
    }
  }

  connect(a: DepartmentId, b: DepartmentId): void {
    if (a === b) return;
    this.requireDepartment(a);
    this.requireDepartment(b);
    this.links.get(a)!.add(b);
    this.links.get(b)!.add(a);
  }

  connectMany(pairs: readonly [DepartmentId, DepartmentId][]): void {
    for (const [a, b] of pairs) this.connect(a, b);
  }

  signal(from: DepartmentId, to: DepartmentId, type: string, vector: DepartmentVector): DepartmentSignal {
    this.requireDepartment(from);
    this.requireDepartment(to);
    if (!this.links.get(from)!.has(to)) throw new Error(`Departments are not connected: ${from} -> ${to}`);

    const signal: DepartmentSignal = {
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      type,
      vector: normalizeVector(vector),
      createdAt: new Date().toISOString(),
    };
    this.inboxes.get(to)!.push(signal);
    return { ...signal, vector: { ...signal.vector, strategy: [...signal.vector.strategy] } };
  }

  broadcast(from: DepartmentId, type: string, vector: DepartmentVector): DepartmentSignal[] {
    return [...this.links.get(from) ?? []].map((to) => this.signal(from, to, type, vector));
  }

  drain(department: DepartmentId): DepartmentSignal[] {
    this.requireDepartment(department);
    const inbox = this.inboxes.get(department)!;
    this.inboxes.set(department, []);
    return inbox.map((signal) => ({ ...signal, vector: { ...signal.vector, strategy: [...signal.vector.strategy] } }));
  }

  neighbors(department: DepartmentId): DepartmentId[] {
    this.requireDepartment(department);
    return [...this.links.get(department)!];
  }

  snapshot(): Record<DepartmentId, DepartmentId[]> {
    return Object.fromEntries(DEPARTMENTS.map((department) => [department, this.neighbors(department)])) as Record<DepartmentId, DepartmentId[]>;
  }

  pending(): number {
    return [...this.inboxes.values()].reduce((count, inbox) => count + inbox.length, 0);
  }

  private requireDepartment(department: DepartmentId): void {
    if (!this.links.has(department)) throw new Error(`Unknown department: ${department}`);
  }
}

/**
 * Central-spine + lateral-ring topology: every department can reach the
 * Central Mind, while adjacent departments also communicate directly.
 */
export const createDefaultDepartmentMesh = (): DepartmentMesh => {
  const mesh = new DepartmentMesh();
  mesh.connectMany([
    ["central-mind", "hive"],
    ["central-mind", "ai"],
    ["central-mind", "jobs"],
    ["central-mind", "execution"],
    ["central-mind", "evolution"],
    ["central-mind", "finance"],
    ["central-mind", "backend"],
    ["central-mind", "observability"],
    ["hive", "ai"],
    ["ai", "execution"],
    ["execution", "evolution"],
    ["evolution", "finance"],
    ["finance", "jobs"],
    ["jobs", "backend"],
    ["backend", "observability"],
    ["observability", "hive"],
  ]);
  return mesh;
};