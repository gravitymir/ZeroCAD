// Построители тел и проверки для тестов ядра: ящик, усечённый конус,
// объём, открытые и немногообразные рёбра (бит в бит и по ключу 0.001 мм)
'use strict';

function makeSolids(THREE){
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const q3 = x => Math.round(x * 1000) / 1000;

  const box = (x0, y0, z0, x1, y1, z1) => {
    const c = [V(x0,y0,z0), V(x1,y0,z0), V(x1,y1,z0), V(x0,y1,z0), V(x0,y0,z1), V(x1,y0,z1), V(x1,y1,z1), V(x0,y1,z1)];
    const f = [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    return f.map(t => t.map(i => c[i]));
  };

  // как add_frustum в app.js: кольца по seg точек, торцы веером, координаты
  // округлены до 0.001 мм
  const frustum = (A, B, r1, r2, seg) => {
    A = V(...A); B = V(...B);
    const axis = new THREE.Vector3().subVectors(B, A).normalize();
    const u = (Math.abs(axis.z) < 0.9 ? V(0,0,1) : V(1,0,0)).cross(axis).normalize();
    const v = axis.clone().cross(u);
    const ring = (C, r) => Array.from({length: seg}, (_, i) => { const t = i / seg * Math.PI * 2;
      return C.clone().addScaledVector(u, r * Math.cos(t)).addScaledVector(v, r * Math.sin(t)); });
    const ra = ring(A, r1), rb = ring(B, r2), tris = [];
    for(let i=0;i<seg;i++){ const j = (i+1) % seg;
      tris.push([A, ra[j], ra[i]], [B, rb[i], rb[j]], [ra[i], ra[j], rb[j]], [ra[i], rb[j], rb[i]]); }
    let vol = 0; for(const [p, q, r] of tris) vol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
    return tris.map(t => (vol < 0 ? [t[0], t[2], t[1]] : t).map(p => V(q3(p.x), q3(p.y), q3(p.z))));
  };

  // площадь правильного n-угольника с описанным радиусом r
  const ngonArea = (r, n) => n / 2 * r * r * Math.sin(2 * Math.PI / n);

  const flat = T => new Float32Array(T.flat().flatMap(p => [p.x, p.y, p.z]));
  const toTris = arr => { const T = [];
    for(let i=0;i<arr.length;i+=9) T.push([0,3,6].map(o => V(arr[i+o], arr[i+o+1], arr[i+o+2]))); return T; };

  const volume = arr => { let s = 0;
    for(let i=0;i<arr.length;i+=9)
      s += (arr[i] * (arr[i+4]*arr[i+8] - arr[i+5]*arr[i+7]) - arr[i+1] * (arr[i+3]*arr[i+8] - arr[i+5]*arr[i+6])
        + arr[i+2] * (arr[i+3]*arr[i+7] - arr[i+4]*arr[i+6])) / 6;
    return s; };

  // exact: сравнение вершин бит в бит; иначе — по ключу 0.001 мм, как в редакторе
  const edgeStats = (arr, exact) => {
    const K = i => exact ? arr[i]+','+arr[i+1]+','+arr[i+2]
      : Math.round(arr[i]*1000)+','+Math.round(arr[i+1]*1000)+','+Math.round(arr[i+2]*1000);
    const c = new Map();
    for(let i=0;i<arr.length;i+=9){
      const k = [K(i), K(i+3), K(i+6)];
      if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
      for(let e=0;e<3;e++){ const a = k[e], b = k[(e+1)%3], ek = a < b ? a+'|'+b : b+'|'+a; c.set(ek, (c.get(ek) || 0) + 1); }
    }
    let open = 0, nonManifold = 0;
    for(const n of c.values()){ if(n === 1) open++; if(n > 2) nonManifold++; }
    return {open, nonManifold};
  };

  // детерминированный генератор (Park–Miller)
  const rng = seed => { let s = seed % 2147483647; if(s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647; };

  return {V, q3, box, frustum, ngonArea, flat, toTris, volume, edgeStats, rng};
}

module.exports = {makeSolids};
