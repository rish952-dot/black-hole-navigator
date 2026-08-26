/**
 * Money is always handled as integer minor units (1e-6, matching USDC and the
 * existing finance-flow scripts' 6-decimal rounding). Floating-point dollars
 * are only accepted at the system boundary and converted immediately.
 */

export const MINOR_UNIT_SCALE = 1_000_000;

/** Convert a decimal amount to integer minor units. Throws on non-finite input. */
export function toMinorUnits(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error("Amount must be finite");
  return Math.round(amount * MINOR_UNIT_SCALE);
}

/** Convert integer minor units back to a decimal amount for display/reporting. */
export function fromMinorUnits(minor: number): number {
  return minor / MINOR_UNIT_SCALE;
}

/** Validate a minor-unit amount: must be a safe positive integer. */
export function isValidMinorAmount(minor: number): boolean {
  return Number.isSafeInteger(minor) && minor > 0;
}
