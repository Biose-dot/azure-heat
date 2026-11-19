// Azure Heat — main.js: boot, input, the player (on foot + driving), pistol combat, cameras,
// screens/flow (start, pause, wasted/busted, respawn), the save system, screenshot staging
// (?shot=start|play|end&seed=N) and the main loop that ticks every system.
'use strict';

// ---- Boot ----------------------------------------------------------------------
var params = new URLSearchParams(location.search);
var SHOT = params.get('shot');
var SEED = parseInt(params.get('seed') || '1', 10) || 1;
AH.setSeed(SEED * 7919 + 13);

var renderer, scene, camera, clock;
var camYaw = 0, camPitch = 0.32, camDist = 8.5;
var keys = {};
var pointerLocked = false;
var muzzle = null, muzzleTimer = 0;
var shotMode = false;

function initThree() {
  var canvas = document.getElementById('game');
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputEncoding = THREE.sRGBEncoding;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(60, 40, 160);
  clock = new THREE.Clock();
  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  AH.renderer = renderer; AH.sceneRef = scene; AH.cameraRef = camera; // exposed for tooling/tests
  // Muzzle flash: a small additive sprite + point light, shown for a few frames per shot.
  var flashTex = AH.makeCanvasTexture(64, 64, function (g) {
    var grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,180,1)'); grad.addColorStop(0.4, 'rgba(255,160,60,0.7)'); grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  });
  muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false }));
  muzzle.scale.set(1.6, 1.6, 1); muzzle.visible = false;
  scene.add(muzzle);
}

function buildGame() {
  AH.buildWorld(scene);
  AH.placeParkedCars(scene);
  AH.placeTraffic(scene);
  AH.makePlayer(scene);
  AH.spawnPeds(scene, 22);
  AH.buildMissionMarker(scene);
  AH.hudInit();
}

// ---- Screens / flow --------------------------------------------------------------
function showScreen(id) {
  ['startScreen', 'pauseScreen', 'overScreen'].forEach(function (s) {
    document.getElementById(s).style.display = (s === id) ? 'flex' : 'none';
  });
  document.getElementById('hud').style.display = id ? 'none' : 'block';
}
// Pointer lock, hardened: Chrome returns a promise that rejects without a real user
// gesture (synthetic clicks, screenshot harnesses) — that rejection must never surface.
AH.lockPointer = function () {
  var c = document.getElementById('game');
  if (!c.requestPointerLock) return;
  try {
    var r = c.requestPointerLock();
    if (r && r.catch) r.catch(function () {});
  } catch (e) { /* not critical: the game still plays, mouse look just waits for a click */ }
};
function startPlay(fromSave) {
  AH.audio.init();
  var S = AH.state;
  S.mode = 'play';
  showScreen(null);
  if (fromSave) {
    var save = AH.loadSave();
    if (save) {
      S.cash = save.cash; S.missionsDone = save.missionsDone;
      AH.player.pos.set(save.x || 6, 0, save.z || (AH.roadAt(2) + 4));
    }
  }
  if (!SHOT) AH.lockPointer();
  AH.hudToast('Welcome to Port Azure, Mara.', '#ffd23e');
}
AH.gameOver = function (kind) {
  var S = AH.state;
  if (S.mode !== 'play' || AH.shotHold) return; // screenshot scenes hold their staged frame
  S.mode = 'over'; S.overKind = kind;
  AH.audio.setEngine(false, 0); AH.audio.setSiren(false);
  AH.audio.fail();
  if (document.exitPointerLock) document.exitPointerLock();
  var title = document.getElementById('overTitle');
  var text = document.getElementById('overText');
  var fine = Math.min(S.cash, Math.max(50, Math.round(S.cash * 0.12)));
  if (kind === 'busted') {
    title.textContent = 'BUSTED';
    text.textContent = 'The Port Azure PD finally boxed Mara in. The desk sergeant takes $' + fine + ' in fines and impound fees, and lets her walk — this time.';
  } else {
    title.textContent = 'WASTED';
    text.textContent = 'Mara wakes up at Azure General with a splitting headache and a $' + fine + ' hospital bill. The city, as always, keeps moving.';
  }
  S.pendingFine = fine;
  showScreen('overScreen');
};
function respawn() {
  var S = AH.state;
  S.cash -= (S.pendingFine || 0);
  S.health = 100; S.wanted = 0; S.wantedHeat = 0; S.busted = 0; S.unseenTime = 0;
  if (AH.player.car) { AH.player.car.driver = 'parked'; AH.player.car = null; AH.player.mesh.visible = true; }
  var spot = S.overKind === 'busted' ? AH.policeStation : AH.hospital;
  AH.player.pos.set(spot.x + 14, 0, spot.z + 16);
  AH.player.mesh.position.copy(AH.player.pos);
  // Clear nearby police so respawn is not an instant re-arrest.
  for (var i = AH.police.length - 1; i >= 0; i--) {
    var c = AH.police[i]; c.driver = 'traffic'; c.axis = 'ns'; c.dir = 1;
  }
  AH.police.length = 0;
  S.mode = 'play';
  showScreen(null);
  AH.save();
  AH.hudToast(S.overKind === 'busted' ? 'Released. Stay out of trouble.' : 'Discharged from Azure General.', '#ffd23e');
}
function pauseGame(on) {
  var S = AH.state;
  if (on && S.mode === 'play') {
    S.mode = 'pause'; showScreen('pauseScreen');
    AH.audio.setEngine(false, 0);
    if (document.exitPointerLock) document.exitPointerLock();
  } else if (!on && S.mode === 'pause') {
    S.mode = 'play'; showScreen(null);
  }
}

// ---- Input ------------------------------------------------------------------------
function bindInput() {
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'KeyP') pauseGame(AH.state.mode === 'play');
    if (e.code === 'Escape' && AH.state.mode === 'pause') pauseGame(false);
    if (e.code === 'KeyM' && AH.state.mode === 'play') {
      var ch = AH.audio.toggleMusicStyle();
      AH.hudToast('Radio: ' + (ch === 0 ? 'Azure Nights (synthwave)' : 'Costa Funk (beach groove)'), '#4dd8ff');
    }
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyE') tryEnterExit();
    if (['Space', 'ArrowUp', 'ArrowDown'].indexOf(e.code) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  document.addEventListener('pointerlockchange', function () {
    pointerLocked = document.pointerLockElement === document.getElementById('game');
    if (!pointerLocked && AH.state.mode === 'play' && !SHOT && !shotMode) pauseGame(true);
  });
  window.addEventListener('mousemove', function (e) {
    if (!pointerLocked || AH.state.mode !== 'play') return;
    camYaw -= e.movementX * 0.0026;
    camPitch = AH.clamp(camPitch + e.movementY * 0.0022, -0.05, 1.0);
  });
  window.addEventListener('mousedown', function (e) {
    if (AH.state.mode !== 'play') return;
    if (!pointerLocked && !SHOT) { AH.lockPointer(); return; }
    if (e.button === 0) shoot();
  });
  document.getElementById('startBtn').addEventListener('click', function () { startPlay(false); });
  document.getElementById('continueBtn').addEventListener('click', function () { startPlay(true); });
  document.getElementById('newBtn').addEventListener('click', function () { AH.clearSave(); startPlay(false); });
  document.getElementById('resumeBtn').addEventListener('click', function () { pauseGame(false); });
  document.getElementById('restartBtn').addEventListener('click', function () {
    AH.state.health = 100; AH.state.wanted = 0; AH.state.wantedHeat = 0;
    if (AH.player.car) { AH.player.car.driver = 'parked'; AH.player.car = null; AH.player.mesh.visible = true; }
    AH.player.pos.set(6, 0, AH.roadAt(2) + 4);
    pauseGame(false);
  });
  document.getElementById('respawnBtn').addEventListener('click', respawn);
  var save = AH.loadSave();
  if (save) {
    document.getElementById('continueBtn').style.display = 'inline-block';
    document.getElementById('newBtn').style.display = 'inline-block';
    document.getElementById('startBtn').textContent = 'START NEW RUN';
  }
}

// ---- Entering / driving cars ---------------------------------------------------------
function tryEnterExit() {
  var S = AH.state;
  if (S.mode !== 'play') return;
  var p = AH.player;
  if (p.car) { // exit beside the car
    var car = p.car;
    car.driver = 'parked'; car.speed = 0;
    p.car = null;
    p.pos.set(car.pos.x + Math.cos(car.angle) * 2.4, 0, car.pos.z - Math.sin(car.angle) * 2.4);
    p.mesh.visible = true;
    AH.audio.door(); AH.audio.setEngine(false, 0);
    return;
  }
  var near = AH.nearestCar(p.pos, 4.6, false);
  if (!near || near.driver === 'police') return;
  var wasParked = near.driver === 'parked';
  near.driver = 'player';
  near.speed = 0;
  p.car = near;
  p.mesh.visible = false;
  camYaw = near.angle + Math.PI; // camera starts behind the car
  AH.audio.door();
  if (wasParked) {
    AH.commitCrime(0.55, 'theft'); // stealing a car is a crime, witnessed or not it heats up fast
    AH.hudToast('Vehicle stolen — ' + near.profile.name, '#ff6b81');
  }
  AH.audio.init();
}

// ---- Player on foot ---------------------------------------------------------------------
function updateOnFoot(dt) {
  var p = AH.player, S = AH.state;
  var fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  var strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  var sprint = keys.ShiftLeft || keys.ShiftRight;
  var speed = sprint ? 9.5 : 5.2;
  // Movement is relative to the camera yaw.
  var sin = Math.sin(camYaw), cos = Math.cos(camYaw);
  var mx = (sin * -fwd) + (cos * strafe);
  var mz = (cos * -fwd) + (-sin * strafe);
  var len = Math.sqrt(mx * mx + mz * mz);
  var moving = len > 0.01 && (fwd !== 0 || strafe !== 0);
  if (moving) {
    mx /= len; mz /= len;
    p.pos.x += mx * speed * dt;
    p.pos.z += mz * speed * dt;
    p.angle = AH.angleLerp(p.angle, Math.atan2(mx, mz), Math.min(1, dt * 12));
    p.walkPhase += dt * speed * 1.9;
    AH.walkAnim(p.mesh, p.walkPhase, sprint ? 0.75 : 0.55);
    p.speed2d = speed;
  } else {
    p.speed2d = 0;
    AH.idleAnim(p.mesh, S.time);
  }
  // Jump + gravity.
  if (keys.Space && p.grounded) { p.velY = 5.4; p.grounded = false; }
  if (!p.grounded) {
    p.velY -= 15 * dt;
    p.pos.y += p.velY * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.velY = 0; p.grounded = true; }
  }
  // Solid buildings + world edge.
  for (var i = 0; i < AH.world.colliders.length; i++) {
    var fixed = AH.circleVsBox(p.pos.x, p.pos.z, 0.5, AH.world.colliders[i]);
    if (fixed) { p.pos.x = fixed[0]; p.pos.z = fixed[1]; }
  }
  p.pos.x = AH.clamp(p.pos.x, -AH.WORLD_EDGE, AH.WORLD_EDGE + 120);
  p.pos.z = AH.clamp(p.pos.z, -AH.WORLD_EDGE, AH.WORLD_EDGE);
  p.mesh.rotation.y = p.angle;
  // Cash pickups.
  var got = AH.collectPickups(p.pos, 1.8);
  if (got) { S.cash += got; AH.audio.blip(); AH.hudToast('Found $' + got + ' cash', '#7dff8a'); }
  // Interaction prompt.
  var near = AH.nearestCar(p.pos, 4.6, false);
  AH.hudPrompt(near && near.driver !== 'police' ? 'Press E to ' + (near.driver === 'parked' ? 'steal' : 'enter') + ' the ' + near.profile.name : null);
}

// ---- Driving -----------------------------------------------------------------------------
function updateDriving(dt) {
  var p = AH.player, car = p.car, S = AH.state;
  var prof = car.profile;
  var accelIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  var steer = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  var handbrake = !!keys.Space;
  if (accelIn > 0) car.speed += prof.accel * dt * (car.speed < 0 ? 2.2 : 1);
  else if (accelIn < 0) car.speed -= (car.speed > 0.5 ? prof.brake : prof.accel * 0.7) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 3.5 * dt); // engine drag
  var grip = handbrake ? prof.grip * 0.45 : prof.grip;
  car.speed = AH.clamp(car.speed, -prof.maxSpeed * 0.38, prof.maxSpeed);
  if (handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 9 * dt);
  // Steering authority grows a little with speed, then fades at very high speed.
  var spd = Math.abs(car.speed);
  var authority = prof.turn * AH.clamp(spd / 7, 0, 1) * (1 - AH.clamp((spd - 22) / 40, 0, 0.35));
  car.angle += steer * authority * dt * (car.speed < 0 ? -1 : 1) * (handbrake ? 1.35 : 1);
  car.steerVis = AH.lerp(car.steerVis || 0, steer, Math.min(1, dt * 8));
  var oldX = car.pos.x, oldZ = car.pos.z;
  car.pos.x += Math.sin(car.angle) * car.speed * dt;
  car.pos.z += Math.cos(car.angle) * car.speed * dt;
  // Building collision: push out, kill speed into the wall, chip health on hard hits.
  for (var i = 0; i < AH.world.colliders.length; i++) {
    var fixed = AH.circleVsBox(car.pos.x, car.pos.z, 1.7, AH.world.colliders[i]);
    if (fixed) {
      car.pos.x = fixed[0]; car.pos.z = fixed[1];
      if (Math.abs(car.speed) > 9) { AH.damagePlayer(5); AH.audio.crash(); AH.commitCrime(0.25, 'collision'); AH.scarePeds(car.pos, 13); }
      car.speed *= -0.25;
    }
  }
  car.pos.x = AH.clamp(car.pos.x, -AH.WORLD_EDGE, AH.WORLD_EDGE + 120);
  car.pos.z = AH.clamp(car.pos.z, -AH.WORLD_EDGE, AH.WORLD_EDGE);
  // Car-to-car contact: both slow, sparks of crime if it was moving traffic.
  for (var j = 0; j < AH.cars.length; j++) {
    var o = AH.cars[j];
    if (o === car) continue;
    var d = AH.dist2d(car.pos.x, car.pos.z, o.pos.x, o.pos.z);
    if (d < 3.1) {
      var push = (3.1 - d) / 2 + 0.02;
      var nx = (car.pos.x - o.pos.x) / (d || 1), nz = (car.pos.z - o.pos.z) / (d || 1);
      car.pos.x += nx * push; car.pos.z += nz * push;
      if (o.driver === 'traffic' || o.driver === 'parked') { o.pos.x -= nx * push * 0.5; o.pos.z -= nz * push * 0.5; o.mesh.rotation.y = o.angle; }
      if (Math.abs(car.speed) > 6 && car.hitCooldown <= 0) {
        car.hitCooldown = 0.9;
        AH.audio.crash(); AH.commitCrime(0.4, 'hitandrun'); AH.scarePeds(car.pos, 14);
        AH.damagePlayer(2);
      }
      car.speed *= 0.72;
    }
  }
  car.hitCooldown -= dt;
  car.mesh.rotation.y = car.angle;
  // Front wheels visually steer.
  var wheels = car.mesh.userData.wheels;
  if (wheels) { wheels[0].rotation.y = car.steerVis * 0.4; wheels[1].rotation.y = car.steerVis * 0.4; }
  AH.spinWheels(car, dt);
  p.pos.copy(car.pos);
  AH.audio.setEngine(true, AH.clamp(Math.abs(car.speed) / prof.maxSpeed, 0, 1));
  AH.hudPrompt('E — exit · Space — handbrake');
  // Near-miss bonus: skimming past traffic at speed pays a little thrill money.
  car.nearMissCooldown -= dt;
  if (spd > 15 && car.nearMissCooldown <= 0) {
    for (var n = 0; n < AH.cars.length; n++) {
      var t = AH.cars[n];
      if (t === car || t.driver === 'police') continue;
      var dd = AH.dist2d(car.pos.x, car.pos.z, t.pos.x, t.pos.z);
      if (dd > 3.4 && dd < 5.6) {
        car.nearMissCooldown = 2.5;
        S.cash += 5;
        AH.hudToast('Near miss! +$5', '#4dd8ff');
        AH.audio.blip();
        break;
      }
    }
  }
  var got = AH.collectPickups(car.pos, 3);
  if (got) { S.cash += got; AH.audio.blip(); AH.hudToast('Drove over $' + got + ' cash', '#7dff8a'); }
}

// ---- Combat: the pistol ----------------------------------------------------------------------
function startReload() {
  var S = AH.state;
  if (S.mode !== 'play' || AH.player.car || S.reloading > 0 || S.ammo === 12 || S.reserve === 0) return;
  S.reloading = 1.1;
  AH.audio.reload();
}
function shoot() {
  var S = AH.state, p = AH.player;
  if (p.car || S.reloading > 0) return;
  if (S.ammo <= 0) { AH.audio.tone && AH.audio.tone(200, 0.05, 'square', 0.12); startReload(); return; }
  S.ammo--;
  AH.audio.gunshot();
  AH.scarePeds(p.pos, 17);
  // Gunfire near police (or anyone) is a serious crime.
  AH.commitCrime(0.85, 'gunfire');
  // Muzzle flash at the gun hand.
  muzzle.position.copy(p.pos).add(new THREE.Vector3(Math.sin(p.angle) * 0.6, 1.25, Math.cos(p.angle) * 0.6));
  muzzle.visible = true; muzzleTimer = 0.06;
  // Hitscan along the camera aim: find the closest ped roughly in the crosshair cone and range.
  var origin = camera.position.clone();
  var dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  var best = null, bestScore = 1e9;
  for (var i = 0; i < AH.peds.length; i++) {
    var ped = AH.peds[i];
    if (ped.downed) continue;
    var to = ped.pos.clone(); to.y = 1.1;
    var rel = to.clone().sub(origin);
    var along = rel.dot(dir);
    if (along < 2 || along > 70) continue;
    var perp = rel.clone().addScaledVector(dir, -along).length();
    var score = perp + along * 0.01;
    if (perp < 1.1 && score < bestScore) { bestScore = score; best = ped; }
  }
  if (best) {
    AH.downPed(best, 'shot');
  } else {
    // Spark off a building/car if the shot lands close to one? Keep simple: a distant thud.
    AH.audio.thud();
  }
  if (S.ammo === 0) startReload();
}

// ---- Cameras -----------------------------------------------------------------------------------
var vistaAngle = 0;
function updateCamera(dt) {
  var S = AH.state;
  if (shotMode && SHOT === 'start') {
    // Sweeping vista: over the south-west avenue, looking north-east across the city to the water.
    vistaAngle += dt * 0.02;
    camera.position.set(-70 + Math.sin(vistaAngle) * 10, 58, 252);
    camera.lookAt(230, 6, -60);
    return;
  }
  if (shotMode && SHOT === 'play') {
    // Front three-quarter chase framing: the hero car drives toward camera-left while the two
    // interceptors stay visible behind it, lightbars flashing.
    var car0 = AH.player.car;
    if (car0) {
      // On the road ahead of the hero car, looking back down its lane: the car fills the
      // foreground and both interceptors are visible behind it, lightbars flashing.
      var fx = Math.sin(car0.angle), fz = Math.cos(car0.angle);
      var rx = fz, rz = -fx; // right-hand vector
      camera.position.x = AH.lerp(camera.position.x, car0.pos.x + fx * 17 + rx * 5, Math.min(1, dt * 4));
      camera.position.z = AH.lerp(camera.position.z, car0.pos.z + fz * 17 + rz * 5, Math.min(1, dt * 4));
      camera.position.y = AH.lerp(camera.position.y, 3.4, Math.min(1, dt * 4));
      camera.lookAt(car0.pos.x - fx * 6, 1.5, car0.pos.z - fz * 6);
      return;
    }
  }
  if (shotMode && SHOT === 'end') {
    camera.position.set(232, 8, 74);
    camera.lookAt(292, 2, 6);
    return;
  }
  var target = AH.playerPos();
  if (AH.player.car) {
    var car = AH.player.car;
    // Chase camera: settle behind the car; the mouse can swing it temporarily via camYaw offset.
    var desiredYaw = car.angle + Math.PI;
    camYaw = AH.angleLerp(camYaw, desiredYaw, Math.min(1, dt * (Math.abs(car.speed) > 4 ? 2.6 : 0.8)));
    var back = 9.5, up = 3.6;
    var cx = target.x + Math.sin(camYaw) * Math.cos(camPitch * 0.4) * back;
    var cz = target.z + Math.cos(camYaw) * Math.cos(camPitch * 0.4) * back;
    var cy = up + Math.sin(camPitch) * 4;
    camera.position.x = AH.lerp(camera.position.x, cx, Math.min(1, dt * 7));
    camera.position.z = AH.lerp(camera.position.z, cz, Math.min(1, dt * 7));
    camera.position.y = AH.lerp(camera.position.y, Math.max(1.6, cy), Math.min(1, dt * 7));
    camera.lookAt(target.x, 1.6, target.z);
  } else {
    var dist = camDist;
    var cx2 = target.x + Math.sin(camYaw) * Math.cos(camPitch) * dist;
    var cz2 = target.z + Math.cos(camYaw) * Math.cos(camPitch) * dist;
    var cy2 = target.y + 1.8 + Math.sin(camPitch) * dist;
    camera.position.x = AH.lerp(camera.position.x, cx2, Math.min(1, dt * 10));
    camera.position.z = AH.lerp(camera.position.z, cz2, Math.min(1, dt * 10));
    camera.position.y = AH.lerp(camera.position.y, Math.max(0.7, cy2), Math.min(1, dt * 10));
    // Keep the camera out of buildings (collision-lite: pull up if inside a collider footprint).
    for (var i = 0; i < AH.world.colliders.length; i++) {
      var b = AH.world.colliders[i];
      if (camera.position.x > b.minX - 0.4 && camera.position.x < b.maxX + 0.4 &&
          camera.position.z > b.minZ - 0.4 && camera.position.z < b.maxZ + 0.4 && camera.position.y < 24) {
        camera.position.y = 24;
      }
    }
    camera.lookAt(target.x, target.y + 1.6, target.z);
    AH.player.angle = AH.angleLerp(AH.player.angle, camYaw + Math.PI, Math.min(1, dt * 14));
    if (AH.player.speed2d === 0) AH.player.mesh.rotation.y = AH.player.angle;
  }
}

// ---- Screenshot staging (?shot=start|play|end) ---------------------------------------------------
// Deterministic scenes the maker captures for screenshots/: no input needed, HUD states staged.
function stageShot() {
  shotMode = true;
  var S = AH.state;
  if (SHOT === 'start') {
    S.mode = 'start';
    showScreen('startScreen');
    AH.debugStep(2); // let traffic and the vista settle into a lively frame
    return;
  }
  S.mode = 'play';
  showScreen(null);
  if (SHOT === 'play') {
    AH.shotHold = true;
    keys.KeyW = true; // cruise control for the staged chase: the car keeps rolling for the capture
    // A dramatic chase on the main avenue: Mara in the orange GT, two interceptors on her tail.
    var car = null;
    for (var i = 0; i < AH.cars.length; i++) if (AH.cars[i].kind === 'sports') { car = AH.cars[i]; break; }
    car.pos.set(AH.roadAt(1) + 3.6, 0, 30); car.angle = Math.PI; car.speed = 17; car.driver = 'player';
    car.profile = Object.assign({}, AH.PROFILES.sports, { maxSpeed: 21 }); // cruise pace: the PD stays in frame
    car.mesh.rotation.y = car.angle;
    AH.player.car = car; AH.player.mesh.visible = false; AH.player.pos.copy(car.pos);
    S.wanted = 2; S.wantedHeat = 0.3; S.cash = 640; S.health = 82;
    camYaw = car.angle + Math.PI; camPitch = 0.3;
    camera.position.set(car.pos.x + 4, 4.5, car.pos.z + 13);
    var cop1 = AH.spawnPolice(scene); cop1.pos.set(car.pos.x + 2.5, 0, car.pos.z + 9); cop1.angle = Math.PI; cop1.speed = 20;
    var cop2 = AH.spawnPolice(scene); cop2.pos.set(car.pos.x - 3.5, 0, car.pos.z + 15); cop2.angle = Math.PI; cop2.speed = 19.5;
    AH.missionState.cycle = 1;
    AH.startMission('package');
    AH.debugStep(2.2); // roll the chase forward: PD closes in, traffic streams past
    AH.hudToast('The PD is on you — run!', '#ff6b81');
  } else if (SHOT === 'end') {
    AH.shotHold = true;
    // Mission-complete vista near the marina: banner up, cash banked, city glowing behind.
    S.cash = 1875; S.missionsDone = 7; S.health = 100; S.wanted = 0;
    AH.player.pos.set(274, 0, 46); // on the coast road, clear of the beach pavilions
    AH.player.mesh.position.copy(AH.player.pos);
    AH.player.angle = Math.PI / 2;
    AH.player.mesh.rotation.y = AH.player.angle;
    var gt = null;
    for (var j = 0; j < AH.cars.length; j++) if (AH.cars[j].kind === 'sports') { gt = AH.cars[j]; break; }
    if (gt) { gt.pos.set(267, 0, 37); gt.angle = 0.9; gt.mesh.rotation.y = gt.angle; }
    AH.mission = { type: 'package', done: true, target: { x: 300, z: -56 } }; AH.hideMarker();
    AH.debugStep(1.5);
    AH.hudToast('MISSION COMPLETE +$375', '#7dff8a');
    AH.hud.toastTimer = 9999; // hold the banner for the capture
  }
}

// ---- Main loop -------------------------------------------------------------------------------------
var saveTimer = 0;
AH.fps = 0;
var fpsFrames = 0, fpsClock = 0;
// Advance the whole simulation by dt (one frame's worth). Split out of loop() so screenshot
// staging and tests can step the world deterministically with AH.debugStep(seconds).
function tick(dt, skipRender) {
  var S = AH.state;
  if (S.mode === 'pause' || S.mode === 'over') { if (!skipRender) renderer.render(scene, camera); return; }
  S.time += dt;
  var focus = AH.playerPos();
  AH.updateWorld(dt, focus);
  AH.updateTraffic(dt);
  if (S.mode === 'play') {
    if (S.reloading > 0) {
      S.reloading -= dt;
      if (S.reloading <= 0) {
        var take = Math.min(12 - S.ammo, S.reserve);
        S.ammo += take; S.reserve -= take;
      }
    }
    if (AH.player.car) updateDriving(dt); else updateOnFoot(dt);
    AH.updatePeds(dt);
    AH.updatePolice(dt, scene);
    AH.updateMissions(dt);
    AH.audio.updateMusic(dt);
    saveTimer += dt;
    if (saveTimer > 6) { saveTimer = 0; AH.save(); }
  } else {
    // Start screen: the city lives behind the title.
    AH.updatePeds(dt * 0.6);
  }
  if (muzzleTimer > 0) { muzzleTimer -= dt; if (muzzleTimer <= 0) muzzle.visible = false; }
  updateCamera(dt);
  if (S.mode === 'play' || shotMode) AH.updateHUD(dt);
  if (!skipRender) renderer.render(scene, camera);
}
function loop() {
  requestAnimationFrame(loop);
  var dt = Math.min(clock.getDelta(), 0.05);
  fpsFrames++; fpsClock += dt;
  if (fpsClock >= 1) { AH.fps = Math.round(fpsFrames / fpsClock); fpsFrames = 0; fpsClock = 0; }
  tick(dt);
}
// Step the simulation in fixed 1/30s increments without depending on the display rate:
// used by screenshot staging so the composed scene is identical on slow software renderers.
AH.debugStep = function (seconds) {
  var steps = Math.max(1, Math.round(seconds * 30));
  for (var i = 0; i < steps; i++) tick(1 / 30, i < steps - 1);
};

// ---- Go ---------------------------------------------------------------------------------------------
initThree();
buildGame();
bindInput();
if (SHOT) stageShot();
else showScreen('startScreen');
loop();
