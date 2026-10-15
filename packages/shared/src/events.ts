/** Random life events the server can fire at a player or a district (Phase 1). */
export const GAME_EVENT_IDS = ["black_tax", "power_cut"] as const;
export type GameEventId = (typeof GAME_EVENT_IDS)[number];
