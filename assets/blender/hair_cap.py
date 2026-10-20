"""
The hair cap: a thin shell hugging each body's scalp, for the close-to-the-head
styles (cornrows, fade). The style itself is a pattern the game paints in code
and lays on the cap, tinted by the hair colour, so one cap per body serves
every close style.

For each body: import it, wrap a sphere onto its head (shrinkwrap), keep only
the part above a hairline (forehead, over the ears, down to the nape), give it
a top-down UV layout (u: left to right, v: front to back, so cornrows run along
v and a fade thins out toward the cap's edge), and export the shell in the
body's own space. The game attaches it to the Head bone, so it moves with the
head exactly as hair skinned to that bone would. Run by `pnpm blender`.
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

# How far the shell stands off the scalp, metres: enough never to flicker into it, too little to see.
STAND_OFF = 0.006
# The hairline, relative to the top of the eyebrows: higher at the forehead, lower over the ears and nape.
HAIRLINE_FRONT = 0.03
HAIRLINE_SIDE = -0.02
HAIRLINE_BACK = -0.08


def build(body, file_name):
    kit.setup(f"hair-cap-{body}")
    bpy.ops.import_scene.gltf(filepath=os.path.join(BODIES_DIR, file_name))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    scalp = max(meshes, key=lambda obj: len(obj.data.vertices))  # the body, not the eyes or eyebrows
    brows = next(obj for obj in meshes if "brow" in obj.name.lower())

    world = scalp.matrix_world
    brow_top = max((brows.matrix_world @ v.co).z for v in brows.data.vertices)
    # The head: everything of the body above the eyebrows' level less a little, in its rest pose.
    head_points = [world @ v.co for v in scalp.data.vertices if (world @ v.co).z > brow_top - 0.12]
    lo = Vector((min(p.x for p in head_points), min(p.y for p in head_points), min(p.z for p in head_points)))
    hi = Vector((max(p.x for p in head_points), max(p.y for p in head_points), max(p.z for p in head_points)))
    centre = (lo + hi) / 2
    radius = max(hi - lo) * 0.75

    # A sphere around the head, pulled onto the scalp.
    mesh = bpy.data.meshes.new("cap")
    bm = bmesh.new()
    # Fine enough that the hairline, cut along its vertices, reads as a line rather than steps.
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=radius)
    bmesh.ops.translate(bm, vec=centre, verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    cap = bpy.data.objects.new("hair-cap", mesh)
    bpy.context.scene.collection.objects.link(cap)
    wrap = cap.modifiers.new("wrap", "SHRINKWRAP")
    wrap.target = scalp
    wrap.wrap_method = "NEAREST_SURFACEPOINT"
    wrap.offset = STAND_OFF
    bpy.context.view_layer.objects.active = cap
    bpy.ops.object.modifier_apply(modifier="wrap")

    # Keep only what is above the hairline. The body faces -y in Blender (+z in the game).
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    def hairline(point):
        flat = Vector((point.x - centre.x, point.y - centre.y))
        front = -flat.y / flat.length if flat.length > 1e-6 else 0.0  # 1 at the forehead, -1 at the nape
        side_to_front = HAIRLINE_SIDE + (HAIRLINE_FRONT - HAIRLINE_SIDE) * max(front, 0.0)
        side_to_back = HAIRLINE_SIDE + (HAIRLINE_BACK - HAIRLINE_SIDE) * max(-front, 0.0)
        return brow_top + (side_to_front if front >= 0 else side_to_back)
    # Cut by whole faces (their centre), which leaves no lone notches along the forehead.
    below = [face for face in bm.faces if face.calc_center_median().z < hairline(face.calc_center_median())]
    bmesh.ops.delete(bm, geom=below, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # Cutting on whole vertices leaves a staircase; slide the edge vertices down onto the hairline...
    for vert in bm.verts:
        if any(edge.is_boundary for edge in vert.link_edges):
            vert.co.z = hairline(vert.co)
    bm.to_mesh(cap.data)
    bm.free()
    # ...and wrap again, so the moved edge sits back on the scalp.
    rewrap = cap.modifiers.new("rewrap", "SHRINKWRAP")
    rewrap.target = scalp
    rewrap.wrap_method = "NEAREST_SURFACEPOINT"
    rewrap.offset = STAND_OFF
    bpy.ops.object.modifier_apply(modifier="rewrap")

    # Top-down UVs over the cap: u left to right, v front (0) to back (1).
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    uv = bm.loops.layers.uv.new("UVMap")
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    for face in bm.faces:
        for loop in face.loops:
            loop[uv].uv = (
                0.5 + (loop.vert.co.x - centre.x) / span,
                0.5 + (loop.vert.co.y - centre.y) / span,
            )
    bm.to_mesh(cap.data)
    bm.free()
    for polygon in cap.data.polygons:
        polygon.use_smooth = True
    # The exporter drops texture coordinates no texture uses, and the game needs them for the
    # painted pattern; a tiny placeholder image keeps them (the game swaps in its own material).
    material = bpy.data.materials.new("MI_HairCap")
    material.use_nodes = True
    placeholder = bpy.data.images.new("hair-cap-placeholder", 4, 4)
    placeholder.pixels = [1.0] * (4 * 4 * 4)
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = placeholder
    material.node_tree.links.new(
        texture.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"]
    )
    cap.data.materials.append(material)

    # Export only the cap, in the body's space (its mesh has no transform of its own).
    out = os.path.join(kit.OUT_DIR, f"hair-cap-{body}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    cap.select_set(True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_animations=False)

    # Preview: the cap on the head, from the front-left.
    for obj in meshes:
        obj.hide_render = obj is not scalp
    camera_data = bpy.data.cameras.new("preview")
    camera = bpy.data.objects.new("preview", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = centre + Vector((-0.35, -0.55, 0.2))
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "OBJECT"
    cap.color = (0.12, 0.08, 0.05, 1)
    scalp.color = (0.55, 0.38, 0.28, 1)
    scene.render.resolution_x = 480
    scene.render.resolution_y = 480
    scene.render.filepath = os.path.join(kit.OUT_DIR, f"hair-cap-{body}.png")
    bpy.ops.render.render(write_still=True)

    triangles = sum(len(p.vertices) - 2 for p in cap.data.polygons)
    print(f"built hair-cap-{body}: {triangles} triangles, hairline from eyebrows at z {brow_top:.3f} -> {out}")


for body, file_name in BODIES:
    build(body, file_name)
