// Azure Heat — police.js: the wanted system and the Port Azure PD.
// commitCrime() feeds a heat meter that converts into 0-5 stars. Police interceptors spawn in
// proportion to the stars, chase with simple pursuit steering, flash their lightbars and wail.
// When officers are close and the player is slow, the BUSTED meter fills; when nobody has seen
// the player for a while, the heat cools and stars fall — the HUD shows a "hiding" state then.
'use strict';
AH.police = [];        // active police cars (subset of AH.cars with driver 'police')
AH.policeState = { seen: false, spawnTimer: 0, sirenNear: false };

// Report a crime. points feed the heat meter; ~1 point ≈ one star once witnessed scaling applies.
AH.commitCrime = function (points, kind) {
  var S = AH.state;
  if (S.mode !== 'play') return;
  // Crimes seen by police or many witnesses count double.
  var witnessed = AH.policeState.seen || AH.nearestPedDistance(AH.playerPos()) < 14;
  S.wantedHeat += points * (witnessed ? 1 : 0.6);
  while (S.wantedHeat >= 1 && S.wanted < 5) { S.wanted += 1; S.wantedHeat -= 1; }
  if (S.wanted >= 5) S.wantedHeat = Math.min(S.wantedHeat, 0.99);
  if (S.wanted > 0) S.unseenTime = 0;
};
AH.nearestPedDistance = function (pos) {
  var best = 1e9;
  for (var i = 0; i < AH.peds.length; i++) {
    if (AH.peds[i].downed) continue;
    var d = AH.dist2d(pos.x, pos.z, AH.peds[i].pos.x, AH.peds[i].pos.z);
    if (d < best) best = d;
  }
  return best;
};

AH.desiredPolice = function () {
  return [0, 1, 2, 3, 4, 6][AH.state.wanted] || 0;
};

AH.spawnPolice = function (scene) {
  var p = AH.playerPos();
  // Spawn on a road ring around the player, out of immediate sight.
  var a = AH.rand() * Math.PI * 2;
  var dist = AH.randRange(65, 95);
  var x = AH.nearestRoad(AH.clamp(p.x + Math.cos(a) * dist, -AH.CITY / 2, AH.CITY / 2));
  var z = AH.nearestRoad(AH.clamp(p.z + Math.sin(a) * dist, -AH.CITY / 2, AH.CITY / 2));
  var car = AH.spawnCar(scene, 'police', 0xf2f3f5, x, z, AH.rand() * Math.PI * 2, 'police');
  car.flashPhase = AH.rand() * 6;
  AH.police.push(car);
  return car;
};

AH.updatePolice = function (dt, scene) {
  var S = AH.state;
  var pPos = AH.playerPos();
  AH.policeState.spawnTimer -= dt;
  // Spawn up to the wanted quota; retire units when the heat is gone or they fall far behind.
  if (AH.police.length < AH.desiredPolice() && AH.policeState.spawnTimer <= 0) {
    AH.spawnPolice(scene);
    AH.policeState.spawnTimer = 2.5;
  }
  var seen = false, sirenNear = false, nearest = 1e9;
  for (var i = AH.police.length - 1; i >= 0; i--) {
    var car = AH.police[i];
    var d = AH.dist2d(pPos.x, pPos.z, car.pos.x, car.pos.z);
    if (d < nearest) nearest = d;
    if (d < 46) seen = true;
    if (d < 55) sirenNear = true;
    if ((S.wanted === 0 && d > 30) || d > 260) {
      car.driver = 'traffic'; car.axis = Math.abs(Math.sin(car.angle)) > 0.7 ? 'ew' : 'ns'; car.dir = 1; car.speed = 8;
      AH.police.splice(i, 1);
      continue;
    }
    // --- Pursuit steering: aim at a point a little ahead of the player's motion. ---
    var lead = AH.player && AH.player.car ? Math.abs(AH.player.car.speed) * 0.45 : 0;
    var tx = pPos.x, tz = pPos.z;
    if (AH.player && AH.player.car) { tx += Math.sin(AH.player.car.angle) * lead; tz += Math.cos(AH.player.car.angle) * lead; }
    else if (AH.player) { tx += Math.sin(AH.player.angle) * 2; tz += Math.cos(AH.player.angle) * 2; }
    var desired = Math.atan2(tx - car.pos.x, tz - car.pos.z);
    car.angle = AH.angleLerp(car.angle, desired, Math.min(1, dt * 1.7));
    var topSpeed = car.profile.maxSpeed * (d > 60 ? 1 : 0.86); // ease off alongside the player
    var accel = car.profile.accel;
    if (d < 6) accel = -8; // don't pile through the player
    car.speed = AH.clamp(car.speed + accel * dt, 0, topSpeed);
    car.pos.x += Math.sin(car.angle) * car.speed * dt;
    car.pos.z += Math.cos(car.angle) * car.speed * dt;
    // Buildings stop police too (slide along the push-out).
    for (var c = 0; c < AH.world.colliders.length; c++) {
      var fixed = AH.circleVsBox(car.pos.x, car.pos.z, 1.7, AH.world.colliders[c]);
      if (fixed) { car.pos.x = fixed[0]; car.pos.z = fixed[1]; car.speed *= 0.55; }
    }
    car.mesh.rotation.y = car.angle;
    AH.spinWheels(car, dt);
    // Lightbar: alternate red/blue strobes.
    car.flashPhase += dt * 7;
    var lb = car.mesh.userData.lightbar;
    if (lb) {
      var on = Math.sin(car.flashPhase) > 0;
      lb.red.material.emissiveIntensity = on ? 3.2 : 0.25;
      lb.blue.material.emissiveIntensity = on ? 0.25 : 3.2;
    }
    // Ramming contact: slows the player and chips health.
    if (AH.player && AH.player.car && d < 3.4 && Math.abs(AH.player.car.speed) > 3) {
      AH.player.car.speed *= (1 - dt * 1.4);
      if (car.hitCooldown <= 0) { car.hitCooldown = 1.2; AH.damagePlayer(3); AH.audio.crash(); }
    }
    car.hitCooldown -= dt;
  }
  AH.policeState.seen = seen;
  AH.policeState.sirenNear = sirenNear;
  AH.audio.setSiren(sirenNear && S.wanted > 0);

  // --- Wanted decay / busted bookkeeping. ---
  if (S.wanted > 0) {
    if (seen) S.unseenTime = 0; else S.unseenTime += dt;
    if (S.unseenTime > 9) { // hiding works: heat bleeds off, then stars drop one by one
      S.wantedHeat -= dt * 0.08;
      if (S.wantedHeat <= 0) {
        S.wanted -= 1; S.wantedHeat = S.wanted > 0 ? 0.85 : 0;
        if (S.wanted === 0) AH.hudToast('You lost the heat.', '#7dff8a');
      }
    }
    var playerSpeed = AH.player && AH.player.car ? Math.abs(AH.player.car.speed) : (AH.player ? AH.player.speed2d : 0);
    if (nearest < 10 && playerSpeed < 2.2) {
      S.busted = Math.min(1, S.busted + dt / 3.2);
      if (S.busted >= 1) AH.gameOver('busted');
    } else {
      S.busted = Math.max(0, S.busted - dt * 0.5);
    }
  } else {
    S.busted = Math.max(0, S.busted - dt);
  }
};

AH.damagePlayer = function (amount) {
  var S = AH.state;
  if (S.mode !== 'play') return;
  S.health = Math.max(0, S.health - amount);
  if (S.health <= 0) AH.gameOver('wasted');
};
