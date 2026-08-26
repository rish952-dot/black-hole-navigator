/**
 * Minimal read-only API the Farm/Mesh uses to query financial state without
 * any ability to mutate it. Constructed over a FinanceService; all mutation
 * methods exist only on the service itself.
 */

import type { Principal } from "./auth";
import type { FinanceTelemetry, FinanceService } from "./service";

export interface FinanceApi {
  /** Aggregate telemetry safe for authorized Mesh/Admin views. */
  telemetry(principal: Principal): FinanceTelemetry;
}

export function createFinanceApi(service: FinanceService): FinanceApi {
  return {
    telemetry: (principal) => service.telemetry(principal),
  };
}
