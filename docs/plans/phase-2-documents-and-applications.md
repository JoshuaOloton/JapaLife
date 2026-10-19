# Plan: Phase 2, documents, routes and applications

Moved out of CLAUDE.md, which links here.

**Phase 2: documents, routes and applications (planned 2026-10-17, starts after Slice 11).** Phase 1 is done and play-tested. Phase 2 covers design-doc Stages 2–4: gathering documents in Lagos, choosing a route, applying, waiting in real time, and being approved, refused or asked for more.

## Phase 2 decisions (2026-10-17)

- **Pacing: money in the rules is scaled down.** Real fees against Phase 1 pay do not fit. A player nets about N90,000 a real month, while UK Skilled Worker costs about N7.8m up front and Canada Express Entry about N18m including settlement funds. So every money amount in `content/rules/` (fees, settlement funds, salary thresholds) keeps its **real** value with `source` and `asOf`, and the game charges and checks it multiplied by one `moneyScale` in content. Exchange rates, wait times, expiries and every non-money rule stay real. The UI may show the real figure beside the game price ("real fee: £819"), which keeps the game honest and teaches. The factor is set in 2.1 to make the cheapest route reachable in a few real months of committed play, then tuned after play-testing. This is the one deliberate exception to "grounded in real 2026 rules".
- **Canada Express Entry first.** It needs no job offer and uses every document; the points pool with periodic draws suits real-time waiting. UK Skilled Worker comes second (it needs a sponsor job hunt). The student routes wait for Phase 3 (tuition and proof of funds).
- **Foreign fees are paid in naira at the day's simulated card rate**, the way a Nigerian card pays UKVI or IRCC. The rate used is recorded on the document or application row. Wallets stay NGN-only until Phase 3's `convert()`.
- **Documents happen at real places in Yaba**: NIMC office, passport office, police station, a clinic, an English test centre, and a cyber café for online forms (transcripts, credential evaluation, the visa form). The visa application centre for biometrics stays in Yaba for now; in reality it is in Victoria Island or Ikoyi, so it moves when there is a second district.
- **The japa starts with a story event** about 3 days after starting (a friend posts their arrival photo from London), which unlocks the route picker. A dev command can unlock it at once. (Recommendation, not yet confirmed: change it if it feels wrong in play.)

## Phase 2 slices (draft, reorder after the decisions)

"Slice 2.3" and similar mean this table. One branch per slice, as in Phase 1.

| # | Slice | What it covers |
|---|---|---|
| 2.1 | Real rules research | Real 2026 values, each with `source` URL and `asOf`, in `content/rules/nigeria.json` (NIN, passport, police certificate, medical), `canada.json` (Express Entry fees, the CRS points grid, settlement funds by family size, ECA, IELTS/CELPIP, panel medical) and `uk.json` (for 2.9). Seed exchange rates (NGN per GBP and CAD) in `content/economy/`. The `moneyScale` factor. Zod schemas in `packages/shared`. No gameplay |
| 2.2 | Exchange rates | Simulated daily rates from the seed, drifting daily with shock events, and per-channel spreads. Read-only: a `RateService` and a rate in the HUD. Foreign fees are charged in naira at the card rate. No conversion or new wallets yet |
| 2.3 | Pay rises | Smaller now that money is scaled: pay rises or a promotion so prices no longer outrun wages over months of real time, with `earningCeilings` updated so `BalanceWatch` does not flag them. Side hustles if play-testing shows saving is still too slow |
| 2.4 | Documents | A `Document` table (type, status, `readyAt`, `expiresAt`, rate used) and a `DocumentService`. Covers prerequisites (NIN before passport), fees as sinks, real-time waits, expiry, and failure events from content (a NIN name mismatch blocks the passport, a transcript sent to the wrong address). New Yaba places, a documents folder in the HUD, and inbox messages when something is ready, fails or expires. The passport-office "agent" is a scam trap: the money is lost, and nothing gets faster |
| 2.5 | English test | Study sessions (time and energy, like shifts) raise preparation. Booking and sitting the test, then a server-rolled band score that depends on preparation. Results expire after 2 years, and a band short means a resit |
| 2.6 | Choosing a route | The japa trigger event and a route picker. An eligibility checklist showing what the player has, what is missing and what it costs |
| 2.7 | Canada Express Entry | A profile with a CRS score computed from the player's documents and stats. The pool, with draws on a schedule and a cut-off that moves (config). Invitations expire after 60 days |
| 2.8 | Apply and wait | A generic application engine: form and fees, a biometrics appointment, and a real-time wait. The decision is rolled on the server with a logged seed and computed from application strength (documents complete and unexpired, funds held long enough from ledger history, test scores, history). Refusal reasons are data in `content/refusals/`. A refusal loses the fee and must be declared on later applications. Fake documents mean a long ban. The outcome reaches the player through the inbox. Ends Phase 2 for Canada |
| 2.9 | UK Skilled Worker | A sponsor job hunt (applications, interviews, Certificate of Sponsorship), fake job offers as traps, the B2 English level, the salary threshold and the health surcharge, all through the 2.8 engine |
| 2.10 | Hardening | A dev command to skip a wait, a play-test of a full route under `GAME_CLOCK`, refusal and approval balance, and a bundle check |

Phase 2 is done when a player can go from Lagos to an approval (or a refusal with reasons) on both routes. Leaving the country is Phase 3.
