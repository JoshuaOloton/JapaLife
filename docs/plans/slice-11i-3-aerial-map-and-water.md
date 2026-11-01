# Slice 11i-3: aerial map and water

Added to Slice 11i on 2026-10-23, after the rides (11i-2). Part of [11i, map and getting around](slice-11i-map-and-rides.md).

**Built 2026-10-23; play-tested on the vivo Y29 2026-11-01:**
- you cannot walk into the canal, and you cross on the bridges;
- the pond looks right;
- the map opens with no hitch, and after the zoom and label fixes it reads well zoomed out.

As planned, with these details:
- **The canal** is 8 m wide at x −183. Nine streets and lanes cross it on bridges, every 60 m. Yaba lost 13 buildings to it (902 now).
- **The pond** is 18 × 12 m in the YabaTech grounds, east of the big tree.
- **Geometry:** the water code is `packages/shared/src/water.ts` (`waterPieces`, `bridges`, `crossing`, `partlyOver`). The client's lips, parapets and gutter cuts are in `world/waterShapes.ts`, and the mesh is `world/Water.tsx`.
- **Headless check** (software WebGL):
  - the map shows roofs, shadows, trees, water and badges, zoomed in and out;
  - a "walk there" to the Commercial Avenue bridge shows the canal, its lips and the parapets;
  - 25 draw calls there.
- **Moved to shared:** `hash01`, so a roof's zinc on the map matches the street (`zincTone`, `roofTone`; palettes in `world/roofColours.ts`).
- **"Walk there"** now also ends at the roadside when water lies between the road and the spot.

## Context

The map (11i-1) is a flat plan: grey building outlines on sand. The ask is for it to look like an aerial view of the city, with buildings and major landmarks visible, and for Yaba to have water: canals and ponds.

Decided (2026-10-23):
- **Painted aerial map,** still drawn on the 2D canvas (not a live 3D camera, not a baked image).
- **Clean blue water** (not the murky drainage-canal look).
- **One canal and one pond:**
  - the canal runs north–south the whole length of Yaba, between Ojuelegba Road and the far-west lane, with the streets crossing it on bridges;
  - the pond is inside the Yaba College of Technology grounds.

## Game-dev choices (made, briefly why)

- **Water is content, like roads.** A district gets `water`: axis-aligned boxes, each a `canal` or a `pond`. It travels in the `district` header, since it is small and the map and collision need all of it from the start.
- **Bridges are where roads cross water.**
  - A road crossing a canal cuts the water into pieces (`waterPieces`, shared), so the road surface is the bridge deck.
  - The pieces are what is drawn and what blocks walking, so the roads stay walkable.
  - Low concrete parapets line the bridge edges. They are drawn only, not solid, so the walkers on the road edges still pass.
  - `checkLayout` refuses a road that only partly overlaps water.
- **Water blocks walking.** The pieces join `districtObstacles`, the one list the server, the client's prediction and `checkLayout` already share. Reachability (`checkLayout`) then proves every place is still reachable over the bridges.
- **Drawn cheaply.**
  - All the water in the district is one mesh, a little above the ground.
  - Its ripples are a small seamless canvas texture drifting slowly. Moving a texture changes a uniform only, never the shader.
  - A concrete lip around each piece goes into the existing single `Boxes` call.
  - The water mesh exists from the start, so nothing compiles mid-game.
- **The generator keeps buildings, poles, trees and props off the water** by treating each water box (plus a bank) as reserved ground, like a landmark's `clear` area.
- **The aerial look is painted in code** (no download):
  - **ground:** sand with soft green patches;
  - **roads:** asphalt with white centre dashes on the main roads;
  - **buildings:** each roof in its colour, the plain buildings' rusty or grey zinc matching the street. A shadow falls to the south-east, longer for taller buildings, so the blocks read as 3D from above;
  - **trees:** green canopies with a shadow;
  - **water:** blue with light ripples and a concrete edge;
  - **landmarks:** small round picture badges (market basket, church cross, mosque crescent, school cap, bus, okada, office, plaza, tools) with their names.

  The base image goes from 1.5 to 2 px a metre (about 1,280 px a side, about 6.5 MB of memory) so it stays crisp when zoomed in.

## Content and data

- **`content.ts`:**
  - `waterSchema {id, kind: canal | pond, x, z, halfWidth, halfDepth}`;
  - `district.water` (default empty);
  - `landmark.icon`, optional: one of the badge names above;
  - `propKind.mapMark: "tree"`, optional, set on the tree and palm kinds.
- **The header's map data:**
  - `mapBuildings` becomes 6 numbers a building: x, z, halfWidth, halfDepth, height, roof tone. The tone is worked out in shared code from the building's id (and model), the same as the street's roof colour. The 3D roofs' `hash01` moves to `packages/shared` so both agree.
  - `mapTrees` (x, z pairs) for every prop whose kind has `mapMark: "tree"`. About 15 KB more on join in all.
- **`yaba.json` plan:**
  - `water`: the canal (x −183, 8 m wide, full length) and the pond (in YabaTech, between its lecture blocks and the library);
  - an icon on each landmark;
  - regenerate with `pnpm city`.

## Tests

- **Shared:**
  - `waterPieces` splits a canal at each crossing road and leaves a pond whole;
  - the obstacles include the water pieces but not the bridge decks;
  - the roof tone matches the street's roof colour.
- **Server:**
  - `checkLayout` refuses a road that only partly covers water, and a building, prop or place in the water;
  - the generated Yaba is still fully reachable (the existing check);
  - `pnpm city` is still deterministic.
- **Client:**
  - the water texture repeats seamlessly;
  - the map paints without errors in a headless run, checked with a screenshot.

## Performance

- **Water:** one draw call, plus the lips in the existing `Boxes` call.
- **Map:** still no GPU cost, about 2.5 MB more canvas memory.

Measure on the vivo Y29 standing on a bridge looking along the canal.

## Play-test checklist (vivo Y29)

1. Open the map: it looks like Yaba from the air. You can see roofs with shadows, trees, the canal and pond, and landmark badges. It is readable zoomed out and crisp zoomed in.
2. Walk to the canal: blue water with a concrete edge, gently moving; you cannot walk into it.
3. Cross a bridge on Commercial Avenue: parapets on both sides, and walkers and traffic cross normally.
4. YabaTech: the pond sits in the grounds between the blocks.
5. The meter shows no "late shaders", and frame rate as before.
