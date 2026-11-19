// Azure Heat — world.js: the city of Port Azure.
// Builds the three.js scene: gradient sky dome, golden-hour sun with shadows, fog, a grid of
// streets with textured asphalt + crosswalks, procedural buildings with lit windows, neon shop
// signs, traffic lights, street lamps, palm trees, props, named landmarks (police station,
// hospital, chop shop, marina), a beach + animated water on the east coast, and cash pickups.
// Also owns the slow day -> dusk lighting shift over a play session.
'use strict';
AH.world = {
  colliders: [],        // building AABBs {minX,maxX,minZ,maxZ}
  pickups: [],          // cash collectibles {mesh,taken,value}
  trafficLights: [],    // {group, nsMat, ewMat} materials swapped by phase
  lightPhase: 0,        // 0 = north-south green, 1 = east-west green
  lightTimer: 0,
  neonSigns: [],        // emissive sign materials that flicker gently
  elapsed: 0,
};

AH.makeCanvasTexture = function (w, h, draw) {
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
};

// ---- Building facade textures: dark walls, a grid of windows, some lit warm, some cool. ----
// Each variant returns {map, emissive}: the emissive canvas is black except for the lit windows,
// so facades stay deep in shadow while the windows genuinely glow after dark.
AH.buildingTextures = function () {
  var textures = [];
  var facades = ['#3d4457', '#54453a', '#41424e', '#5a3f4d', '#37424e', '#4e4438'];
  for (var v = 0; v < 6; v++) {
    (function (v) {
      var cols = 5, rows = 10;
      var cells = [];
      for (var i = 0; i < cols * rows; i++) {
        var r = AH.rand();
        cells.push(r < 0.42 ? AH.pick(['#ffd489', '#ffb35c', '#fff3b0', '#ffd489']) : (r < 0.52 ? '#bfe6ff' : null));
      }
      var tex = AH.makeCanvasTexture(128, 256, function (g, w, h) {
        g.fillStyle = facades[v]; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, w, 10);
        var cw = w / cols, ch = h / rows;
        for (var x = 0; x < cols; x++) for (var y = 0; y < rows; y++) {
          g.fillStyle = cells[y * cols + x] || '#20242e';
          g.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
        }
      });
      var emi = AH.makeCanvasTexture(128, 256, function (g, w, h) {
        g.fillStyle = '#000000'; g.fillRect(0, 0, w, h);
        var cw = w / cols, ch = h / rows;
        for (var x = 0; x < cols; x++) for (var y = 0; y < rows; y++) {
          var c = cells[y * cols + x];
          if (!c) continue;
          g.fillStyle = c;
          g.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
        }
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      emi.wrapS = emi.wrapT = THREE.RepeatWrapping;
      textures.push({ map: tex, emissive: emi });
    })(v);
  }
  return textures;
};

// A shop sign with real text on a canvas: bright neon letters on a dark board.
AH.signTexture = function (text, color, bg) {
  return AH.makeCanvasTexture(512, 128, function (g, w, h) {
    g.fillStyle = bg || '#14101f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.font = 'bold 58px Verdana, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 22; g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 2);
  });
};

AH.buildWorld = function (scene) {
  var W = AH.world;
  scene.fog = new THREE.Fog(0xe8906a, 170, 880);
  // Gradient sky dome: warm horizon melting into a deep dusk blue zenith.
  var skyTex = AH.makeCanvasTexture(32, 512, function (g, w, h) {
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2d3a6e'); grad.addColorStop(0.42, '#7a5a9e');
    grad.addColorStop(0.68, '#e8703a'); grad.addColorStop(0.82, '#ffb35c'); grad.addColorStop(1, '#ffd489');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  sky.name = 'skyDome';
  scene.add(sky);
  W.sky = sky;

  // Lights: warm sun + hemisphere fill. One 2048 shadow map follows the player.
  var hemi = new THREE.HemisphereLight(0xffd9a8, 0x3a4a6b, 0.45);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffb36b, 1.35);
  sun.position.set(-120, 140, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); // 1024 keeps software renderers (SwiftShader) playable; still crisp at this scale
  sun.shadow.camera.left = -110; sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110; sun.shadow.camera.bottom = -110;
  sun.shadow.camera.far = 500; sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  W.sun = sun; W.hemi = hemi;

  var groundMat = new THREE.MeshStandardMaterial({ color: 0x6f6a5e, roughness: 1 });
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true;
  scene.add(ground);

  // ---- Roads: textured asphalt strips (edge lines + dashed centre line) + crosswalks. ----
  var asphaltTex = AH.makeCanvasTexture(128, 256, function (g, w, h) {
    g.fillStyle = '#33363d'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (var i = 0; i < 260; i++) g.fillRect(AH.rand() * w, AH.rand() * h, 2, 2);
    g.fillStyle = '#e8e8e8'; g.fillRect(4, 0, 4, h); g.fillRect(w - 8, 0, 4, h);
    g.fillStyle = '#ffd23e';
    for (var y = 0; y < h; y += 64) g.fillRect(w / 2 - 3, y + 8, 6, 34);
  });
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  var roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 });
  var roadGeoNS = new THREE.PlaneGeometry(AH.ROAD_HALF * 2, AH.CITY + AH.PITCH);
  var roadGeoEW = new THREE.PlaneGeometry(AH.CITY + AH.PITCH, AH.ROAD_HALF * 2);
  var k, mesh;
  for (k = -AH.GRID; k <= AH.GRID; k++) {
    var rt = asphaltTex.clone(); rt.needsUpdate = true; rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
    rt.repeat.set(1, (AH.CITY + AH.PITCH) / 28);
    var m1 = new THREE.Mesh(roadGeoNS, new THREE.MeshStandardMaterial({ map: rt, roughness: 0.95 }));
    m1.rotation.x = -Math.PI / 2; m1.position.set(AH.roadAt(k), 0, 0); m1.receiveShadow = true; scene.add(m1);
    var rt2 = asphaltTex.clone(); rt2.needsUpdate = true; rt2.wrapS = rt2.wrapT = THREE.RepeatWrapping;
    rt2.repeat.set((AH.CITY + AH.PITCH) / 28, 1); rt2.rotation = Math.PI / 2;
    var m2 = new THREE.Mesh(roadGeoEW, new THREE.MeshStandardMaterial({ map: rt2, roughness: 0.95 }));
    m2.rotation.x = -Math.PI / 2; m2.rotation.z = Math.PI / 2; m2.position.set(0, 0.005, AH.roadAt(k)); m2.receiveShadow = true; scene.add(m2);
  }
  // Crosswalk pads at every intersection.
  var crossTex = AH.makeCanvasTexture(128, 128, function (g, w, h) {
    g.fillStyle = '#33363d'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(240,240,240,0.85)';
    for (var i = 0; i < 4; i++) {
      g.fillRect(10 + i * 30, 4, 16, 22); g.fillRect(10 + i * 30, h - 26, 16, 22);
      g.fillRect(4, 10 + i * 30, 22, 16); g.fillRect(w - 26, 10 + i * 30, 22, 16);
    }
  });
  var crossMat = new THREE.MeshStandardMaterial({ map: crossTex, roughness: 0.95 });
  var crossGeo = new THREE.PlaneGeometry(AH.ROAD_HALF * 2 + 3, AH.ROAD_HALF * 2 + 3);
  for (var ix = -AH.GRID; ix <= AH.GRID; ix++) for (var iz = -AH.GRID; iz <= AH.GRID; iz++) {
    mesh = new THREE.Mesh(crossGeo, crossMat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(AH.roadAt(ix), 0.01, AH.roadAt(iz));
    mesh.receiveShadow = true; scene.add(mesh);
  }

  // ---- Blocks: sidewalk slab + procedural buildings + props + signs + palms. ----
  var facadeTex = AH.buildingTextures();
  var facadeMats = facadeTex.map(function (t) {
    return new THREE.MeshStandardMaterial({ map: t.map, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: 0.85, roughness: 0.9 });
  });
  var roofMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 1 });
  var slabMat = new THREE.MeshStandardMaterial({ color: 0x9b968a, roughness: 1 });
  var slabGeo = new THREE.BoxGeometry(AH.BLOCK + 8, 0.3, AH.BLOCK + 8);
  var crateMat = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 1 });
  var crateGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  var barrierMat = new THREE.MeshStandardMaterial({ color: 0xff7847, roughness: 0.8 });
  var barrierGeo = new THREE.BoxGeometry(2.6, 0.9, 0.5);
  var shopNames = [['MARINA CAFE', '#ff6bd5'], ['HOTEL AZUL', '#4dd8ff'], ['PAWN & CO', '#ffd23e'], ['CLUB VELVET', '#b78bff'],
    ['RAMEN YA', '#ff8a5c'], ['AZURE GYM', '#7dff8a'], ['DISCO MAR', '#ff6b81'], ['BOOKS', '#ffe9a8'], ['TACO SOL', '#ffb35c'], ['INK PARLOR', '#4dd8ff']];
  var signIdx = 0;

  function addBuilding(cx, cz, w, d, hgt) {
    var mat = AH.pick(facadeMats);
    var mats = [mat, mat, roofMat, roofMat, mat, mat];
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mats);
    b.position.set(cx, hgt / 2 + 0.15, cz);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    W.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    // Neon sign on a random share of buildings, facing the nearest road.
    if (AH.rand() < 0.30) {
      var s = AH.pick(shopNames);
      var st = AH.signTexture(s[0], s[1]);
      var sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.85, 15), 2.6, 0.4),
        new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 1.4, color: 0x111111 }));
      var face = AH.randInt(0, 3);
      var sy = AH.randRange(4, Math.max(5, hgt - 3));
      if (face === 0) { sign.position.set(cx, sy, cz - d / 2 - 0.25); }
      else if (face === 1) { sign.position.set(cx, sy, cz + d / 2 + 0.25); }
      else if (face === 2) { sign.position.set(cx - w / 2 - 0.25, sy, cz); sign.rotation.y = Math.PI / 2; }
      else { sign.position.set(cx + w / 2 + 0.25, sy, cz); sign.rotation.y = Math.PI / 2; }
      scene.add(sign);
      W.neonSigns.push(sign.material);
      signIdx++;
    }
    return b;
  }

  for (var bx = -AH.GRID; bx < AH.GRID; bx++) for (var bz = -AH.GRID; bz < AH.GRID; bz++) {
    var cx = AH.roadAt(bx) + AH.PITCH / 2, cz = AH.roadAt(bz) + AH.PITCH / 2;
    var slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(cx, 0, cz); slab.receiveShadow = true; scene.add(slab);
    if (bx >= AH.GRID - 1) { // east edge blocks are beach park: palms + low pavilions only
      if (AH.rand() < 0.8) addBuilding(cx, cz, 16, 14, AH.randRange(5, 8));
      continue;
    }
    var style = AH.rand();
    if (style < 0.4) { // one tower
      addBuilding(cx + AH.randRange(-3, 3), cz + AH.randRange(-3, 3), AH.randRange(20, 28), AH.randRange(20, 28), AH.randRange(22, 52));
    } else if (style < 0.75) { // two mid-rises
      addBuilding(cx - 10, cz - 9, 16, 15, AH.randRange(12, 30));
      addBuilding(cx + 10, cz + 10, 15, 16, AH.randRange(10, 26));
    } else { // four low blocks with an alley between them (pickups hide here)
      addBuilding(cx - 10, cz - 10, 14, 14, AH.randRange(7, 14));
      addBuilding(cx + 10, cz - 10, 14, 14, AH.randRange(7, 14));
      addBuilding(cx - 10, cz + 10, 14, 14, AH.randRange(7, 14));
      addBuilding(cx + 10, cz + 10, 14, 14, AH.randRange(7, 14));
    }
    // Props: crates and barriers on some sidewalks.
    if (AH.rand() < 0.5) {
      var crate = new THREE.Mesh(crateGeo, crateMat);
      crate.position.set(cx + AH.randRange(-19, 19), 0.95, cz + (AH.rand() < 0.5 ? -21 : 21));
      crate.castShadow = true; scene.add(crate);
    }
    if (AH.rand() < 0.3) {
      var bar = new THREE.Mesh(barrierGeo, barrierMat);
      bar.position.set(cx + (AH.rand() < 0.5 ? -21 : 21), 0.6, cz + AH.randRange(-16, 16));
      bar.rotation.y = Math.PI / 2; bar.castShadow = true; scene.add(bar);
    }
  }

  AH.buildPalmsAndLamps(scene);
  AH.buildTrafficLights(scene);
  AH.buildLandmarks(scene, addBuilding);
  AH.buildCoast(scene);
  AH.buildPickups(scene);
};

// ---- Palm trees + street lamps with fake-glow sprites. ----
AH.buildPalmsAndLamps = function (scene) {
  var glowTex = AH.makeCanvasTexture(64, 64, function (g, w, h) {
    var grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,210,140,0.9)'); grad.addColorStop(1, 'rgba(255,210,140,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  AH.glowTexture = glowTex;
  var trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
  var frondMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 1, side: THREE.DoubleSide });
  var trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 6.5, 6);
  var frondGeo = new THREE.BoxGeometry(0.55, 0.06, 3.6);
  function palm(x, z) {
    var g = new THREE.Group();
    var trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3.25; trunk.rotation.z = AH.randRange(-0.08, 0.08); trunk.castShadow = true; g.add(trunk);
    for (var i = 0; i < 6; i++) {
      // Each frond is a thin leaf on a pivot at the crown, yawed around and drooped down.
      var pivot = new THREE.Group();
      pivot.position.y = 6.5;
      pivot.rotation.y = (i / 6) * Math.PI * 2 + AH.randRange(-0.2, 0.2);
      var f = new THREE.Mesh(frondGeo, frondMat);
      f.position.set(0, 0.15, 1.7);
      f.rotation.x = -0.42; // tip droops below horizontal
      pivot.add(f);
      g.add(pivot);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  }
  var lampPoleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.7, metalness: 0.5 });
  var lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xffd489, emissive: 0xffbe6b, emissiveIntensity: 1.6 });
  var poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.6, 6);
  var headGeo = new THREE.SphereGeometry(0.42, 8, 8);
  function lamp(x, z) {
    var g = new THREE.Group();
    var pole = new THREE.Mesh(poleGeo, lampPoleMat); pole.position.y = 2.8; g.add(pole);
    var head = new THREE.Mesh(headGeo, lampHeadMat); head.position.y = 5.7; g.add(head);
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0.55, depthWrite: false }));
    spr.scale.set(4.5, 4.5, 1); spr.position.y = 5.7; g.add(spr);
    g.position.set(x, 0, z);
    scene.add(g);
  }
  // Palms along the beach and boulevards; lamps at alternate intersections.
  for (var k = -AH.GRID; k <= AH.GRID; k++) {
    palm(AH.roadAt(k) + 11, AH.roadAt(-AH.GRID) - 4 + AH.randRange(-2, 2));
    palm(AH.roadAt(AH.GRID) + 16 + AH.randRange(0, 6), AH.roadAt(k) + AH.randRange(-8, 8));
    if (k % 2 === 0) {
      lamp(AH.roadAt(k) + 10, AH.roadAt(k) + 10);
      lamp(AH.roadAt(k) - 10, AH.roadAt(-k) - 10);
    }
  }
  for (var i = 0; i < 26; i++) {
    var bx = AH.randInt(-AH.GRID, AH.GRID - 1), bz = AH.randInt(-AH.GRID, AH.GRID - 1);
    palm(AH.roadAt(bx) + AH.PITCH / 2 + AH.randRange(-20, 20), AH.roadAt(bz) + 22);
  }
};

// ---- Traffic lights at the inner intersections, cycling as one coordinated phase. ----
AH.buildTrafficLights = function (scene) {
  var W = AH.world;
  var poleMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.7, metalness: 0.4 });
  var boxMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.8 });
  W.matRedOn = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 2.2 });
  W.matRedOff = new THREE.MeshStandardMaterial({ color: 0x330d0d, emissive: 0x220000, emissiveIntensity: 0.3 });
  W.matGreenOn = new THREE.MeshStandardMaterial({ color: 0x003300, emissive: 0x22ff66, emissiveIntensity: 2.2 });
  W.matGreenOff = new THREE.MeshStandardMaterial({ color: 0x0d3316, emissive: 0x002200, emissiveIntensity: 0.3 });
  var poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6);
  var boxGeo = new THREE.BoxGeometry(0.55, 1.5, 0.55);
  var bulbGeo = new THREE.SphereGeometry(0.19, 8, 8);
  for (var ix = -2; ix <= 2; ix++) for (var iz = -2; iz <= 2; iz++) {
    var g = new THREE.Group();
    var pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 2.2; g.add(pole);
    var box = new THREE.Mesh(boxGeo, boxMat); box.position.y = 4.9; g.add(box);
    var red = new THREE.Mesh(bulbGeo, W.matRedOff); red.position.set(0, 5.35, 0.3); g.add(red);
    var green = new THREE.Mesh(bulbGeo, W.matGreenOn); green.position.set(0, 4.45, 0.3); g.add(green);
    g.position.set(AH.roadAt(ix) + 10.5, 0, AH.roadAt(iz) + 10.5);
    scene.add(g);
    W.trafficLights.push({ group: g, red: red, green: green, x: AH.roadAt(ix), z: AH.roadAt(iz) });
  }
};
// Traffic phase for an axis at time t: NS and EW alternate every 7 seconds.
AH.lightForAxis = function (axis) { // axis 'ns' | 'ew' -> 'green' | 'red'
  var phase = Math.floor(AH.world.elapsed / 7) % 2;
  return (axis === 'ns') === (phase === 0) ? 'green' : 'red';
};

// ---- Landmarks: police station (south), hospital (north), chop shop (west), marina (east). ----
AH.buildLandmarks = function (scene, addBuilding) {
  function landmark(x, z, w, d, h, color, signText, signColor) {
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.85 });
    var roof = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 1 });
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roof, roof, mat, mat]);
    b.position.set(x, h / 2 + 0.15, z); b.castShadow = true; b.receiveShadow = true; scene.add(b);
    AH.world.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    var st = AH.signTexture(signText, signColor, '#101018');
    var sign = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w * 0.9, 20), 3, 0.4),
      new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 1.5, color: 0x111111 }));
    sign.position.set(x, h - 1.5, z + d / 2 + 0.3);
    scene.add(sign);
    return b;
  }
  var P = AH.PITCH;
  AH.policeStation = new THREE.Vector3(P * 0.5, 0, P * 4.5);
  landmark(AH.policeStation.x, AH.policeStation.z, 30, 20, 14, 0x3a4a6b, 'PORT AZURE PD', '#4dd8ff');
  AH.hospital = new THREE.Vector3(-P * 1.5, 0, -P * 4.5);
  landmark(AH.hospital.x, AH.hospital.z, 30, 20, 16, 0xd8d8e0, 'AZURE GENERAL', '#ff5c5c');
  AH.chopShop = new THREE.Vector3(-P * 4.5, 0, P * 0.5);
  landmark(AH.chopShop.x, AH.chopShop.z, 24, 18, 9, 0x54453a, 'VOSS CHOP SHOP', '#ff7847');
  AH.marina = new THREE.Vector3(P * 5.5, 0, -P * 1.5);
  landmark(AH.marina.x, AH.marina.z, 20, 14, 7, 0x3f6b7a, 'MARINA CAFE', '#ff6bd5');
};

// ---- The coast: sand strip then a big animated water plane east of the city. ----
AH.buildCoast = function (scene) {
  var sand = new THREE.Mesh(new THREE.PlaneGeometry(60, AH.CITY + 200),
    new THREE.MeshStandardMaterial({ color: 0xe6cf9a, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(AH.CITY / 2 + 55, -0.02, 0); sand.receiveShadow = true; scene.add(sand);
  var waterMat = new THREE.MeshStandardMaterial({ color: 0x14789e, roughness: 0.22, metalness: 0.35, transparent: true, opacity: 0.94 });
  var water = new THREE.Mesh(new THREE.PlaneGeometry(560, 1400), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(AH.CITY / 2 + 85 + 278, 0.03, 0); // above the base ground plane, or it is hidden under it
  scene.add(water);
  AH.world.water = water;
  // A simple pier: planks out over the water with lamp posts.
  var pierMat = new THREE.MeshStandardMaterial({ color: 0x7a5c3d, roughness: 1 });
  var pier = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 8), pierMat);
  pier.position.set(AH.CITY / 2 + 95, 0.4, AH.roadAt(-1));
  scene.add(pier);
};

// ---- Collectible cash pickups hidden in alleys and along the beach. ----
AH.buildPickups = function (scene) {
  var mat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1d9e4b, emissiveIntensity: 0.9, roughness: 0.4 });
  var geo = new THREE.BoxGeometry(1.1, 0.5, 0.6);
  for (var i = 0; i < 26; i++) {
    var bx = AH.randInt(-AH.GRID, AH.GRID - 2), bz = AH.randInt(-AH.GRID, AH.GRID - 1);
    var x = AH.roadAt(bx) + AH.PITCH / 2 + AH.pick([-6, 0, 6]);
    var z = AH.roadAt(bz) + AH.PITCH / 2 + AH.pick([-20, 20]);
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, 1.1, z);
    m.rotation.y = AH.rand() * Math.PI;
    scene.add(m);
    AH.world.pickups.push({ mesh: m, taken: false, value: AH.pick([25, 25, 50, 100]) });
  }
};

// Per-frame world ambience: water shimmer, traffic-light cycling, neon flicker, the sun's slow
// day -> dusk shift, and the shadow camera following the player.
AH.updateWorld = function (dt, focusPos) {
  var W = AH.world;
  W.elapsed += dt;
  if (W.water) {
    W.water.position.y = 0.03 + Math.sin(W.elapsed * 0.7) * 0.02;
    W.water.material.color.setHSL(0.54, 0.72, 0.34 + Math.sin(W.elapsed * 0.4) * 0.04);
  }
  // Traffic lights swap materials when the phase flips.
  var phase = Math.floor(W.elapsed / 7) % 2;
  if (phase !== W.lightPhase) {
    W.lightPhase = phase;
    for (var i = 0; i < W.trafficLights.length; i++) {
      var tl = W.trafficLights[i];
      tl.red.material = phase === 0 ? W.matRedOff : W.matRedOn;   // NS green in phase 0: NS-facing red off
      tl.green.material = phase === 0 ? W.matGreenOn : W.matGreenOff;
    }
  }
  // Neon flicker: one sign in twenty dips briefly, the rest hold a warm glow.
  for (var j = 0; j < W.neonSigns.length; j++) {
    W.neonSigns[j].emissiveIntensity = (Math.sin(W.elapsed * 13 + j * 7.3) > 0.97) ? 0.5 : 1.4;
  }
  // Day -> dusk over ~4 minutes of play: sun sinks, warms and dims; fog thickens slightly.
  var dusk = AH.clamp(W.elapsed / 240, 0, 1);
  if (W.sun) {
    W.sun.position.set(-120 + dusk * -40, 140 - dusk * 78, -60 + dusk * 30);
    W.sun.intensity = 1.35 - dusk * 0.45;
    W.sun.color.setHSL(0.09 - dusk * 0.03, 0.85, 0.62 - dusk * 0.1);
    if (focusPos) {
      W.sun.position.x += focusPos.x; W.sun.position.z += focusPos.z;
      W.sun.target.position.set(focusPos.x, 0, focusPos.z);
    }
  }
  if (W.hemi) W.hemi.intensity = 0.55 - dusk * 0.18;
  // Pickups bob and spin until collected.
  for (var p = 0; p < W.pickups.length; p++) {
    var pk = W.pickups[p];
    if (pk.taken) continue;
    pk.mesh.rotation.y += dt * 2.2;
    pk.mesh.position.y = 1.1 + Math.sin(W.elapsed * 3 + p) * 0.18;
  }
};

// Collect any pickup near a position; returns total cash collected this call.
AH.collectPickups = function (pos, radius) {
  var got = 0;
  for (var i = 0; i < AH.world.pickups.length; i++) {
    var pk = AH.world.pickups[i];
    if (pk.taken) continue;
    if (AH.dist2d(pos.x, pos.z, pk.mesh.position.x, pk.mesh.position.z) < radius) {
      pk.taken = true; pk.mesh.visible = false; got += pk.value;
    }
  }
  return got;
};
