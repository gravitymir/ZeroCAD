// Точные булевы meshBoolean (web/app.js): объёмы по формулам, замкнутость,
// вырожденные случаи симметричных построений и случайный стресс-тест.
// Запуск: node --test "tests/core/*.test.js"   (ZC_STRESS=2000, ZC_SEED=7 — другие случайные пары)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['meshBoolean']);
const S = makeSolids(core.THREE);
const {box, frustum, ngonArea, flat, toTris, volume, edgeStats, rng} = S;

const closed = (arr, msg) => {
  const e = edgeStats(arr, true);
  assert.equal(e.open, 0, (msg || '') + ': open edges');
  assert.equal(e.nonManifold, 0, (msg || '') + ': non-manifold edges');
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''}: ${a} vs ${b} (±${tol})`);

// куб 40 (0..40) и цилиндр R8 из 48 сегментов в разных положениях — те же
// 14 случаев, что проверялись через MCP; ожидаемый прирост/убыль объёма
const A48 = ngonArea(8, 48);
const cubeCases = [
  ['crossing the top',        [20,20,30],  [20,20,55], 15*A48,       -10*A48],
  ['standing on the face',    [20,20,40],  [20,20,55], 15*A48,       0],
  ['pocket from the face',    [20,20,40],  [20,20,30], 0,            -10*A48],
  ['axis along a cube edge',  [0,0,10],    [0,0,35],   25*A48*3/4,   -25*A48/4],
  ['axis in a side face',     [20,0,10],   [20,0,35],  25*A48/2,     -25*A48/2],
  ['through both faces',      [20,20,-10], [20,20,50], 20*A48,       -40*A48],
  ['flush with both faces',   [20,20,0],   [20,20,40], 0,            -40*A48],
];
for(const [name, from, to, dUnion, dCut] of cubeCases){
  test(`cube 40 ∪ cylinder: ${name}`, () => {
    const r = core.meshBoolean(box(0,0,0,40,40,40), frustum(from, to, 8, 8, 48), 'union');
    closed(r, name);
    near(volume(r) - 64000, dUnion, 0.05, name);
  });
  test(`cube 40 − cylinder: ${name}`, () => {
    const r = core.meshBoolean(box(0,0,0,40,40,40), frustum(from, to, 8, 8, 48), 'subtract');
    closed(r, name);
    near(volume(r) - 64000, dCut, 0.05, name);
  });
}

test('four cones from one point (tetrapod core) stay closed', () => {
  // ось не округлена: точки пересечения у общей вершины ложатся в 2e-5 мм
  // друг от друга — раньше здесь протекала классификация (+1400 мм³)
  const dirs = [[0,0,1], ...[0, 2*Math.PI/3, 4*Math.PI/3].map(a => [Math.sqrt(8/9)*Math.cos(a), Math.sqrt(8/9)*Math.sin(a), -1/3])];
  let cur = flat(frustum([0,0,0], dirs[0].map(c => 40*c), 12, 6, 32));
  let prev = volume(cur);
  for(let k=1;k<4;k++){
    cur = core.meshBoolean(toTris(cur), frustum([0,0,0], dirs[k].map(c => 40*c), 12, 6, 32), 'union');
    closed(cur, 'cone ' + k);
    assert.ok(volume(cur) > prev, 'each cone adds volume');
    prev = volume(cur);
  }
  // пересверлить насквозь по оси: убыль, тело замкнуто
  const drilled = core.meshBoolean(toTris(cur), frustum([0,0,-50], [0,0,50], 3, 3, 16), 'subtract');
  closed(drilled, 'drilled');
  assert.ok(volume(drilled) < prev);
});

test('solids that do not touch: inside, outside, A inside B', () => {
  const A = frustum([0,0,-10], [0,0,10], 10, 10, 16);
  const inner = frustum([0,0,-2], [0,0,2], 2, 2, 8), outer = frustum([50,0,0], [60,0,0], 2, 2, 8);
  const vA = volume(flat(A)), vIn = volume(flat(inner)), vOut = volume(flat(outer));
  near(volume(core.meshBoolean(A, inner, 'union')), vA, 1e-6, 'B inside A, union');
  near(volume(core.meshBoolean(A, inner, 'subtract')), vA - vIn, 1e-6, 'B inside A, cavity');
  near(volume(core.meshBoolean(A, outer, 'union')), vA + vOut, 1e-6, 'apart, union');
  near(volume(core.meshBoolean(A, outer, 'subtract')), vA, 1e-6, 'apart, subtract');
  assert.equal(core.meshBoolean(inner, A, 'subtract').length, 0, 'A inside B, subtract is empty');
});

test('vertices equal by editor key (0.001 mm) but not bit-exact are one point', () => {
  // сетка после прошлых операций сварена по ключу, позиции расходятся на доли
  // микрона: у одного угла куба в разных треугольниках разные копии
  let copy = 0;
  const A = box(0,0,0,40,40,40).map(t => t.map(p => {
    if(p.x === 40 && p.y === 40 && p.z === 40) return p.clone().add(new core.THREE.Vector3(1e-4 * (copy++ % 3), 2e-4 * (copy % 2), 0));
    return p;
  }));
  const r = core.meshBoolean(A, frustum([20,20,30], [20,20,55], 8, 8, 48), 'union');
  closed(r, 'key-welded input');
  near(volume(r) - 64000, 15*A48, 0.05);
});

// Случайные пары: ящики и цилиндры, 60 % на сетке 5 мм (вырожденные
// совпадения). Тождество V(A∪B) = V(B) + V(A−B) и замкнутость. Касание
// ящиков ровно по ребру даёт немногообразное ребро — это правильный ответ
test('random pairs: closed results and V(A∪B) = V(B) + V(A−B)', () => {
  const N = +(process.env.ZC_STRESS || 300);
  const rnd = rng(+(process.env.ZC_SEED || 20260916));
  const failures = [];
  let worst = 0;
  for(let it=0; it<N; it++){
    const grid = rnd() < 0.6;
    const g = () => grid ? Math.round(rnd()*8)*5 - 20 : Math.round((rnd()*40 - 20) * 1000) / 1000;
    const cubeA = rnd() < 0.5;
    const A = cubeA ? box(-15,-15,-15,15,15,15) : frustum([0,0,-15], [0,0,15], 14, 10, 24);
    let B, edgeTouch = false;
    if(rnd() < 0.4){
      const x0 = g(), y0 = g(), z0 = g();
      const x1 = x0 + 5 + Math.abs(g()), y1 = y0 + 5 + Math.abs(g()), z1 = z0 + 5 + Math.abs(g());
      B = box(x0, y0, z0, x1, y1, z1);
      // сколько осей, по которым ящики лишь соприкасаются гранями
      const touch = [[x0,x1],[y0,y1],[z0,z1]].filter(([lo, hi]) => hi === -15 || lo === 15).length;
      edgeTouch = cubeA && touch >= 2;
    } else {
      const p = [g(), g(), g()];
      const q = grid ? [p[0], p[1], p[2] + 10 + Math.abs(g())] : [g(), g(), g()];
      if(Math.hypot(q[0]-p[0], q[1]-p[1], q[2]-p[2]) < 1) continue;
      B = frustum(p, q, 3 + Math.abs(g())/4, 3 + Math.abs(g())/4, 8 + Math.floor(rnd()*24));
    }
    try {
      const U = core.meshBoolean(A, B, 'union'), D = core.meshBoolean(A, B, 'subtract');
      const eU = edgeStats(U, true), eD = edgeStats(D, true);
      const rel = Math.abs(volume(U) - volume(flat(B)) - volume(D)) / Math.max(1, volume(U));
      worst = Math.max(worst, rel);
      if(eU.open || eD.open || eD.nonManifold || (eU.nonManifold && !edgeTouch) || rel > 1e-6)
        failures.push({it, grid, U: eU, D: eD, rel});
    } catch(err){
      failures.push({it, grid, error: err.message});
    }
  }
  assert.deepEqual(failures, [], `worst relative volume error ${worst}`);
});
