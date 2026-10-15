export const CURRENCIES = ["NGN", "GBP", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * Largest balance or single movement any wallet may hold, in smallest units
 * (kobo, pence, cents). Kept below Number.MAX_SAFE_INTEGER so a balance can
 * cross the wire as a plain JSON number. Money is a bigint everywhere else.
 */
export const MAX_WALLET_BALANCE = 1_000_000_000_000_000n;

/** Colyseus room name for a walkable district instance. */
export const DISTRICT_ROOM_NAME = "district";

export const DEFAULT_SERVER_PORT = 2567;
export const DEFAULT_CLIENT_PORT = 3000;

/** Players per district-instance room; further players queue. */
export const MAX_PLAYERS_PER_ROOM = 50;

/** Client position updates per second (CLAUDE.md: 10-20 Hz). */
export const POSITION_UPDATE_HZ = 15;

/** How fast a player walks, in world units per second. The server enforces it. */
export const PLAYER_SPEED_UNITS_PER_SECOND = 4;

/** Cap on devicePixelRatio for low-end Android GPUs. */
export const MAX_DEVICE_PIXEL_RATIO = 1.5;
