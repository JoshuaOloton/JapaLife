# Phase 1 (done)

Moved out of CLAUDE.md, which links here. The record of what Phase 1 built and when.

**Phase 1: Lagos single-player core loop.** One walkable Lagos district, a third-person character with touch + keyboard controls, one job that pays per shift, rent due on a timer, food to buy, black-tax and power-cut events, and an NGN wallet backed by the ledger. Server-authoritative from the start, but no other players visible yet.

## Phase 1 slices

"Slice 3" and similar with no phase number mean this table.

| # | Slice | What it covers | Status |
|---|---|---|---|
| 0 | Scaffold | pnpm workspace, tooling, Colyseus connect demo | Done |
| 1 | Shared contracts | Zod intent schemas (`move`, `interact`, `work`, `buyFood`, `payRent`), ledger reasons, event ids in `packages/shared` | Done |
| 2 | Ledger and NGN wallet | Prisma schema and migration, `Ledger`, `WalletService`, concurrency tests, seeded test player | Done |
| 3 | Content config | Zod schemas in `packages/shared` and a server loader that validates `content/` JSON at boot (refuse to start on a bad file). Files Phase 1 needs: shift pay and starting balance, rent, food and other NGN prices, the black-tax and power-cut events, and `cities/lagos.json` (one district). No visa rules yet (Phase 2). Amounts are integers in kobo | Done (schemas in `packages/shared/src/content.ts`, loader in `apps/server/src/content/loadContent.ts`; all values are placeholder game-balance numbers, see [known-limits.md](known-limits.md#content)) |
| 4 | Server game systems | The server clock (with the dev-only time multiplier), `DistrictRoom` handlers that call `parseIntent`, and separate modules for jobs, rent, food and events, plus the earn rate limit. Capacity queue stub | Done (`apps/server/src/game/`, `rooms/DistrictRoom.ts`; migration `add_player_game_state`) |
| 5 | Client | Walkable low-poly Lagos district, third-person controller with keyboard and touch joystick, interpolation, HUD (wallet, hunger, rent countdown, event toasts), 18+ gate stub, disclaimer | Done (scene, controls, prediction and reconciliation in `apps/client/game/`; HUD, place sheets and toasts; 18+ gate stub and disclaimer in `apps/client/app/Welcome.tsx`). Play-tested on a vivo Y29 |
| 6 | Hardening | 15 MB budget check, fps check on a mid-range Android, abnormal-balance flagging, log hygiene | Done (`pnpm budget`, `?fps` meter, `BalanceWatch` with migration `add_balance_flags`, `logError`). Measured on a vivo Y29: 60 fps, low 60 (see [known-limits.md, Client](known-limits.md#client-appsclientgame)); joystick play-tested and fine |
| 7 | Stats and time | Morale and family-relationship stats; low morale slows energy recovery and cuts shift pay; day/night on Lagos time with "Day N · 7:45 PM" in the HUD; power cuts slow night-time energy recovery unless the player runs a generator, with petrol bought at the fuel station (`buyItem` intent); price rises permanent and compounding; morale bar | Built (`needs.ts`, `prices.ts`, `shop.ts`, night helpers in `clock.ts`; migration `add_morale_family_generator`). Play-tested on the phone 2026-10-17; fullness limit added after |
| 8 | Event choices | Events that ask the player to choose, stored in the database so a choice survives going offline; black tax becomes pay (money down, family up) or decline (morale and family down); an `answerEvent` intent and an event card with buttons in the HUD | Built (`choices.ts`, `EventCard.tsx`, migration `add_event_choices`, `pnpm fire-event`). Play-tested on the phone 2026-10-17 |
| 9 | Copy in content | Every player-facing string (welcome screen, HUD labels, refusals, place sheets, notices) moves into `content/`; action prompts such as "Buy food at Mama Put" | Built (`content/copy/en.json`, `copySchema`, `COPY` and `fill` in `@japalife/shared/copy`, `placePrompt`). Play-tested on the phone 2026-10-17 |
| 10 | Inbox and late rent | The two decisions due before Phase 2: an in-app inbox so offline players learn what happened, and what unpaid rent does (weekly late fees and morale after the grace period) | Built (`inbox.ts`, `InboxPanel.tsx`, `openInbox` intent, late fees in `rent.ts`, migration `add_inbox_and_late_fees`). Play-tested on the phone 2026-10-17 (late fee charged once, toast and inbox, paying rent reset the schedule) |

Slice 10 settles the open decisions CLAUDE.md required before Phase 2. Slices 7–9 come from the original Phase 1 brief (events with choices, morale, a mobile-first HUD, copy in content), which Slices 0–6 had narrowed. Design decisions for them (2026-10-16): low morale slows energy recovery and pays less per shift; family relationship has no mechanical effect yet and is read by the Phase 4 family-reunion chain; price rises are permanent and compound, about once a month; the HUD clock is Lagos time, with days counted from when the player started.
