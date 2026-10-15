import { MAX_WALLET_BALANCE } from "@japalife/shared";
import { assertValidAmount, InvalidAmountError, type Amount } from "./money";

/** Mid-market rates are stored as integers scaled by this factor. */
export const RATE_SCALE = 1_000_000n;
const BPS_SCALE = 10_000n;

export interface ConversionQuote {
  /** Smallest units of the source currency to take from the player. */
  fromAmount: Amount;
  /** Units of target currency per 1 unit of source, times RATE_SCALE. */
  midRateMicro: bigint;
  /** The channel's spread in basis points (100 bps = 1%). */
  spreadBps: number;
}

/**
 * Amount the player receives, in the target currency's smallest unit.
 *
 * NGN, GBP and CAD all have 100 subunits, so smallest units convert directly.
 * Integer maths only. The result is rounded DOWN, so rounding always favours
 * the house and never creates money. A conversion that rounds to zero is
 * refused rather than taking money for nothing.
 */
export function convertAmount(quote: ConversionQuote): Amount {
  const { fromAmount, midRateMicro, spreadBps } = quote;
  assertValidAmount(fromAmount);
  if (midRateMicro <= 0n) {
    throw new InvalidAmountError("rate must be greater than zero");
  }
  if (!Number.isInteger(spreadBps) || spreadBps < 0 || spreadBps >= Number(BPS_SCALE)) {
    throw new InvalidAmountError("spread must be a whole number of basis points below 10000");
  }

  const kept = BPS_SCALE - BigInt(spreadBps);
  const received = (fromAmount * midRateMicro * kept) / (RATE_SCALE * BPS_SCALE);

  if (received <= 0n) {
    throw new InvalidAmountError("amount is too small to convert");
  }
  if (received > MAX_WALLET_BALANCE) {
    throw new InvalidAmountError("converted amount exceeds the maximum");
  }
  return received;
}
