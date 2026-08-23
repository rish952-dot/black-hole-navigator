type Vector = {
  confidence: number;
  novelty: number;
  urgency: number;
  strategy: number[];
};

type ProviderResult = {
  provider: string;
  model?: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  attempts: number;
  success: number;
  failures: number;
  latencyMs: number[];
  httpStatus: number[];
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  vectors: Vector[];
  error?: string;
};

type PaperAccount = {
  balance: number;
  reserved: number;
  earned: number;
  spent: number;
  tasks: number;
};

const providers = (process.env.AI_PROVIDERS ?? "xai,groq,gemini,claude,openrouter")
  .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const rounds = Math.max(1, Math.min(20, Number(process.env.STRESS_ROUNDS ?? "10")));
const nodesPerProvider = Math.max(1, Math.min(8, Number(process.env.NODES_PER_PROVIDER ?? "3")));
const concurrency = Math.max(1, Math.min(12, Number(process.env.STRESS_CONCURRENCY ?? "4")));
const maxOutputTokens = Math.max(16, Math.min(64, Number(process.env.MAX_OUTPUT_TOKENS ?? "32")));
const taskValue = 5;
const taskCost = 1;

const system = "Vector node only. Return ONLY JSON {confidence,novelty,urgency,strategy}. Numbers 0..1. strategy exactly 5 numbers. No prose.";
const compact = JSON.stringify({ n: 1, g: 0, o: "stress", s: [0.45,0.6,0.5,0.25,0.4], c: 0.55, e: 4, cost: 1, nov: 0.6, urg: 0.4 });

const clamp = (v: unknown, fallback = 0.5) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

function parseVector(raw: string): Vector {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const strategy = Array.isArray(parsed.strategy) ? parsed.strategy.slice(0, 5).map((x) => clamp(x)) : [];
  while (strategy.length < 5) strategy.push(0.5);
  return { confidence: clamp(parsed.confidence), novelty: clamp(parsed.novelty), urgency: clamp(parsed.urgency), strategy };
}

async function bodyText(response: Response): Promise<string> {
  return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 240);
}

function vectorScore(v: Vector): number {
  const strategyMean = v.strategy.reduce((a,b) => a + b, 0) / v.strategy.length;
  return (v.confidence * 0.45) + (v.novelty * 0.2) + (v.urgency * 0.15) + (strategyMean * 0.2);
}

async function callProvider(provider: string): Promise<{ status: "PASS" | "FAIL" | "SKIPPED"; model?: string; latency: number; httpStatus?: number; vector?: Vector; promptTokens?: number; outputTokens?: number; totalTokens?: number; error?: string }> {
  const started = performance.now();
  let response: Response;
  let model = "";

  try {
    if (provider === "xai" || provider === "groq" || provider === "openrouter") {
      const cfg = provider === "xai"
        ? { key: process.env.XAI_API_KEY, base: "https://api.x.ai/v1", model: process.env.XAI_MODEL ?? "grok-4.6" }
        : provider === "groq"
          ? { key: process.env.GROQ_API_KEY, base: "https://api.groq.com/openai/v1", model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile" }
          : { key: process.env.OPENROUTER_API_KEY, base: "https://openrouter.ai/api/v1", model: process.env.OPENROUTER_MODEL ?? "" };
      model = cfg.model;
      if (!cfg.key || !model) return { status: "SKIPPED", model, latency: 0, error: "missing key/model" };
      response = await fetch(`${cfg.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: maxOutputTokens, messages: [{ role: "system", content: system }, { role: "user", content: compact }] }),
      });
      const latency = +(performance.now() - started).toFixed(1);
      if (!response.ok) return { status: "FAIL", model, latency, httpStatus: response.status, error: await bodyText(response) };
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      const raw = body.choices?.[0]?.message?.content;
      if (!raw) return { status: "FAIL", model, latency, httpStatus: response.status, error: "empty response" };
      return { status: "PASS", model, latency, httpStatus: response.status, vector: parseVector(raw), promptTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0, totalTokens: body.usage?.total_tokens ?? 0 };
    }

    if (provider === "claude" || provider === "anthropic") {
      const key = process.env.CLAUDE_API_KEY;
      model = process.env.CLAUDE_MODEL ?? "";
      if (!key || !model) return { status: "SKIPPED", model, latency: 0, error: "missing key/model" };
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxOutputTokens, temperature: 0, system, messages: [{ role: "user", content: compact }] }),
      });
      const latency = +(performance.now() - started).toFixed(1);
      if (!response.ok) return { status: "FAIL", model, latency, httpStatus: response.status, error: await bodyText(response) };
      const body = await response.json() as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
      const raw = body.content?.find((x) => x.type === "text")?.text;
      if (!raw) return { status: "FAIL", model, latency, httpStatus: response.status, error: "empty response" };
      const promptTokens = body.usage?.input_tokens ?? 0;
      const outputTokens = body.usage?.output_tokens ?? 0;
      return { status: "PASS", model, latency, httpStatus: response.status, vector: parseVector(raw), promptTokens, outputTokens, totalTokens: promptTokens + outputTokens };
    }

    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      model = process.env.GEMINI_MODEL ?? "";
      if (!key || !model) return { status: "SKIPPED", model, latency: 0, error: "missing key/model" };
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: compact }] }], generationConfig: { temperature: 0, maxOutputTokens, responseMimeType: "application/json" } }),
      });
      const latency = +(performance.now() - started).toFixed(1);
      if (!response.ok) return { status: "FAIL", model, latency, httpStatus: response.status, error: await bodyText(response) };
      const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
      const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!raw) return { status: "FAIL", model, latency, httpStatus: response.status, error: "empty response" };
      return { status: "PASS", model, latency, httpStatus: response.status, vector: parseVector(raw), promptTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0, totalTokens: body.usageMetadata?.totalTokenCount ?? 0 };
    }

    return { status: "SKIPPED", latency: 0, error: "unsupported provider" };
  } catch (error) {
    return { status: "FAIL", model, latency: +(performance.now() - started).toFixed(1), error: error instanceof Error ? error.message : String(error) };
  }
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const results = new Map<string, ProviderResult>();
for (const provider of providers) {
  const r: ProviderResult = { provider, status: "SKIPPED", attempts: 0, success: 0, failures: 0, latencyMs: [], httpStatus: [], promptTokens: 0, outputTokens: 0, totalTokens: 0, vectors: [] };
  results.set(provider, r);
  const jobs = Array.from({ length: rounds * nodesPerProvider }, (_, i) => i);
  await mapLimit(jobs, concurrency, async () => {
    r.attempts++;
    const out = await callProvider(provider);
    if (out.status === "PASS") {
      r.success++;
      r.status = "PASS";
      if (out.vector) r.vectors.push(out.vector);
      if (out.latency) r.latencyMs.push(out.latency);
      if (out.httpStatus) r.httpStatus.push(out.httpStatus);
      r.promptTokens += out.promptTokens ?? 0;
      r.outputTokens += out.outputTokens ?? 0;
      r.totalTokens += out.totalTokens ?? 0;
    } else if (out.status === "FAIL") {
      r.failures++;
      r.status = "FAIL";
      r.error = out.error;
      if (out.latency) r.latencyMs.push(out.latency);
      if (out.httpStatus) r.httpStatus.push(out.httpStatus);
    }
  });
}

const latencyStats = (xs: number[]) => {
  if (!xs.length) return { min: 0, p50: 0, p95: 0, max: 0, avg: 0 };
  const sorted = [...xs].sort((a,b) => a-b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { min: sorted[0], p50: pct(0.5), p95: pct(0.95), max: sorted[sorted.length-1], avg: +(sorted.reduce((a,b)=>a+b,0)/sorted.length).toFixed(1) };
};

const allVectors = [...results.values()].flatMap((r) => r.vectors.map((v) => ({ provider: r.provider, score: vectorScore(v), vector: v })));
const top = allVectors.sort((a,b) => b.score-a.score).slice(0, 10);
const scoreMean = allVectors.length ? +(allVectors.reduce((a,b)=>a+b.score,0)/allVectors.length).toFixed(4) : 0;

const paper: Record<string, PaperAccount> = {};
for (const provider of providers) paper[provider] = { balance: 100, reserved: 0, earned: 0, spent: 0, tasks: 0 };
for (const item of allVectors) {
  const account = paper[item.provider];
  if (!account) continue;
  account.reserved += taskCost;
  account.spent += taskCost;
  if (item.score >= 0.55) { account.earned += taskValue; account.balance += taskValue - taskCost; account.tasks++; }
  account.reserved = Math.max(0, account.reserved - taskCost);
}

const report = {
  status: "AI_MESH_FULL_STRESS_PAPER_ONLY",
  generatedAt: new Date().toISOString(),
  config: { providers, rounds, nodesPerProvider, concurrency, maxOutputTokens },
  providers: Object.fromEntries([...results.entries()].map(([name, r]) => [name, {
    status: r.status,
    attempts: r.attempts,
    success: r.success,
    failures: r.failures,
    successRate: r.attempts ? +(r.success / r.attempts).toFixed(4) : 0,
    latency: latencyStats(r.latencyMs),
    promptTokens: r.promptTokens,
    outputTokens: r.outputTokens,
    totalTokens: r.totalTokens,
    avgTokensPerSuccess: r.success ? +(r.totalTokens / r.success).toFixed(1) : 0,
    error: r.error,
  }])),
  cooperation: { vectors: allVectors.length, scoreMean, topVectors: top },
  paperAccountCompatibility: {
    mode: "SIMULATED_PAPER_LEDGER",
    noRealOrders: true,
    noRealPayments: true,
    accounts: paper,
  },
};

await Bun.write("ai-mesh-full-stress.json", JSON.stringify(report, null, 2));
await Bun.write("ai-mesh-full-stress.md", [
  "# AI Mesh Full Stress",
  "",
  `Status: ${report.status}`,
  `Providers: ${providers.join(", ")}`,
  `Rounds: ${rounds}`,
  `Nodes/provider: ${nodesPerProvider}`,
  `Concurrency: ${concurrency}`,
  `Max output tokens/request: ${maxOutputTokens}`,
  `Cooperation vectors: ${allVectors.length}`,
  `Mean cooperation score: ${scoreMean}`,
  "",
  ...Object.entries(report.providers).map(([name, p]) => `- ${name}: ${p.status}; success ${p.successRate}; latency p50 ${p.latency.p50}ms / p95 ${p.latency.p95}ms; tokens ${p.totalTokens}`),
  "",
  "Paper account check is simulated only: no real orders, payments, wallets, or external account actions.",
].join("\n"));

console.log(JSON.stringify(report, null, 2));
