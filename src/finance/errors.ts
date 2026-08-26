/**
 * Typed error taxonomy for the finance subsystem.
 *
 * Error messages are deliberately free of credentials, destinations, and
 * other sensitive payloads so they are safe to log or surface to operators.
 */

export class FinanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Thrown when the subsystem is disabled and any operation is attempted. Fail-closed. */
export class FinanceDisabledError extends FinanceError {
  constructor(message = "Finance subsystem is disabled") {
    super("FINANCE_DISABLED", message);
  }
}

/** Thrown on invalid or incomplete configuration (e.g. live mode without provider credentials). */
export class FinanceConfigError extends FinanceError {
  constructor(message: string) {
    super("FINANCE_CONFIG", message);
  }
}

/** Thrown when a principal lacks authentication or the required role. */
export class UnauthorizedFinanceOperationError extends FinanceError {
  constructor(message = "Principal is not authorized for this finance operation") {
    super("FINANCE_UNAUTHORIZED", message);
  }
}

/** Thrown when a journal entry violates double-entry invariants. */
export class LedgerInvariantError extends FinanceError {
  constructor(message: string) {
    super("LEDGER_INVARIANT", message);
  }
}

/** Thrown when a hard spending/execution limit would be exceeded. Nothing is recorded. */
export class LimitExceededError extends FinanceError {
  constructor(message: string) {
    super("LIMIT_EXCEEDED", message);
  }
}

/** Thrown on illegal settlement state transitions. */
export class SettlementStateError extends FinanceError {
  constructor(message: string) {
    super("SETTLEMENT_STATE", message);
  }
}
