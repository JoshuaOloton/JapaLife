"use client";

import type { Box, DistrictLayout, ModelInfo, Point, Prop } from "@japalife/shared";
import { useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  type CanvasTexture,
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
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";
import { ChunkIndex, DRAW_REACH, LABEL_REACH, areaBox, pointBox, useCapacity } from "./area";
import { paintSign } from "./paint";
import { type Frond, type PropLabel, palmFronds, propLabels, wireSegments } from "./propShapes";

/**
 * The street props that are not plain boxes (those join the world's `Boxes`
 * call, see `propShapes.ts`): pack models, palm fronds, electric wires and painted
 * shop signs and adverts. Every copy of a pack model is drawn by one instanced
 * mesh per kind, so a row of trees costs one draw call, and each mesh holds
 * only the props near the player (`area.ts`), refilled as they walk.
 */
export function Props({ layout, centre }: { layout: DistrictLayout; centre: Point }) {
  const byModel = useMemo(() => modelPlacements(layout), [layout]);
  const fronds = useMemo(() => new ChunkIndex(palmFronds(layout).map(pointBox)), [layout]);
  const frondCapacity = useCapacity(fronds.all.length);
  const labels = useMemo(() => new ChunkIndex(propLabels(layout).map(pointBox)), [layout]);
  // Kept for the whole visit, not per set of chunks: a shop's sign is painted once.
  const textures = useMemo(() => new LabelTextures(), []);
  useEffect(() => () => textures.dispose(), [textures]);

  const drawArea = useMemo(() => areaBox(centre, DRAW_REACH), [centre]);
  const nearProps = useMemo(
    () => new Map([...byModel].map(([kindId, placements]) => [kindId, placements.index.within(drawArea)])),
    [byModel, drawArea],
  );
  const nearFronds = useMemo(() => fronds.within(drawArea), [fronds, drawArea]);
  const nearLabels = useMemo(() => labels.within(areaBox(centre, LABEL_REACH)), [labels, centre]);

  return (
    <>
      {[...byModel].map(([kindId, { model, scale, tint, index }]) => (
        // No stand-in while a model downloads: props arrive after the street is already on screen.
        <ModelBoundary key={kindId} fallback={null}>
          <Suspense fallback={null}>
            <InstancedModel
              model={model}
              scale={scale}
              tint={tint}
              loaded={index.all.length}
              props={nearProps.get(kindId) ?? NO_PROPS}
            />
          </Suspense>
        </ModelBoundary>
      ))}
      <PalmFronds fronds={nearFronds} capacity={frondCapacity} />
      <Wires layout={layout} />
      {nearLabels.map((label) => (
        <LabelFace key={`${label.x},${label.z},${label.text}`} label={label} texture={textures.of(label)} />
      ))}
    </>
  );
}

const NO_PROPS: readonly Prop[] = [];

interface ModelPlacements {
  model: ModelInfo;
  scale: number;
  tint: string | undefined;
  index: ChunkIndex<Prop & Box>;
}

/**
 * The loaded props by model kind. Every model kind the whole district uses is
 * listed (the prop kinds come with the district header), even with none
 * loaded yet, so each kind's model downloads and warms up from the start.
 */
function modelPlacements(layout: DistrictLayout): Map<string, ModelPlacements> {
  const byKind = new Map<string, { model: ModelInfo; scale: number; tint: string | undefined; props: (Prop & Box)[] }>();
  for (const [kindId, kind] of Object.entries(layout.propKinds)) {
    if (!("model" in kind.look)) continue;
    const model = layout.models[kind.look.model];
    if (model) byKind.set(kindId, { model, scale: kind.look.scale, tint: kind.look.tint, props: [] });
  }
  for (const prop of layout.props) byKind.get(prop.kind)?.props.push(pointBox(prop));
  return new Map(
    [...byKind].map(([kindId, { props, ...look }]) => [kindId, { ...look, index: new ChunkIndex(props) }]),
  );
}

/**
 * One model's placements near the player, as one instanced mesh per mesh in
 * the model (usually just one), with room for every loaded placement.
 */
function InstancedModel({
  model,
  scale,
  tint,
  loaded,
  props,
}: {
  model: ModelInfo;
  scale: number;
  tint: string | undefined;
  /** How many of this kind are loaded, to size the mesh. */
  loaded: number;
  props: readonly Prop[];
}) {
  const capacity = useCapacity(loaded);
  const gl = useThree((three) => three.gl);
  const gltf = useLoader(GLTFLoader, `${ASSET_ROOT}/${model.file}`, withDecoders(gl));

  const meshes = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const parts: { mesh: InstancedMesh; local: Matrix4 }[] = [];
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      // Lambert, not the glTF's physically based material: far cheaper on a weak GPU.
      const original = object.material as MeshStandardMaterial;
      const material = new MeshLambertMaterial({ map: original.map, color: original.color.clone() });
      if (tint) material.color.multiply(new Color(tint));
      const instanced = new InstancedMesh(object.geometry, material, capacity);
      instanced.count = 0;
      instanced.visible = false;
      // Warmed up at load even with none near, so the first one to come into range never compiles a shader.
      instanced.userData[WARM_UP_WHILE_HIDDEN] = true;
      parts.push({ mesh: instanced, local: object.matrixWorld.clone() });
    });
    return parts;
  }, [gltf, capacity, tint]);
  const group = useMemo(() => {
    const root = new Group();
    for (const { mesh } of meshes) root.add(mesh);
    return root;
  }, [meshes]);

  useLayoutEffect(() => {
    const placement = new Matrix4();
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const position = new Vector3();
    const size = new Vector3(scale, scale, scale);
    const shown = Math.min(props.length, capacity);
    for (const { mesh, local } of meshes) {
      for (let index = 0; index < shown; index++) {
        const prop = props[index] as Prop;
        turn.setFromAxisAngle(up, (prop.rotation * Math.PI) / 180);
        placement.compose(position.set(prop.x, 0, prop.z), turn, size);
        mesh.setMatrixAt(index, placement.multiply(local));
      }
      mesh.count = shown;
      mesh.visible = shown > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [meshes, props, scale, capacity]);

  // Geometry and textures belong to the loader's cache; only the materials are ours.
  useEffect(
    () => () => {
      for (const { mesh } of meshes) (mesh.material as MeshLambertMaterial).dispose();
    },
    [meshes],
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

/** The fronds of the palms near the player, in one draw call with room for every frond in the district. */
function PalmFronds({ fronds, capacity }: { fronds: readonly Frond[]; capacity: number }) {
  const geometry = useMemo(frondGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    placer.rotation.order = "YXZ"; // turn to face its direction first, then droop
    const shown = Math.min(fronds.length, capacity);
    for (let index = 0; index < shown; index++) {
      const frond = fronds[index] as Frond;
      placer.position.set(frond.x, frond.y, frond.z);
      placer.rotation.set(frond.droop, frond.yaw, 0);
      placer.scale.set(frond.length, 1, frond.length);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
    }
    instanced.count = shown;
    instanced.visible = shown > 0;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [fronds, capacity]);

  if (capacity === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, capacity]}
      key={capacity}
      userData={{ [WARM_UP_WHILE_HIDDEN]: true }}
    >
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

/**
 * Painted faces, kept once painted: walking away and back past a shop must not
 * paint its sign again (painting a canvas takes a millisecond or two each).
 */
class LabelTextures {
  /** By what the label says and where: the same sign arrives as a new object each time its chunk does. */
  private readonly painted = new Map<string, CanvasTexture>();

  of(label: PropLabel): CanvasTexture {
    const key = `${label.x},${label.z},${label.text}`;
    let texture = this.painted.get(key);
    if (!texture) {
      const width = Math.min(512, Math.round(label.width * LABEL_PIXELS_PER_METRE));
      const height = Math.max(32, Math.round((width * label.height) / label.width));
      texture = paintSign(label.text, { background: label.background, text: label.ink, width, height, maxLines: label.lines });
      this.painted.set(key, texture);
    }
    return texture;
  }

  dispose(): void {
    for (const texture of this.painted.values()) texture.dispose();
    this.painted.clear();
  }
}

function LabelFace({ label, texture }: { label: PropLabel; texture: CanvasTexture }) {
  return (
    <mesh position={[label.x, label.y, label.z]} rotation-y={label.rotationY}>
      <planeGeometry args={[label.width, label.height]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  );
}
