"use client";

import { useLayoutEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import { type RouteStore, useRoute } from "../routeStore";
import { ribbonGeometry } from "./ribbon";

/** Where the stand-in strip lies with no route: under the ground, where nobody sees it. */
const OUT_OF_SIGHT = -5;

/**
 * The route picked on the map, drawn on the street. It listens to the route
 * itself, so picking one re-renders only this.
 *
 * Without a route it still draws a tiny strip under the ground, every frame.
 * Its plain material is the only one of its kind, and a shader warmed up but
 * never drawn still finishes compiling on its first draw on phones without
 * parallel compiling: that was a freeze the first time a route was picked.
 * Drawn from the start, the shader is ready before play. One tiny draw call.
 */
export function RouteRibbon({ routes }: { routes: RouteStore }) {
  const route = useRoute(routes);
  const geometry = useMemo(() => {
    const { positions, indices } = ribbonGeometry(route?.points ?? [{ x: 0, z: 0 }, { x: 0, z: 1 }]);
    if (!route) for (let index = 1; index < positions.length; index += 3) positions[index] = OUT_OF_SIGHT;
    const ribbon = new BufferGeometry();
    ribbon.setAttribute("position", new BufferAttribute(positions, 3));
    ribbon.setIndex(new BufferAttribute(indices, 1));
    ribbon.computeBoundingSphere();
    return ribbon;
  }, [route]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return (
    // Never culled: the stand-in under the ground must still be drawn to keep its shader ready.
    <mesh geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial color="#ffc928" />
    </mesh>
  );
}
