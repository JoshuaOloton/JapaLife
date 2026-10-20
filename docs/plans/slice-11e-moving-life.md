# Plan: Slice 11e, "Moving life"

Approved 2026-10-20. Part of [Slice 11](slice-11-look-and-feel.md). As built, the pure modules are `trafficSim.ts` and `walkers.ts` (not `traffic.ts` and `pedestrians.ts`, which clash with `Traffic.tsx` and `Pedestrians.tsx` on a case-insensitive disk).

## Context

After 11c and 11d Yaba looks right but stands still: the only movement is you. 11e makes the street move: danfos, keke, okadas and tokunbo cars driving the two roads, and people walking the roadsides, as planned in [Slice 11](slice-11-look-and-feel.md). Everything here is **client-only and cosmetic** (decided in the Slice 11 plan): it is not synced, it never blocks the player, vehicles stop for the player rather than hit them, and pedestrians walk through you. Phase 5 decides whether to sync any of it.

Decided 2026-10-20:
- **Vehicles: the Kenney Car Kit** (free, CC0), which you download. Its van, painted danfo yellow with a black stripe, is the danfo; its sedan, SUV, hatchback and taxi are the tokunbo cars. Keke and okada are built in code from boxes (the kit has neither). 11f swaps in our own Blender models.
- **Okada riders are box figures**, part of the code-built bike, so every okada shares one draw call.
- **Traffic follows the Lagos clock**: busy by day, more danfos at rush hours (about 7–9 am and 5–8 pm), about a third of everything late at night.

Branch `feat/moving-life` from `feat/customisation` (11c and 11d are not merged yet).

**Step 0 (you):** download the Kenney Car Kit and unzip it to `assets/vendor/kenney-car/`. I confirm the file names on disk before wiring them (expected under `Models/GLB format/`: `van`, `sedan`, `suv`, `hatchback-sports`, `taxi`).

## Game-dev choices (made, briefly why)

- **A tiny traffic simulation per vehicle**: a lane is a line along the road, and a vehicle is its distance along it plus a speed. Each frame it eases toward its target speed:
  - it slows over speed bumps and stops behind the vehicle ahead;
  - it stops when you stand in its path;
  - it waits its turn at the junction (one vehicle in the junction box at a time);
  - danfos pause at the bus stop.

  This is a few lines of arithmetic per vehicle, with no physics engine (Rapier stays out of movement).
- **Right-hand traffic**, as in Nigeria: eastbound on the south half of the main road, northbound on the east half of the cross road.
- **Instancing with moving matrices**: every copy of a car model is one instanced mesh whose positions are rewritten each frame. All the code-built vehicles (keke, okada and rider) are a second moving instanced box mesh, so all of them together cost **one draw call**.
- **Danfo paint without a new texture**: the same trick as the window glass. The van's body-paint cell on its colour sheet is flagged at load, and the shader paints it yellow, with a black band at stripe height. The cell is found by measuring, like the glass.
- **Pedestrians reuse the 11d character**, with random starter appearances (seeded, so the same people every visit), walking loops at walking pace with the walk clip.
  - Each costs about 4 draw calls, so anyone beyond 40 m is hidden, and beyond 30 m their animation stops.
  - At most 8 people. They walk through you, but pause if you stand right in front of them.
- **Time of day** comes from the server clock already in the scene (`StreetState`). Each vehicle and pedestrian has a fixed hash, and is out when its hash is below the hour's share. A vehicle going "off duty" finishes its run off the map rather than vanishing.
- **Adaptive quality**, as planned: if the one-second low fps stays under 30 for 5 s, traffic and pedestrians drop to half, once. It shows in the `?fps` meter.

## Content (`packages/shared/src/content.ts`, `content/`)

- **New `content/traffic/kinds.json`** (+ README), validated by `vehicleKindsSchema`. Each kind:
  - `look`: `{ model, scale, paint? }` for Car Kit models, or `{ built: "keke" | "okada", halfLength, halfWidth, height, colour }`;
  - `speed` (m/s, by kind: okada fastest, danfo slowest);
  - `length`, for the gap behind it;
  - `stopsAtBusStops` (danfo only).
- **District `traffic`** in `lagos.json`:
  - `lanes`: `{ id, points[] }`, running past the district edge so vehicles enter and leave off-screen;
  - `fleet`: `{ kind, lanes[], count }`;
  - `busStops`: `{ lane, at }`, the danfo stop beside the bus stop;
  - `pedestrians`: `{ count, walkways: [{ id, points[], loop }] }`.

  This is visual data, but it lives in the layout so the server checks it and the client has no copy of `content/`.
- **Schedule** (`traffic.schedule` in `kinds.json`): the share out by hour for each kind (night ≈ 0.35, day ≈ 0.8, rush 1.0 for danfos).
- **`buildDistrictLayout`** adds the vehicle kinds and Car Kit models the district uses (`vehicleKinds`, `models`).

## Server (content checks only; nothing runs server-side)

`loadContent` / `checkLayout`:
- every fleet kind and lane exists; every model kind is in the model catalog;
- **lanes stay on roads**: points are sampled every metre and must be inside a road, except beyond the district edge;
- **walkways stay walkable**: sampled points are inside the district and outside every obstacle (`districtObstacles`), so nobody walks through a wall, a generator or Mama Put. They may cross roads;
- bus stops sit on their lane.

## Pipeline

- `build.mts` adds the Car Kit models (folder `vehicles/`) to `STATIC_MODELS`.
- It adds a `paint` field next to `windows` in the catalog: the van's body-paint cell, measured from its colour sheet and checked by eye.
- Run `pnpm assets`.

## Client (`apps/client/game/world/`)

- **`traffic.ts`** (pure, tested):
  - lane geometry (position and heading at a distance along a lane);
  - `stepVehicle` (target speed, bumps, gap to the vehicle ahead, stop for the player, junction turn-taking, bus-stop pause, wrap or park at the lane end);
  - the share by hour (`activeShare(kind, hour)`).
- **`Traffic.tsx`**:
  - one moving instanced mesh per Car Kit model mesh;
  - one moving instanced box mesh for every built vehicle's parts (`vehicleShapes.ts`, pure: keke cab and canopy, okada bike and box rider in a vest);
  - the danfo paint through `windowGlass.ts`, generalised to flag any UV cell (`flagUvCells`).
- **`Pedestrians.tsx`** + **`pedestrians.ts`** (pure: walk-loop positions, pause in front of the player):
  - seeded starter appearances through `resolveLook`;
  - visibility and animation cut-offs, as for the NPCs.
- **`quality.ts`** (pure, tested): the one-way governor, fed from the frame loop; `World.tsx` passes its scale to `Traffic` and `Pedestrians`.
- **`FpsMeter.tsx`**: show the quality level.

## Performance

- **Draw calls on the phone:** today about 24.
  - Add about 5–8 for the visible Car Kit models, 1 for all built vehicles, and about 12–20 for the 3–5 pedestrians in view.
  - That makes about 45–55, under 80. Adaptive quality halves the moving part if a phone struggles.
- **Download:** about 100–150 KB for the Car Kit models (estimate, measured after `pnpm assets`).

## Tests

- **Shared/server:**
  - the vehicle-kind and traffic schemas;
  - a lane off the road refused;
  - a walkway through a building or a prop refused;
  - unknown kinds or lanes refused;
  - the real `lagos.json` passes.
- **Client:**
  - `stepVehicle`: drives along and wraps; keeps its gap; stops for a player ahead and sets off again; waits for an occupied junction; slows at a bump; a danfo pauses at the bus stop; an off-duty vehicle parks at the lane end;
  - `activeShare` by hour;
  - pedestrian loop positions and the pause;
  - built vehicle parts stay inside their kind's size;
  - the quality governor drops after 5 s low and only once.

## Docs

- `docs/known-limits.md`, Client:
  - traffic and pedestrians are client-only: each phone sees its own traffic until Phase 5;
  - no headlights or sound yet;
  - the danfo is a painted van until 11f;
  - the new draw-call baseline.
- CLAUDE.md:
  - 11e row status;
  - `content/traffic/` in the repo layout;
  - `kenney-car/` in the `pnpm assets` pack list.

## Verification

- `pnpm assets`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm budget`; restart the server and `next dev`.
- Phone (vivo Y29, `pnpm start:client`, `?fps`). "Good" means:
  - danfos, kekes, okadas and cars drive on the right, ease over speed bumps, queue rather than overlap, and take turns at the junction;
  - a danfo pauses at the bus stop;
  - stand in the road and traffic stops for you, then moves off when you step aside;
  - people stroll the roadsides in varied clothes;
  - at night (`GAME_CLOCK`) the street is much quieter;
  - fps stays near 60 with draw calls under 80.
