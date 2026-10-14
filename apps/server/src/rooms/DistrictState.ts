import { schema, t } from "@colyseus/schema";

/** Synced state for one district instance. Players and entities arrive in later slices. */
export const DistrictState = schema(
  {
    districtId: t.string().default(""),
  },
  "DistrictState",
);
