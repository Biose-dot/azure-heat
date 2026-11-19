# azure-heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Biose-dot/azure-heat/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Biose-dot/azure-heat/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Azure Heat** is an original 3D open-world crime game set in **Port Azure**, a fictional
golden-hour coastal city of palm boulevards, neon signs and quiet money. You are **Mara Venn**, a
wheelman-for-hire burned by the dock syndicate that ran her crew. Broke and blacklisted, she takes
any job the city whispers about — rush a package across town, run the checkpoint gauntlet, lift a
marked car for Voss Chop Shop — earning cash, dodging the Port Azure PD, and buying back her name
one job at a time. Everything is original: the city, characters, vehicles, story, art and sound
were created for this game; the soundtrack and effects are synthesised live with WebAudio.

## Features

- **A living 3D city** — an 11×11 road grid with textured asphalt, dashed lane markings and
  crosswalks; ~250 procedural buildings with lit warm/cool windows; neon shop signs with real
  names (Marina Cafe, Hotel Azul, Club Velvet…); cycling traffic lights; street lamps with glow
  sprites; palm trees, crates and barriers; named landmarks — Port Azure PD, Azure General
  hospital, Voss Chop Shop and the Marina.
- **A coast** — beach, pier and an animated water plane on the city's east side, under a gradient
  sunset sky with warm fog. Lighting shifts slowly from golden hour toward dusk as you play.
- **On foot** — third-person Mara with a walk/run/jump animation cycle, sprint, and a smooth
  follow camera with pointer-lock mouse look.
- **Cars** — sedans, taxis, a faster and looser Voss GT sports coupe, and PD interceptors, all
  with reflective paint, spinning wheels, steering front wheels, headlights and lightbars.
  Parked cars line the streets; traffic cruises the grid, queues at red lights, turns at
  intersections and wraps around the city forever. Press **E** to steal/drive, with chase camera,
  handbrake slides, building/car collisions and near-miss bonuses.
- **Pedestrians** — two dozen citizens stroll the sidewalks, idle, and flee from gunfire,
  crashes and fast cars.
- **Wanted system** — 0–5 stars fed by a heat meter: car theft, hit-and-runs, collisions and
  gunfire all count, double when witnessed. Police spawn in proportion to your stars, chase with
  pursuit steering and flashing lightbars, and fill a **BUSTED** meter if they pin you down.
  Break line of sight and hide — the stars flash while you cool down, then fall one by one.
  Getting wasted or busted costs a cut of your cash and respawns you at the hospital or station.
- **Combat** — a hitscan pistol with muzzle flash, 12-round magazines, **R** to reload, and
  non-graphic takedowns; gunfire scares crowds and draws the law.
- **Missions & story** — an intro package run, then endlessly cycling jobs: **Package Run**
  (pickup + timed delivery), **Checkpoint Run** (timed gates that pay per gate) and **Hot Wheels**
  (steal the marked car, deliver it to the chop shop) — all tracked by a light-beam marker, an
  on-screen objective and the minimap, paying cash and counting completions.
- **HUD & minimap** — cash, health bar, wanted stars, busted meter, weapon/ammo, speedometer,
  objective line, toasts and prompts, plus a live canvas minimap: roads, the coast, traffic,
  flashing police, cash pickups, the chop shop and the mission diamond.
- **Collectibles** — cash bundles hidden in alleys and along the beach, on foot or by car.
- **Sound, all synthesised** — engine hum, police siren, gunshots, crashes, pickups, mission
  jingles, and a two-channel radio (**M** switches between the *Azure Nights* synthwave loop and
  the *Costa Funk* beach groove).
- **Menus & saves** — story start screen, pause menu, WASTED/BUSTED screens with respawn, and
  progress (cash, missions, position) saved to `localStorage` with Continue / New Game options.
- **Deterministic screenshot scenes** — `?shot=start|play|end&seed=1` stages the title vista, a
  two-star police chase and a mission-complete vista with no input, for captures.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| Mouse (click to lock) | Look / aim |
| Shift | Sprint |
| Space | Jump / handbrake |
| E | Enter / exit car |
| Mouse click | Shoot pistol |
| R | Reload |
| M | Switch radio channel |
| Esc / P | Pause |

## Run it

```sh
node serve.ts   # then open http://localhost:8080
```

No build step and no network: `game/` is plain static files (three.js is vendored under
`game/vendor/`), so any static file server works too.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tvfbjxfd&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
