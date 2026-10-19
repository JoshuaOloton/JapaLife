/**
 * The light over Lagos through the day, from the city's local time on the
 * server clock: a hazy blue midday, a warm late afternoon, an orange dusk and
 * a dark blue night. Keyframes are blended, so the light changes smoothly.
 *
 * Lighting is two cheap lights (a sky/ground hemisphere and one "sun") and
 * fog in the sky's colour; no shadows, per the performance budget.
 */

export interface SkyLook {
  /** Background and fog colour. */
  sky: string;
  /** Hemisphere light: colour from above, colour bounced off the ground, strength. */
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColour: string;
  sunIntensity: number;
  /** 0 by day, 1 at full night: how strongly lit windows glow. */
  darkness: number;
}

interface Keyframe extends SkyLook {
  hour: number;
}

const NIGHT: Omit<Keyframe, "hour"> = {
  sky: "#0f1a33",
  hemiSky: "#5a6f9e",
  hemiGround: "#2a2320",
  hemiIntensity: 0.55,
  sunColour: "#8fa6d8",
  sunIntensity: 0.35,
  darkness: 1,
};

const DAY: Omit<Keyframe, "hour"> = {
  sky: "#c4dcea",
  hemiSky: "#ffffff",
  hemiGround: "#9a5a3c",
  hemiIntensity: 1.5,
  sunColour: "#fff4e0",
  sunIntensity: 1.5,
  darkness: 0,
};

/** Lagos is near the equator: the sun rises about 6:45 and sets about 19:00 all year. */
const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, ...NIGHT },
  { hour: 5.5, ...NIGHT },
  { hour: 6.5, sky: "#e9b48c", hemiSky: "#ffd9b8", hemiGround: "#6a4030", hemiIntensity: 1, sunColour: "#ffb37a", sunIntensity: 0.9, darkness: 0.4 },
  { hour: 8, ...DAY },
  { hour: 15.5, ...DAY },
  { hour: 17.5, sky: "#efd2a2", hemiSky: "#fff0d6", hemiGround: "#9a5a3c", hemiIntensity: 1.35, sunColour: "#ffd08a", sunIntensity: 1.4, darkness: 0 },
  { hour: 18.6, sky: "#e48a52", hemiSky: "#ffc59a", hemiGround: "#6a3a2a", hemiIntensity: 1, sunColour: "#ff8a4a", sunIntensity: 0.9, darkness: 0.5 },
  { hour: 19.5, ...NIGHT },
  { hour: 24, ...NIGHT },
];

/** The look at a local hour of day (0 to 24, fractional). */
export function skyAt(hour: number): SkyLook {
  const h = ((hour % 24) + 24) % 24;
  const nextIndex = KEYFRAMES.findIndex((frame) => frame.hour > h);
  const next = KEYFRAMES[nextIndex] ?? NIGHT_END;
  const previous = KEYFRAMES[nextIndex - 1] ?? NIGHT_START;
  const t = (h - previous.hour) / (next.hour - previous.hour);
  return {
    sky: mixColour(previous.sky, next.sky, t),
    hemiSky: mixColour(previous.hemiSky, next.hemiSky, t),
    hemiGround: mixColour(previous.hemiGround, next.hemiGround, t),
    hemiIntensity: mix(previous.hemiIntensity, next.hemiIntensity, t),
    sunColour: mixColour(previous.sunColour, next.sunColour, t),
    sunIntensity: mix(previous.sunIntensity, next.sunIntensity, t),
    darkness: mix(previous.darkness, next.darkness, t),
  };
}

const NIGHT_START: Keyframe = { hour: 0, ...NIGHT };
const NIGHT_END: Keyframe = { hour: 24, ...NIGHT };

/**
 * Where the sun light comes from, as a direction (not normalised). It rises in
 * the east (+x), passes high over the south (+z, behind the camera, so the
 * fronts the player sees are lit) and sets in the west. At night it is a fixed,
 * dim moon.
 */
export function sunDirection(hour: number): [number, number, number] {
  const h = ((hour % 24) + 24) % 24;
  if (h < 6 || h > 19) return [-10, 30, 20];
  const arc = ((h - 6) / 13) * Math.PI; // 0 at sunrise, pi at sunset
  return [Math.cos(arc) * 40, 8 + Math.sin(arc) * 40, 18];
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local hour (fractional) in `timeZone` at `now` (server time, never the device clock). */
export function localHour(now: number, timeZone: string): number {
  let format = hourFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
    hourFormatters.set(timeZone, format);
  }
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  for (const part of format.formatToParts(now)) {
    if (part.type === "hour") hours = Number(part.value);
    if (part.type === "minute") minutes = Number(part.value);
    if (part.type === "second") seconds = Number(part.value);
  }
  return hours + minutes / 60 + seconds / 3600;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColour(a: string, b: string, t: number): string {
  const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  let out = "#";
  for (let index = 0; index < 3; index++) {
    out += Math.round(mix(channel(a, index), channel(b, index), t)).toString(16).padStart(2, "0");
  }
  return out;
}
