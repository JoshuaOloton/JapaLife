/**
 * Every faucet (money in) and sink (money out) is named here and logged on the
 * ledger as the `reason` of a Transaction. Add new ones here, nowhere else.
 */
export const FAUCET_REASONS = ["starting_balance", "shift_pay"] as const;
export const SINK_REASONS = ["rent", "food", "black_tax"] as const;

export const LEDGER_REASONS = [...FAUCET_REASONS, ...SINK_REASONS] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];
