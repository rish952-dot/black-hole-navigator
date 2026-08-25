import { describe, expect, it } from "vitest";
import { ElectionProtocol } from "../farm/election";

function seed(e: ElectionProtocol, ids: string[], uptimes: Record<string, number>) {
  for (const id of ids) e.register(id);
  for (const [id, n] of Object.entries(uptimes)) {
    for (let i = 0; i < n; i++) e.ping(id);
  }
  e.holdElection();
}

describe("supervisor election + heartbeat (blueprint resilience)", () => {
  it("elects supervisor by highest uptime", () => {
    const e = new ElectionProtocol();
    seed(e, ["a", "b", "c"], { a: 5, b: 12, c: 3 });
    expect(e.supervisor()?.id).toBe("b");
    expect(e.snapshot().supervisor?.id).toBe("b");
  });

  it("holds new election when supervisor misses heartbeat", () => {
    const e = new ElectionProtocol(1);
    seed(e, ["a", "b", "c"], { a: 5, b: 12, c: 3 });
    e.miss("b"); // supervisor misses → demote via health drop
    e.miss("b");
    e.evaluate();
    const sup = e.supervisor()?.id;
    expect(sup).not.toBe("b");
    expect(["a", "c"]).toContain(sup!);
  });

  it("handles empty cluster gracefully", () => {
    const e = new ElectionProtocol();
    expect(e.holdElection().supervisorId).toBeNull();
  });

  it("re-election excludes removed nodes", () => {
    const e = new ElectionProtocol();
    seed(e, ["a", "b"], { a: 10, b: 2 });
    e.remove("a");
    expect(e.supervisor()?.id).toBe("b");
  });
});
