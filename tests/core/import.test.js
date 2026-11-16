// Единый импорт: разбор OBJ (многоугольники веером, номера с конца, v/vt/vn)
// и GLB (glTF 2.0: трансформы узлов, метры и Y вверх → миллиметры и Z вверх)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');

const core = loadCore(['parseOBJ', 'parseGLB']);

test('OBJ: quad as a fan, negative indices and v/vt/vn', () => {
  const t = core.parseOBJ('# square\nv 0 0 0\nv 10 0 0\nv 10 10 0\nv 0 10 0\nvt 0 0\nf 1/1/1 2/1/1 3/1/1 4/1/1\nf -4 -2 -1\n');
  assert.equal(t.length, 9 * 3, 'quad → 2 triangles, plus one more');
  assert.deepEqual([...t.slice(0, 9)], [0, 0, 0, 10, 0, 0, 10, 10, 0]);
  assert.deepEqual([...t.slice(18, 27)], [0, 0, 0, 10, 10, 0, 0, 10, 0]);
  assert.throws(() => core.parseOBJ('v 0 0 0\nf 1 2 3\n'), /missing vertex/);
});

// GLB из одного треугольника, узел сдвинут на 1 м по Y glTF (вверх)
function tinyGLB(){
  const pos = new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0, -0.02]);
  const json = JSON.stringify({asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{children: [1], translation: [0, 1, 0]}, {mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
    buffers: [{byteLength: pos.byteLength}], bufferViews: [{buffer: 0, byteLength: pos.byteLength}],
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3'}]});
  const pad = s => s + ' '.repeat((4 - s.length % 4) % 4);
  const jb = Buffer.from(pad(json)), bb = Buffer.from(pos.buffer);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + jb.length + 8 + bb.length, 8);
  jh.writeUInt32LE(jb.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  bh.writeUInt32LE(bb.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  const all = Buffer.concat([head, jh, jb, bh, bb]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

test('GLB: node transforms, metres Y-up become millimetres Z-up', () => {
  const t = [...core.parseGLB(tinyGLB())].map(x => Math.round(x * 1000) / 1000 + 0); // + 0: −0 → 0
  // (x, y, z) м → (1000x, −1000z, 1000y) мм; узел поднят на 1 м → Z = 1000
  assert.deepEqual(t, [0, 0, 1000, 10, 0, 1000, 0, 20, 1000]);
  assert.throws(() => core.parseGLB(new ArrayBuffer(24)), /not a GLB/);
});
