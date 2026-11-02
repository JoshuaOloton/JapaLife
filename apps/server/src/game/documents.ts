import { Prisma } from "@japalife/db";
import type { DocumentDef, DocumentOffer, DocumentSummary, LedgerReason } from "@japalife/shared";
import { fill } from "@japalife/shared";
import type { GameContent } from "../content/loadContent";
import { InsufficientFundsError } from "../economy/money";
import { addDays, MS_PER_DAY } from "./clock";
import type { GameDeps } from "./deps";
import type { InboxService } from "./inbox";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

/** An unpaid claim older than this was left by a crash between claiming and charging: it never started. */
const ABANDONED_CLAIM_MS = 60_000;

/** Basis points: 10000 is the whole amount. */
const BASIS_POINTS = 10_000n;

/** A share of an amount, in basis points, rounded half up. Money maths stays in bigint. */
export function scaleMoney(kobo: bigint, basisPoints: number): bigint {
  return (kobo * BigInt(basisPoints) + BASIS_POINTS / 2n) / BASIS_POINTS;
}

/** What one document costs and how long it takes, from the rules and the game's pacing. */
export interface DocumentTerms {
  def: DocumentDef;
  /** What the game charges. */
  feeKobo: bigint;
  /** The real fee, before pacing. */
  realFeeKobo: bigint;
  /** How long the game makes the player wait: the real wait times `waitScaleBp`, never over `maxWaitDays`. */
  waitMs: number;
  /** The real wait, before pacing. */
  realWaitDays: number;
  /** Days it stays valid once ready, or null if it never expires. */
  validityDays: number | null;
}

export function findDocument(content: GameContent, documentId: string): DocumentDef | undefined {
  return content.documents.documents.find((candidate) => candidate.id === documentId);
}

/** loadContent checks every document has a rule, so a missing one is a bug, not bad input. */
export function documentTerms(content: GameContent, def: DocumentDef): DocumentTerms {
  const rule = content.nigeria.documents[def.rule];
  if (!rule) throw new Error(`document ${def.id} has no rule ${def.rule}`);
  const realFeeKobo = BigInt(rule.feeKobo.value);
  return {
    def,
    feeKobo: scaleMoney(realFeeKobo, content.pacing.moneyScaleBp),
    realFeeKobo,
    waitMs: Math.min(
      Math.round((rule.waitDays.value * MS_PER_DAY * content.pacing.waitScaleBp) / 10_000),
      content.pacing.maxWaitDays * MS_PER_DAY,
    ),
    realWaitDays: rule.waitDays.value,
    validityDays: rule.validityDays?.value ?? null,
  };
}

type DocumentRow = Prisma.DocumentGetPayload<object>;

/**
 * Documents the player applies for at Yaba's offices (Phase 2). The fee is a
 * sink taken through the wallet; the wait is a timestamp, so it passes while
 * the player is offline and they are told through the inbox.
 *
 * Applying claims a row first (its unique `activeKey` allows one live copy of
 * each document per player), then charges the fee with a key from the row's
 * id, then marks it paid. If the charge fails the claim is removed: no money,
 * no application. Moving a row on (ready, failed, warned, expired) is always a
 * conditional update, so the game loop and a player's own request can both try
 * and only one acts.
 */
export class DocumentService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly inbox: InboxService,
  ) {}

  /** Applies for a document at the real office, paying the real (scaled) fee. */
  apply(playerId: string, documentId: string, now: Date): Promise<Outcome> {
    return this.start(playerId, documentId, now, false);
  }

  /**
   * Pays the "agent" outside the office, who promises it faster and cheaper.
   * A scam (CLAUDE.md realism rules): the money is gone, nothing is issued, and
   * after a few days the agent goes quiet. Never a winning strategy.
   */
  hireAgent(playerId: string, documentId: string, now: Date): Promise<Outcome> {
    return this.start(playerId, documentId, now, true);
  }

  private async start(playerId: string, documentId: string, now: Date, viaAgent: boolean): Promise<Outcome> {
    const { db, wallet, content } = this.deps;
    const def = findDocument(content, documentId);
    if (!def || (viaAgent && !def.agentOffer)) return reject("unknown_target");
    if (!(await this.players.getState(playerId))) return reject("not_signed_in");

    await this.settleDue(now, playerId);
    await db.document.deleteMany({
      where: { playerId, paidAt: null, startedAt: { lt: new Date(now.getTime() - ABANDONED_CLAIM_MS) } },
    });
    const held = await this.heldIds(playerId, now);
    if (def.requires.some((required) => !held.has(required))) return reject("missing_document");

    const terms = documentTerms(content, def);
    // The agent charges a share of the game fee: cheaper than the office, which is the lure.
    const fee = viaAgent ? scaleMoney(terms.feeKobo, content.documents.agent.feeBp) : terms.feeKobo;
    const readyAt = viaAgent
      ? addDays(now, content.documents.agent.silentAfterDays)
      : new Date(now.getTime() + terms.waitMs);
    const expiresAt = !viaAgent && terms.validityDays !== null ? addDays(readyAt, terms.validityDays) : null;
    const warnAt = expiresAt ? addDays(expiresAt, -content.documents.expiryWarningDays) : null;

    let claim: DocumentRow;
    try {
      claim = await db.document.create({
        data: {
          playerId,
          documentId,
          status: "in_progress",
          viaAgent,
          feeKobo: fee,
          startedAt: now,
          readyAt,
          expiresAt,
          warnAt,
          // A free document has nothing to charge, so it starts at once.
          paidAt: fee === 0n ? now : null,
          activeKey: `${playerId}:${documentId}`,
        },
      });
    } catch (error) {
      // The unique `activeKey`: the player already has this document, or is waiting for it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reject("already_applied");
      throw error;
    }
    if (fee === 0n) return { ok: true };

    const reason: LedgerReason | undefined = viaAgent ? "scam_loss" : def.feeReason;
    if (!reason) throw new Error(`document ${def.id} has a fee but no feeReason`);
    try {
      await wallet.debit({
        playerId,
        currency: "NGN",
        amount: fee,
        reason,
        // From the claim: a retried charge for the same application never pays twice.
        reference: `document:${playerId}:${claim.id}`,
      });
    } catch (error) {
      await db.document.delete({ where: { id: claim.id } });
      if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
      throw error;
    }
    await db.document.update({ where: { id: claim.id }, data: { paidAt: now } });
    return { ok: true };
  }

  /** What each document an office handles looks like to this player right now. */
  async offers(playerId: string, documentIds: readonly string[], now: Date): Promise<DocumentOffer[]> {
    const { content } = this.deps;
    await this.settleDue(now, playerId);
    const active = await this.deps.db.document.findMany({ where: { playerId, status: { in: ["in_progress", "ready"] } } });
    const byId = new Map(active.map((row) => [row.documentId, row]));
    const held = await this.heldIds(playerId, now);

    const offers: DocumentOffer[] = [];
    for (const documentId of documentIds) {
      const def = findDocument(content, documentId);
      if (!def) continue;
      const terms = documentTerms(content, def);
      const row = byId.get(documentId);
      const needs = def.requires.filter((required) => !held.has(required));
      const status: DocumentOffer["status"] = row
        ? (row.status as "in_progress" | "ready")
        : needs.length > 0
          ? "locked"
          : "available";
      offers.push({
        documentId,
        name: def.name,
        status,
        // Safe as numbers: a document fee is far below the balance cap.
        feeKobo: Number(terms.feeKobo),
        realFeeKobo: Number(terms.realFeeKobo),
        waitMs: terms.waitMs,
        realWaitDays: terms.realWaitDays,
        needs: needs.map((required) => findDocument(content, required)?.name ?? required),
        readyAt: row ? row.readyAt.toISOString() : null,
        agentFeeKobo:
          status === "available" && def.agentOffer
            ? Number(scaleMoney(terms.feeKobo, content.documents.agent.feeBp))
            : null,
      });
    }
    return offers;
  }

  /** The documents the player is waiting for or holds, soonest first, for the HUD list. */
  async summaries(playerId: string): Promise<DocumentSummary[]> {
    const rows = await this.deps.db.document.findMany({
      where: { playerId, status: { in: ["in_progress", "ready"] } },
      orderBy: [{ readyAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({
      documentId: row.documentId,
      name: findDocument(this.deps.content, row.documentId)?.name ?? row.documentId,
      status: row.status as "in_progress" | "ready",
      readyAt: row.readyAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }));
  }

  /** The players with a document that time has moved on, for the game loop. */
  async playersWithDue(now: Date): Promise<string[]> {
    const rows = await this.deps.db.document.findMany({
      where: {
        OR: [
          { status: "in_progress", paidAt: { not: null }, readyAt: { lte: now } },
          { status: "ready", warnedAt: null, warnAt: { lte: now } },
          { status: "ready", expiresAt: { lte: now } },
        ],
      },
      select: { playerId: true },
      distinct: ["playerId"],
    });
    return rows.map((row) => row.playerId);
  }

  /**
   * Moves on every document time has caught up with, once each, and tells the
   * player: ready (or, for the agent, gone quiet), expiring soon, expired.
   */
  async settleDue(now: Date, playerId?: string): Promise<void> {
    const { db, content } = this.deps;
    const copy = content.copy.notices;
    const owner = playerId ? { playerId } : {};

    const arrived = await db.document.findMany({
      where: { ...owner, status: "in_progress", paidAt: { not: null }, readyAt: { lte: now } },
    });
    for (const row of arrived) {
      const name = this.nameOf(row);
      const next = row.viaAgent ? { status: "failed", activeKey: null } : { status: "ready" };
      const { count } = await db.document.updateMany({ where: { id: row.id, status: "in_progress" }, data: next });
      if (count === 0) continue;
      await this.inbox.deliver(
        row.playerId,
        row.viaAgent
          ? { kind: "document", title: copy.agentSilentTitle, message: fill(copy.agentSilent, { name }) }
          : { kind: "document", title: fill(copy.documentReadyTitle, { name }), message: fill(copy.documentReady, { name }) },
        now,
      );
    }

    const expiring = await db.document.findMany({
      where: { ...owner, status: "ready", warnedAt: null, warnAt: { lte: now }, expiresAt: { gt: now } },
    });
    for (const row of expiring) {
      const { count } = await db.document.updateMany({ where: { id: row.id, warnedAt: null }, data: { warnedAt: now } });
      if (count === 0 || !row.expiresAt) continue;
      const name = this.nameOf(row);
      const days = Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / MS_PER_DAY));
      await this.inbox.deliver(
        row.playerId,
        {
          kind: "document",
          title: fill(copy.documentExpiringTitle, { name }),
          message: fill(copy.documentExpiring, { name, days }),
        },
        now,
      );
    }

    const lapsed = await db.document.findMany({
      where: { ...owner, status: "ready", expiresAt: { lte: now } },
    });
    for (const row of lapsed) {
      const { count } = await db.document.updateMany({
        where: { id: row.id, status: "ready" },
        data: { status: "expired", activeKey: null },
      });
      if (count === 0) continue;
      const name = this.nameOf(row);
      await this.inbox.deliver(
        row.playerId,
        { kind: "document", title: fill(copy.documentExpiredTitle, { name }), message: fill(copy.documentExpired, { name }) },
        now,
      );
    }
  }

  /** The ids of documents the player holds right now: ready and not past their expiry. */
  private async heldIds(playerId: string, now: Date): Promise<Set<string>> {
    const rows = await this.deps.db.document.findMany({
      where: { playerId, status: "ready", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { documentId: true },
    });
    return new Set(rows.map((row) => row.documentId));
  }

  private nameOf(row: DocumentRow): string {
    return findDocument(this.deps.content, row.documentId)?.name ?? row.documentId;
  }
}
