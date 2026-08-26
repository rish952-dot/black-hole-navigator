/**
 * Minimal read-only API for the crypto rail: the Farm/Mesh can query
 * aggregate crypto telemetry without any mutation surface.
 */

import type { Principal } from "./auth";
import type { CryptoFinanceService, CryptoTelemetry } from "./crypto-service";

export interface CryptoFinanceApi {
  telemetry(principal: Principal): CryptoTelemetry;
}

export function createCryptoFinanceApi(service: CryptoFinanceService): CryptoFinanceApi {
  return {
    telemetry: (principal) => service.telemetry(principal),
  };
}
