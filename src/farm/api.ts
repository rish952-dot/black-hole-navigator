export interface FarmApiNudge {
  mutationDelta: number;
  explorationDelta: number;
  riskDelta: number;
  reason: string;
}

export interface FarmApiInput {
  botId: number;
  generation: number;
  seed: number;
  bestFitness: number;
  averageFitness: number;
  diversity: number;
  mesh: {
    curvature: number;
    energyDensity: number;
    stability: number;
    anomalies: number;
  };
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Optional, low-frequency AI strategy adapter.
 * It never decides economic fitness; it only nudges exploration parameters.
 * Disabled unless FARM_AI_API_KEY, FARM_AI_BASE_URL and FARM_AI_MODEL are set.
 */
export async function requestFarmNudge(input: FarmApiInput): Promise<FarmApiNudge | null> {
  const apiKey = process.env.FARM_AI_API_KEY;
  const baseUrl = process.env.FARM_AI_BASE_URL;
  const model = process.env.FARM_AI_MODEL;
  if (!apiKey || !baseUrl || !model) return null;

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 160,
      messages: [
        {
          role: "system",
          content:
            "Return ONLY minified JSON with mutationDelta, explorationDelta, riskDelta in [-0.08,0.08] and a reason under 80 chars. You are tuning an evolutionary simulation; never report or invent profit. Keep fitness independent of your output.",
        },
        { role: "user", content: JSON.stringify(input) },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Farm AI API ${response.status}`);

  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Farm AI API returned no content");

  const parsed = JSON.parse(content) as Partial<FarmApiNudge>;
  return {
    mutationDelta: clamp(Number(parsed.mutationDelta) || 0, -0.08, 0.08),
    explorationDelta: clamp(Number(parsed.explorationDelta) || 0, -0.08, 0.08),
    riskDelta: clamp(Number(parsed.riskDelta) || 0, -0.08, 0.08),
    reason: String(parsed.reason ?? "no-op").slice(0, 80),
  };
}
