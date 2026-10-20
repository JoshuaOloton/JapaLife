# traffic/

`kinds.json` defines every kind of vehicle in the street traffic, and the schedule of how much of the traffic (and how many people) are out at each hour of the city's clock. A district's `traffic` in `cities/<city>.json` lists its lanes, which vehicles drive them, where danfos stop, and the walkways people stroll.

Traffic and pedestrians are **cosmetic and client-only**: they are not synced, never block the player, and stop (or pause) for the player instead. Each phone sees its own traffic.

- **`look.model`**: a model from `models/catalog.json`, facing +z, at `scale`. The danfo, keke and okada are our own (Python scripts in `assets/blender/`, built in real metres, so scale 1); the cars are the Kenney Car Kit's (scale 1.6).
- **`speed`**: cruising speed in metres per second. Vehicles slow over speed bumps, queue behind each other, take turns at junctions and stop for the player.
- **`stopsAtBusStops`**: pauses at the district's `busStops` on its lane (the danfo). **`rushHourBoost`**: every one of this kind is out at rush hours.
- **`schedule`**: the share out by day, at night (`quietFrom` to `quietUntil`) and at rush hours.

The server refuses a lane that leaves the road inside the district, a walkway that runs into a building, prop or person, an unknown kind, model or lane, and a bus stop off its lane.
