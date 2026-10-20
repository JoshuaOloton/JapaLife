# Plan: Slice 11f, "Nigerian assets (DIY)"

Approved 2026-10-20. Part of [Slice 11](slice-11-look-and-feel.md).

## Context

Yaba now looks, moves and dresses like Lagos, but with stand-ins:
- the danfo is a repainted Car Kit van;
- keke and okada are stacks of boxes;
- hair is low cut or bald;
- clothes are plain colours;
- five buildings (buka, fuel station, bus shelter, market, church) are painted boxes.

11f makes these ourselves, for free, as planned in [Slice 11](slice-11-look-and-feel.md) (decided 2026-10-17: Nigerian items made in Blender or painted in code; original designs only). Blender 5.2.2 LTS is installed.

Decided 2026-10-20:
- **Four parts, one at a time.** Each is built, previewed, committed and play-tested on the vivo Y29 before the next starts, so the art direction is judged early.
  1. **11f-1 vehicles**
  2. **11f-2 hairstyles**
  3. **11f-3 Ankara**
  4. **11f-4 buildings**
- **New hairstyles: cornrows and fade** (with low cut and bald, four in all). Afro, puff, locs, braids and headwrap are later catalog additions.
- **Ankara: original patterns on shirts and senators, plus one modelled dress.**

Branch `feat/nigerian-assets` from `feat/moving-life` (11c–11e are not merged yet).

## How Blender is used (no clicking)

Blender has a full Python API (`bpy`) and runs without its window: `blender --background --python script.py` builds a scene from code, saves it, and exports a GLB. So every model we make is **a Python script in the repo**, not a hand-edited file:

- **`assets/blender/`** (committed): one script per model (`danfo.py`, `keke.py`, `okada.py`, ...), plus `lib/`:
  - the shared palette, a small colour-swatch texture like KayKit's, so every model shares one material and stays cheap;
  - shape helpers: boxes, bevelled boxes, cylinders, wheels;
  - skinning helpers: bind a mesh to the character skeleton by bone;
  - export and preview helpers.
- **`pnpm blender [names]`** (new root script): runs each script headless with `--factory-startup`, so your Blender settings never change the result. It writes:
  - the raw GLB to `assets/built/` (git-ignored, like `assets/vendor/`);
  - a `.blend` you can open in the Blender window to look around;
  - a **preview render** (PNG from the game camera's angle) that I look at to check proportions before anything reaches the game.

  Blender's location comes from `BLENDER` or the default app path; the script fails clearly if Blender is missing.
- **`pnpm assets`** then treats `assets/built/` like any other pack: Draco, KTX2, the measured footprint in the model catalog. Nothing in the game changes how it loads models.
- **Why code, not hand modelling:** reproducible (rerun and get the same file), reviewable in git diffs, tweakable by changing a number, and buildable by me without operating the GUI. You can still open the `.blend` to inspect or adjust; anything worth keeping goes back into the script.
- **Licences:** everything is generated from our own code. Ankara patterns are original designs, never copies of Vlisco or other prints.

## 11f-1 Vehicles (first)

- **Danfo:** a Lagos minibus about 4.6 × 1.9 × 2.0 m.
  - Danfo yellow with the two black stripes, a sliding-door line and dark windows.
  - A roof rack, black bumpers and wheels.
  - Replaces the repainted van.
- **Keke napep:** about 2.7 m long; yellow with a green band, a black canopy on posts, three wheels, and the driver modelled in.
- **Okada:** a small motorbike with a modelled seated rider in a reflective vest (static, so it stays one instanced mesh, like the cars).
  - A riderless **parked okada** variant becomes a prop kind, parked beside the two riders on their bench at the junction, as decided in 11c.
- **Content:** in `traffic/kinds.json`, danfo, keke and okada switch to `{ model }` looks. The code-built vehicle path (`vehicleShapes.ts`, `built` vehicle looks) and the van repaint (`vehiclePaint.ts`, catalog `paint`) are removed, since nothing uses them. A danfo with no repaint needs neither.
- **Cost:** each model is a few hundred triangles and about 10–25 KB. Draw calls fall slightly: kekes and okadas join the per-model instanced meshes, and the shared box mesh goes.

## 11f-2 Hairstyles: cornrows and fade

- Blender script: a thin **scalp cap** per body, shrink-wrapped to that body's head and skinned to the head bone.
  - It is exported like the pack hair, so `Character.tsx` re-binds it by bone name as it does today.
  - One cap mesh per body serves every close style.
- The **pattern is painted in code** on a small canvas, like the signboards (`world/paint.ts`): cornrow rows (parallel braided lines from forehead to nape) and a fade (dense top, thinning to skin at the sides). It is tinted by the chosen hair colour. That's zero texture download.
- Catalog: `hairs` gain `cornrows` and `fade` with `parts` (the cap per body) and a `pattern` id. `characterCatalogSchema` gets the optional `pattern`, and the creator lists them as starters.

## 11f-3 Ankara

- **`world/ankara.ts`** (pure, seeded, tested): 8 original patterns, each a recipe of motif (concentric circles, diamonds, leaves, waves, stripes, dots), layout and 3–4 colours. They are painted at load onto a 256 px tiling canvas, so there is no download.
- **Body shader** (`bodyMaterial.ts`): a region can take a pattern instead of a flat colour. It samples the tiling pattern texture with the body's own UVs, repeated, with seams accepted at this camera distance.
- **Catalog:** `outfitColours` entries may be a `pattern` instead of a `colour`, so the creator's colour row offers the 8 patterns next to the flat colours on shirt-type outfits.
- **The dress:** a Blender skirt piece per body, skinned to the pelvis and thighs with automatic weights, attached like hair. A new outfit, "Ankara dress", has a patterned top plus the skirt.
  - Catalog outfits gain an optional `piece` (model per body).
  - `loadContent` checks the piece exists and fits both bodies.

## 11f-4 Buildings

The buka, fuel station, bus shelter, market and church become modelled buildings, replacing their boxes:
- **Buka:** a wooden shed with a zinc roof, benches and big pots.
- **Fuel station:** a kiosk under a canopy on pillars. The canopy is its own prop kind that blocks only at its pillars; the building's footprint is the kiosk.
- **Bus shelter:** yellow.
- **Market:** stalls, umbrellas and tarpaulins.
- **Church:** white, with a cross and a signboard.

They follow the 11b rules: the footprint is resized to the scaled model, and the content check refuses a model that doesn't fill it. Window glass uses a palette cell recorded as `windows`, so they glow at night like the other models.

## Pipeline and code (all parts)

- `package.json`: `blender` script. `assets/blender/run.mjs` finds Blender, runs each script, and reports.
- `.gitignore`: `assets/built/`.
- `apps/client/scripts/assets/build.mts`: `STATIC_MODELS` and `HAIRS` entries pointing at `assets/built/`.
- Shared: the catalog additions (hair `pattern`, outfit-colour `pattern`, outfit `piece`), with their checks in `loadContent`.
- Client: the hair pattern texture; Ankara patterns and the body shader's pattern regions; the dress piece in `Character.tsx` (attached like hair).

## Tests

- Unit:
  - Ankara and hair pattern generators are deterministic and tile seamlessly (edge pixels match);
  - catalog schemas accept the new fields;
  - `resolveLook` resolves patterns and pieces.
- Content:
  - the new models exist and fill their footprints;
  - the dress piece and caps fit both bodies;
  - the canopy prop blocks only at its pillars;
  - the real content passes.
- Blender scripts are checked by running them and looking at their previews (each part's preview PNGs go in the commit message's PR, not the repo).

## Verification (each part)

- `pnpm blender`, `pnpm assets`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm budget`.
- I check the preview renders, then the game in desktop Chrome.
- You play-test on the vivo Y29 with `?fps`. "Good":
  - **11f-1:** danfos, kekes and okadas read as Lagos at a glance, the parked okadas sit by the riders, and draw calls are no higher than 45.
  - **11f-2:** cornrows and fade look right on both bodies in the creator and on the street.
  - **11f-3:** patterns read as Ankara (bold, wax-print feel), and the dress moves with the legs without poking through.
  - **11f-4:** each building is recognisable, the doors are at human scale, and windows glow at night.
- Budget: Yaba stays ≤ 6 MB and characters ≤ 1.5 MB (11g makes these hard limits).
