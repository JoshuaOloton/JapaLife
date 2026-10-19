/**
 * What the 3D scene needs to know from the server's stats to light the street:
 * the city's clock, whether it is night, and whether NEPA has taken light. The
 * HUD writes it (it receives the stats) and the scene reads it every frame, so
 * a stats update never re-renders the 3D view.
 */
export interface StreetState {
  /** Server time now, or null before the first stats arrive. */
  serverNow: (() => number) | null;
  timeZone: string | null;
  isNight: boolean;
  blackoutEndsAt: string | null;
}

export function initialStreet(): StreetState {
  return { serverNow: null, timeZone: null, isNight: false, blackoutEndsAt: null };
}
