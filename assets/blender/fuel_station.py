"""
The fuel station's shop: a white block with a red brand band and parapet, a
glass front under a short awning, and air-conditioner units on the roof. The
pumps stand under their own canopy (fuel_canopy.py), placed in front. 10 m
wide, 5 m deep, about 4 m tall; faces +z (the glass front). Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("fuel-station")

WIDTH = 10.0
BODY_DEPTH = 4.2
BODY_BACK = -2.5
BODY_Z = BODY_BACK + BODY_DEPTH / 2
FRONT = BODY_BACK + BODY_DEPTH

m.box("concrete", (WIDTH, 5.0, 0.12), (0, 0, 0))
m.box("white", (WIDTH, BODY_DEPTH, 3.2), (0, 0.12, BODY_Z))
# The brand band and parapet around the top.
m.box("brand_red", (WIDTH + 0.04, BODY_DEPTH + 0.04, 0.55), (0, 3.32, BODY_Z))
m.box("white", (WIDTH + 0.06, BODY_DEPTH + 0.06, 0.12), (0, 3.87, BODY_Z))
m.box("shelter_yellow", (WIDTH + 0.05, BODY_DEPTH + 0.05, 0.1), (0, 3.22, BODY_Z))

# Glass front: shop windows either side of a glass door.
for x in (-3.3, 3.3):
    m.box("window_glass", (2.8, 0.05, 2.0), (x, 0.7, FRONT))
m.box("window_glass", (1.6, 0.05, 2.4), (0, 0.12, FRONT))
m.box("black", (1.7, 0.06, 0.08), (0, 2.52, FRONT))
# A short awning over the front, on two thin posts.
m.box("brand_red", (WIDTH, 0.8, 0.12), (0, 2.85, FRONT + 0.4))
for x in (-4.8, 4.8):
    m.box("rack", (0.08, 0.08, 2.73), (x, 0.12, FRONT + 0.72))

# Side and back windows, small.
for z in (-1.2, 0.6):
    for x in (-WIDTH / 2, WIDTH / 2):
        m.box("window_glass", (0.05, 1.0, 0.8), (x, 1.6, z))

# Roof: air-conditioner units and a water tank.
for x in (-3.0, -1.5):
    m.box("white", (1.0, 0.7, 0.6), (x, 3.32, -1.2))
    m.box("rack", (0.7, 0.02, 0.4), (x, 3.42, -0.84))
m.cylinder("black", 0.55, 1.1, (3.0, 3.32 + 0.55, -1.0), axis="y", segments=12)

m.finish()
