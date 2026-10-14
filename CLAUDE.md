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
- `pnpm test`: run all tests (Vitest; the server tests boot a real Colyseus server on port 2599)
- `pnpm lint`: ESLint across the repo
- `pnpm typecheck`: `tsc` in every workspace package
- Run lint, typecheck and test before considering any task done
- `docker compose up -d`: local Postgres (5432) and Redis (6379). Not needed yet; nothing uses them until the ledger lands
- `pnpm db:migrate` / `pnpm db:seed`: Prisma. The schema has no models yet, so these do nothing useful until the ledger schema is approved and written

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

## How to work in this repo
- Work in phases. Finish and verify the current phase before starting the next one.
- After a change: run typecheck, lint, and tests. For gameplay changes, describe how to try it manually.
- Ask before adding a new dependency or changing the stack.
- Ask before any change that touches auth, payments, or the ledger schema.

## Current phase

**Phase 1: Lagos single-player core loop.** One walkable Lagos district, a third-person character with touch + keyboard controls, one job that pays per shift, rent due on a timer, food to buy, black-tax and power-cut events, and an NGN wallet backed by the ledger. Server-authoritative from the start, but no other players visible yet.

<!-- Phases to come:
  2 Documents + applications: passport and document quests, UK and Canada routes from config, decision rolls and refusals
  3 Funds and departure: japa sales, ajo, multi-currency wallets and conversion, packing, flight
  4 Abroad: London (UK) and Toronto (Canada), settling in, jobs, credit score, remittances, family reunion
  5 Multiplayer presence + chat + advice board
  6 Long game: mortgages, permanent status, citizenship; launch prep (load testing, queue, moderation, payments) -->

## Open decisions
- [x] 3D with React Three Fiber, low-poly art style (decided 2026-10-14). Not 2D isometric.
- [x] Release 1 cities: London (UK) and Toronto (Canada) (decided 2026-10-14)
- [ ] Hosting for the game servers
