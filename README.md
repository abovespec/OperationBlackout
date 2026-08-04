# OPERATION BLACKOUT

A browser-based tactical first-person shooter — team deathmatch against navmesh-driven
bots on a hand-built urban map. Everything (geometry, textures, weapons, sound) is
generated procedurally at load time; the project ships no binary assets.

```
npm install
npm start          # serves on http://localhost:8123
```

Then open the page, pick a difficulty and loadout, and hit **DEPLOY**.

## Controls

| | |
|---|---|
| `WASD` | move |
| `SHIFT` | walk — slow and silent (sprint under the arcade ruleset) |
| `CTRL` / `C` | crouch — slower than walking, also silent |
| `SPACE` | jump |
| Left mouse | fire |
| Right mouse | scope (AWM-S only; aims down sights on everything under arcade) |
| `R` | reload |
| `1` / `2` / `3` / `4` | primary / secondary / knife / frag |
| `G` | quick-select frag |
| `Q` | last weapon |
| Mouse wheel | cycle weapons |
| `TAB` | scoreboard |
| `ESC` | pause / release mouse |

## The match

Team deathmatch: **GHOST** (you plus allied bots) versus **VIPER**. First team to the
score limit wins, or highest score when the 10-minute clock runs out. Both teams respawn
continuously at whichever of their spawn points is furthest from live enemies.

Damage model: per-zone hitboxes (head / chest / stomach / arms / legs) with per-weapon
multipliers, distance falloff, and armour that absorbs a share of incoming damage before
health. Health regenerates after roughly five seconds without being hit.

## Ruleset

Two of them, picked in the menu. **TACTICAL** is the default and is the Counter-Strike
model:

- **No sprint.** The base run is the top speed. `SHIFT` drops you to about half of it,
  and a slow walk — or a crouch-walk — makes no footstep sound at all, so bots cannot
  hear you and have to actually see you.
- **No aim-down-sights.** Right mouse does nothing on a rifle or a pistol. Only the
  AWM-S has glass, and firing it unscoped costs you the scoped cone entirely.
- **Accuracy is decided by your feet.** Standing still is the weapon's best number and
  running is its worst, on a convex ramp — walking costs you little, running costs almost
  everything, and firing mid-air is not a shot. Measured as the shot-group radius on a
  target 20 m away, an M4A1 lands ~9 cm planted (0.3°, which is CS's own figure), ~40 cm
  walking, and ~160 cm running — wider than a torso.

**ARCADE** restores the previous behaviour: `SHIFT` sprints, right mouse aims down sights
on every weapon, and movement costs far less accuracy. Nothing else differs.

Both rulesets share the deterministic spray patterns — the crosshair walks a fixed,
learnable path while you hold the trigger, so automatic fire can be mastered rather than
prayed at.

## Bot difficulty

Five tiers, each a full behaviour profile rather than a health/damage multiplier —
reaction time, aim error (separately for planted and moving fire), turn rate, burst
length and discipline, view cone and range, hearing radius, target leading, cover usage,
strafing, crouching, grenades, and how readily they push versus hold.

| Tier | Reaction | Behaviour |
|---|---|---|
| RECRUIT | 0.85–1.7 s | Conscripts: 38 m sight range, wide cone, low damage, gives up when you break contact |
| REGULAR | 0.34–0.62 s | Bursts, basic cover, tracks moving targets |
| HARDENED | 0.22–0.42 s | Real cover discipline, flanks, grenades |
| VETERAN | 0.13–0.26 s | Fast acquisition, aggressive angles, suppression |
| ELITE | 0.06–0.14 s | Near-instant reaction, laser bursts, relentless |

Two measurements, both from `tools/playtest.mjs`:

*Bot versus bot* (12 bots, 45 s) — total kills scale `3 / 9 / 15 / 23 / 33`.

*Lethality* — how long a stationary player who never shoots back survives against five
bots in the open:

| RECRUIT | REGULAR | HARDENED | VETERAN | ELITE |
|---|---|---|---|---|
| 49 s | 17 s | 11 s | 3.2 s | 2.5 s |

That gap is the point of the difficulty setting: RECRUIT gives you time to react to a
fight you walked into badly, ELITE does not.

Enemy count, allied count and score limit are all configurable from the menu. Allied bots
run one tier below the enemies at the top difficulties so the player still carries.

## Weapons

Six primaries and two sidearms, each with its own recoil pattern, spread bloom, ADS time,
falloff curve, reload behaviour and synthesised report.

- **M4A1** — balanced 750 rpm carbine
- **AK-74** — harder hitting, much heavier climb
- **MP5K** — 900 rpm SMG, fastest ADS, poor range
- **SCAR-H** — semi-auto marksman rifle
- **SPAS-12** — 9-pellet pump shotgun, shell-by-shell reload
- **AWM-S** — bolt-action sniper with a scoped overlay
- **G18** — full-auto machine pistol
- **Desert Eagle** — high damage, slow, punishing recoil

Plus frag grenades that bounce off world geometry and do line-of-sight-checked
radial damage.

### Combat knife

Always carried, on slot `3`. No ammo, no reload, and it draws in 0.26 s against a
rifle's 0.42 — when a reload would get you killed, the knife is the faster answer.
It also moves you slightly quicker than any gun.

Two attacks, the Counter-Strike split:

| | Damage | Backstab | Rate | Reach |
|---|---|---|---|---|
| Left mouse — slash | 42 | **180** | 0.42 s | 1.35 m |
| Right mouse — stab | 68 | **195** | 1.05 s | 1.45 m |

Either attack from behind (within ~65° of directly behind the target) kills outright.
Damage lands partway through the swing rather than on the click, so walking into someone
mid-animation does not connect, and the hit test sweeps a small cone rather than a single
ray — melee has to be forgiving in a way a bullet must not be.

Firing a weapon that is empty *and* out of reserve automatically falls back to whatever
can still hurt someone: the other gun if it has rounds, otherwise the knife.

## Maps

Pick from the menu; switching rebuilds geometry, colliders and the navmesh.

### District 7 — open urban block (124 x 124 m)

Five connected areas with long approaches: a central plaza with a dry fountain and
shipping containers, a two-storey office block with a balcony over the plaza, a warehouse
with a catwalk ring, a market with a walkable shop roof and a water tower overlooking the
whole map, and three ruined apartment blocks. Average sightline from open ground is
around 30 m — this is the map for rifles and the AWM.

### The Foundry — close quarters (76 x 76 m)

Built to the opposite brief. The centre is a solid two-storey foundry hall cut into a
pinwheel of small rooms around a furnace core, so the middle of the map must be fought
*through* rather than across. Four corner sheds and four covered perimeter halls ring it,
all linked by doorways rather than gates.

Measured average sightline from open ground: **8.3 m**. Bot-versus-bot hit rate runs
around 70% here against ~10% on District 7 — engagements are point-blank, and the SMG and
shotgun come into their own.

Every elevated position on both maps is reachable on foot and by the bots, verified by an
automated test that walks a real navmesh route to each one.

## Rendering

The world is drawn through a post-processing chain: ground-truth ambient occlusion,
bloom, ACES tone mapping, then a filmic grade (lift/gain, contrast, vignette, a little
sensor grain) and SMAA. Quality LOW bypasses the chain entirely and draws straight to
the screen.

Characters are ~3.5k triangles each — capsule limbs, plate carrier with mag pouches and
a radio, helmet with rails and pushed-up goggles, knee pads, boots. Every surface a
soldier needs is packed into one texture atlas so a whole figure costs one draw call per
bone rather than one per bone *per material*. The two sides use deliberately separated
palettes (GHOST cold urban grey, VIPER desert tan) so they read apart across the map.

Third-person arms use two-bone IK against the weapon's own grip and handguard anchors, so
hands stay on the gun through aim, recoil and lean instead of drifting off a canned pose.

Weapons carry the details that read at first-person range: picatinny rail slots, charging
handles, ejection ports, sling loops, magazine floor plates, trigger guards, front posts
and rear apertures, red-dot sights with a live reticle. Bolts and slides reciprocate on
every shot, magazines drop and are replaced during a reload, and the shotgun's fore-end
racks between shells. First-person view models add gloved hands and camo forearms.

Weapon models and soldier rigs are built once and instanced — `Object3D.clone()` shares
geometry, so spawning a bot or switching a loadout costs almost nothing. Getting this
wrong leaks a few hundred GPU buffers per match restart, which is what
`tools/soak-session.mjs` exists to catch.

## Architecture

```
src/
  core/
    game.js         match flow, combat resolution, scoring, frame loop
    collision.js    yaw-oriented box world, character sweep, hitscan rays
    nav.js          multi-layer navmesh, A*, cover scoring, stair stitching
  world/
    map.js          District 7 geometry + colliders (merged per material)
    textures.js     procedural PBR materials and the sky shader
  entities/
    character.js    box-built soldier rig, animation, per-zone hitboxes
    player.js       input, movement, first-person weapon rig
    bot.js          perception → decision → steering → gunplay, difficulty tiers
    weapons.js      weapon table and procedural view models
  fx/
    effects.js      pooled tracers, flashes, sparks, smoke, decals, casings
    audio.js        fully synthesised weapons, impacts, footsteps, explosions
  ui/hud.js         HUD, killfeed, scoreboard, minimap
```

Some notes on decisions that are easy to get wrong:

- **The weapon renders in its own scene** with a fixed 52° camera, composited after the
  world pass with a cleared depth buffer. Sharing the world camera makes the gun fisheye
  badly at high FOV and lets it clip into walls.
- **Nothing is added to or removed from the scene graph during a match.** Every effect,
  light and casing is pooled up front, because allocating a light or material mid-firefight
  forces a shader recompile and a visible hitch.
- **Static geometry is merged per material** at load, which keeps the whole map at a few
  dozen draw calls.
- **The navmesh stores several nodes per XZ cell** so catwalks and rooftops are distinct
  from the ground under them, and staircases declared by the map builder are explicitly
  stitched into the graph — grid sampling alone is not reliable across narrow stairs.

## Tools

```
node tools/shot.mjs           # screenshot tour of the map + combat (HEADLESS=1 to force headless)
node tools/playtest.mjs       # movement, difficulty calibration and traversal tests
node tools/soak.mjs           # MINUTES=5 — chaotic input for N minutes, watches for errors/leaks
node tools/soak-session.mjs   # ROUNDS=12 — restarts matches, watches GPU resource counts
node tools/probe.mjs '<js>'   # boot the game and evaluate an expression against it
```

`playtest.mjs` drives the player with synthetic input, runs a bot-versus-bot sim at every
difficulty, and walks a navmesh route to every elevated position, reporting whether each
is reachable.

The two soak tests exist because of a real crash. `soak.mjs` covers a single long match;
`soak-session.mjs` covers the *between-match* flow, which is where the bug actually was —
`renderer.info.memory.geometries` climbing across restarts is the signal to watch. A
healthy run plateaus (currently ~186) instead of growing.
