// Срез тела плоскостью без булевых — planeCut (web/app.js), им пользуется
// MCP-команда cut_plane: объёмы по формулам и замкнутость бит в бит
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['earClip', 'planeCut', 'meshBoolean']);
const {V, box, frustum, flat, toTris, volume, edgeStats} = makeSolids(core.THREE);

const closed = (arr, msg) => {
  const e = edgeStats(arr, true);
  assert.equal(e.open, 0, msg + ': open edges');
  assert.equal(e.nonManifold, 0, msg + ': non-manifold edges');
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test('slanted cut of a cube keeps the side against the normal', () => {
  // плоскость z = 20 − y/2 внутри куба 40: остаётся призма с сечением-трапецией
  const n = V(0, 0.5, 1).normalize();
  const r = core.planeCut(flat(box(0,0,0,40,40,40)), V(0, 0, 20), n);
  assert.ok(r && r.length, 'cut result');
  closed(r, 'slanted cut');
  near(volume(r), 40 * (20*40 - 0.25*40*40), 1e-3, 'volume (Float32)');
});

test('regular tetrahedron from a cube by four cuts (tetrapod start)', () => {
  const C = V(30, 30, 30), d = 9;
  const normals = [V(0,0,1), ...[0, 2*Math.PI/3, 4*Math.PI/3].map(a => V(Math.sqrt(8/9)*Math.cos(a), Math.sqrt(8/9)*Math.sin(a), -1/3))];
  let cur = flat(box(0,0,0,60,60,60));
  for(const n of normals){
    cur = core.planeCut(cur, C.clone().addScaledVector(n, d), n);
    assert.ok(cur && cur.length, 'cut');
    // точка на ребре считается от концов, упорядоченных по ключу, — у двух
    // соседних треугольников она бит в бит одна и та же
    const e = edgeStats(cur, true);
    assert.equal(e.open, 0, 'open edges after a cut');
  }
  near(volume(cur), 8 * Math.sqrt(3) * d**3, 0.01, 'volume 8√3·d³');
});

test('plane that misses the body leaves it as is; plane above removes nothing', () => {
  const cube = flat(box(0,0,0,40,40,40));
  const r = core.planeCut(cube, V(0, 0, 50), V(0, 0, 1));
  near(volume(r), 64000, 1e-9, 'plane above');
  assert.equal(core.planeCut(cube, V(0, 0, -5), V(0, 0, 1)).length, 0, 'plane below removes everything');
});

test('a section with a hole (tube) is not supported and returns null', () => {
  // труба: куб минус сквозной цилиндр; сечение — квадрат с отверстием
  const tube = core.meshBoolean(box(0,0,0,40,40,40), frustum([20,20,-10], [20,20,50], 8, 8, 32), 'subtract');
  closed(tube, 'tube');
  assert.equal(core.planeCut(tube, V(0, 0, 20), V(0, 0, 1)), null);
});
