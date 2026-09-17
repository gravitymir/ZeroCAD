// Отверстие (G,D): профиль (радиус, глубина) и тело выреза — holeProfileRH и
// holeCutTris (web/app.js), ими же пользуется MCP add_hole. Объёмы по
// формулам усечённого конуса многоугольника, замкнутость, отказы
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['earClip', 'orientSolid', 'loopPlaneNormal', 'revolveLoopTris', 'holeProfileRH', 'holeCutTris']);
const {V, flat, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const ngon = (r, n) => n / 2 * r * r * Math.sin(2 * Math.PI / n);
const frustum = (r1, r2, h, n) => h / 3 * (ngon(r1, n) + Math.sqrt(ngon(r1, n) * ngon(r2, n)) + ngon(r2, n));
const N = 48;
// вырез считаем от грани вниз: часть над гранью (выход 0.1 мм) не в счёт
const cut = o => {
  const tris = core.holeCutTris(V(0, 0, 0), V(0, 0, 1), Object.assign({segments: N}, o));
  const arr = flat(tris), e = edgeStats(arr, true);
  assert.equal(e.open, 0, 'open edges');
  assert.equal(e.nonManifold, 0, 'non-manifold edges');
  return volume(arr);
};

test('simple hole: cylinder plus the 0.1 mm lead above the face', () => {
  near(cut({type: 'simple', d: 6, depth: 10}), ngon(3, N) * 10.1, 1e-4, 'blind hole');
  // конус сверла 118°: высота r / tan 59°
  near(cut({type: 'simple', d: 6, depth: 10, tip: true}),
       ngon(3, N) * 10.1 + frustum(3, 0, 3 / Math.tan(59 * Math.PI / 180), N), 1e-4, 'drill tip');
});

test('counterbore: seat of the head plus the hole under it', () => {
  const v = cut({type: 'counterbore', d: 6.6, head: 11, headDepth: 6, depth: 40});
  near(v, ngon(5.5, N) * 6.1 + ngon(3.3, N) * 34, 1e-4, 'counterbore');
});

test('countersink: the head diameter is reached exactly at the face', () => {
  // 90°: конус от Ø12 на грани до Ø6.6 на глубине (6 − 3.3)
  const dc = 6 - 3.3;
  near(cut({type: 'countersink', d: 6.6, head: 12, angle: 90, depth: 40}),
       ngon(6, N) * 0.1 + frustum(6, 3.3, dc, N) + ngon(3.3, N) * (40 - dc), 1e-4, 'countersink 90');
  // 82° — конус глубже
  const d82 = 2.7 / Math.tan(41 * Math.PI / 180);
  near(cut({type: 'countersink', d: 6.6, head: 12, angle: 82, depth: 40}),
       ngon(6, N) * 0.1 + frustum(6, 3.3, d82, N) + ngon(3.3, N) * (40 - d82), 1e-4, 'countersink 82');
});

test('head narrower than the hole, or a countersink deeper than it, are refused', () => {
  assert.throws(() => cut({type: 'counterbore', d: 6, head: 4, headDepth: 3, depth: 10}), /wider than the hole/);
  assert.throws(() => cut({type: 'counterbore', d: 6, head: 11, headDepth: 12, depth: 10}), /between 0 and the hole depth/);
  assert.throws(() => cut({type: 'countersink', d: 6.6, head: 12, angle: 90, depth: 2}), /deeper than the hole/);
});

test('the profile goes from the axis and back to it', () => {
  const rh = core.holeProfileRH({type: 'countersink', d: 6.6, head: 12, angle: 90, depth: 20}, 0.1);
  assert.equal(rh[0][0], 0); assert.equal(rh[rh.length-1][0], 0);
  // Array.from — массив нашего realm: из vm-контекста приходит чужой Array
  assert.deepEqual(Array.from(rh, x => +x[1].toFixed(3) || 0), [0.1, 0.1, 0, -2.7, -20, -20]);
  assert.deepEqual(Array.from(rh, x => +x[0].toFixed(3) || 0), [0, 6, 6, 3.3, 3.3, 0]);
});
