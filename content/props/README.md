# props/

`kinds.json` defines every kind of street prop: how it looks and what of it blocks the player. A district in `cities/<city>.json` places props by kind (`props`), with a position, a quarter-turn `rotation`, an optional painted `label`, and a `wire` group for electric poles.

- **`look.built`**: drawn in code from coloured boxes at the declared size (no download, no extra draw call). Each shape has a builder in `apps/client/game/world/propShapes.ts`.
- **`look.model`**: a model from `models/catalog.json` at `scale` (built by `pnpm assets`), drawn instanced.
- **`blocks`**: `"footprint"` blocks the whole drawn footprint; a `{ halfWidth, halfDepth }` box blocks only that much (a trunk, a pole); `"none"` blocks nothing (speed bumps, umbrellas). The server refuses a blocking box bigger than what is drawn, and a blocking prop on a road, on a spawn or a place, or walling a place off.
