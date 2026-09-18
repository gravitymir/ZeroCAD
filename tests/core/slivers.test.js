// Иглы после булевой: collapseShortEdges (web/app.js) схлопывает микрорёбра,
// из-за которых на грани появлялись лишние линии. Сетка остаётся замкнутой,
// объём не меняется
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['collapseShortEdges', 'flipNeedles']);
const {V, box, flat, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const stats = arr => {
  let needles = 0;
  for(let o=0;o<arr.length;o+=9){
    const P = [0,1,2].map(j => V(arr[o+j*3], arr[o+j*3+1], arr[o+j*3+2]));
    if(Math.min(...[0,1,2].map(j => P[j].distanceTo(P[(j+1)%3]))) < 0.05) needles++;
  }
  const e = edgeStats(arr, true);
  return {tris: arr.length/9, needles, open: e.open, nonManifold: e.nonManifold, vol: volume(arr)};
};

test('a needle split of a face collapses away', () => {
  // куб 40 с лишней точкой N в 0.02 мм от угла A на ребре крыши: и крыша, и
  // боковая грань разбиты через неё — так оставляет булева (иглы, замкнуто)
  const tris = box(0,0,0,40,40,40).filter(t => !t.every(p => p.z === 40) && !t.every(p => p.y === 0));
  const A = V(0,0,40), B = V(40,0,40), C = V(40,40,40), D = V(0,40,40), N = V(0.02,0,40);
  const A0 = V(0,0,0), B0 = V(40,0,0);
  tris.push([A, N, D], [N, B, D], [B, C, D]);            // крыша через N
  tris.push([A, A0, N], [N, A0, B0], [N, B0, B]);        // боковая грань через N
  const before = flat(tris);
  const s0 = stats(before);
  assert.equal(s0.open, 0); assert.ok(s0.needles >= 1, 'needles present');
  const after = core.collapseShortEdges(before, 0.05);
  const s1 = stats(after);
  assert.equal(s1.needles, 0, 'needles gone');
  assert.equal(s1.open, 0, 'still closed');
  assert.equal(s1.nonManifold, 0, 'still manifold');
  near(s1.vol, s0.vol, 1e-6, 'volume kept');
  assert.ok(s1.tris < s0.tris, 'triangles dropped');
});

test('a clean mesh is left alone', () => {
  const clean = flat(box(0,0,0,10,10,10));
  const out = core.collapseShortEdges(clean, 0.05);
  assert.equal(out.length, clean.length, 'nothing to collapse');
});

test('a real feature smaller than the limit is kept when collapsing would tear the mesh', () => {
  // тонкая пластина 40×40×0.03: схлопывание боковых рёбер (0.03 мм) порвало бы
  // тело — проверка связности (link condition) этого не допускает
  const thin = flat(box(0,0,0,40,40,0.03));
  const out = core.collapseShortEdges(thin, 0.05);
  const s = stats(out);
  assert.equal(s.open, 0, 'still closed');
  near(s.vol, 40*40*0.03, 1e-4, 'volume kept');
});

test('a long needle with no short side is flipped away', () => {
  // куб 40: на крыше вершина N в 0.005 мм от ребра AB (Т-стык от булевой) —
  // щепка A B N длиной 40 и высотой 0.005, коротких сторон нет, collapse её не
  // берёт; за AB — боковая грань y = 0
  const tris = box(0,0,0,40,40,40).filter(t => !t.every(p => p.z === 40) && !t.every(p => p.y === 0));
  const A = V(0,0,40), B = V(40,0,40), C = V(40,40,40), D = V(0,40,40), N = V(20,0.005,40);
  const A0 = V(0,0,0), B0 = V(40,0,0);
  tris.push([A, B, N], [A, N, D], [N, B, C], [N, C, D]);  // крыша со щепкой
  tris.push([A, A0, B0], [A, B0, B]);                     // боковая грань
  const before = flat(tris);
  const s0 = stats(before);
  assert.equal(s0.open, 0); assert.equal(s0.nonManifold, 0);
  const after = core.flipNeedles(before, 0.01);
  const s1 = stats(after);
  let minH = Infinity;
  for(let o=0;o<after.length;o+=9){
    const P = [0,1,2].map(j => V(after[o+j*3], after[o+j*3+1], after[o+j*3+2]));
    const L = Math.max(...[0,1,2].map(j => P[j].distanceTo(P[(j+1)%3])));
    minH = Math.min(minH, P[1].clone().sub(P[0]).cross(P[2].clone().sub(P[0])).length() / L);
  }
  assert.ok(minH >= 0.01, 'no triangle thinner than 0.01 mm: ' + minH);
  assert.equal(s1.open, 0, 'still closed');
  assert.equal(s1.nonManifold, 0, 'still manifold');
  assert.equal(s1.tris, s0.tris, 'a flip keeps the triangle count');
  // вершины не двигаются, сосед за AB сгибается на высоту щепки: ΔV ≤ S·h/3
  near(s1.vol, s0.vol, 800 * 0.005 / 3 + 1e-6, 'volume within area × needle height');
  assert.equal(new Set(Array.from(after)).size, new Set(Array.from(before)).size, 'no new coordinates');
});

test('a clean mesh is not flipped', () => {
  const clean = flat(box(0,0,0,10,10,10));
  assert.equal(core.flipNeedles(clean, 0.01), clean, 'same array back');
});
