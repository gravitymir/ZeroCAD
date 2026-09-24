// Кривые Безье: bezierPoints / curveChordPoints / smoothAnchors (web/app.js) —
// тот же код, что у пера (G,P) и MCP draw_curve. Проверяем, что хорды не
// отходят от настоящей кривой дальше допуска, что допуск управляет густотой
// и что гладкая кривая действительно проходит через заданные точки
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');

const core = loadCore(['bezierPoints', 'curveChordPoints', 'smoothAnchors']);
const THREE = core.THREE;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// точка настоящей кривой по формуле — эталон для сравнения
const bezAt = (p0, c1, c2, p3, t) => {
  const u = 1 - t;
  return new THREE.Vector3()
    .addScaledVector(p0, u*u*u).addScaledVector(c1, 3*u*u*t)
    .addScaledVector(c2, 3*u*t*t).addScaledVector(p3, t*t*t);
};
// насколько ломаная отходит от кривой: берём частые точки кривой и меряем
// расстояние до ближайшего отрезка ломаной
function maxGap(poly, p0, c1, c2, p3){
  let worst = 0;
  const q = new THREE.Vector3();
  for(let i = 0; i <= 2000; i++){
    const P = bezAt(p0, c1, c2, p3, i / 2000);
    let best = Infinity;
    for(let k = 0; k + 1 < poly.length; k++){
      const A = poly[k], ab = new THREE.Vector3().subVectors(poly[k+1], A);
      const L2 = ab.lengthSq();
      const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, q.subVectors(P, A).dot(ab) / L2));
      best = Math.min(best, A.clone().addScaledVector(ab, t).distanceTo(P));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('chords stay within the tolerance of the real curve', () => {
  const p0 = V(0, 0, 0), c1 = V(0, 600, 400), c2 = V(1200, 900, -200), p3 = V(1500, 0, 0);
  for(const tol of [2, 0.4, 0.05]){
    const poly = core.bezierPoints(p0, c1, c2, p3, tol);
    assert.ok(poly[0].distanceTo(p0) < 1e-9, 'starts at the first point');
    assert.ok(poly[poly.length-1].distanceTo(p3) < 1e-9, 'ends at the last point');
    assert.ok(maxGap(poly, p0, c1, c2, p3) <= tol, 'gap within ' + tol + ' mm');
  }
  // мельче допуск — гуще ломаная
  const a = core.bezierPoints(p0, c1, c2, p3, 2).length;
  const b = core.bezierPoints(p0, c1, c2, p3, 0.05).length;
  assert.ok(b > a * 2, 'a tighter tolerance gives more chords: ' + a + ' -> ' + b);
});

test('a straight segment needs no extra points', () => {
  const p0 = V(0, 0, 0), p3 = V(100, 0, 0);
  const c1 = p0.clone().lerp(p3, 1/3), c2 = p0.clone().lerp(p3, 2/3);
  assert.equal(core.bezierPoints(p0, c1, c2, p3, 0.4).length, 2);
});

test('a smooth curve passes through its points and closes', () => {
  const pts = [V(0, 0, 0), V(1000, 500, 0), V(2000, 0, 0), V(1000, -500, 0)];
  const anchors = core.smoothAnchors(pts, true);
  const poly = core.curveChordPoints(anchors, true, 0.2);
  for(const P of pts){
    const near = poly.reduce((m, q) => Math.min(m, q.distanceTo(P)), Infinity);
    assert.ok(near < 1e-6, 'the curve goes through the given point ' + P.toArray());
  }
  // замкнутая: последняя точка возвращается к первой
  assert.ok(poly[poly.length-1].distanceTo(pts[0]) > 1, 'the loop is not closed by a duplicate point');
  assert.ok(poly.length > pts.length * 4, 'the loop is properly rounded');
  // касательная в узле одна и та же с обеих сторон (гладкий узел)
  const a = anchors[1];
  const inDir = new THREE.Vector3().subVectors(a.P, a.hIn).normalize();
  const outDir = new THREE.Vector3().subVectors(a.hOut, a.P).normalize();
  assert.ok(inDir.distanceTo(outDir) < 1e-9, 'both handles point the same way');
});

test('smooth: false leaves the points as a polyline', () => {
  const pts = [V(0, 0, 0), V(100, 100, 0), V(200, 0, 0)];
  const anchors = pts.map(P => ({P, hIn: null, hOut: null}));
  const poly = core.curveChordPoints(anchors, false, 0.4);
  // Array.from: .map на vm-массиве вернул бы массив чужого realm, и
  // deepStrictEqual отказал бы «same structure but not reference-equal»
  const plain = list => Array.from(list, p => [p.x, p.y, p.z]);
  assert.deepEqual(plain(poly), plain(pts));
});
