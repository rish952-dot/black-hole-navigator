import { NEUTRAL_MESH, type MeshField } from "./types";

/**
 * Tiny pub/sub bridge so the black hole / neural mesh simulator can publish
 * its live field into the agent farm (symbiotic breeding ground).
 */
let field: MeshField = { ...NEUTRAL_MESH };
const listeners = new Set<(f: MeshField) => void>();

export function publishMeshField(next: Partial<MeshField>) {
  field = { ...field, ...next };
  listeners.forEach((l) => l(field));
}

export function getMeshField(): MeshField {
  return field;
}

export function subscribeMeshField(fn: (f: MeshField) => void): () => void {
  listeners.add(fn);
  fn(field);
  return () => listeners.delete(fn);
}
