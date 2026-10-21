"""
The buka: Mama Put's roadside eatery. A cream block shed with a green band,
open above a low front wall between wooden posts, under a single sloping zinc
roof patched with rust. Inside, tables and benches; at the front, the serving
counter with big aluminium pots. 12 m wide, 8 m deep, about 3.5 m tall; faces
+z (the open front). Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("buka")

WIDTH = 11.6
DEPTH = 7.6
WALL_HEIGHT = 2.8
FRONT = DEPTH / 2 - 0.1

# Floor, back and side walls, each with a green band along the bottom.
m.box("concrete", (WIDTH, DEPTH, 0.15), (0, 0, 0))
m.box("wall_cream", (WIDTH, 0.2, WALL_HEIGHT), (0, 0, -FRONT))
m.box("wall_green", (WIDTH + 0.02, 0.22, 0.9), (0, 0, -FRONT))
for x in (-WIDTH / 2 + 0.1, WIDTH / 2 - 0.1):
    m.box("wall_cream", (0.2, DEPTH, WALL_HEIGHT), (x, 0, 0))
    m.box("wall_green", (0.22, DEPTH + 0.02, 0.9), (x, 0, 0))
# Small windows in the back wall, so the back reads as a building too.
for x in (-3.5, 0, 3.5):
    m.box("window_glass", (1.2, 0.24, 0.8), (x, 1.5, -FRONT))

# The open front: a low wall with a gap for the way in, wooden posts and a beam.
m.box("wall_cream", (1.3, 0.2, 1.0), (-WIDTH / 2 + 0.65, 0, FRONT))
m.box("wall_cream", (WIDTH - 2.5, 0.2, 1.0), (1.25 - 0.0, 0, FRONT))
m.box("wall_green", (WIDTH - 2.48, 0.22, 0.5), (1.25, 0, FRONT))
for x in (-5.7, -3.0, 0.0, 3.0, 5.7):
    m.box("wood", (0.16, 0.16, WALL_HEIGHT - 1.0), (x, 1.0, FRONT))
m.box("wood", (WIDTH, 0.2, 0.22), (0, WALL_HEIGHT, FRONT))

# The serving counter at the front, with Mama Put's big pots.
m.box("wood_dark", (3.2, 0.8, 1.0), (3.4, 0, FRONT - 0.7))
for x, radius in ((2.3, 0.34), (3.2, 0.3), (4.1, 0.36)):
    m.cylinder("pot", radius, 0.45, (x, 1.0 + 0.225, FRONT - 0.7), axis="y", segments=12)
    m.cylinder("black", radius + 0.02, 0.05, (x, 1.47, FRONT - 0.7), axis="y", segments=12)
# Coolers by the counter.
m.box("tarp_blue", (0.6, 0.45, 0.5), (5.0, 0.15, FRONT - 0.6))
m.box("brand_red", (0.6, 0.45, 0.5), (5.0, 0.65, FRONT - 0.6))

# Tables and benches for the customers.
for x, z in ((-3.4, -0.4), (-0.4, -0.4), (-3.4, -2.6), (-0.4, -2.6), (3.0, -2.2)):
    m.box("wood", (2.0, 0.8, 0.75), (x, 0.15, z))
    for side in (-1, 1):
        m.box("wood_dark", (2.0, 0.28, 0.45), (x, 0.15, z + side * 0.65))

# The zinc roof, one slope falling to the back: corrugated (raised ridges), with rusty patches.
ROOF_Y = 3.05
SLOPE = 0.063  # rise per metre toward the front (3.6 degrees)


def on_roof(z, lift):
    return ROOF_Y + 0.08 + z * SLOPE + lift


m.box("zinc", (12.0, 8.0, 0.08), (0, ROOF_Y, 0), rotate=(-3.6, 0, 0))
for step in range(19):
    x = -5.7 + step * 0.633
    m.box("chrome", (0.08, 7.9, 0.03), (x, on_roof(0, -0.01), 0), rotate=(-3.6, 0, 0))
for x, z, w, d in ((-3.8, 1.5, 1.8, 1.4), (2.6, -1.8, 2.2, 1.6), (4.5, 2.2, 1.2, 1.0), (-1.0, -2.8, 1.4, 1.1)):
    m.box("rust", (w, d, 0.02), (x, on_roof(z, 0.015), z), rotate=(-3.6, 0, 0))

m.finish()
