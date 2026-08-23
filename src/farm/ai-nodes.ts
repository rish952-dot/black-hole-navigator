export type AIProvider = "xai" | "groq" | "gemini";

export type AIMeshNode = {
  id: number;
  botId: number;
  provider: AIProvider;
  role: "strategy" | "exploration" | "ranking";
  vectorOnly: true;
};

/**
 * Ten lightweight model nodes. They communicate only through compact vectors.
 * Economic fitness remains owned by the farm ledger.
 */
export const AI_MESH_NODES: readonly AIMeshNode[] = [
  { id: 1, botId: 1, provider: "xai", role: "strategy", vectorOnly: true },
  { id: 2, botId: 2, provider: "xai", role: "exploration", vectorOnly: true },
  { id: 3, botId: 3, provider: "xai", role: "ranking", vectorOnly: true },
  { id: 4, botId: 4, provider: "xai", role: "strategy", vectorOnly: true },
  { id: 5, botId: 5, provider: "groq", role: "strategy", vectorOnly: true },
  { id: 6, botId: 6, provider: "groq", role: "exploration", vectorOnly: true },
  { id: 7, botId: 7, provider: "groq", role: "ranking", vectorOnly: true },
  { id: 8, botId: 8, provider: "gemini", role: "strategy", vectorOnly: true },
  { id: 9, botId: 9, provider: "gemini", role: "exploration", vectorOnly: true },
  { id: 10, botId: 10, provider: "gemini", role: "ranking", vectorOnly: true },
];

export function nodesForProvider(provider: AIProvider): readonly AIMeshNode[] {
  return AI_MESH_NODES.filter((node) => node.provider === provider);
}
