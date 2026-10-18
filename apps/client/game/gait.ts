import { PLAYER_SPEED_UNITS_PER_SECOND } from "@japalife/shared";

/**
 * Walking and running (decided 2026-10-18). Players walk by default and run on
 * demand: a joystick pushed (almost) all the way, or Shift on a keyboard.
 *
 * The server knows nothing about gaits. It caps speed at
 * PLAYER_SPEED_UNITS_PER_SECOND and moves the player by the length of the
 * direction it is sent, so walking is just a shorter direction.
 */
export const RUN_SPEED = PLAYER_SPEED_UNITS_PER_SECOND;

/** A natural, purposeful walking pace in metres per second (world units are metres). */
export const WALK_SPEED = 1.8;

/** The direction length that walks: the share of the server's top speed. */
export const WALK_FRACTION = WALK_SPEED / RUN_SPEED;

/** How far the joystick must be pushed (0-1) to run. A little under 1, so a thumb at the rim always runs. */
export const RUN_PUSH = 0.9;

/** Above this speed the character looks like it is running; below, walking. Halfway between the two. */
export const RUN_LOOK_FROM_SPEED = (WALK_SPEED + RUN_SPEED) / 2;
