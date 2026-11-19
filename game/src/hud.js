// Azure Heat — hud.js: DOM HUD (cash, health, wanted stars, busted meter, weapon, speed,
// objective, prompts, toasts) and the canvas minimap. The minimap is north-up and city-wide:
// roads, the coast, traffic as white dots, police as flashing blue dots, collectibles as green
// specks, the mission marker as a pulsing gold diamond and the player as a white arrow.
'use strict';
AH.hud = {};
AH.hudInit = function () {
  var h = AH.hud;
  h.root = document.getElementById('hud');
  h.cash = document.getElementById('cash');
  h.stars = document.getElementById('stars');
  h.healthbar = document.getElementById('healthbar');
  h.bustedwrap = document.getElementById('bustedwrap');
  h.bustedbar = document.getElementById('bustedbar');
  h.weapon = document.querySelector('#weapon .ammo');
  h.speed = document.getElementById('speed');
  h.objective = document.getElementById('objective');
  h.prompt = document.getElementById('prompt');
  h.toast = document.getElementById('toast');
  h.crosshair = document.getElementById('crosshair');
  h.minimap = document.getElementById('minimap').getContext('2d');
  h.toastTimer = 0;
  h.mapFrame = 0;
};
AH.hudToast = function (text, color) {
  var h = AH.hud;
  if (!h.toast) return;
  h.toast.textContent = text;
  h.toast.style.color = color || '#7dff8a';
  h.toast.style.opacity = '1';
  h.toastTimer = 3.2;
  var st = document.getElementById('status');
  if (st) st.textContent = text;
};
AH.hudPrompt = function (text) {
  var h = AH.hud;
  if (!h.prompt) return;
  if (text) { h.prompt.textContent = text; h.prompt.style.display = 'block'; }
  else h.prompt.style.display = 'none';
};

AH.updateHUD = function (dt) {
  var S = AH.state, h = AH.hud;
  if (!h.cash) return;
  h.cash.textContent = '$' + S.cash;
  h.healthbar.style.width = AH.clamp(S.health, 0, 100) + '%';
  // Wanted stars: filled for earned stars; they flash while the player is successfully hiding.
  var hiding = S.wanted > 0 && !AH.policeState.seen && S.unseenTime > 2;
  var html = '';
  for (var i = 0; i < 5; i++) html += '<span class="' + (i < S.wanted ? '' : 'off') + '">★</span>';
  h.stars.innerHTML = html;
  h.stars.style.opacity = hiding && Math.sin(S.time * 6) > 0 ? '0.35' : '1';
  h.stars.title = hiding ? 'Hiding — stay out of sight to cool down' : '';
  if (S.busted > 0.02) {
    h.bustedwrap.style.display = 'block';
    h.bustedbar.style.width = (S.busted * 100) + '%';
  } else h.bustedwrap.style.display = 'none';
  h.weapon.textContent = S.ammo + ' / ' + S.reserve + (S.reloading > 0 ? ' …' : '');
  var inCar = AH.player && AH.player.car;
  if (inCar) {
    h.speed.style.display = 'block';
    h.speed.textContent = Math.round(Math.abs(AH.player.car.speed) * 3.2) + ' km/h';
  } else h.speed.style.display = 'none';
  h.crosshair.style.display = (!inCar && S.mode === 'play') ? 'block' : 'none';
  var obj = AH.missionObjectiveText();
  if (hiding) obj += ' · <b style="color:#7dff8a">HIDING — stay unseen to lose the heat</b>';
  if (h.objective.innerHTML !== obj) h.objective.innerHTML = obj;
  if (h.toastTimer > 0) {
    h.toastTimer -= dt;
    if (h.toastTimer <= 0) h.toast.style.opacity = '0';
  }
  AH.drawMinimap();
};

AH.drawMinimap = function () {
  var h = AH.hud;
  if (!h.minimap) return;
  h.mapFrame++;
  if (h.mapFrame % 2) return; // 30 Hz is plenty for the map
  var g = h.minimap, W = 180, H = 180;
  var extent = AH.CITY + 190; // include the coast
  var scale = W / extent;
  function mx(x) { return (x + extent / 2) * scale; }
  function mz(z) { return (z + extent / 2) * scale; }
  g.fillStyle = '#20242e'; g.fillRect(0, 0, W, H);
  // Water on the east.
  g.fillStyle = '#14586e';
  g.fillRect(mx(AH.CITY / 2 + 85), 0, W - mx(AH.CITY / 2 + 85), H);
  g.fillStyle = '#e6cf9a';
  g.fillRect(mx(AH.CITY / 2 + 25), 0, mx(AH.CITY / 2 + 85) - mx(AH.CITY / 2 + 25), H);
  // Roads.
  g.strokeStyle = '#565d6b'; g.lineWidth = 2;
  for (var k = -AH.GRID; k <= AH.GRID; k++) {
    g.beginPath(); g.moveTo(mx(AH.roadAt(k)), 0); g.lineTo(mx(AH.roadAt(k)), H); g.stroke();
    g.beginPath(); g.moveTo(0, mz(AH.roadAt(k))); g.lineTo(W, mz(AH.roadAt(k))); g.stroke();
  }
  // Collectibles.
  g.fillStyle = '#2ecc71';
  for (var i = 0; i < AH.world.pickups.length; i++) {
    var pk = AH.world.pickups[i];
    if (!pk.taken) g.fillRect(mx(pk.mesh.position.x) - 1, mz(pk.mesh.position.z) - 1, 2, 2);
  }
  // Traffic + parked cars.
  g.fillStyle = '#e8e8ec';
  for (var c = 0; c < AH.cars.length; c++) {
    var car = AH.cars[c];
    if (car.driver === 'police') continue;
    g.fillRect(mx(car.pos.x) - 1.5, mz(car.pos.z) - 1.5, 3, 3);
  }
  // Police: flashing blue/red.
  for (var p = 0; p < AH.police.length; p++) {
    var pc = AH.police[p];
    g.fillStyle = Math.sin(AH.state.time * 8 + p) > 0 ? '#3388ff' : '#ff4444';
    g.beginPath(); g.arc(mx(pc.pos.x), mz(pc.pos.z), 3, 0, 7); g.fill();
  }
  // Mission marker: pulsing gold diamond.
  if (AH.mission) {
    var t = AH.mission.target;
    var r = 4 + Math.sin(AH.state.time * 5) * 1.2;
    g.fillStyle = '#ffd23e';
    g.beginPath();
    g.moveTo(mx(t.x), mz(t.z) - r); g.lineTo(mx(t.x) + r, mz(t.z)); g.lineTo(mx(t.x), mz(t.z) + r); g.lineTo(mx(t.x) - r, mz(t.z));
    g.closePath(); g.fill();
  }
  // Chop shop wrench mark (always useful to know).
  g.fillStyle = '#ff7847';
  g.fillRect(mx(AH.chopShop.x) - 2, mz(AH.chopShop.z) - 2, 4, 4);
  // Player arrow, rotated to facing.
  var pp = AH.playerPos();
  var ang = AH.player && AH.player.car ? AH.player.car.angle : (AH.player ? AH.player.angle : 0);
  g.save();
  g.translate(mx(pp.x), mz(pp.z));
  g.rotate(Math.PI - ang); // canvas y is world +z (south); arrow drawn pointing up (north)
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(0, 2.5); g.lineTo(-4, 5); g.closePath(); g.fill();
  g.restore();
};
