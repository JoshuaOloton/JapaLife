import {
  FAUCET_REASONS,
  SINK_REASONS,
  type Currency,
} from "@japalife/shared";
import { directionOf, isLedgerReason } from "./definitions";
import {
  InvalidMovementError,
  type Ledger,
  type MovementResult,
  type TransferResult,
} from "./ledger";
import type { Amount } from "./money";

export type FaucetReason = (typeof FAUCET_REASONS)[number];
export type SinkReason = (typeof SINK_REASONS)[number];

interface BaseInput {
  currency: Currency;
  /** Smallest unit (kobo, pence, cents). A positive bigint, never a number. */
  amount: Amount;
  /**
   * Idempotency key. Must be derived from the thing that happened (for example
   * `shift:<playerId>:<shiftId>`), never random per call, or a retry will pay twice.
   */
  reference: string;
}

export interface CreditInput extends BaseInput {
  playerId: string;
  reason: FaucetReason;
}

export interface DebitInput extends BaseInput {
  playerId: string;
  reason: SinkReason;
}

export interface TransferInput extends BaseInput {
  fromPlayerId: string;
  toPlayerId: string;
}

/**
 * What the rest of the server calls to move money. A thin, typed front for the
 * Ledger, which does the locking, idempotency and balance rules. Game systems
 * (jobs, rent, food, events) should depend on this and never on the Ledger.
 */
export class WalletService {
  constructor(private readonly ledger: Ledger) {}

  /**
   * A snapshot, not a promise. The balance can change before the caller acts,
   * so never check it and then spend; call `debit`, which checks under a lock.
   */
  getBalance(playerId: string, currency: Currency): Promise<Amount> {
    return this.ledger.balanceOf(playerId, currency);
  }

  /** Money in from the system (salary, gifts from family, refunds). */
  async credit(input: CreditInput): Promise<MovementResult> {
    this.requireDirection(input.reason, "faucet");
    return this.ledger.applyMovement(input);
  }

  /** Money out to the system (rent, food, fees). Rejected if the player cannot afford it. */
  async debit(input: DebitInput): Promise<MovementResult> {
    this.requireDirection(input.reason, "sink");
    return this.ledger.applyMovement(input);
  }

  /**
   * Player to player. Server-internal: nothing a client can send reaches this.
   * Creates and destroys no money, and charges no fee yet.
   */
  transfer(input: TransferInput): Promise<TransferResult> {
    return this.ledger.transfer(input);
  }

  /** Callers can cast past the types, so the direction is checked again at runtime. */
  private requireDirection(reason: string, expected: "faucet" | "sink"): void {
    if (!isLedgerReason(reason) || directionOf(reason) !== expected) {
      throw new InvalidMovementError(`reason is not a ${expected}: ${String(reason).slice(0, 32)}`);
    }
  }
}
