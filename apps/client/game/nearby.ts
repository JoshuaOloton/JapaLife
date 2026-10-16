import { type Interactable, type Point, distanceBetween } from "@japalife/shared";

/**
 * The closest place within `radius` of the player, for the "use" button. The
 * server runs its own check when the intent arrives, so this only decides
 * which button to show.
 */
export function nearestPlace(
  position: Point,
  places: readonly Interactable[],
  radius: number,
): Interactable | undefined {
  let best: Interactable | undefined;
  let bestDistance = radius;
  for (const place of places) {
    const distance = distanceBetween(position, place.position);
    if (distance <= bestDistance) {
      best = place;
      bestDistance = distance;
    }
  }
  return best;
}
