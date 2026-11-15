// Mirror (G,I) и Move / Copy / Scale (G,B): тела — связные части сетки
// (bodyComponents), матрицы зеркала и масштаба, копия тела через матрицу
// (bodyTrisTransformed: у зеркала обход разворачивается). Сама замена
// сетки — applyBodyTransform — проверяется сценарием в tests/mcp/run.py
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['bodyComponents', 'bodyTrisOf', 'bodyCount', 'mirrorMatrix', 'scaleMatrix', 'bodyBox', 'bodyTrisTransformed', 'meshBoolean', 'polarAngles', 'polarMatrices']);
const {V, box, flat, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const allIdx = pos => Array.from({length: pos.length / 9}, (_, i) => i);

test('bodies are connected parts of the mesh', () => {
  const pos = flat([...box(0,0,0,20,20,20), ...box(30,0,0,50,20,20), ...box(0,40,0,10,50,10)]);
  const comp = core.bodyComponents(pos);
  assert.equal(core.bodyCount(comp), 3);
  assert.equal(core.bodyTrisOf(comp, 12).length, 12, 'second box — 12 triangles');
  // касание углом (общая вершина) — одно тело: для печати это одна деталь
  assert.equal(core.bodyCount(core.bodyComponents(flat([...box(0,0,0,10,10,10), ...box(10,10,10,20,20,20)]))), 1);
});

test('mirrored copy stays closed with normals outward', () => {
  const pos = flat(box(0,0,0,20,10,5));
  for(const [P, n] of [[V(20,0,0), V(1,0,0)], [V(0,0,0), V(0,0,1)], [V(3,4,5), V(1,1,1).normalize()]]){
    const M = core.mirrorMatrix(P, n);
    assert.ok(M.determinant() < 0, 'mirror flips handedness');
    const arr = flat(core.bodyTrisTransformed(pos, allIdx(pos), M));
    const e = edgeStats(arr, true);
    assert.equal(e.open, 0); assert.equal(e.nonManifold, 0);
    near(volume(arr), 1000, 0.05, 'volume stays positive');
  }
  // точка плоскости остаётся на месте, точка на нормали уходит на ту сторону
  const M = core.mirrorMatrix(V(20,0,0), V(1,0,0));
  near(V(20,7,3).applyMatrix4(M).x, 20, 1e-9, 'on the plane');
  near(V(25,0,0).applyMatrix4(M).x, 15, 1e-9, 'reflected');
});

test('half part mirrored on its cut face joins into the whole part', () => {
  const half = box(0,0,0,20,20,20), pos = flat(half);
  const copy = core.bodyTrisTransformed(pos, allIdx(pos), core.mirrorMatrix(V(20,0,0), V(1,0,0)));
  const out = core.meshBoolean(half, copy, 'union');
  const e = edgeStats(out, true);
  assert.equal(e.open, 0); assert.equal(e.nonManifold, 0);
  near(volume(out), 16000, 1e-6, 'whole part');
});

test('scale around the bottom centre keeps the part on the bed', () => {
  const pos = flat(box(10,10,0,30,20,8));
  const b = core.bodyBox(pos, allIdx(pos)), C = b.getCenter(V(0,0,0)); C.z = b.min.z;
  const arr = flat(core.bodyTrisTransformed(pos, allIdx(pos), core.scaleMatrix(C, V(2, 0.5, 25.4))));
  near(volume(arr), 20*10*8 * 2 * 0.5 * 25.4, 0.05, 'volume × sx·sy·sz');
  const nb = core.bodyBox(arr.length ? arr : pos, allIdx(arr));
  near(nb.min.z, 0, 1e-9, 'still on the bed');
  near(nb.min.x, 0, 1e-9, 'x around the centre'); near(nb.max.x, 40, 1e-9, 'x around the centre');
});

test('polar array: angles and turns around an axis', () => {
  const deg = list => JSON.stringify(Array.from(list, a => +(a * 180 / Math.PI).toFixed(9)));
  // 360° — ровно по кругу, оригинал не входит; меньше — от 0 до angle включительно
  assert.equal(deg(core.polarAngles(6, 360)), '[60,120,180,240,300]');
  assert.equal(deg(core.polarAngles(3, 120)), '[60,120]');
  assert.equal(deg(core.polarAngles(4, 90)), '[30,60,90]');
  // поворот вокруг оси через (50, 50) по Z: точка (80, 50) уходит на (50, 80)
  const [M] = core.polarMatrices(V(50, 50, 0), V(0, 0, 2), core.polarAngles(4, 360));
  const p = V(80, 50, 7).applyMatrix4(M);
  near(p.x, 50, 1e-9, 'x'); near(p.y, 80, 1e-9, 'y'); near(p.z, 7, 1e-9, 'z stays');
  assert.ok(M.determinant() > 0, 'turn keeps handedness — normals stay outward');
  // копии куба по кругу замкнуты и того же объёма
  const pos = flat(box(70, 40, 0, 90, 60, 20));
  for(const R of core.polarMatrices(V(50, 50, 0), V(0, 0, 1), core.polarAngles(6, 360))){
    const arr = flat(core.bodyTrisTransformed(pos, allIdx(pos), R));
    near(volume(arr), 8000, 1, 'copy volume (coordinates to 0.001 mm)');
    assert.equal(edgeStats(arr).open, 0, 'copy closed');
  }
});
