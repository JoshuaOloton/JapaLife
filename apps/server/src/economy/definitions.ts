import { FAUCET_REASONS, SINK_REASONS, type LedgerReason } from "@japalife/shared";

/**
 * The single place that says which side of the ledger a reason sits on.
 * A faucet is money coming from a SYSTEM wallet into a player's wallet;
 * a sink is money going from a player's wallet into a SYSTEM wallet.
 */
export type MovementDirection = "faucet" | "sink";

/** SYSTEM wallet keys (Wallet.systemKey). One wallet per key per currency. */
export const SYSTEM_WALLET_KEYS = {
  faucet: "faucet",
  sink: "sink",
  /** Counterparty for currency conversions. */
  fx: "fx",
} as const;

const faucetReasons: ReadonlySet<string> = new Set(FAUCET_REASONS);
const sinkReasons: ReadonlySet<string> = new Set(SINK_REASONS);

export function isLedgerReason(value: string): value is LedgerReason {
  return faucetReasons.has(value) || sinkReasons.has(value);
}

export function directionOf(reason: LedgerReason): MovementDirection {
  return faucetReasons.has(reason) ? "faucet" : "sink";
}
