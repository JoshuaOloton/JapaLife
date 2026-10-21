"""
A neighbourhood church: a white hall with a red pitched roof running front to
back, a tall front gable with a gold cross on top, wooden double doors under a
small porch roof, tall windows along both sides and steps up to the door.
10 m wide, 12 m deep, about 9.5 m tall with the cross; faces +z (the doors).
Run by `pnpm blender`.
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("church")

WIDTH = 9.6
DEPTH = 10.8
WALL_HEIGHT = 5.0
PITCH = 32  # degrees
HALL_BACK = -6.0
HALL_Z = HALL_BACK + DEPTH / 2
FRONT = HALL_BACK + DEPTH
GABLE_HEIGHT = (WIDTH / 2) * math.tan(math.radians(PITCH))

m.box("concrete", (WIDTH + 0.4, DEPTH + 0.2, 0.3), (0, 0, HALL_Z))
m.box("white", (WIDTH, DEPTH, WALL_HEIGHT), (0, 0.3, HALL_Z))
m.box("concrete", (WIDTH + 0.02, DEPTH + 0.02, 0.4), (0, 0.3, HALL_Z))
# Gable ends, front and back.
for z in (FRONT - 0.15, HALL_BACK + 0.15):
    m.gable("white", WIDTH, 0.3, GABLE_HEIGHT, (0, WALL_HEIGHT + 0.3, z))

# The roof: two red slopes, the ridge running front to back, overhanging a little.
slope_width = (WIDTH / 2 + 0.4) / math.cos(math.radians(PITCH))
for side in (-1, 1):
    centre_x = side * (WIDTH / 2 + 0.4) / 2
    centre_y = WALL_HEIGHT + 0.3 + (GABLE_HEIGHT - 0.4 * math.tan(math.radians(PITCH))) / 2 - 0.05
    m.box("roof_red", (slope_width, DEPTH + 0.6, 0.12), (centre_x, centre_y, HALL_Z), rotate=(0, side * PITCH, 0))

# The cross on the front gable's peak.
peak_y = WALL_HEIGHT + 0.3 + GABLE_HEIGHT
m.box("cross_gold", (0.2, 0.2, 1.7), (0, peak_y - 0.1, FRONT))
m.box("cross_gold", (0.9, 0.2, 0.2), (0, peak_y + 1.0, FRONT))

# Front: double doors under a porch roof, a round-topped window above (a square here), steps.
m.box("wood_dark", (2.0, 0.08, 2.8), (0, 0.3, FRONT))
m.box("cross_gold", (0.04, 0.1, 2.6), (0, 0.4, FRONT))
m.box("roof_red", (3.2, 1.4, 0.12), (0, 3.3, FRONT + 0.6), rotate=(-8, 0, 0))
m.box("window_glass", (1.2, 0.06, 1.2), (0, 4.4, FRONT))
m.box("concrete", (3.4, 1.2, 0.15), (0, 0, FRONT + 0.6))
m.box("concrete", (3.0, 0.6, 0.15), (0, 0.15, FRONT + 0.3))
for x in (-3.2, 3.2):
    m.box("window_glass", (0.8, 0.06, 2.2), (x, 1.8, FRONT))

# Tall windows along both sides.
for z in (-4.2, -1.8, 0.6, 3.0):
    for x in (-WIDTH / 2, WIDTH / 2):
        m.box("window_glass", (0.06, 0.8, 2.4), (x, 1.6, z))

m.finish()
