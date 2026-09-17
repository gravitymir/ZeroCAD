// Loft (G,F): тело между двумя профилями — loftLoopTris (web/app.js), им же
// пользуется MCP loft_profiles. Вершины сшиваются по доле длины контура:
// точки обоих профилей сохраняются, стенки прямые
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['earClip', 'orientSolid', 'loopPlaneNormal', 'loopCentroid', 'loopAt', 'loopParams', 'loftLoopTris']);
const {V, flat, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const check = (tris, exp, tol, msg) => {
  const arr = flat(tris), e = edgeStats(arr, true);
  assert.equal(e.open, 0, msg + ': open edges');
  assert.equal(e.nonManifold, 0, msg + ': non-manifold edges');
  near(volume(arr), exp, tol, msg); // «+» — нормали наружу
};
const sq = (s, z, dx = 0, dy = 0) => [V(-s+dx,-s+dy,z), V(s+dx,-s+dy,z), V(s+dx,s+dy,z), V(-s+dx,s+dy,z)];
const circ = (r, z, n) => Array.from({length: n}, (_, i) => { const t = i/n*2*Math.PI; return V(r*Math.cos(t), r*Math.sin(t), z); });
const ngon = (r, n) => n / 2 * r * r * Math.sin(2 * Math.PI / n);

test('square to square: prism, frustum and oblique prism', () => {
  check(core.loftLoopTris(sq(10, 0), sq(10, 30)), 400 * 30, 1e-6, 'prism');
  // усечённая пирамида: h/3 (A1 + √(A1·A2) + A2)
  check(core.loftLoopTris(sq(10, 0), sq(4, 25)), 25 / 3 * (400 + Math.sqrt(400 * 64) + 64), 1e-6, 'frustum');
  // наклонная призма — по Кавальери тот же объём
  check(core.loftLoopTris(sq(10, 0), sq(10, 30, 20, 20)), 400 * 30, 1e-6, 'oblique prism');
});

test('circle to circle keeps the polygon frustum volume', () => {
  const A1 = ngon(12, 32), A2 = ngon(4, 32);
  check(core.loftLoopTris(circ(12, 0, 32), circ(4, 18, 32)), 18 / 3 * (A1 + Math.sqrt(A1 * A2) + A2), 1e-4, 'cone frustum');
});

test('square to circle: points of both profiles stay, volume by the prismatoid', () => {
  const a = sq(10, 0), b = circ(5, 30, 48);
  const tris = core.loftLoopTris(a, b);
  // доли квадрата (0, ¼, ½, ¾) уже есть среди 48 долей круга — 48 колец,
  // боковина 2 на кольцо, торцы — по 46 треугольников (n − 2)
  assert.equal(tris.length, 48 * 2 + 46 * 2, 'stitched rings');
  // сечение при t: P = lerp(a, b) — площадь квадратична,
  // V = h·(Aa + Ab + C/2)/3, C = ½ Σ (a_i × b_{i+1} + b_i × a_{i+1})
  const ring = (L, k) => { // тот же разбор по доле длины
    const st = k || 0, cum = [0];
    for(let i=0;i<L.length;i++) cum.push(cum[i] + L[(st+i)%L.length].distanceTo(L[(st+i+1)%L.length]));
    return {cum, total: cum[L.length], s: cum.slice(0, L.length).map(x => x / cum[L.length]), k};
  };
  // старт второго контура — вершина в ту же сторону от центра, что и первая
  // вершина первого (как в loftLoopTris): у круга это 225°
  const cA = core.loopCentroid(a), cB = core.loopCentroid(b);
  const u = new core.THREE.Vector3().subVectors(a[0], cA).setZ(0).normalize();
  let start = 0, best = -Infinity;
  b.forEach((p, i) => { const w = new core.THREE.Vector3().subVectors(p, cB).setZ(0); const d = w.dot(u) / w.length(); if(d > best){ best = d; start = i; } });
  assert.equal(start, 30, 'the circle starts at 225°');
  const pa = ring(a), pb = ring(b, start);
  const params = [...new Set([...pa.s, ...pb.s].map(x => Math.round(x*1e9)/1e9))].sort((x, y) => x - y);
  const N = params.length;
  assert.equal(N, 48, 'parameter count');
  const RA = params.map(s => core.loopAt(a, pa.cum, pa.total, s, 0));
  const RB = params.map(s => core.loopAt(b, pb.cum, pb.total, s, start));
  const area = L => { let s = 0; for(let i=0;i<L.length;i++){ const p = L[i], q = L[(i+1)%L.length]; s += p.x*q.y - q.x*p.y; } return s/2; };
  let C = 0;
  for(let i=0;i<N;i++){ const j = (i+1)%N; C += (RA[i].x*RB[j].y - RB[j].x*RA[i].y) + (RB[i].x*RA[j].y - RA[j].x*RB[i].y); }
  check(tris, 30 * (area(RA) + area(RB) + C/4) / 3, 1e-4, 'funnel');
});

test('profiles in the same place and degenerate ones are refused', () => {
  assert.throws(() => core.loftLoopTris(sq(10, 0), sq(8, 0.01)), /same place/);
  assert.throws(() => core.loftLoopTris(sq(10, 0), [V(0,0,10), V(1,0,10)]), /at least 3 points/);
});

test('the second profile drawn the other way round is not twisted', () => {
  const a = sq(10, 0), b = [...sq(10, 30)].reverse();
  check(core.loftLoopTris(a, b), 400 * 30, 1e-6, 'reversed profile');
});
