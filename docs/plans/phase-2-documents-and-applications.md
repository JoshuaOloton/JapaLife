# Plan: Phase 2, documents, routes and applications

Approved 2026-11-01 (lean version). Replaces the 10-slice draft of 2026-10-17, which had exchange-rate systems, a pay-rise system, an English-test minigame, a background questionnaire and a second route: too much machinery for a game.

Phase 2 is the japa journey itself: gather documents in Yaba, pick a route, apply, wait, get an answer. The facts stay real (fees, waits, document names, refusal as a real outcome), but play stays light.

## Design principles

- **Real facts, light play.** Real fees, waits and document names with `source` and `asOf`, but each step is one short action: walk to a place, pay, wait, collect. No minigames, no forms.
- **Waiting is not a chore.** While a document or visa is in progress, the player keeps living Lagos life. The inbox tells them when something happens. Nothing needs checking daily.
- **No dead ends and no surprise punishment.** Every setback says what happened and what fixes it. Expiries get a warning in the inbox well before they bite. A refusal costs the fee and sends you back with a clear "what to fix", never a ban. Scams are the one real trap and they teach, with a short sting rather than ruin.
- **Fewer, bigger choices.** Few documents, one route, one clear next step shown at all times.

## Decisions

- **Pacing (2026-10-17):** fees keep their real value in `content/rules/` and the game charges them times one `moneyScale` in content, tuned so the cheapest route is reachable in a few real months of normal play. The sheet shows the real figure beside the game price. This is the one deliberate exception to "grounded in real 2026 rules".
- **Canada Express Entry only** for now. The UK route (needs a sponsor job hunt) is a later Phase 2b, after Canada plays well. Student routes wait for Phase 3.
- **Foreign fees are paid in naira at one fixed card rate from content.** Simulated daily rates wait for Phase 3's `convert()`. Wallets stay NGN-only.
- **Documents happen at real places in Yaba** (NIMC office, passport office and so on). The visa application centre stays in Yaba until there is a second district.
- **The japa story event** about 3 days after starting (a friend posts their arrival photo from London) unlocks the route picker. A dev command unlocks it at once. Recommendation, not confirmed: change it if it feels wrong in play.
- **Dropped for now:** a background questionnaire at creation, study sessions, moving draw cut-offs (a simple threshold check instead), a pay-rise system (tune pay and prices in content), fake-document bans.

## Scope

**In:** NIN, passport, certificate evaluation (transcript plus credential evaluation as one step), English test (pay, sit, get a score), one combined clearances step (police certificate plus medical), Canada Express Entry, a points score, one application, a real-time wait, approval or refusal with reasons.

## Step 0

`feat/map-and-rides` is unpushed. Push it and open a PR to `main`, then branch Phase 2 from `main`.

## Slices

"Slice 2.3" and similar mean this list. One branch per slice, each play-tested before the next.

### 2.1 Documents loop: NIN and passport
- Content: `content/rules/nigeria.json` (NIN, passport; fee, wait, validity, `source`, `asOf`) and `content/documents/` definitions, loaded and validated in `loadContent.ts` with zod schemas in `packages/shared/src/content.ts`.
- `Document` table (type, status, `readyAt`, `expiresAt`, fee) and `DocumentService` following the `rides.ts` pattern: prerequisite check (NIN before passport), debit via `WalletService`, wait as a timestamp, ready message through `InboxService.deliver`. A due-job in the 30 s game loop and `DistrictRoom.catchUp`.
- Places: NIMC office and passport office as interactable kinds in Yaba, a small documents list in the HUD.
- The passport "agent" is the one trap: money lost, clear message on how to spot it.
- Play-test: walk, pay, wait with `GAME_CLOCK`, get the message, collect. Good = you always know the next step.

### 2.2 The rest of the documents
- Certificate evaluation, English test, clearances (one place each, same loop as 2.1). The English test is pay, sit, and a server-rolled score that is better if you wait a few days after booking ("preparation" is just time, not a minigame). Content in `canada.json`.
- A failure event may delay a document once (a name mismatch) but always shows the one action that fixes it.

### 2.3 Route, points and application
- The japa story event unlocks the route picker. Express Entry points score computed from the documents and test score the player holds (a pure, unit-tested function over the real grid in `canada.json`). One checklist screen: have, missing, cost.
- `Application` table and a decision engine: submit, pay, biometrics visit at the Yaba centre, real-time wait, server-rolled decision from application strength (documents complete and unexpired, funds held long enough from ledger history, score). Roll seed logged for audit. Refusal reasons in `content/refusals/`, each with the fix. Outcome arrives in the inbox.
- `visa_fee_refund` and any new faucet get ceilings in `earningCeilings`.

### 2.4 Polish and balance
- Dev command to skip a wait, a full run under `GAME_CLOCK`, tuning of `moneyScale`, wait lengths and approval odds (a decent player should be approved most of the time; a refusal should feel fair, not random), `pnpm budget` check.

Phase 2 is done when a player can go from Lagos to an approval (or a refusal with reasons) on Canada Express Entry. Leaving the country is Phase 3.

## Rules to respect

Config over code with `source`/`asOf`; all text in `content/copy/en.json` and `copySchema`; new reject reasons registered in `REJECT_REASONS` and `rejections`; new sinks and faucets get reasons in `packages/shared/src/economy.ts` (a `nin_fee` reason is missing today); intents validated and run through the mutex; idempotency keys derived from the event; fraud only as a trap; the in-game disclaimer stays.

Adding a place end to end (typecheck fails until each spot is filled): `interactableSchema` in `content.ts`, `crossCheck` in `loadContent.ts`, `promptsSchema` and `en.json`, `PLACE_COLOURS` in the client, an `InteractionMessage` member, a case in `describeOffer` (`game/offers.ts`), the intent in `intents.ts` and `DistrictRoom.execute`, the place in `yaba.json` then `pnpm city`, and a case in `PlacePanel.tsx`.

## Approvals needed

Two Prisma migrations (`Document`, then `Application`), neither touches the ledger. No new dependencies.

## Verification

Per slice: `pnpm typecheck`, `pnpm lint`, `pnpm test` with Postgres up, then play-test with `GAME_CLOCK=60 pnpm --filter @japalife/server dev` and `pnpm grant-money`; check `?fps` on the phone still holds 60 fps.
