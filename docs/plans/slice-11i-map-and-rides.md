# Plan: Slice 11i, "Map and getting around"

Approved 2026-10-21. Part of [Slice 11](slice-11-look-and-feel.md), after [11h](slice-11h-big-yaba.md) (it draws the map from 11h's map summary) and before 11g. Not started.

## Context

At 600 m (11h), Yaba is too big to learn by wandering. 11i adds:
- a **minimap** on the HUD;
- a **full-screen 2D map** with tap-to-route along the roads;
- **paid danfo and okada rides** between stops, with the fare as a ledger sink.

What is already there:
- The bus-stop reply carries no payload (`apps/server/src/game/offers.ts`), and the sheet says "No danfo yet…".
- `busFareKobo: 50000` sits unused in `content/economy/ngn.json`.
- `transport` is already a sink reason (`packages/shared/src/economy.ts`).

Decided 2026-10-21:
- **Rides follow the road.**
  - You board at a stop and see yourself seated in the danfo or on the okada.
  - The server moves you along the road route at vehicle speed, and the camera follows.
  - You can't steer or get off mid-route.
- **Okada runs on inner streets only.** Lagos banned commercial okada in six LGAs in 2022, including Lagos Mainland, which covers Yaba, yet riders still work the inner streets.
  - Okada routes never use a `main` road.
  - A small task-force chance ends the ride early. You walk the rest, and the fare is not refunded.

## Game-dev choices (made, briefly why)

- **The map is 2D, on a canvas, not in 3D.**
  - It is drawn once from the map summary into an offscreen canvas; each frame only the player dot and route are redrawn on top.
  - No new dependency and no GPU cost.
- **North-up.** The game camera always looks north, so the map never rotates and matches the screen.
- **Pathfinding with A\* on a road graph.**
  - The roads become a graph: nodes at junctions and road ends, edges along the roads.
  - A\* is the standard shortest-path search: it explores towards the goal first, so it is fast on a graph this small.

## Map

- **Minimap:**
  - about 110 px in the top-right of the HUD, centred on the player;
  - redrawn about 5 times a second;
  - tap it to open the full map.
- **Full-screen map:**
  - pan and pinch-zoom (pointer events, no gesture library);
  - labels for streets, landmarks and places;
  - a "you are here" dot, and stop icons for danfo and okada.
- **Tap a spot to get a route.** The route appears on the map and as a line on the ground in the world (one line mesh, one draw call).
- **"Walk there" button:**
  - auto-steers the player along the route by sending the ordinary `move` intents, so the server stays authoritative;
  - touching the joystick or keys cancels it.
- **Routing:**
  - `packages/shared/src/roadGraph.ts` builds the graph from the district's streets.
  - Routes follow the walkways on the road edges, which `checkLayout` already keeps clear of obstacles.
  - The route goes start, to the nearest road, along the graph, then to the target.
- **Copy:**
  - map labels, buttons and ride text go in `content/copy/en.json` and `copySchema`;
  - street and landmark names stay in the city plan (`content/cities/plans/yaba.plan.json`).

## Rides

### Content

- **Routes:** the city plan's `rides` hold `{id, kind: "danfo" | "okada", stops: [placeId...]}`. The generator copies them into `lagos.json`.
- **Stops** are interactables:
  - `bus_stop` (existing) for danfo;
  - a new `okada_park` kind for okada.
- **Fares** go in `content/economy/ngn.json`, each with a `source` and `asOf`:
  - danfo: a flat fare per ride, reusing `busFareKobo` (N500);
  - okada: by distance band, about N800 across Yaba.
  - Both values need 2026 Lagos sources before 11i is built.
- **Also in content:** vehicle ride speeds, the danfo's loading wait (seconds), and the okada task-force chance.

### Server

- **Okada rule:** `checkLayout` refuses an okada route that uses a `main` road.
- **`takeRide {rideId, from, to}` intent:**
  - goes through `parseIntent` and the per-player `KeyedMutex`, like every intent;
  - checks the player is near the `from` stop;
  - checks both stops are on that ride, in that order;
  - checks the player is not already riding.
- **Claim:**
  - a conditional insert into a new `PlayerRide` table: `{id, playerId, rideId, kind, path, startedAt, arrivesAt, endsEarlyAt?}`;
  - one active ride per player;
  - this is a Prisma migration, not a ledger schema change.
- **Fare:**
  - `WalletService.debit`, reason `transport`, idempotency key `ride:<playerId>:<playerRideId>`;
  - charged in the same step as the claim, so if the debit fails the claim is undone: not enough money means no ride.
- **Task force:**
  - the server rolls the dice at boarding and stores `endsEarlyAt` and the stop point;
  - when it happens, an `InboxService.deliver` notice explains it in one plain line.
- **Riding:**
  - `step()` ignores `move` intents and sets the position from the server clock along the path (`positionAt(ride, now)`);
  - the danfo first waits a few seconds at the stop while the conductor calls;
  - on arrival the player is placed at the destination stop.
- **Offline during a ride:** because game time is real time, a player who comes back after `arrivesAt` is already at the destination, resolved on join.

### Client

- **Bus-stop and okada-park sheets** (`PlacePanel.tsx`) list destinations and fares, which reach the client in the `interaction` reply. The client has no copy of `content/`.
- **While riding:**
  - your character sits in a danfo or on an okada model that moves along the route;
  - the camera follows;
  - a HUD chip shows the destination and time left;
  - the traffic sim leaves your vehicle out.

## Performance

- Map: no GPU cost; the offscreen canvas uses about 1–2 MB of memory.
- Ride: one existing vehicle model.
- Route line: one draw call.

## Tests

**Ledger and rides** (economy code needs these):
- two concurrent `takeRide` intents, or a double tap, charge once;
- not enough money means no ride and no negative balance;
- a retry with the same key does not pay twice;
- fare overflow and distance-band rounding stay in integer kobo;
- a ride the task force ends keeps exactly one fare.

**Shared:**
- road-graph build;
- A\* returns the shortest road route;
- the route never leaves the walkways;
- `positionAt` along a path.

**Server:**
- `takeRide` validation (far from the stop, wrong direction, already riding);
- resolving a ride on join after `arrivesAt`;
- okada routes on `main` roads are refused.

**Client:**
- the minimap's world-to-map maths;
- auto-walk cancels on input.

## Docs

`docs/known-limits.md`:
- the ride model;
- auto-walk sends ordinary moves;
- the okada ban framing.

CLAUDE.md "Rules from the build":
- While a `PlayerRide` is active, the ride sets the player's position; never apply `move` intents to a riding player.

## Play-test checklist (vivo Y29, `pnpm start:client`)

1. The minimap matches where you are as you run.
2. Tap Tejuosho Market on the full map: the route follows the roads, and "Walk there" takes you there.
3. Take a danfo from the motor park to Sabo. You see Yaba go by, the fare leaves your wallet once, and you step off at the stop.
4. Okada works only from inner-street parks. With the dev-only task-force override, you're dropped mid-route and get an inbox message.
5. Close the app mid-ride and reopen it after the arrival time: you're at the destination.

## Verification

- `pnpm lint` and `pnpm typecheck`.
- `pnpm test`, with Postgres up (`docker compose up -d postgres`) for the ledger and ride tests.
- `pnpm db:migrate` then `pnpm db:generate` for `PlayerRide`.
