import type { PrismaClient } from "@japalife/db";
import { MAX_WALLET_BALANCE, type Currency, type LedgerReason } from "@japalife/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_WALLET_KEYS } from "./definitions";
import {
  InvalidMovementError,
  Ledger,
  ReferenceConflictError,
  type MovementRequest,
} from "./ledger";
import {
  BalanceLimitError,
  InsufficientFundsError,
  InvalidAmountError,
} from "./money";
import { createTestClient, resetLedgerTables } from "../test/testDb";

let db: PrismaClient;
let ledger: Ledger;
let counter = 0;

const ref = () => `test-${++counter}`;

async function newPlayer(): Promise<string> {
  return (await db.player.create({ data: {}, select: { id: true } })).id;
}

function move(
  playerId: string,
  reason: LedgerReason,
  amount: bigint,
  extra: Partial<MovementRequest> = {},
): MovementRequest {
  return { playerId, currency: "NGN", reason, amount, reference: ref(), ...extra };
}

beforeAll(() => {
  db = createTestClient();
  ledger = new Ledger(db);
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetLedgerTables(db);
});

describe("basic movements", () => {
  it("credits from the faucet and debits to the sink, recording running balances", async () => {
    const player = await newPlayer();

    const pay = await ledger.applyMovement(move(player, "shift_pay", 5_000n));
    expect(pay).toMatchObject({ balanceAfter: 5_000n, replayed: false });

    const rent = await ledger.applyMovement(move(player, "rent", 1_800n));
    expect(rent.balanceAfter).toBe(3_200n);

    expect(await ledger.balanceOf(player, "NGN")).toBe(3_200n);
    expect(await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.faucet, "NGN")).toBe(-5_000n);
    expect(await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.sink, "NGN")).toBe(1_800n);
  });

  it("reports a zero balance for a player who never held the currency", async () => {
    const player = await newPlayer();
    expect(await ledger.balanceOf(player, "GBP")).toBe(0n);
  });

  it("lets a player spend exactly their whole balance", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 700n));
    const result = await ledger.applyMovement(move(player, "food", 700n));
    expect(result.balanceAfter).toBe(0n);
  });
});

describe("negative balances", () => {
  it("refuses to spend more than the balance and writes nothing", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 100n));
    const before = await db.transaction.count();

    await expect(ledger.applyMovement(move(player, "rent", 101n))).rejects.toThrow(
      InsufficientFundsError,
    );

    expect(await ledger.balanceOf(player, "NGN")).toBe(100n);
    expect(await db.transaction.count()).toBe(before);
  });

  it("refuses to spend from an empty wallet", async () => {
    const player = await newPlayer();
    await expect(ledger.applyMovement(move(player, "food", 1n))).rejects.toThrow(
      InsufficientFundsError,
    );
  });

  it("keeps currencies separate: naira cannot pay a pound sink", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 1_000n));
    await expect(
      ledger.applyMovement(move(player, "rent", 1n, { currency: "GBP" })),
    ).rejects.toThrow(InsufficientFundsError);
    expect(await ledger.balanceOf(player, "NGN")).toBe(1_000n);
    expect(await ledger.balanceOf(player, "GBP")).toBe(0n);
  });
});

describe("double-spend and concurrent requests", () => {
  it("lets only as many concurrent spends succeed as the balance covers", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 100n));

    // Ten simultaneous N0.30 spends against N1.00: exactly three can win.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => ledger.applyMovement(move(player, "food", 30n))),
    );

    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(3);
    expect(losses).toHaveLength(7);
    for (const loss of losses) {
      expect((loss as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFundsError);
    }
    expect(await ledger.balanceOf(player, "NGN")).toBe(10n);

    const wallet = await ledger.playerWalletId(player, "NGN");
    expect((await ledger.auditWallet(wallet)).ok).toBe(true);
  });

  it("serialises a mix of earning and spending on one wallet without losing an update", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 1_000n));

    const ops = [
      ...Array.from({ length: 25 }, () => move(player, "shift_pay", 40n)),
      ...Array.from({ length: 25 }, () => move(player, "food", 15n)),
    ];
    const results = await Promise.allSettled(ops.map((op) => ledger.applyMovement(op)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    // 1000 + 25*40 - 25*15
    expect(await ledger.balanceOf(player, "NGN")).toBe(1_625n);
    const wallet = await ledger.playerWalletId(player, "NGN");
    const audit = await ledger.auditWallet(wallet);
    expect(audit).toEqual({ ok: true, balance: 1_625n, problems: [] });
  });

  it("keeps total money conserved and every player balance valid under a random workload", async () => {
    const players = await Promise.all([newPlayer(), newPlayer(), newPlayer()]);
    const rng = mulberry32(42);
    const reasons: LedgerReason[] = ["shift_pay", "shift_pay", "rent", "food", "black_tax"];

    const ops = Array.from({ length: 100 }, () => {
      const player = players[Math.floor(rng() * players.length)] as string;
      const reason = reasons[Math.floor(rng() * reasons.length)] as LedgerReason;
      return move(player, reason, BigInt(1 + Math.floor(rng() * 500)));
    });
    // Some spends will be refused for lack of funds; that is allowed, silent loss is not.
    const results = await Promise.allSettled(ops.map((op) => ledger.applyMovement(op)));
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    let playerTotal = 0n;
    for (const player of players) {
      const balance = await ledger.balanceOf(player, "NGN");
      expect(balance).toBeGreaterThanOrEqual(0n);
      playerTotal += balance;
      const audit = await ledger.auditWallet(await ledger.playerWalletId(player, "NGN"));
      expect(audit.problems).toEqual([]);
      expect(audit.balance).toBe(balance);
    }

    // Money in the game is conserved: what the faucet gave minus what the sink took
    // is exactly what the players hold.
    const faucet = await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.faucet, "NGN");
    const sink = await ledger.systemBalanceOf(SYSTEM_WALLET_KEYS.sink, "NGN");
    expect(playerTotal + faucet + sink).toBe(0n);
  });
});

describe("idempotency", () => {
  it("applies a reference once and replays it harmlessly", async () => {
    const player = await newPlayer();
    const request = move(player, "shift_pay", 500n, { reference: "shift-1" });

    const first = await ledger.applyMovement(request);
    const second = await ledger.applyMovement(request);

    expect(first.replayed).toBe(false);
    expect(second).toMatchObject({ replayed: true, balanceAfter: 500n });
    expect(second.transactionId).toBe(first.transactionId);
    expect(await ledger.balanceOf(player, "NGN")).toBe(500n);
    expect(await db.transaction.count()).toBe(1);
  });

  it("applies once when the same request is retried concurrently", async () => {
    const player = await newPlayer();
    const request = move(player, "shift_pay", 500n, { reference: "shift-race" });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => ledger.applyMovement(request)),
    );

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await ledger.balanceOf(player, "NGN")).toBe(500n);
    expect(await db.transaction.count()).toBe(1);
  });

  it("rejects a reference reused for a different movement", async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await ledger.applyMovement(move(a, "shift_pay", 500n, { reference: "dup" }));

    await expect(
      ledger.applyMovement(move(a, "shift_pay", 501n, { reference: "dup" })),
    ).rejects.toThrow(ReferenceConflictError);
    await expect(
      ledger.applyMovement(move(b, "shift_pay", 500n, { reference: "dup" })),
    ).rejects.toThrow(ReferenceConflictError);
    expect(await ledger.balanceOf(a, "NGN")).toBe(500n);
    expect(await ledger.balanceOf(b, "NGN")).toBe(0n);
  });
});

describe("overflow", () => {
  it("allows a balance exactly at the cap and refuses to pass it", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", MAX_WALLET_BALANCE));
    expect(await ledger.balanceOf(player, "NGN")).toBe(MAX_WALLET_BALANCE);

    await expect(ledger.applyMovement(move(player, "shift_pay", 1n))).rejects.toThrow(
      BalanceLimitError,
    );
    expect(await ledger.balanceOf(player, "NGN")).toBe(MAX_WALLET_BALANCE);
  });

  it("refuses a single movement larger than the cap", async () => {
    const player = await newPlayer();
    await expect(
      ledger.applyMovement(move(player, "shift_pay", MAX_WALLET_BALANCE + 1n)),
    ).rejects.toThrow(InvalidAmountError);
  });
});

describe("input validation", () => {
  it("refuses zero, negative and non-bigint amounts", async () => {
    const player = await newPlayer();
    for (const amount of [0n, -1n, 5, 1.5, "100", null, undefined]) {
      await expect(
        ledger.applyMovement(move(player, "shift_pay", amount as unknown as bigint)),
      ).rejects.toThrow(InvalidAmountError);
    }
    expect(await db.transaction.count()).toBe(0);
  });

  it("refuses unknown reasons and malformed references", async () => {
    const player = await newPlayer();
    await expect(
      ledger.applyMovement(move(player, "free_money" as LedgerReason, 10n)),
    ).rejects.toThrow(InvalidMovementError);
    for (const reference of ["", "has space", "x".repeat(129), "semi;colon", "quote'"]) {
      await expect(
        ledger.applyMovement(move(player, "shift_pay", 10n, { reference })),
      ).rejects.toThrow(InvalidMovementError);
    }
    expect(await db.transaction.count()).toBe(0);
  });

  it("refuses a currency that does not exist", async () => {
    const player = await newPlayer();
    await expect(
      ledger.applyMovement(move(player, "shift_pay", 10n, { currency: "USD" as Currency })),
    ).rejects.toThrow(InvalidMovementError);
    expect(await db.transaction.count()).toBe(0);
  });
});

describe("append-only ledger", () => {
  it("rejects edits and deletes of a recorded movement at the database level", async () => {
    const player = await newPlayer();
    await ledger.applyMovement(move(player, "shift_pay", 500n));

    await expect(db.$executeRawUnsafe('UPDATE "Transaction" SET "amount" = 999999')).rejects.toThrow(
      /immutable/,
    );
    await expect(db.$executeRawUnsafe('DELETE FROM "Transaction"')).rejects.toThrow(/immutable/);
    expect(await ledger.balanceOf(player, "NGN")).toBe(500n);
  });
});

/** Small seeded PRNG so a failing workload can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
