"use client";

import type { Route } from "@japalife/shared";
import { useLayoutEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry } from "three";
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";
import { ribbonGeometry } from "./ribbon";

/**
 * The route picked on the map, drawn on the street. Always mounted (hidden
 * without a route) so its shader is warmed up at load like everything else.
 */
export function RouteRibbon({ route }: { route: Route | null }) {
  const geometry = useMemo(() => {
    // A hidden placeholder leg until there is a route, so there is always something to warm up.
    const { positions, indices } = ribbonGeometry(route?.points ?? [{ x: 0, z: 0 }, { x: 0, z: 1 }]);
    const ribbon = new BufferGeometry();
    ribbon.setAttribute("position", new BufferAttribute(positions, 3));
    ribbon.setIndex(new BufferAttribute(indices, 1));
    ribbon.computeBoundingSphere();
    return ribbon;
  }, [route]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} visible={route !== null} userData={{ [WARM_UP_WHILE_HIDDEN]: true }}>
      <meshBasicMaterial color="#ffc928" />
    </mesh>
  );
}
