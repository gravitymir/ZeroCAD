// Т-стык на треугольнике нулевой площади (resolveDegenerate): точка на
// середине чужого ребра держится вырожденным треугольником — сетка формально
// замкнута, но чистка выбрасывает вырожденные и открывает щель. Ремонт режет
// соседа за длинной стороной в этой точке и убирает вырожденный
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['resolveDegenerate']);
const {box, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const toArr = tris => { const a = []; for(const t of tris) for(const p of t) a.push(p.x, p.y, p.z); return new Float32Array(a); };
const degenerate = arr => { let n = 0;
  for(let o=0;o<arr.length;o+=9){ const ux=arr[o+3]-arr[o], uy=arr[o+4]-arr[o+1], uz=arr[o+5]-arr[o+2], vx=arr[o+6]-arr[o], vy=arr[o+7]-arr[o+1], vz=arr[o+8]-arr[o+2];
    if(Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) < 1e-6) n++; } return n; };

test('T-junction held by a zero-area triangle becomes a real seam', () => {
  const tris = box(0, 0, 0, 20, 10, 5);
  // ребро A→B первого треугольника режем точкой M: (A M X) + (M B X) и вырожденный (A B M)
  const [A, B, X] = tris[0], M = A.clone().add(B).multiplyScalar(0.5);
  const T = tris.slice(1);
  T.push([A, M, X], [M, B, X], [A, B, M]);
  const before = toArr(T);
  assert.equal(degenerate(before), 1);
  // без ремонта: выбросить вырожденный — щель
  assert.ok(edgeStats(toArr(T.slice(0, -1)), true).open > 0, 'dropping the zero-area triangle opens the mesh');
  const out = core.resolveDegenerate(before);
  assert.equal(degenerate(out), 0, 'no zero-area triangles left');
  const es = edgeStats(out, true);
  assert.equal(es.open, 0); assert.equal(es.nonManifold, 0);
  near(volume(out), 1000, 1e-6, 'volume unchanged');
});

test('clean mesh is returned as is', () => {
  const arr = toArr(box(0, 0, 0, 5, 5, 5));
  assert.equal(core.resolveDegenerate(arr), arr);
});
