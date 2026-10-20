"""
The skirt of the Ankara dress: an A-line from the waist to just below the
knee, one per body. The top of the dress is painted onto the body like other
clothes; only the loose part needs a model. The game paints the skirt with
the same print as the top and skins it to the hips and thighs in code, so this
script makes only the shape and its texture coordinates.

For each body: import it, take the body's points around the hips and legs, and
for each ring of the skirt find how far out the body reaches in every
direction (the outline of the hips, then of both legs together, like a skirt
hanging over them). The skirt never narrows on the way down, stands a little
off the body at the waist and flares out toward the hem. Texture coordinates
are in metres over the print's tile, so the motifs are the size they are on the
painted top. Exported in the body's own space. Run by `pnpm blender`.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

BODIES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "vendor", "ubc", "Base Characters", "Godot - UE"
)
BODIES = [("male", "Superhero_Male_FullBody.gltf"), ("female", "Superhero_Female_FullBody.gltf")]

SEGMENTS = 40
RINGS = 14
# The hem falls this far below the knee joint.
HEM_BELOW_KNEE = 0.06
# How far the skirt stands off the body at the waist, and how much more by the hem.
WAIST_EASE = 0.012
HEM_FLARE = 0.08
# The height of the slice of body points that shapes each ring.
BAND = 0.05
# Only points weighted mostly to these bones shape the skirt (never the arms or hands).
SHAPING_BONES = {"pelvis", "spine_01", "spine_02", "thigh_l", "thigh_r", "calf_l", "calf_r"}
# The print repeats every this many metres, the size it comes out on the painted
# top (PRINT_REPEAT in apps/client/game/character/bodyMaterial.ts).
PRINT_TILE = 0.36


def build(body, file_name):
    kit.setup(f"dress-skirt-{body}")
    bpy.ops.import_scene.gltf(filepath=os.path.join(BODIES_DIR, file_name))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    shape = max((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=lambda obj: len(obj.data.vertices))

    def joint(name):
        return armature.matrix_world @ armature.data.bones[name].head_local

    waist = joint("spine_01").z
    hem = joint("calf_l").z - HEM_BELOW_KNEE
    centre = joint("pelvis")

    groups = {group.index: group.name for group in shape.vertex_groups}
    points = []
    for vertex in shape.data.vertices:
        if not vertex.groups:
            continue
        main = max(vertex.groups, key=lambda group: group.weight)
        point = shape.matrix_world @ vertex.co
        if groups[main.group] in SHAPING_BONES and hem - BAND <= point.z <= waist + BAND:
            points.append((point.x - centre.x, point.y - centre.y, point.z))

    # How far out the body reaches at each ring, going down: never less than the ring above.
    reach_above = [0.0] * SEGMENTS
    rings = []
    for ring in range(RINGS):
        t = ring / (RINGS - 1)
        z = waist + (hem - waist) * t
        outline = convex_hull([(x, y) for x, y, pz in points if abs(pz - z) <= BAND / 2])
        reach = [max(distance_to_outline(outline, angle(segment)), reach_above[segment]) for segment in range(SEGMENTS)]
        reach_above = reach
        ease = WAIST_EASE + HEM_FLARE * t**1.5
        rings.append((z, [r + ease for r in reach]))

    mesh = bpy.data.meshes.new("skirt")
    bm = bmesh.new()
    verts = [
        [bm.verts.new((centre.x + r * math.cos(angle(s)), centre.y + r * math.sin(angle(s)), z)) for s, r in enumerate(radii)]
        for z, radii in rings
    ]
    # Whole tiles around the skirt, so the print meets itself at the back seam.
    around = sum(2 * math.pi * sum(radii) / SEGMENTS for _, radii in rings) / RINGS
    tiles = max(1, round(around / PRINT_TILE))
    uv = bm.loops.layers.uv.new("UVMap")
    for ring in range(RINGS - 1):
        for segment in range(SEGMENTS):
            following = (segment + 1) % SEGMENTS
            # Outward-facing: down the side, then around (counter-clockwise from above).
            corners = [(ring, segment, segment), (ring + 1, segment, segment), (ring + 1, following, segment + 1), (ring, following, segment + 1)]
            face = bm.faces.new([verts[r][s] for r, s, _ in corners])
            for loop, (r, _, column) in zip(face.loops, corners):
                loop[uv].uv = (column / SEGMENTS * tiles, (waist - rings[r][0]) / PRINT_TILE)
            face.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    skirt = bpy.data.objects.new("dress-skirt", mesh)
    bpy.context.scene.collection.objects.link(skirt)
    skirt.data.materials.append(kit.placeholder_material("MI_DressSkirt"))

    out = os.path.join(kit.OUT_DIR, f"dress-skirt-{body}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    skirt.select_set(True)
    bpy.context.view_layer.objects.active = skirt
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_animations=False)

    # Preview: the skirt on the body, from the front-left.
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in (shape, skirt)
    camera = bpy.data.objects.new("preview", bpy.data.cameras.new("preview"))
    bpy.context.scene.collection.objects.link(camera)
    look_at = Vector((centre.x, centre.y, (waist + hem) / 2))
    camera.location = look_at + Vector((-1.2, -2.0, 0.5))
    camera.rotation_euler = (look_at - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "OBJECT"
    skirt.color = (0.75, 0.35, 0.12, 1)
    shape.color = (0.55, 0.38, 0.28, 1)
    scene.render.resolution_x = 480
    scene.render.resolution_y = 480
    scene.render.filepath = os.path.join(kit.OUT_DIR, f"dress-skirt-{body}.png")
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(kit.OUT_DIR, f"dress-skirt-{body}.blend"))

    triangles = sum(len(p.vertices) - 2 for p in mesh.polygons)
    print(f"built dress-skirt-{body}: {triangles} triangles, waist {waist:.3f} to hem {hem:.3f}, {tiles} print tiles around -> {out}")


def angle(segment):
    return 2 * math.pi * segment / SEGMENTS


def convex_hull(points):
    """The convex outline of 2D points, counter-clockwise (Andrew's monotone chain)."""
    points = sorted(set(points))
    if len(points) < 3:
        return points

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def distance_to_outline(outline, direction):
    """How far a ray from the centre in this direction runs before leaving the outline."""
    dx, dy = math.cos(direction), math.sin(direction)
    best = 0.0
    for index, (ax, ay) in enumerate(outline):
        bx, by = outline[(index + 1) % len(outline)]
        ex, ey = bx - ax, by - ay
        denominator = dx * ey - dy * ex
        if abs(denominator) < 1e-12:
            continue
        t = (ax * ey - ay * ex) / denominator
        s = (ax * dy - ay * dx) / denominator
        if t > 0 and 0 <= s <= 1:
            best = max(best, t)
    return best


for body, file_name in BODIES:
    build(body, file_name)
