# content/

Game data, kept out of code. Subfolders: `cities/`, `rules/`, `documents/`, `events/`, `refusals/`, `economy/`.

Every rule value (fees, thresholds, proof-of-funds amounts, processing times) carries a `source` URL and an `asOf` date. Rules that are proposed but not yet law carry `status: "proposed"`. Money is stored as integers in the smallest unit (kobo, pence, cents).
