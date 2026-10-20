"""
Shared building blocks for the JapaLife model scripts (run headless by `pnpm blender`).

A model is a list of simple parts (boxes and cylinders), each painted one colour
from a shared palette texture: a 256 px sheet of 16 x 16 flat swatches, like the
KayKit packs use. Every model therefore has one material and one small texture,
which keeps draw calls and downloads down. Parts are joined into one mesh,
exported as GLB to assets/built/, and rendered to a preview PNG.

Units are metres; +y is up and the model faces +z (Blender: -y forward, z up;
the glTF exporter converts), standing on y = 0, like the packs.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# Swatches of the shared palette, by name. Order fixes each swatch's cell, so
# only ever add to the end (models built earlier keep their colours).
PALETTE = [
    ("danfo_yellow", (0.95, 0.72, 0.02)),
    ("black", (0.06, 0.06, 0.06)),
    ("tyre", (0.11, 0.11, 0.12)),
    ("rim", (0.62, 0.63, 0.66)),
    ("glass", (0.13, 0.18, 0.23)),
    ("chrome", (0.75, 0.76, 0.78)),
    ("headlight", (0.98, 0.95, 0.80)),
    ("taillight", (0.78, 0.10, 0.08)),
    ("keke_yellow", (0.96, 0.78, 0.05)),
    ("keke_green", (0.15, 0.48, 0.27)),
    ("canopy", (0.08, 0.08, 0.09)),
    ("seat", (0.16, 0.12, 0.10)),
    ("okada_red", (0.55, 0.10, 0.10)),
    ("engine", (0.35, 0.35, 0.37)),
    ("vest", (0.85, 0.89, 0.23)),
    ("shirt_blue", (0.18, 0.43, 0.71)),
    ("trousers", (0.17, 0.18, 0.21)),
    ("skin", (0.42, 0.29, 0.21)),
    ("helmet", (0.10, 0.10, 0.11)),
    ("rack", (0.22, 0.22, 0.23)),
    ("rust", (0.45, 0.27, 0.16)),
    ("white", (0.93, 0.93, 0.90)),
]
GRID = 16
CELL_PX = 16
SHEET_PX = GRID * CELL_PX

OUT_DIR = None


def setup(name):
    """Empties the scene and reads `-- --out <dir>` from the command line."""
    global OUT_DIR
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    OUT_DIR = args[args.index("--out") + 1] if "--out" in args else os.path.join(os.getcwd(), "assets", "built")
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return Model(name)


def cell_uv(colour):
    """The centre of a swatch's cell, in texture coordinates (glTF's v runs down)."""
    names = [entry[0] for entry in PALETTE]
    if colour not in names:
        raise ValueError(f"unknown palette colour {colour!r}")
    index = names.index(colour)
    column, row = index % GRID, index // GRID
    return ((column + 0.5) / GRID, 1 - (row + 0.5) / GRID)


def palette_material():
    """One material for every model: the palette sheet, unlit by nothing fancy."""
    image = bpy.data.images.get("palette") or bpy.data.images.new("palette", SHEET_PX, SHEET_PX, alpha=False)
    pixels = [0.0] * (SHEET_PX * SHEET_PX * 4)
    for index, (_, (r, g, b)) in enumerate(PALETTE):
        column, row = index % GRID, index // GRID
        # Blender's image rows start at the bottom.
        y0 = SHEET_PX - (row + 1) * CELL_PX
        for y in range(y0, y0 + CELL_PX):
            for x in range(column * CELL_PX, (column + 1) * CELL_PX):
                at = (y * SHEET_PX + x) * 4
                pixels[at : at + 4] = [r, g, b, 1.0]
    image.pixels = pixels
    image.filepath_raw = os.path.join(OUT_DIR, "palette.png")
    image.file_format = "PNG"
    image.save()

    material = bpy.data.materials.new("palette")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"
    material.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.9
    return material


class Model:
    """Collects parts into one bmesh; `finish` turns it into one exported object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _paint(self, faces, colour):
        u, v = cell_uv(colour)
        for face in faces:
            for loop in face.loops:
                loop[self.uv].uv = (u, v)

    def box(self, colour, size, at, rotate=(0, 0, 0)):
        """A box `size` = (width x, length z, height y) in game axes, centred at `at` = (x, y_bottom, z)."""
        width, length, height = size
        x, y_bottom, z = at
        result = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = result["verts"]
        # Game axes -> Blender axes: x stays x, game z (forward) is Blender -y, game y (up) is Blender z.
        transform = (
            Matrix.Translation(Vector((x, -z, y_bottom + height / 2)))
            @ Matrix.Rotation(math.radians(rotate[2]), 4, "Z")
            @ Matrix.Rotation(math.radians(rotate[0]), 4, "X")
            @ Matrix.Diagonal(Vector((width, length, height, 1)))
        )
        bmesh.ops.transform(self.bm, matrix=transform, verts=verts)
        self._paint({face for vert in verts for face in vert.link_faces}, colour)

    def cylinder(self, colour, radius, depth, at, axis="x", segments=10):
        """A capped cylinder centred at `at` = (x, y_centre, z), its length along a game axis."""
        x, y, z = at
        result = bmesh.ops.create_cone(
            self.bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth
        )
        verts = result["verts"]
        turn = {
            "x": Matrix.Rotation(math.radians(90), 4, "Y"),
            "z": Matrix.Rotation(math.radians(90), 4, "X"),
            "y": Matrix.Identity(4),
        }[axis]
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(Vector((x, -z, y))) @ turn, verts=verts)
        self._paint({face for vert in verts for face in vert.link_faces}, colour)

    def wheel(self, radius, width, at):
        """A tyre with a lighter rim on its outer face."""
        x, y, z = at
        self.cylinder("tyre", radius, width, (x, y, z), axis="x", segments=12)
        outward = 1 if x >= 0 else -1
        self.cylinder("rim", radius * 0.55, 0.02, (x + outward * (width / 2 + 0.005), y, z), axis="x", segments=8)

    def finish(self):
        """Builds the object, exports the GLB, saves a .blend and renders a preview."""
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        mesh.materials.append(palette_material())
        for polygon in mesh.polygons:
            polygon.use_smooth = False

        glb = os.path.join(OUT_DIR, f"{self.name}.glb")
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.gltf(
            filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_animations=False
        )
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, f"{self.name}.blend"))
        render_preview(obj, os.path.join(OUT_DIR, f"{self.name}.png"))
        triangles = sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)
        size = obj.dimensions
        print(f"built {self.name}: {triangles} triangles, {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m -> {glb}")


def placeholder_material(name):
    """
    A material for a mesh the game paints itself (a hair cap, a skirt). The
    glTF exporter drops texture coordinates no texture uses, so a tiny white
    placeholder image keeps them; the game swaps in its own material.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    placeholder = bpy.data.images.new(f"{name}-placeholder", 4, 4)
    placeholder.pixels = [1.0] * (4 * 4 * 4)
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = placeholder
    material.node_tree.links.new(texture.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    return material


def render_preview(obj, path):
    """A quick look from the front-left, above, roughly as the street camera sees it."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("world")

    reach = max(obj.dimensions) * 1.6 + 1.0
    camera_data = bpy.data.cameras.new("preview")
    camera = bpy.data.objects.new("preview", camera_data)
    scene.collection.objects.link(camera)
    centre = Vector((0, 0, obj.dimensions.z / 2))
    # Front-left and above (the model faces game +z, which is Blender -y).
    camera.location = centre + Vector((-0.7 * reach, -0.9 * reach, 0.7 * reach))
    camera.rotation_euler = (centre - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
