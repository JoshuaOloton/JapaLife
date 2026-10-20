# characters/

`catalog.json` lists every option a character can have: bodies, skin tones, hairstyles, hair colours, outfits and outfit colours. Players and NPCs store only the ids (`appearanceSchema` in `packages/shared/src/appearance.ts`).

- `starter` (default `true`) marks what the character creator offers for free. NPC clothes, and later shop items, are `"starter": false`.
- Bodies are shown as "Body 1" / "Body 2", with no gender label; every hair and outfit must fit both.
- A hair's `parts` name a model per body from `models/catalog.json` (built by `pnpm assets`); bald has none.
- Clothes are painted onto body regions: `chosen` regions take the outfit colour, `fixed` regions keep their own. Every outfit must cover `torso` and `hips`.
- Removing an option is safe: a stored character falls back to `defaults` for that slot.
