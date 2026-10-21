"""
The fuel station's canopy over its pumps: a white roof with a red brand fascia
and lights underneath, on two pillars standing on the pump island, with two
pumps between them. It is a prop: the player walks under the roof and is
stopped only by the island (pillars and pumps stand on it). 9 m wide, 6 m deep,
about 5 m tall; the island runs across (x). Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("fuel-canopy")

ISLAND_WIDTH = 6.0
ISLAND_DEPTH = 1.4
ROOF_Y = 4.4

# The pump island: a raised concrete kerb, painted at the edge.
m.box("shelter_yellow", (ISLAND_WIDTH, ISLAND_DEPTH, 0.12), (0, 0, 0))
m.box("concrete", (ISLAND_WIDTH - 0.1, ISLAND_DEPTH - 0.1, 0.2), (0, 0, 0))

# Two pillars and two pumps, all on the island.
for x in (-2.4, 2.4):
    m.box("white", (0.45, 0.45, ROOF_Y - 0.2), (x, 0.2, 0))
    m.box("brand_red", (0.47, 0.47, 0.6), (x, 0.2, 0))
for x in (-0.9, 0.9):
    m.box("white", (0.7, 0.5, 1.5), (x, 0.2, 0))
    m.box("brand_red", (0.72, 0.52, 0.3), (x, 1.4, 0))
    for side in (-1, 1):
        m.box("black", (0.45, 0.02, 0.3), (x, 1.0, side * 0.26))
        m.box("black", (0.05, 0.05, 0.6), (x + 0.3, 0.55, side * 0.27))

# The roof: white, with a red fascia band and lights underneath.
m.box("white", (9.0, 6.0, 0.4), (0, ROOF_Y + 0.35, 0))
m.box("brand_red", (9.04, 6.04, 0.4), (0, ROOF_Y, 0))
m.box("shelter_yellow", (9.06, 6.06, 0.06), (0, ROOF_Y + 0.4, 0))
for x in (-3.0, -1.0, 1.0, 3.0):
    for z in (-1.6, 1.6):
        m.box("lamp", (1.2, 0.5, 0.02), (x, ROOF_Y - 0.02, z))

m.finish()
