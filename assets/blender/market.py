"""
A Lagos market shed: a big pitched zinc roof on steel posts over a concrete
floor, open at the sides. Under it, rows of wooden stalls heaped with tomatoes,
peppers, onions and yams in basins and trays, a blue tarpaulin lean-to at one
end, and umbrellas over the stalls at the front corners. 16 m wide, 12 m deep,
about 5.5 m tall; faces +z. Run by `pnpm blender`.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("market")

WIDTH = 16.0
DEPTH = 12.0
EAVE_Y = 3.4
PITCH = 18  # degrees
HALF_SPAN = DEPTH / 2
RIDGE_Y = EAVE_Y + HALF_SPAN * math.tan(math.radians(PITCH))

m.box("concrete", (WIDTH - 0.4, DEPTH - 0.4, 0.15), (0, 0, 0))

# Steel posts along both long sides and down the middle.
for x in (-7.5, -2.5, 2.5, 7.5):
    for z in (-5.5, 5.5):
        m.box("rack", (0.18, 0.18, EAVE_Y - 0.05), (x, 0.15, z))
    m.box("rack", (0.2, 0.2, RIDGE_Y - 0.15), (x, 0.15, 0))
    m.box("rack", (0.14, DEPTH - 1.0, 0.14), (x, EAVE_Y - 0.2, 0))

# The roof: two zinc slopes meeting at a ridge running across, ridged and rust-patched.
slope_length = HALF_SPAN / math.cos(math.radians(PITCH))
for side in (-1, 1):
    centre_z = side * HALF_SPAN / 2
    centre_y = (EAVE_Y + RIDGE_Y) / 2 - 0.05
    # A positive tilt about x lifts the back (-z) edge: the front slope's high edge is its back, and vice versa.
    tilt = side * PITCH
    m.box("zinc", (WIDTH, slope_length, 0.08), (0, centre_y, centre_z), rotate=(tilt, 0, 0))
    for step in range(25):
        x = -WIDTH / 2 + 0.3 + step * 0.64
        m.box("chrome", (0.08, slope_length - 0.1, 0.03), (x, centre_y + 0.07, centre_z), rotate=(tilt, 0, 0))
    for x, w in ((-4.5, 2.4), (3.5, 1.6)):
        m.box("rust", (w, 1.6, 0.02), (x, centre_y + 0.1, centre_z), rotate=(tilt, 0, 0))
m.box("zinc", (WIDTH, 0.4, 0.12), (0, RIDGE_Y - 0.02, 0))

# Stalls: wooden tables in two rows, heaped with produce.
PRODUCE = ["tomato", "pepper_green", "onion", "yam", "tomato", "brand_red"]
for row, z in enumerate((-2.8, 2.8)):
    for column, x in enumerate((-5.2, -1.7, 1.7, 5.2)):
        m.box("wood", (2.8, 1.6, 0.8), (x, 0.15, z))
        for heap in range(3):
            colour = PRODUCE[(row * 4 + column + heap) % len(PRODUCE)]
            hx = x - 0.9 + heap * 0.9
            if colour == "yam":
                for tuber in range(3):
                    m.cylinder("yam", 0.09, 0.7, (hx, 1.05 + tuber * 0.12, z - 0.2 + tuber * 0.2), axis="x", segments=6)
            else:
                m.cylinder("pot", 0.38, 0.14, (hx, 1.02, z), axis="y", segments=10)
                m.cone(colour, 0.34, 0.28, (hx, 1.09, z), segments=10)

# A blue tarpaulin lean-to over extra stalls at the west end.
m.box("tarp_blue", (2.6, DEPTH - 1.6, 0.05), (-WIDTH / 2 + 1.4, 2.5, 0), rotate=(0, -12, 0))
for z in (-4.6, 4.6):
    m.box("wood_dark", (0.1, 0.1, 2.5), (-WIDTH / 2 + 0.4, 0.15, z))

# Umbrellas over the front corner stalls, poking out under the eaves.
for x, colour in ((-6.6, "brand_red"), (6.6, "tarp_blue")):
    m.box("black", (0.06, 0.06, 2.5), (x, 0.15, 5.2))
    m.cone(colour, 1.0, 0.5, (x, 2.4, 5.2), segments=8)

m.finish()
