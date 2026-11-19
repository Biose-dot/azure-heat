// Azure Heat — config.js: shared constants, the global game state, a seeded RNG and small helpers.
// Everything lives on the single global AH namespace; the other classic scripts attach to it.
'use strict';
var AH = {};

// ---- City layout ------------------------------------------------------------
// A grid of city blocks separated by two-lane roads. Block pitch PITCH world units;
// roads are the gaps between blocks, so road centrelines sit at multiples of PITCH.
AH.PITCH = 56;            // distance between neighbouring road centrelines
AH.BLOCK = 40;            // building block footprint (the rest is sidewalk + road)
AH.ROAD_HALF = 8;         // half the road width
AH.GRID = 5;              // blocks from centre to edge in each direction (11 x 11 roads)
AH.CITY = AH.PITCH * (AH.GRID * 2 + 1); // total span covered by roads, ~616
AH.WORLD_EDGE = AH.CITY / 2 + 30;

// Road centreline coordinate for road index k (k = -GRID-? .. ), roads at k*PITCH.
AH.roadAt = function (k) { return k * AH.PITCH; };
// Nearest road centreline to a coordinate.
AH.nearestRoad = function (v) { return Math.round(v / AH.PITCH) * AH.PITCH; };
// Is a point on a road (either axis within the asphalt)?
AH.onRoad = function (x, z) {
  var dx = Math.abs(x - AH.nearestRoad(x)), dz = Math.abs(z - AH.nearestRoad(z));
  return dx < AH.ROAD_HALF + 1 || dz < AH.ROAD_HALF + 1;
};

// ---- Seeded RNG (deterministic for screenshots, ?seed=) ----------------------
AH.seed = 1;
AH.setSeed = function (s) { AH.seed = (s >>> 0) || 1; };
AH.rand = function () { // mulberry32
  AH.seed = (AH.seed + 0x6D2B79F5) >>> 0;
  var t = AH.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
AH.randRange = function (a, b) { return a + AH.rand() * (b - a); };
AH.randInt = function (a, b) { return Math.floor(AH.randRange(a, b + 1)); };
AH.pick = function (arr) { return arr[Math.floor(AH.rand() * arr.length)]; };

// ---- Helpers ------------------------------------------------------------------
AH.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
AH.lerp = function (a, b, t) { return a + (b - a) * t; };
AH.dist2d = function (ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };
AH.angleLerp = function (a, b, t) {
  var d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
// Circle (x,z,r) vs axis-aligned box {minX,maxX,minZ,maxZ}: push-out, returns corrected [x,z] or null.
AH.circleVsBox = function (x, z, r, box) {
  var cx = AH.clamp(x, box.minX, box.maxX), cz = AH.clamp(z, box.minZ, box.maxZ);
  var dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
  if (d2 > r * r) return null;
  if (d2 > 0.0001) { var d = Math.sqrt(d2); return [cx + dx / d * r, cz + dz / d * r]; }
  // Centre inside the box: push out along the smallest penetration axis.
  var pl = x - box.minX, pr = box.maxX - x, pt = z - box.minZ, pb = box.maxZ - z;
  var m = Math.min(pl, pr, pt, pb);
  if (m === pl) return [box.minX - r, z];
  if (m === pr) return [box.maxX + r, z];
  if (m === pt) return [x, box.minZ - r];
  return [x, box.maxZ + r];
};

// ---- Game state -----------------------------------------------------------------
AH.state = {
  mode: 'start',          // start | play | pause | over
  overKind: '',           // wasted | busted
  cash: 250,
  missionsDone: 0,
  health: 100,
  wanted: 0,              // 0..5 stars
  wantedHeat: 0,          // fractional build-up toward the next star
  unseenTime: 0,          // time since police last saw the player
  busted: 0,              // 0..1 busted meter
  ammo: 12, reserve: 48, reloading: 0,
  time: 0,
};
AH.save = function () {
  try {
    var p = AH.player;
    localStorage.setItem('azureHeatSave', JSON.stringify({
      cash: AH.state.cash, missionsDone: AH.state.missionsDone,
      x: p ? p.pos.x : 0, z: p ? p.pos.z : 8,
    }));
  } catch (e) { /* private mode etc. — saving is best-effort */ }
};
AH.loadSave = function () {
  try {
    var raw = localStorage.getItem('azureHeatSave');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
};
AH.clearSave = function () { try { localStorage.removeItem('azureHeatSave'); } catch (e) {} };
