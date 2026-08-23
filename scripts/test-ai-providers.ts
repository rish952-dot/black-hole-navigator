type Vector = {
  confidence: number;
  novelty: number;
  urgency: number;
  strategy: number[];
};

type Result = {
  provider: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  model?: string;
  httpStatus?: number;
  elapsedMs?: number;
  vector?: Vector;
  error?: string;
  rawPreview?: string;
};

const requested = (process.env.AI_PROVIDERS ?? "xai,gemini,groq")
  .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

const system = "Return ONLY compact JSON. Schema: {\"confidence\":0..1,\"novelty\":0..1,\"urgency\":0..1,\"strategy\":[5 numbers 0..1]}. No markdown. No prose.";
const compact = JSON.stringify({ n: 1, g: 0, o: "mesh", s: [0.45, 0.6, 0.5, 0.25, 0.4], c: 0.55, e: 4, cost: 1, nov: 0.6, urg: 0.4 });

const clamp = (v: unknown, fallback = 0.5) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

function extractJsonObject(raw: string): string {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no complete JSON object found");
  return cleaned.slice(start, end + 1);
}

function parseVector(raw: string): Vector {
  const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  const strategy = Array.isArray(parsed.strategy) ? parsed.strategy.slice(0, 5).map((x) => clamp(x)) : [];
  while (strategy.length < 5) strategy.push(0.5);
  return {
    confidence: clamp(parsed.confidence),
    novelty: clamp(parsed.novelty),
    urgency: clamp(parsed.urgency),
    strategy,
  };
}

async function readText(response: Response): Promise<string> {
  return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 300);
}

function resultFromRaw(provider: string, model: string, elapsedMs: number, httpStatus: number, raw: string): Result {
  try {
    return { provider, status: "PASS", model, httpStatus, elapsedMs, vector: parseVector(raw) };
  } catch (error) {
    return { provider, status: "FAIL", model, httpStatus, elapsedMs, rawPreview: raw.slice(0, 240), error: `invalid vector JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function testOpenAICompatible(provider: string, apiKey: string | undefined, baseUrl: string, model: string): Promise<Result> {
  if (!apiKey || !model) return { provider, status: "SKIPPED", model, error: "missing API key or model secret" };
  const started = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 48, messages: [{ role: "system", content: system }, { role: "user", content: compact }] }),
  });
  const elapsedMs = +(performance.now() - started).toFixed(1);
  if (!response.ok) return { provider, status: "FAIL", model, httpStatus: response.status, elapsedMs, error: await readText(response) };
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const rawValue = body.choices?.[0]?.message?.content;
  if (typeof rawValue !== "string" || !rawValue.trim()) return { provider, status: "FAIL", model, httpStatus: response.status, elapsedMs, error: "empty response content" };
  return resultFromRaw(provider, model, elapsedMs, response.status, rawValue);
}

async function testClaude(): Promise<Result> {
  const apiKey = process.env.CLAUDE_API_KEY;
  const model = process.env.CLAUDE_MODEL;
  if (!apiKey || !model) return { provider: "claude", status: "SKIPPED", model, error: "missing CLAUDE_API_KEY or CLAUDE_MODEL" };
  const started = performance.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 48, temperature: 0, system, messages: [{ role: "user", content: compact }] }) });
  const elapsedMs = +(performance.now() - started).toFixed(1);
  if (!response.ok) return { provider: "claude", status: "FAIL", model, httpStatus: response.status, elapsedMs, error: await readText(response) };
  const body = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const raw = body.content?.find((x) => x.type === "text")?.text;
  if (!raw?.trim()) return { provider: "claude", status: "FAIL", model, httpStatus: response.status, elapsedMs, error: "empty response content" };
  return resultFromRaw("claude", model, elapsedMs, response.status, raw);
}

async function testGemini(): Promise<Result> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  if (!apiKey) return { provider: "gemini", status: "SKIPPED", model, error: "missing GEMINI_API_KEY" };
  const started = performance.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: compact }] }], generationConfig: { temperature: 0, maxOutputTokens: 48, responseMimeType: "application/json" } }) });
  const elapsedMs = +(performance.now() - started).toFixed(1);
  if (!response.ok) return { provider: "gemini", status: "FAIL", model, httpStatus: response.status, elapsedMs, error: await readText(response) };
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; promptFeedback?: unknown };
  const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!raw) return { provider: "gemini", status: "FAIL", model, httpStatus: response.status, elapsedMs, error: body.promptFeedback ? `no generated content: ${JSON.stringify(body.promptFeedback)}` : "empty response content" };
  return resultFromRaw("gemini", model, elapsedMs, response.status, raw);
}

const tests: Record<string, () => Promise<Result>> = {
  xai: () => testOpenAICompatible("xai", process.env.XAI_API_KEY, "https://api.x.ai/v1", process.env.XAI_MODEL ?? "grok-4.6"),
  groq: () => testOpenAICompatible("groq", process.env.GROQ_API_KEY, "https://api.groq.com/openai/v1", process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"),
  openrouter: () => testOpenAICompatible("openrouter", process.env.OPENROUTER_API_KEY, "https://openrouter.ai/api/v1", process.env.OPENROUTER_MODEL ?? "openrouter/free"),
  claude: testClaude,
  anthropic: testClaude,
  gemini: testGemini,
};

const started = performance.now();
const results = await Promise.all(requested.map(async (provider) => {
  const test = tests[provider];
  if (!test) return { provider, status: "SKIPPED" as const, error: "unsupported provider" };
  try { return await test(); }
  catch (error) { return { provider, status: "FAIL" as const, error: error instanceof Error ? error.message : String(error) }; }
}));

const report = { generatedAt: new Date().toISOString(), communication: "vector_only", maxTokensPerRequest: 48, elapsedMs: +(performance.now() - started).toFixed(1), results };
await Bun.write("ai-provider-connectivity.json", JSON.stringify(report, null, 2));
await Bun.write("ai-provider-connectivity.md", ["# AI Provider Connectivity", "", "Communication: vector_only", "Max output tokens/request: 48", "", ...results.map((r) => `- ${r.provider}: **${r.status}**${r.model ? ` (${r.model})` : ""}${r.elapsedMs ? ` — ${r.elapsedMs} ms` : ""}${r.error ? ` — ${r.error}` : ""}`), "", "Only compact vector responses are requested. No task execution, wallet, payment, or account actions are performed."].join("\n"));
console.log(JSON.stringify(report, null, 2));