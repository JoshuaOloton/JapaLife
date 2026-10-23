import type { Interactable } from "@japalife/shared";

/** Each kind of place's colour: its sign board in the street, and its dot on the map. */
export const PLACE_COLOURS: Record<Interactable["kind"], string> = {
  home: "#7a4b2a",
  job_site: "#2f5d8a",
  food_vendor: "#b5432f",
  bus_stop: "#2f7a55",
  okada_park: "#c46a12",
  fuel_station: "#8a2f6a",
};
