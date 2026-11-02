# rules/

Real-world rule values, each with a `source` URL, an `asOf` date and a `status` (`active` or `proposed`). Money is in the smallest unit (kobo, pence, cents) at its **real** value; the game charges it times `moneyScaleBp` from `pacing.json`. Waits are real days too, and the game makes the player wait `waitScaleBp` of them, never more than `maxWaitDays` (7); the sheet shows the real figure beside the game one.

- `nigeria.json`: fee, wait and validity of each Nigerian document (NIN, passport so far). A value we are unsure of carries a `todo` note, printed at server start.
- `pacing.json`: the game-balance factors between real fees and what the game charges (`moneyScaleBp`), and between real waits and how long the player waits (`waitScaleBp`).
- `canada.json` and `uk.json`: to come with the routes.
