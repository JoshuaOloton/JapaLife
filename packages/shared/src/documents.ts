import { z } from "zod";
import { contentIdSchema, contentMetaSchema, ruleValueSchema } from "./content";
import { DOCUMENT_REASONS } from "./economy";

/**
 * Schemas for the documents a player gathers before applying (Phase 2):
 * `rules/pacing.json`, `rules/nigeria.json` and `documents/documents.json`.
 * Real fees and waits live in the rules, with a source and an asOf date; the
 * document file says which rule each document uses and what it needs first.
 */

/** Where a player's document stands. Only the first two are held; a failed or expired one can be applied for again. */
export const DOCUMENT_STATUSES = ["in_progress", "ready", "failed", "expired"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * rules/pacing.json: real money amounts in the rules are multiplied by
 * `moneyScaleBp` when the game charges them, so the journey fits what a Lagos
 * wage can save, and real waits by `waitScaleBp`, so a player is not made to
 * wait six real weeks for a passport. The real figure is still shown beside the
 * game one. The deliberate exceptions to "grounded in real 2026 rules" (Phase 2
 * decisions, 2026-10-17 for money, 2026-11-02 for waits).
 */
export const pacingSchema = z.strictObject({
  meta: contentMetaSchema,
  /** Basis points: 10000 charges the real amount, 3000 charges 30% of it. */
  moneyScaleBp: z.int().min(100).max(10_000),
  /** Basis points of a real wait the game makes the player wait: 2000 turns six real weeks into about eight days. */
  waitScaleBp: z.int().min(100).max(10_000),
  /** No game wait is longer than this, however long the real one is (decided 2026-11-02: never more than a week). */
  maxWaitDays: z.int().min(1).max(7),
});
export type PacingConfig = z.infer<typeof pacingSchema>;

/** The real fee, wait and life of one Nigerian document. */
export const documentRuleSchema = z.strictObject({
  /** In kobo. Zero when the real thing is free (first NIN enrolment). */
  feeKobo: ruleValueSchema(z.int().min(0)),
  /** Real days from applying until it is ready. */
  waitDays: ruleValueSchema(z.int().min(0).max(3650)),
  /** Real days it stays valid once ready; absent when it does not expire. */
  validityDays: ruleValueSchema(z.int().positive().max(36_500)).optional(),
});
export type DocumentRule = z.infer<typeof documentRuleSchema>;

/** rules/nigeria.json: one rule per document, by the id documents.json refers to. */
export const nigeriaRulesSchema = z.strictObject({
  documents: z.record(contentIdSchema, documentRuleSchema),
});
export type NigeriaRules = z.infer<typeof nigeriaRulesSchema>;

export const documentDefSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  /** The key in `rules/nigeria.json` `documents` that holds its real fee, wait and validity. */
  rule: contentIdSchema,
  /** Documents the player must hold (ready, not expired) before applying. */
  requires: z.array(contentIdSchema).default([]),
  /** The ledger reason for the fee; needed whenever the fee is above zero. */
  feeReason: z.enum(DOCUMENT_REASONS).optional(),
  /** A fake "agent" offers to do it faster and cheaper: a scam trap (CLAUDE.md realism rules). */
  agentOffer: z.boolean().default(false),
});
export type DocumentDef = z.infer<typeof documentDefSchema>;

export const documentsSchema = z.strictObject({
  meta: contentMetaSchema,
  /** Days before a document expires that the player is warned in the inbox. */
  expiryWarningDays: z.int().min(1).max(365),
  /** The scam: what the agent charges (a share of the game fee) and how long until they go silent. */
  agent: z.strictObject({
    feeBp: z.int().min(100).max(10_000),
    silentAfterDays: z.int().min(1).max(30),
  }),
  /** Listed so that every document comes after the ones it requires. */
  documents: z.array(documentDefSchema).min(1),
});
export type DocumentsConfig = z.infer<typeof documentsSchema>;
