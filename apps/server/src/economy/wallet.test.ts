import type { PrismaClient } from "@japalife/db";
import { MAX_WALLET_BALANCE } from "@japalife/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_WALLET_KEYS } from "./definitions";
import { InvalidMovementError, Ledger, ReferenceConflictError } from "./ledger";
import {
  BalanceLimitError,
  InsufficientFundsError,
  InvalidAmountError,
} from "./money";
import {
  SEED_TEST_PLAYER_BALANCE,
  SEED_TEST_PLAYER_ID,
  seedTestPlayer,
} from "./seedTestPlayer";
import { WalletService, type CreditInput, type DebitInput } from "./wallet";
import { createTestClient, resetLedgerTables } from "../test/testDb";

let db: PrismaClient;
let ledger: Ledger;
let wallet: WalletService;
let counter = 0;

const ref = () => `wallet-test-${++counter}`;

async function newPlayer(): Promise<string> {
  return (await db.player.create({ data: {}, select: { id: true } })).id;
}

async function fund(playerId: string, amount: bigint): Promise<void> {
  await wallet.credit({
    playerId,
    currency: "NGN",
    amount,
    reason: "shift_pay",
    reference: ref(),
  });
}

const debit = (playerId: string, amount: bigint, extra: Partial<DebitInput> = {}): DebitInput => ({
  playerId,
  currency: "NGN",
  amount,
  reason: "rent",
  reference: ref(),
  ...extra,
});

const credit = (
  playerId: string,
  amount: bigint,
  extra: Partial<CreditInput> = {},
): CreditInput => ({
  playerId,
  currency: "NGN",
  amount,
  reason: "shift_pay",
  reference: ref(),
  ...extra,
});

beforeAll(() => {
  db = createTestClient();
  ledger = new Ledger(db);
  wallet = new WalletService(ledger);
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetLedgerTables(db);
});

describe("required behaviour", () => {
  it("two concurrent debits cannot overspend", async () => {
    const player = await newPlayer();
    await fund(player, 100n);

    // Each debit alone is affordable (60 <= 100); both together are not (120 > 100).
    const results = await Promise.allSettled([
      wallet.debit(debit(player, 60n)),
      wallet.debit(debit(player, 60n)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(InsufficientFundsError);
    expect(await wallet.getBalance(player, "NGN")).toBe(40n);
  });

  it("rejects a negative balance and records nothing", async () => {
    const player = await newPlayer();
    await fund(player, 100n);
    const rowsBefore = await db.transaction.count();

    await expect(wallet.debit(debit(player, 101n))).rejects.toThrow(InsufficientFundsError);

    expect(await wallet.getBalance(player, "NGN")).toBe(100n);
    expect(await db.transaction.count()).toBe(rowsBefore);
  });

  it("applies the same idempotency key twice but moves money once", async () => {
    const player = await newPlayer();
    await fund(player, 1_000n);
    const input = debit(player, 250n, { reference: "rent:2026-10" });

    const first = await wallet.debit(input);
    const second = await wallet.debit(input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await wallet.getBalance(player, "NGN")).toBe(750n);
  });

  it("does not overflow on very large amounts", async () => {
    const player = await newPlayer();

    // Exactly the cap is allowed and is held exactly (no precision loss past 2^53).
    await wallet.credit(credit(player, MAX_WALLET_BALANCE - 1n));
    await wallet.credit(credit(player, 1n));
    expect(await wallet.getBalance(player, "NGN")).toBe(MAX_WALLET_BALANCE);

    // One more unit would pass the cap.
    await expect(wallet.credit(credit(player, 1n))).rejects.toThrow(BalanceLimitError);

    // Amounts beyond any real balance, beyond 64-bit integers, or not bigints at all.
    const absurd = [MAX_WALLET_BALANCE + 1n, 2n ** 63n, 2n ** 64n, 10n ** 40n];
    for (const amount of absurd) {
      await expect(wallet.credit(credit(player, amount))).rejects.toThrow(InvalidAmountError);
      await expect(wallet.debit(debit(player, amount))).rejects.toThrow(InvalidAmountError);
    }
    for (const amount of [1e21, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY]) {
      await expect(
        wallet.credit(credit(player, amount as unknown as bigint)),
      ).rejects.toThrow(InvalidAmountError);
    }

    expect(await wallet.getBalance(player, "NGN")).toBe(MAX_WALLET_BALANCE);
    const audit = await ledger.auditWallet(await ledger.playerWalletId(player, "NGN"));
    expect(audit.ok).toBe(true);
  });
});

describe("credit and debit guard rails", () => {
  it("only credits faucet reasons and only debits sink reasons", async () => {
    const player = await newPlayer();
    await fund(player, 100n);

    await expect(
      wallet.credit(credit(player, 10n, { reason: "rent" as never })),
    ).rejects.toThrow(InvalidMovementError);
    await expect(
      wallet.debit(debit(player, 10n, { reason: "shift_pay" as never })),
    ).rejects.toThrow(InvalidMovementError);
    // Transfers are a separate class and cannot be smuggled in as a faucet or sink.
    await expect(
      wallet.credit(credit(player, 10n, { reason: "player_transfer" as never })),
    ).rejects.toThrow(InvalidMovementError);
    await expect(
      wallet.debit(debit(player, 10n, { reason: "player_transfer" as never })),
    ).rejects.toThrow(InvalidMovementError);

    expect(await wallet.getBalance(player, "NGN")).toBe(100n);
  });

  it("refuses zero and negative amounts, so a negative debit cannot act as a credit", async () => {
    const player = await newPlayer();
    for (const amount of [0n, -1n, -100n]) {
      await expect(wallet.debit(debit(player, amount))).rejects.toThrow(InvalidAmountError);
      await expect(wallet.credit(credit(player, amount))).rejects.toThrow(InvalidAmountError);
    }
    expect(await db.transaction.count()).toBe(0);
  });
});

describe("transfer", () => {
  it("moves money between players and creates or destroys none", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 1_000n);

    const result = await wallet.transfer({
      fromPlayerId: a,
      toPlayerId: b,
      currency: "NGN",
      amount: 300n,
      reference: ref(),
    });

    expect(result).toMatchObject({ fromBalanceAfter: 700n, toBalanceAfter: 300n, replayed: false });
    expect(await wallet.getBalance(a, "NGN")).toBe(700n);
    expect(await wallet.getBalance(b, "NGN")).toBe(300n);

    // Not a faucet and not a sink: the system wallets only ever saw the first N1,000.
    expect(await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.faucet, "NGN")).toBe(-1_000n);
    expect(await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.sink, "NGN")).toBe(0n);

    const row = await db.transaction.findUniqueOrThrow({
      where: { id: result.transactionId },
    });
    expect(row.reason).toBe("player_transfer");
  });

  it("refuses to overdraw the sender and writes nothing", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 100n);
    const rowsBefore = await db.transaction.count();

    await expect(
      wallet.transfer({ fromPlayerId: a, toPlayerId: b, currency: "NGN", amount: 101n, reference: ref() }),
    ).rejects.toThrow(InsufficientFundsError);

    expect(await wallet.getBalance(a, "NGN")).toBe(100n);
    expect(await wallet.getBalance(b, "NGN")).toBe(0n);
    expect(await db.transaction.count()).toBe(rowsBefore);
  });

  it("refuses to pass the cap on the receiving side and leaves the sender untouched", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 10n);
    await wallet.credit(credit(b, MAX_WALLET_BALANCE));

    await expect(
      wallet.transfer({ fromPlayerId: a, toPlayerId: b, currency: "NGN", amount: 1n, reference: ref() }),
    ).rejects.toThrow(BalanceLimitError);

    expect(await wallet.getBalance(a, "NGN")).toBe(10n);
    expect(await wallet.getBalance(b, "NGN")).toBe(MAX_WALLET_BALANCE);
  });

  it("refuses a transfer to yourself", async () => {
    const a = await newPlayer();
    await fund(a, 100n);
    await expect(
      wallet.transfer({ fromPlayerId: a, toPlayerId: a, currency: "NGN", amount: 10n, reference: ref() }),
    ).rejects.toThrow(InvalidMovementError);
    expect(await wallet.getBalance(a, "NGN")).toBe(100n);
  });

  it("applies a repeated or concurrently retried transfer once", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 1_000n);
    const input = { fromPlayerId: a, toPlayerId: b, currency: "NGN" as const, amount: 400n, reference: "gift:abc" };

    const results = await Promise.all(Array.from({ length: 8 }, () => wallet.transfer(input)));

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await wallet.getBalance(a, "NGN")).toBe(600n);
    expect(await wallet.getBalance(b, "NGN")).toBe(400n);

    await expect(wallet.transfer({ ...input, amount: 401n })).rejects.toThrow(
      ReferenceConflictError,
    );
  });

  it("does not deadlock when two players pay each other at the same time", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 1_000n);
    await fund(b, 1_000n);

    // 20 transfers each way at once. Without a fixed lock order, A-then-B meets
    // B-then-A and Postgres kills one of them with a deadlock.
    const transfers = Array.from({ length: 40 }, (_, i) => {
      const [from, to] = i % 2 === 0 ? [a, b] : [b, a];
      return wallet.transfer({
        fromPlayerId: from,
        toPlayerId: to,
        currency: "NGN",
        amount: 10n,
        reference: ref(),
      });
    });
    const results = await Promise.allSettled(transfers);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await wallet.getBalance(a, "NGN")).toBe(1_000n);
    expect(await wallet.getBalance(b, "NGN")).toBe(1_000n);
    for (const player of [a, b]) {
      const audit = await ledger.auditWallet(await ledger.playerWalletId(player, "NGN"));
      expect(audit.problems).toEqual([]);
    }
  });

  it("cannot be used to spend the same money twice alongside a debit", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await fund(a, 100n);

    // The N1.00 can go to a friend or to the landlord, not both.
    const results = await Promise.allSettled([
      wallet.transfer({ fromPlayerId: a, toPlayerId: b, currency: "NGN", amount: 100n, reference: ref() }),
      wallet.debit(debit(a, 100n)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await wallet.getBalance(a, "NGN")).toBe(0n);
    const bBalance = await wallet.getBalance(b, "NGN");
    expect([0n, 100n]).toContain(bBalance);
  });
});

describe("seeded test player", () => {
  it("starts with N50,000, paid through the ledger", async () => {
    const id = await seedTestPlayer(db, wallet);

    expect(id).toBe(SEED_TEST_PLAYER_ID);
    expect(SEED_TEST_PLAYER_BALANCE).toBe(5_000_000n);
    expect(await wallet.getBalance(id, "NGN")).toBe(5_000_000n);

    const rows = await db.transaction.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "starting_balance", amount: 5_000_000n });
  });

  it("can be seeded again without paying twice", async () => {
    await seedTestPlayer(db, wallet);
    await seedTestPlayer(db, wallet);
    await seedTestPlayer(db, wallet);

    expect(await wallet.getBalance(SEED_TEST_PLAYER_ID, "NGN")).toBe(5_000_000n);
    expect(await db.transaction.count()).toBe(1);
  });

  it("can spend exactly N50,000 and not one kobo more", async () => {
    const id = await seedTestPlayer(db, wallet);
    await expect(wallet.debit(debit(id, SEED_TEST_PLAYER_BALANCE + 1n))).rejects.toThrow(
      InsufficientFundsError,
    );
    const spent = await wallet.debit(debit(id, SEED_TEST_PLAYER_BALANCE));
    expect(spent.balanceAfter).toBe(0n);
  });
});
