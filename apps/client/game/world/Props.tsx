"use client";

import type { DistrictLayout, ModelInfo, Prop } from "@japalife/shared";
import { useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import { paintSign } from "./paint";
import { type PropLabel, palmFronds, propLabels, wireSegments } from "./propShapes";

/**
 * The street props that are not plain boxes (those join the world's `Boxes`
 * call, see `propShapes.ts`): pack models, palm fronds, electric wires and painted
 * shop signs and adverts. Every copy of a pack model is drawn by one instanced
 * mesh per kind, so a row of trees costs one draw call.
 */
export function Props({ layout }: { layout: DistrictLayout }) {
  const byModel = useMemo(() => modelPlacements(layout), [layout]);
  const labels = useMemo(() => propLabels(layout), [layout]);
  return (
    <>
      {[...byModel].map(([kindId, { model, scale, tint, props }]) => (
        // No stand-in while a model downloads: props arrive after the street is already on screen.
        <ModelBoundary key={kindId} fallback={null}>
          <Suspense fallback={null}>
            <InstancedModel model={model} scale={scale} tint={tint} props={props} />
          </Suspense>
        </ModelBoundary>
      ))}
      <PalmFronds layout={layout} />
      <Wires layout={layout} />
      {labels.map((label, index) => (
        <LabelFace key={index} label={label} />
      ))}
    </>
  );
}

interface ModelPlacements {
  model: ModelInfo;
  scale: number;
  tint: string | undefined;
  props: Prop[];
}

function modelPlacements(layout: DistrictLayout): Map<string, ModelPlacements> {
  const byKind = new Map<string, ModelPlacements>();
  for (const prop of layout.props) {
    const look = layout.propKinds[prop.kind]?.look;
    if (!look || !("model" in look)) continue;
    const model = layout.models[look.model];
    if (!model) continue;
    const entry = byKind.get(prop.kind) ?? { model, scale: look.scale, tint: look.tint, props: [] };
    entry.props.push(prop);
    byKind.set(prop.kind, entry);
  }
  return byKind;
}

/** Every placement of one model, as one instanced mesh per mesh in the model (usually just one). */
function InstancedModel({ model, scale, tint, props }: ModelPlacements) {
  const gl = useThree((three) => three.gl);
  const gltf = useLoader(GLTFLoader, `${ASSET_ROOT}/${model.file}`, withDecoders(gl));

  const group = useMemo(() => {
    const root = new Group();
    gltf.scene.updateMatrixWorld(true);
    const placement = new Matrix4();
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      // Lambert, not the glTF's physically based material: far cheaper on a weak GPU.
      const original = object.material as MeshStandardMaterial;
      const material = new MeshLambertMaterial({ map: original.map, color: original.color.clone() });
      if (tint) material.color.multiply(new Color(tint));
      const instanced = new InstancedMesh(object.geometry, material, props.length);
      props.forEach((prop, index) => {
        turn.setFromAxisAngle(up, (prop.rotation * Math.PI) / 180);
        placement.compose(new Vector3(prop.x, 0, prop.z), turn, new Vector3(scale, scale, scale));
        instanced.setMatrixAt(index, placement.multiply(object.matrixWorld));
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      root.add(instanced);
    });
    return root;
  }, [gltf, props, scale, tint]);

  // Geometry and textures belong to the loader's cache; only the materials are ours.
  useEffect(
    () => () =>
      group.traverse((object) => {
        if (object instanceof InstancedMesh) (object.material as MeshLambertMaterial).dispose();
      }),
    [group],
  );

  return <primitive object={group} />;
}

/** A frond's shape: a flat, tapering leaf, pointing along +z from its base. */
function frondGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  // Two triangles: wide near the base, narrowing to a tip at z = 1.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-0.18, 0, 0.15, 0.18, 0, 0.15, 0, 0, 1, -0.18, 0, 0.15, 0, 0, 0, 0.18, 0, 0.15], 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Every palm's fronds in one draw call. */
function PalmFronds({ layout }: { layout: DistrictLayout }) {
  const fronds = useMemo(() => palmFronds(layout), [layout]);
  const geometry = useMemo(frondGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    placer.rotation.order = "YXZ"; // turn to face its direction first, then droop
    fronds.forEach((frond, index) => {
      placer.position.set(frond.x, frond.y, frond.z);
      placer.rotation.set(frond.droop, frond.yaw, 0);
      placer.scale.set(frond.length, 1, frond.length);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [fronds]);

  if (fronds.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, fronds.length]} key={fronds.length}>
      <meshLambertMaterial color="#4f7a2c" side={DoubleSide} />
    </instancedMesh>
  );
}

/** All the electric wires in one draw call. */
function Wires({ layout }: { layout: DistrictLayout }) {
  const geometry = useMemo(() => {
    const lines = new BufferGeometry();
    lines.setAttribute("position", new Float32BufferAttribute(wireSegments(layout), 3));
    return lines;
  }, [layout]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#1b1b1b" />
    </lineSegments>
  );
}

/** Pixels per metre for painted faces: sharp enough to read from the street camera. */
const LABEL_PIXELS_PER_METRE = 80;

function LabelFace({ label }: { label: PropLabel }) {
  const texture = useMemo(() => {
    const width = Math.min(512, Math.round(label.width * LABEL_PIXELS_PER_METRE));
    const height = Math.max(32, Math.round((width * label.height) / label.width));
    return paintSign(label.text, { background: label.background, text: label.ink, width, height, maxLines: label.lines });
  }, [label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[label.x, label.y, label.z]} rotation-y={label.rotationY}>
      <planeGeometry args={[label.width, label.height]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  );
}
