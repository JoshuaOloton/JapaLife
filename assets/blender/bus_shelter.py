"""
A yellow Lagos bus shelter: a concrete pad, a back panel, four black posts, a
yellow roof sloping to the back with a route sign on its edge, and a wooden
bench. 3.2 m wide, 1.8 m deep, about 2.7 m tall; faces +z (the open side, toward
the road). Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("bus-shelter")

m.box("concrete", (3.2, 1.8, 0.1), (0, 0, 0))
# Back panel: yellow below, glass above.
m.box("shelter_yellow", (3.0, 0.06, 0.9), (0, 0.1, -0.75))
m.box("window_glass", (3.0, 0.04, 1.2), (0, 1.0, -0.75))
for x in (-1.5, 1.5):
    for z in (-0.78, 0.7):
        m.box("black", (0.09, 0.09, 2.3), (x, 0.1, z))
# Roof, sloping to the back, with a sign board on its front edge.
m.box("shelter_yellow", (3.2, 1.8, 0.1), (0, 2.42, 0), rotate=(-5, 0, 0))
m.box("black", (2.2, 0.05, 0.35), (0, 2.25, 0.88))
m.box("white", (2.0, 0.06, 0.22), (0, 2.31, 0.88))
# Bench.
m.box("wood", (2.6, 0.4, 0.06), (0, 0.48, -0.45))
for x in (-1.1, 1.1):
    m.box("black", (0.06, 0.35, 0.38), (x, 0.1, -0.45))

m.finish()
