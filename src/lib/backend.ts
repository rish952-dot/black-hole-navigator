/**
 * Thin, fail-soft transport for backend (edge) functions.
 *
 * Every call is time-boxed and never throws: callers get a discriminated
 * result so the UI can degrade to local-only operation when the backend is
 * unreachable (paused project, offline device, blocked network).
 */

function resolveBase(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  if (url && url !== "undefined") return `${url}/functions/v1`;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
  if (projectId && projectId !== "undefined") return `https://${projectId}.supabase.co/functions/v1`;
  return null;
}

export const FN_BASE = resolveBase();
export const PUB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const BACKEND_CONFIGURED = !!FN_BASE;

export type FnResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function callFunction<T>(
  name: string,
  body?: unknown,
  opts: { timeoutMs?: number; method?: "GET" | "POST" } = {},
): Promise<FnResult<T>> {
  if (!FN_BASE) return { ok: false, error: "Backend not configured", status: 0 };

  const { timeoutMs = 12000, method = body === undefined ? "GET" : "POST" } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${FN_BASE}/${name}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(PUB_KEY ? { Authorization: `Bearer ${PUB_KEY}`, apikey: PUB_KEY } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await resp.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 400) };
    }

    if (!resp.ok) {
      const msg =
        (payload && typeof payload === "object" && "error" in payload
          ? typeof (payload as { error: unknown }).error === "string"
            ? (payload as { error: string }).error
            : JSON.stringify((payload as { error: unknown }).error).slice(0, 300)
          : null) ?? `HTTP ${resp.status}`;
      return { ok: false, error: msg, status: resp.status };
    }

    return { ok: true, data: payload as T, status: resp.status };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return { ok: false, error: aborted ? "Request timed out" : e instanceof Error ? e.message : "Network error", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
