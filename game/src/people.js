// Azure Heat — people.js: low-poly articulated figures for the player (Mara Venn) and the
// pedestrians of Port Azure. Pedestrians stroll the sidewalks between block corners and flee
// from gunfire, speeding cars and crashes. Figures are groups of boxes with swinging limbs.
'use strict';
AH.peds = [];
var SHIRTS = [0xe74c3c, 0x3498db, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0xe67e22, 0xfd79a8, 0x00cec9, 0x6c5ce7];
var PANTS = [0x2c3e50, 0x34495e, 0x7f5539, 0x222f3e, 0x576574];
var SKIN = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xffdbac, 0xc68642];

// One articulated figure. userData carries limb refs for the walk cycle.
AH.makeFigure = function (shirt, pants, skin) {
  var g = new THREE.Group();
  var matShirt = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  var matPants = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  var matSkin = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), matShirt);
  torso.position.y = 1.06; torso.castShadow = true; g.add(torso);
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), matSkin);
  head.position.y = 1.62; head.castShadow = true; g.add(head);
  function limb(mat, w, len, x, y, z) {
    var pivot = new THREE.Group(); pivot.position.set(x, y, z);
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    m.position.y = -len / 2; m.castShadow = true; pivot.add(m); g.add(pivot);
    return pivot;
  }
  var armL = limb(matShirt, 0.16, 0.62, -0.4, 1.38, 0);
  var armR = limb(matShirt, 0.16, 0.62, 0.4, 1.38, 0);
  var legL = limb(matPants, 0.2, 0.72, -0.16, 0.72, 0);
  var legR = limb(matPants, 0.2, 0.72, 0.16, 0.72, 0);
  g.userData.limbs = { armL: armL, armR: armR, legL: legL, legR: legR };
  return g;
};

// Animate a figure's walk cycle. phase advances with speed; amp scales the swing.
AH.walkAnim = function (fig, phase, amp) {
  var L = fig.userData.limbs;
  if (!L) return;
  var s = Math.sin(phase) * (amp || 0.55);
  L.legL.rotation.x = s; L.legR.rotation.x = -s;
  L.armL.rotation.x = -s * 0.8; L.armR.rotation.x = s * 0.8;
};
AH.idleAnim = function (fig, t) {
  var L = fig.userData.limbs;
  if (!L) return;
  L.legL.rotation.x = 0; L.legR.rotation.x = 0;
  L.armL.rotation.x = Math.sin(t * 1.7) * 0.05; L.armR.rotation.x = -Math.sin(t * 1.7) * 0.05;
};

// ---- The player character ------------------------------------------------------
AH.player = null;
AH.makePlayer = function (scene) {
  var fig = AH.makeFigure(0xb33a6b, 0x222f3e, 0xe0ac69); // Mara: magenta jacket, dark jeans
  // A cap so the hero reads at a glance.
  var cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xffb03a, roughness: 0.8 }));
  cap.position.y = 1.86; fig.add(cap);
  var p = {
    mesh: fig, pos: fig.position,
    angle: 0, velY: 0, grounded: true, walkPhase: 0,
    car: null,           // the car being driven, or null on foot
    speed2d: 0,
  };
  fig.position.set(6, 0, AH.roadAt(2) + 4);
  scene.add(fig);
  AH.player = p;
  return p;
};
AH.playerPos = function () {
  if (!AH.player) return new THREE.Vector3();
  if (AH.player.car) return AH.player.car.pos;
  return AH.player.pos;
};

// ---- Pedestrians ------------------------------------------------------------------
AH.spawnPeds = function (scene, count) {
  for (var i = 0; i < (count || 22); i++) {
    var fig = AH.makeFigure(AH.pick(SHIRTS), AH.pick(PANTS), AH.pick(SKIN));
    // Start on a random sidewalk: block corner offsets beside the roads.
    var bx = AH.randInt(-AH.GRID, AH.GRID - 1), bz = AH.randInt(-AH.GRID, AH.GRID - 1);
    var x = AH.roadAt(bx) + AH.PITCH / 2 + AH.pick([-22, 22]);
    var z = AH.roadAt(bz) + AH.PITCH / 2 + AH.pick([-22, 22]);
    fig.position.set(x, 0, z);
    scene.add(fig);
    AH.peds.push({
      mesh: fig, pos: fig.position, angle: AH.rand() * Math.PI * 2,
      speed: AH.randRange(1.1, 1.9), walkPhase: AH.rand() * 6,
      target: null, fleeTime: 0, fleeFrom: new THREE.Vector3(),
      downed: false, downTimer: 0, waitTime: AH.rand() * 2,
    });
  }
};

// Pick the next stroll target: another sidewalk corner, so peds loop the blocks.
AH.pedNextTarget = function (ped) {
  var bx = Math.round((ped.pos.x - AH.PITCH / 2) / AH.PITCH);
  var bz = Math.round((ped.pos.z - AH.PITCH / 2) / AH.PITCH);
  if (AH.rand() < 0.5) bx += AH.pick([-1, 1]); else bz += AH.pick([-1, 1]);
  bx = AH.clamp(bx, -AH.GRID, AH.GRID - 1); bz = AH.clamp(bz, -AH.GRID, AH.GRID - 1);
  var sideX = AH.pick([-22, 22]), sideZ = AH.pick([-22, 22]);
  ped.target = { x: AH.roadAt(bx) + AH.PITCH / 2 + sideX, z: AH.roadAt(bz) + AH.PITCH / 2 + sideZ };
};

// Danger makes nearby pedestrians run: called on gunshots, crashes and near car strikes.
AH.scarePeds = function (fromPos, radius) {
  for (var i = 0; i < AH.peds.length; i++) {
    var ped = AH.peds[i];
    if (ped.downed) continue;
    if (AH.dist2d(fromPos.x, fromPos.z, ped.pos.x, ped.pos.z) < radius) {
      ped.fleeTime = AH.randRange(2, 3.5);
      ped.fleeFrom.set(fromPos.x, 0, fromPos.z);
    }
  }
};

AH.downPed = function (ped, cause) {
  if (ped.downed) return;
  ped.downed = true; ped.downTimer = 9;
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.position.y = 0.25;
  AH.audio.thud();
  if (cause === 'shot' || cause === 'car') AH.commitCrime(cause === 'shot' ? 1.2 : 0.8, 'assault');
};

AH.updatePeds = function (dt) {
  var dangerPos = AH.playerPos();
  var playerSpeed = AH.player && AH.player.car ? Math.abs(AH.player.car.speed) : 0;
  for (var i = 0; i < AH.peds.length; i++) {
    var ped = AH.peds[i];
    if (ped.downed) {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) { // they get up far from the action and walk it off (non-graphic)
        ped.downed = false; ped.mesh.rotation.x = 0; ped.mesh.position.y = 0;
        ped.pos.x += AH.randRange(20, 40) * (AH.rand() < 0.5 ? -1 : 1);
        ped.pos.z += AH.randRange(20, 40) * (AH.rand() < 0.5 ? -1 : 1);
        ped.target = null;
      }
      continue;
    }
    var moving = 0;
    if (ped.fleeTime > 0) {
      ped.fleeTime -= dt;
      var fleeAngle = Math.atan2(ped.pos.x - ped.fleeFrom.x, ped.pos.z - ped.fleeFrom.z);
      ped.angle = AH.angleLerp(ped.angle, fleeAngle, Math.min(1, dt * 6));
      moving = 3.6;
    } else {
      if (!ped.target) AH.pedNextTarget(ped);
      var dx = ped.target.x - ped.pos.x, dz = ped.target.z - ped.pos.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1.2) { ped.target = null; ped.waitTime = AH.randRange(0.4, 2.4); }
      else if (ped.waitTime > 0) { ped.waitTime -= dt; }
      else {
        ped.angle = AH.angleLerp(ped.angle, Math.atan2(dx, dz), Math.min(1, dt * 5));
        moving = ped.speed;
      }
      // A fast player car close by is danger even without a crash.
      if (playerSpeed > 12 && AH.dist2d(dangerPos.x, dangerPos.z, ped.pos.x, ped.pos.z) < 7) {
        ped.fleeTime = 1.6; ped.fleeFrom.set(dangerPos.x, 0, dangerPos.z);
      }
    }
    if (moving > 0) {
      ped.pos.x += Math.sin(ped.angle) * moving * dt;
      ped.pos.z += Math.cos(ped.angle) * moving * dt;
      // Buildings are solid for peds too.
      for (var c = 0; c < AH.world.colliders.length; c++) {
        var fixed = AH.circleVsBox(ped.pos.x, ped.pos.z, 0.45, AH.world.colliders[c]);
        if (fixed) { ped.pos.x = fixed[0]; ped.pos.z = fixed[1]; ped.target = null; }
      }
      ped.walkPhase += dt * moving * 2.6;
      AH.walkAnim(ped.mesh, ped.walkPhase, 0.55);
    } else {
      AH.idleAnim(ped.mesh, AH.state.time + i);
    }
    ped.mesh.rotation.y = ped.angle;
    // Struck by the player's car?
    if (AH.player && AH.player.car && playerSpeed > 4 &&
        AH.dist2d(AH.player.car.pos.x, AH.player.car.pos.z, ped.pos.x, ped.pos.z) < 1.9) {
      AH.downPed(ped, 'car');
      AH.damagePlayer(4);
    }
  }
};
