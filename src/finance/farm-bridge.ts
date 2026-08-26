/**
 * Bridge between the existing Farm modules and the internal finance
 * subsystem. The Farm keeps its own simulation ledger (`farm/ledger.ts`)
 * untouched; this adapter mirrors relevant economic events into the
 * double-entry finance ledger when the subsystem is enabled.
 *
 * Fail-open for the Farm: if finance is disabled or rejects an event, the
 * Farm's own flow is never interrupted — finance is an observer of the
 * simulation, and a gate only for real settlement actions.
 */

import { FinanceDisabledError, FinanceError, UnauthorizedFinanceOperationError } from "./errors";
import { Principals } from "./auth";
import type { FinanceService } from "./service";
import type { Transaction, TxType } from "../farm/types";

export interface FarmFinanceBridgeOptions {
  /** Called when a mirrored event is rejected; defaults to silent swallow. */
  onError?: (error: FinanceError, tx: Transaction) => void;
}

const COST_TYPES: ReadonlySet<TxType> = new Set(["api_cost", "compute_cost", "tool_cost", "transaction_fee", "penalty"]);

export class FarmFinanceBridge {
  private readonly principal = Principals.system("farm-engine");

  constructor(
    private readonly finance: FinanceService,
    private readonly options: FarmFinanceBridgeOptions = {},
  ) {}

  /**
   * Mirror one farm transaction into the finance ledger. Idempotent per
   * farm transaction id. Never throws into the farm loop.
   */
  mirror(tx: Transaction): void {
    try {
      if (tx.type === "task_payout" && tx.amount > 0) {
        this.finance.recordEarnings(this.principal, {
          agentId: tx.agentId,
          amount: tx.amount,
          taskId: tx.taskId,
          generation: tx.generation,
          note: tx.description,
          idempotencyKey: `farm:${tx.id}`,
        });
      } else if (tx.type === "reward" && tx.amount > 0) {
        this.finance.recordReward(this.principal, {
          agentId: tx.agentId,
          amount: tx.amount,
          taskId: tx.taskId,
          generation: tx.generation,
          note: tx.description,
          idempotencyKey: `farm:${tx.id}`,
        });
      } else if (COST_TYPES.has(tx.type) && tx.amount < 0) {
        const category =
          tx.type === "api_cost"
            ? "api"
            : tx.type === "tool_cost"
              ? "tool"
              : tx.type === "transaction_fee"
                ? "fees"
                : tx.type === "penalty"
                  ? "penalties"
                  : "compute";
        this.finance.recordCost(this.principal, {
          agentId: tx.agentId,
          amount: -tx.amount,
          category,
          taskId: tx.taskId,
          generation: tx.generation,
          note: tx.description,
          idempotencyKey: `farm:${tx.id}`,
        });
      }
      // capital_allocation / initial_capital / refund stay simulation-local.
    } catch (error) {
      if (error instanceof FinanceError) {
        if (!(error instanceof FinanceDisabledError) && !(error instanceof UnauthorizedFinanceOperationError)) {
          this.options.onError?.(error, tx);
        }
        return;
      }
      throw error;
    }
  }
}
