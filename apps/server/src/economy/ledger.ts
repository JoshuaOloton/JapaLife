import { Prisma, type PrismaClient } from "@japalife/db";
import { CURRENCIES, type Currency, type LedgerReason } from "@japalife/shared";
import { directionOf, isLedgerReason, SYSTEM_WALLET_KEYS } from "./definitions";
import {
  assertValidAmount,
  creditedBalance,
  debitedBalance,
  type Amount,
} from "./money";

/** References are idempotency keys: short, printable, no spaces. */
const REFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export class InvalidMovementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMovementError";
  }
}

/** The same reference was used for a different movement. */
export class ReferenceConflictError extends Error {
  constructor() {
    super("reference already used for a different movement");
    this.name = "ReferenceConflictError";
  }
}

export interface MovementRequest {
  playerId: string;
  currency: Currency;
  reason: LedgerReason;
  amount: Amount;
  /** Idempotency key. Retrying with the same reference never applies twice. */
  reference: string;
}

export interface MovementResult {
  transactionId: bigint;
  /** The player's balance immediately after this movement. */
  balanceAfter: Amount;
  /** True when this reference had already been applied and nothing changed. */
  replayed: boolean;
}

export interface TransferRequest {
  fromPlayerId: string;
  toPlayerId: string;
  currency: Currency;
  amount: Amount;
  /** Idempotency key. Retrying with the same reference never applies twice. */
  reference: string;
}

export interface TransferResult {
  transactionId: bigint;
  fromBalanceAfter: Amount;
  toBalanceAfter: Amount;
  replayed: boolean;
}

export interface WalletAudit {
  ok: boolean;
  /** Balance rebuilt from scratch by replaying every movement. */
  balance: Amount;
  problems: string[];
}

type Tx = Prisma.TransactionClient;

/** Player wallets are bounded (no overdraft, no overflow); system wallets just keep a running total. */
type Side = "player" | "system";

interface Posting {
  fromWalletId: string;
  toWalletId: string;
  fromSide: Side;
  toSide: Side;
  currency: Currency;
  amount: Amount;
  reason: string;
  reference: string;
}

interface Posted {
  transactionId: bigint;
  fromBalanceAfter: Amount;
  toBalanceAfter: Amount;
  replayed: boolean;
}

/**
 * The only code allowed to move money. Every movement is one immutable
 * Transaction row, written in a single Postgres transaction while holding row
 * locks on both wallets, so two requests can never spend the same money.
 */
export class Ledger {
  constructor(private readonly db: PrismaClient) {}

  /** Current balance, 0 if the player has never held this currency. */
  async balanceOf(playerId: string, currency: Currency): Promise<Amount> {
    const wallet = await this.db.wallet.findUnique({
      where: { playerId_currency: { playerId, currency } },
      select: { id: true },
    });
    return wallet ? this.latestBalance(this.db, wallet.id) : 0n;
  }

  async systemBalanceOf(key: string, currency: Currency): Promise<Amount> {
    const wallet = await this.db.wallet.findUnique({
      where: { systemKey_currency: { systemKey: key, currency } },
      select: { id: true },
    });
    return wallet ? this.latestBalance(this.db, wallet.id) : 0n;
  }

  /** A faucet (money in from the system) or a sink (money out to the system). */
  async applyMovement(request: MovementRequest): Promise<MovementResult> {
    const { playerId, currency, reason, amount, reference } = request;
    this.validate(currency, amount, reference);
    if (!isLedgerReason(reason)) {
      throw new InvalidMovementError("unknown reason");
    }

    const direction = directionOf(reason);
    const playerWalletId = await this.playerWalletId(playerId, currency);
    const systemWalletId = await this.systemWalletId(SYSTEM_WALLET_KEYS[direction], currency);
    const faucet = direction === "faucet";

    const posted = await this.post({
      fromWalletId: faucet ? systemWalletId : playerWalletId,
      toWalletId: faucet ? playerWalletId : systemWalletId,
      fromSide: faucet ? "system" : "player",
      toSide: faucet ? "player" : "system",
      currency,
      amount,
      reason,
      reference,
    });
    return {
      transactionId: posted.transactionId,
      balanceAfter: faucet ? posted.toBalanceAfter : posted.fromBalanceAfter,
      replayed: posted.replayed,
    };
  }

  /**
   * Moves money from one player to another. Creates and destroys nothing, so it
   * is neither a faucet nor a sink. Server-internal: no client intent calls this.
   */
  async transfer(request: TransferRequest): Promise<TransferResult> {
    const { fromPlayerId, toPlayerId, currency, amount, reference } = request;
    this.validate(currency, amount, reference);
    if (fromPlayerId === toPlayerId) {
      throw new InvalidMovementError("cannot transfer to yourself");
    }

    const fromWalletId = await this.playerWalletId(fromPlayerId, currency);
    const toWalletId = await this.playerWalletId(toPlayerId, currency);

    return this.post({
      fromWalletId,
      toWalletId,
      fromSide: "player",
      toSide: "player",
      currency,
      amount,
      reason: "player_transfer",
      reference,
    });
  }

  /**
   * Rebuilds a wallet's balance by replaying every movement and checks each
   * stored running balance against it. For tests and diagnostics.
   */
  async auditWallet(walletId: string): Promise<WalletAudit> {
    const rows = await this.db.transaction.findMany({
      where: { OR: [{ fromWalletId: walletId }, { toWalletId: walletId }] },
      orderBy: { id: "asc" },
    });
    const problems: string[] = [];
    let running = 0n;
    for (const row of rows) {
      const incoming = row.toWalletId === walletId;
      running += incoming ? row.amount : -row.amount;
      const stored = incoming ? row.toBalanceAfter : row.fromBalanceAfter;
      if (stored !== running) {
        problems.push(`transaction ${row.id}: stored ${stored}, replayed ${running}`);
      }
    }
    return { ok: problems.length === 0, balance: running, problems };
  }

  async playerWalletId(playerId: string, currency: Currency): Promise<string> {
    const where = { playerId_currency: { playerId, currency } };
    const found = await this.db.wallet.findUnique({ where, select: { id: true } });
    if (found) return found.id;
    try {
      const created = await this.db.wallet.create({
        data: { kind: "PLAYER", playerId, currency },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.db.wallet.findUniqueOrThrow({ where, select: { id: true } });
        return raced.id;
      }
      throw error;
    }
  }

  async systemWalletId(systemKey: string, currency: Currency): Promise<string> {
    const where = { systemKey_currency: { systemKey, currency } };
    const found = await this.db.wallet.findUnique({ where, select: { id: true } });
    if (found) return found.id;
    try {
      const created = await this.db.wallet.create({
        data: { kind: "SYSTEM", systemKey, currency },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.db.wallet.findUniqueOrThrow({ where, select: { id: true } });
        return raced.id;
      }
      throw error;
    }
  }

  private validate(currency: Currency, amount: Amount, reference: string): void {
    assertValidAmount(amount);
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      throw new InvalidMovementError("unknown currency");
    }
    if (!REFERENCE_PATTERN.test(reference)) {
      throw new InvalidMovementError("invalid reference");
    }
  }

  /** The single write path: lock, replay check, balance rules, append one row. */
  private async post(posting: Posting): Promise<Posted> {
    const { fromWalletId, toWalletId, fromSide, toSide, currency, amount, reason, reference } =
      posting;

    try {
      return await this.db.$transaction(
        async (tx) => {
          await this.lockWallets(tx, [fromWalletId, toWalletId]);

          // Checked after the lock: concurrent retries of one reference queue up
          // here and the later ones see the row the first one wrote.
          const existing = await tx.transaction.findUnique({ where: { reference } });
          if (existing) {
            const same =
              existing.fromWalletId === fromWalletId &&
              existing.toWalletId === toWalletId &&
              existing.currency === currency &&
              existing.amount === amount &&
              existing.reason === reason;
            if (!same) throw new ReferenceConflictError();
            return {
              transactionId: existing.id,
              fromBalanceAfter: existing.fromBalanceAfter,
              toBalanceAfter: existing.toBalanceAfter,
              replayed: true,
            };
          }

          const fromBalance = await this.latestBalance(tx, fromWalletId);
          const toBalance = await this.latestBalance(tx, toWalletId);

          const fromAfter =
            fromSide === "player" ? debitedBalance(fromBalance, amount) : fromBalance - amount;
          const toAfter =
            toSide === "player" ? creditedBalance(toBalance, amount) : toBalance + amount;

          const row = await tx.transaction.create({
            data: {
              fromWalletId,
              toWalletId,
              currency,
              amount,
              reason,
              reference,
              fromBalanceAfter: fromAfter,
              toBalanceAfter: toAfter,
            },
            select: { id: true },
          });

          return {
            transactionId: row.id,
            fromBalanceAfter: fromAfter,
            toBalanceAfter: toAfter,
            replayed: false,
          };
        },
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      // Same reference, different wallets: the unique index catches what the
      // in-transaction check cannot see.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        JSON.stringify(error.meta ?? {}).includes("reference")
      ) {
        throw new ReferenceConflictError();
      }
      throw error;
    }
  }

  /** Locks in a fixed (sorted) order so two movements can never deadlock. */
  private async lockWallets(tx: Tx, walletIds: string[]): Promise<void> {
    for (const id of [...new Set(walletIds)].sort()) {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Wallet" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length !== 1) throw new InvalidMovementError("wallet not found");
    }
  }

  /** A wallet's balance is the running balance on the latest row that touches it. */
  private async latestBalance(client: Tx | PrismaClient, walletId: string): Promise<Amount> {
    const rows = await client.$queryRaw<{ balance: bigint }[]>`
      SELECT CASE WHEN "fromWalletId" = ${walletId}
                  THEN "fromBalanceAfter" ELSE "toBalanceAfter" END AS "balance"
      FROM "Transaction"
      WHERE "fromWalletId" = ${walletId} OR "toWalletId" = ${walletId}
      ORDER BY "id" DESC
      LIMIT 1`;
    return rows[0]?.balance ?? 0n;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
