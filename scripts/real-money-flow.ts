import { mkdir } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet, getAddress, parseEther, parseUnits } from "ethers";

/**
 * REAL-MONEY execution boundary for the farm.
 *
 * Default is disabled. To broadcast real transactions, set:
 *   FINANCE_REAL_MONEY=true
 *   FINANCE_RPC_URL=<EVM RPC>
 *   FINANCE_PRIVATE_KEY=<runtime secret; never commit>
 *   FINANCE_DESTINATION=<allow-listed recipient>
 *   FINANCE_ASSET=ETH|USDC|USDT
 *   FINANCE_CHAIN_ID=<chain id>
 *   FINANCE_TOKEN_ADDRESS=<token contract for USDC/USDT>
 *
 * Hard controls:
 * - proportional payout allocation, never above the computed payout pool
 * - per-transaction cap
 * - persistent UTC daily cap across process restarts
 * - native-token reserve for gas
 * - chain-ID verification
 * - transaction receipt confirmation
 * - append-only local audit output
 */

type BotResult = {
  botId?: number;
  netProfit?: number;
  revenue?: number;
  costs?: number;
};

type Asset = "ETH" | "USDC" | "USDT";
type State = {
  dateUtc: string;
  asset: Asset;
  chainId: number;
  transferred: number;
  txHashes: string[];
};

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const num = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const envBool = (name: string) => (process.env[name] ?? "false").toLowerCase() === "true";
const utcDate = () => new Date().toISOString().slice(0, 10);
const round = (v: number) => Number(v.toFixed(6));

const sourceFile = process.argv[2] ?? "farm-loop-results.json";
const real = envBool("FINANCE_REAL_MONEY");
const dryRun = envBool("FINANCE_REAL_DRY_RUN");
const asset = (process.env.FINANCE_ASSET ?? "USDC").toUpperCase() as Asset;
const rpcUrl = (process.env.FINANCE_RPC_URL ?? "").trim();
const privateKey = (process.env.FINANCE_PRIVATE_KEY ?? "").trim();
const destination = (process.env.FINANCE_DESTINATION ?? "").trim();
const chainId = Math.floor(num(process.env.FINANCE_CHAIN_ID, 1));
const tokenAddress = (process.env.FINANCE_TOKEN_ADDRESS ?? "").trim();
const payoutRate = Math.max(0, Math.min(1, num(process.env.FINANCE_PAYOUT_RATE, 0.50)));
const reserveRate = Math.max(0, Math.min(0.90, num(process.env.FINANCE_RESERVE_RATE, 0.20)));
const hostingRate = Math.max(0, Math.min(0.80, num(process.env.FINANCE_HOSTING_RATE, 0.20)));
const minimumPayout = Math.max(0, num(process.env.FINANCE_MIN_PAYOUT, 1));
const maxPerTx = Math.max(0, num(process.env.FINANCE_MAX_TRANSFER, 10));
const maxDaily = Math.max(0, num(process.env.FINANCE_MAX_DAILY_TRANSFER, 25));
const minNativeReserve = Math.max(0, num(process.env.FINANCE_MIN_NATIVE_RESERVE, 0.01));
const confirmations = Math.max(1, Math.floor(num(process.env.FINANCE_CONFIRMATIONS, 1)));
const stateFile = process.env.FINANCE_STATE_FILE ?? "farm-output/real-money-state.json";
const auditFile = process.env.FINANCE_AUDIT_FILE ?? "farm-output/real-money-audit.jsonl";

if (!( ["ETH", "USDC", "USDT"] as string[]).includes(asset)) throw new Error(`Unsupported FINANCE_ASSET: ${asset}`);
if (real && (!rpcUrl || !privateKey || !destination)) {
  throw new Error("REAL mode requires FINANCE_RPC_URL, FINANCE_PRIVATE_KEY and FINANCE_DESTINATION");
}
if (real && !/^0x[a-fA-F0-9]{40}$/.test(destination)) throw new Error("FINANCE_DESTINATION is not a valid EVM address");
if (real && chainId <= 0) throw new Error("FINANCE_CHAIN_ID must be positive");
if (real && maxPerTx <= 0) throw new Error("FINANCE_MAX_TRANSFER must be positive");
if (real && maxDaily < maxPerTx) throw new Error("FINANCE_MAX_DAILY_TRANSFER must be >= FINANCE_MAX_TRANSFER");
if (real && asset !== "ETH" && !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
  throw new Error("FINANCE_TOKEN_ADDRESS is required for USDC/USDT");
}

const raw = JSON.parse(await Bun.file(sourceFile).text()) as { results?: BotResult[] };
const results = raw.results ?? [];
const revenue = results.reduce((s, r) => s + Math.max(0, num(r.revenue)), 0);
const costs = results.reduce((s, r) => s + Math.max(0, num(r.costs)), 0);
const netProfit = Math.max(0, revenue - costs);
const reserve = netProfit * reserveRate;
const distributable = Math.max(0, netProfit - reserve);
const hostingPool = distributable * hostingRate;
const payoutPool = Math.max(0, distributable - hostingPool) * payoutRate;
const positiveBotProfit = results.map((r) => Math.max(0, num(r.netProfit)));
const positiveTotal = positiveBotProfit.reduce((s, p) => s + p, 0);

const payouts = results.map((r, i) => {
  const rawAmount = positiveTotal > 0 ? payoutPool * (positiveBotProfit[i] / positiveTotal) : 0;
  const amount = rawAmount >= minimumPayout ? round(rawAmount) : 0;
  return { botId: Math.floor(num(r.botId)), amount };
}).filter((p) => p.amount > 0);

await mkdir("farm-output", { recursive: true });

const stateDefault: State = { dateUtc: utcDate(), asset, chainId, transferred: 0, txHashes: [] };
let state = stateDefault;
try {
  const existing = JSON.parse(await Bun.file(stateFile).text()) as Partial<State>;
  if (existing.dateUtc === stateDefault.dateUtc && existing.asset === asset && Number(existing.chainId) === chainId) {
    state = {
      ...stateDefault,
      transferred: Math.max(0, num(existing.transferred)),
      txHashes: Array.isArray(existing.txHashes) ? existing.txHashes.map(String).slice(-100) : [],
    };
  }
} catch {
  // First run or no state file.
}

const audit = async (entry: Record<string, unknown>) => {
  await Bun.write(auditFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { createPath: true, append: true });
};

if (!real || dryRun) {
  console.log(JSON.stringify({
    status: real ? "REAL_DRY_RUN" : "DISABLED",
    asset,
    chainId,
    revenue: round(revenue),
    costs: round(costs),
    netProfit: round(netProfit),
    payoutPool: round(payoutPool),
    payouts,
    transferredToday: state.transferred,
    maxDaily,
  }, null, 2));
  process.exit(0);
}

const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
const network = await provider.getNetwork();
if (Number(network.chainId) !== chainId) throw new Error(`RPC chain mismatch: expected ${chainId}, got ${network.chainId}`);

const signer = new Wallet(privateKey, provider);
const signerAddress = await signer.getAddress();
const target = getAddress(destination);
const nativeBalance = await provider.getBalance(signerAddress);
const nativeReserve = parseEther(minNativeReserve.toString());
if (nativeBalance <= nativeReserve) throw new Error("Signer wallet is at or below FINANCE_MIN_NATIVE_RESERVE");

await audit({
  event: "RUN_STARTED",
  sourceFile,
  signer: signerAddress,
  destination: target,
  asset,
  chainId,
  payoutPool: round(payoutPool),
  transferredToday: state.transferred,
  maxDaily,
});

let transferred = state.transferred;

if (asset === "ETH") {
  for (const payout of payouts) {
    const amount = Math.min(payout.amount, maxPerTx, maxDaily - transferred);
    if (amount <= 0) break;
    const value = parseEther(amount.toString());
    const feeData = await provider.getFeeData();
    const gas = await provider.estimateGas({ from: signerAddress, to: target, value });
    const fee = gas * (feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n);
    if (nativeBalance - value - fee < nativeReserve) throw new Error("Transfer would violate native-token reserve");

    const tx = await signer.sendTransaction({ to: target, value });
    const receipt = await tx.wait(confirmations);
    const txHash = receipt?.hash ?? tx.hash;
    transferred = round(transferred + amount);
    state.transferred = transferred;
    state.txHashes.push(txHash);
    await Bun.write(stateFile, JSON.stringify(state, null, 2));
    await audit({ event: "TRANSFER_CONFIRMED", botId: payout.botId, asset, amount, txHash, transferredToday: transferred });
  }
} else {
  const token = new Contract(getAddress(tokenAddress), ERC20_ABI, signer);
  const decimals = Number(await token.decimals());
  let tokenBalance = await token.balanceOf(signerAddress) as bigint;

  for (const payout of payouts) {
    const amount = Math.min(payout.amount, maxPerTx, maxDaily - transferred);
    if (amount <= 0) break;
    const units = parseUnits(amount.toFixed(Math.min(decimals, 6)), decimals);
    if (tokenBalance < units) throw new Error(`Insufficient ${asset} balance`);
    const tx = await token.transfer(target, units);
    const receipt = await tx.wait(confirmations);
    const txHash = receipt?.hash ?? tx.hash;
    tokenBalance -= units;
    transferred = round(transferred + amount);
    state.transferred = transferred;
    state.txHashes.push(txHash);
    await Bun.write(stateFile, JSON.stringify(state, null, 2));
    await audit({ event: "TRANSFER_CONFIRMED", botId: payout.botId, asset, amount, txHash, transferredToday: transferred });
  }
}

await audit({ event: "RUN_COMPLETED", transferredToday: transferred, remainingDailyCapacity: round(Math.max(0, maxDaily - transferred)) });
console.log(JSON.stringify({
  status: "REAL",
  signer: signerAddress,
  destination: target,
  asset,
  chainId,
  revenue: round(revenue),
  costs: round(costs),
  netProfit: round(netProfit),
  reserve: round(reserve),
  hostingPool: round(hostingPool),
  payoutPool: round(payoutPool),
  payouts,
  transferredToday: transferred,
  remainingDailyCapacity: round(Math.max(0, maxDaily - transferred)),
  txHashes: state.txHashes.slice(-payouts.length),
}, null, 2));
