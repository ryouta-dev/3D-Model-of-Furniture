// Генераторы мебели. Общий интерфейс: build(params) → { parts, anim, dims } — как в ТЗ п. 6.
import { buildItem, withDefaults } from './corpus.js';
import { buildCorner } from './corner.js';
import { buildSliding } from './sliding.js';
import { buildBed as bedBuild } from './bed.js';
import { buildTable as tableBuild } from './table.js';

function make(type) {
  return function build(params = {}) {
    return buildItem(withDefaults({ ...params, type }));
  };
}

export const buildWardrobe = make('wardrobe');
export const buildChest = make('chest');
export const buildKitchenBase = make('kitchen_base');
export const buildKitchenWall = make('kitchen_wall');
export const buildSlidingWardrobe = buildSliding;
export const buildKitchenCorner = buildCorner;
export const buildBed = bedBuild;
export const buildTable = tableBuild;

export const GENERATORS = {
  wardrobe: buildWardrobe,
  chest: buildChest,
  kitchen_base: buildKitchenBase,
  kitchen_wall: buildKitchenWall,
  sliding_wardrobe: buildSliding,
  kitchen_corner: buildCorner,
  bed: bedBuild,
  table: tableBuild
};

export function buildItemByType(type, params) {
  const gen = GENERATORS[type];
  if (!gen) throw new Error('Неизвестный тип мебели: ' + type);
  return gen(params);
}
