# Plan: Slice 11, "Look and feel" (before Phase 2)

## Context

Phase 1 plays well but looks like a prototype: Yaba is coloured boxes on a green plane (`apps/client/game/World.tsx`) and the player is a green capsule with a yellow nose (`apps/client/game/Player.tsx`). Before Phase 2 adds documents and visas, the game needs to look like Lagos and the player needs a real body that they can make their own, without breaking the 15 MB / 30 fps budget measured on the vivo Y29 (60 fps baseline, 1.86 MB build).

Decided with you (2026-10-17):
- **Outfits:** a starter set is free at creation and can be changed for free at home. Extra outfits (agbada, iro and buba with gele, aso-ebi) are sold at the market later as a money sink. This slice builds only the free part.
- **Start on free tiers (updated 2026-10-17):** this slice uses only free asset tiers and free tools. Nigerian-specific assets are made by us in Blender (free) by kitbashing and recolouring CC0 parts, or painted in code. Paid tiers (for example the Quaternius Source/Pro packs) or commissioning a Nigerian artist may come later. The pipeline is built so those can be swapped in through catalog entries without code changes.

This is one new Phase 1 slice, **Slice 11**, split into sub-slices 11a–11g (one branch each, as before). It goes into the Phase 1 table in CLAUDE.md and must be done before Phase 2 starts.

---

## 3D concepts you'll meet (read once)

- **Mesh / triangles:** a 3D model is a surface made of triangles. "Low-poly" means few triangles (a character in 3–8k), which is cheap to draw.
- **Draw call:** each time the CPU asks the GPU to draw one mesh with one material. Weak phones choke on draw calls before they choke on triangles. Target: **under ~80 per frame**.
- **Instancing:** drawing many copies of one mesh in a single draw call (the buildings already do this). It's how we get 10 danfos for the price of one.
- **Rig / skeleton / skinning:** a character mesh is bound to an invisible skeleton of bones. Moving bones bends the mesh ("skinning", done on the GPU). A **skinned mesh** is a mesh with a skeleton.
- **Animation clip / mixer / crossfade:** a clip is recorded bone movement ("walk", "idle"). three.js's `AnimationMixer` plays clips, and a **crossfade** blends one into the next over ~0.2 s so changes don't pop.
- **In-place animation vs root motion:** our clips walk on the spot and the code moves the character (the server decides position). Root motion (the clip moves the body) would fight the server, so we don't use it.
- **Foot sliding:** if the walk clip's stride doesn't match `PLAYER_SPEED_UNITS_PER_SECOND`, the feet skate. Fix by scaling the clip's playback speed.
- **Retargeting:** moving animations from one skeleton onto another. We avoid it by using characters and animations built on the **same rig**.
- **Texture atlas / palette texture:** one small image holding all the colours (or pieces) many models use, so they share one material and can merge into one draw call. Recolouring (skin tone, hair colour) becomes changing a few pixels in a tiny per-character palette.
- **glTF / GLB:** the standard 3D file format for the web (`.glb` is the single-file binary form).
- **Draco:** compresses mesh geometry (often 5–10x smaller). It needs a small WebAssembly decoder in the browser.
- **KTX2 (Basis Universal):** a compressed texture format that stays compressed **in GPU memory** too, unlike PNG/JPG, which matters on 2–3 GB phones.
- **LOD (level of detail):** swap to a simpler model (or hide it) when it's far away.
- **Baked lighting / AO:** shading painted into the model's colours ahead of time, so the phone doesn't compute shadows live. **Blob shadow:** the dark disc under the player we already use.
- **Frustum culling:** not drawing what's outside the camera's view. three.js does this per mesh automatically.
- **VAT (vertex animation textures):** a crowd trick that bakes animation into a texture. Only if we ever need 50+ animated NPCs; not planned now.

---

## Asset sources and licences

All primary sources are **CC0** (public domain: commercial use, modification, no attribution needed). Credit them in the game anyway.

| Need | Source | Licence | Notes |
|---|---|---|---|
| Base characters (2 body types) | [Quaternius, Universal Base Characters](https://quaternius.itch.io/universal-base-characters), **free Standard tier** | CC0 | 2 base models and 5 hairstyles. First task in 11a: confirm the free files carry the skeleton (they're advertised as compatible with the animation library, so they should). Fallback if not: the free tier of KayKit's rigged character packs (CC0). We don't need the paid tier's colour shaders, because our palette texture does the recolouring |
| Animations | [Quaternius, Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) **free Standard tier** (+ [UAL 2](https://opengameart.org/content/universal-animation-library-2) free tier) | CC0 | Same rig as the base characters, so **no retargeting**. 45 free clips. The page doesn't list them, so we check for idle, walk and interact on download. If there's no good "work" clip: a gesture clip from the free set played in a loop, or a short loop we key in Blender on the same rig |
| Buildings, roads, street furniture | [KayKit City Builder Bits](https://kaylousberg.itch.io/city-builder-bits) **free tier** and Kenney City Kits (Commercial, Suburban, Roads, all free) | CC0 | KayKit shares one gradient atlas (downscalable to 128²), which is ideal for us. We kitbash and recolour into Lagos forms in Blender |
| Generic cars ("tokunbo" Corollas, vans) | [Kenney Car Kit](https://kenney-assets.itch.io/car-kit) | CC0 | 40+ glTF cars. Tinted yellow with black stripes, a van stands in for the danfo until the commissioned one arrives |
| Trees, plants | Quaternius Ultimate Nature / Stylized Nature packs | CC0 | Palms, mango and almond trees |

**Not using:**
- **Ready Player Me:** it shut down its public service on 31 January 2026 after Netflix bought it.
- **Mixamo, as a main source:** Adobe's FAQ forbids redistributing raw animation files, and a web game ships the file to every browser. That's a grey area, and Mixamo is in maintenance mode. Use it only for one missing clip, and only after checking Adobe's current terms.

**Nigerian-specific items we make ourselves (free, in Blender or in code):**
1. **Vehicles:**
   - danfo: a Kenney van, painted yellow with black stripes, a sliding-door line and a roof rack;
   - keke napep: kitbashed from CC0 parts, or modelled as a simple low-poly shape;
   - okada: a low-poly bike with a seated rider, using the character rig.
2. **Hair** (the free packs have almost no Black hairstyles, the biggest gap). Two cheap techniques:
   - **short styles painted on the scalp:** low cut, fade, bald, cornrows. That's a texture or palette change, so no new mesh and almost no download;
   - **simple low-poly shapes for volume styles:** afro, puff, locs, braids, headwrap.
3. **Outfits:** recolour and reshape the free base clothing. Ankara garments are the base shirt or dress with a pattern texture.
4. **Ankara patterns: painted in code** on a canvas at load time, like the signboards. They're original designs (no copies of Vlisco or other copyrighted prints) and cost **zero download**. A pattern is a few parameters (shapes, colours, repeat), so we can have dozens.
5. **Lagos facades:** kitbashed from KayKit/Kenney walls with a zinc roof, louvre windows and painted cement colours.

Agbada, gele and aso-ebi are the hardest to make well and are shop items anyway, so they come after this slice.

**All tools are free:**
- Blender (GPL) for kitbashing.
- `@gltf-transform/cli` (MIT) and `toktx` from KTX-Software (Apache 2.0) for the asset pipeline; see "Asset pipeline" below. Both need your approval: a new dev dependency, plus a system tool you install once.
- No runtime dependencies: the loaders come from `three/examples` and drei's `useGLTF`/`useAnimations`, which are already installed.

---

## Asset pipeline (what `@gltf-transform/cli` is for)

Models from the packs, and from Blender, arrive as large files with uncompressed geometry and PNG textures. A command-line tool shrinks them before they go into `apps/client/public/assets/`. It runs on your machine at build time and is never shipped to players. The `pnpm assets` script runs it to:
1. **Compress geometry with Draco** (often 5–10x smaller).
2. **Convert textures to KTX2**, which stays compressed in GPU memory. It calls `toktx` for this step.
3. **Clean up:** remove unused nodes, materials and animation channels, merge duplicate data, and weld vertices.
4. **Shrink animations:** resample keyframes and quantise them (store numbers at lower precision, invisible at this scale).
5. **Measure each model's footprint** (its bounding box) and triangle count, and write them to `content/cities/models.json`. The server's content check uses that file to confirm a model fills its collision box without parsing GLB files itself.

Without it, Blender's own glTF exporter can apply Draco, but not KTX2, the cleanup or the measuring, so every footprint would be typed in by hand and could drift from the real model. It's MIT-licensed and written by a three.js maintainer.

---

## Character

**Model.** The Quaternius base body (Regular, two body types), built from modular parts on one skeleton: body, hair, top, bottom, shoes, and optional headwear. At load time the chosen parts are **merged into one skinned mesh with one palette material** (one draw call per character; two if it wears an Ankara pattern, which gets its own small tiling texture).

**Animations.** Idle, walk and work, plus an `interact` gesture when a place sheet opens. A small state machine in `apps/client/game/character/animation.ts`:
- `walk` while the input direction is non-zero, playback speed scaled to `PLAYER_SPEED_UNITS_PER_SECOND` (no foot sliding);
- `work` while `stats.activeShift` is set **and** the player stands within `interactRadius` of that job's site (shifts don't lock movement, so walking away during a shift goes back to idle/walk: going to work looks like working);
- `idle` otherwise. 0.2 s crossfades between them.

This is presentation only. The server still owns position and shift state, and the client only reads them.

**Customisation (starter set, free).**
- Body type: 2.
- Skin tone: 8 swatches across the full range of Nigerian complexions, labelled by swatch only, never named after an ethnic group.
- Hair: low cut, bald, afro, cornrows, braids, locs, headwrap.
- Hair colour: 5.
- Outfit: T-shirt and jeans, office shirt and trousers, Ankara shirt, Ankara dress, senator, plain football jersey (no real club badges).

Garments are named by garment, never by ethnic group. Please check the list for cultural accuracy, ideally with a couple of Nigerian play-testers.

**Where appearance lives.**
- **Catalog** `content/characters/catalog.json`: ids for every option, the GLB part each uses, which body types it fits, its palette slot, and `starter: true` (vs. later shop items). Validated by a new `characterCatalogSchema` in `packages/shared/src/content.ts` and checked by `loadContent` (every part file exists in the asset manifest). Display names go in `content/copy/en.json` + `copySchema`.
- **Shape** `appearanceSchema` in a new `packages/shared/src/appearance.ts`: `{ body, skinTone, hair, hairColour, outfit }`, ids only. Also a compact string encoding (e.g. `b1.s4.h2.c1.o3`) for room sync.
- **Storage:** a new `PlayerAppearance` table (`playerId` PK, one column per slot, `updatedAt`), migration `add_player_appearance`. It isn't the ledger, auth or payments, and it's cosmetic avatar data, not personal data about the real person (no photo, no name, no age). Ids are checked against the catalog on write. On read, an id no longer in the catalog falls back to that slot's default, so a catalog change never breaks a player.
- **Intent:** `setAppearance` in `packages/shared/src/intents.ts`, through `parseIntent` and the per-player `KeyedMutex` as every intent is. A new `AppearanceService` (`apps/server/src/game/appearance.ts`, with tests) refuses non-starter items until the shop exists (`not_owned`). Changing outside the creator is only allowed at home: a "Change clothes" action on the home place sheet.
- **To the client:**
  - Own player: an `appearance` message on join (registered in `MessageBuffer` in `connection.ts`) and after `setAppearance`. No row yet means the client shows the **character creator** after the welcome/18+ screen.
  - Other players (Phase 5): add `appearance: t.string()` (the compact code) to `PlayerPosition` in `apps/server/src/rooms/DistrictState.ts` now, so remote players can be drawn later with no protocol change.

---

## City

**Yaba buildings (each mapped to an existing `lagos.json` building):**
- face-me-face-you house (zinc roof, louvres, a corridor door);
- office block (concrete and tinted glass, a caged generator outside);
- Mama Put's buka (a wooden shed with zinc, benches, big pots);
- fuel station (canopy on pillars; collision is the kiosk only);
- bus shelter (yellow);
- two blocks of flats (balconies, black water tanks and satellite dishes on the roof);
- market (stalls, umbrellas, tarpaulins);
- church (white, a cross, a signboard).

Add 2–3 shophouses along the main road to fill the street.

**Ground.** Red laterite earth instead of green grass, with patches of grass. Asphalt roads with worn edges. **Open concrete gutters** along both sides of the roads, with slab crossings at the junction. Kerbs and sidewalks, pothole decals.

**Props:**
- electric poles with sagging wires;
- generators;
- kiosks and container shops;
- hawker trays, umbrellas and plastic chairs;
- speed bumps;
- billboards for made-up brands (no real brand names);
- palm, mango and almond trees;
- signboards (keep the existing canvas-painted text: no font download).

**Static NPCs** (cheapest flavour per byte): Mama Put behind her counter, two okada riders waiting at the junction, a hawker at the bus stop, a gateman at the office, a danfo conductor at the bus stop with a speech bubble ("Oshodi! Obalende!", from `en.json`).

**Moving life:**
- Traffic: danfo, keke, okada and tokunbo cars driving lanes along the two roads.
- 8–12 pedestrians walking sidewalk loops, given random catalog appearances (so NPCs show off the customisation for free).

**Atmosphere:**
- Lighting follows the Lagos clock (`stats.isNight`, the hour): warm afternoon, orange dusk, dark blue night with lit windows.
- **When NEPA takes light** (`stats.blackoutEndsAt`), most windows go dark and a few stay lit on generators. That's one material swap, and the most Lagos thing on screen.
- Harmattan haze through fog colour is a later seasonal option.

### Staying in sync with `lagos.json` and shared collision

The rule from Phase 1 stays: **the footprint in `lagos.json` is the truth for collision, and the model only dresses it.**

- `buildingSchema` gains `model` (a model-catalog id) and `rotation` (0/90/180/270 only, so footprints stay axis-aligned for `moveWithCollisions`). `colour` becomes optional, used as the tint or fallback.
- New `propSchema` on the district: `{ id, model, x, z, rotation, blocks }`.
- New `traffic` (lane polylines plus vehicle types) and `walkways` (pedestrian loops). These are visual only.
- New **model catalog** `content/cities/models.json`, **generated by the asset script** from each GLB's real bounding box: id, file, footprint `halfWidth`/`halfDepth`, triangle count, bytes. It's checked in, so the server never parses a GLB.
- `loadContent`/`checkLayout.ts` gain checks, so content can never put an invisible wall or a walk-through wall on screen:
  - a building's model footprint must fill its box (within 0.3 m larger and at least 85% of the box);
  - a blocking prop must not cover a spawn, a place or a reachable path (the existing reachability check covers this once props are obstacles);
  - lanes stay on roads.
- New `districtObstacles(district)` in `packages/shared/src/collision.ts` returns buildings plus blocking props as `Box[]`. The server (`DistrictRoom`, `district.ts`), the client prediction (`Player.tsx`, `reconcile`) and `checkLayout` all call it instead of passing `district.buildings` directly. Same code on both sides, so there's still no rubber-banding.
- **NPCs and traffic are client-only and cosmetic:** they're not synced, never block the player, and vehicles stop for the player (client-side) rather than hit them. Added to Known limits. Phase 5 decides whether to sync them.

---

## Performance

**Download** (Draco + KTX2; estimates to replace with measurements; all loaded lazily after the game chunk, Yaba first):

| Item | Est. size |
|---|---|
| Draco decoder + Basis transcoder (self-hosted in `public/`, never Google's CDN) | ~0.8 MB |
| 2 base bodies + starter hair and outfits | ~1.0 MB |
| Animations (idle, walk, work, interact, NPC extras; resampled and quantised) | ~0.3 MB |
| Yaba buildings (≈12 models) | ~1.5 MB |
| Props, trees, NPC extras | ~0.6 MB |
| Vehicles (4 types) | ~0.5 MB |
| Palette atlas + 4 Ankara patterns + ground textures | ~0.4 MB |
| **Total added** | **~5 MB** → about 7 MB with today's 1.86 MB build, under 15 MB |

- New **per-district asset budget** in `apps/client/scripts/checkBudget.mts`: Yaba ≤ 6 MB, the character set ≤ 1.5 MB, failing like the 15 MB check. Assets live in `apps/client/public/assets/` for now (so `pnpm budget` counts them) and move to Cloudflare R2 with the hosting decision.
- **Load order** so the player isn't stuck on a loader: the character and nearby buildings first (show the scene), props, NPCs and traffic after the first frame.

**Frame rate** (targets that keep 30+ fps on the Y29; we're at 60 now):
- Draw calls < 80. One per building type (instanced or merged), one per vehicle type (instanced), one or two per character.
- Under ~150k visible triangles. Characters 3–8k each. NPCs beyond ~30 m skip animation updates or hide (a simple LOD). Fog already hides the far distance, so the camera `far` drops from 220 to ~150.
- Materials: `MeshLambertMaterial` with the palette atlas. No real-time shadows: blob shadows for characters and vehicles, baked AO in building colours. dpr cap 1.5 unchanged.
- Animation: only on-screen mixers update. Distant NPCs update at 15 Hz.
- **Adaptive quality:** if the fps meter's one-second low stays under 30 for 5 s, halve pedestrians and traffic. That costs one counter.
- Extend the `?fps` meter to show draw calls and triangles (`renderer.info`), and re-measure on the Y29 (production build) after every sub-slice.

---

## Order (biggest visible change first)

| # | Sub-slice | You'll see |
|---|---|---|
| **11a** | **Pipeline + character.** The `pnpm assets` script (gltf-transform: dedupe, weld, Draco, KTX2, writes `models.json`), self-hosted decoders, `assets.ts` loader. The Quaternius body with one default look replaces the capsule. Idle/walk/work state machine, speed-matched walk | The capsule becomes a person who walks, stands and works. It also proves the whole asset path every later step uses |
| **11b** | **Yaba looks like Lagos.** Building models in `lagos.json` with the footprint check, laterite ground, gutters, roads, Lagos day/night lighting, windows dark in power cuts | The "this is Yaba" moment |
| **11c** | **Street life, static.** `propSchema` + `districtObstacles` (server, client, checkLayout), props and trees, static NPCs (Mama Put, okada riders, hawker, gateman, conductor) | The street feels lived in, and you bump into generators and kiosks exactly where they are |
| **11d** | **Customisation.** Catalog, `PlayerAppearance` + migration, `setAppearance`, `AppearanceService`, the creator after the welcome screen, "Change clothes" at home, copy in `en.json` | Your own character |
| **11e** | **Moving life.** Traffic lanes with instanced vehicles (the yellow-van placeholder danfo), walking pedestrians with random appearances, adaptive quality | Yaba moves |
| **11f** | **Nigerian assets (DIY).** Our own danfo, keke, okada, painted and low-poly Black hairstyles, Ankara outfits with code-painted patterns, Lagos facades. Swapped in through catalog entries | It looks unmistakably Nigerian |
| **11g** | **Hardening.** Y29 fps and draw-call check, budgets, CLAUDE.md updates (slice table, Known limits: cosmetic NPCs, model footprint rule, asset pipeline commands, the new baseline) | Same 60 fps, ~7 MB |

## Critical files

- Client: `apps/client/game/Player.tsx` (drawing moves to a new `character/` folder), `World.tsx` (models instead of boxes), `Game.tsx` (lighting, load order), new `assets.ts`, `CharacterCreator.tsx`, `connection.ts` (`MessageBuffer`: `appearance`), `PlacePanel.tsx` (home: change clothes), `FpsMeter.tsx`, `scripts/checkBudget.mts`
- Shared: `content.ts` (building `model`/`rotation`, `propSchema`, traffic, walkways, catalogs), new `appearance.ts`, `intents.ts`, `messages.ts`, `collision.ts` (`districtObstacles`), `copy.ts`
- Server: `content/loadContent.ts`, `checkLayout.ts`, `rooms/DistrictRoom.ts`, `rooms/DistrictState.ts`, new `game/appearance.ts`
- DB: `packages/db/prisma/schema.prisma` (`PlayerAppearance`)
- Content: `content/cities/lagos.json`, new `content/cities/models.json` (generated), new `content/characters/catalog.json`, `content/copy/en.json`
- Pipeline: new `assets/source/` (Blender/GLB sources) → `apps/client/public/assets/`, root `pnpm assets` script

Reuse: `moveWithCollisions`/`isBlocked` (shared collision), `parseIntent` + `KeyedMutex` (intents), `paintSign` (signboard text), `MessageBuffer` (new messages), `InboxService` is not needed (appearance isn't a notice), and the `Boxes` instancing pattern in `World.tsx` for instanced props and vehicles.

## Verification

- Every sub-slice: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm budget` (with the new per-district limits).
- New tests:
  - catalog and model-catalog schemas;
  - footprint-vs-box and lane-on-road checks (a bad `lagos.json` refuses to boot);
  - `districtObstacles` used identically by server and client (collision test: you can't walk through a blocking prop on either side);
  - `setAppearance` rejects unknown ids, non-starter items and wrong body/part pairs;
  - fallback on a removed catalog id;
  - the animation state picks `work` only at the job site during a shift.
- Manual play-test after each sub-slice on the Y29 with `pnpm start:client` and `?fps`: fps ≥ 30 (expect ~60), draw calls < 80. "Good" means the walk has no foot sliding, turns stay smooth, and there's no pop when stopping. Buildings stop you exactly at their walls. The first load on mobile data gets you walking in a few seconds, with props arriving after. A power cut at night visibly darkens the street.
