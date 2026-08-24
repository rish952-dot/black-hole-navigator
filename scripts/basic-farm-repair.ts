/**
 * Tiny, allowlisted repository repair helper.
 * It is intentionally NOT an AI agent: it only restores missing farm files
 * from the known-good Lovable branch and makes no other edits.
 */

const ALLOWLIST = [
  "src/farm/engine.ts",
  "src/farm/api.ts",
  "src/farm/types.ts",
  "src/farm/evolution.ts",
  "src/farm/executor.ts",
  "src/farm/fitness.ts",
  "src/farm/genome.ts",
  "src/farm/ledger.ts",
  "src/farm/marketplace.ts",
  "src/farm/rng.ts",
  "scripts/run-farm-bot.ts",
];

const branch = "origin/Lovable";

async function exists(path: string): Promise<boolean> {
  return (await Bun.spawn(["bash", "-lc", `test -f ${JSON.stringify(path)}`]).exited) === 0;
}

async function restore(path: string): Promise<boolean> {
  const result = await Bun.spawn({
    cmd: ["git", "show", `${branch}:${path}`],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);

  if (exitCode !== 0) {
    console.error(`[repair] unable to restore ${path}: ${stderr.trim()}`);
    return false;
  }

  await Bun.write(path, stdout);
  console.log(`[repair] restored ${path} from Lovable`);
  return true;
}

async function main() {
  const fetch = Bun.spawn({
    cmd: ["git", "fetch", "origin", "Lovable", "--depth=1"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const fetchCode = await fetch.exited;
  if (fetchCode !== 0) throw new Error("Unable to fetch origin/Lovable");

  const repaired: string[] = [];
  for (const path of ALLOWLIST) {
    if (!(await exists(path)) && (await restore(path))) repaired.push(path);
  }

  console.log(`[repair] completed; restored ${repaired.length} file(s)`);
}

main().catch((error) => {
  console.error("[repair] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

export {};
