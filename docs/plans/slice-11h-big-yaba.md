# Plan: Slice 11h, "Big Yaba"

Approved 2026-10-21. Part of [Slice 11](slice-11-look-and-feel.md), after 11f and before 11g. Not started. Its first step is the street plan file (11h-2), but the spatial grid (11h-1) can be built first because it needs no new content.

## Context

Yaba today is a 120 m square (`halfWidth/halfDepth: 60` in `content/cities/lagos.json`). It has 9 buildings, 75 props, 5 places and two roads that cross. That is a street corner, not a neighbourhood. 11h grows it to **about 600 m square** (`halfWidth/halfDepth: 300`). The 60 fps and asset budget on the vivo Y29 must hold. Everything is designed so going past 1 km later is a content change, not a rewrite.

The current code assumes a small district:
- **Collision has no spatial index.**
  - `isBlocked` scans every obstacle on every sub-step (`packages/shared/src/collision.ts`).
  - `reachableTargets` flood-fills a 0.5 m grid and scans every obstacle per cell. At 600 m that is about 1.44M cells times every box, at server start.
  - `DistrictMap.nearest` (`apps/server/src/game/district.ts`), the client's `nearestPlace`, and `checkLayout`'s `onRoad` and walkway sampling are linear scans too.
- **No area-of-interest.**
  - `DistrictState` syncs every player to everyone.
  - The whole layout goes out in one `district` message on join (`DistrictRoom.ts`).
- **The client draws everything.**
  - One `Boxes` InstancedMesh whose single bounding sphere covers the district, so frustum culling is all or nothing.
  - One cloned model per building, each its own draw call.
  - One 512 px ground texture for the whole district: about 1.7 m per pixel at 600 m.
  - Fog runs from 50 to 140 m, with camera `far` 150.
- **Schema caps.** Pedestrians ≤ 12 and fleet groups ≤ 20 (`content.ts`, `trafficSchema`).

Decided 2026-10-21:
- **A stylised street plan, not OpenStreetMap.**
  - OSM data is under the ODbL. Attribution is easy, but our generated city file goes to every client, so it would be a publicly used derivative database. We would then have to offer our city data under the ODbL too.
  - OSM's Yaba is also curved and diagonal, while our roads, collision boxes and building rotations are axis-aligned with quarter turns.
  - So we use the real street names (facts, not anyone's database) on a straightened grid that reads as Yaba to a Lagosian.
- **The landmark list below is accepted.**
- Businesses get generic names (no brands).
- The psychiatric hospital is left out: "Yaba Left" jokes mock mental illness.

## Street plan (stylised)

Each street has a class:

| Class | Width | Who uses it |
|---|---|---|
| `main` | 4 lanes | danfo route, no okada |
| `inner` | 2 lanes | okada allowed |
| `lane` | narrow | walk only, no traffic |

**North–south streets:**
- Herbert Macaulay Way: the main spine, through the middle;
- Murtala Muhammed Way: main, at the west edge;
- 2–3 inner streets between them, named from the real side streets once placed.

**East–west streets:**
- Commercial Avenue (Sabo): main;
- Tejuosho Street: inner;
- Montgomery Road: inner;
- Hughes Avenue: inner;
- Alagomeji Road: inner, at the south.

**Landmarks** (hand-placed in the plan, copied unchanged by the generator):
- Yaba bus stop and motor park, the danfo terminus;
- Tejuosho Market, a big covered market;
- Sabo market and its street traders;
- the Yaba College of Technology gate, on Herbert Macaulay Way;
- a tech-hub office block ("Yabacon Valley", generic name);
- a cinema and shopping plaza (generic name);
- a church and a mosque;
- a fuel station, bukas, and a phone and laptop repair row;
- an okada park on an inner street, and a keke stand by the market;
- today's home, job site, buka, bus stop and fuel station, moved near the centre.

**Later, past 1 km:** the Ojuelegba bridge to the south-west and the UNILAG gate to the east.

## Game-dev choices (made, briefly why)

- **Procedural generation from a hand-written plan.** A script turns a small description (streets, zones, landmarks) into the full city file. Big game maps are usually built this way: people decide the shape and the script does the repetitive placing. A hand-placed landmark always wins over generated filler.
- **Chunks.**
  - The world is cut into 64 m squares, so 600 m is about 10×10 chunks and 1 km about 16×16.
  - The client loads and draws only the chunks near the player, and the server sends only those.
  - The chunk count is computed from the bounds and is never a constant.
- **Spatial grid.** Obstacles are bucketed into 8 m cells, so a collision check looks only at the few boxes near the player instead of all of them. It is the standard fix for "scan everything" checks, and it keeps the server's cost per player flat however big the district gets.
- **LOD (level of detail).** Far objects are drawn in a cheaper form. Here, a model building past about 60 m is drawn as its plain coloured box inside the instanced `Boxes` call.
- **Haze.** The fog closes in sooner, at about 40–100 m, with camera `far` about 110 m. It hides the edge of what is loaded and reads as Lagos's humid or harmattan haze.
- **Area-of-interest (AoI).** Each player is told only about the players and chunks near them. Colyseus 0.18 does this with `StateView`.

## Steps (each play-tested before the next)

### 11h-1 Spatial grid (no visible change, Yaba still 120 m)

- `packages/shared/src/spatialGrid.ts`: a `SpatialGrid<Box>` with 8 m cells, built once from `districtObstacles(layout)`, with `query(point, radius)`.
- `moveWithCollisions` and `isBlocked` take the grid instead of a `Box[]`. `moveWithCollisions` stays the one collision function, run by the server and by client prediction.
- `reachableTargets`:
  - a `Uint8Array` bitmap instead of an array of walkable cells;
  - grid queries per cell;
  - each target mapped to its cell once, instead of `walkable.some` per target.
  - Target: under 2 s at 600 m at server start, and still workable at 1 km.
- `checkLayout`'s walkway sampling uses the obstacle grid.
- As built (2026-10-22), the road checks, `DistrictMap.nearest` and the client's `nearestPlace` keep their plain loops. They run over roads and places, which number tens even at 600 m, so a grid would add code for no gain (see [known-limits](../known-limits.md#server-and-protocol)).
- Measured on a 600 m stand-in city (1,125 boxes, 225 targets): `reachableTargets` takes about 40 ms against about 2 s before, and about 115 ms at 1 km.

### 11h-2 Generator and street plan

As built (2026-10-22):
- **Plan files:** the plan lives in `content/cities/plans/lagos/` (`city.json` for the city's own fields, `yaba.json` for the district), not a single `yaba.plan.json`.
- **Generator:** `apps/server/src/city/`, run by `apps/server/src/generateCity.ts`.
- **Roads:**
  - main roads are 8 m with one lane each way, not 4 lanes;
  - streets get a road `name` and `class`, and the district gets `landmarks` for the map;
  - there is no separate `streets` field.
- **Result:** 915 buildings (213 models), 1,175 props, 18 roads and 20 NPCs. The join message is 253 KB, and the content check takes 87 ms.
- **Deviations from the plan's wording:** see [known-limits, Content](../known-limits.md#content).

The plan as written before building:

- **Plan file:** `content/cities/plans/yaba.plan.json`, written by hand. It holds:
  - streets: `name`, `axis`, `at`, `from`, `to`, `class`;
  - zones: `market`, `residential`, `commercial`, `school`;
  - landmarks with exact positions;
  - bus stops and okada parks.
- **Generator:** `pnpm city` runs `scripts/city/generate.mts` and writes `content/cities/lagos.json`.
  - From then on `lagos.json` is generated and never edited by hand, like `content/models/catalog.json`.
  - No new dependencies.
  - Seeded and deterministic: the same plan always gives the same file. `seededRandom` (mulberry32, today in `apps/client/game/world/paint.ts`) moves to `packages/shared` so both sides use it.
- **Generator passes, in order:**
  1. Roads (with `name` and `class`) from the streets.
  2. Blocks between roads, split into plots along each road frontage.
  3. One building per plot, picked by zone from the existing model and box kinds and turned a quarter turn to face its road. The footprint is sized to the scaled model (the existing rule). Instance tints give variety without new models.
  4. Kerb props:
     - electric poles about every 30 m, with wires;
     - trees and generators;
     - kiosks and hawker tables in market zones;
     - signboards facing +z.
  5. Traffic:
     - lanes in both directions on every `main` and `inner` road;
     - walkways on the road edges;
     - bus stops from the plan.
  6. Static NPCs at landmarks (traders at the markets, the conductor at the motor park).
- **Checks:** the generator runs `checkLayout` and the content cross-checks itself, and fails loudly on any problem.
- **Schema** (`packages/shared/src/content.ts`):
  - roads gain `name` and `class`;
  - the district gains `streets` (names for the map) and `landmarks` (`{id, name, x, z}`; names come from content, never code);
  - the pedestrian and fleet caps go up, because density becomes per chunk on the client (11h-5).

### 11h-3 Client chunks, culling, LOD, haze

**As built (2026-10-22)**

- **One mesh per kind, not per chunk.** Instead of a mesh per chunk, each kind keeps one instanced mesh for the whole district. It is refilled from the 64 m chunks nearby whenever the player crosses into another 16 m cell, so draw calls stay flat.
- **The drawn area follows the camera:**
  - it reaches 90 m ahead, 30 m behind and 75 m to each side;
  - models are drawn within 60 m ahead and 50 m to the side;
  - a portrait phone sees almost to the horizon ahead, so the area leans north.
- **Haze:** 35–100 m from the camera.
- **Traffic:** only vehicles in the drawn area are drawn. That came forward from 11h-5, because the far traffic was most of the triangles.
- **Details and measurements:** [known-limits, Client](../known-limits.md#client-appsclientgame).

**The plan as written before building:**

- `apps/client/game/world/chunks.ts`:
  - splits the layout into chunks;
  - the visible set is the chunks within about 100 m of the camera's look point;
  - it is recomputed when the player crosses a chunk edge, not every frame.
- **Per-chunk drawing:**
  - each chunk gets its own `Boxes` InstancedMesh, with its own bounding sphere so frustum culling works;
  - a ground tile using a repeating `paintGround` texture;
  - its roads merged.
- **Model buildings** are instanced per model kind per chunk, not cloned per building.
  - The occlusion fade becomes a per-instance attribute (`instanceFade`) read by the existing dither, so nothing changes a shader during play.
  - `blocksView` runs only for buildings in the player's chunk and the chunk south of it, since the camera always looks north.
- **LOD:** past about 60 m a model building is drawn as its box slab.
- **No late shaders:**
  - every model kind the district uses is loaded and warmed up at join (all under the 6 MB budget);
  - streaming a chunk then never compiles a shader;
  - "⚠ late shaders" on the `?fps` meter stays a bug.
- **Haze:** `Lighting.tsx` gets the new fog range, and `Game.tsx` the camera `far`.

### 11h-4 Area-of-interest and chunk streaming

- **On join** the server sends a slim `district` header:
  - bounds, spawn, places, streets, landmarks and the chunk grid;
  - the **map summary** as compact rounded numbers: road rectangles, building outlines, labels. 11i draws the map from it.
  - Then the 3×3 chunks around the player.
- **While moving:** when the server-side position crosses a chunk edge, `DistrictRoom` sends the new ring as `chunk` messages, registered in `MessageBuffer` (`connection.ts`). The client keeps loaded chunks within about 150 m and drops the rest.
- **Client collision** covers loaded chunks only. The loaded ring is wider than any move in one tick, so the player can't reach an unloaded chunk, and the server's full grid stays the truth.
- **Players** are added to each client's `StateView` only within about 80 m. Nothing draws other players yet; this is the schema side, ready for Phase 5.

### 11h-5 Traffic and people at scale

- `trafficSim` and `walkers` simulate only within about 120 m of the player. Vehicles and walkers spawn at the edge of that window on the lanes and walkways that cross it, and despawn past it.
- Junctions come from the generated road graph instead of `roadOverlaps` over every pair of roads.
- Density is the schedule's share, times a zone factor (busier at the market and the motor park), times `quality.scale`.

## Performance

| | Today (11f-4, vivo Y29) | 11h target |
|---|---|---|
| Visible area | the whole 120 m | about 9–12 chunks |
| Draw calls | 26 | ≤ 60 |
| Triangles | 35.1k | about 80k |
| District models | about 0.4 MB | under 1 MB of the 6 MB |
| World data per player | 12 KB layout | header plus chunks, about 30–60 KB (the whole 600 m file is about 300 KB) |

Any new visual cost is re-measured on the phone with `?fps` on a production build.

## Tests

**Shared and server:**
- grid queries match the brute-force scan on random layouts;
- generator determinism (same plan and seed, same file);
- the generated Yaba passes `checkLayout` and the cross-checks;
- `reachableTargets` timing on a generated 1 km layout;
- the chunk split covers every object exactly once;
- a far player is not in another player's `StateView`;
- crossing a chunk edge sends exactly the new ring.

**Client:**
- the chunk visible-set maths;
- the LOD switch distance;
- the traffic and walker spawn window.

## Docs

`docs/known-limits.md`:
- `lagos.json` is generated;
- the spatial-grid rule;
- chunk and cell sizes;
- streaming relies on every model kind being warmed at join;
- a new baseline row.

CLAUDE.md "Rules from the build":
- Change Yaba in `content/cities/plans/` and run `pnpm city`; never edit `lagos.json` by hand.
- Collision and nearest-place checks go through the district's `SpatialGrid`, never a scan of every obstacle.
- World data reaches the client in `chunk` messages; never add per-object data to the `district` header.

## Play-test checklist (vivo Y29, `pnpm start:client`, `?fps`)

1. Run from the motor park to Tejuosho Market. There should be no hitch when chunks change.
2. The street names and landmarks read as Yaba.
3. The haze hides chunks loading at the edge.
4. Traffic and people stay around you, and the market is busier than the back streets.
5. The meter shows 60 fps, a worst frame under 40 ms, under 60 draw calls, and no "late shaders".

## Verification

- `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- Run `pnpm city` twice: the output is byte-identical.
- Time the server start with the 600 m layout.
- `pnpm budget`.
