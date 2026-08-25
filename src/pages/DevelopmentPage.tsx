import { Link } from "react-router-dom";

/**
 * /development — living tracker of where the farm stands against the
 * Executive Summary blueprint: eight surveyed mesh patterns distilled into
 ** Security → Resilience → Testing → Acquisition milestones, both done and runway.
 */

type Phase = "done" | "now" | "next";

interface Milestone {
  phase: Phase;
  lane: "Survey / Acquire" | "Security" | "Resilience" | "Testing & Roll-out";
  title: string;
  commit?: string;
  detail: string;
  blueprint: string;
  gantt?: string;
}

const milestones: Milestone[] = [
  {
    phase: "done",
    lane: "Survey / Acquire",
    title: "Baseline: evolutionary engine + central mind + neural pathways",
    commit: "849b0c7",
    detail: "FarmEngine, CentralMind, DepartmentMesh, NeuralPathwayNetwork; 40 agents evolving under paper mode; fleet-status publishing.",
    blueprint: "Foundation the blueprint assumes existed; survey material target.",
    gantt: "Pre-survey",
  },
  {
    phase: "done",
    lane: "Survey / Acquire",
    title: "Active job-hunting: agents seek & settle work",
    commit: "bcea92d",
    detail: "SyntheticJobBoard behind ExternalWorkAdapter; discoverJobs + settle returning Promises; genome TOOLS vocabulary skills; 19 tests.",
    blueprint: "Acquisition layer for the farm — organizations/agents that hunt external opportunity (AgentMesh, Matrix patterns).",
    gantt: "Pre-survey",
  },
  {
    phase: "done",
    lane: "Survey / Acquire",
    title: "Real paying contracts: live bounty/board discovery",
    commit: "eec65da",
    detail: "hunt-sources.ts queries Superteam Earn / Algora / Immunefi / Code4rena public APIs + curated registry; console panel links to apply directly.",
    blueprint: "Source of external real-contract opportunities the hive can assign (Society Protocol ephemeral-teams onto real work).",
    gantt: "Ext. opportunity source",
  },
  {
    phase: "done",
    lane: "Resilience",
    title: "Hierarchical hive: Owner → CentralMind → Hive → Workers",
    commit: "5287e3e",
    detail: "HiveArchitecture with four layers, vector talk via vector-bus, deposit ledger with owner approval; 5 tests.",
    blueprint: "Matches Solace SAM orchestrator + Society/Cord layered mesh; deposits = financial isolation ledger.",
    gantt: "Resilience base",
  },
  {
    phase: "done",
    lane: "Security",
    title: "Financial gate around payouts",
    detail: "authorize(amount) enforces spendingLimit; overshoot throws. Wired into CentralMind account release; 2 tests.",
    blueprint: "Blueprint patch #4 — sandboxed FinancialGate (spend-limit enforcement) cloned from the TS & Py samples.",
    gantt: "Financial Gate (progress)",
  },
  {
    phase: "done",
    lane: "Resilience",
    title: "Supervisor election by uptime",
    detail: "election.ts: ElectionProtocol registers workers, holds elections among healthy candidates, picks highest-uptime supervisor; 4 tests.",
    blueprint: "Blueprint patch #2 — election heuristic (highest-uptime wins), directly cloned from the Agent-Elections sample.",
    gantt: "Supervisor Election",
  },
  {
    phase: "done",
    lane: "Resilience",
    title: "Heartbeat & failover monitoring",
    detail: "ElectionProtocol.ping/miss/evaluate: supervisor missing heartbeat → demote → hold fresh election among survivors; sticky dead excluded.",
    blueprint: "Blueprint patch #6 — heartbeat/failover (monitor.ts pattern) with in-code test for supervisor failover.",
    gantt: "Heartbeat/Failover",
  },
  {
    phase: "done",
    lane: "Testing & Roll-out",
    title: "TEST_HARNESS: 36 unit/integration tests, CI-green",
    detail: "vitest runs hunt-sources, election, hive-architecture, department-mesh, neural-pathways, job-hunting; lint clean (11 pre-existing warnings).",
    blueprint: "Blueprint patch #8 — multi-agent playwright/pytest harness. Coverage of failover, election, idempotency-style, encrypted-bus round-trip pattern.",
    gantt: "Write Unit/Integration Tests",
  },
  {
    phase: "now",
    lane: "Security",
    title: "Encrypted vector bus (next security PR)",
    detail: "vector-bus has encodeVector but no crypto. Blueprint sample (AES-GCM in TS) maps to peer-to-peer encryption; need keypairs + decrypt tests.",
    blueprint: "Blueprint patch #1 — encrypted vector bus, libsodium/cryptography round-trip + tamper tests. Highest-priority remaining.",
    gantt: "Encrypted Vector Bus (currently 'done' in doc gantt, but not in repo)",
  },
  {
    phase: "next",
    lane: "Security",
    title: "Data-leakage sanitization at the bus boundary",
    detail: "Blueprint patch #5 — schema-aligned JSON strip of controllers; middleware sanitizeInput for outbound vectors. OWASP-aligned.",
    blueprint: "Blueprint patch #5 — data sanitization & audit logging.",
    gantt: "Data Sanitization",
  },
  {
    phase: "next",
    lane: "Resilience",
    title: "Role transition handler → become/resign supervisor",
    detail: "Election works; now need role-promotion flow so supervisor role grants extra tasks and workers update routing after re-election.",
    blueprint: "Blueprint patch #3 — role transition handler wired to election outcome.",
    gantt: "Role Transition Handler",
  },
  {
    phase: "next",
    lane: "Survey / Acquire",
    title: "Executors: farm must actually complete real work to earn",
    detail: "Discovery is real; execution is paper. Next step: one worker that can complete a Superteam Earn listing end-to-end (script submission + review).",
    blueprint: "Blueprint's organizations need real capability — discovery without execution stays simulation.",
    gantt: "Live execution",
  },
];

const phaseStyles: Record<Phase, string> = {
  done: "border-emerald-400/30 bg-emerald-500/5 text-emerald-200/80",
  now: "border-amber-400/40 bg-amber-500/5 text-amber-200/80",
  next: "border-cyan-400/20 bg-cyan-500/5 text-cyan-200/60",
};

const phaseTag: Record<Phase, string> = {
  done: "✓ done",
  now: "● in flight",
  next: "○ next",
};

const lanes = ["Survey / Acquire", "Security", "Resilience", "Testing & Roll-out"] as const;

export default function DevelopmentPage() {
  const done = milestones.filter((m) => m.phase === "done").length;
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 text-cyan-100/80">
      <header className="flex items-baseline justify-between border-b border-cyan-400/20 pb-2">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-widest text-cyan-100">DEVELOPMENT TRACK</h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300/45">
            Executive Summary blueprint → Work/ai-farm-audit implementation
          </p>
        </div>
        <div className="text-right font-mono text-[10px]">
          <Link to="/console" className="block text-cyan-300/60 underline decoration-cyan-400/30 hover:text-cyan-100">
            ← console
          </Link>
          <Link to="/mesh" className="block text-cyan-300/40 underline decoration-cyan-400/20 hover:text-cyan-100">
            mesh /agent layer
          </Link>
        </div>
      </header>

      <div className="rounded-md border border-cyan-400/20 bg-black/40 p-3 font-mono text-[10px]">
        <div className="text-cyan-300/60">
          {done}/{milestones.length} milestones landed · branch <span className="text-emerald-300">Work/ai-farm-audit</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {milestones.filter((m) => m.phase === "done").map((m) => (
            <a
              key={m.title}
              href={m.commit ? `https://github.com/rish952-dot/black-hole-navigator/commit/${m.commit}` : "https://github.com/rish952-dot/black-hole-navigator/tree/Work/ai-farm-audit"}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-200/70 underline decoration-emerald-400/30 hover:text-emerald-200"
            >
              {m.commit ? m.commit.slice(0, 7) : "now"} ✓
            </a>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {lanes.map((lane) => (
          <section key={lane} className="rounded-md border border-cyan-400/15 bg-black/30 p-3">
            <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-violet-300/70">{lane}</h2>
            <div className="space-y-2">
              {milestones.filter((m) => m.lane === lane).map((m) => (
                <div key={m.title} className={`rounded-md border p-2 ${phaseStyles[m.phase]}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono text-[10px] font-semibold leading-tight">{m.title}</div>
                    <span className="shrink-0 whitespace-nowrap font-mono text-[8px] uppercase opacity-70">{phaseTag[m.phase]}</span>
                  </div>
                  <p className="mt-1 font-mono text-[9px] leading-snug opacity-80">{m.detail}</p>
                  <div className="mt-1 border-t border-white/5 pt-1 font-mono text-[8px] opacity-60">
                    <span className="text-violet-300/70">blueprint:</span> {m.blueprint}
                    {m.gantt && (
                      <span className="ml-2 border-l border-white/10 pl-2">
                        <span className="text-violet-300/70">gantt:</span> {m.gantt}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="rounded-md border border-cyan-400/15 bg-black/30 p-3 font-mono text-[9px] text-cyan-300/50">
        <div className="text-cyan-200/70">Blueprint citation</div>
        Survey: AgentMesh · Society Protocol · Matrix · Solace SAM · Google SAM · AMP · Cord · Agent-Elections. Mapping: Security (encrypted bus, sanitization, financial gate) → Resilience (election, roles, heartbeat) → Testing (harness, roll-out). Each milestone above cites its lane + blueprint patch #1–#8.
      </footer>
    </div>
  );
}
