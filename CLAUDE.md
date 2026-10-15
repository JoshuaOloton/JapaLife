# CLAUDE.md

## Project

**JapaLife** is a browser-based multiplayer life simulator about the Nigerian "japa" journey: relocating abroad. The player starts in Lagos, grinds to save money, fights through passports, documents and visa applications (which can be refused), raises funds, leaves, and builds a new life abroad: job, housing, credit, mortgage, permanent status, citizenship. They can move alone and bring family later, or move with their family from the start. It runs in the browser with no install.

**Release 1 scope:** Lagos as the starting city, the **UK (London) and Canada (Toronto)** as destinations.

**Design reference:** the "JapaLife: Game Design" doc (Claude Doc) holds the full stage breakdown, routes, stats and real-world sources. When this file and the design doc disagree on game design, ask.

**Audience:** Nigerian players, mostly on low-end Android phones using mobile data. Every decision should respect that: small downloads, a smooth frame rate on weak GPUs, and touch controls first.

## The journey (game stages)

1. **Lagos life**: work, side hustles, traffic, power cuts, black tax, saving
2. **Documents**: NIN, passport, transcripts, credential evaluation, English test, police clearance, medicals
3. **Route**: UK Skilled Worker, UK Student, Canada Express Entry, Canada Study Permit
4. **Apply and wait**: fees, biometrics, waiting; approved, refused, or more documents requested
5. **Raise funds and leave**: proof of funds, japa sales, family help, ajo, currency conversion, packing, flight
6. **Solo vs family**: remittances and a family-reunion quest chain, or moving everyone at once
7. **Settling in**: IDs, bank, housing, healthcare, credit score, jobs, weather, community
8. **Building a life**: mortgage, permanent status, citizenship

## Realism rules

- The game is grounded in real 2026 rules and struggles. Fees, salary thresholds, proof-of-funds amounts, caps and processing times come from **config in `content/rules/`**, never hardcoded.
- Every rule value in config carries a `source` URL and an `asOf` date. Proposed (not yet law) rules are flagged `status: "proposed"`.
- Visa refusal is a real outcome. Approval chance is computed from application strength (documents complete and unexpired, funds held long enough and genuinely the player's, test scores, consistent history). Refusal reasons are data in `content/refusals/`.
- Shortcuts that are fraud in real life (fake bank statements, fake job offers, paid "agents") exist only as traps with heavy consequences, never as winning strategies. The game should teach players to spot scams.
- Policy-change events can update rule values mid-game, the way real rules change.
- **Game time is real time (decided 2026-10-15).** One game day is one real day. A 3-week visa wait takes 3 real weeks and a monthly rent is due every real month. Processing times, waits, expiries and timers are configured in real durations. Consequences:
  - The server clock is the only clock. Never trust a device clock.
  - Every timer is stored as a timestamp in Postgres (`dueAt`, `readyAt`, `expiresAt`) and checked on access plus by a scheduled job. Time passes while the player is offline, so nothing may depend on a room being open.
  - Waits can be months, so players need to be told when something happens (web push or email, in-app inbox on return). That is a product decision to make before Phase 2.
  - Testing needs a **dev-only time multiplier** (a server `GAME_CLOCK` setting, refused when `NODE_ENV=production`), otherwise nobody can play-test a month of rent.
  - Use real time zones for calendar logic: Lagos (WAT, UTC+1, no daylight saving), the UK (GMT/BST) and Toronto (EST/EDT).

## Stack

- **Client:** Next.js (App Router) + React Three Fiber, `@react-three/drei`, `@react-three/rapier`
- **Game server:** Colyseus (TypeScript), with rooms and schema-based state sync
- **Database:** Postgres via Prisma
- **Cache/presence:** Redis (sessions, online players, cross-instance pub/sub)
- **Assets:** glTF/GLB with Draco + KTX2 compression, served from a CDN (Cloudflare R2)
- **Payments (later):** Paystack, for buying in-game currency only
- **Package manager:** pnpm workspaces

## Repo layout

```
apps/
  client/        Next.js + R3F game client
  server/        Colyseus game server + REST endpoints (auth, purchases)
packages/
  shared/        Types, constants, message schemas, game-event definitions shared by client and server
  db/            Prisma schema, migrations, seed
content/
  cities/        City and district configs (Lagos, London, Toronto)
  rules/         Immigration routes, fees, thresholds, proof-of-funds tables (uk.json, canada.json, nigeria.json)
  documents/     Document definitions: cost, wait time, expiry, failure events
  events/        Random life events (black tax, NEPA, policy changes, scams)
  refusals/      Refusal reasons and what fixes them
  economy/       Starting exchange rates, volatility, price tables, inflation
```

## Commands

Requires Node 24+ and pnpm 12 (`packageManager` in the root `package.json`).

- `pnpm install`: install everything
- `pnpm dev`: run client (Next.js, http://localhost:3000) and game server (Colyseus, ws://localhost:2567, health check at `/health`) together
- `pnpm --filter @japalife/client dev` / `pnpm --filter @japalife/server dev`: run one side only
- `pnpm test`: run all tests (Vitest). The server tests boot a real Colyseus server on port 2599, and the ledger tests need Postgres running. They use a separate `<dbname>_test` database that the test setup creates and migrates itself, and they refuse to run against any database whose name does not end in `_test`. If Postgres is down, `pnpm test` fails with a message saying so
- `pnpm lint`: ESLint across the repo
- `pnpm typecheck`: `tsc` in every workspace package
- Run lint, typecheck and test before considering any task done
- `docker compose up -d postgres`: local Postgres on 5432. Needed for the ledger tests and anything that touches money. Redis is also in the compose file but nothing uses it yet, so don't start it (`up -d` with no service name starts both)
- `pnpm db:migrate`: Prisma `migrate dev` against `DATABASE_URL` (the ledger migration `init_ledger` is applied). `pnpm db:seed` creates one test player (`seed-test-player`) with N50,000 through the ledger. It is safe to run repeatedly and refuses to run when `NODE_ENV=production`
- `.env` (git-ignored, copy from `.env.example`): `DB_USER`, `DB_NAME`, `DB_PASSWORD` feed docker-compose, and `DATABASE_URL` must match them. The generated Prisma client is git-ignored and rebuilt by `pnpm install` (a `postinstall` runs `prisma generate`)

Ports: `DEFAULT_CLIENT_PORT` and `DEFAULT_SERVER_PORT` live in `packages/shared`. Override the server port with `SERVER_PORT` and the client's server URL with `NEXT_PUBLIC_SERVER_URL`.

## Non-negotiable rules

### The server is authoritative
- The client sends **intents** (`move`, `interact`, `submitApplication`, `convertCurrency`, `sendRemittance`), never outcomes.
- The client never sets or reports balances, inventory, stats, visa outcomes, or positions as truth. The server validates every intent and decides the result, including every visa decision roll.
- Validate every incoming message shape and value on the server, using schemas from `packages/shared`.

### The economy is a multi-currency ledger
- Three currencies at launch: **NGN, GBP, CAD**. Each player has a wallet per currency.
- No mutable `balance` column that code increments directly. Every movement is a row in a `Transaction` ledger (from, to, amount, currency, reason, reference, timestamp). Conversions record both legs plus the rate and spread used.
- All money operations run in a single Postgres transaction with row locking. Two concurrent requests must never be able to spend the same money.
- Amounts are integers in the smallest unit (kobo, pence, cents). Never floats.
- Exchange rates are **simulated**: seeded from `content/economy/`, drifting daily with shock events. Never fetch live rates. Every conversion channel (bank, fintech, street) has its own spread.
- Every faucet (salary, gifts, sales, events) and sink (rent, food, fees, remittances) is defined in one place and logged with a `reason`.
- Rate-limit earning actions per player. Flag accounts whose balance changes abnormally fast.
- In-game currency is **one-way**: it can be bought, but it can never be converted back to real money or transferred out of the game. Don't build anything that cashes out.
- Any change to economy code must include tests for: double-spend, negative balances, concurrent requests, overflow, and conversion rounding.

### Performance budget
- Initial client load: **under 15 MB** total. Lazy-load each city's and district's assets when the player enters it.
- Cap `devicePixelRatio` at 1.5. Use instancing for repeated objects (cars, trees, people), LODs for distant models, and minimal or baked shadows.
- Target 30+ fps on a mid-range Android phone. If a change adds noticeable GPU or bundle cost, say so.
- Network: send position updates 10–20 times per second; interpolate on the client. Send each player only the entities within their area of interest.

### Multiplayer
- One Colyseus room per district instance, capped by `MAX_PLAYERS_PER_ROOM` in `packages/shared`.
- When all instances are full, queue the player and show their place in line. Never crash or accept over capacity.

## Tone and content
- Keep the Nigerian flavour specific and respectful: danfos, okada, buka food, NEPA, japa sales, the airport send-off, the African shop abroad. Humour comes from shared experience, never from stereotypes about ethnic groups or nationalities.
- The game shows real struggles (refusals, loneliness, survival jobs, black tax) honestly, without mocking people who stay or people who leave.
- The game is entertainment, not immigration advice. Show a clear in-game disclaimer and never present config values as official guidance.

## Safety and compliance
- Players must be 18+; gate this at signup.
- Chat and the advice board go through a profanity filter and link filter (block scam links), and support report, mute, and block. Moderators can ban.
- Store only the personal data the game needs, in line with the Nigeria Data Protection Act. Never log passwords, tokens, or payment details.

## Code conventions
- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Shared types and message schemas live in `packages/shared`. Never duplicate them between client and server.
- Small, focused modules. Game systems (economy, documents, applications, remittances, credit, housing, events) are separate server modules with their own tests.
- Prefer clear names over comments, and add comments where the reason isn't obvious.

## Working with me
I'm an experienced full-stack developer but new to game development. Act as my lead game developer and mentor:
- Make standard game-dev decisions yourself, following established practice. Briefly explain what you chose and why, in plain language.
- Only ask me when a decision is about the game's design or feel, Nigerian cultural accuracy, real money, or player data. When you ask, give your recommendation first.
- When you introduce a game-dev concept (faucet/sink, interpolation, tick rate, LOD...), explain it in one or two sentences the first time.
- After each step, tell me what to play-test and what "good" should feel like.

## How to work in this repo
- Work in phases. Finish and verify the current phase before starting the next one.
- After a change: run typecheck, lint, and tests. For gameplay changes, describe how to try it manually.
- Ask before adding a new dependency or changing the stack.
- Ask before any change that touches auth, payments, or the ledger schema.

## Known limits of the current build

Things that are deliberately incomplete or that will bite later. Remove an item when it is fixed.

### Ledger and money (`apps/server/src/economy/`, `packages/db`)
- **Game code calls `WalletService`, never `Ledger`.** `WalletService` (`apps/server/src/economy/wallet.ts`) has `getBalance`, `credit` (faucet reasons only), `debit` (sink reasons only) and `transfer`. `getBalance` is a snapshot: never check it and then spend, call `debit`, which checks under a lock. Idempotency keys must be derived from the event (`shift:<playerId>:<shiftId>`), never random per call, or a retry pays twice.
- **`transfer` exists but is server-internal.** No client intent reaches it, it charges no fee and has no limits. Do not expose it until the "Money sharing controls" decisions are made.
- **Only `Ledger` writes `Transaction` rows.** The "player balance never goes negative" rule cannot be a database CHECK (system wallets legitimately go negative), so it is enforced by `Ledger.applyMovement` under the wallet lock. Any code that creates `Transaction` rows another way (raw SQL, `prisma.transaction.create`) bypasses it. Don't.
- **Hot-row bottleneck.** Every earn locks the single `faucet` system wallet, and every spend locks the single `sink` wallet (one pair per currency), so all earning serialises across the whole game. Fine for single-player and early multiplayer. Fix before real load: shard system wallets (e.g. `faucet:0..N`, chosen by hashing the player id) and re-run the concurrency tests.
- **Balance cap.** `MAX_WALLET_BALANCE` is 10^15 smallest units (about 10 trillion naira), kept below `Number.MAX_SAFE_INTEGER` so balances can travel as JSON numbers. A database CHECK mirrors it. The `sink` wallet's running total only ever grows, so it also hits this ceiling eventually; sharding or rotating system wallets (per season) fixes that too.
- **Conversion is not persisted.** `convertAmount` (integer maths, rounds down, refuses zero results) is built and tested, but there is no `convert()` operation yet. It must write both legs through the `fx` system wallets plus a `Conversion` row in one transaction, locking up to four wallets in sorted order. Phase 3.
- **Reasons are names only.** `FAUCET_REASONS` and `SINK_REASONS` in `packages/shared/src/economy.ts` now cover living costs, documents, UK and Canada immigration fees (`VISA_FEE_REASONS`), departure, family, and scam traps. No amounts are in code: every fee, wage and price must come from `content/` with a `source` URL and an `asOf` date, and the real 2026 fee values still need to be researched and entered there. Add new faucets and sinks to that file (no migration needed, since `reason` is a string). The cost is that the database does not enforce the list. Currency conversion legs and player-to-player transfers are neither faucets nor sinks and need their own reason class when built.
- **Not built yet:** per-player earn rate limit (Slice 4, with work shifts) and abnormal-balance flagging (Slice 6). CLAUDE.md requires both.
- **The ledger is append-only.** A trigger blocks UPDATE and DELETE on `Transaction`. Correct a mistake with a reversing entry, never an edit. Only tests TRUNCATE.
- **Money is `bigint`.** `JSON.stringify` throws on bigint. Send balances to the client as numbers (safe under the cap) or strings, and never do money maths in `number`.
- **No loans.** Player wallets cannot go negative, so credit, overdrafts, student loans and mortgages need their own liability model, not a negative wallet.

### Server and protocol
- **Intents are validated but not wired up.** `parseIntent` in `packages/shared/src/intents.ts` exists and is tested, but `DistrictRoom` does not call it yet, so the server currently ignores every client message. Slice 4 connects it. Never add a message handler that skips it.
- **No auth.** `Player` has no identity fields and anyone can join a room. Auth, the 18+ gate and data-protection decisions need your approval before they are built.
- **Rooms are in memory.** A Colyseus room is lost on restart. Rent timers, shift progress and anything that must survive belongs in Postgres, with the room only caching it.
- **Capacity queue is a stub.** `MAX_PLAYERS_PER_ROOM` is set on the room, but the "queue and show your place" behaviour is not built.

### Content
- **Phase 1 numbers are placeholders.** Everything in `content/economy/`, `content/events/` and `content/cities/lagos.json` is marked `"basis": "game-balance"` instead of a `source` URL: starting balance, rent, food prices, shift pay, event amounts and frequencies are tuning guesses, not researched Lagos prices. Retune them after play-testing. Real rules (Phase 2) must use `source` plus `asOf`.
- **Content is loaded once at boot** by `loadContent()` and not yet handed to the room; Slice 4 passes it in. Unknown fields are rejected, and cross-references (job sites, food vendors, event files per `GAME_EVENT_IDS`) are checked.
- **Hunger decay and the blackout's gameplay effect are not configured yet.** Slice 4 decides them (they are design/feel questions).

### Tooling
- **TypeScript is pinned to `~6.0`** because `typescript-eslint` does not support TS 7 yet. Revisit when it does.
- **`pnpm-workspace.yaml` `allowBuilds`:** `esbuild` is allowed; `prisma`, `@prisma/engines` and `msgpackr-extract` are declined. The first two are not needed (migrate and generate work). `msgpackr-extract` is an optional native speed-up for Colyseus with a JS fallback; revisit if message encoding shows up in profiling.
- **CI needs a Postgres service** for the ledger tests, and `DATABASE_URL` set.
- **Client bundle:** `@react-three/*` and `three` are installed but unused so far. Check the 15 MB initial-load budget when Slice 5 lands.

## Look-ahead: what to consider in later phases

- **Phase 1 (finish):** keep earn amounts, rent and food prices in `content/economy/`, not code. Build the clock before the rent timer: a server time source with the dev-only multiplier, and timers stored as timestamps (see "Game time is real time" under Realism rules).
- **Phase 2, documents and applications:** fees are sinks, so add reasons such as `document_fee` and `application_fee`. Roll visa decisions on the server with a logged seed so a result can be audited. Persist application state in the database (waits can last game-months). Funds "held long enough" can be computed from the ledger's running balances; add an index on wallet and `createdAt` if that query is slow.
- **Phase 3, funds and departure:** build `convert()` (see above), with rates from `content/economy/` and per-channel spreads. Ajo (rotating savings) and japa sales are new faucet and sink types. Any player-to-player gift or family help is a laundering and abuse risk once players can see each other: add per-day limits and flagging before it ships.
- **Phase 4, abroad:** remittances move money across currencies and possibly between players, so reuse the two-leg conversion path. The credit score should be derived from ledger history (late rent, missed payments), not stored as a number the client can influence. Mortgages need the loan model noted above. Needs a decision on how family members are represented (NPCs, linked accounts or other players).
- **Phase 5, multiplayer:** shard the system wallets, bring Redis in for presence and cross-instance pub/sub, add the capacity queue, and enforce area-of-interest so each player only receives nearby entities. Chat and the advice board need the profanity and link filters plus report, mute and block, and moderators need a ban tool.
- **Phase 6, launch:** Paystack webhooks must be idempotent. Use the provider's reference as the ledger `reference` so a repeated webhook cannot credit twice, and keep purchased currency one-way (no cash-out, no transfers). Plan for the ledger growing forever (balance lookups use the latest row per wallet, so they stay fast, but backups and archiving need a strategy). Load-test the room and queue logic on real mobile networks, and settle Nigeria Data Protection Act obligations (retention, deletion requests, a data-processing record). Payments and the ledger schema need your approval at each step.

## Current phase

**Phase 1: Lagos single-player core loop.** One walkable Lagos district, a third-person character with touch + keyboard controls, one job that pays per shift, rent due on a timer, food to buy, black-tax and power-cut events, and an NGN wallet backed by the ledger. Server-authoritative from the start, but no other players visible yet.

### Phase 1 slices (the plan, kept here so it survives `/clear`)

Work one slice at a time on its own branch. "Slice 3" and similar always mean this table.

| # | Slice | What it covers | Status |
|---|---|---|---|
| 0 | Scaffold | pnpm workspace, tooling, Colyseus connect demo | Done |
| 1 | Shared contracts | Zod intent schemas (`move`, `interact`, `work`, `buyFood`, `payRent`), ledger reasons, event ids in `packages/shared` | Done |
| 2 | Ledger and NGN wallet | Prisma schema and migration, `Ledger`, `WalletService`, concurrency tests, seeded test player | Done |
| 3 | Content config | Zod schemas in `packages/shared` and a server loader that validates `content/` JSON at boot (refuse to start on a bad file). Files Phase 1 needs: shift pay and starting balance, rent, food and other NGN prices, the black-tax and power-cut events, and `cities/lagos.json` (one district). No visa rules yet (Phase 2). Amounts are integers in kobo | Done (schemas in `packages/shared/src/content.ts`, loader in `apps/server/src/content/loadContent.ts`; all values are placeholder game-balance numbers, see Known limits) |
| 4 | Server game systems | The server clock (with the dev-only time multiplier), `DistrictRoom` handlers that call `parseIntent`, and separate modules for jobs, rent, food and events, plus the earn rate limit. Capacity queue stub | Next |
| 5 | Client | Walkable low-poly Lagos district, third-person controller with keyboard and touch joystick, interpolation, HUD (wallet, hunger, rent countdown, event toasts), 18+ gate stub, disclaimer | Not started |
| 6 | Hardening | 15 MB budget check, fps check on a mid-range Android, abnormal-balance flagging, log hygiene | Not started |

<!-- Phases to come:
  2 Documents + applications: passport and document quests, UK and Canada routes from config, decision rolls and refusals
  3 Funds and departure: japa sales, ajo, multi-currency wallets and conversion, packing, flight
  4 Abroad: London (UK) and Toronto (Canada), settling in, jobs, credit score, remittances, family reunion
  5 Multiplayer presence + chat + advice board
  6 Long game: mortgages, permanent status, citizenship; launch prep (load testing, queue, moderation, payments) -->

## Open decisions
- [x] 3D with React Three Fiber, low-poly art style (decided 2026-10-14). Not 2D isometric.
- [x] Release 1 cities: London (UK) and Toronto (Canada) (decided 2026-10-14)
- [x] Game time equals real-world time (decided 2026-10-15). See Realism rules for what follows from it.
- [x] Players must be able to share money with each other (decided 2026-10-15). Not built. Do not expose it to clients until the controls below are decided.
- [ ] Money sharing controls (recommendation in brackets):
  - Who can send to whom? [only players who have friended each other, never strangers]
  - Is bought currency transferable? [no: purchased money stays with the buyer]
  - Limits? [a transfer fee as a sink, a daily send cap, a receive cap, and no transfers until the account is 7 days old]
  - Are transfers reversible? [no for players; a moderator can add a reversing entry after a scam report]
  - Does received money count as "genuinely the player's" for proof of funds? [no, if it arrived shortly before an application, which is realistic and discourages gifting to skip the grind]
- [ ] Hosting for the game servers
