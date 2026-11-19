// Azure Heat — vehicles.js: car factory (sedans, a loose sports coupe, police interceptors),
// parked cars, and road-grid traffic AI that cruises, queues at red lights and turns at
// intersections. Player driving physics lives in main.js; police driving in police.js.
'use strict';
AH.cars = [];          // every car in the world
AH.PROFILES = {
  sedan:  { maxSpeed: 26, accel: 11, brake: 22, grip: 3.4, turn: 1.9, name: 'Sedan' },
  taxi:   { maxSpeed: 25, accel: 11, brake: 22, grip: 3.4, turn: 1.9, name: 'Taxi' },
  sports: { maxSpeed: 38, accel: 17, brake: 26, grip: 2.5, turn: 2.3, name: 'Voss GT Coupe' },
  police: { maxSpeed: 34, accel: 15, brake: 26, grip: 3.1, turn: 2.1, name: 'PD Interceptor' },
};
var CAR_COLORS = [0xd64541, 0x3a7bd5, 0xf2c230, 0x7ac74f, 0xe8e8ec, 0x8e6cc8, 0xff7847, 0x2ec4b6, 0xc0c6ce, 0x34495e];

// Build one car as a low-poly group of boxes/cylinders with tuned standard-material paint.
AH.makeCarMesh = function (kind, color) {
  var g = new THREE.Group();
  var sports = kind === 'sports', police = kind === 'police';
  var paint = new THREE.MeshStandardMaterial({ color: color, metalness: 0.65, roughness: 0.32 });
  var glass = new THREE.MeshStandardMaterial({ color: 0x18222e, metalness: 0.4, roughness: 0.15 });
  var bodyH = sports ? 0.55 : 0.72;
  var body = new THREE.Mesh(new THREE.BoxGeometry(1.9, bodyH, 4.3), paint);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.55, sports ? 1.9 : 2.2), glass);
  cabin.position.set(0, 0.55 + bodyH / 2 + 0.22, sports ? -0.25 : -0.1); cabin.castShadow = true; g.add(cabin);
  if (sports) { // rear spoiler marks the GT coupe
    var wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.5), paint);
    wing.position.set(0, 1.18, -2.0); g.add(wing);
    var strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), glass);
    strut.position.set(0, 0.98, -2.0); g.add(strut);
  }
  if (kind === 'taxi') {
    var signMat = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffc300, emissiveIntensity: 0.9 });
    var sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.22, 0.4), signMat);
    sign.position.set(0, 1.42, -0.1); g.add(sign);
  }
  var wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  var wheelMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 });
  var wheels = [];
  [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]].forEach(function (p) {
    var w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(p[0], 0.36, p[1]); g.add(w); wheels.push(w);
  });
  var hlMat = new THREE.MeshStandardMaterial({ color: 0xfff6c9, emissive: 0xffe98a, emissiveIntensity: 1.8 });
  var tlMat = new THREE.MeshStandardMaterial({ color: 0x881111, emissive: 0xdd2222, emissiveIntensity: 1.2 });
  [-0.6, 0.6].forEach(function (x) {
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), hlMat); hl.position.set(x, 0.62, 2.16); g.add(hl);
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), tlMat); tl.position.set(x, 0.66, -2.16); g.add(tl);
  });
  var lightbar = null, lightRed = null, lightBlue = null;
  if (police) {
    var barBase = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.6 }));
    barBase.position.set(0, 1.48, -0.1); g.add(barBase);
    lightRed = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 2.5 }));
    lightRed.position.set(-0.34, 1.62, -0.1); g.add(lightRed);
    lightBlue = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x2266ff, emissiveIntensity: 2.5 }));
    lightBlue.position.set(0.34, 1.62, -0.1); g.add(lightBlue);
    lightbar = { red: lightRed, blue: lightBlue };
  }
  g.userData.wheels = wheels;
  g.userData.lightbar = lightbar;
  return g;
};

AH.spawnCar = function (scene, kind, color, x, z, angle, driver) {
  var mesh = AH.makeCarMesh(kind, color);
  mesh.position.set(x, 0, z); mesh.rotation.y = angle;
  scene.add(mesh);
  var car = {
    mesh: mesh, kind: kind, profile: AH.PROFILES[kind] || AH.PROFILES.sedan,
    angle: angle, speed: 0, driver: driver || 'parked', // parked | traffic | player | police
    steerVis: 0, nearMissCooldown: 0, hitCooldown: 0,
    laneOffset: 3.6, turnCooldown: 0, stuckTime: 0, reverseTime: 0,
    pos: mesh.position,
  };
  AH.cars.push(car);
  return car;
};

// Parked cars along road edges + a few feature cars (a sports coupe near the marina,
// the marked steal-target pool is chosen from parked cars by missions.js).
AH.placeParkedCars = function (scene) {
  for (var i = 0; i < 26; i++) {
    var vertical = AH.rand() < 0.5;
    var road = AH.roadAt(AH.randInt(-AH.GRID, AH.GRID));
    var along = AH.randRange(-AH.CITY / 2 + 20, AH.CITY / 2 - 20);
    var side = AH.rand() < 0.5 ? -1 : 1;
    var kind = AH.rand() < 0.14 ? 'taxi' : 'sedan';
    if (vertical) AH.spawnCar(scene, kind, AH.pick(CAR_COLORS), road + side * (AH.ROAD_HALF - 1.6), along, side > 0 ? 0 : Math.PI, 'parked');
    else AH.spawnCar(scene, kind, AH.pick(CAR_COLORS), along, road + side * (AH.ROAD_HALF - 1.6), side > 0 ? Math.PI / 2 : -Math.PI / 2, 'parked');
  }
  AH.spawnCar(scene, 'sports', 0xff5533, AH.roadAt(4) + 6.4, AH.roadAt(-1) + 12, 0, 'parked');
  AH.spawnCar(scene, 'sports', 0x2266cc, AH.roadAt(-2) - 6.4, AH.roadAt(2) - 18, Math.PI, 'parked');
};

// Traffic: cars that cruise the grid in the right-hand lane, turn at intersections,
// and stop for red lights and for the car ahead.
AH.placeTraffic = function (scene) {
  for (var i = 0; i < 12; i++) {
    var vertical = AH.rand() < 0.5;
    var road = AH.roadAt(AH.randInt(-AH.GRID, AH.GRID));
    var along = AH.randRange(-AH.CITY / 2, AH.CITY / 2);
    var dir = AH.rand() < 0.5 ? 1 : -1;
    var kind = AH.rand() < 0.2 ? 'taxi' : 'sedan';
    var car;
    if (vertical) {
      car = AH.spawnCar(scene, kind, AH.pick(CAR_COLORS), road + (dir > 0 ? -3.6 : 3.6), along, dir > 0 ? 0 : Math.PI, 'traffic');
      car.axis = 'ns'; car.dir = dir;
    } else {
      car = AH.spawnCar(scene, kind, AH.pick(CAR_COLORS), along, road + dir * 3.6, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 'traffic');
      car.axis = 'ew'; car.dir = dir;
    }
    car.speed = AH.randRange(8, 13);
  }
};

// Is there a car (or the player) just ahead of this traffic car?
AH.trafficBlocked = function (car, lookAhead) {
  var fx = Math.sin(car.angle), fz = Math.cos(car.angle);
  for (var i = 0; i < AH.cars.length; i++) {
    var o = AH.cars[i];
    if (o === car) continue;
    var dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z;
    var ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < lookAhead && side < 2.2) return true;
  }
  var p = AH.playerPos();
  var pdx = p.x - car.pos.x, pdz = p.z - car.pos.z;
  var pa = pdx * fx + pdz * fz, ps = Math.abs(pdx * fz - pdz * fx);
  return pa > 0 && pa < lookAhead && ps < 2.2;
};

AH.updateTraffic = function (dt) {
  for (var i = 0; i < AH.cars.length; i++) {
    var car = AH.cars[i];
    if (car.driver !== 'traffic') continue;
    car.turnCooldown -= dt;
    var targetSpeed = 12.5;
    // Red light ahead at the next intersection on our axis?
    var nextCoord = car.axis === 'ns' ? Math.round(car.pos.z / AH.PITCH + car.dir * 0.5) * AH.PITCH : Math.round(car.pos.x / AH.PITCH + car.dir * 0.5) * AH.PITCH;
    var distToLight = car.axis === 'ns' ? Math.abs(nextCoord - car.pos.z) : Math.abs(nextCoord - car.pos.x);
    if (distToLight < 13 && AH.lightForAxis(car.axis) === 'red') targetSpeed = 0;
    if (AH.trafficBlocked(car, 8)) targetSpeed = 0;
    car.speed = AH.clamp(car.speed + (targetSpeed - car.speed) * Math.min(1, dt * (targetSpeed > car.speed ? 0.7 : 2.4)), 0, 14);
    // At an intersection, sometimes turn onto the crossing road (recompute lane + heading).
    var nearX = Math.abs(car.pos.x - AH.nearestRoad(car.pos.x)) < 1.2, nearZ = Math.abs(car.pos.z - AH.nearestRoad(car.pos.z)) < 1.2;
    if (nearX && nearZ && car.turnCooldown <= 0 && AH.rand() < 0.45) {
      car.turnCooldown = 4;
      var ix = AH.nearestRoad(car.pos.x), iz = AH.nearestRoad(car.pos.z);
      if (car.axis === 'ns') { car.axis = 'ew'; car.dir = AH.rand() < 0.5 ? 1 : -1; car.pos.x = ix; car.pos.z = iz; car.targetZ = iz + (car.dir > 0 ? 3.6 : -3.6); }
      else { car.axis = 'ns'; car.dir = AH.rand() < 0.5 ? 1 : -1; car.pos.z = iz; car.pos.x = ix; car.targetX = ix + (car.dir > 0 ? -3.6 : 3.6); }
    }
    // Desired heading: along our road, offset into the right-hand lane for our direction.
    // (Right-hand traffic: southbound (+z) keeps west, northbound keeps east; eastbound keeps south.)
    var desired;
    if (car.axis === 'ns') {
      var laneX = Math.round(car.pos.x / AH.PITCH) * AH.PITCH + (car.dir > 0 ? -3.6 : 3.6);
      desired = Math.atan2(laneX - car.pos.x, car.dir * 10);
      if (car.targetX !== undefined) { laneX = car.targetX; desired = Math.atan2(laneX - car.pos.x, car.dir * 10); if (Math.abs(laneX - car.pos.x) < 0.6) car.targetX = undefined; }
    } else {
      var laneZ = Math.round(car.pos.z / AH.PITCH) * AH.PITCH + (car.dir > 0 ? 3.6 : -3.6);
      desired = Math.atan2(car.dir * 10, laneZ - car.pos.z);
      if (car.targetZ !== undefined) { laneZ = car.targetZ; desired = Math.atan2(car.dir * 10, laneZ - car.pos.z); if (Math.abs(laneZ - car.pos.z) < 0.6) car.targetZ = undefined; }
    }
    car.angle = AH.angleLerp(car.angle, desired, Math.min(1, dt * 2.2));
    car.pos.x += Math.sin(car.angle) * car.speed * dt;
    car.pos.z += Math.cos(car.angle) * car.speed * dt;
    // Wrap around the city edge back to the other side so traffic never runs out.
    if (Math.abs(car.pos.x) > AH.WORLD_EDGE) car.pos.x = -Math.sign(car.pos.x) * (AH.WORLD_EDGE - 4);
    if (Math.abs(car.pos.z) > AH.WORLD_EDGE) car.pos.z = -Math.sign(car.pos.z) * (AH.WORLD_EDGE - 4);
    car.mesh.rotation.y = car.angle;
    AH.spinWheels(car, dt);
  }
};

AH.spinWheels = function (car, dt) {
  var wheels = car.mesh.userData.wheels;
  if (!wheels) return;
  var rot = (car.speed * dt) / 0.36;
  for (var i = 0; i < wheels.length; i++) wheels[i].rotation.x += rot;
};

// Nearest car to a point (optionally only parked/stealable ones).
AH.nearestCar = function (pos, maxDist, parkedOnly) {
  var best = null, bestD = maxDist;
  for (var i = 0; i < AH.cars.length; i++) {
    var c = AH.cars[i];
    if (parkedOnly && c.driver !== 'parked' && c.driver !== 'traffic') continue;
    var d = AH.dist2d(pos.x, pos.z, c.pos.x, c.pos.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
};
