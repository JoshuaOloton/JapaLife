"""
The keke napep: Lagos's three-wheeled tricycle taxi. A yellow tub with a green
band, a black canopy on four posts, one wheel at the front and two at the back,
a passenger bench, and the driver at the handlebars. About 2.7 m long, 1.3 m
wide, 1.75 m tall; faces +z. Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402

m = kit.setup("keke")

m.wheel(0.22, 0.14, (0, 0.22, 1.08))
for x in (-0.55, 0.55):
    m.wheel(0.22, 0.14, (x, 0.22, -0.78))

# The passenger tub, its green band, and the narrower nose the driver sits in.
m.box("keke_yellow", (1.24, 1.55, 0.55), (0, 0.24, -0.4))
m.box("keke_green", (1.26, 1.57, 0.1), (0, 0.6, -0.4))
m.box("keke_yellow", (0.7, 0.85, 0.62), (0, 0.24, 0.72))
m.box("keke_yellow", (0.5, 0.3, 0.2), (0, 0.32, 1.1))
m.box("headlight", (0.18, 0.02, 0.12), (0, 0.62, 1.15))

# Canopy on four posts, with the windscreen up front.
for x in (-0.6, 0.6):
    for z in (0.78, -1.1):
        m.box("canopy", (0.05, 0.05, 0.92), (x, 0.79, z))
m.box("canopy", (1.3, 2.15, 0.07), (0, 1.68, -0.18))
m.box("glass", (1.0, 0.03, 0.55), (0, 1.0, 0.78))

# Passenger bench and back rest; the driver's seat.
m.box("seat", (1.1, 0.5, 0.14), (0, 0.79, -0.75))
m.box("seat", (1.1, 0.1, 0.45), (0, 0.93, -1.02))
m.box("seat", (0.4, 0.35, 0.12), (0, 0.86, 0.3))

# The driver: legs forward, hands on the handlebars.
m.box("black", (0.62, 0.04, 0.04), (0, 1.18, 0.66))
m.box("trousers", (0.36, 0.35, 0.16), (0, 0.9, 0.42))
for x in (-0.1, 0.1):
    m.box("trousers", (0.12, 0.12, 0.4), (x, 0.55, 0.6))
m.box("shirt_blue", (0.4, 0.28, 0.5), (0, 0.98, 0.27))
for x in (-0.24, 0.24):
    m.box("shirt_blue", (0.09, 0.36, 0.09), (x, 1.2, 0.48))
m.box("skin", (0.22, 0.22, 0.24), (0, 1.48, 0.28))

m.finish()
