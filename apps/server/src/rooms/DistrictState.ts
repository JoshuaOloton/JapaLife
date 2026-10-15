import { schema, t } from "@colyseus/schema";

/** What other players need to draw someone: where they stand. Money and meters are never synced. */
export const PlayerPosition = schema(
  {
    x: t.number().default(0),
    z: t.number().default(0),
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
