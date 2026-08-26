/**
 * Authentication/authorization for the finance subsystem.
 *
 * The finance module never trusts UI state: every entry point requires an
 * explicit Principal produced by the host application's auth layer. There is
 * intentionally no implicit/anonymous principal.
 */

export type FinanceRole =
  | "system"    // trusted farm/central-mind services
  | "operator"  // human admin: may approve settlements and manage config
  | "auditor"   // read-only access to full (non-secret) ledger data
  | "agent"     // AI agent: may only propose, never approve or settle
  | "viewer";   // aggregate telemetry only

export interface Principal {
  /** Stable identity of the caller (user id, service name, or agent id). */
  id: string;
  /** True only when the host auth layer has authenticated this identity. */
  authenticated: boolean;
  roles: FinanceRole[];
}

export function hasRole(principal: Principal, role: FinanceRole): boolean {
  return principal.authenticated && principal.roles.includes(role);
}

export function hasAnyRole(principal: Principal, roles: FinanceRole[]): boolean {
  return roles.some((role) => hasRole(principal, role));
}

/** Convenience constructors used by host integration code. */
export const Principals = {
  system: (id = "farm-system"): Principal => ({ id, authenticated: true, roles: ["system"] }),
  operator: (id: string): Principal => ({ id, authenticated: true, roles: ["operator"] }),
  auditor: (id: string): Principal => ({ id, authenticated: true, roles: ["auditor"] }),
  agent: (id: string): Principal => ({ id, authenticated: true, roles: ["agent"] }),
  viewer: (id: string): Principal => ({ id, authenticated: true, roles: ["viewer"] }),
  anonymous: (): Principal => ({ id: "anonymous", authenticated: false, roles: [] }),
};
