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
  - Waits can be months, so players need to be told when something happens. **Decided 2026-10-17: an in-app inbox first** (see Known limits, Server). Web push comes later (it needs HTTPS, since service workers do not run on plain http); email needs sign-up and stored personal data, so it waits for the auth decision.
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
  copy/          Every player-facing string, one file per language (en.json)
```

## Commands

Requires Node 24+ and pnpm 12 (`packageManager` in the root `package.json`).

- `pnpm install`: install everything
- `pnpm dev`: run client (Next.js, http://localhost:3000) and game server (Colyseus, ws://localhost:2567, health check at `/health`) together
- `pnpm --filter @japalife/client dev` / `pnpm --filter @japalife/server dev`: run one side only
- `pnpm test`: run all tests (Vitest). The server tests boot a real Colyseus server on port 2599, and the ledger tests need Postgres running. They use a separate `<dbname>_test` database that the test setup creates and migrates itself, and they refuse to run against any database whose name does not end in `_test`. If Postgres is down, `pnpm test` fails with a message saying so
- `pnpm lint`: ESLint across the repo
- `pnpm typecheck`: `tsc` in every workspace package
- `pnpm budget`: production-build the client and fail if its download is over 15 MB
- `pnpm start:client`: production-build the client and serve it on port 3000 (for fps and phone testing; dev mode is slower). `NEXT_PUBLIC_SERVER_URL` is baked in at build time, so set it on this command
- `pnpm db:generate`: regenerate the Prisma client. Run it after `pnpm db:migrate`
- `pnpm fire-event <black_tax|power_cut|food_price_rise> <playerId>`: dev-only play-testing helper that fires an event now, skipping the dice and the gap. The script runs in its own process, so there is no toast: a connected player sees it as an unread inbox message (and the event card, for black tax) at the room's next event check (within a minute)
- `pnpm grant-money <naira> <playerId>`: dev-only, credits naira through the ledger as `family_help` (so BalanceWatch flags it, as expected). Each browser has its own dev player id (`dev-xxxxxxxx`, in `localStorage`); the phone used for play-testing on 2026-10-17 was `dev-61861b2b`
- Run lint, typecheck and test before considering any task done
- `docker compose up -d postgres`: local Postgres on 5432. Needed for the ledger tests and anything that touches money. Redis is also in the compose file but nothing uses it yet, so don't start it (`up -d` with no service name starts both)
- `pnpm db:migrate`: Prisma `migrate dev` against `DATABASE_URL` (the ledger migration `init_ledger` is applied). `pnpm db:seed` creates one test player (`seed-test-player`) with N50,000 through the ledger. It is safe to run repeatedly and refuses to run when `NODE_ENV=production`
- `.env` (git-ignored, copy from `.env.example`): `DB_USER`, `DB_NAME`, `DB_PASSWORD` feed docker-compose, and `DATABASE_URL` must match them. The generated Prisma client is git-ignored and rebuilt by `pnpm install` (a `postinstall` runs `prisma generate`)

Dev-only time multiplier: `GAME_CLOCK=60 pnpm --filter @japalife/server dev` runs game time 60x faster (one real minute is one game hour), so a month of rent takes about 12 real hours. The server refuses to start with `GAME_CLOCK` set when `NODE_ENV=production`. After a restart the clock is back at real time, so timestamps stored by a sped-up session lie in the future; reset the dev database if that gets confusing.

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
- Never write player-facing text in code. Add it to `content/copy/en.json` and its schema (`copySchema` in `packages/shared/src/copy.ts`), with `{placeholders}` filled by `fill`. Names of places, food, jobs and event text stay in their own content files. Developer-only text (logs, the `?fps` meter, script output) stays in code.

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
- Commit messages are one brief line (e.g. `feat: add HUD and place sheets`), with no body.

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
- **Earn rate limit is built** as a per-job daily shift cap (`maxShiftsPerDay`, reset at midnight Lagos time) plus a per-client intent token bucket.
- **Abnormal-balance flagging (decided 2026-10-16: record only, no automatic penalty).** `BalanceWatch` (`apps/server/src/economy/balanceWatch.ts`) runs every 10 minutes and sums what each player received per ledger reason over the last 24 real hours, then compares it with `earningCeilings`, which derives the most the rules in `content/` allow (scaled by the `GAME_CLOCK` speed). Over-ceiling sums become `BalanceFlag` rows (one per player, currency, reason and Lagos day, keeping the worst amount) and a log line with no amounts. **Every reason without a ceiling has a ceiling of zero**, including `player_transfer` and future conversion legs: when you add a faucet, add its ceiling in `earningCeilings` or every use of it is flagged. There is no moderator view yet. The scan filters `Transaction` by `createdAt`, which has no index of its own (only `[reason, createdAt]`): fine now, add an index (a ledger schema change, so ask) before real load. In dev, the seeded test player is flagged for `starting_balance`, since it gets both the seed and the normal starting balance.
- **The ledger is append-only.** A trigger blocks UPDATE and DELETE on `Transaction`. Correct a mistake with a reversing entry, never an edit. Only tests TRUNCATE.
- **Money is `bigint`.** `JSON.stringify` throws on bigint. Send balances to the client as numbers (safe under the cap) or strings, and never do money maths in `number`.
- **No loans.** Player wallets cannot go negative, so credit, overdrafts, student loans and mortgages need their own liability model, not a negative wallet.

### Server and protocol
- **Every intent goes through `parseIntent`** in `DistrictRoom`'s single `onMessage("*")` handler, then through a per-player `KeyedMutex` so one player's intents run in order. Never add a message handler that skips either. The mutex is in-process: with several server instances it needs a database or Redis lock (Phase 5).
- **No auth (dev identity stub).** A client names itself with the `playerId` join option, accepted only when `NODE_ENV` is not `production`; in production nobody can join. Anyone can pose as anyone in dev. Auth, the 18+ gate and data-protection decisions need your approval before they are built.
- **Game state is in Postgres, not the room.** `PlayerState` (meters, rent due date, event check time), `Shift` and `EventFiring` hold everything that must survive a restart; rooms only hold positions. Hunger and energy are computed from a stored value plus elapsed real time.
- **Logging goes through `logError`** (`apps/server/src/log.ts`). It keeps only the class and code of Prisma errors, because their messages can echo query arguments (player ids, amounts, references). Never `console.error(error)` directly.
- **Scheduled jobs:** `startGameLoop` (every 30 s) pays finished shifts, expires unanswered requests and charges late rent fees for everyone, online or not. `startBalanceWatch` (every 10 min) raises balance flags. Random events are only evaluated for connected players (every 60 s, and caught up once on join).
- **Inbox (decided 2026-10-17).** Every notice to a player goes through `InboxService.deliver` (`apps/server/src/game/inbox.ts`): it stores an `InboxMessage` row and shows a toast if the player is connected. Never tell a player something with `client.send` or `NoticeBus.publish` directly, or an offline player never sees it. A notice a connected player saw as a toast is stored already read, so the HUD's unread badge counts only what they missed; the join catch-up runs before the toast subscription, so whatever happened while away lands as unread. The `openInbox` intent returns the latest 50 and marks them read. The text is stored as shown at the time (later copy changes do not rewrite old messages), and only the latest 50 per player are kept. No push or email yet, so a player only finds out by opening the game.
- **Power cuts and price rises are per player** in Phase 1 (stored per player), not per district. Revisit in Phase 5 when players share a district.
- **Unpaid rent costs late fees (decided 2026-10-17).** After the 3-day grace period, a late fee (N4,000, `rent.lateFee` in `ngn.json`) and -5 morale, then again every 7 days until the rent is paid. A player who cannot pay a fee is charged nothing and loses 10 morale instead (wallets never go negative). The next fee time is `PlayerState.lateFeeDueAt`; each fee is claimed by moving it on with a conditional update before the debit (reference `rent_late:<player>:<dueAt>`), so the room and the game loop cannot charge it twice, and a crash between claim and debit loses a fee in the player's favour. Paying rent resets it to the new due date plus the grace period. A player away for months comes back to every missed fee at once; there is no cap and no eviction yet. Eviction (and a credit-score effect abroad) replaces endless fees later, once housing is a system.
- **No intent for the bus stop.** It exists in `lagos.json` and answers `interact`, but nothing can be ridden yet; the bus fare is config only. The fuel station sells generator petrol through `buyItem` (`ShopService`).
- **Food and shop purchases use a random reference per intent** (`food:<player>:<uuid>`, `shop:<player>:<uuid>`). A crash after the debit but before the meter update would charge without feeding (or fuelling). Rare, and safe in the player's disfavour only by one purchase; fix by recording purchases in a table first if it ever matters.
- **The generator tank limit is checked outside the wallet lock,** relying on the per-player `KeyedMutex`. Money is always safe (the ledger locks), but two purchases that bypass the mutex could overfill the tank.
- **Capacity queue is a stub.** `CapacityQueue` (`apps/server/src/game/capacityQueue.ts`) holds a line with positions and is tested, but is not connected to matchmaking. Colyseus already refuses joins beyond `MAX_PLAYERS_PER_ROOM`, so nothing over capacity is accepted.
- **One district.** `DistrictRoom` always hosts `yaba`.
- **Collision is one shared function (decided 2026-10-15).** `moveWithCollisions` in `packages/shared/src/collision.ts` stops the player at building footprints and the district edge. The server runs it as the authority; the client runs the same code to predict its own walking, so they agree and there is no rubber-banding. Buildings are defined once in `content/cities/<city>.json` (`buildings`, `roads`); the client draws them from those numbers and receives them in the `district` message on join. `loadContent` refuses to start if a spawn or location is inside a building, a building sticks out of the district, or any location cannot be reached on foot from the spawn point (`checkLayout.ts`).
- **Rapier is not used for player movement.** Running a second physics engine on the client would disagree with the server's collision and cause snapping, and its WASM adds download and CPU cost on low-end phones. `@react-three/rapier` stays installed for later non-authoritative effects (props, ragdolls); it is not part of the walking path. Revisit if buildings stop being axis-aligned boxes.

### Content
- **Phase 1 numbers are placeholders.** Everything in `content/economy/`, `content/events/` and `content/cities/lagos.json` is marked `"basis": "game-balance"` instead of a `source` URL: starting balance, rent, food prices, shift pay, event amounts and frequencies are tuning guesses, not researched Lagos prices. Retune them after play-testing. Real rules (Phase 2) must use `source` plus `asOf`.
- **Copy (decided 2026-10-17): plain English with light Nigerian touches** ("chop", "wait small", "NEPA has taken light"); the flavour comes from specifics, not heavy Pidgin. A Pidgin version would be its own language file (`pcm.json`), not a mix. The client bundles `en.json` at build time (the welcome screen needs it before connecting), so changing copy needs a rebuild, not a code change. The browser imports it from `@japalife/shared/copy`, which has no zod, so the first download stays small; the schema runs at server boot and in `pnpm test`. Only English exists, and nothing picks a language yet.
- **Action prompts:** the button at a place shows its `prompt` from the city file ("Buy food at Mama Put"), or its kind's template from `copy/en.json` ("Work a shift at {place}").
- **Content is loaded once at boot** by `loadContent()` and handed to the game systems. Unknown fields are rejected, and cross-references (job sites, food vendors, fuel station items, event files per `GAME_EVENT_IDS`) are checked.
- **Meters (decided 2026-10-15, extended 2026-10-16):** hunger drains 4 points an hour, so a 45-point meal lasts about half a real day; a meal (the whole order) is refused with `already_full` if it would fill hunger more than `overeatAllowance` (10) past 100, so a full player cannot keep eating or farm morale from food (decided 2026-10-17); energy regenerates 6 an hour; morale drifts 1 an hour back towards 60, food lifts it, and events can lower it. Below 30 morale, energy recovers at half speed and a shift started then pays 80% (the pay is fixed on the `Shift` row when it starts). All in `content/economy/needs.json` and `content/events/`, marked TODO for tuning.
- **Power cuts (changed 2026-10-16):** they now last 6 hours and **no longer block work** (`blocksShifts: false`: offices run their own generators). Their effect is at night (19:00–06:00 Lagos, `night` in `lagos.json`): energy recovers at 25% unless the player's generator has fuel, which it burns only while it is both night and dark. Petrol costs N900 a litre and runs it 2 hours; the tank holds 12 hours. Morale -3 per cut.
- **Price rises (changed 2026-10-16) are permanent and compound:** about once a month, +3% on food. There are no pay rises yet, so over months of real time prices outrun wages. That needs pay rises (or job progression) before launch.
- **Black tax is a choice (decided 2026-10-17).** It no longer takes money: it creates an `EventChoice` row (amount, which `asks` text, a 48-hour `expiresAt`) and the HUD shows a card. Paying debits exactly the amount (reference `event:<choiceId>`) and raises family; declining costs morale and family, less if the player could not have paid (`declineBroke`); an unanswered request expires as a decline. Every answer and expiry first claims the row with a conditional update (`answer` still null), so double taps, two tabs and the expiry job cannot settle it twice. Only one request waits at a time. The card shows the money, never the stat changes. Expiry runs on join, at the room's event check, and in the 30-second game loop (under the player's mutex). The request and its outcome go to the inbox, but with no push, a player who does not open the game for 48 hours still misses it: revisit the window when push exists.
- **Family relationship** (0-100, starts at 60) only changes through black tax so far, and nothing reads it yet. The Phase 4 family-reunion chain will.
- **Meters are computed by cutting elapsed time into segments** (`needsAt` in `apps/server/src/game/needs.ts`) wherever night, a power cut, the generator's fuel or low morale starts or stops, so offline time is simulated exactly. Every code path that changes a meter must go through `PlayerService.applyChange` or `saveNeeds`, which bring all meters up to `now` first.

### Tooling
- **TypeScript is pinned to `~6.0`** because `typescript-eslint` does not support TS 7 yet. Revisit when it does.
- **`pnpm-workspace.yaml` `allowBuilds`:** `esbuild` is allowed; `prisma`, `@prisma/engines` and `msgpackr-extract` are declined. The first two are not needed (migrate and generate work). `msgpackr-extract` is an optional native speed-up for Colyseus with a JS fallback; revisit if message encoding shows up in profiling.
- **CI needs a Postgres service** for the ledger tests, and `DATABASE_URL` set.
- **Prisma 7's `migrate dev` does not regenerate the client.** After a schema change, run `pnpm db:generate` (or `pnpm install`), or the new models are `undefined` at runtime.
- **Client bundle (2026-10-16):** the page shell is ~175 KB gzipped; the game (three.js, R3F, Colyseus, zod) is a lazy `next/dynamic` chunk of ~335 KB gzipped. Whole first visit is ~470 KB over the wire. `pnpm budget` builds the client and fails above 15 MB, counting every static chunk, the HTML and `public/` (an upper bound: 1.85 MB raw, 0.53 MB gzipped on 2026-10-16; 1.86 MB raw on 2026-10-17 after the copy moved to content, which adds a ~4 KB gzipped chunk to the first visit while zod stays in the lazy game chunk). CDN city assets are outside the build and will need their own per-district budget. `@react-three/drei` and `@react-three/rapier` are installed but unused (drei's `Text` would download a font; signs are canvas textures instead).

### Client (`apps/client/game/`)
- **The camera always faces north** (no orbit). Up on the joystick or W walks away from the camera. A rotating camera needs a second touch control and has to rotate the input direction too; revisit if play-testers find it limiting.
- **Reconciliation is loose, not input-replay.** The server does not acknowledge move `seq`, so the client cannot replay unacknowledged inputs. Instead the prediction may lead the server by up to `MOVING_TOLERANCE` while walking, glides onto the server's spot when standing still, and snaps beyond `SNAP_DISTANCE` (`reconcile.ts`). Good enough for a non-competitive walk; revisit if players ever race or collide with each other.
- **Other players are not drawn** (Phase 1). `SnapshotBuffer` is ready for them: render each remote player at `sample(now - INTERPOLATION_DELAY_MS)`.
- **The touch joystick was play-tested on a vivo Y29 (2026-10-16) and felt fine.** It only appears on `(pointer: coarse)` devices.
- **FPS meter:** open the game with `?fps` (any build) for current fps, the lowest one-second fps and the longest frame after a 5 s warm-up, and the pixel ratio in use. Measure on a production build (`pnpm start:client`), since dev mode is slower. **Baseline (2026-10-16, vivo Y29, Chrome, production build): 60 fps (the screen's cap), low 60, worst frame 25 ms, dpr 1.50.** The scene is still only boxes and roads; re-measure on the same phone after any change that adds visual cost.
- **Use only APIs that work on plain http.** Phones open the dev and test builds at `http://<lan-ip>:3000`, which is not a secure context, so secure-only APIs (`crypto.randomUUID`, `navigator.clipboard`, service workers) are missing there and crash the page. Use `crypto.getRandomValues` instead of `randomUUID`.
- **Prices and pay reach the client in the `interaction` reply** (`describeOffer` in `apps/server/src/game/offers.ts`), computed with the same `priceWithRise` the purchase uses. The client has no copy of `content/`.
- **HUD countdowns use the server's clock** (the last `stats.serverTime` plus monotonic elapsed time), never the device clock. They tick at real speed between stats updates, so with `GAME_CLOCK` set they drift until the next update (at most 60 s, the event check).
- **The 18+ gate is a stub:** a self-declaration remembered in `localStorage`, no date of birth, nothing sent to the server, trivially bypassed. The real gate comes with sign-up (needs approval: auth and player data).
- **Server messages are buffered by `MessageBuffer`** (`connection.ts`) from the moment of joining, because stats arrive before React mounts the HUD and Colyseus drops messages with no handler. Register new HUD message types there, not with a late `room.onMessage`.

## Look-ahead: what to consider in later phases

- **Phase 1 (finish):** keep earn amounts, rent and food prices in `content/economy/`, not code. Build the clock before the rent timer: a server time source with the dev-only multiplier, and timers stored as timestamps (see "Game time is real time" under Realism rules).
- **Phase 2, documents and applications:** tell players about decisions, requests for more documents and expiries through `InboxService.deliver`, so they reach players who are offline. Fees are sinks, so add reasons such as `document_fee` and `application_fee`. Roll visa decisions on the server with a logged seed so a result can be audited. Persist application state in the database (waits can last game-months). Funds "held long enough" can be computed from the ledger's running balances; add an index on wallet and `createdAt` if that query is slow.
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
| 4 | Server game systems | The server clock (with the dev-only time multiplier), `DistrictRoom` handlers that call `parseIntent`, and separate modules for jobs, rent, food and events, plus the earn rate limit. Capacity queue stub | Done (`apps/server/src/game/`, `rooms/DistrictRoom.ts`; migration `add_player_game_state`) |
| 5 | Client | Walkable low-poly Lagos district, third-person controller with keyboard and touch joystick, interpolation, HUD (wallet, hunger, rent countdown, event toasts), 18+ gate stub, disclaimer | Done (scene, controls, prediction and reconciliation in `apps/client/game/`; HUD, place sheets and toasts; 18+ gate stub and disclaimer in `apps/client/app/Welcome.tsx`). Play-tested on a vivo Y29 |
| 6 | Hardening | 15 MB budget check, fps check on a mid-range Android, abnormal-balance flagging, log hygiene | Done (`pnpm budget`, `?fps` meter, `BalanceWatch` with migration `add_balance_flags`, `logError`). Measured on a vivo Y29: 60 fps, low 60 (see Known limits, Client); joystick play-tested and fine |
| 7 | Stats and time | Morale and family-relationship stats; low morale slows energy recovery and cuts shift pay; day/night on Lagos time with "Day N · 7:45 PM" in the HUD; power cuts slow night-time energy recovery unless the player runs a generator, with petrol bought at the fuel station (`buyItem` intent); price rises permanent and compounding; morale bar | Built (`needs.ts`, `prices.ts`, `shop.ts`, night helpers in `clock.ts`; migration `add_morale_family_generator`). Play-tested on the phone 2026-10-17; fullness limit added after |
| 8 | Event choices | Events that ask the player to choose, stored in the database so a choice survives going offline; black tax becomes pay (money down, family up) or decline (morale and family down); an `answerEvent` intent and an event card with buttons in the HUD | Built (`choices.ts`, `EventCard.tsx`, migration `add_event_choices`, `pnpm fire-event`). Play-tested on the phone 2026-10-17 |
| 9 | Copy in content | Every player-facing string (welcome screen, HUD labels, refusals, place sheets, notices) moves into `content/`; action prompts such as "Buy food at Mama Put" | Built (`content/copy/en.json`, `copySchema`, `COPY` and `fill` in `@japalife/shared/copy`, `placePrompt`). Play-tested on the phone 2026-10-17 |
| 10 | Inbox and late rent | The two decisions due before Phase 2: an in-app inbox so offline players learn what happened, and what unpaid rent does (weekly late fees and morale after the grace period) | Built (`inbox.ts`, `InboxPanel.tsx`, `openInbox` intent, late fees in `rent.ts`, migration `add_inbox_and_late_fees`). Play-tested on the phone 2026-10-17 (late fee charged once, toast and inbox, paying rent reset the schedule) |

Slice 10 settles the open decisions CLAUDE.md required before Phase 2. Slices 7–9 come from the original Phase 1 brief (events with choices, morale, a mobile-first HUD, copy in content), which Slices 0–6 had narrowed. Design decisions for them (2026-10-16): low morale slows energy recovery and pays less per shift; family relationship has no mechanical effect yet and is read by the Phase 4 family-reunion chain; price rises are permanent and compound, about once a month; the HUD clock is Lagos time, with days counted from when the player started.

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
