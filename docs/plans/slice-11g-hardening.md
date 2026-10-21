# Slice 11g: Hardening

Approved 2026-10-21. Branch `feat/hardening`, made from 11f-4 (it carries the unpushed 11f-2/3/4 and wardrobe commits).

## Context

Slice 11 (look and feel) is built: 11a–11f plus the wardrobe screen. 11g is its last part, before Phase 2. Its job, from the [Slice 11 plan](slice-11-look-and-feel.md): keep the vivo Y29 at 60 fps with draw calls under 80, enforce the asset budgets (Yaba ≤ 6 MB, characters ≤ 1.5 MB), and bring the docs up to date.

11f-4 showed why this matters. A runtime shader compile froze the phone for 2.8 s, and only the fps meter caught it, after the change was already on the phone. 11g turns the budgets and the performance rules into checks that run before anything ships, and fixes two bugs found along the way.

Measured before 11g (2026-10-21):
- vivo Y29: low 60, worst frame 24 ms, 26 draw calls, 35.1k triangles.
- Downloads: characters 0.67 MB (budget 1.5), Yaba's buildings, props and vehicles about 0.34 MB (budget 6). The budgets are not threatened yet; they are enforced so later cities can't drift past them.

## 1. Asset budgets, enforced

- **Per district (content check, `apps/server/src/content/loadContent.ts`):** each district's download is the sum of `bytes` in its `buildDistrictLayout(...).models`: the models it places, plus every hair part and garment piece. The server refuses to start, and the content tests fail, above `DISTRICT_DOWNLOAD_BUDGET_BYTES` (6 MB, in `packages/shared`).
- **Characters (`apps/client/scripts/checkBudget.mts`, run by `pnpm budget`):** the sum of `public/assets/characters/` must be ≤ 1.5 MB.
- Tests:
  - the check refuses a district over budget;
  - the real content passes.

## 2. Performance rules, enforced

- **Meter warnings (dev aid, `FpsMeter.tsx` / `fps.ts`):**
  - `⚠ late shaders N` when any shader compiled after warm-up;
  - `⚠ calls` when a frame went over 80 draw calls.
  - Pure counting in `fps.ts`, unit-tested.
- **Shader warm-up at load:** after the world first renders, `renderer.compileAsync(scene, camera)` compiles every material in the scene before warm-up ends, instead of the first time each comes into view.
- **A guard against runtime shader switches:** a unit test that building and body materials each share one program cache key, so fading and printing change uniforms only.

## 3. Bugs to fix

- **Adaptive quality halves the street after you switch apps.** `QualityGovernor` saw a hidden tab's gap as more than 5 s of low fps. Add `pause()` on `visibilitychange`, plus a test.
- **Night can only be tested by waiting.** Add `GAME_CLOCK_START=21:00`, dev-only like `GAME_CLOCK` and refused when `NODE_ENV=production`:
  - the game clock starts at the next 21:00 in the city's time zone and runs from there at `GAME_CLOCK` speed;
  - it moves time forward only (at most 24 h), so stored timers never lie in the past.

## 4. Docs

- CLAUDE.md:
  - the slice table, "Up next" and the current phase (Slice 11 done, Phase 2 next);
  - the `GAME_CLOCK_START` command;
  - the budget rule.
- `docs/known-limits.md`:
  - the new baseline;
  - the budget checks;
  - the governor fix;
  - shader warm-up;
  - remove what is no longer true.

## Play-test checklist (vivo Y29, `pnpm start:client`, `?fps`)

1. **Night** (with `GAME_CLOCK_START=21:00`): windows glow on every building, and the street is bright enough to walk.
2. **Power cut:** `pnpm fire-event power_cut <playerId>`; windows go dark except those on generators.
3. **11c review:** the billboard brand names and the conductor's line read well; the conductor's bubble shows as you near the bus stop; the okada riders sit on the bench, not floating or sunk.
4. **Character animations (11a):** idle, run, work at the office during a shift, and a gesture when you open a place.
5. **App switch:** switch to another app for 10 s and back; "street" stays at 100% and worst frame stays low.
6. **Numbers:** low ~60, worst < 50 ms, draw calls < 80, no "late shaders" warning.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (with Postgres up), `pnpm budget`.
- `GAME_CLOCK_START=21:00`: the HUD shows about 9 pm on join; with `NODE_ENV=production` the server refuses to start.
- Desktop Chrome `?fps`: no "late shaders" after warm-up while walking the district and opening the wardrobe; hiding the tab for 10 s leaves "street 100%".
