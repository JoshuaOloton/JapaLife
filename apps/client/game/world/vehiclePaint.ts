import { Color, type MeshLambertMaterial } from "three";

/**
 * Repaints a vehicle model's body without a new texture: the pipeline records
 * which cells of the colour sheet are body paint (`paint` in the model
 * catalog), the geometry flags the triangles painted from them
 * (`flagUvCells`), and a few lines added to the Lambert shader paint those
 * triangles one colour, with an optional band across the body. That turns the
 * Car Kit's blue van into a yellow danfo with its black stripe.
 */

export const BODY_PAINT_ATTRIBUTE = "bodyPaint";

export interface BodyPaint {
  paint: string;
  /** A band across the body, in the model's own height units (from its base). */
  stripe?: { colour: string; from: number; to: number } | undefined;
}

export function addBodyPaint(material: MeshLambertMaterial, { paint, stripe }: BodyPaint): void {
  const paintColour = new Color(paint);
  const stripeColour = new Color(stripe?.colour ?? paint);
  // No stripe: an empty band nothing falls inside.
  const band = stripe ? [stripe.from, stripe.to] : [1, 0];
  material.onBeforeCompile = (shader) => {
    shader.uniforms["paintColour"] = { value: paintColour };
    shader.uniforms["stripeColour"] = { value: stripeColour };
    shader.uniforms["stripeFrom"] = { value: band[0] };
    shader.uniforms["stripeTo"] = { value: band[1] };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${BODY_PAINT_ATTRIBUTE};\nvarying float vBodyPaint;\nvarying float vModelY;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvBodyPaint = ${BODY_PAINT_ATTRIBUTE};\nvModelY = position.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 paintColour;\nuniform vec3 stripeColour;\nuniform float stripeFrom;\nuniform float stripeTo;\nvarying float vBodyPaint;\nvarying float vModelY;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nif (vBodyPaint > 0.5) diffuseColor.rgb = (vModelY > stripeFrom && vModelY < stripeTo) ? stripeColour : paintColour;",
      );
  };
  material.customProgramCacheKey = () => "vehicle-paint";
}
