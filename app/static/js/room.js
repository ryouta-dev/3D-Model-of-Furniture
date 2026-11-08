// Комната: параметры и спецификация геометрии. Чистая логика без three.js,
// чтобы её можно было тестировать в node. Меши из спецификации строит scene.js.
//
// Система координат: пол — плоскость 3600×3200 (мм) с центром в (0,0),
// y — вверх, фасад мебели смотрит в +z. Комната — «кукольный домик»:
// пол + три стены (задняя, левая, правая), без передней стены и потолка,
// чтобы камера снаружи видела интерьер.

export const DEFAULT_ROOM = {
  enabled: true,
  width: 3600,
  depth: 3200,
  height: 2700,
  wallTexture: 'paint_white',
  floorTexture: 'laminate_oak',
  windows: [{ wall: 'back', x: 800, width: 1200, height: 1300, sill: 900 }],
  panorama: null
};

export const WALL_TEXTURES = [
  { id: 'paint_white', name: 'Стены: белый', hex: '#F2F0EB' },
  { id: 'paint_beige', name: 'Стены: бежевый', hex: '#E8DCC8' },
  { id: 'paint_grey', name: 'Стены: серый', hex: '#C9CBC9' },
  { id: 'paint_green', name: 'Стены: тёмно-зелёный', hex: '#2F4B40' }
];

export const FLOOR_TEXTURES = [
  { id: 'laminate_oak', name: 'Пол: дуб сонома', hex: '#CFAE82', dark: '#9C7B52' },
  { id: 'laminate_walnut', name: 'Пол: орех', hex: '#7B5233', dark: '#4F321E' },
  { id: 'laminate_grey', name: 'Пол: серый ламинат', hex: '#A7ACAE', dark: '#7A7F82' },
  { id: 'laminate_light', name: 'Пол: светлый дуб', hex: '#E2CFA8', dark: '#B89A6B' }
];

export const ROOM_RANGES = { width: [1000, 20000], depth: [1000, 20000], height: [2000, 5000] };

export function textureById(list, id) {
  return list.find((t) => t.id === id) || list[0];
}

export function normalizeRoom(room) {
  if (room == null) return null;
  if (typeof room !== 'object') return null;
  return {
    enabled: room.enabled !== false,
    width: room.width ?? DEFAULT_ROOM.width,
    depth: room.depth ?? DEFAULT_ROOM.depth,
    height: room.height ?? DEFAULT_ROOM.height,
    wallTexture: room.wallTexture || DEFAULT_ROOM.wallTexture,
    floorTexture: room.floorTexture || DEFAULT_ROOM.floorTexture,
    windows: Array.isArray(room.windows) ? room.windows : [],
    panorama: room.panorama ?? null
  };
}

export function defaultRoom() {
  return JSON.parse(JSON.stringify(DEFAULT_ROOM));
}

// Спецификация: список деталей в мм, как у генераторов мебели.
// kind: 'floor' | 'wall' | 'windowFrame' | 'windowGlass' | 'skirting'
export function buildRoomSpec(room) {
  const r = normalizeRoom(room);
  if (!r || !r.enabled) return [];
  const W = r.width, D = r.depth, H = r.height;
  const parts = [];

  parts.push({ name: 'Пол комнаты', kind: 'floor', size: [W, D], pos: [0, 0], rot: -Math.PI / 2 });
  // Стены: задняя (z = -D/2), левая (x = -W/2), правая (x = +W/2)
  parts.push({ name: 'Стена задняя', kind: 'wall', size: [W, H], pos: [0, H / 2, -D / 2], rotY: 0 });
  parts.push({ name: 'Стена левая', kind: 'wall', size: [D, H], pos: [-W / 2, H / 2, 0], rotY: Math.PI / 2 });
  parts.push({ name: 'Стена правая', kind: 'wall', size: [D, H], pos: [W / 2, H / 2, 0], rotY: -Math.PI / 2 });

  // Окна: рамка + стекло + подоконник. Поле wall: back (по умолчанию) / left / right.
  // x отсчитывается от края стены: на задней — от левого, на боковых — от задней стены
  // (z = -D/2) в сторону передней. Стена у комнаты «кукольный домик»: передней стены нет,
  // поэтому wall=front и неизвестные значения падают в back (обратная совместимость).
  for (const win of r.windows || []) {
    const ww = win.width || 1200;
    const wh = win.height || 1300;
    const wy = (win.sill || 0) + wh / 2;
    const wall = win.wall === 'left' ? 'left' : win.wall === 'right' ? 'right' : 'back';
    let rotY, framePos, glassPos, sillPos;
    if (wall === 'left') {
      // Левая стена на x = -W/2, плоскость повёрнута как стена: rotY = PI/2.
      // Центр по z: от задней стены, как у back-окна от левого края.
      rotY = Math.PI / 2;
      const wz = -D / 2 + (win.x || 0) + ww / 2;
      framePos = [-W / 2 + 20, wy, wz];
      glassPos = [-W / 2 + 45, wy, wz];
      sillPos = [-W / 2 + 40, (win.sill || 0) - 15, wz];
    } else if (wall === 'right') {
      rotY = -Math.PI / 2;
      const wz = -D / 2 + (win.x || 0) + ww / 2;
      framePos = [W / 2 - 20, wy, wz];
      glassPos = [W / 2 - 45, wy, wz];
      sillPos = [W / 2 - 40, (win.sill || 0) - 15, wz];
    } else {
      rotY = 0;
      const wx = -W / 2 + (win.x || 0) + ww / 2;
      framePos = [wx, wy, -D / 2 + 20];
      glassPos = [wx, wy, -D / 2 + 45];
      sillPos = [wx, (win.sill || 0) - 15, -D / 2 + 40];
    }
    parts.push({
      name: 'Рама окна', kind: 'windowFrame',
      size: [ww, wh, 40],
      pos: framePos,
      rotY
    });
    parts.push({
      name: 'Стекло окна', kind: 'windowGlass',
      size: [ww - 80, wh - 80],
      pos: glassPos,
      rotY
    });
    parts.push({
      name: 'Подоконник', kind: 'skirting',
      size: [ww + 60, 30, 80],
      pos: sillPos,
      rotY
    });
  }

  // Плинтус вдоль трёх стен
  parts.push({ name: 'Плинтус', kind: 'skirting', size: [W, 80, 15], pos: [0, 40, -D / 2 + 8] });
  parts.push({ name: 'Плинтус', kind: 'skirting', size: [D, 80, 15], pos: [-W / 2 + 8, 40, 0], rotY: Math.PI / 2 });
  parts.push({ name: 'Плинтус', kind: 'skirting', size: [D, 80, 15], pos: [W / 2 - 8, 40, 0], rotY: -Math.PI / 2 });

  return parts;
}
