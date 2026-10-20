# Plan: Slice 11c, "Street life, static"

Approved 2026-10-19. Part of [Slice 11](slice-11-look-and-feel.md).

## Context

11b made Yaba's buildings look like Lagos, but the streets between them are empty: tarred roads, gutters, and nothing else. 11c fills them with things that stand still: props (generators, kiosks, electric poles with sagging wires, trees, billboards, speed bumps, hawker tables and umbrellas) and a cast of static NPCs (Mama Put, two okada riders, a hawker, a gateman, a danfo conductor shouting his route). Anything solid must block the player exactly where it is drawn, on the server and in the client's prediction, so collision moves from "the buildings" to one shared obstacle list.

Decided 2026-10-19:
- **Static NPCs block the player**, like a generator does (a small box each). 11e's walking pedestrians and traffic stay pass-through and client-only.
- **The okada riders wait on a bench** under an umbrella at the junction, chatting. Their bikes are parked next to them in 11f, when the okada model exists.

Branch: `feat/street-life`, from `main` (11b is merged, PRs #15 and #16).

## Game-dev choices (made, briefly why)

- **Lagos-specific props are built in code from boxes, not downloaded.** The free packs have no generators, kiosks, containers, electric poles, palms or hawker tables. Built from the world's existing single instanced `Boxes` draw call (`world/Boxes.tsx`), they cost **zero download and zero extra draw calls**. 11f can swap any of them for a Blender model through its kind entry.
- **Generic props come from packs we already have:** Kenney Suburban `tree-large`, `tree-small`, `planter`; KayKit `bench`, `trash_A`; Kenney Commercial `detail-parasol-a/b` (hawker umbrellas). No new pack, no new dependency.
- **Instancing per prop kind:** every copy of a model prop is drawn by one `InstancedMesh` per mesh of that model, so 12 trees cost the same as one.
- **NPCs reuse the 11a `Character`** with a fixed looping clip ("pose") instead of the movement state machine. Each person is 4 draw calls and one animation mixer, so NPCs further than ~30 m from the player stop updating their mixer (a cheap LOD: **level of detail**, doing less work for things far away).
- **Wires are one `LineSegments` draw call** for the whole district, sagging between poles in a few straight pieces.

## Content and schemas (`packages/shared/src/content.ts`)

**Prop kinds**, new hand-written `content/props/kinds.json` (+ README), validated by `propKindsSchema`, loaded by `loadContent`:
```
{ id, look: { model: <catalog id>, scale } | { built: BuiltShape, halfWidth, halfDepth, height },
  blocks: "footprint" | "none" | { halfWidth, halfDepth } }
```
- `BuiltShape` (shared enum): `generator`, `kiosk`, `container_shop`, `electric_pole`, `palm`, `billboard`, `hawker_table`, `plastic_chair`, `speed_bump`.
- `blocks: "footprint"` = the drawn footprint (catalog-measured × scale for models, the declared size for built shapes), so nothing is typed twice. An explicit box is for things whose base is smaller than their top (a tree or palm trunk, a pole, a billboard's posts). `"none"` for speed bumps, umbrellas and wires overhead.
- A model kind with `"footprint"` gets the same fill check as buildings (`modelFootprintProblem`, generalised to take a box + scale + rotation).

**Placements** in `lagos.json`, district gains:
- `props: [{ kind, x, z, rotation (0/90/180/270), label?, wire? }]`: `label` is the painted text on a billboard or kiosk; `wire` groups poles that share a line (wired in listed order).
- `npcs: [{ id, look, pose, x, z, facing, says? }]`: `look` is an id in a shared `NPC_LOOK_IDS` enum (colour presets live client-side in `game/world/npcLooks.ts` until 11d's catalog replaces them); `pose` ∈ `idle`, `talk`, `fold_arms`, `sit`, `sit_talk`, `call`; `says` is the speech-bubble line. Bubble lines and billboard text are place flavour, so they stay in `lagos.json` (per CLAUDE.md, place text lives in its content file, not `en.json`).
- Shared constant `NPC_HALF_SIZE` (0.3 m): each NPC's blocking box.

**Layout:** a new shared `buildDistrictLayout(config, models, propKinds)` (moved out of `apps/server/src/game/district.ts`) returns the config plus only the catalog entries and prop kinds it uses. `DistrictLayout` gains `propKinds`. The server's `DistrictMap` and `loadContent` both call it, so the check and the game see the same thing.

## Shared collision (`packages/shared/src/collision.ts`)

- New `districtObstacles(layout): Box[]` = buildings + blocking props (box turned for 90/270) + one `NPC_HALF_SIZE` box per NPC.
- **Every** caller switches to it: `DistrictMap` computes it once in its constructor and `move` uses it; `Player.tsx` memoises it and passes it to `moveWithCollisions` and `reconcile`; `checkLayout` uses it for the spawn, place and reachability checks. Nothing passes `district.buildings` as boxes any more.

## Server

- `apps/server/src/content/loadContent.ts`: load `props/kinds.json`; check every placed kind and model exists, the model-fill check for `"footprint"` model kinds, `built` kinds have no model and vice versa.
- `apps/server/src/content/checkLayout.ts` takes the layout, and adds:
  - a blocking prop or NPC sticking out of the district, on a road, or covering the spawn or a place (the existing reachability check then catches anything walling off a place, since it now flood-fills around props and NPCs too);
  - duplicate NPC ids; a `wire` group with fewer than two poles.
- `apps/server/src/game/district.ts`: use `buildDistrictLayout` and `districtObstacles`.

## Asset pipeline (`apps/client/scripts/assets/build.mts`)

- Generalise `BUILDINGS` into a model list with an output folder: buildings to `buildings/`, props to `props/` (same flatten/join/centre/KTX2/Draco path, same catalog entry). Run `pnpm assets` to regenerate `content/models/catalog.json`.
- Add NPC clips to `CLIPS`: `sit` (`Sitting_Idle_Loop`), `sit_talk` (`Sitting_Talking_Loop`), `talk` (`Idle_Talking_Loop`), `fold_arms` (`Idle_FoldArms_Loop`, UAL2), `call` (`Idle_Rail_Call`, UAL2; check it reads as a conductor calling out, else use `talk`). Rotation-only tracks, as the rule requires.

## Client (`apps/client/game/`)

- `world/propShapes.ts` (pure, tested; not `props.ts`, which clashes with `Props.tsx` on a case-insensitive disk): `builtPropSlabs(placement, kind) -> Slab[]` per built shape (generator: body, tank, exhaust; kiosk: box, counter, zinc roof; container: long box in container colours; pole: thin post + crossbar; palm: segmented trunk; billboard: two posts + frame; hawker table, plastic chair (white or blue), speed bump: low yellow-and-black slabs), and `wireSegments(placements)` (sagging catenary, ~6 pieces per span).
- `world/Props.tsx`: built shapes go into the world's single `Boxes` call (appended in `World.tsx`'s `slabs`); model kinds render as one `InstancedMesh` per mesh per kind (Suspense + `ModelBoundary`, appear after the first frame like building models, Lambert materials like `cheapCopy`); palm fronds are one instanced draw call; billboard and kiosk faces use the canvas painter (move `paintSign` from `World.tsx` to `world/paint.ts` and reuse it); wires are one `LineSegments`.
- `world/Npcs.tsx` + `world/npcLooks.ts`: a `Character` per NPC at its spot and facing, with `pose` set. `Character`/`CharacterAnimator` gain an optional fixed `pose` clip that bypasses the walk/run/work state machine. Mixer updates only within `NPC_ANIMATION_RANGE` (~30 m) of the player's predicted position. The conductor's `says` is a small painted bubble shown when the player is within ~10 m.
- `FpsMeter.tsx`: also show draw calls and triangles (`renderer.info`), so the budget (< 80 draw calls) can be read on the phone.

## Yaba layout (`content/cities/lagos.json`), for review

- **Electric poles** along both sides of both roads, every ~12 m, wired; **speed bumps** each side of the junction.
- **Generators**: one caged beside the office block, one by each flats block, one at the buka.
- **Kiosks / container shops** along the main road (a recharge-card kiosk, a provisions container), with painted labels.
- **Junction:** a bench under an umbrella with the **two okada riders** (`sit_talk`).
- **Bus stop:** a hawker at a table with an umbrella (`idle`), the **conductor** (`call`, says "Oshodi! Obalende! Enter with your change!").
- **Office:** the **gateman** on a plastic chair by the gate (`sit`).
- **Buka:** **Mama Put** behind her counter (`talk`), plastic chairs and a table out front.
- **Trees:** palms and mango-shaped trees (Kenney trees, tinted greener) in the compounds and corners, a few planters.
- **Billboards** (2–3, made-up brands only): "ChopRite Noodles", "Eko Breeze Table Water", "BrightLight Inverters: NEPA no fit stop you". Names and lines to be checked.

## Tests

- Shared: `districtObstacles` includes buildings, blocking props (turned box for 90/270), explicit trunk boxes and NPC boxes, and skips `"none"`; `moveWithCollisions` with the obstacles stops at a generator and an NPC.
- Server: `DistrictMap.move` stops at a prop (same numbers as the shared test, so server and client provably agree); `checkLayout` refuses a prop on the spawn, on a place, walling off a place, a blocking prop on a road, an NPC on a road, duplicate NPC ids, a lonely wire pole; `loadContent` refuses an unknown kind or model and a model prop that doesn't fill its footprint; the real `lagos.json` passes.
- Client: `builtPropSlabs` stays within each kind's declared footprint (so the drawn shape never pokes past its collision box), and `wireSegments` connects only poles in the same group, in order.

## Docs

- `docs/known-limits.md`, Client: props and NPCs (built shapes vs models, static NPCs block, mixers frozen beyond 30 m, NPC looks are presets until 11d, bubble and billboard text in `lagos.json`), the new draw-call baseline.
- CLAUDE.md: 11c row status; add `content/props/` to the repo layout; one rule under "World and collision": "Collision boxes come from `districtObstacles(layout)`, never `district.buildings`."

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm budget` (Postgres up for the ledger tests).
- Restart `next dev` and the server (shared and content changed).
- Play-test on the vivo Y29 with `pnpm start:client` and `?fps`: walk into a generator, a pole, a palm trunk and Mama Put: you stop flush at each, with no snap back (server and prediction agree). Walk under umbrellas and over speed bumps freely. The conductor's bubble appears as you approach the bus stop. Okada riders sit on the bench, not floating or sunk. Good = still ~60 fps, draw calls under 80, and the street reads as busy Yaba at a glance.
