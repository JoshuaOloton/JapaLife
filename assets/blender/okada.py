"""
The okada: a small commuter motorbike, with its rider in a reflective vest and
helmet. Also builds `okada-parked`, the same bike with nobody on it, for the
riders waiting on their bench. About 2 m long, 0.7 m wide (handlebars); faces
+z. Run by `pnpm blender`.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
import kit  # noqa: E402


def bike(m):
    for z in (-0.68, 0.68):
        m.wheel(0.3, 0.1, (0, 0.3, z))
    # Frame, engine, tank, seat, rear rack and mudguard.
    m.box("okada_red", (0.12, 1.05, 0.16), (0, 0.48, 0))
    m.box("engine", (0.24, 0.42, 0.26), (0, 0.22, 0.05))
    m.box("okada_red", (0.26, 0.42, 0.18), (0, 0.62, 0.22))
    m.box("seat", (0.26, 0.62, 0.1), (0, 0.66, -0.26))
    m.box("rack", (0.3, 0.32, 0.04), (0, 0.72, -0.68))
    m.box("okada_red", (0.14, 0.4, 0.04), (0, 0.62, 0.72))
    # Exhaust down the right side.
    m.box("chrome", (0.07, 0.65, 0.07), (0.16, 0.3, -0.32))
    # Fork, headlight and handlebars.
    for x in (-0.06, 0.06):
        m.box("chrome", (0.04, 0.04, 0.55), (x, 0.42, 0.66))
    m.box("headlight", (0.14, 0.06, 0.12), (0, 0.9, 0.72))
    m.box("black", (0.68, 0.04, 0.04), (0, 1.02, 0.6))


def rider(m):
    # Seated astride: hips on the seat, knees forward, feet on the pegs.
    m.box("trousers", (0.34, 0.3, 0.2), (0, 0.7, -0.22))
    for x in (-0.13, 0.13):
        m.box("trousers", (0.12, 0.42, 0.12), (x, 0.74, 0.02))
        m.box("trousers", (0.11, 0.11, 0.42), (x, 0.34, 0.2))
    m.box("vest", (0.4, 0.26, 0.52), (0, 0.9, -0.15))
    # Arms reaching forward to the grips at the ends of the handlebars.
    for x in (-0.25, 0.25):
        m.box("shirt_blue", (0.09, 0.66, 0.09), (x, 1.0, 0.27))
    m.box("skin", (0.22, 0.22, 0.22), (0, 1.42, -0.1))
    m.box("helmet", (0.26, 0.28, 0.14), (0, 1.56, -0.11))


ridden = kit.setup("okada")
bike(ridden)
rider(ridden)
ridden.finish()

parked = kit.setup("okada-parked")
bike(parked)
parked.finish()
