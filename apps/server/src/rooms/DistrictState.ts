import { schema, t } from "@colyseus/schema";

/** What other players need to draw someone: where they stand and how they look. Money and meters are never synced. */
export const PlayerPosition = schema(
  {
    x: t.number().default(0),
    z: t.number().default(0),
    /** `encodeAppearance` code, or "" before the player has made a character. Drawn from Phase 5. */
    appearance: t.string().default(""),
  },
  "PlayerPosition",
);

/** Synced state for one district instance, keyed by session id. */
export const DistrictState = schema(
  {
    districtId: t.string().default(""),
    players: t.map(PlayerPosition),
  },
  "DistrictState",
);
