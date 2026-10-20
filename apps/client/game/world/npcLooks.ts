import type { NpcLookId } from "@japalife/shared";
import type { BodyType } from "../character/Character";
import type { BodyLook } from "../character/bodyMaterial";

/**
 * How each standing NPC looks. Presets until the character catalog (Slice 11d)
 * gives NPCs real appearances. Clothes are painted on, so they hug the body:
 * Mama Put's wrapper and the conductor's singlet are suggestions in colour only.
 */
export const NPC_LOOKS: Record<NpcLookId, { body: BodyType; look: BodyLook }> = {
  mama_put: {
    body: "female",
    look: {
      // An apron-coloured top over an Ankara-orange wrapper.
      outfit: { torso: "#e9e2cf", upperArm: "#e9e2cf", hips: "#d0662b", thigh: "#d0662b", calf: "#d0662b", foot: "#3b2a20" },
      skinTint: "#c79e84",
    },
  },
  okada_rider_a: {
    body: "male",
    look: {
      // A reflective vest over a dark shirt.
      outfit: { torso: "#d8e33a", upperArm: "#2b2f36", forearm: "#2b2f36", hips: "#3b3b3b", thigh: "#3b3b3b", calf: "#3b3b3b", foot: "#1f1f1f" },
      skinTint: "#b48a70",
    },
  },
  okada_rider_b: {
    body: "male",
    look: {
      outfit: { torso: "#e86f1c", upperArm: "#e86f1c", hips: "#4b5563", thigh: "#4b5563", calf: "#4b5563", foot: "#262626" },
      skinTint: "#d1aa8e",
    },
  },
  hawker: {
    body: "female",
    look: {
      outfit: { torso: "#2f7a55", upperArm: "#2f7a55", hips: "#6b3b8a", thigh: "#6b3b8a", calf: "#6b3b8a", foot: "#2a2a2a" },
      skinTint: "#bf957a",
    },
  },
  gateman: {
    body: "male",
    look: {
      // A security-company uniform: navy shirt and trousers.
      outfit: { torso: "#24365c", upperArm: "#24365c", forearm: "#24365c", hips: "#1d2433", thigh: "#1d2433", calf: "#1d2433", foot: "#111111" },
      skinTint: "#a98068",
    },
  },
  conductor: {
    body: "male",
    look: {
      // A singlet and shorts, ready to hang off a danfo door.
      outfit: { torso: "#f2f2ee", hips: "#3f5a2a", thigh: "#3f5a2a", foot: "#5a3b26" },
      skinTint: "#b8906f",
    },
  },
};
