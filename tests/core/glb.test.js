// GLB (glTF 2.0 binary) — buildGLB/glbPart (web/app.js), тот же писатель, что
// у кнопки GLB и MCP export_glb. Проверяем структуру файла (куски, выравнивание,
// границы), перевод в метры и Y вверх, имена узлов и пустые узлы-хотспоты
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['glbVec', 'glbPart', 'buildGLB']);
const {V, box, flat} = makeSolids(core.THREE);

// разбор GLB без сторонних библиотек: заголовок, куски JSON и BIN
function readGLB(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546C67, 'magic glTF');
  assert.equal(dv.getUint32(4, true), 2, 'version 2');
  assert.equal(dv.getUint32(8, true), u8.length, 'length in the header');
  const jlen = dv.getUint32(12, true);
  assert.equal(dv.getUint32(16, true), 0x4E4F534A, 'JSON chunk');
  assert.equal(jlen % 4, 0, 'JSON chunk is 4-byte aligned');
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jlen)));
  const o = 20 + jlen, blen = dv.getUint32(o, true);
  assert.equal(dv.getUint32(o + 4, true), 0x004E4942, 'BIN chunk');
  assert.equal(blen % 4, 0, 'BIN chunk is 4-byte aligned');
  const bin = u8.subarray(o + 8, o + 8 + blen);
  assert.equal(json.buffers[0].byteLength <= bin.length, true, 'buffer fits the BIN chunk');
  for(const v of json.bufferViews)
    assert.ok(v.byteOffset + v.byteLength <= bin.length, 'bufferView inside the buffer');
  const read = ai => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView];
    const size = {SCALAR: 1, VEC3: 3}[a.type];
    assert.equal(v.byteOffset % 4, 0, 'accessor data is 4-byte aligned');
    const buf = bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + v.byteLength);
    const arr = a.componentType === 5126 ? new Float32Array(buf)
      : a.componentType === 5125 ? new Uint32Array(buf) : new Uint16Array(buf);
    assert.equal(arr.length, a.count * size, 'accessor count matches its data');
    return arr;
  };
  return {json, read};
}

test('a 40 mm cube exports as 0.04 m, Y up, nose along -Z', () => {
  const tris = flat(box(0, 0, 0, 40, 40, 40));
  const glb = core.buildGLB([{name: 'body-main', tris}], [], 'car');
  const {json, read} = readGLB(glb);
  assert.deepEqual(json.nodes.map(n => n.name), ['body-main', 'car']);
  assert.deepEqual(json.scenes[0].nodes, [1], 'root node is the car');
  assert.deepEqual(json.nodes[1].children, [0], 'the part hangs on the root');
  const prim = json.meshes[0].primitives[0];
  const acc = json.accessors[prim.POSITION === undefined ? prim.attributes.POSITION : prim.POSITION];
  // мм → м и Z вверх → Y вверх: y идёт от 0 до 0.04, перёд (+Y у нас) стал -Z
  assert.deepEqual(acc.min.map(v => +v.toFixed(4)), [0, 0, -0.04]);
  assert.deepEqual(acc.max.map(v => +v.toFixed(4)), [0.04, 0.04, 0]);
  const idx = read(prim.indices), pos = read(prim.attributes.POSITION);
  assert.equal(idx.length, 36, '12 triangles');
  assert.equal(pos.length / 3, 24, 'a cube has 24 vertices with flat normals');
  for(const i of idx) assert.ok(i < pos.length / 3, 'index inside the vertex list');
  // нормали единичные
  const nrm = read(prim.attributes.NORMAL);
  for(let i = 0; i < nrm.length; i += 3)
    assert.ok(Math.abs(Math.hypot(nrm[i], nrm[i+1], nrm[i+2]) - 1) < 1e-5, 'unit normal');
});

test('named parts and hotspot empties become separate nodes', () => {
  const a = flat(box(0, 0, 0, 10, 10, 10));
  const b = flat(box(50, 0, 0, 60, 10, 10));
  const glb = core.buildGLB([{name: 'hood', tris: a}, {name: 'wheel-fl', tris: b}],
    [{name: 'hotspot-engine', pos: V(1000, 2000, 500)}], 'berlingo');
  const {json} = readGLB(glb);
  assert.deepEqual(json.nodes.map(n => n.name), ['hood', 'wheel-fl', 'hotspot-engine', 'berlingo']);
  const spot = json.nodes[2];
  assert.equal(spot.mesh, undefined, 'a hotspot has no geometry');
  // (1000, 2000, 500) мм -> (1, 0.5, -2) м в осях glTF
  assert.deepEqual(spot.translation.map(v => +v.toFixed(4)), [1, 0.5, -2]);
  assert.deepEqual(json.nodes[3].children, [0, 1, 2]);
  assert.equal(json.meshes.length, 2);
});

test('an empty model is refused instead of writing a broken file', () => {
  assert.throws(() => core.buildGLB([], [], 'car'), /nothing to export/);
  // вырожденные треугольники не дают вершин — тоже нечего писать
  assert.throws(() => core.buildGLB([{name: 'x', tris: new Float32Array(9)}], [], 'car'), /nothing to export/);
});
