import type { DeploymentMode } from "./types";

/**
 * Finance isolation — fail-closed.
 *
 * The farm never touches real money. Only simulation-class deployment modes
 * are executable; anything else is clamped down to SIMULATION and reported.
 * No credentials, wallets or payout providers exist on the client.
 */
export const SIMULATION_MODES: DeploymentMode[] = ["DRY_RUN", "SIMULATION", "PAPER_MODE"];

export const REAL_MONEY_ENABLED = false;

export function isSimulationMode(mode: string): mode is DeploymentMode {
  return SIMULATION_MODES.includes(mode as DeploymentMode);
}

export interface ModeDecision {
  mode: DeploymentMode;
  clamped: boolean;
  reason: string | null;
}

/** Returns a safe mode; never returns a real-money mode. */
export function enforceMode(mode: string): ModeDecision {
  if (isSimulationMode(mode)) return { mode, clamped: false, reason: null };
  return {
    mode: "SIMULATION",
    clamped: true,
    reason: `real-money mode "${mode}" is disabled — running in SIMULATION`,
  };
}
