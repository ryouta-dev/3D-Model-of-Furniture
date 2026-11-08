// 3D-сцена редактора. three.js лежит локально (vendor/three), без CDN.
// Сцена не знает формул конструкции: она строит меши из деталей,
// которые вернули генераторы (generators/*). Формулы — только там.

import * as THREE from '../vendor/three/three.module.js';
import { MM, COLORS, colorById } from './generators/common.js';
import { buildItemByType } from './generators/index.js';
import { buildRoomSpec, normalizeRoom, textureById, WALL_TEXTURES, FLOOR_TEXTURES } from './room.js';

const BG = { dark: 0x101214, light: 0xf2f1ed };

// Фасад-слой: main.js обращается к сцене через initScene/fitView/setOpen/
// setTheme/getTheme. Сцена создаётся лениво, при первом initScene();
// тема и открытие, заданные до создания, запоминаются и применяются позже.
let sceneInstance = null;
let pendingTheme = 'dark';
let pendingOpen = false;
let pendingRoom = null;
let pendingDayNight = 'day';
let pendingPresent = false;

export function createScene(container, { onSelect, onMove, onPresent } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  const orbit = { theta: 0.7, phi: 1.15, r: 4, target: new THREE.Vector3(0, 0.8, 0) };

  const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Процедурное окружение (без HDRI-файлов): светлая панель сверху и 
  // тёмные стены — даёт мягкие отражения на фасадах и ручках (PBR).
  function makeEnvTexture() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 10),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x8a8a8a })
    );
    env.add(box);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    panel.position.y = 4.9;
    panel.rotation.x = Math.PI / 2;
    env.add(panel);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
  }
  const envTexture = makeEnvTexture();
  scene.environment = envTexture;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Материалы (цвета декоров из библиотеки) ---
  // Детерминированная текстура дерева: зерно зависит от id цвета,
  // чтобы материал не «прыгал» при переключении темы.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return h;
  }
  function woodTexture(hex, dark, seed) {
    const rnd = mulberry32(seed);
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = dark;
    for (let i = 0; i < 40; i++) {
      g.globalAlpha = 0.12 + rnd() * 0.18;
      g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath();
      const y = rnd() * 256;
      g.moveTo(0, y);
      g.bezierCurveTo(80, y + 6, 170, y - 6, 256, y);
      g.stroke();
    }
    g.globalAlpha = 0.06;
    for (let i = 0; i < 300; i++) {
      g.fillStyle = rnd() > 0.5 ? dark : hex;
      g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function floorTexture(hex, dark) {
    const rnd = mulberry32(seedOf('floor') + 7);
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, 512, 512);
    // Доски ламината: 6 рядов, швы и сдвиг стыков
    for (let r = 0; r < 6; r++) {
      const y = r * 512 / 6;
      g.fillStyle = dark; g.globalAlpha = 0.5;
      g.fillRect(0, y, 512, 2);
      g.globalAlpha = 0.35;
      const seamX = ((r * 171 + 80) % 512);
      g.fillRect(seamX, y, 2, 512 / 6);
      g.globalAlpha = 1;
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = dark;
        g.globalAlpha = 0.10 + rnd() * 0.12;
        g.lineWidth = 0.6 + rnd() * 1.2;
        g.beginPath();
        const yy = y + rnd() * (512 / 6);
        g.moveTo(0, yy);
        g.bezierCurveTo(150, yy + 3, 350, yy - 3, 512, yy);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function wallTexture(hex) {
    const rnd = mulberry32(seedOf('wall'));
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = hex; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1200; i++) {
      g.globalAlpha = 0.04 + rnd() * 0.05;
      g.fillStyle = rnd() > 0.5 ? '#000000' : '#ffffff';
      g.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
    }
    g.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  const materials = {};
  function setMaterials(theme) {
    for (const m of Object.values(materials)) {
      if (!m) continue;
      m.map?.dispose();
      m.dispose();
    }
    for (const key of Object.keys(materials)) delete materials[key];
    for (const col of COLORS_ALL) {
      const map = col.wood ? woodTexture(col.hex, col.dark, seedOf(col.id)) : null;
      // Корпус матовый, фасад глянцевее — отдельные материалы на один цвет.
      materials['corpus_' + col.id] = new THREE.MeshStandardMaterial({
        color: col.hex, roughness: 0.8, metalness: 0, map: map ? map.clone() : null, envMapIntensity: 0.5
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
    applyDayNight(dayNight, false);
    rebuild();
  }
  const COLORS_ALL = COLORS;

  function box(size, mat, edge) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    m.castShadow = m.receiveShadow = true;
    if (edge) {
      const e = new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })
      );
      e.raycast = () => {}; // рёбра не должны ловить клики — иначе «пустые» клики рядом с мебелью двигают её
      m.add(e);
    }
    return m;
  }

  // --- Сборка предметов из деталей генератора ---
  let itemsRoot = null, doors = [], drawers = [], sliding = [], selHelper = null;
  let buildFns = []; // [{ item, built }]
  let pivotEntries = new Map(); // pivot Group -> запись двери/ящика для клика
  let itemRoots = new Map(); // itemId -> Group (для перетаскивания без пересборки)

  function buildMeshesFor(item, built) {
    const root = new THREE.Group();
    root.position.set(item.position.x * MM, 0, item.position.z * MM);
    root.rotation.y = item.rotationY || 0;
    root.userData.itemId = item.id;
    const groups = new Map();
    for (const part of built.parts) {
      let parent = root;
      if (part.group) {
        const info = built.anim.doors.find((d) => d.id === part.group)
          || built.anim.drawers.find((d) => d.id === part.group)
          || (built.anim.sliding || []).find((d) => d.id === part.group);
        let g = groups.get(part.group);
        if (!g) {
          const pivot = new THREE.Group();
          pivot.position.set(info.pivot[0] * MM, info.pivot[1] * MM, info.pivot[2] * MM);
          pivot.userData.isPivot = true;
          root.add(pivot);
          g = { pivot, info, openT: 0, openTarget: 0 };
          pivotEntries.set(pivot, g);
          groups.set(part.group, g);
        }
        parent = g.pivot;
      }
      const mat = part.material === 'corpus' || part.material === 'facade'
        ? materials[part.material + '_' + colorById(item[part.material]).id]
        : materials[part.material];
      const mesh = box(part.size.map((v) => v * MM), mat, part.edge !== false);
      mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
      parent.add(mesh);
    }
    return { root, groups };
  }

  function rebuild(newItems) {
    if (newItems) buildFns = newItems;
    if (itemsRoot) {
      itemsRoot.traverse((o) => o.geometry?.dispose()); // материалы общие, не трогаем
      scene.remove(itemsRoot);
    }
    doors = []; drawers = []; sliding = [];
    pivotEntries.clear();
    itemRoots.clear();
    itemsRoot = new THREE.Group();
    for (const { item, built } of buildFns) {
      const { root, groups } = buildMeshesFor(item, built);
      itemRoots.set(item.id, root);
      for (const [, g] of groups) {
        if (g.info.direction !== undefined) sliding.push(g);
        else if (g.info.travel !== undefined) drawers.push(g);
        else doors.push(g);
      }
      itemsRoot.add(root);
    }
    scene.add(itemsRoot);
    updateSelection();
    applyOpen(); // сохраняем текущее открытие после пересборки
  }

  function updateSelection() {
    if (selHelper) { scene.remove(selHelper); selHelper = null; }
    const sel = selected && buildFns.find((b) => b.item.id === selected);
    if (sel) {
      selHelper = new THREE.BoxHelper(sel.root, 0xd8a24a);
      scene.add(selHelper);
    }
  }
  let selected = null;

  // --- Открытие дверей и ящиков (по отдельности и все сразу) ---
  function applyOpen() {
    for (const d of doors) {
      d.openT += (d.openTarget - d.openT) * 0.18;
      if (Math.abs(d.openTarget - d.openT) < 0.001) d.openT = d.openTarget;
      d.pivot.rotation.y = d.info.sign * d.openT * d.info.angle;
    }
    for (const d of drawers) {
      d.openT += (d.openTarget - d.openT) * 0.18;
      if (Math.abs(d.openTarget - d.openT) < 0.001) d.openT = d.openTarget;
      const axis = d.info.axis || 'z';
      // Сброс по другой оси, чтобы пересборка не оставляла сдвиг.
      d.pivot.position.x = d.info.pivot[0] * MM + (axis === 'x' ? d.info.travel * MM * d.openT : 0);
      d.pivot.position.z = d.info.pivot[2] * MM + (axis !== 'x' ? d.info.travel * MM * d.openT : 0);
    }
    for (const s of sliding) {
      s.openT += (s.openTarget - s.openT) * 0.18;
      if (Math.abs(s.openTarget - s.openT) < 0.001) s.openT = s.openTarget;
      const dir = s.info.direction || 1;
      s.pivot.position.x = s.info.pivot[0] * MM + dir * s.info.travel * MM * s.openT;
    }
  }
  function setOpen(v, instant) {
    for (const d of [...doors, ...drawers, ...sliding]) {
      d.openTarget = v ? 1 : 0;
      if (instant) d.openT = d.openTarget;
    }
    applyOpen();
  }
  function toggleEntry(entry) {
    entry.openTarget = entry.openTarget ? 0 : 1;
  }

  // --- Размерные метки выбранного предмета ---
  const labels = [];
  for (let i = 0; i < 3; i++) {
    const el = document.createElement('div');
    el.className = 'dim-label';
    container.appendChild(el);
    labels.push(el);
  }
  const tmp = new THREE.Vector3();
  // Позиция метки сглаживается, текст пишется разово, rect кэшируется —
  // иначе getBoundingClientRect каждый кадр даёт layout-thrash и дёрганье.
  const labelState = labels.map(() => ({ x: 0, y: 0, init: false, text: '' }));
  let canvasRect = { w: 1, h: 1 };
  function placeLabel(i, world, text) {
    const el = labels[i], st = labelState[i];
    tmp.copy(world).project(camera);
    const tx = (tmp.x * 0.5 + 0.5) * canvasRect.w;
    const ty = (-tmp.y * 0.5 + 0.5) * canvasRect.h;
    if (!st.init) { st.x = tx; st.y = ty; st.init = true; }
    st.x += (tx - st.x) * 0.4;
    st.y += (ty - st.y) * 0.4;
    el.style.transform = `translate(-50%,-50%) translate(${st.x}px,${st.y}px)`;
    el.style.opacity = tmp.z < 1 ? 1 : 0;
    if (st.text !== text) { el.textContent = text; st.text = text; }
  }
  const v = (x, y, z) => new THREE.Vector3(x * MM, y * MM, z * MM);

  function updateDims() {
    const sel = buildFns.find((b) => b.item.id === selected) || buildFns[0];
    if (!sel) { labels.forEach((l) => (l.style.opacity = 0)); return; }
    const { item, built } = sel;
    const d = built.dims, off = 90;
    const rot = item.rotationY || 0, cs = Math.cos(rot), sn = Math.sin(rot);
    const wx = (x, z) => item.position.x + x * cs + z * sn;
    const wz = (x, z) => item.position.z - x * sn + z * cs;
    const zf = d.d / 2 + off;
    placeLabel(0, v(wx(d.w / 2, zf), d.lift + d.h + 60, wz(d.w / 2, zf)), `${d.w} мм`);
    placeLabel(1, v(wx(-off, 0), d.lift + d.h / 2, wz(-off, 0)), `${d.h} мм`);
    placeLabel(2, v(wx(d.w + off, 0), d.lift + 40, wz(d.w + off, 0)), `${d.d} мм`);
  }

  // --- Камера и предметы: орбита, перетаскивание по полу, клик по двери ---
  const el = renderer.domElement;
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();
  let drag = null; // {mode: 'orbit'|'item'|'door', x, y, moved, itemId, entry, grabX, grabZ, startX, startZ}
  const CLICK_PX = 5;

  function pick(clientX, clientY) {
    const r = el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1
    ), camera);
    // Только меши: рёбра (LineSegments) с порогом Raycaster давали ложные попадания рядом с мебелью.
    const hits = raycaster.intersectObjects(itemsRoot ? itemsRoot.children : [], true)
      .filter((h) => h.object.isMesh);
    return hits.length ? hits[0].object : null;
  }
  function findPivot(obj) {
    let o = obj;
    while (o) {
      if (o.userData.isPivot) return o;
      o = o.parent;
    }
    return null;
  }
  function findItemRoot(obj) {
    let o = obj;
    while (o && o !== itemsRoot) {
      if (o.userData.itemId) return o;
      o = o.parent;
    }
    return null;
  }
  function floorPoint(clientX, clientY) {
    const r = el.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1
    ), camera);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(floorPlane, pt) ? pt : null;
  }
  // Габарит предмета с учётом поворота вокруг origin (0..w, -d/2..d/2)
  function footprint(item, dims) {
    const rot = item.rotationY || 0;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const corners = [[0, -dims.d / 2], [dims.w, -dims.d / 2], [dims.w, dims.d / 2], [0, dims.d / 2]];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [lx, lz] of corners) {
      // Поворот точки вокруг origin: x' = lx*cos - lz*sin? THREE rotationY: x' = lx*cos + lz*sin, z' = -lx*sin + lz*cos
      // (как в updateDims). Используем ту же формулу.
      const rx = lx * cs + lz * sn;
      const rz = -lx * sn + lz * cs;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
    }
    return { minX, maxX, minZ, maxZ };
  }
  function clampToRoom(item, dims, posX, posZ) {
    const room = currentRoom;
    if (!room) return { x: posX, z: posZ };
    const fp = footprint(item, dims);
    const minRoomX = -room.width / 2, maxRoomX = room.width / 2;
    const minRoomZ = -room.depth / 2, maxRoomZ = room.depth / 2;
    let x = posX, z = posZ;
    if (fp.maxX - fp.minX <= maxRoomX - minRoomX) {
      x = Math.min(maxRoomX - fp.maxX, Math.max(minRoomX - fp.minX, x));
    }
    if (fp.maxZ - fp.minZ <= maxRoomZ - minRoomZ) {
      z = Math.min(maxRoomZ - fp.maxZ, Math.max(minRoomZ - fp.minZ, z));
    }
    return { x, z };
  }

  el.addEventListener('pointerdown', (e) => {
    if (present) setPresent(false);
    el.setPointerCapture(e.pointerId);
    const hit = pick(e.clientX, e.clientY);
    if (!hit) {
      drag = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: 0 };
      return;
    }
    const pivot = findPivot(hit);
    const root = findItemRoot(hit);
    const pt = floorPoint(e.clientX, e.clientY);
    if (pivot) {
      // Клик по двери: ждём клика; если потянем сильно — это перетаскивание предмета.
      drag = { mode: 'door', x: e.clientX, y: e.clientY, moved: 0, entry: pivotEntries.get(pivot), itemId: root?.userData.itemId };
      if (root && pt) {
        const item = buildFns.find((b) => b.item.id === root.userData.itemId)?.item;
        if (item) drag.grabX = pt.x / MM - item.position.x, drag.grabZ = pt.z / MM - item.position.z;
      }
      return;
    }
    if (root) {
      const id = root.userData.itemId;
      const item = buildFns.find((b) => b.item.id === id)?.item;
      drag = { mode: 'item', x: e.clientX, y: e.clientY, moved: 0, itemId: id };
      if (item && pt) drag.grabX = pt.x / MM - item.position.x, drag.grabZ = pt.z / MM - item.position.z;
      return;
    }
    drag = { mode: 'orbit', x: e.clientX, y: e.clientY, moved: 0 };
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.mode === 'orbit') {
      orbit.theta -= dx * 0.008;
      orbit.phi = Math.min(1.5, Math.max(0.15, orbit.phi - dy * 0.008));
    } else if (drag.mode === 'item' || drag.mode === 'door') {
      if (drag.moved > CLICK_PX && drag.mode === 'door') drag.mode = 'item';
      if (drag.mode === 'item') {
        const pt = floorPoint(e.clientX, e.clientY);
        if (!pt) return;
        const entry = buildFns.find((b) => b.item.id === drag.itemId);
        if (!entry) return;
        let nx = pt.x / MM - (drag.grabX || 0);
        let nz = pt.z / MM - (drag.grabZ || 0);
        const c = clampToRoom(entry.item, entry.built.dims, nx, nz);
        const root = itemRoots.get(drag.itemId);
        if (root) root.position.set(c.x * MM, 0, c.z * MM);
        drag.liveX = c.x; drag.liveZ = c.z;
      }
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });

  el.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const wasDragged = drag.moved > CLICK_PX;
    if (drag.mode === 'door' && !wasDragged && drag.entry) {
      toggleEntry(drag.entry);
    } else if (drag.mode === 'item') {
      if (wasDragged) {
        // Перетаскивание закончилось — отдаём позицию редактору (со снапшотом и сохранением).
        if (drag.liveX !== undefined && onMove) onMove(drag.itemId, drag.liveX, drag.liveZ);
      } else if (drag.itemId && onSelect) {
        onSelect(drag.itemId);
      }
    } else if (drag.mode === 'orbit' && !wasDragged) {
      // Клик по пустому месту — снять выделение.
      if (onSelect) onSelect(null);
    }
    drag = null;
  });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.r = Math.min(30, Math.max(0.8, orbit.r * (e.deltaY > 0 ? 1.1 : 0.9)));
  }, { passive: false });

  function fit() {
    const box3 = new THREE.Box3();
    if (itemsRoot) box3.setFromObject(itemsRoot);
    if (box3.isEmpty()) { orbit.target.set(0, 0.5, 0); orbit.r = 4; return; }
    const c = box3.getCenter(new THREE.Vector3());
    const s = box3.getSize(new THREE.Vector3());
    orbit.target.copy(c);
    orbit.r = Math.max(s.x, s.y, s.z) * 1.9 + 0.8;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    canvasRect = { w, h };
  }
  new ResizeObserver(resize).observe(container);

  let theme = 'dark', gridObj = null;
  let currentRoom = null;
  let roomRoot = null;

  function makeGrid(t) {
    if (gridObj) scene.remove(gridObj);
    gridObj = new THREE.GridHelper(60, 60,
      t === 'dark' ? 0x3a4045 : 0xb5b0a8, t === 'dark' ? 0x2c3136 : 0xc8c3ba);
    gridObj.position.y = 0.001;
    scene.add(gridObj);
  }

  // Комната: строим меши по спецификации buildRoomSpec.
  function setRoom(room) {
    currentRoom = normalizeRoom(room);
    if (roomRoot) {
      roomRoot.traverse((o) => o.geometry?.dispose());
      scene.remove(roomRoot);
      roomRoot = null;
    }
    const on = !!(currentRoom && currentRoom.enabled);
    ground.visible = !on;
    if (gridObj) gridObj.visible = !on;
    if (!on) { fit(); return; }

    const wallTexDef = textureById(WALL_TEXTURES, currentRoom.wallTexture);
    const floorTexDef = textureById(FLOOR_TEXTURES, currentRoom.floorTexture);
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallTexDef.hex, roughness: 0.9, map: wallTexture(wallTexDef.hex), envMapIntensity: 0.25
    });
    wallMat.map.repeat.set(3, 1.5);
    const floorMat = new THREE.MeshStandardMaterial({
      color: floorTexDef.hex, roughness: 0.55, map: floorTexture(floorTexDef.hex, floorTexDef.dark), envMapIntensity: 0.5
    });
    floorMat.map.repeat.set(currentRoom.width / 1200, currentRoom.depth / 1200);

    roomRoot = new THREE.Group();
    for (const part of buildRoomSpec(currentRoom)) {
      let mesh;
      if (part.kind === 'floor') {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size[0] * MM, part.size[1] * MM), floorMat);
        mesh.rotation.x = part.rot;
      } else if (part.kind === 'wall') {
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(part.size[0] * MM, part.size[1] * MM), wallMat);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0;
        // Стены видны изнутри: двусторонний материал уже, но для надёжности
        mesh.material = wallMat;
      } else if (part.kind === 'windowFrame') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(part.size[0] * MM, part.size[1] * MM, part.size[2] * MM), materials.frame);
        mesh.position.set(part.pos[0] * MM, part.pos[1] * MM, part.pos[2] * MM);
        mesh.rotation.y = part.rotY || 0; // окна на боковых стенах: left PI/2, right -PI/2
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
      mesh.castShadow = (part.kind === 'windowFrame');
      roomRoot.add(mesh);
    }
    scene.add(roomRoot);
    fit();
  }

  let dayNight = 'day';
  function applyDayNight(mode, refreshBg = true) {
    dayNight = mode;
    const night = mode === 'night';
    sun.intensity = night ? 0.25 : 1.6;
    sun.color.set(night ? 0x8fb4ff : 0xfff4e0);
    sun.position.set(night ? -3 : 3, night ? 5 : 6, night ? -2 : 4);
    hemi.intensity = night ? 0.25 : 1.1;
    if (refreshBg) {
      scene.background = new THREE.Color(night ? 0x0a0c12 : BG[theme]);
    }
    for (const m of Object.values(materials)) {
      if (m) m.envMapIntensity = night ? 0.2 : (m === materials.handle ? 1.0 : 0.6);
    }
  }

  function setPresent(v) {
    present = !!v;
    if (present) presentTime = 0;
    else if (onPresent) onPresent(false);
  }

  function screenshot(filename) {
    return new Promise((resolve) => {
      const w = container.clientWidth, h = container.clientHeight;
      const scale = 1920 / Math.max(w, h);
      const oldSize = new THREE.Vector2();
      renderer.getSize(oldSize);
      const oldPR = renderer.getPixelRatio();
      const oldAspect = camera.aspect;
      renderer.setPixelRatio(1);
      renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
      camera.aspect = (w * scale) / (h * scale);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      renderer.domElement.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (filename || 'screenshot') + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }
        renderer.setPixelRatio(oldPR);
        renderer.setSize(oldSize.x, oldSize.y, false);
        camera.aspect = oldAspect;
        camera.updateProjectionMatrix();
        resolve(blob);
      }, 'image/png');
    });
  }
  function setTheme(t) {
    theme = t;
    scene.background = new THREE.Color(dayNight === 'night' ? 0x0a0c12 : BG[t]);
    ground.material.color.set(t === 'dark' ? 0x1c2023 : 0xd8d4cc);
    makeGrid(t);
    if (currentRoom && currentRoom.enabled) gridObj.visible = false;
    setMaterials(t);
  }

  let present = false;
  let presentTime = 0;
  let last = performance.now();
  function frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (present) {
      // Автооблёт с остановками: 6 сек вращение, 2 сек пауза на ракурсе.
      presentTime += dt;
      const cycle = presentTime % 8;
      if (cycle < 6) orbit.theta += dt * 0.35;
    }
    applyOpen();
    camera.position.set(
      orbit.target.x + orbit.r * Math.sin(orbit.phi) * Math.sin(orbit.theta),
      orbit.target.y + orbit.r * Math.cos(orbit.phi),
      orbit.target.z + orbit.r * Math.sin(orbit.phi) * Math.cos(orbit.theta)
    );
    camera.lookAt(orbit.target);
    if (selHelper) selHelper.update();
    updateDims();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  return {
    canvas: renderer.domElement,
    setItems: (list) => { buildFns = list; rebuild(); },
    select: (id) => { selected = id; updateSelection(); },
    setOpen, fit, setTheme, resize, setRoom, setDayNight, setPresent, screenshot,
    start() { resize(); setTheme(pendingTheme); setDayNight(pendingDayNight); setRoom(pendingRoom); fit(); frame(); }
  };

  function setDayNight(mode) {
    pendingDayNight = mode;
    applyDayNight(mode);
  }
}

// --- Фасад для main.js ---

function getScene() {
  if (!sceneInstance) {
    const container = document.querySelector('#view');
    sceneInstance = createScene(container, {
      onSelect: (id) => document.dispatchEvent(new CustomEvent('scene:select', { detail: id })),
      onMove: (id, x, z) => document.dispatchEvent(new CustomEvent('scene:move', { detail: { id, x, z } })),
      onPresent: () => document.dispatchEvent(new CustomEvent('scene:present', { detail: false }))
    });
    sceneInstance.start();
    if (pendingOpen) sceneInstance.setOpen(true);
    if (pendingPresent) sceneInstance.setPresent(true);
  }
  return sceneInstance;
}

export function initScene(items, selected, room) {
  // Неизвестные типы мебели пропускаем, а не роняем всю сцену.
  const builtList = [];
  for (const item of items) {
    try {
      builtList.push({ item, built: buildItemByType(item.type, item) });
    } catch {
      // битый/неизвестный тип — пропускаем предмет
    }
  }
  pendingRoom = room ?? null;
  const sc = getScene();
  sc.select(selected);
  sc.setItems(builtList);
  sc.setRoom(room);
}

export function fitView() {
  getScene().fit();
}

export function setOpen(v) {
  pendingOpen = v;
  getScene().setOpen(v);
}

export function setTheme(t) {
  // До создания сцены тему просто запоминаем — применится в start().
  pendingTheme = t;
  if (sceneInstance) sceneInstance.setTheme(t);
}

export function refreshMaterials() {
  // После загрузки своих декоров из библиотеки.
  if (sceneInstance) sceneInstance.setTheme(pendingTheme);
}

export function getTheme() {
  return pendingTheme;
}

export function setDayNight(mode) {
  pendingDayNight = mode;
  if (sceneInstance) sceneInstance.setDayNight(mode);
}

export function getDayNight() {
  return pendingDayNight;
}

export function setPresent(v) {
  pendingPresent = v;
  if (sceneInstance) sceneInstance.setPresent(v);
}

export function takeScreenshot(filename) {
  return getScene().screenshot(filename);
}

// --- Видео (этап 7): доступ к канвасу для записи MediaRecorder. ---
// Саму запись делает video.js (captureStream + MediaRecorder),
// здесь только отдаём canvas; облет переиспользует режим презентации.
export function getCanvas() {
  return getScene().canvas;
}
