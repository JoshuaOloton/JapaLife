/**
 * Portrait phones are narrow, so a fixed field of view shows only a sliver of
 * street. The view must stay at least this wide (half-angle, horizontally): first
 * the field of view widens up to a limit (beyond it things look fish-eyed), then
 * the camera pulls back.
 */
const MIN_HORIZONTAL_HALF_FOV = (28 * Math.PI) / 180;
const BASE_VERTICAL_HALF_FOV = (25 * Math.PI) / 180;
const MAX_VERTICAL_HALF_FOV = (37.5 * Math.PI) / 180;

/** The camera's vertical field of view (degrees) and how far to pull it back, for a screen shape. */
export function fitCamera(aspect: number): { fov: number; distanceScale: number } {
  const needed = Math.tan(MIN_HORIZONTAL_HALF_FOV) / aspect;
  const chosen = Math.min(Math.tan(MAX_VERTICAL_HALF_FOV), Math.max(Math.tan(BASE_VERTICAL_HALF_FOV), needed));
  return { fov: (2 * Math.atan(chosen) * 180) / Math.PI, distanceScale: Math.max(1, needed / chosen) };
}
