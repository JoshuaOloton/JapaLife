/**
 * Price rises compound, like real inflation: two 10% rises make prices 21%
 * higher, not 20%. The running total is a factor in basis points (10,000 means
 * no rise), kept in bigint so years of rises can never lose precision or
 * overflow. Every step rounds up, so rounding never works in the player's favour.
 */
export const NO_RISE_BP = 10_000n;

const divideRoundingUp = (numerator: bigint, denominator: bigint): bigint => (numerator + denominator - 1n) / denominator;

/** The factor after one more rise of `percent`. */
export function compoundRise(factorBp: bigint, percent: number): bigint {
  return divideRoundingUp(factorBp * BigInt(100 + percent), 100n);
}

/** Total price in kobo for `quantity` units at `unitKobo`, after the rises in `factorBp`. */
export function priceWithFactor(unitKobo: number, quantity: number, factorBp: bigint): bigint {
  return divideRoundingUp(BigInt(unitKobo) * BigInt(quantity) * factorBp, NO_RISE_BP);
}

/** How much higher prices are than at the start, as a percent rounded down to one decimal place. For display. */
export function risePercent(factorBp: bigint): number {
  return Number((factorBp - NO_RISE_BP) / 10n) / 10;
}
