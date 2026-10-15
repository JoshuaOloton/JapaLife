import { MAX_WALLET_BALANCE } from "@japalife/shared";

/** All money is a bigint in the smallest unit (kobo, pence, cents). Never a float. */
export type Amount = bigint;

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export class InsufficientFundsError extends Error {
  constructor() {
    super("insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

export class BalanceLimitError extends Error {
  constructor() {
    super("balance limit exceeded");
    this.name = "BalanceLimitError";
  }
}

/** A movement must be a positive whole number of smallest units, within the cap. */
export function assertValidAmount(amount: unknown): asserts amount is Amount {
  if (typeof amount !== "bigint") {
    throw new InvalidAmountError("amount must be a bigint");
  }
  if (amount <= 0n) {
    throw new InvalidAmountError("amount must be greater than zero");
  }
  if (amount > MAX_WALLET_BALANCE) {
    throw new InvalidAmountError("amount exceeds the maximum");
  }
}

/** Balance after adding `amount`. Refuses to pass the cap, so nothing can overflow. */
export function creditedBalance(balance: Amount, amount: Amount): Amount {
  assertValidAmount(amount);
  const next = balance + amount;
  if (next > MAX_WALLET_BALANCE) throw new BalanceLimitError();
  return next;
}

/** Balance after removing `amount`. Never returns a negative balance. */
export function debitedBalance(balance: Amount, amount: Amount): Amount {
  assertValidAmount(amount);
  if (amount > balance) throw new InsufficientFundsError();
  return balance - amount;
}
