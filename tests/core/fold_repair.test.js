// Загиб на Т-стыке щепки (repairFoldPairs): вершина D щепки u лежит на ребре
// B–C треугольника t, и u через общее ребро A–C накрывает кусок t изнанкой.
// Сетка замкнута, объём верный, но folded_edges > 0. Ремонт режет t и его
// соседа через B–C в точке D, вывернутая пара выпадает
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['repairFoldPairs']);
const {volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const folds = arr => {
  const key = o => arr[o].toFixed(4) + ',' + arr[o+1].toFixed(4) + ',' + arr[o+2].toFixed(4);
  const N = [], half = new Map();
  for(let o = 0; o < arr.length; o += 9){
    const u = [arr[o+3]-arr[o], arr[o+4]-arr[o+1], arr[o+5]-arr[o+2]], v = [arr[o+6]-arr[o], arr[o+7]-arr[o+1], arr[o+8]-arr[o+2]];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]], l = Math.hypot(...n);
    N.push(n.map(x => x / l));
    for(let e = 0; e < 3; e++) half.set(key(o + e*3) + '>' + key(o + ((e+1)%3)*3), o / 9);
  }
  let n = 0;
  for(const [k, t] of half){
    const [a, b] = k.split('>'), u = half.get(b + '>' + a);
    if(u != null && t < u && N[t][0]*N[u][0] + N[t][1]*N[u][1] + N[t][2]*N[u][2] < -0.98) n++;
  }
  return n;
};

// диск вокруг D (D на отрезке B–C) + конус к вершине P под ним — замкнутое тело
const A = [0.5, 0.1, 0], B = [0, 0, 0], C = [1, 0, 0], D = [0.5, 0, 0], Z = [0.5, -0.5, 0],
      Q = [1, 0.3, 0], E = [0.8, 0.4, 0], P = [0.5, 0, -1];
const cap = [[Q, C, P], [E, Q, P], [A, E, P], [B, A, P], [Z, B, P], [C, Z, P]];
const common = [[D, C, Q], [D, Q, E], [D, E, A]].concat(cap);
const arrOf = tris => new Float32Array(tris.flat(2));

test('a sliver turned inside out over a T-junction is cut away', () => {
  const good = arrOf(common.concat([[B, D, A], [C, D, Z], [D, B, Z]]));
  // t = (A B C) поверх D, щепка u = (A C D) — изнанкой, сосед w = (C B Z) не разрезан
  const broken = arrOf(common.concat([[A, B, C], [A, C, D], [C, B, Z]]));
  const es0 = edgeStats(broken, true);
  assert.equal(es0.open, 0); assert.equal(es0.nonManifold, 0);
  assert.equal(folds(broken), 3, 'the sliver is folded against all three neighbours (as on the canopy)');
  near(volume(broken), volume(good), 1e-9, 'same volume — only the fold differs');
  const out = core.repairFoldPairs(broken);
  assert.equal(folds(out), 0, 'no folds left');
  const es = edgeStats(out, true);
  assert.equal(es.open, 0); assert.equal(es.nonManifold, 0);
  near(volume(out), volume(good), 1e-6, 'volume unchanged');
});

test('a clean mesh is returned as is', () => {
  const arr = arrOf(common.concat([[B, D, A], [C, D, Z], [D, B, Z]]));
  assert.equal(core.repairFoldPairs(arr), arr);
});
