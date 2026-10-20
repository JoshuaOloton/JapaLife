# Slice 11 follow-up: the wardrobe screen

Asked for 2026-10-20 after 11f-3: a special screen for changing clothes instead of a close-up on the street, like other life sims have. Decided the same day: **a Lagos bedroom** (over a tailor's shop or a plain studio backdrop).

## What it is

- The character creator (first time and "Change clothes" at home) takes place in a bedroom set built around your character.
- The set is built in code from coloured boxes (`apps/client/game/bedroomSet.ts`), so there is no download, in one instanced draw call plus one for the ceiling fan. It contains:
  - pale blue painted walls with skirting, a tiled floor and a rug;
  - an open wardrobe with shirts on a rail and folded clothes;
  - a louvre ("naco") window with burglar bars and red curtains;
  - a standing mirror, a bed with a bright bedspread, a side table with a radio and a calendar;
  - a turning ceiling fan.
- While the creator is open:
  - the street is hidden (still simulated);
  - the lights switch to fixed warm indoor light (`Lighting`'s `indoors`), the same at any hour or during a power cut;
  - the camera cuts to the close-up under a short fade from black. A glide would pass through the walls.
- Dragging across the view turns your character round ("Drag to turn around" under the sheet's title).
- The room closes on every side, and its front wall stands just behind the close-up camera, so only the room is ever in view at any screen shape.

## Not in it

- The bedroom is not a place in the world: you still open "Change clothes" at home, and the room is only the screen's backdrop. A walk-in home interior would be its own slice.
- The fan keeps turning in a power cut, and the window does not follow the time of day (the curtains are fixed; the louvres are pale glass).

## Tests

- `bedroomSet.test.ts`: the character's spot is clear, everything is inside the walls, and the front wall is where the camera needs it.
- Checked in desktop Chrome: the room at night, drag to turn, the hint, the cut and fade.
