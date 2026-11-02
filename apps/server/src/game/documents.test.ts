import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, createHarness, type Harness } from "../test/gameHarness";
import { documentTerms, findDocument, scaleMoney } from "./documents";

const PLAYER = "applicant";
const STARTING_BALANCE = 2_000_000n; // content/economy/ngn.json
// content/rules/nigeria.json (real ₦100,000) at content/rules/pacing.json (30%).
const PASSPORT_FEE = 3_000_000n;
const AGENT_FEE = 1_500_000n; // content/documents/documents.json: 50% of the game fee
// Real waits (content/rules/nigeria.json: 3 and 42 days) at content/rules/pacing.json (15%, capped at 7 days).
const NIN_WAIT_MS = 38_880_000; // 10.8 hours
const PASSPORT_WAIT_MS = 544_320_000; // 6.3 days
const PASSPORT_VALID_DAYS = 1825;
const AGENT_SILENT_DAYS = 7;

let h: Harness;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
  await h.game.players.ensurePlayer(PLAYER);
});

afterAll(() => h?.close());

const now = (): Date => h.clock.now();
const apply = (documentId: string, playerId = PLAYER) => h.game.documents.apply(playerId, documentId, now());
const settle = () => h.game.documents.settleDue(now(), PLAYER);
const waitMs = async (milliseconds: number): Promise<void> => {
  h.clock.advance(milliseconds);
  await settle();
};
const wait = (days: number): Promise<void> => waitMs(days * DAY_MS);
const balance = (): Promise<bigint> => h.wallet.getBalance(PLAYER, "NGN");
const give = (amount: bigint): Promise<unknown> =>
  h.wallet.credit({ playerId: PLAYER, currency: "NGN", amount, reason: "family_help", reference: `grant:${amount}` });
const inbox = () => h.db.inboxMessage.findMany({ where: { playerId: PLAYER }, orderBy: { createdAt: "asc" } });
/** Gets the NIN and waits for it, the way the passport needs. */
const holdNin = async (): Promise<void> => {
  expect(await apply("nin")).toEqual({ ok: true });
  await waitMs(NIN_WAIT_MS);
};

describe("scaleMoney", () => {
  it("takes a share in basis points, rounding half up, in whole kobo", () => {
    expect(scaleMoney(10_000_000n, 3000)).toBe(3_000_000n);
    expect(scaleMoney(5n, 5000)).toBe(3n); // 2.5 rounds up
    expect(scaleMoney(4n, 5000)).toBe(2n);
    expect(scaleMoney(1n, 4999)).toBe(0n);
    expect(scaleMoney(0n, 3000)).toBe(0n);
  });

  it("is exact at 100% and does not overflow at the wallet cap", () => {
    const huge = 9_007_199_254_740_991n;
    expect(scaleMoney(huge, 10_000)).toBe(huge);
    expect(scaleMoney(huge * 1000n, 3000)).toBe((huge * 3000n * 1000n) / 10_000n);
  });
});

describe("what a document costs", () => {
  it("charges the real fee scaled by the game's pacing, and keeps the real fee to show", () => {
    const passport = findDocument(h.content, "passport");
    const terms = documentTerms(h.content, passport!);
    expect(terms.realFeeKobo).toBe(10_000_000n);
    expect(terms.feeKobo).toBe(PASSPORT_FEE);
    expect(terms.waitMs).toBe(PASSPORT_WAIT_MS);
    expect(terms.realWaitDays).toBe(42);
    expect(terms.validityDays).toBe(PASSPORT_VALID_DAYS);
  });

  it("never makes the player wait longer than the cap, however long the real wait is", () => {
    const passport = findDocument(h.content, "passport")!;
    const capped = { ...h.content, pacing: { ...h.content.pacing, maxWaitDays: 2 } };
    expect(documentTerms(capped, passport).waitMs).toBe(2 * DAY_MS);
    const uncapped = { ...h.content, pacing: { ...h.content.pacing, waitScaleBp: 10_000, maxWaitDays: 7 } };
    expect(documentTerms(uncapped, passport).waitMs).toBe(7 * DAY_MS);
    expect(documentTerms(uncapped, passport).realWaitDays).toBe(42);
  });

  it("makes the NIN free and lasting", () => {
    const terms = documentTerms(h.content, findDocument(h.content, "nin")!);
    expect(terms.feeKobo).toBe(0n);
    expect(terms.validityDays).toBeNull();
  });
});

describe("applying for the NIN", () => {
  it("starts a free wait without touching the wallet", async () => {
    expect(await apply("nin")).toEqual({ ok: true });
    expect(await balance()).toBe(STARTING_BALANCE);
    const [row] = await h.db.document.findMany({ where: { playerId: PLAYER } });
    expect(row?.status).toBe("in_progress");
    expect(row?.readyAt.getTime()).toBe(now().getTime() + NIN_WAIT_MS);
    expect(row?.expiresAt).toBeNull();
  });

  it("becomes ready after the wait, once, and tells the player", async () => {
    await apply("nin");
    await waitMs(NIN_WAIT_MS - 1000);
    expect(await inbox()).toHaveLength(0);

    await waitMs(1000);
    await settle(); // a second settle must not announce it again
    const messages = await inbox();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "document", title: expect.stringContaining("National Identification Number") });
    expect((await h.game.documents.summaries(PLAYER))[0]).toMatchObject({ documentId: "nin", status: "ready", expiresAt: null });
  });

  it("refuses a second application while one is waiting or held", async () => {
    await apply("nin");
    expect(await apply("nin")).toEqual({ ok: false, reason: "already_applied" });
    await waitMs(NIN_WAIT_MS);
    expect(await apply("nin")).toEqual({ ok: false, reason: "already_applied" });
    expect(await h.db.document.count({ where: { playerId: PLAYER } })).toBe(1);
  });

  it("refuses unknown documents and players who never joined", async () => {
    expect(await apply("visa")).toEqual({ ok: false, reason: "unknown_target" });
    expect(await apply("nin", "stranger")).toEqual({ ok: false, reason: "not_signed_in" });
  });
});

describe("applying for the passport", () => {
  it("needs the NIN to be held first, not just applied for", async () => {
    await give(PASSPORT_FEE);
    expect(await apply("passport")).toEqual({ ok: false, reason: "missing_document" });
    await apply("nin");
    expect(await apply("passport")).toEqual({ ok: false, reason: "missing_document" });
    expect(await balance()).toBe(STARTING_BALANCE + PASSPORT_FEE);
  });

  it("charges the scaled fee once, as a passport_fee sink", async () => {
    await give(PASSPORT_FEE);
    await holdNin();
    expect(await apply("passport")).toEqual({ ok: true });
    expect(await balance()).toBe(STARTING_BALANCE);
    const charges = await h.db.transaction.findMany({ where: { reason: "passport_fee" } });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amount).toBe(PASSPORT_FEE);
  });

  it("lets only one of several simultaneous applications through, and charges once (double spend)", async () => {
    await give(PASSPORT_FEE * 3n);
    await holdNin();
    const results = await Promise.all([apply("passport"), apply("passport"), apply("passport")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "already_applied" },
      { ok: false, reason: "already_applied" },
    ]);
    expect(await balance()).toBe(STARTING_BALANCE + PASSPORT_FEE * 2n);
    expect(await h.db.document.count({ where: { playerId: PLAYER, documentId: "passport" } })).toBe(1);
  });

  it("refuses when the player cannot afford it: no row, no charge, never a negative balance", async () => {
    await give(PASSPORT_FEE - STARTING_BALANCE - 1n); // one kobo short
    await holdNin();
    expect(await apply("passport")).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(await balance()).toBe(PASSPORT_FEE - 1n);
    expect(await h.db.document.count({ where: { playerId: PLAYER, documentId: "passport" } })).toBe(0);
  });

  it("can be tried again after a refusal for money", async () => {
    await holdNin();
    expect(await apply("passport")).toEqual({ ok: false, reason: "insufficient_funds" });
    await give(PASSPORT_FEE);
    expect(await apply("passport")).toEqual({ ok: true });
  });

  it("is ready after the real wait, warns 90 days before it expires, then expires", async () => {
    await give(PASSPORT_FEE);
    await holdNin();
    await apply("passport");
    await waitMs(PASSPORT_WAIT_MS);
    expect((await h.game.documents.summaries(PLAYER)).map((entry) => entry.documentId)).toEqual(["nin", "passport"]);

    await wait(PASSPORT_VALID_DAYS - 91);
    expect((await inbox()).filter((message) => message.title.includes("expires soon"))).toHaveLength(0);
    await wait(2);
    await wait(1);
    expect((await inbox()).filter((message) => message.title.includes("expires soon"))).toHaveLength(1);

    await wait(90);
    const expired = (await inbox()).filter((message) => message.title.includes("expired"));
    expect(expired).toHaveLength(1);
    expect((await h.game.documents.summaries(PLAYER)).map((entry) => entry.documentId)).toEqual(["nin"]);
  });

  it("settles everything that fell due while the player was away, in one catch-up", async () => {
    await give(PASSPORT_FEE);
    await holdNin();
    await apply("passport");
    h.clock.advance(PASSPORT_WAIT_MS + (PASSPORT_VALID_DAYS + 5) * DAY_MS);
    await settle();
    const titles = (await inbox()).map((message) => message.title);
    expect(titles.some((title) => title.includes("International passport is ready"))).toBe(true);
    expect(titles.some((title) => title.includes("expired"))).toBe(true);
    // The warning was skipped: it would have said "expires soon" about a document already gone.
    expect(titles.some((title) => title.includes("expires soon"))).toBe(false);
  });

  it("can be applied for again after it expires", async () => {
    await give(PASSPORT_FEE * 2n);
    await holdNin();
    await apply("passport");
    await waitMs(PASSPORT_WAIT_MS + (PASSPORT_VALID_DAYS + 1) * DAY_MS);
    expect(await apply("passport")).toEqual({ ok: true });
  });
});

describe("what an office offers", () => {
  it("locks the passport until the NIN is held, then offers it with the agent beside it", async () => {
    const [locked] = await h.game.documents.offers(PLAYER, ["passport"], now());
    expect(locked).toMatchObject({
      documentId: "passport",
      status: "locked",
      feeKobo: Number(PASSPORT_FEE),
      realFeeKobo: 10_000_000,
      waitMs: PASSPORT_WAIT_MS,
      realWaitDays: 42,
      needs: ["National Identification Number (NIN)"],
      agentFeeKobo: null,
    });

    await holdNin();
    const [open] = await h.game.documents.offers(PLAYER, ["passport"], now());
    expect(open).toMatchObject({ status: "available", needs: [], agentFeeKobo: Number(AGENT_FEE) });
  });

  it("shows a waiting document with when it will be ready, and never an agent for the NIN", async () => {
    await apply("nin");
    const [nin] = await h.game.documents.offers(PLAYER, ["nin"], now());
    expect(nin).toMatchObject({ status: "in_progress", agentFeeKobo: null });
    expect(nin?.readyAt).toBe(new Date(now().getTime() + NIN_WAIT_MS).toISOString());
  });

  it("settles first, so a document that just became ready shows as held", async () => {
    await apply("nin");
    h.clock.advance(NIN_WAIT_MS);
    const [nin] = await h.game.documents.offers(PLAYER, ["nin"], now());
    expect(nin?.status).toBe("ready");
  });
});

describe("the agent (a scam trap)", () => {
  it("takes half the fee as a scam_loss and issues nothing, then goes quiet", async () => {
    await give(PASSPORT_FEE);
    await holdNin();
    expect(await h.game.documents.hireAgent(PLAYER, "passport", now())).toEqual({ ok: true });
    expect(await balance()).toBe(STARTING_BALANCE + PASSPORT_FEE - AGENT_FEE);
    const losses = await h.db.transaction.findMany({ where: { reason: "scam_loss" } });
    expect(losses).toHaveLength(1);
    expect(losses[0]?.amount).toBe(AGENT_FEE);

    await wait(AGENT_SILENT_DAYS);
    const messages = await inbox();
    expect(messages.some((message) => message.title === "The agent has gone quiet")).toBe(true);
    // Nothing is held, and no passport ever appears.
    expect((await h.game.documents.summaries(PLAYER)).map((entry) => entry.documentId)).toEqual(["nin"]);
    await waitMs(PASSPORT_WAIT_MS);
    expect((await h.game.documents.summaries(PLAYER)).map((entry) => entry.documentId)).toEqual(["nin"]);
  });

  it("blocks the real application while he is still promising, then lets the player apply properly", async () => {
    await give(PASSPORT_FEE * 2n);
    await holdNin();
    await h.game.documents.hireAgent(PLAYER, "passport", now());
    expect(await apply("passport")).toEqual({ ok: false, reason: "already_applied" });
    await wait(AGENT_SILENT_DAYS);
    expect(await apply("passport")).toEqual({ ok: true });
  });

  it("is only offered for documents that have an agent, and only to someone who could apply", async () => {
    expect(await h.game.documents.hireAgent(PLAYER, "nin", now())).toEqual({ ok: false, reason: "unknown_target" });
    expect(await h.game.documents.hireAgent(PLAYER, "passport", now())).toEqual({ ok: false, reason: "missing_document" });
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  it("cannot be paid twice at once: one scam_loss, never a negative balance", async () => {
    await holdNin();
    const results = await Promise.all([
      h.game.documents.hireAgent(PLAYER, "passport", now()),
      h.game.documents.hireAgent(PLAYER, "passport", now()),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await balance()).toBe(STARTING_BALANCE - AGENT_FEE);
    expect(await h.db.transaction.count({ where: { reason: "scam_loss" } })).toBe(1);
  });

  it("refuses a player who cannot afford him: no row, no charge", async () => {
    await holdNin();
    await h.wallet.debit({ playerId: PLAYER, currency: "NGN", amount: STARTING_BALANCE - AGENT_FEE + 1n, reason: "food", reference: "spend-it" });
    expect(await h.game.documents.hireAgent(PLAYER, "passport", now())).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(await balance()).toBe(AGENT_FEE - 1n);
    expect(await h.db.document.count({ where: { playerId: PLAYER, documentId: "passport" } })).toBe(0);
  });
});

describe("the game loop's view", () => {
  it("lists the players with something due, and nobody once it is settled", async () => {
    await apply("nin");
    expect(await h.game.documents.playersWithDue(now())).toEqual([]);
    h.clock.advance(NIN_WAIT_MS);
    expect(await h.game.documents.playersWithDue(now())).toEqual([PLAYER]);
    await h.game.documents.settleDue(now());
    expect(await h.game.documents.playersWithDue(now())).toEqual([]);
  });

  it("reaches the HUD: stats carry the player's documents soonest first", async () => {
    await apply("nin");
    const stats = await h.game.stats.build(PLAYER, now());
    expect(stats?.documents).toEqual([
      {
        documentId: "nin",
        name: "National Identification Number (NIN)",
        status: "in_progress",
        readyAt: new Date(now().getTime() + NIN_WAIT_MS).toISOString(),
        expiresAt: null,
      },
    ]);
  });
});
