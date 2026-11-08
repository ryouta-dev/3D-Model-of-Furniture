// Клиентский просмотрщик для экспорта (этап 3).
// Классический скрипт без import/export: exporter.py вставляет его
// в автономный HTML вместе с three.js и генераторами.
// Глобалы из предыдущих блоков: THREE, MM, COLORS, colorById,
// buildItemByType, summarizeCut, buildRoomSpec, normalizeRoom,
// и window.__PROJECT__ / window.__SETTINGS__.
// Редактора тут нет: только вращение, масштаб, двери/ящики,
// цвета, комната, день/ночь, размеры, пароль.

(function () {
  var PROJECT = window.__PROJECT__;
  var SETTINGS = window.__SETTINGS__ || {};
  var container = document.getElementById('view');
  var titleEl = document.getElementById('proj-title');
  var cutEl = document.getElementById('cut');
  titleEl.textContent = PROJECT.name || 'Проект';

  // --- Пароль (простая защита на стороне клиента) ---
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  var gate = document.getElementById('gate');
  var gateInput = document.getElementById('gate-input');
  var gateBtn = document.getElementById('gate-btn');
  var gateMsg = document.getElementById('gate-msg');
  var unlocked = !SETTINGS.passwordHash;
  if (unlocked) gate.classList.add('hidden');
  else {
    gateBtn.onclick = function () {
      if (fnv(gateInput.value) === SETTINGS.passwordHash) {
        unlocked = true;
        gate.classList.add('hidden');
        start();
      } else {
        gateMsg.textContent = 'Неверный пароль.';
      }
    };
    gateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') gateBtn.click();
    });
    gateInput.focus();
  }

  var renderer, scene, camera, orbit, itemsRoot, doors, drawers, sliding, roomRoot, currentRoom, groundPlane;
  var builtList = [];
  var materials = {};
  var roomOn = true;
  var roomBuilt = false; // ленивая загрузка: геометрия комнаты строится только при первом включении
  var dayNight = 'day';
  var showDims = false;
  var labels = [];
  var priceEl = document.getElementById('price');

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return h;
  }
  function woodTexture(hex, dark, seed) {
    var rnd = mulberry32(seed);
    // 256×256: на телефоне с DPR 2–3 текстура 128px заметно мылит.
    var S = 256;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    g.strokeStyle = dark;
    for (var i = 0; i < 90; i++) {
      g.globalAlpha = 0.12 + rnd() * 0.18;
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath();
      var y = rnd() * S;
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.31, y + 6, S * 0.67, y - 6, S, y);
      g.stroke();
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  // Пол комнаты: прямые доски ламината (как в редакторе), а не плоский цвет.
  function plankTexture(hex, dark) {
    var rnd = mulberry32(seedOf('floor') + 7);
    var S = 256;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, S, S);
    g.strokeStyle = dark;
    var rows = 4;
    for (var r = 0; r < rows; r++) {
      g.globalAlpha = 0.25 + rnd() * 0.2;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, (r + 1) * S / rows); g.lineTo(S, (r + 1) * S / rows); g.stroke();
      // стыки досок по длине
      var seam = rnd() * S;
      g.globalAlpha = 0.3; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(seam, r * S / rows); g.lineTo(seam, (r + 1) * S / rows); g.stroke();
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  function makeMaterials() {
    for (var k in materials) if (materials[k]) { materials[k].map && materials[k].map.dispose(); materials[k].dispose(); }
    for (var k2 in materials) delete materials[k2];
    for (var i = 0; i < COLORS.length; i++) {
      var col = COLORS[i];
      var map = col.wood ? woodTexture(col.hex, col.dark, seedOf(col.id)) : null;
      materials['corpus_' + col.id] = new THREE.MeshStandardMaterial({
        color: col.hex, roughness: 0.8, map: map ? map.clone() : null, envMapIntensity: 0.5
      });
      materials['facade_' + col.id] = new THREE.MeshStandardMaterial({
        color: col.hex, roughness: 0.42, metalness: 0.05, map: map ? map.clone() : null, envMapIntensity: 0.8
      });
      if (materials['corpus_' + col.id].map) materials['corpus_' + col.id].map.needsUpdate = true;
      if (materials['facade_' + col.id].map) materials['facade_' + col.id].map.needsUpdate = true;
    }
    materials.hdf = new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.9, envMapIntensity: 0.3 });
    materials.top = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.35, envMapIntensity: 0.7 });
    materials.handle = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.0 });
    materials.skirting = new THREE.MeshStandardMaterial({ color: 0xe8e6e1, roughness: 0.6, envMapIntensity: 0.4 });
    materials.frame = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4, envMapIntensity: 0.6 });
    materials.glass = new THREE.MeshStandardMaterial({
      color: 0xcfe8ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.35, envMapIntensity: 1.2
    });
  }

  function box(size, mat, edge) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    m.castShadow = true; m.receiveShadow = true;
    if (edge) {
      var e = new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
      );
      e.raycast = function () {}; // рёбра не ловят клики
      m.add(e);
    }
    return m;
  }

  function buildMeshesFor(item, built) {
    var root = new THREE.Group();
    root.position.set(item.position.x * MM, 0, item.position.z * MM);
    root.rotation.y = item.rotationY || 0;
    var groups = {};
    var order = [];
    for (var i = 0; i < built.parts.length; i++) {
      var part = built.parts[i];
      var parent = root;
      if (part.group) {
        var info = null;
        for (var a = 0; a < built.anim.doors.length; a++) if (built.anim.doors[a].id === part.group) info = built.anim.doors[a];
        for (var b = 0; b < built.anim.drawers.length; b++) if (built.anim.drawers[b].id === part.group) info = built.anim.drawers[b];
        var sl = built.anim.sliding || [];
        for (var s = 0; s < sl.length; s++) if (sl[s].id === part.group) info = sl[s];
        var g = groups[part.group];
        if (!g) {
          var pivot = new THREE.Group();
          pivot.position.set(info.pivot[0] * MM, info.pivot[1] * MM, info.pivot[2] * MM);
          pivot.userData.isPivot = true;
          root.add(pivot);
          g = { pivot: pivot, info: info, openT: 0, openTarget: 0 };
          groups[part.group] = g;
          order.push(g);
        }
        parent = g.pivot;
      }
      var baseMat = (part.material === 'corpus' || part.material === 'facade')
        ? materials[part.material + '_' + colorById(item[part.material]).id]
        : materials[part.material];
      // Материал на деталь клонируем с повтором текстуры по размеру:
      // одна текстура 0..1 на все фасады растягивала зерно на высоких
      // дверях купе в «волны». Повтор ~1 на 700 мм держит масштаб зерна.
      var mat = baseMat;
      if (baseMat && baseMat.map) {
        var key = part.material + '_' + (item[part.material] || '') + '_' +
          Math.max(1, Math.min(4, Math.round(part.size[0] / 700))) + 'x' +
          Math.max(1, Math.min(4, Math.round(part.size[1] / 700)));
        if (!materials[key]) {
          var cm = baseMat.clone();
          cm.map = baseMat.map.clone();
          cm.map.repeat.set(
            Math.max(1, Math.min(4, Math.round(part.size[0] / 700))),
            Math.max(1, Math.min(4, Math.round(part.size[1] / 700)))
          );
          cm.map.needsUpdate = true;
          materials[key] = cm;
        }
        mat = materials[key];
      }
      var sz = part.size.map(function (v) { return v * MM; });
      var mesh = box(sz, mat, part.edge !== false);
      mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
      parent.add(mesh);
    }
    return { root: root, groups: order };
  }

  function rebuild() {
    if (itemsRoot) {
      itemsRoot.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      scene.remove(itemsRoot);
    }
    doors = []; drawers = []; sliding = [];
    itemsRoot = new THREE.Group();
    for (var i = 0; i < builtList.length; i++) {
      var r = buildMeshesFor(builtList[i].item, builtList[i].built);
      for (var j = 0; j < r.groups.length; j++) {
        if (r.groups[j].info.direction !== undefined) sliding.push(r.groups[j]);
        else if (r.groups[j].info.travel !== undefined) drawers.push(r.groups[j]);
        else doors.push(r.groups[j]);
      }
      itemsRoot.add(r.root);
    }
    scene.add(itemsRoot);
    if (roomRoot) roomRoot.visible = roomOn;
    if (groundPlane) groundPlane.visible = !roomOn;
  }

  function applyOpen() {
    for (var i = 0; i < doors.length; i++) {
      var d = doors[i];
      d.openT += (d.openTarget - d.openT) * 0.18;
      if (Math.abs(d.openTarget - d.openT) < 0.001) d.openT = d.openTarget;
      d.pivot.rotation.y = d.info.sign * d.openT * d.info.angle;
    }
    for (var j = 0; j < drawers.length; j++) {
      var dr = drawers[j];
      dr.openT += (dr.openTarget - dr.openT) * 0.18;
      if (Math.abs(dr.openTarget - dr.openT) < 0.001) dr.openT = dr.openTarget;
      dr.pivot.position.z = dr.info.travel * MM * dr.openT;
    }
    for (var k = 0; k < sliding.length; k++) {
      var sl2 = sliding[k];
      sl2.openT += (sl2.openTarget - sl2.openT) * 0.18;
      if (Math.abs(sl2.openTarget - sl2.openT) < 0.001) sl2.openT = sl2.openTarget;
      sl2.pivot.position.x = sl2.info.pivot[0] * MM + (sl2.info.direction || 1) * sl2.info.travel * MM * sl2.openT;
    }
  }

  function fit() {
    var box3 = new THREE.Box3();
    if (itemsRoot) box3.setFromObject(itemsRoot);
    if (box3.isEmpty()) return;
    var c = box3.getCenter(new THREE.Vector3());
    var s = box3.getSize(new THREE.Vector3());
    orbit.target.copy(c);
    orbit.r = Math.max(s.x, s.y, s.z) * 1.9 + 0.8;
  }

  function buildRoom() {
    var room = normalizeRoom(PROJECT.room);
    currentRoom = room;
    if (roomRoot) {
      roomRoot.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      scene.remove(roomRoot);
      roomRoot = null;
    }
    roomBuilt = false;
    if (!room || !room.enabled) return;
    roomBuilt = true;
    var wallHex = '#F2F0EB', floorHex = '#CFAE82', floorDark = '#9C7B52';
    // Текстуры стен/пола — по простым цветам из room.js, без картинок.
    // WALL_TEXTURES/FLOOR_TEXTURES доступны глобально из бандла room.js.
    try {
      var wt = textureById(WALL_TEXTURES, room.wallTexture);
      wallHex = wt.hex;
      var ft = textureById(FLOOR_TEXTURES, room.floorTexture);
      floorHex = ft.hex; floorDark = ft.dark || ft.hex;
    } catch (e) {}
    var wallMat = new THREE.MeshStandardMaterial({
      color: wallHex, roughness: 0.9, map: woodTexture(wallHex, wallHex, seedOf('wall')), envMapIntensity: 0.25
    });
    var floorMat = new THREE.MeshStandardMaterial({
      color: floorHex, roughness: 0.55, envMapIntensity: 0.5,
      map: plankTexture(floorHex, floorDark)
    });
    floorMat.map.repeat.set(Math.max(1, room.width / 1200), Math.max(1, room.depth / 1200));
    roomRoot = new THREE.Group();
    var spec = buildRoomSpec(room);
    for (var i = 0; i < spec.length; i++) {
      var part = spec[i], mesh;
      if (part.kind === 'floor') {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size[0] * MM, part.size[1] * MM), floorMat);
        mesh.rotation.x = part.rot;
      } else if (part.kind === 'wall') {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size[0] * MM, part.size[1] * MM), wallMat);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0;
      } else if (part.kind === 'windowFrame') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(part.size[0] * MM, part.size[1] * MM, part.size[2] * MM), materials.frame);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0;
      } else if (part.kind === 'windowGlass') {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size[0] * MM, part.size[1] * MM), materials.glass);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0;
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(part.size[0] * MM, part.size[1] * MM, part.size[2] * MM), materials.skirting);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0;
      }
      mesh.receiveShadow = true;
      roomRoot.add(mesh);
    }
    roomRoot.visible = roomOn;
    scene.add(roomRoot);
  }

  // Ленивая комната: строится один раз при первом включении (по кнопке),
  // дальше просто переключается roomRoot.visible — без перестройки.
  // Земля прячется, когда комната включена (как в редакторе): иначе пол
  // комнаты и земля лежат в одной плоскости y=0 — рябь z-fighting.
  function ensureRoom() {
    if (!roomBuilt) buildRoom();
    if (roomRoot) roomRoot.visible = roomOn;
    if (groundPlane) groundPlane.visible = !roomOn;
  }

  function applyDayNight() {
    var night = dayNight === 'night';
    scene.background = new THREE.Color(night ? 0x0a0c12 : 0xf2f1ed);
    scene.traverse(function (o) { if (o.light && o.light.intensity !== undefined) o.light.intensity = night ? 0.25 : 1.1; });
  }

  function setDayNight(mode) {
    dayNight = mode;
    var night = mode === 'night';
    sun.intensity = night ? 0.25 : 1.6;
    sun.color.set(night ? 0x8fb4ff : 0xfff4e0);
    hemi.intensity = night ? 0.25 : 1.1;
    applyDayNight();
    document.getElementById('btn-day').textContent = night ? 'День' : 'Ночь';
    document.body.classList.toggle('night', night);
  }

  var sun, hemi;
  var labelsReady = false;

  function start() {
    // На телефонах раньше было antialias:false + DPR 1.5 — мебель
    // выглядела пиксельной. Современные телефоны тянут AA и DPR 2.
    var isSmall = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f1ed);
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
    orbit = { theta: 0.7, phi: 1.15, r: 4, target: new THREE.Vector3(0, 0.8, 0) };

    hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(3, 6, 4);
    sun.castShadow = true;
    var shadowSize = isSmall ? 1024 : 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    scene.add(sun);

    // Процедурное окружение для PBR-отражений.
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      var env = new THREE.Scene();
      env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x8a8a8a })));
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      panel.position.y = 4.9; panel.rotation.x = Math.PI / 2;
      env.add(panel);
      scene.environment = pmrem.fromScene(env, 0.04).texture;
      pmrem.dispose();
    } catch (e) {}

    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundPlane = ground;

    makeMaterials();

    builtList = [];
    for (var i = 0; i < PROJECT.items.length; i++) {
      try {
        builtList.push({ item: PROJECT.items[i], built: buildItemByType(PROJECT.items[i].type, PROJECT.items[i]) });
      } catch (e) {}
    }
    rebuild();
    // Ленивая комната: не строится при старте, только при первом
    // включении кнопкой «Комната» (или сразу, если в проекте она вкл).
    // SETTINGS.showRoom=false — по умолчанию комнате выключена.
    roomOn = SETTINGS.showRoom !== false && !!(PROJECT.room && PROJECT.room.enabled);
    if (roomOn) ensureRoom();
    if (roomRoot) roomRoot.visible = roomOn;
    updateRoomBtn();

    // Размерные метки на все предметы (показывает кнопка «Размеры»).
    labels = [];
    for (var li = 0; li < builtList.length * 3; li++) {
      var div = document.createElement('div');
      div.className = 'dim-label';
      container.appendChild(div);
      labels.push(div);
    }
    labelsReady = true;

    // Орбита + клик по двери + щипок масштабом (телефон).
    var el = renderer.domElement;
    var drag = { x: 0, y: 0, moved: 0, down: false };
    var ptrs = {}; var pinchDist = 0;
    el.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(ptrs).length === 2) {
        var ids = Object.keys(ptrs);
        var dx = ptrs[ids[0]].x - ptrs[ids[1]].x, dy = ptrs[ids[0]].y - ptrs[ids[1]].y;
        pinchDist = Math.hypot(dx, dy);
      }
      drag.down = true; drag.x = e.clientX; drag.y = e.clientY; drag.moved = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in ptrs)) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      // Щипок двумя пальцами — зум вместо орбиты.
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var dx2 = ptrs[ids[0]].x - ptrs[ids[1]].x, dy2 = ptrs[ids[0]].y - ptrs[ids[1]].y;
        var d = Math.hypot(dx2, dy2);
        if (pinchDist > 0) orbit.r = Math.min(30, Math.max(0.8, orbit.r * pinchDist / d));
        pinchDist = d;
        drag.moved += 5;
        return;
      }
      if (!drag.down) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      orbit.theta -= dx * 0.008;
      orbit.phi = Math.min(1.5, Math.max(0.15, orbit.phi - dy * 0.008));
      drag.x = e.clientX; drag.y = e.clientY;
    });
    function ptrUp(e) { delete ptrs[e.pointerId]; pinchDist = 0; }
    el.addEventListener('pointerup', function (e) {
      ptrUp(e);
      if (drag.down && drag.moved < 5) {
        var r = el.getBoundingClientRect();
        var ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1
        ), camera);
        var hits = ray.intersectObjects(itemsRoot ? itemsRoot.children : [], true)
          .filter(function (h) { return h.object.isMesh; });
        if (hits.length) {
          var o = hits[0].object, pivot = null;
          while (o) { if (o.userData.isPivot) { pivot = o; break; } o = o.parent; }
          if (pivot) {
            for (var k = 0; k < doors.length; k++) if (doors[k].pivot === pivot) doors[k].openTarget = doors[k].openTarget ? 0 : 1;
            for (var m = 0; m < drawers.length; m++) if (drawers[m].pivot === pivot) drawers[m].openTarget = drawers[m].openTarget ? 0 : 1;
            for (var s2 = 0; s2 < sliding.length; s2++) if (sliding[s2].pivot === pivot) sliding[s2].openTarget = sliding[s2].openTarget ? 0 : 1;
          }
        }
      }
      drag.down = false;
    });
    el.addEventListener('pointercancel', ptrUp);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      orbit.r = Math.min(30, Math.max(0.8, orbit.r * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: false });

    var canvasRect = { w: 1, h: 1 };
    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      canvasRect = { w: w, h: h };
    }
    new ResizeObserver(resize).observe(container);
    resize();

    // Метки: позиция сглаживается (lerp), текст пишется один раз,
    // rect канваса кэшируется — раньше getBoundingClientRect каждый
    // кадр на каждую метку давал layout-thrash и дёрганье при вращении.
    var labelState = labels.map(function () { return { x: 0, y: 0, init: false, text: '' }; });
    function placeLabel(i, world, text) {
      var el2 = labels[i], st = labelState[i];
      var t = world.clone().project(camera);
      var tx = (t.x * 0.5 + 0.5) * canvasRect.w;
      var ty = (-t.y * 0.5 + 0.5) * canvasRect.h;
      if (!st.init) { st.x = tx; st.y = ty; st.init = true; }
      st.x += (tx - st.x) * 0.4;
      st.y += (ty - st.y) * 0.4;
      el2.style.transform = 'translate(-50%,-50%) translate(' + st.x + 'px,' + st.y + 'px)';
      el2.style.opacity = t.z < 1 ? 1 : 0;
      if (st.text !== text) { el2.textContent = text; st.text = text; }
    }
    function v(x, y, z) { return new THREE.Vector3(x * MM, y * MM, z * MM); }
    function updateDims() {
      var idx = 0;
      for (var i = 0; i < builtList.length; i++) {
        var item = builtList[i].item, d = builtList[i].built.dims, off = 90;
        var rot = item.rotationY || 0, cs = Math.cos(rot), sn = Math.sin(rot);
        var wx = function (x, z) { return item.position.x + x * cs + z * sn; };
        var wz = function (x, z) { return item.position.z - x * sn + z * cs; };
        var zf = d.d / 2 + off;
        placeLabel(idx++, v(wx(d.w / 2, zf), d.lift + d.h + 60, wz(d.w / 2, zf)), d.w + ' мм');
        placeLabel(idx++, v(wx(-off, 0), d.lift + d.h / 2, wz(-off, 0)), d.h + ' мм');
        placeLabel(idx++, v(wx(d.w + off, 0), d.lift + 40, wz(d.w + off, 0)), d.d + ' мм');
      }
    }

    (function frame() {
      applyOpen();
      camera.position.set(
        orbit.target.x + orbit.r * Math.sin(orbit.phi) * Math.sin(orbit.theta),
        orbit.target.y + orbit.r * Math.cos(orbit.phi),
        orbit.target.z + orbit.r * Math.sin(orbit.phi) * Math.cos(orbit.theta)
      );
      camera.lookAt(orbit.target);
      if (showDims && labelsReady) updateDims();
      else if (labelsReady) for (var i = 0; i < labels.length; i++) labels[i].style.opacity = 0;
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    })();

    fit();

    // Кнопки.
    document.getElementById('btn-open').onclick = function (e) {
      var opening = e.target.dataset.open !== '1';
      e.target.dataset.open = opening ? '1' : '';
      e.target.textContent = opening ? 'Закрыть двери' : 'Открыть двери';
      for (var i = 0; i < doors.length; i++) doors[i].openTarget = opening ? 1 : 0;
      for (var j = 0; j < drawers.length; j++) drawers[j].openTarget = opening ? 1 : 0;
      for (var k2 = 0; k2 < sliding.length; k2++) sliding[k2].openTarget = opening ? 1 : 0;
    };
    document.getElementById('btn-fit').onclick = fit;
    document.getElementById('btn-day').onclick = function () {
      setDayNight(dayNight === 'night' ? 'day' : 'night');
    };
    document.getElementById('btn-room').onclick = function () {
      roomOn = !roomOn;
      ensureRoom(); // ленивая сборка комнаты при первом включении
      updateRoomBtn();
    };
    document.getElementById('btn-dims').onclick = function (e) {
      showDims = !showDims;
      e.target.dataset.on = showDims ? '1' : '';
      e.target.textContent = showDims ? 'Скрыть размеры' : 'Показать размеры';
    };

    // Переключатель цветов, если разрешён оператором.
    var colorWrap = document.getElementById('colors');
    if (SETTINGS.allowColorSwitch && SETTINGS.allowedColors && SETTINGS.allowedColors.length) {
      colorWrap.classList.remove('hidden');
      for (var ci = 0; ci < SETTINGS.allowedColors.length; ci++) {
        (function (cid) {
          var col = colorById(cid);
          var sw = document.createElement('div');
          sw.className = 'swatch';
          sw.style.background = col.hex;
          sw.title = col.name;
          sw.onclick = function () {
            var kids = colorWrap.querySelectorAll('.swatch');
            for (var k = 0; k < kids.length; k++) kids[k].classList.remove('sel');
            sw.classList.add('sel');
            for (var i = 0; i < PROJECT.items.length; i++) PROJECT.items[i].facade = cid;
            builtList = PROJECT.items.map(function (it) {
              try { return { item: it, built: buildItemByType(it.type, it) }; } catch (e) { return null; }
            }).filter(Boolean);
            rebuild();
          };
          colorWrap.appendChild(sw);
        })(SETTINGS.allowedColors[ci]);
      }
    }

    // Деталировка, если разрешена.
    if (SETTINGS.showCutlist) {
      var rows = {};
      var total = 0;
      for (var i2 = 0; i2 < builtList.length; i2++) {
        var sum = summarizeCut(builtList[i2].built.parts);
        for (var r = 0; r < sum.rows.length; r++) {
          var row = sum.rows[r];
          var key = row.name + '|' + row.a + '|' + row.b;
          if (rows[key]) rows[key].q += row.q; else rows[key] = { name: row.name, a: row.a, b: row.b, q: row.q };
        }
      }
      var html = '<table><thead><tr><th>Деталь</th><th>Размер, мм</th><th>Кол-во</th></tr></thead><tbody>';
      var list = Object.keys(rows).map(function (k) { return rows[k]; });
      list.sort(function (a, b) { return b.a * b.b * b.q - a.a * a.b * a.q; });
      for (var li2 = 0; li2 < list.length; li2++) {
        html += '<tr><td>' + list[li2].name + '</td><td>' + list[li2].a + '×' + list[li2].b + '</td><td>' + list[li2].q + '</td></tr>';
      }
      html += '</tbody></table>';
      cutEl.innerHTML = html;
      document.getElementById('cut-panel').classList.remove('hidden');
    }

    // Цена, если показана оператором и заполнена.
    if (SETTINGS.showPrice && PROJECT.price && PROJECT.price.total != null) {
      var cur = PROJECT.price.currency || 'KZT';
      priceEl.textContent = 'Итого: ' + PROJECT.price.total + ' ' + cur;
      priceEl.classList.remove('hidden');
    }

    setDayNight('day');
  }

  function updateRoomBtn() {
    var b = document.getElementById('btn-room');
    if (b) b.textContent = roomOn ? 'Комната: вкл' : 'Комната: выкл';
  }

  if (unlocked) start();
})();
