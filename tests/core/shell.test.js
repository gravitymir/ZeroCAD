// Shell (G,H): внутреннее тело оболочки — shellInnerTris (web/app.js), им же
// пользуется MCP shell_body. Плоские грани сдвигаются на толщину стенки и
// строятся заново из контуров (polygonWithHolesTris); узкие грани исчезают
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadCore} = require('./load.js');
const {makeSolids} = require('./solids.js');

const core = loadCore(['earClip', 'meshBoolean', 'planarPatches', 'coplanarFaceTris', 'patchLoops', 'polygonWithHolesTris', 'shellInnerTris']);
const {V, box, frustum, flat, volume, edgeStats} = makeSolids(core.THREE);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const idx = a => Array.from({length: a.length / 9}, (_, i) => i);
const closed = (arr, msg) => { const e = edgeStats(arr, true); assert.equal(e.open, 0, msg + ': open'); assert.equal(e.nonManifold, 0, msg + ': non-manifold'); };
const shell = (tris, openAt, t) => {
  const pos = flat(tris), all = idx(pos);
  const open = [];
  for(const P of openAt){
    const seed = all.find(i => { const o = i*9; const c = V((pos[o]+pos[o+3]+pos[o+6])/3, (pos[o+1]+pos[o+4]+pos[o+7])/3, (pos[o+2]+pos[o+5]+pos[o+8])/3);
      return Math.abs(c.x - P[0]) < 1e-3 || Math.abs(c.y - P[1]) < 1e-3 || Math.abs(c.z - P[2]) < 1e-3; });
    open.push(...core.coplanarFaceTris(pos, seed, null));
  }
  const inner = core.shellInnerTris(pos, all, open, t, Math.max(1, t));
  const out = core.meshBoolean(tris, inner, 'subtract');
  return {inner: flat(inner), out};
};

test('box: closed cavity and open top', () => {
  let r = shell(box(0,0,0,40,40,40), [], 2);
  closed(r.inner, 'inner'); near(volume(r.inner), 36**3, 1e-6, 'inner cube');
  closed(r.out, 'closed shell'); near(volume(r.out), 64000 - 36**3, 1e-6, 'closed shell');
  // открытая крыша: в поиске грани берём центр треугольника на z = 40
  r = shell(box(0,0,0,40,40,40), [[NaN, NaN, 40]], 2);
  closed(r.out, 'open box'); near(volume(r.out), 64000 - 36*36*38, 1e-6, 'open box');
});

test('cylinder wall keeps its thickness on every facet', () => {
  const N = 64, a = 20 * Math.cos(Math.PI / N), A = N * 400 * Math.sin(2 * Math.PI / N) / 2;
  const r = shell(frustum([0,0,0], [0,0,30], 20, 20, N), [[NaN, NaN, 30]], 2);
  closed(r.out, 'cup');
  near(volume(r.out), A*30 - A*((a-2)/a)**2*28, 0.5, 'cup (Float32 rounding of the frustum)');
});

test('pyramid shrinks around its insphere', () => {
  // пирамида: основание 40, высота 40; вписанная сфера r = a·h / (a + √(a² + 4h²))
  const T = V(20,20,40), B = [V(0,0,0), V(40,0,0), V(40,40,0), V(0,40,0)];
  const tris = [[B[0], B[2], B[1]], [B[0], B[3], B[2]], [B[0], B[1], T], [B[1], B[2], T], [B[2], B[3], T], [B[3], B[0], T]];
  const r = shell(tris, [], 2), rin = 1600 / (40 + Math.sqrt(1600 + 6400)), k = (rin - 2) / rin;
  near(volume(r.inner), 64000 / 3 * k**3, 0.01, 'inner pyramid');
  closed(r.out, 'pyramid shell');
});

test('a facet narrower than the wall disappears instead of turning over', () => {
  // пластина 40×20×10, у которой угол срезан фаской шириной 1 мм под 45°:
  // стенка 3 — внутри фаски нет места, она выпадает, полость — прямоугольная
  const c = 0.7071;
  const P = [V(0,0,0), V(40,0,0), V(40,20-c,0), V(40-c,20,0), V(0,20,0)];
  const top = P.map(p => V(p.x, p.y, 10));
  const tris = [];
  for(let i=1;i<P.length-1;i++){ tris.push([P[0], P[i+1], P[i]]); tris.push([top[0], top[i], top[i+1]]); }
  for(let i=0;i<P.length;i++){ const j = (i+1) % P.length; tris.push([P[i], P[j], top[j]], [P[i], top[j], top[i]]); }
  const r = shell(tris, [], 3);
  closed(r.inner, 'inner'); closed(r.out, 'shell');
  near(volume(r.inner), 34 * 14 * 4, 1e-6, 'inner box without the chamfer');
});

test('too thick walls are refused', () => {
  assert.throws(() => shell(box(0,0,0,40,40,40), [], 25), /thicker than half/);
});

test('polygon with holes: bridge and ears keep the area', () => {
  const sq = (x0, y0, s, cw) => { const L = [V(x0,y0,0), V(x0+s,y0,0), V(x0+s,y0+s,0), V(x0,y0+s,0)]; return cw ? L.reverse() : L; };
  const r = core.polygonWithHolesTris(sq(0,0,10), [sq(2,2,2,true), sq(6,5,3,true)], V(0,0,1));
  near(r.want / 2, 100 - 4 - 9, 1e-9, 'area (want — doubled)'); near(r.got, r.want, 1e-9, 'triangles cover it');
});
