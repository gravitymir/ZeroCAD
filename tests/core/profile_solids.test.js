// Revolve (G,O) и Sweep (G,W): тела из плоского профиля — revolveLoopTris,
// sweepLoopTris (web/app.js), ими же пользуются MCP revolve_profile и
// sweep_profile. Объёмы по формулам, замкнутость, наружная ориентация
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['earClip', 'orientSolid', 'simplifyLoop', 'loopPlaneNormal', 'profileFromLoop',
  'revolveLoopTris', 'sweepLoopTris', 'orientPathToProfile']);
const {V, flat, volume, edgeStats} = makeSolids(core.THREE);

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const check = (tris, exp, tol, msg) => {
  const arr = flat(tris), e = edgeStats(arr, true);
  assert.equal(e.open, 0, msg + ': open edges');
  assert.equal(e.nonManifold, 0, msg + ': non-manifold edges');
  near(volume(arr), exp, tol, msg); // знак «+» — нормали наружу
};
// площадь правильного N-угольника, вписанного в круг: доля от πr²
const polyK = N => N / (2 * Math.PI) * Math.sin(2 * Math.PI / N);

test('revolve a rectangle around Z: washer, sector, other way', () => {
  const rect = [V(30,0,0), V(40,0,0), V(40,0,10), V(30,0,10)];
  const full = Math.PI * (1600 - 900) * 10 * polyK(256);
  check(core.revolveLoopTris(rect, V(0,0,0), V(0,0,1), 360, 256), full, 0.05, 'washer');
  // сектор: хорды по 256 на оборот, торцы плоские
  check(core.revolveLoopTris(rect, V(0,0,0), V(0,0,1), 90, 256), full / 4, 0.05, 'sector 90');
  const back = flat(core.revolveLoopTris(rect, V(0,0,0), V(0,0,1), -90, 256));
  near(volume(back), full / 4, 0.05, 'sector -90');
  // −90° лежит по другую сторону от профиля: y < 0 при оси +Z и профиле на +X
  const ys = []; for(let i=1;i<back.length;i+=3) ys.push(back[i]);
  assert.ok(Math.max(...ys) < 1e-3 && Math.min(...ys) < -39, 'negative angle turns the other way');
});

test('revolve a triangle touching the axis makes a cone with a pole', () => {
  const tri = [V(10,10,20), V(15,10,20), V(10,10,30)];
  check(core.revolveLoopTris(tri, V(10,10,0), V(0,0,1), 360, 64), Math.PI * 25 * 10 / 3 * polyK(64), 1e-3, 'cone');
});

test('revolve rejects a profile across the axis or out of its plane', () => {
  assert.throws(() => core.revolveLoopTris([V(-5,0,0), V(5,0,0), V(5,0,5)], V(0,0,0), V(0,0,1), 360, 32), /one side/);
  assert.throws(() => core.revolveLoopTris([V(5,0,0), V(8,0,0), V(8,0,5)], V(0,0,0), V(1,1,0), 360, 32), /plane of the profile/);
});

test('sweep a square along an L path: mitred corner keeps the volume', () => {
  const sq = [V(-60,-2,-2), V(-60,2,-2), V(-60,2,2), V(-60,-2,2)];
  const path = core.orientPathToProfile({pts: [V(-80,20,0), V(-80,0,0), V(-60,0,0)], closed: false}, sq);
  assert.equal(path.pts[0].x, -60, 'the path starts at the profile');
  check(core.sweepLoopTris(sq, path.pts, false), 16 * 40, 1e-3, 'L sweep');
});

test('sweep around a closed rectangle starting mid-side', () => {
  const sq = [V(120,-2,-2), V(120,2,-2), V(120,2,2), V(120,-2,2)];
  const path = core.orientPathToProfile({pts: [V(100,0,0), V(140,0,0), V(140,40,0), V(100,40,0)], closed: true}, sq);
  assert.equal(path.pts.length, 5, 'a vertex is added under the profile');
  near(path.pts[0].x, 120, 1e-9, 'loop starts under the profile');
  check(core.sweepLoopTris(sq, path.pts, true), 16 * 160, 1e-3, 'ring sweep');
});

test('sweep rejects a path folding back', () => {
  const sq = [V(0,-1,-1), V(0,1,-1), V(0,1,1), V(0,-1,1)];
  assert.throws(() => core.sweepLoopTris(sq, [V(0,0,0), V(10,0,0), V(1,0.5,0)], false), /sharper|turns back/);
});

test('profile from a selected contour must be flat', () => {
  assert.throws(() => core.profileFromLoop([V(0,0,0), V(10,0,0), V(10,10,3), V(0,10,0)]), /not flat/);
  // точки на одной прямой убираются
  assert.equal(core.profileFromLoop([V(0,0,0), V(5,0,0), V(10,0,0), V(10,10,0), V(0,10,0)]).loop.length, 4);
});
