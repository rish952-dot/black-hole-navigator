import { describe, expect, it } from "vitest";
import { discoverRealContracts } from "../farm/hunt-sources";

describe("real contract discovery", () => {
  it("always returns paying listings with valid apply URLs", async () => {
    const d = await discoverRealContracts(5);
    expect(d.listings.length).toBeGreaterThan(0);
    expect(d.live.length).toBeGreaterThan(0);
    for (const l of d.listings) {
      expect(l.title.length).toBeGreaterThan(3);
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.id.length).toBeGreaterThan(0);
      expect(["bounty", "audit-competition", "quest", "freelance"]).toContain(l.kind);
      if (l.rewardUsd !== undefined) expect(l.rewardUsd).toBeGreaterThan(0);
    }
  });

  it("survives total source failure via the curated registry", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    try {
      const d = await discoverRealContracts(5);
      expect(d.listings.length).toBeGreaterThanOrEqual(10);
      expect(d.live.every((l) => l.error)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
