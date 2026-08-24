import type { HuntListing } from "./job-pathways";

/**
 * Real paying-contract discovery. Listings come from public APIs of
 * platforms that actually pay for completed work (bug bounties, audit
 * competitions, quests, freelance). The farm never auto-applies: claiming
 * or submitting work happens through each platform's own account/terms
 * flow. This module only discovers and ranks what is genuinely open.
 */

export interface HuntSource {
  id: string;
  label: string;
  kind: HuntListing["kind"];
  fetchListings(limit: number): Promise<HuntListing[]>;
}

const UA = { "User-Agent": "black-hole-navigator-farm/1.0", Accept: "application/json" };
const TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

const now = () => new Date().toISOString();

/** Algora — open-source bounties with USD rewards, paid on merge. */
const algora: HuntSource = {
  id: "algora",
  label: "Algora",
  kind: "bounty",
  async fetchListings(limit) {
    const input = encodeURIComponent(JSON.stringify({ json: { status: "open" } }));
    const data = (await getJson(`https://algora.io/api/trpc/bounty.list?input=${input}`)) as Array<{
      result?: { data?: { json?: { items?: Array<Record<string, unknown>> } } };
    }>;
    const items = data[0]?.result?.data?.json?.items ?? [];
    return items.slice(0, limit).map((raw, i) => {
      const b = raw as { id?: string; reward?: { amount?: number; currency?: string }; task?: { title?: string; url?: string; repo_name?: string; tech?: string[] } };
      return {
        id: b.id ?? `algora-${i}`,
        source: "algora",
        title: b.task?.title ?? "Untitled bounty",
        organization: b.task?.repo_name,
        rewardUsd: typeof b.reward?.amount === "number" ? b.reward.amount / 100 : undefined,
        currency: b.reward?.currency ?? "USD",
        url: b.task?.url ?? "https://algora.io/bounties",
        skills: (b.task?.tech ?? []).slice(0, 6),
        kind: "bounty" as const,
        fetchedAt: now(),
      };
    });
  },
};

/** Superteam Earn — live Solana-ecosystem bounties and gigs paying in stablecoins. */
const superteam: HuntSource = {
  id: "superteam",
  label: "Superteam Earn",
  kind: "freelance",
  async fetchListings(limit) {
    const data = (await getJson("https://earn.superteam.fun/api/listings?status=open&take=40")) as Array<{
      id?: string;
      title?: string;
      rewardAmount?: number;
      token?: string;
      slug?: string;
      type?: string;
      sponsor?: { name?: string };
      skills?: Array<{ skills?: string }> | string[];
    }>;
    return data.slice(0, limit).map((l, i) => ({
      id: l.id ?? `superteam-${i}`,
      source: "superteam",
      title: l.title ?? "Untitled listing",
      organization: l.sponsor?.name,
      rewardUsd: typeof l.rewardAmount === "number" ? l.rewardAmount : undefined,
      currency: l.token ?? "USDC",
      url: `https://earn.superteam.fun/listing/${l.slug ?? l.id ?? ""}`,
      skills: Array.isArray(l.skills)
        ? l.skills.map((s) => (typeof s === "string" ? s : s.skills ?? "")).filter(Boolean).slice(0, 6)
        : [],
      kind: (l.type === "bounty" ? "bounty" : "freelance") as HuntListing["kind"],
      fetchedAt: now(),
    }));
  },
};

/** Immunefi — web3 bug bounties; critical findings pay up to millions in USDC. */
const immunefi: HuntSource = {
  id: "immunefi",
  label: "Immunefi",
  kind: "bounty",
  async fetchListings(limit) {
    const data = (await getJson("https://immunefi.com/bounty/api/bounties?limit=50")) as {
      bounties?: Array<{ id?: string | number; project?: string; maximum_reward?: number | string; ecosystem?: string }>;
    };
    const rows = data.bounties ?? (Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []);
    return rows.slice(0, limit).map((b, i) => {
      const r = b as Record<string, unknown>;
      const slug = String(r.project ?? r.id ?? i).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return {
        id: String(r.id ?? `immunefi-${i}`),
        source: "immunefi",
        title: `${String(r.project ?? "Protocol")} bug bounty`,
        organization: String(r.project ?? ""),
        rewardUsd: Number(r.maximum_reward ?? r.maxReward ?? 0) || undefined,
        currency: "USDC",
        url: `https://immunefi.com/bug-bounty/${slug}/information`,
        skills: ["security", "solidity", "audit"],
        kind: "bounty" as const,
        fetchedAt: now(),
      };
    });
  },
};

/** Code4rena — time-boxed audit competitions with USDC prize pools. */
const code4rena: HuntSource = {
  id: "code4rena",
  label: "Code4rena",
  kind: "audit-competition",
  async fetchListings(limit) {
    const data = (await getJson("https://code4rena.com/api/contests?status=active")) as Array<{
      title?: string;
      slug?: string;
      amount?: string;
      ecosystem?: string;
    }> | { contests?: Array<{ title?: string; slug?: string; amount?: string }> };
    const rows = Array.isArray(data) ? data : (data.contests ?? []);
    return rows.slice(0, limit).map((c, i) => ({
      id: c.slug ?? `c4-${i}`,
      source: "code4rena",
      title: c.title ?? "Audit competition",
      rewardUsd: Number(String(c.amount ?? "0").replace(/[^0-9.]/g, "")) || undefined,
      currency: "USDC",
      url: `https://code4rena.com/audits/${c.slug ?? ""}`,
      skills: ["security", "solidity", "audit"],
      kind: "audit-competition" as const,
      fetchedAt: now(),
    }));
  },
};

/**
 * Curated registry of platforms with a documented public apply path.
 * Always present so discovery never returns empty; live API results are
 * merged on top when reachable.
 */
const REGISTRY: HuntListing[] = [
  { id: "reg-immunefi", source: "immunefi", title: "Immunefi bug bounties — critical smart-contract findings pay up to $15M in USDC", organization: "Immunefi", rewardUsd: 15000000, currency: "USDC", url: "https://immunefi.com/explore/?filter=productType%3DBug%20Bounty%20Program", skills: ["security", "solidity", "audit"], kind: "bounty", fetchedAt: now() },
  { id: "reg-code4rena", source: "code4rena", title: "Code4rena audit competitions — prize pools typically $100K–$500K USDC", organization: "Code4rena", rewardUsd: 500000, currency: "USDC", url: "https://code4rena.com/audits", skills: ["security", "solidity", "audit"], kind: "audit-competition", fetchedAt: now() },
  { id: "reg-sherlock", source: "sherlock", title: "Sherlock audit contests + insurance-backed bounties", organization: "Sherlock", rewardUsd: 500000, currency: "USDC", url: "https://audits.sherlock.xyz/contests", skills: ["security", "solidity", "audit"], kind: "audit-competition", fetchedAt: now() },
  { id: "reg-codehawks", source: "codehawks", title: "Codehawks First Flights — beginner-friendly audit contests", organization: "Cyfrin Codehawks", currency: "USDC", url: "https://codehawks.cyfrin.io/", skills: ["security", "solidity", "audit"], kind: "audit-competition", fetchedAt: now() },
  { id: "reg-cantina", source: "cantina", title: "Cantina competitions — pools up to $2M+ (EigenLayer, Uniswap v4)", organization: "Cantina", rewardUsd: 2000000, currency: "USDC", url: "https://cantina.xyz/competitions", skills: ["security", "solidity", "audit"], kind: "audit-competition", fetchedAt: now() },
  { id: "reg-algora", source: "algora", title: "Algora open-source bounties — paid on merge, $200–$5,000 per task", organization: "Algora", rewardUsd: 5000, currency: "USD", url: "https://algora.io/bounties", skills: ["coding", "typescript", "open-source"], kind: "bounty", fetchedAt: now() },
  { id: "reg-gitcoin", source: "gitcoin", title: "Gitcoin bounties — task-based funding, clear deliverables and rewards", organization: "Gitcoin", currency: "ETH", url: "https://gitcoin.co/mechanisms/bounties", skills: ["coding", "web3", "open-source"], kind: "bounty", fetchedAt: now() },
  { id: "reg-dework", source: "dework", title: "Dework — DAO task boards with token/USDC bounties", organization: "Dework", currency: "USDC", url: "https://dework.xyz/", skills: ["coding", "community", "web3"], kind: "freelance", fetchedAt: now() },
  { id: "reg-layer3", source: "layer3", title: "Layer3 — onchain quests paying L3 tokens and credentials", organization: "Layer3", currency: "L3", url: "https://layer3.xyz/", skills: ["web3", "onchain"], kind: "quest", fetchedAt: now() },
  { id: "reg-superteam", source: "superteam", title: "Superteam Earn — Solana ecosystem bounties and freelance gigs in USDC", organization: "Superteam", currency: "USDC", url: "https://earn.superteam.fun/", skills: ["coding", "solana", "design", "writing"], kind: "freelance", fetchedAt: now() },
];

const LIVE_SOURCES: HuntSource[] = [superteam, algora, immunefi, code4rena];

export interface HuntDiscovery {
  fetchedAt: string;
  live: { source: string; count: number; error?: string }[];
  listings: HuntListing[];
}

/** Discover real paying contracts: live APIs first, curated registry always. */
export async function discoverRealContracts(limitPerSource = 10): Promise<HuntDiscovery> {
  const live: HuntDiscovery["live"] = [];
  const found: HuntListing[] = [];
  await Promise.all(
    LIVE_SOURCES.map(async (src) => {
      try {
        const items = await src.fetchListings(limitPerSource);
        found.push(...items);
        live.push({ source: src.id, count: items.length });
      } catch (error) {
        live.push({ source: src.id, count: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }),
  );
  const liveIds = new Set(found.map((l) => l.source));
  const registry = REGISTRY.filter((r) => !liveIds.has(r.source) || found.every((f) => f.url !== r.url));
  const listings = [...found, ...registry]
    .sort((a, b) => (b.rewardUsd ?? 0) - (a.rewardUsd ?? 0))
    .slice(0, 40);
  return { fetchedAt: now(), live, listings };
}
