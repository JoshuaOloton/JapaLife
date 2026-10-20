"""
The danfo: Lagos's yellow minibus, with its two black stripes, dark windows,
a sliding side door, a roof rack and a little rust. Low poly, one material.
About 4.7 m long, 1.9 m wide, 2 m tall; faces +z. Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

LENGTH = 4.5
WIDTH = 1.9
BODY_BOTTOM = 0.32
BODY_HEIGHT = 1.6
HALF_L = LENGTH / 2
HALF_W = WIDTH / 2
SKIN = 0.012  # how far details stand off the body, so they never flicker into it

m = kit.setup("danfo")

for x in (-0.82, 0.82):
    for z in (-1.45, 1.45):
        m.wheel(0.33, 0.24, (x, 0.33, z))

m.box("danfo_yellow", (WIDTH, LENGTH, BODY_HEIGHT), (0, BODY_BOTTOM, 0))

# The two black stripes all the way round, at waist height.
for y in (0.9, 1.04):
    m.box("black", (WIDTH + 2 * SKIN, LENGTH + 2 * SKIN, 0.07), (0, y, 0))

# Windows: a long band down each side, the windscreen and the back window.
for side in (-1, 1):
    m.box("glass", (2 * SKIN, 3.3, 0.5), (side * HALF_W, 1.28, -0.35))
    m.box("glass", (2 * SKIN, 0.7, 0.5), (side * HALF_W, 1.28, 1.55))
    # Pillars between the side windows, standing a hair proud of the glass.
    for z in (-1.35, -0.4, 0.55):
        m.box("danfo_yellow", (4 * SKIN, 0.12, 0.52), (side * HALF_W, 1.27, z))
m.box("glass", (1.6, 2 * SKIN, 0.6), (0, 1.22, HALF_L))
m.box("glass", (1.5, 2 * SKIN, 0.45), (0, 1.3, -HALF_L))

# The sliding door on the kerb side (right, for right-hand traffic): its two edges.
for z in (0.05, 1.15):
    m.box("black", (2 * SKIN, 0.03, 1.15), (HALF_W, 0.4, z))

# Bumpers, lights.
for end in (-1, 1):
    m.box("black", (WIDTH + 0.06, 0.16, 0.22), (0, 0.28, end * (HALF_L + 0.06)))
for x in (-0.65, 0.65):
    m.box("headlight", (0.28, 2 * SKIN, 0.16), (x, 0.7, HALF_L))
    m.box("taillight", (0.18, 2 * SKIN, 0.22), (x, 0.7, -HALF_L))

# Roof rack: two rails on short legs, with cross bars.
for x in (-0.78, 0.78):
    m.box("rack", (0.05, 3.6, 0.05), (x, BODY_BOTTOM + BODY_HEIGHT + 0.08, -0.2))
    for z in (-1.9, 1.5):
        m.box("rack", (0.05, 0.05, 0.08), (x, BODY_BOTTOM + BODY_HEIGHT, z))
for z in (-1.7, -0.7, 0.3, 1.3):
    m.box("rack", (1.6, 0.05, 0.04), (0, BODY_BOTTOM + BODY_HEIGHT + 0.09, z))

# A hard working life: rust low on the sides.
for side, z in ((-1, 1.6), (1, -1.3), (-1, -0.8)):
    m.box("rust", (2 * SKIN, 0.45, 0.14), (side * HALF_W, 0.42, z))

m.finish()
