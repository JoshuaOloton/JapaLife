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

/**
 * Synced state for one district instance, keyed by session id. Players are
 * filtered per client (`.view()`): each client gets only the players its
 * `StateView` holds, themselves and anyone within `PLAYER_VIEW_METRES`
 * (area of interest), so a full room costs no one 50 players' updates.
 */
export const DistrictState = schema(
  {
    districtId: t.string().default(""),
    players: t.map(PlayerPosition).view(),
  },
  "DistrictState",
);
