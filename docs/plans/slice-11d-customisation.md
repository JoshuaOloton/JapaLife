# Plan: Slice 11d, "Customisation"

Approved 2026-10-20. Part of [Slice 11](slice-11-look-and-feel.md).

## Context

Everyone in Yaba is the same man in a red shirt: the player, and the six NPCs only differ by hard-coded colour presets (`world/npcLooks.ts`). 11d lets the player make their own character the first time they play, and change clothes for free at home, as planned in [Slice 11](slice-11-look-and-feel.md) (decided 2026-10-17: a free starter set now; extra outfits are shop items later, as a money sink). The appearance is stored on the server (it is game state), validated like every other intent, and carried in the synced player state so Phase 5 can draw other players with no protocol change.

Decided 2026-10-20:
- **Hair for now: low cut and bald.** Only the free pack's buzzed mesh (one per body) and no mesh. Cornrows, braids, locs, afro and headwrap come in 11f, as catalog entries with no code change.
- **Two unlabelled bodies that mix freely**: shown as "Body 1" / "Body 2" pictures, no gender label; every hair and outfit fits both.
- **Outfit plus colour**: pick an outfit, then a colour for it from a small palette.

Already approved in the Slice 11 plan (2026-10-17): the `PlayerAppearance` table. It is cosmetic avatar data (ids only: no name, photo or age), not the ledger, auth or payments.

Branch `feat/customisation` from `feat/street-life` (11c is not merged yet).

## Appearance and the catalog

**Shape** (`packages/shared/src/appearance.ts`): `appearanceSchema = { body, skinTone, hair, hairColour, outfit, outfitColour }`, ids only. `encodeAppearance` / `decodeAppearance` join the ids with `.` (ids never contain dots), for the synced player state.

**Catalog** `content/characters/catalog.json`, validated by `characterCatalogSchema` and loaded by `loadContent`. Option names are content (like food names), so they live here, not in `en.json`:
- `bodies`: `body-1` → model files `male`, `body-2` → `female` (the pipeline's file names stay as they are).
- `skinTones`: 8 swatches (`tint` hex), covering the full range of Nigerian complexions, shown as swatches only.
- `hairs`: `low-cut` (part per body: `hair-buzzed`, `hair-buzzed-female`) and `bald` (no part). Each part is a model id the pipeline writes into `content/models/catalog.json`, so the server checks it exists.
- `hairColours`: 5 (black, dark brown, brown, grey, dyed blonde).
- `outfits`: which body regions take the chosen colour, plus fixed colours for the rest (painted on, so close-fitting only). Starter: T-shirt and jeans, office shirt and trousers, senator (top and trousers in the chosen colour), plain football jersey and shorts. Each must cover `torso` and `hips` (checked).
- `outfitColours`: about 8.
- `starter: true` on everything the creator offers. The NPCs' outfits (Mama Put's apron and wrapper, the riders' vests, the gateman's uniform, the conductor's singlet) join the catalog as `starter: false`, so `npcLooks.ts` goes away and NPCs use real appearances in `lagos.json`.
- `defaults`: the fallback per slot.

**Validation**, one pure shared function, `appearanceProblem(appearance, catalog, { starterOnly })`. The server uses it for `setAppearance`, and `loadContent` uses it for every NPC's look. On read, an id no longer in the catalog falls back to that slot's default (`resolveAppearance`), so a catalog change never breaks a player.

## Server

- **DB** (`packages/db/prisma/schema.prisma`): `PlayerAppearance { playerId @id, body, skinTone, hair, hairColour, outfit, outfitColour, updatedAt }`, related to `Player`. Migration `add_player_appearance`, then `pnpm db:generate`.
- **`AppearanceService`** (`apps/server/src/game/appearance.ts`, with tests):
  - `get(playerId)` returns the resolved appearance, or null if they never made a character.
  - `set(playerId, appearance, position, district)`:
    - rejects unknown ids, and anything not `starter` (`not_owned`);
    - the first time, it is allowed anywhere (the creator);
    - after that, the player must be within `interactRadius` of a `home` place (`DistrictMap.nearest`), else `not_at_home`;
    - then upserts.
- **Intent**: `setAppearance` in `packages/shared/src/intents.ts` (the full appearance, ids only). It goes through `parseIntent`, the token bucket and the per-player `KeyedMutex`, like every intent. A new `case` in `DistrictRoom.execute` replies with the `appearance` message and updates the player's synced code.
- **Messages** (`packages/shared/src/messages.ts`): `SERVER_MESSAGES.appearance` carries `{ appearance: Appearance | null }`, sent on join after `district` and after every `setAppearance`. The catalog reaches the client in the `DistrictLayout` (`characters`), since NPCs need it to draw and the client has no copy of `content/`. New rejection reasons: `not_owned`, `not_at_home`.
- **Synced state**: `PlayerPosition.appearance: t.string()` (the encoded code), set on join and on change. Unused until Phase 5.

## Client

- **`character/appearance.ts`** (pure, tested): appearance + catalog → body file, hair part file (or none), hair colour, and the `BodyLook` (skin tint, region colours).
- **`Character.tsx`**: takes the resolved look; hair becomes optional (bald loads no hair file) and its colour comes from the look. The body, hair and clip downloads are unchanged: still about 530 KB.
- **`CharacterCreator.tsx`** (a DOM sheet over the game, not a second 3D canvas, which would double GPU memory):
  - rows of swatches and buttons for body, skin, hair, hair colour, outfit and outfit colour;
  - changes preview live on your own character (local only), with the camera moved in close and the character turned to face it, and movement paused;
  - "Done" sends `setAppearance`; the server's `appearance` reply is the truth.
  - It opens after the welcome/18+ screen when the server says you have no appearance (it can't be dismissed then), and from "Change clothes" on the home place sheet (with Cancel).
- **`connection.ts`**: register `appearance` in `MessageBuffer`.
- **`PlacePanel.tsx`**: a "Change clothes" button at home.
- **NPCs**: `world/Npcs.tsx` resolves each NPC's catalog appearance; `npcLooks.ts` is deleted.
- **Copy** (`content/copy/en.json` + `copySchema`): creator title, row labels, "Body 1"/"Body 2", Done, Cancel, Change clothes, and the two rejection messages.

## Pipeline

`build.mts` adds the two hair GLBs to `content/models/catalog.json` (folder `characters`), so the character catalog can reference them by id and `loadContent` can check them. No new downloads.

## Tests

- **Shared:**
  - the appearance and catalog schemas;
  - `appearanceProblem` refuses unknown ids and non-starter items under `starterOnly`;
  - `resolveAppearance` falls back per slot on a removed id;
  - encode/decode round trip.
- **Server:**
  - `AppearanceService`: first save allowed anywhere; a later change refused away from home and accepted at home; non-starter refused; a fallback is used on read.
  - `loadContent`: refuses a hair part missing from the model catalog, an outfit that leaves `torso` or `hips` bare, and an NPC with an unknown look.
  - Room: `setAppearance` replies `appearance` and updates the synced code.
- **Client:** `appearance.ts` resolves regions and colours; bald loads no hair part.

## Docs

- `docs/known-limits.md`, Client: the appearance model, first-time creator vs change at home, catalog in the layout, NPCs on catalog looks, hair limited to low cut and bald until 11f.
- CLAUDE.md:
  - 11d row status;
  - `content/characters/` in the repo layout;
  - a "Content" rule: "Appearance options live in `content/characters/catalog.json`; check every appearance with `appearanceProblem`."

## Verification

- `pnpm db:migrate` (`add_player_appearance`) then `pnpm db:generate`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm budget`. Restart the server and `next dev` (shared and content change).
- On the vivo Y29 with a fresh browser (new dev player): the creator opens after the welcome screen; every choice previews instantly on your character; Done takes you into Yaba looking that way; reloading the page keeps the look (it is stored on the server).
- Walk away from home and nothing offers a change; at your room, "Change clothes" opens the creator with Cancel. NPCs look as before (now from the catalog).
- `?fps` stays about the same: no new downloads or draw calls.
