// Azure Heat — missions.js: Mara's story jobs for cash.
// Flow: an intro delivery (Marina Cafe pickup -> dockside drop) teaches the loop, then repeatable
// jobs cycle forever: PACKAGE RUN (fetch + deliver against the clock), CHECKPOINT RUN (hit every
// glowing gate before time runs out) and HOT WHEELS (steal the marked car, deliver it to Voss
// Chop Shop). A tall light-beam marker + minimap blip show the current objective.
'use strict';
AH.mission = null;       // {type, phase, target, timer, pay, checkpoints, carTarget, name}
AH.missionState = { cycle: 0, betweenTimer: 0, marker: null, ring: null };

var DROP_POINTS = [
  { name: 'the Hotel Azul valet stand', x: 28, z: -84 },
  { name: 'the dock warehouse', x: 252, z: 60 },
  { name: 'Club Velvet back door', x: -84, z: 140 },
  { name: 'the marina pier', x: 300, z: -56 },
  { name: 'Azure General ambulance bay', x: -84, z: -252 },
  { name: 'the pawn shop on 5th', x: 140, z: 84 },
];
var PICKUP_POINTS = [
  { name: 'Marina Cafe', x: 286, z: -84 },
  { name: 'Ramen Ya on 3rd', x: -140, z: -28 },
  { name: 'the beach kiosk', x: 300, z: 112 },
  { name: 'Hotel Azul lobby', x: 28, z: -112 },
];

AH.buildMissionMarker = function (scene) {
  var geo = new THREE.CylinderGeometry(2.2, 2.2, 42, 18, 1, true);
  var mat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  var beam = new THREE.Mesh(geo, mat);
  beam.position.y = 21; beam.visible = false;
  scene.add(beam);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.16, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xffd23e }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.4; ring.visible = false;
  scene.add(ring);
  AH.missionState.marker = beam;
  AH.missionState.ring = ring;
};
AH.setMarker = function (x, z, color) {
  var M = AH.missionState;
  if (!M.marker) return;
  M.marker.visible = true; M.ring.visible = true;
  M.marker.position.x = x; M.marker.position.z = z;
  M.ring.position.x = x; M.ring.position.z = z;
  if (color) { M.marker.material.color.setHex(color); M.ring.material.color.setHex(color); }
};
AH.hideMarker = function () {
  if (AH.missionState.marker) { AH.missionState.marker.visible = false; AH.missionState.ring.visible = false; }
};

AH.startMission = function (kind) {
  var S = AH.state;
  var type = kind || ['package', 'checkpoints', 'hotwheels'][AH.missionState.cycle % 3];
  AH.missionState.cycle++;
  var payBase = 150 + AH.missionState.cycle * 25;
  if (type === 'package') {
    var pk = AH.pick(PICKUP_POINTS), dp = AH.pick(DROP_POINTS);
    AH.mission = { type: type, name: 'PACKAGE RUN', phase: 'pickup',
      target: { x: pk.x, z: pk.z }, targetName: pk.name, drop: dp, pay: payBase + 100, timer: 150 };
    AH.hudToast('New job: PACKAGE RUN', '#ffd23e');
  } else if (type === 'checkpoints') {
    var cps = [];
    for (var i = 0; i < 4; i++) {
      cps.push({ x: AH.roadAt(AH.randInt(-4, 4)), z: AH.roadAt(AH.randInt(-4, 4)) });
    }
    AH.mission = { type: type, name: 'CHECKPOINT RUN', phase: 'run',
      checkpoints: cps, index: 0, target: cps[0], pay: payBase + 150, timer: 95 };
    AH.hudToast('New job: CHECKPOINT RUN', '#ffd23e');
  } else {
    // Hot wheels: mark the nearest parked sports coupe as the steal target.
    var p = AH.playerPos();
    var best = null, bestD = 1e9;
    for (var j = 0; j < AH.cars.length; j++) {
      var c = AH.cars[j];
      if (c.driver !== 'parked') continue;
      var d = AH.dist2d(p.x, p.z, c.pos.x, c.pos.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    AH.mission = { type: type, name: 'HOT WHEELS', phase: 'steal',
      carTarget: best, target: best ? { x: best.pos.x, z: best.pos.z } : { x: 0, z: 0 },
      pay: payBase + 220, timer: 170 };
    AH.hudToast('New job: HOT WHEELS', '#ffd23e');
  }
  AH.updateMissionMarker();
};

AH.updateMissionMarker = function () {
  var m = AH.mission;
  if (!m) { AH.hideMarker(); return; }
  var t = m.target;
  AH.setMarker(t.x, t.z, m.type === 'hotwheels' && m.phase === 'deliver' ? 0xff7847 : 0xffd23e);
};

AH.missionObjectiveText = function () {
  var m = AH.mission;
  if (!m) return 'Free roam — a new job is coming…';
  if (m.done) return '<b>PACKAGE RUN complete.</b> Mara is $375 richer — Port Azure glitters on.';
  var time = m.timer !== undefined ? ' · ⏱ ' + Math.max(0, Math.ceil(m.timer)) + 's' : '';
  if (m.type === 'package') {
    return m.phase === 'pickup'
      ? '<b>PACKAGE RUN:</b> pick up the package at ' + m.targetName + time
      : '<b>PACKAGE RUN:</b> deliver it to ' + m.drop.name + time;
  }
  if (m.type === 'checkpoints') {
    return '<b>CHECKPOINT RUN:</b> gate ' + (m.index + 1) + ' of ' + m.checkpoints.length + time;
  }
  return m.phase === 'steal'
    ? '<b>HOT WHEELS:</b> steal the marked ' + (m.carTarget ? m.carTarget.profile.name : 'car') + time
    : '<b>HOT WHEELS:</b> deliver it to Voss Chop Shop' + time;
};

AH.completeMission = function () {
  var m = AH.mission;
  if (!m) return;
  AH.state.cash += m.pay;
  AH.state.missionsDone += 1;
  AH.audio.jingle();
  AH.hudToast('MISSION COMPLETE +$' + m.pay, '#7dff8a');
  AH.mission = null;
  AH.hideMarker();
  AH.missionState.betweenTimer = 4;
  AH.save();
};
AH.failMission = function (why) {
  AH.audio.fail();
  AH.hudToast('Job failed — ' + why, '#ff6b81');
  AH.mission = null;
  AH.hideMarker();
  AH.missionState.betweenTimer = 4;
};

AH.updateMissions = function (dt) {
  // Marker pulse.
  var M = AH.missionState;
  if (M.ring && M.ring.visible) {
    var s = 1 + Math.sin(AH.state.time * 4) * 0.12;
    M.ring.scale.set(s, s, 1);
  }
  if (!AH.mission) {
    if (AH.state.mode === 'play') {
      M.betweenTimer -= dt;
      if (M.betweenTimer <= 0) AH.startMission(AH.state.missionsDone === 0 && AH.missionState.cycle === 0 ? 'package' : undefined);
    }
    return;
  }
  var m = AH.mission;
  if (m.done) return; // a staged/completed job (screenshot scenes) simply holds
  if (m.timer !== undefined) {
    m.timer -= dt;
    if (m.timer <= 0) { AH.failMission('out of time'); return; }
  }
  var p = AH.playerPos();
  // Hot wheels target may move if... it is parked; keep the marker glued until stolen.
  if (m.type === 'hotwheels' && m.phase === 'steal' && m.carTarget) {
    m.target = { x: m.carTarget.pos.x, z: m.carTarget.pos.z };
    AH.updateMissionMarker();
    if (AH.player.car === m.carTarget) {
      m.phase = 'deliver';
      m.target = { x: AH.chopShop.x, z: AH.chopShop.z + 16 };
      AH.updateMissionMarker();
      AH.hudToast('Got it — take it to Voss Chop Shop!', '#ffd23e');
    }
    return;
  }
  var d = AH.dist2d(p.x, p.z, m.target.x, m.target.z);
  var arriveRadius = (AH.player && AH.player.car) ? 7 : 4.5;
  if (d > arriveRadius) return;
  if (m.type === 'package' && m.phase === 'pickup') {
    m.phase = 'deliver';
    m.target = { x: m.drop.x, z: m.drop.z };
    m.timer += 60;
    AH.audio.blip();
    AH.hudToast('Package picked up!', '#7dff8a');
    AH.updateMissionMarker();
  } else if (m.type === 'package') {
    AH.completeMission();
  } else if (m.type === 'checkpoints') {
    AH.audio.blip();
    AH.state.cash += 40;
    AH.hudToast('Gate! +$40', '#7dff8a');
    m.index++;
    m.timer += 22;
    if (m.index >= m.checkpoints.length) AH.completeMission();
    else { m.target = m.checkpoints[m.index]; AH.updateMissionMarker(); }
  } else if (m.type === 'hotwheels' && m.phase === 'deliver') {
    if (AH.player.car === m.carTarget) AH.completeMission();
    else AH.hudToast('Bring the marked car itself!', '#ff6b81');
  }
};
