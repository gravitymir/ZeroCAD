// Ядро геометрии ZeroCAD: булевы и починка сетки. Тот же код грузят и
// страница (до app.js), и фоновый поток geom-worker.js, поэтому здесь нет
// ни страницы, ни сцены. Функции работают с текущей сеткой через mesh
// (mesh.geometry.attributes.position.array) и заменяют её через
// setMeshFromArray: на странице это настоящая модель из app.js, в потоке —
// лёгкая подмена из geom-worker.js. collapseCollinearVertices читает ещё
// guides и anchors (концы линий и точки не стягиваются) — их тоже даёт
// окружение. Нужен THREE (vendor/three.min.js)

// квантование координат, 0.001 мм: ключ вершины — её координаты в микронах
const QP = 1000;
const kf = v => Math.round(v*QP);
const keyOf = (x,y,z) => kf(x)+','+kf(y)+','+kf(z);

function splitMeshByChord(A, B, wholeLine){
  // wholeLine === 'segment' — точный рез строго по отрезку (сегменты круга):
  // без продления за концы и без допусков против осколков
  // точные пороги — только сегментам круга; тексту и прямоугольнику точный
  // рез на веерном дне кармана давал вырожденные осколки и щели
  const exact = wholeLine === 'segment';
  if(wholeLine === 'segment') wholeLine = false;
  const posArr = mesh.geometry.attributes.position.array;
  const dir = new THREE.Vector3().subVectors(B, A);
  const chordLen = dir.length();
  if(chordLen < 1e-6) return;
  dir.multiplyScalar(1/chordLen);
  const triCount = posArr.length/9;
  const V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const keyV = v => keyOf(v.x, v.y, v.z);
  const ekey = (a,b) => { const k1=keyV(a), k2=keyV(b); return k1<k2 ? k1+'|'+k2 : k2+'|'+k1; };
  const tOf = P => dir.x*(P.x-A.x) + dir.y*(P.y-A.y) + dir.z*(P.z-A.z);
  const splitTris = new Map(); // triIdx -> [[a,b,c],...] готовые осколки
  const edgeCuts = new Map();  // ключ ребра -> точка реза на нём
  // фаза 1: режем копланарные треугольники вдоль хорды, запоминаем точки на рёбрах
  for(let ti=0; ti<triCount; ti++){
    const o = ti*9;
    for(let k=0;k<3;k++) V[k].fromArray(posArr, o+k*3);
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(V[1],V[0]),
      new THREE.Vector3().subVectors(V[2],V[0]));
    const a2 = n.length();
    if(a2 < 1e-9) continue;
    n.multiplyScalar(1/a2);
    if(Math.abs(n.dot(new THREE.Vector3().subVectors(A, V[0]))) > 0.05 ||
       Math.abs(n.dot(new THREE.Vector3().subVectors(B, V[0]))) > 0.05) continue;
    const nl = new THREE.Vector3().crossVectors(n, dir);
    const d = V.map(v => nl.dot(new THREE.Vector3().subVectors(v, A)));
    const EPS = 1e-3;
    const s = d.map(x => x > EPS ? 1 : (x < -EPS ? -1 : 0));
    if(!(s.includes(1) && s.includes(-1))) continue;
    if(wholeLine){
      // сегмент обязан пересекать треугольник (2D в плоскости грани)
      const nA=[Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)];
      const drop = nA[0]>=nA[1]&&nA[0]>=nA[2] ? 0 : (nA[1]>=nA[2] ? 1 : 2);
      const to2p = p => drop===0 ? [p.y,p.z] : (drop===1 ? [p.x,p.z] : [p.x,p.y]);
      const t2 = V.map(to2p), a2 = to2p(A), b2 = to2p(B);
      const orr=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
      const inTri = p => {
        const s1=orr(t2[0],t2[1],p), s2=orr(t2[1],t2[2],p), s3=orr(t2[2],t2[0],p);
        return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);
      };
      let ok = inTri(a2) || inTri(b2);
      if(!ok) for(let e2=0;e2<3;e2++)
        if(segCross2(a2,b2,t2[e2],t2[(e2+1)%3])){ ok=true; break; }
      if(!ok) continue;
    }
    // Замкнутый контур (круг, прямоугольник, текст) режем точно: допуски
    // против микроосколков оставляли вершины в сотых мм от хорды, край
    // области выходил зубчатым — у отверстия появлялись «грани» по 0.2 мм²,
    // а стенка кармана — полоски с лишними рёбрами. Осколки на плоской грани
    // безвредны; одиночной линии допуски оставлены как были
    const SNAP = exact ? 1e-4 : 0.02, NEAR = exact ? 1e-4 : 0.04;
    // точка реза прилипает только к концам СВОЕГО ребра: прилипание к
    // противоположной вершине тонкого треугольника подворачивало осколок на
    // соседа — наложения ломали булевы (клинья и лишние линии у текста)
    const snapE = (P, i, j) => (P.distanceTo(V[i]) < SNAP ? V[i].clone()
      : (P.distanceTo(V[j]) < SNAP ? V[j].clone() : P));
    const isVert = P => { for(let i=0;i<3;i++) if(P.distanceTo(V[i]) < 1e-6) return i; return -1; };
    // середина линии реза должна лежать внутри отрезка хорды — иначе это
    // продолжение линии за её концом (режет дольки вдоль, до вала)
    const CT = exact ? 1e-4 : 0.05;
    const inChord = (t1,t2) => { const tm=(t1+t2)/2; return tm > -CT && tm < chordLen+CT; };
    // конец хорды внутри треугольника (угол полилинии): обычный рез тут
    // отбрасывается правилом середины и угол остаётся рваным — ставим
    // вершину в конце хорды и дорезаем веером вокруг неё
    if(!wholeLine){
      const nAbs=[Math.abs(n.x),Math.abs(n.y),Math.abs(n.z)];
      const dropAx = nAbs[0]>=nAbs[1]&&nAbs[0]>=nAbs[2] ? 0 : (nAbs[1]>=nAbs[2] ? 1 : 2);
      const to2e = p => dropAx===0 ? [p.y,p.z] : (dropAx===1 ? [p.x,p.z] : [p.x,p.y]);
      const t2 = V.map(to2e);
      const orr2=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
      const sgnT = Math.sign(orr2(t2[0],t2[1],t2[2])) || 1;
      const inside = p => { // строго внутри: до каждой стороны больше 0.1 мм
        for(let e2=0;e2<3;e2++){
          const a=t2[e2], b=t2[(e2+1)%3];
          const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
          if(orr2(a,b,p)*sgnT/L < (exact ? 1e-4 : 0.1)) return false;
        }
        return true;
      };
      // отрезок целиком внутри треугольника (короткий сегмент круга на
      // большой грани): веер вокруг A, затем в том осколке, где лежит B, —
      // веер вокруг B; ребро A-B появляется ровно по отрезку, без продлений
      if(inside(to2e(A)) && inside(to2e(B))){
        const b2 = to2e(B), fan = [];
        for(let e2=0;e2<3;e2++){
          const X = V[e2], Y = V[(e2+1)%3];
          const x2 = to2e(X), y2 = to2e(Y), a2 = to2e(A);
          const inXYA = orr2(x2,y2,b2)*sgnT >= 0 && orr2(y2,a2,b2)*sgnT >= 0 && orr2(a2,x2,b2)*sgnT >= 0;
          if(inXYA) fan.push([X.clone(), Y.clone(), B.clone()], [Y.clone(), A.clone(), B.clone()], [A.clone(), X.clone(), B.clone()]);
          else fan.push([X.clone(), Y.clone(), A.clone()]);
        }
        splitTris.set(ti, fan);
        continue;
      }
      let done = false;
      for(const E of [A, B]){
        if(!inside(to2e(E))) continue;
        // точка входа хорды: пересечение линии с границей внутри отрезка
        const cand = [];
        for(let e2=0;e2<3;e2++){
          const j2=(e2+1)%3;
          if(s[e2]===0){ cand.push({P:V[e2].clone(), edge:-1}); continue; }
          if(s[e2]*s[j2] < 0)
            cand.push({P:new THREE.Vector3().lerpVectors(V[e2],V[j2], d[e2]/(d[e2]-d[j2])), edge:e2});
        }
        const inRange = cand.filter(c=>{ const t=tOf(c.P); return t>-CT && t<chordLen+CT; });
        if(inRange.length !== 1) break;
        const P = inRange[0].edge >= 0 ? snapE(inRange[0].P, inRange[0].edge, (inRange[0].edge+1)%3) : inRange[0].P;
        if(P.distanceTo(E) < (exact ? 1e-4 : 0.1)) break; // хорда едва зацепила треугольник
        const edge = isVert(P) >= 0 ? -1 : inRange[0].edge;
        const fan = [];
        for(let e2=0;e2<3;e2++){
          const X=V[e2], Y=V[(e2+1)%3];
          if(edge === e2)
            fan.push([X.clone(), P.clone(), E.clone()], [P.clone(), Y.clone(), E.clone()]);
          else
            fan.push([X.clone(), Y.clone(), E.clone()]);
        }
        splitTris.set(ti, fan);
        if(edge >= 0) edgeCuts.set(ekey(V[edge], V[(edge+1)%3]), P.clone());
        done = true;
        break;
      }
      if(done) continue;
    }
    const zeroIdx = s.indexOf(0);
    if(zeroIdx >= 0){
      // вершина на линии, две другие по разные стороны
      const a0 = zeroIdx, b0 = (zeroIdx+1)%3, c0 = (zeroIdx+2)%3;
      // рез почти вдоль ребра даёт микроосколки — границей служит само ребро
      if(Math.min(Math.abs(d[b0]), Math.abs(d[c0])) < NEAR) continue;
      const P = snapE(new THREE.Vector3().lerpVectors(V[b0], V[c0], d[b0]/(d[b0]-d[c0])), b0, c0);
      if(isVert(P) >= 0) continue; // рез совпал с существующим ребром
      if(!wholeLine && !inChord(tOf(V[a0]), tOf(P))) continue;
      splitTris.set(ti, [[V[a0].clone(), V[b0].clone(), P], [V[a0].clone(), P.clone(), V[c0].clone()]]);
      edgeCuts.set(ekey(V[b0], V[c0]), P.clone());
    } else {
      let a0 = 0;
      if(s[1] !== s[0] && s[1] !== s[2]) a0 = 1;
      else if(s[2] !== s[0] && s[2] !== s[1]) a0 = 2;
      const b0 = (a0+1)%3, c0 = (a0+2)%3;
      // рез, прижатый к вершине, оставил бы микроосколок
      if(Math.abs(d[a0]) < NEAR) continue;
      const Pab = snapE(new THREE.Vector3().lerpVectors(V[a0], V[b0], d[a0]/(d[a0]-d[b0])), a0, b0);
      const Pca = snapE(new THREE.Vector3().lerpVectors(V[c0], V[a0], d[c0]/(d[c0]-d[a0])), c0, a0);
      if(!wholeLine && !inChord(tOf(Pab), tOf(Pca))) continue;
      const va = isVert(Pab), vb = isVert(Pca);
      if(va >= 0 && vb >= 0) continue; // рез вдоль существующего ребра
      if(va >= 0){ // реальный рез только Pca: линия через вершину va
        if(va === a0) continue; // вырожденный случай
        splitTris.set(ti, [[V[va].clone(), V[c0].clone(), Pca],
                           [V[va].clone(), Pca.clone(), V[a0].clone()]]);
        edgeCuts.set(ekey(V[c0], V[a0]), Pca.clone());
      } else if(vb >= 0){ // реальный рез только Pab
        if(vb === a0) continue;
        splitTris.set(ti, [[V[a0].clone(), Pab, V[vb].clone()],
                           [Pab.clone(), V[b0].clone(), V[vb].clone()]]);
        edgeCuts.set(ekey(V[a0], V[b0]), Pab.clone());
      } else {
        splitTris.set(ti, [[V[a0].clone(), Pab, Pca],
                           [Pab.clone(), V[b0].clone(), V[c0].clone()],
                           [Pab.clone(), V[c0].clone(), Pca.clone()]]);
        edgeCuts.set(ekey(V[a0], V[b0]), Pab.clone());
        edgeCuts.set(ekey(V[c0], V[a0]), Pca.clone());
      }
    }
  }
  if(!splitTris.size) return;
  // фаза 2: собираем меш; у нерезаных соседей делим рёбра с точками реза
  // (иначе остаются Т-стыки — «полоски» ложных граничных рёбер)
  const out = [];
  const pushTri = (a,b,c) => {
    const ar = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b,a),
      new THREE.Vector3().subVectors(c,a)).length();
    if(ar < 1e-6) return;
    out.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
  };
  for(let ti=0; ti<triCount; ti++){
    const o = ti*9;
    if(splitTris.has(ti)){
      for(const st of splitTris.get(ti)) pushTri(st[0], st[1], st[2]);
      continue;
    }
    for(let k=0;k<3;k++) V[k].fromArray(posArr, o+k*3);
    const sub = [[V[0].clone(), V[1].clone(), V[2].clone()]];
    let again = true;
    while(again){
      again = false;
      for(let si=0; si<sub.length && !again; si++){
        const [a,b,c] = sub[si];
        const edges = [[a,b,c],[b,c,a],[c,a,b]]; // [X, Y, противоположная Z]
        for(let e=0; e<3; e++){
          const [X, Y, Z] = edges[e];
          const P = edgeCuts.get(ekey(X, Y));
          if(!P) continue;
          if(P.distanceTo(X)<1e-6 || P.distanceTo(Y)<1e-6) continue;
          sub.splice(si, 1, [X, P.clone(), Z], [P.clone(), Y, Z]);
          again = true;
          break;
        }
      }
    }
    if(sub.length === 1){
      for(let j=0;j<9;j++) out.push(posArr[o+j]);
    } else {
      for(const st of sub) pushTri(st[0], st[1], st[2]);
    }
  }
  // страховка: дубликаты С ОДИНАКОВЫМ обходом выкидываем; противоположные
  // ориентации — разные поверхности (низ грани + стенка), их не трогаем
  const seen = new Set();
  const ded = [];
  for(let i=0;i<out.length;i+=9){
    const k = [keyOf(out[i],out[i+1],out[i+2]), keyOf(out[i+3],out[i+4],out[i+5]),
               keyOf(out[i+6],out[i+7],out[i+8])];
    // циклическая нормализация: старт с минимального ключа, порядок сохраняем
    let m = 0;
    if(k[1] < k[m]) m = 1;
    if(k[2] < k[m]) m = 2;
    const ks = k[m] + '#' + k[(m+1)%3] + '#' + k[(m+2)%3];
    if(seen.has(ks)) continue;
    seen.add(ks);
    for(let j=0;j<9;j++) ded.push(out[i+j]);
  }
  setMeshFromArray(new Float32Array(ded));
}
// пересекаются ли 2D-отрезки ab и cd (строго, касание не считается)
function segCross2(a,b,c,d){
  const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const o1=o(a,b,c), o2=o(a,b,d), o3=o(c,d,a), o4=o(c,d,b);
  return ((o1>0)!==(o2>0)) && ((o3>0)!==(o4>0));
}
// контуры дырок: граничные рёбра (у которых один треугольник), развёрнутые
// задом наперёд — тогда залитая по ним грань смотрит наружу
function boundaryLoops(){
  const pos = mesh.geometry.attributes.position.array;
  const seen = new Map();
  for(let t=0;t<pos.length/9;t++){
    for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const a=new THREE.Vector3().fromArray(pos,o1), b=new THREE.Vector3().fromArray(pos,o2);
      const k1=keyOf(a.x,a.y,a.z), k2=keyOf(b.x,b.y,b.z);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      const r = seen.get(ek);
      if(r) r.n++;
      else seen.set(ek, {n:1, a, b, ka:k1, kb:k2});
    }
  }
  const nxt = new Map();
  for(const r of seen.values()) if(r.n===1) nxt.set(r.kb, {from:r.b, kTo:r.ka});
  const loops = [], used = new Set();
  for(const k0 of nxt.keys()){
    if(used.has(k0)) continue;
    const loop = []; let k = k0;
    while(true){
      const e = nxt.get(k);
      if(!e || used.has(k)) { break; }
      used.add(k);
      loop.push(e.from.clone());
      k = e.kTo;
      if(k === k0){ if(loop.length>=3) loops.push(loop); break; }
    }
  }
  return loops;
}
// уборка после выдавливания: вырожденные треугольники и «нулевые пары»
// (совпадающие треугольники противоположной ориентации — внутренние
// перегородки от выдавливания туда-обратно) удаляются
// Иглы после булевой: треугольники со сторонами вроде 0.046 × 2.5 × 2.5.
// Нормаль такой щепки — шум, поэтому её края рисуются лишними рёбрами и
// дробят длинное ребро на куски. Лечение — схлопывание короткого ребра
// (edge collapse, как в mesh decimation): его концы сливаются в один, а два
// треугольника при ребре вырождаются и выпадают. Схлопываем только там, где
// это не рвёт сетку: у концов ребра общих соседей должно быть ровно столько,
// сколько треугольников на ребре (link condition) — иначе получится
// немногообразный стык
function collapseShortEdges(pos, maxLen = 0.05, maxPasses = 6, maxDV = 0.02){
  const K = (x, y, z) => keyOf(x, y, z);
  let cur = pos;
  for(let pass = 0; pass < maxPasses; pass++){
    const nT = cur.length / 9;
    const keyAt = new Array(nT * 3), P = new Map();     // ключ -> точка
    for(let t = 0; t < nT; t++) for(let j = 0; j < 3; j++){
      const o = t*9 + j*3, k = K(cur[o], cur[o+1], cur[o+2]);
      keyAt[t*3 + j] = k;
      if(!P.has(k)) P.set(k, [cur[o], cur[o+1], cur[o+2]]);
    }
    // соседи вершины и треугольники ребра
    const nb = new Map(), edges = new Map();
    const add = (m, k, v) => { let s = m.get(k); if(!s) m.set(k, s = new Set()); s.add(v); };
    for(let t = 0; t < nT; t++) for(let e = 0; e < 3; e++){
      const a = keyAt[t*3 + e], b = keyAt[t*3 + (e+1)%3];
      if(a === b) continue;
      add(nb, a, b); add(nb, b, a);
      const ek = a < b ? a+'|'+b : b+'|'+a;
      add(edges, ek, t);
    }
    // треугольники при вершине — по ним считаем, на сколько сдвинется объём
    const triAt = new Map();
    for(let t = 0; t < nT; t++) for(let j = 0; j < 3; j++) add(triAt, keyAt[t*3 + j], t);
    const det = (p, q, r) => p[0]*(q[1]*r[2] - q[2]*r[1]) - p[1]*(q[0]*r[2] - q[2]*r[0]) + p[2]*(q[0]*r[1] - q[1]*r[0]);
    // объём, который уедет, если вершину A подтянуть к B (треугольники,
    // где A есть, а B нет — остальные вырождаются и выпадают)
    const moveVol = (a, b) => {
      const pa = P.get(a), pb = P.get(b);
      let dv = 0;
      for(const t of triAt.get(a) || []){
        const k = [keyAt[t*3], keyAt[t*3+1], keyAt[t*3+2]];
        // треугольники с обоими концами тоже считаем: после схлопывания у них
        // две вершины совпадают и объём обнуляется — формула это и даёт
        const i = k.indexOf(a), q = P.get(k[(i+1)%3]), r = P.get(k[(i+2)%3]);
        dv += (det(pb, q, r) - det(pa, q, r)) / 6;
      }
      return Math.abs(dv);
    };
    // Стягивание A → B не должно выворачивать уцелевшие треугольники при A:
    // у длинного узкого соседа (стенка Shell 1 × 69 мм) высота меньше
    // сдвига, и без проверки он переворачивался — плоский лоскут поверх
    // соседа (folded_edges), сетка замкнута и объём тот же, поэтому прежние
    // проверки tidySlivers его не видели. Сравниваем нормали до и после
    const collapseFlips = (a, b) => {
      const pa = P.get(a), pb = P.get(b);
      for(const t of triAt.get(a) || []){
        const k = [keyAt[t*3], keyAt[t*3+1], keyAt[t*3+2]];
        if(k.includes(b)) continue;                  // выродится и выпадет
        const i = k.indexOf(a), q = P.get(k[(i+1)%3]), r = P.get(k[(i+2)%3]);
        const nrm = (p0) => {
          const u = [q[0]-p0[0], q[1]-p0[1], q[2]-p0[2]], v = [r[0]-p0[0], r[1]-p0[1], r[2]-p0[2]];
          return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        };
        const n0 = nrm(pa), n1 = nrm(pb);
        const l0 = Math.hypot(...n0), l1 = Math.hypot(...n1);
        if(l0 < 2e-4) continue;                      // сам щепка (площадь < 1e-4 мм²) — её и убираем
        if(l1 < 1e-12) return true;                  // станет вырожденным, но не выпадет — Т-стык
        if((n0[0]*n1[0] + n0[1]*n1[1] + n0[2]*n1[2]) / (l0 * l1) < 0.5) return true;
        // форма не должна меняться: сдвиг A → B обязан лежать в плоскости
        // каждого треугольника при A (внутри плоской грани или вдоль прямого
        // излома). Порог объёма (maxDV) этого не ловил: вершину на стыке
        // цилиндра и конуса стягивало к соседней, излом становился ломаным,
        // и в редакторе вылезали отрезки на две грани (4.5 мм на Ø91.5)
        const off = ((pb[0]-pa[0])*n0[0] + (pb[1]-pa[1])*n0[1] + (pb[2]-pa[2])*n0[2]) / l0;
        if(Math.abs(off) > 0.002) return true;
      }
      return false;
    };
    // короткие рёбра по возрастанию длины; тянем ту вершину, от которой тело
    // почти не меняется (лишнюю точку на ребре — к углу, а не наоборот)
    const cand = [];
    for(const [ek, ts] of edges){
      const [a, b] = ek.split('|'), pa = P.get(a), pb = P.get(b);
      const L = Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]);
      if(L > maxLen) continue;
      const va = moveVol(a, b), vb = moveVol(b, a);
      const keepB = va <= vb;
      if(Math.min(va, vb) > maxDV) continue; // это не игла, а тонкая деталь (у неё сотни мм³)
      cand.push({a: keepB ? a : b, b: keepB ? b : a, L, ts});
    }
    if(!cand.length) break;
    cand.sort((x, y) => x.L - y.L);
    const map = new Map(), touched = new Set();
    for(const {a, b, ts} of cand){
      if(touched.has(a) || touched.has(b)) continue;
      // общие соседи = вершины напротив ребра, по одной на треугольник
      const na = nb.get(a), nbb = nb.get(b);
      let common = 0;
      for(const k of na) if(nbb.has(k)) common++;
      if(common !== ts.size) continue;              // иначе рвём сетку
      if(collapseFlips(a, b)) continue;             // иначе выворачиваем соседа
      map.set(a, b);
      touched.add(a); touched.add(b);
      for(const k of na) touched.add(k);
      for(const k of nbb) touched.add(k);
    }
    if(!map.size) break;
    const out = [];
    for(let t = 0; t < nT; t++){
      const k = [0, 1, 2].map(j => { const kk = keyAt[t*3 + j]; return map.get(kk) || kk; });
      if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; // выродился — выпал
      for(let j = 0; j < 3; j++){
        const p = P.get(k[j]);
        out.push(p[0], p[1], p[2]);
      }
    }
    cur = new Float32Array(out);
  }
  return cur;
}
// чистка после булевой: схлопываем микрорёбра, но откатываемся, если сетка
// перестала быть замкнутой или объём поплыл
// Щепка без короткой стороны — длинный узкий треугольник (5.5 × 0.004 мм),
// вершина которого лежит почти на его длинной стороне (Т-стык от булевой).
// Схлопывание коротких рёбер её не берёт, поэтому длинная сторона
// переворачивается (edge flip): щепка и сосед за длинной стороной (a b v) +
// (b a w) становятся (v a w) + (v w b). Вершина v лежит почти на ab, так что
// новые треугольники — почти в плоскости соседа: объём меняется на площадь ×
// высоту щепки (тысячные мм³). Переворот разрешён, если v проецируется внутрь
// ab, ребра v–w ещё нет (сетка остаётся многообразной), новые треугольники
// смотрят туда же, куда сосед, и оба толще щепки. За проход каждая вершина
// участвует в одном перевороте; проходы — пока есть что переворачивать
function flipNeedles(pos, hMax = 0.01, maxPasses = 12){
  let cur = pos;
  for(let pass = 0; pass < maxPasses; pass++){
    const nT = cur.length / 9, P = new Map(), T = new Array(nT);
    for(let t = 0; t < nT; t++){
      T[t] = [0, 1, 2].map(j => {
        const o = t*9 + j*3, k = keyOf(cur[o], cur[o+1], cur[o+2]);
        if(!P.has(k)) P.set(k, new THREE.Vector3(cur[o], cur[o+1], cur[o+2]));
        return k;
      });
    }
    const E = new Map();                       // направленное ребро a>b -> треугольник
    T.forEach((k, t) => { for(let j = 0; j < 3; j++) E.set(k[j] + '>' + k[(j+1)%3], t); });
    const cross = (a, b, c) => new THREE.Vector3().subVectors(P.get(b), P.get(a))
      .cross(new THREE.Vector3().subVectors(P.get(c), P.get(a)));
    const longest = k => {
      let best = null;
      for(let j = 0; j < 3; j++){
        const a = k[j], b = k[(j+1)%3], L = P.get(a).distanceTo(P.get(b));
        if(!best || L > best.L) best = {a, b, v: k[(j+2)%3], L};
      }
      best.h = cross(best.a, best.b, best.v).length() / best.L;
      return best;
    };
    const cand = [];
    T.forEach((k, t) => {
      if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) return;
      const c = longest(k);
      if(c.h < hMax) cand.push(Object.assign(c, {t}));
    });
    if(!cand.length) break;
    cand.sort((x, y) => x.h - y.h);
    const gone = new Set(), busy = new Set(), add = [];
    for(const c of cand){
      if(gone.has(c.t) || busy.has(c.a) || busy.has(c.b) || busy.has(c.v)) continue;
      const A = P.get(c.a), ab = new THREE.Vector3().subVectors(P.get(c.b), A);
      const s = new THREE.Vector3().subVectors(P.get(c.v), A).dot(ab) / ab.lengthSq();
      if(!(s > 1e-4 && s < 1 - 1e-4)) continue;
      const u = E.get(c.b + '>' + c.a);
      if(u === undefined || gone.has(u)) continue;
      const w = T[u].find(x => x !== c.a && x !== c.b);
      if(!w || w === c.v || busy.has(w) || E.has(c.v + '>' + w) || E.has(w + '>' + c.v)) continue;
      const nu = cross(c.b, c.a, w);
      if(nu.lengthSq() < 1e-18) continue;
      if(cross(c.v, c.a, w).dot(nu) <= 0 || cross(c.v, w, c.b).dot(nu) <= 0) continue;
      if(Math.min(longest([c.v, c.a, w]).h, longest([c.v, w, c.b]).h) <= c.h) continue;
      gone.add(c.t); gone.add(u);
      for(const x of [c.a, c.b, c.v, w]) busy.add(x);
      add.push([c.v, c.a, w], [c.v, w, c.b]);
    }
    if(!add.length) break;
    const out = new Float32Array((nT - gone.size + add.length) * 9);
    let o = 0;
    const put = k => { for(const kk of k){ const p = P.get(kk); out[o++] = p.x; out[o++] = p.y; out[o++] = p.z; } };
    T.forEach((k, t) => { if(!gone.has(t)) put(k); });
    for(const k of add) put(k);
    cur = out;
  }
  return cur;
}
// Ребро в 1 мкм, которое не схлопнуть: у его концов есть «третий общий сосед»,
// и схлопывание отклоняется как опасное (порвало бы сетку). Но такое ребро
// короче шага ключа вершин (0.001 мм) — концы просто свариваются, а
// выродившиеся и задвоившиеся треугольники выпадают. Союз-поиск: микрорёбра
// могут идти цепочкой
function weldTinyEdges(pos, maxLen = 0.01){
  const nT = pos.length / 9, keyAt = new Array(nT * 3), P = new Map();
  for(let t = 0; t < nT; t++) for(let j = 0; j < 3; j++){
    const o = t*9 + j*3, k = keyOf(pos[o], pos[o+1], pos[o+2]);
    keyAt[t*3 + j] = k;
    if(!P.has(k)) P.set(k, [pos[o], pos[o+1], pos[o+2]]);
  }
  const par = new Map();
  const find = k => { while(par.get(k) !== k){ par.set(k, par.get(par.get(k))); k = par.get(k); } return k; };
  for(const k of P.keys()) par.set(k, k);
  let welds = 0;
  for(let t = 0; t < nT; t++) for(let e = 0; e < 3; e++){
    const a = keyAt[t*3 + e], b = keyAt[t*3 + (e+1)%3];
    if(a === b) continue;
    const pa = P.get(a), pb = P.get(b);
    if(Math.hypot(pa[0]-pb[0], pa[1]-pb[1], pa[2]-pb[2]) > maxLen) continue;
    const ra = find(a), rb = find(b);
    if(ra !== rb){ par.set(ra, rb); welds++; }
  }
  if(!welds) return pos;
  const out = [];
  for(let t = 0; t < nT; t++){
    const k = [0, 1, 2].map(j => find(keyAt[t*3 + j]));
    if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    for(const kk of k){ const p = P.get(kk); out.push(p[0], p[1], p[2]); }
  }
  return new Float32Array(out);
}
function tidySlivers(maxLen = 0.05){
  const before = mesh.geometry.attributes.position.array;
  const keep = before.slice(), nBefore = before.length;
  // отправная точка: сетка могла прийти уже с дефектами (врезка контура
  // текста оставляет их сотнями). Требовать после чистки идеала нельзя —
  // тогда она отказывается работать именно там, где нужнее всего. Условие:
  // не стало хуже, чем было
  // считаем дефекты вместе: сварка меняет немногообразное ребро на открытое
  // (5 -> 3) — это улучшение, а подсчёт по каждому виду отдельно отвергал его
  const bad0 = openEdgeCount() + nonManifoldEdgeCount();
  const worse = () => openEdgeCount() + nonManifoldEdgeCount() > bad0;
  // 1) сварка микрорёбер. Объём здесь не проверяем: вершины двигаются не
  // дальше 0.01 мм (меньше шага ключа), и на большой грани это законно даёт
  // заметные в мм³ доли. Требуем только, чтобы сетка осталась замкнутой
  let base = before;
  const welded = weldTinyEdges(before);
  if(welded !== before){
    setMeshFromArray(welded);
    cleanupMesh();
    if(worse()) setMeshFromArray(keep);
    base = mesh.geometry.attributes.position.array;
  }
  // 2) схлопывание коротких рёбер и переворот щепок — эти правки объём
  // менять не должны. Одного прохода мало: щепки стоят цепочками, и соседняя
  // становится схлопываемой только после того, как ушла первая — на плитке со
  // скруглёнными углами и надписью 14288 -> 3526 -> 408 -> 6
  const v0 = meshVolumeOf(base);
  // допуск по объёму — доля от размера детали. Схлопывание двигает вершину не
  // дальше maxLen, но объём меняют не убранные щепки (они плоские), а соседние
  // настоящие треугольники, так что ни число щепок, ни их площадь сдвиг не
  // ограничивают — ограничивает размер детали. Замеры: плитка 213×23×0.8 с
  // надписью — 0.34 мм³ на 5188 (0.007 %), она же толщиной 5 — 2.13 на 25703
  // (0.008 %). Прежние 1e-6 откатывали чистку целиком; 5e-4 их пропускает и
  // всё ещё ловит потерю канавки (565 мм³ на колесе Ø140 против порога 70)
  const tol = Math.max(0.05, Math.abs(v0) * 5e-4);
  let lastGood = base.slice();
  for(let pass = 0; pass < 6; pass++){
    const cur = mesh.geometry.attributes.position.array;
    const out = flipNeedles(collapseShortEdges(cur, maxLen));
    if(out === cur) break;
    setMeshFromArray(out);
    cleanupMesh();
    const now = mesh.geometry.attributes.position.array;
    if(worse() || Math.abs(meshVolumeOf(now) - v0) > tol){
      setMeshFromArray(lastGood);
      break;
    }
    lastGood = now.slice();
  }
  const pos = mesh.geometry.attributes.position.array;
  return pos.length === nBefore ? 0 : Math.max(1, (nBefore - pos.length) / 9);
}
function cleanupMesh(){
  const pos = mesh.geometry.attributes.position.array;
  const nT = pos.length/9;
  const drop = new Uint8Array(nT);
  const byKeys = new Map();
  for(let t=0;t<nT;t++){
    const o=t*9;
    const k = [keyOf(pos[o],pos[o+1],pos[o+2]),
               keyOf(pos[o+3],pos[o+4],pos[o+5]),
               keyOf(pos[o+6],pos[o+7],pos[o+8])];
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    const ar = Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx);
    if(ar < 1e-6 || k[0]===k[1] || k[1]===k[2] || k[0]===k[2]){ drop[t]=1; continue; }
    const sk = [...k].sort().join('#');
    let a = byKeys.get(sk); if(!a){ a=[]; byKeys.set(sk, a); }
    a.push({t, k});
  }
  const opposite = (a,b)=>{ // b — та же тройка в обратном обходе?
    const r = [b[2],b[1],b[0]];
    for(let s=0;s<3;s++)
      if(r[s]===a[0] && r[(s+1)%3]===a[1] && r[(s+2)%3]===a[2]) return true;
    return false;
  };
  for(const a of byKeys.values()){
    if(a.length < 2) continue;
    for(let i=0;i<a.length;i++){
      if(drop[a[i].t]) continue;
      for(let j=i+1;j<a.length;j++){
        if(drop[a[j].t]) continue;
        if(opposite(a[i].k, a[j].k)){ drop[a[i].t]=1; drop[a[j].t]=1; break; }
      }
    }
  }
  let removed = 0; for(const d of drop) removed += d;
  if(!removed) return;
  const out = new Float32Array(pos.length - removed*9);
  let o = 0;
  for(let t=0;t<nT;t++){
    if(drop[t]) continue;
    for(let j=0;j<9;j++) out[o++] = pos[t*9+j];
  }
  setMeshFromArray(out);
}
// «Заживление» перекрытий: стенка кармана, легшая в плоскость соседней
// грани, аннигилирует с её материалом — грань подрезается, как в SketchUp.
// Фаза 1: в плоскостях, где есть обе ориентации, врезаем рёбра друг в друга;
// фаза 2: треугольник, чей центроид накрыт противоположным копланарным,
// удаляется (с обеих сторон пары «материал—стенка»).
function healCoplanarOverlaps(){
  const planeGroups = () => {
    const pos = mesh.geometry.attributes.position.array;
    const groups = new Map();
    for(let t=0;t<pos.length/9;t++){
      const o=t*9;
      const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
      const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
      let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const L = Math.hypot(nx,ny,nz);
      if(L < 1e-6) continue;
      nx/=L; ny/=L; nz/=L;
      let orient = 1;
      if(nx < -1e-4 || (Math.abs(nx)<=1e-4 && (ny < -1e-4 || (Math.abs(ny)<=1e-4 && nz < 0)))){
        nx=-nx; ny=-ny; nz=-nz; orient = -1; // канонический знак нормали
      }
      const d = nx*pos[o] + ny*pos[o+1] + nz*pos[o+2];
      const key = Math.round(nx*200)+','+Math.round(ny*200)+','+Math.round(nz*200)+'|'+Math.round(d*20);
      let g = groups.get(key);
      if(!g){ g = {n:[nx,ny,nz], tris:[]}; groups.set(key, g); }
      g.tris.push({t, orient});
    }
    return groups;
  };
  { // фаза 1: взаимная врезка рёбер (splitMeshByChord пропустит нережущие)
    const pos = mesh.geometry.attributes.position.array;
    const segs = [];
    for(const g of planeGroups().values()){
      const pl = g.tris.filter(x=>x.orient>0), mn = g.tris.filter(x=>x.orient<0);
      if(!pl.length || !mn.length) continue;
      // режем крупную сторону рёбрами МЕНЬШЕЙ: у гладкой крышки колеса
      // тысячи треугольников, и врезка всех её рёбер (каждая — проход по
      // сетке) стоила бы минут. Вторгшаяся стенка всегда мала
      const seen = new Set();
      for(const {t} of (pl.length <= mn.length ? pl : mn)){
        for(let e=0;e<3;e++){
          const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
          const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
          const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
          if(seen.has(ek)) continue;
          seen.add(ek);
          segs.push([new THREE.Vector3(pos[o1],pos[o1+1],pos[o1+2]),
                     new THREE.Vector3(pos[o2],pos[o2+1],pos[o2+2])]);
        }
      }
    }
    // предохранитель по времени: сотни врезок — уже не «заживление»
    if(segs.length <= 400) for(const s of segs) splitMeshByChord(s[0], s[1]);
  }
  { // фаза 2: аннигиляция накрытых треугольников
    const pos = mesh.geometry.attributes.position.array;
    const drop = new Uint8Array(pos.length/9);
    for(const g of planeGroups().values()){
      const pls = g.tris.filter(x=>x.orient>0), mns = g.tris.filter(x=>x.orient<0);
      if(!pls.length || !mns.length) continue;
      const N = new THREE.Vector3(g.n[0], g.n[1], g.n[2]);
      const U = (Math.abs(N.z)<0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0))
        .cross(N).normalize();
      const V = N.clone().cross(U);
      const p2 = i => [pos[i]*U.x+pos[i+1]*U.y+pos[i+2]*U.z,
                       pos[i]*V.x+pos[i+1]*V.y+pos[i+2]*V.z];
      const tri2 = t => [p2(t*9), p2(t*9+3), p2(t*9+6)];
      const cent = T => [(T[0][0]+T[1][0]+T[2][0])/3, (T[0][1]+T[1][1]+T[2][1])/3];
      const inTri = (p, T) => {
        const cr = (a,b)=> (b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]);
        const s1=cr(T[0],T[1]), s2=cr(T[1],T[2]), s3=cr(T[2],T[0]);
        return (s1>=-1e-6 && s2>=-1e-6 && s3>=-1e-6) || (s1<=1e-6 && s2<=1e-6 && s3<=1e-6);
      };
      if(pls.length * mns.length > 2e6) continue; // пара крупных плоскостей — мимо
      const P2 = pls.map(x=>({x, T:tri2(x.t)}));
      const M2 = mns.map(x=>({x, T:tri2(x.t)}));
      for(const a of P2){
        const c = cent(a.T);
        for(const b of M2) if(inTri(c, b.T)){ drop[a.x.t]=1; break; }
      }
      for(const b of M2){
        const c = cent(b.T);
        for(const a of P2) if(inTri(c, a.T)){ drop[b.x.t]=1; break; }
      }
    }
    let removed = 0; for(const d of drop) removed += d;
    if(removed){
      const out = new Float32Array(pos.length - removed*9);
      let o = 0;
      for(let t=0;t<pos.length/9;t++){
        if(drop[t]) continue;
        for(let j=0;j<9;j++) out[o++] = pos[t*9+j];
      }
      setMeshFromArray(out);
    }
  }
}
// Т-стыки после подрезки: цельное ребро с одной стороны против двух кусков
// с другой. Делим ребро по чужой вершине, пока сетка не сойдётся.
// За вызов — не больше 16 делений, порядок тот же, что у прежнего перебора:
// первое граничное ребро по порядку треугольников, на нём — вершина,
// встретившаяся в сетке раньше всех. Прежде каждое деление заново строило
// карты всей сетки, сверяло граничное ребро со ВСЕМИ вершинами и
// пересобирало геометрию (нормали): на фаске полки 0.7 с на вызов, а
// вызовов десятки. Теперь карты строятся раз, вершины ищутся по сетке
// корзин, а после деления перебор продолжается с того же треугольника:
// раньше по порядку нового граничного ребра не появляется (деление лишь
// убирает разделённое ребро и добавляет два куска на этом месте), а
// вершины не добавляются. Геометрия собирается один раз в конце
function healTJunctions(){
  const pos = mesh.geometry.attributes.position.array;
  const nT0 = pos.length / 9;
  // треугольники — смещения в буфере: исходные на своих местах, новые в хвосте
  const buf = new Float32Array(pos.length + 16 * 18);
  buf.set(pos);
  let bufLen = pos.length;
  const tris = new Array(nT0);
  for(let t=0;t<nT0;t++) tris[t] = t * 9;
  const vId = new Map(), vLast = [], vFirst = [];
  const cid = new Int32Array(buf.length / 3);
  for(let c=0;c<nT0*3;c++){
    const o = c * 3, k = keyOf(buf[o], buf[o+1], buf[o+2]);
    let id = vId.get(k);
    if(id === undefined){ id = vLast.length; vId.set(k, id); vLast.push(o); vFirst.push(c); }
    else vLast[id] = o;
    cid[c] = id;
  }
  const nV = vLast.length;
  const VX = new Float64Array(nV * 3); // координаты вершины — по последнему вхождению
  for(let i=0;i<nV;i++){ VX[i*3] = buf[vLast[i]]; VX[i*3+1] = buf[vLast[i]+1]; VX[i*3+2] = buf[vLast[i]+2]; }
  const ek = (i, j) => i < j ? i * nV + j : j * nV + i;
  const cnt = new Map();
  for(let t=0;t<nT0;t++) for(let e=0;e<3;e++){
    const k = ek(cid[t*3+e], cid[t*3+(e+1)%3]);
    cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  // корзины вершин
  const H = 1, grid = new Map(), gk = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  for(let i=0;i<nV;i++){
    const k = gk(Math.floor(VX[i*3] / H), Math.floor(VX[i*3+1] / H), Math.floor(VX[i*3+2] / H));
    let l = grid.get(k); if(!l) grid.set(k, l = []); l.push(i);
  }
  const candOn = (A, B, i1, i2) => {
    const abx = B[0]-A[0], aby = B[1]-A[1], abz = B[2]-A[2];
    const L2 = abx*abx + aby*aby + abz*abz;
    if(L2 < 1e-9) return -1;
    const R = 0.011;
    const x0 = Math.floor((Math.min(A[0], B[0]) - R) / H), x1 = Math.floor((Math.max(A[0], B[0]) + R) / H);
    const y0 = Math.floor((Math.min(A[1], B[1]) - R) / H), y1 = Math.floor((Math.max(A[1], B[1]) + R) / H);
    const z0 = Math.floor((Math.min(A[2], B[2]) - R) / H), z1 = Math.floor((Math.max(A[2], B[2]) + R) / H);
    const test = i => {
      if(i === i1 || i === i2) return false;
      const vx = VX[i*3], vy = VX[i*3+1], vz = VX[i*3+2];
      const tp = ((vx-A[0])*abx + (vy-A[1])*aby + (vz-A[2])*abz) / L2;
      if(tp <= 1e-3 || tp >= 1-1e-3) return false;
      const qx = A[0]+abx*tp, qy = A[1]+aby*tp, qz = A[2]+abz*tp;
      return Math.hypot(vx-qx, vy-qy, vz-qz) <= 0.01;
    };
    let best = -1;
    const take = i => { if(test(i) && (best < 0 || vFirst[i] < vFirst[best])) best = i; };
    if((x1-x0+1) * (y1-y0+1) * (z1-z0+1) > 4096){ for(let i=0;i<nV;i++) take(i); }
    else {
      const seen = new Set();
      for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) for(let z=z0;z<=z1;z++){
        const l = grid.get(gk(x, y, z));
        if(l) for(const i of l){ if(!seen.has(i)){ seen.add(i); take(i); } }
      }
    }
    return best;
  };
  // первое вхождение вершин в новом порядке: деление вставляет углы на место
  // треугольника, и вершина могла впервые встретиться раньше
  const refreshFirst = () => {
    vFirst.fill(Infinity);
    let c = 0;
    for(const o of tris){ for(let j=0;j<3;j++, c++){ const i = cid[o/3 + j]; if(c < vFirst[i]) vFirst[i] = c; } }
  };
  let splits = 0, t = 0;
  const A = [0, 0, 0], B = [0, 0, 0];
  while(splits < 16 && t < tris.length){
    let hit = null;
    for(; t < tris.length && !hit; t++){
      const o = tris[t], c0 = o / 3;
      for(let e=0;e<3;e++){
        const i1 = cid[c0+e], i2 = cid[c0+(e+1)%3];
        if(cnt.get(ek(i1, i2)) !== 1) continue; // только граничные
        const o1 = o + e*3, o2 = o + ((e+1)%3)*3;
        A[0] = buf[o1]; A[1] = buf[o1+1]; A[2] = buf[o1+2];
        B[0] = buf[o2]; B[1] = buf[o2+1]; B[2] = buf[o2+2];
        const v = candOn(A, B, i1, i2);
        if(v >= 0){ hit = {e, v}; break; }
      }
      if(hit) break;
    }
    if(!hit) break;
    // делим треугольник по точке на ребре
    const o = tris[t], c0 = o / 3, {e, v} = hit;
    const a = e, b = (e+1)%3, c = (e+2)%3;
    const ia = cid[c0+a], ib = cid[c0+b], ic = cid[c0+c];
    const Vc = k => [buf[o+k*3], buf[o+k*3+1], buf[o+k*3+2]];
    const vv = [VX[v*3], VX[v*3+1], VX[v*3+2]];
    const n1 = bufLen, n2 = bufLen + 9;
    buf.set([...Vc(a), ...vv, ...Vc(c), ...vv, ...Vc(b), ...Vc(c)], bufLen);
    bufLen += 18;
    cid[n1/3] = ia; cid[n1/3+1] = v; cid[n1/3+2] = ic;
    cid[n2/3] = v; cid[n2/3+1] = ib; cid[n2/3+2] = ic;
    for(const [x, y, d] of [[ia, ib, -1], [ib, ic, -1], [ic, ia, -1], [ia, v, 1], [v, ic, 1], [ic, ia, 1], [v, ib, 1], [ib, ic, 1], [ic, v, 1]]){
      const k = ek(x, y), n = (cnt.get(k) || 0) + d;
      if(n) cnt.set(k, n); else cnt.delete(k);
    }
    tris.splice(t, 1, n1, n2);
    splits++;
    refreshFirst();
  }
  if(!splits) return;
  const out = new Float32Array(tris.length * 9);
  for(let i=0;i<tris.length;i++) out.set(buf.subarray(tris[i], tris[i] + 9), i * 9);
  setMeshFromArray(out);
}
// «Антиматерия»: выдавливание, прошедшее сквозь тело в пустоту, оставляет
// замкнутые вывернутые наизнанку компоненты (грани смотрят внутрь, объём
// отрицательный — поэтому рёбра выбираются, а грани нет). Пустоту не
// вычитаем — такие оболочки удаляем целиком.
function removeInvertedShells(){
  const pos = mesh.geometry.attributes.position.array;
  const nT = pos.length/9;
  if(nT < 4) return;
  const parent = new Int32Array(nT);
  for(let i=0;i<nT;i++) parent[i]=i;
  const find = i => { while(parent[i]!==i){ parent[i]=parent[parent[i]]; i=parent[i]; } return i; };
  const eMap = new Map();
  for(let t=0;t<nT;t++) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    const prev = eMap.get(ek);
    if(prev !== undefined){
      let a=find(prev), b=find(t);
      if(a!==b) parent[a]=b;
    } else eMap.set(ek, t);
  }
  const vol = new Map(); // корень компоненты -> знаковый объём
  for(let t=0;t<nT;t++){
    const o=t*9, r=find(t);
    const v = (pos[o]  *(pos[o+4]*pos[o+8]-pos[o+5]*pos[o+7])
             - pos[o+1]*(pos[o+3]*pos[o+8]-pos[o+5]*pos[o+6])
             + pos[o+2]*(pos[o+3]*pos[o+7]-pos[o+4]*pos[o+6]))/6;
    vol.set(r, (vol.get(r)||0) + v);
  }
  const bad = new Set();
  for(const [r,v] of vol) if(v < -0.1) bad.add(r);
  if(!bad.size) return;
  // вычесть больше, чем есть тела — честный результат: пусто.
  // «Куб из антиматерии» (вычет -80 из тела в 40) удаляется целиком.
  const keep = [];
  for(let t=0;t<nT;t++)
    if(!bad.has(find(t))) for(let j=0;j<9;j++) keep.push(pos[t*9+j]);
  setMeshFromArray(new Float32Array(keep));
}
// Инструменты мыши (выдавливание, карман, текст, фаска, сдвиг ребра)
// сначала идут точным meshBoolean; BSP остаётся запасным путём — если
// входное тело не замкнуто, точный путь бросил ошибку или дал щели
function openEdgesOfTris(tris){
  const cnt = new Map();
  for(const t of tris){
    const k = t.map(v => keyOf(v.x, v.y, v.z));
    // выпадают только треугольники, схлопнутые ключом; игла нулевой площади с
    // тремя разными ключами держит рёбра соседей — её выброс и давал «щели»
    if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    for(let e=0;e<3;e++){ const a = k[e], b = k[(e+1)%3], ek = a < b ? a+'|'+b : b+'|'+a; cnt.set(ek, (cnt.get(ek)||0) + 1); }
  }
  let open = 0; for(const c of cnt.values()) if(c === 1) open++;
  return open;
}
// после булевой: лечилки (сварка, Т-стыки, трещины — секунды на крупной
// сетке) нужны, только если в сетке остались щели или рёбра с 3+ гранями;
// точный результат обычно чист — хватает чистки вырожденных треугольников
function healAfterBool(){
  cleanupMesh();
  if(openEdgeCount() === 0 && nonManifoldEdgeCount() === 0) return;
  healAll();
}
// useManifold — считать Manifold, если он включён (GEOM_BOOL_ENGINE) и
// загружен; отказал — meshBoolean. Чем посчитано — geomLastEngine
function exactBool(aTris, bTris, op, useManifold){
  try{
    if(!aTris.length || !bTris.length) return null;
    if(openEdgesOfTris(aTris) || openEdgesOfTris(bTris)) return null;
    let arr = null;
    geomLastEngine = 'exact';
    if(useManifold && GEOM_BOOL_ENGINE === 'manifold' && manifoldLib){
      arr = manifoldBooleanOrNull(aTris, bTris, op);
      if(arr) geomLastEngine = 'manifold';
    }
    if(!arr) arr = meshBoolean(aTris, bTris, op);
    const tris = [];
    for(let i=0;i<arr.length;i+=9)
      tris.push([new THREE.Vector3(arr[i],arr[i+1],arr[i+2]), new THREE.Vector3(arr[i+3],arr[i+4],arr[i+5]),
                 new THREE.Vector3(arr[i+6],arr[i+7],arr[i+8])]);
    if(openEdgesOfTris(tris)) return null;
    return tris;
  }catch(err){ console.warn('exact boolean failed, falling back to BSP:', err.message); return null; }
}
// ---------- точные булевы над замкнутыми сетками (без BSP) ----------
// BSP режет плоскостями одного тела всё другое: на гладком корпусе (тело
// вращения) и трубе носика объединение шло 40 с и оставляло сотни дыр.
// Здесь, как в Cork/libigl mesh boolean: считаются отрезки пересечения
// пар треугольников, каждый задетый треугольник перетриангулируется с этими
// отрезками как с рёбрами, куски классифицируются «внутри/снаружи» другого
// тела лучом — по одному на связную область между линиями пересечения.
// Точка «ребро × треугольник» считается один раз от концов ребра,
// упорядоченных по номеру, и кэшируется; все точки идут через общий пул с
// допуском, куда заранее положены вершины обоих тел, — у соседей по шву
// номер точки один и тот же. Вырожденные случаи, частые у симметричных
// построений: вершина или ребро в плоскости чужой грани, точка на чужом
// ребре (регистрируется на нём, иначе Т-стык), совпадающие грани (цилиндр
// стоит на грани куба) — у совпавших кусков своё правило, как в Fusion:
// при объединении встречные грани исчезают, попутные остаются одной
function meshBoolean(aTris, bTris, op){
  const EPS = 2e-5, f = Math.fround;
  // точки пересечения ближе POOL — одна точка: две точки в 2.2e-5 мм друг от
  // друга (чуть больше EPS, но в одном ключе редактора) давали щепку и
  // Т-стык, через который протекала классификация (4 конуса из одной точки
  // с неокруглённой осью: объём +1400 мм³). 5e-4 уже сливает лишнее
  const POOL = 2e-4;
  const P = [];
  // пул точек: пространственный хеш с допуском
  const cellS = POOL * 2, hash = new Map();
  const hk = (x, y, z) => x+','+y+','+z;
  const poolFind = X => {
    const cx = Math.floor(X.x / cellS), cy = Math.floor(X.y / cellS), cz = Math.floor(X.z / cellS);
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) for(let dz=-1;dz<=1;dz++){
      const L = hash.get(hk(cx+dx, cy+dy, cz+dz)); if(!L) continue;
      for(const id of L) if(P[id].distanceToSquared(X) < POOL*POOL) return id;
    }
    return -1;
  };
  // Точки ПЕРЕСЕЧЕНИЯ в одной ячейке ключа редактора (0.001 мм) — одна точка:
  // редактор сваривает вершины по ключу, и две такие точки дальше POOL друг от
  // друга после сварки давали щепки и Т-стыки (второй V-зубец шестерни:
  // результат замкнут бит в бит, а в редакторе — 15 щелей). Вершины самих
  // тел так не сливаем — это рождало немногообразные рёбра у цилиндров
  const keyId = new Map(), interKey = new Map();
  let pooling = false;
  const pool = X => {
    const f0 = poolFind(X); if(f0 >= 0) return f0;
    const kk = keyOf(X.x, X.y, X.z), same = interKey.get(kk);
    if(same !== undefined) return same;
    const id = P.length; P.push(X); if(pooling) interKey.set(kk, id);
    const k = hk(Math.floor(X.x / cellS), Math.floor(X.y / cellS), Math.floor(X.z / cellS));
    let L = hash.get(k); if(!L) hash.set(k, L = []); L.push(id);
    return id;
  };
  // вершины с одним ключом приложения (0.001 мм) — одна точка: сетка после
  // прошлых операций сварена по ключу, а позиции расходятся на доли микрона,
  // и без этого в точной топологии тела оставались щели (16 у отверстия Ø6)
  const index = tris => {
    const T = [];
    for(const t of tris){
      const ids = t.map(v => { const k = keyOf(v.x, v.y, v.z); let id = keyId.get(k);
        if(id === undefined){ id = pool(new THREE.Vector3(f(v.x), f(v.y), f(v.z))); keyId.set(k, id); } return id; });
      if(ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) T.push(ids);
    }
    return T;
  };
  const TA = index(aTris), TB = index(bTris);
  pooling = true;
  const plane = T => T.map(([i, j, k]) => {
    const n = new THREE.Vector3().subVectors(P[j], P[i]).cross(new THREE.Vector3().subVectors(P[k], P[i]));
    const len = n.length(); if(len > 0) n.multiplyScalar(1/len);
    return {n, d: n.dot(P[i]), ok: len > 1e-10};
  });
  const plA = plane(TA), plB = plane(TB);
  const boxOf = ([i, j, k]) => new THREE.Box3().setFromPoints([P[i], P[j], P[k]]).expandByScalar(EPS * 2);
  const bxA = TA.map(boxOf), bxB = TB.map(boxOf);
  const all = new THREE.Box3(); bxB.forEach(b => all.union(b));
  const sz = all.getSize(new THREE.Vector3());
  const cell = Math.max(1e-3, Math.cbrt(sz.x * sz.y * sz.z / Math.max(1, TB.length)) * 1.5, Math.max(sz.x, sz.y, sz.z) / 128);
  const cix = v => Math.floor(v / cell);
  const grid = new Map();
  bxB.forEach((b, t) => {
    for(let x=cix(b.min.x); x<=cix(b.max.x); x++) for(let y=cix(b.min.y); y<=cix(b.max.y); y++) for(let z=cix(b.min.z); z<=cix(b.max.z); z++){
      const k = x+','+y+','+z; let L = grid.get(k); if(!L) grid.set(k, L = []); L.push(t);
    }
  });
  const onEdge = new Map(); // "lo_hi" -> Set номеров точек на ребре
  const EKey = (i, j) => i < j ? i+'_'+j : j+'_'+i;
  const regEdge = (i, j, id) => { if(id === i || id === j) return; const k = EKey(i, j); let s = onEdge.get(k); if(!s) onEdge.set(k, s = new Set()); s.add(id); };
  const sgn = (v, pl) => { const d = pl.n.dot(P[v]) - pl.d; return d > EPS ? 1 : d < -EPS ? -1 : 0; };
  // где точка X в плоскости треугольника: снаружи / вершина k / ребро k / внутри
  const locate = (X, tri, n) => {
    let onE = -1;
    for(let e=0;e<3;e++){
      const A = P[tri[e]], B = P[tri[(e+1)%3]], ab = new THREE.Vector3().subVectors(B, A), L = ab.length();
      const c = ab.cross(new THREE.Vector3().subVectors(X, A)).dot(n) / L;
      if(c < -EPS) return {out: true};
      if(c < EPS) onE = onE < 0 ? e : onE;
    }
    for(let e=0;e<3;e++) if(P[tri[e]].distanceToSquared(X) < EPS*EPS) return {vertex: tri[e]};
    return onE >= 0 ? {edge: onE} : {};
  };
  // точка в треугольнике: к вершине — её номер; на ребре — зарегистрировать
  const attach = (id, tri, loc) => {
    if(loc.vertex !== undefined) return loc.vertex;
    if(loc.edge !== undefined) regEdge(tri[loc.edge], tri[(loc.edge+1)%3], id);
    return id;
  };
  const cacheET = new Map(), cacheEE = new Map();
  // пересечение двух рёбер в одной плоскости (нормаль n)
  const edgeEdge = (i, j, k, l, n) => {
    const key = EKey(i, j) < EKey(k, l) ? EKey(i, j)+'x'+EKey(k, l) : EKey(k, l)+'x'+EKey(i, j);
    const c = cacheEE.get(key); if(c !== undefined) return c;
    let res = -1;
    const [a, b] = i < j ? [i, j] : [j, i], [p, q] = k < l ? [k, l] : [l, k];
    const r = new THREE.Vector3().subVectors(P[b], P[a]), s = new THREE.Vector3().subVectors(P[q], P[p]);
    const den = r.clone().cross(s).dot(n);
    if(Math.abs(den) > 1e-12){
      const qp = new THREE.Vector3().subVectors(P[p], P[a]);
      const t = qp.clone().cross(s).dot(n) / den, u = qp.clone().cross(r).dot(n) / den;
      const tl = EPS / r.length(), ul = EPS / s.length();
      if(t > tl && t < 1 - tl && u > ul && u < 1 - ul){
        res = pool(P[a].clone().addScaledVector(r, t));
        regEdge(a, b, res); regEdge(p, q, res);
      }
    }
    cacheEE.set(key, res); return res;
  };
  // точки ребра (i, j) на треугольнике: 0, 1 или 2 (ребро лежит в плоскости)
  const edgeTri = (i, j, tri, pl, tag) => {
    const lo = Math.min(i, j), hi = Math.max(i, j), key = lo+'_'+hi+'_'+tag;
    const c = cacheET.get(key); if(c !== undefined) return c;
    const sl = sgn(lo, pl), sh = sgn(hi, pl);
    let res = [];
    if(sl !== 0 && sh !== 0 && sl !== sh){
      const dl = pl.n.dot(P[lo]) - pl.d, dh = pl.n.dot(P[hi]) - pl.d;
      const X = P[lo].clone().lerp(P[hi], dl / (dl - dh));
      const loc = locate(X, tri, pl.n);
      if(!loc.out){
        let id = loc.vertex !== undefined ? loc.vertex : pool(X);
        id = attach(id, tri, loc);
        regEdge(lo, hi, id);
        res = [id];
      }
    } else if(sl === 0 && sh !== 0 || sh === 0 && sl !== 0){
      const v = sl === 0 ? lo : hi, loc = locate(P[v], tri, pl.n);
      if(!loc.out) res = [attach(v, tri, loc)];
    } else if(sl === 0 && sh === 0){
      const pts = [];
      for(const v of [lo, hi]){ const loc = locate(P[v], tri, pl.n); if(!loc.out) pts.push(attach(v, tri, loc)); }
      for(let e=0;e<3;e++){ const id = edgeEdge(lo, hi, tri[e], tri[(e+1)%3], pl.n); if(id >= 0) pts.push(id); }
      const d = new THREE.Vector3().subVectors(P[hi], P[lo]);
      const u = [...new Set(pts)].sort((p, q) => new THREE.Vector3().subVectors(P[p], P[lo]).dot(d) - new THREE.Vector3().subVectors(P[q], P[lo]).dot(d));
      res = u.length >= 2 ? [u[0], u[u.length-1]] : u;
    }
    cacheET.set(key, res); return res;
  };
  const segA = new Map(), segB = new Map(), copA = new Map(), copB = new Map();
  const addTo = (M, t, s) => { let L = M.get(t); if(!L) M.set(t, L = []); L.push(s); };
  const stamp = new Int32Array(TB.length).fill(-1);
  let pairs = 0;
  TA.forEach((ta, a) => {
    if(!plA[a].ok) return;
    const b0 = bxA[a];
    if(!b0.intersectsBox(all)) return;
    for(let x=cix(b0.min.x); x<=cix(b0.max.x); x++) for(let y=cix(b0.min.y); y<=cix(b0.max.y); y++) for(let z=cix(b0.min.z); z<=cix(b0.max.z); z++){
      const L = grid.get(x+','+y+','+z); if(!L) continue;
      for(const b of L){
        if(stamp[b] === a || !plB[b].ok) continue;
        stamp[b] = a;
        if(!b0.intersectsBox(bxB[b])) continue;
        const tb = TB[b];
        const coplanar = tb.every(v => sgn(v, plA[a]) === 0) && ta.every(v => sgn(v, plB[b]) === 0);
        if(coplanar){
          let any = false;
          for(let e=0;e<3;e++){
            const s1 = edgeTri(tb[e], tb[(e+1)%3], ta, plA[a], 'a'+a); if(s1.length === 2){ addTo(segA, a, s1); any = true; }
            const s2 = edgeTri(ta[e], ta[(e+1)%3], tb, plB[b], 'b'+b); if(s2.length === 2){ addTo(segB, b, s2); any = true; }
            if(s1.length || s2.length) any = true;
          }
          if(any){ addTo(copA, a, b); addTo(copB, b, a); pairs++; }
          continue;
        }
        const pts = new Set();
        for(let e=0;e<3;e++){
          for(const id of edgeTri(ta[e], ta[(e+1)%3], tb, plB[b], 'b'+b)) pts.add(id);
          for(const id of edgeTri(tb[e], tb[(e+1)%3], ta, plA[a], 'a'+a)) pts.add(id);
        }
        if(pts.size < 2) continue;
        let arr = [...pts];
        if(arr.length > 2){
          let best = [arr[0], arr[1]], bd = -1;
          for(let i=0;i<arr.length;i++) for(let j=i+1;j<arr.length;j++){ const d = P[arr[i]].distanceToSquared(P[arr[j]]); if(d > bd){ bd = d; best = [arr[i], arr[j]]; } }
          arr = best;
        }
        addTo(segA, a, arr); addTo(segB, b, arr); pairs++;
      }
    }
  });
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  const dirs = [new THREE.Vector3(0.5773, 0.5774, 0.5775), new THREE.Vector3(-0.3141, 0.8192, -0.4794), new THREE.Vector3(0.7071, -0.1003, 0.7)].map(d => d.normalize());
  const inside = (pt, T) => {
    let votes = 0;
    for(const d of dirs){
      ray.set(pt, d); let c = 0;
      for(const [i, j, k] of T) if(ray.intersectTriangle(P[i], P[j], P[k], false, hit)) c++;
      if(c % 2) votes++;
    }
    return votes >= 2;
  };
  const shell = (T, flipIt) => T.flatMap(([i, j, k]) => (flipIt ? [i, k, j] : [i, j, k]).flatMap(v => [P[v].x, P[v].y, P[v].z]));
  if(!pairs){ // не касаются: куски B внутри A или врозь, либо A внутри B
    const cen = ([i, j, k]) => P[i].clone().add(P[j]).add(P[k]).multiplyScalar(1/3);
    if(TA.length && inside(cen(TA[0]), TB))
      return new Float32Array(op === 'union' ? shell(TB) : op === 'intersect' ? shell(TA) : []);
    const par = TB.map((_, i) => i), root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
    const byV = new Map();
    TB.forEach((t, i) => { for(const v of t){ const j = byV.get(v); if(j === undefined) byV.set(v, i); else { const r1 = root(i), r2 = root(j); if(r1 !== r2) par[r1] = r2; } } });
    const comps = new Map(); TB.forEach((t, i) => { const r = root(i); if(!comps.has(r)) comps.set(r, []); comps.get(r).push(t); });
    // пересечение начинается с пустоты: от A остаётся только то, что внутри B,
    // а этот путь — когда тела вообще не пересекаются гранями
    let out = op === 'intersect' ? [] : shell(TA);
    for(const c of comps.values()){
      const inA = inside(cen(c[0]), TA);
      if(op === 'union' && !inA) out = out.concat(shell(c));
      if(op === 'intersect' && inA) out = out.concat(shell(c));
      if(op === 'subtract' && inA) out = out.concat(shell(c, true));
    }
    return new Float32Array(out);
  }
  // перетриангуляция одного треугольника с отрезками
  const retri = (tri, pl, segs) => {
    const n = pl.n, ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : (Math.abs(n.y) > Math.abs(n.z) ? 1 : 2);
    const sg = [n.x, n.y, n.z][ax] >= 0 ? 1 : -1;
    const to2 = V => ax === 0 ? [V.y, sg * V.z] : ax === 1 ? [V.z, sg * V.x] : [V.x, sg * V.y];
    const loc = new Map(), X = [], G = [];
    // точка в углу треугольника (ключ редактора совпал с его вершиной, но
    // дальше допуска пула) — это сама вершина: иначе в одном месте две точки,
    // обход граней ломается и треугольник пропадает целиком (третья V-канавка
    // шестерни: 6.7 мм² стенки). Только свои углы: глобальная замена сливала
    // точку на ребре рядом с вершиной и давала немногообразное ребро. Бит в
    // бит с соседом из другого тела номера могут разойтись — редактор
    // сваривает по ключу, и по ключу сетка замкнута
    const cornerKey = new Map(tri.map(v => [keyOf(P[v].x, P[v].y, P[v].z), v]));
    const L = id => {
      const c = cornerKey.get(keyOf(P[id].x, P[id].y, P[id].z));
      if(c !== undefined) id = c;
      let l = loc.get(id); if(l === undefined){ l = X.length; X.push(to2(P[id])); G.push(id); loc.set(id, l); } return l;
    };
    const edges = new Set();
    const addE = (u, v) => { if(u !== v) edges.add(u < v ? u+'_'+v : v+'_'+u); };
    for(let e=0;e<3;e++){
      const i = tri[e], j = tri[(e+1)%3];
      const s = onEdge.get(EKey(i, j));
      const ds = new THREE.Vector3().subVectors(P[j], P[i]);
      const ch = [i, ...(s ? [...s].sort((p, q) => new THREE.Vector3().subVectors(P[p], P[i]).dot(ds) - new THREE.Vector3().subVectors(P[q], P[i]).dot(ds)) : []), j];
      for(let c=0;c+1<ch.length;c++) addE(L(ch[c]), L(ch[c+1]));
    }
    const segE = new Set(); // рёбра-линии пересечения (и их куски после деления)
    for(const [p, q] of segs){ const u = L(p), v = L(q); if(u !== v){ addE(u, v); segE.add(u < v ? u+'_'+v : v+'_'+u); } }
    // рёбра на одной прямой, наложенные друг на друга (длинное поверх двух
    // коротких — у дна букв), делятся точками, лежащими на них
    for(const e of [...edges]){
      const [u, v] = e.split('_').map(Number), A = X[u], B = X[v];
      const dx = B[0]-A[0], dy = B[1]-A[1], L2 = dx*dx + dy*dy;
      const mids = [];
      for(let w=0; w<X.length; w++){
        if(w === u || w === v) continue;
        const cx = dx*(X[w][1]-A[1]) - dy*(X[w][0]-A[0]);
        if(cx*cx > EPS*EPS * L2) continue;
        const t = ((X[w][0]-A[0])*dx + (X[w][1]-A[1])*dy) / L2;
        if(t > 1e-9 && t < 1 - 1e-9) mids.push([t, w]);
      }
      if(!mids.length) continue;
      edges.delete(e);
      mids.sort((a, b) => a[0] - b[0]);
      const ch = [u, ...mids.map(m => m[1]), v];
      for(let c=0;c+1<ch.length;c++){
        addE(ch[c], ch[c+1]);
        if(segE.has(e)) segE.add(ch[c] < ch[c+1] ? ch[c]+'_'+ch[c+1] : ch[c+1]+'_'+ch[c]);
      }
    }
    // Линия пересечения, легшая вдоль существующего ребра, делится его
    // промежуточными вершинами — границей между областями должны стать и
    // куски: иначе через них область «внутри» срастается с «снаружи» (клин
    // V-канавки во всю высоту грани шестерни не вырезался вовсе)
    for(const e of segE) if(edges.has(e)){ const [u, v] = e.split('_').map(Number); constrPieces.add(EKey(G[u], G[v])); }
    const nb = X.map(() => []);
    for(const e of edges){ const [u, v] = e.split('_').map(Number); nb[u].push(v); nb[v].push(u); }
    for(let changed = true; changed;){ // висячие рёбра мешают обходу граней
      changed = false;
      for(let v=0;v<X.length;v++) if(nb[v].length === 1){ const w = nb[v][0]; nb[w] = nb[w].filter(x => x !== v); nb[v] = []; changed = true; }
    }
    for(let v=0;v<X.length;v++) nb[v].sort((p, q) => Math.atan2(X[p][1]-X[v][1], X[p][0]-X[v][0]) - Math.atan2(X[q][1]-X[v][1], X[q][0]-X[v][0]));
    const used = new Set(), loops = [];
    for(let u=0;u<X.length;u++) for(const v of nb[u]){
      if(used.has(u+'>'+v)) continue;
      const loop = []; let a = u, b = v, guard = edges.size * 2 + 4;
      while(guard-- > 0 && !used.has(a+'>'+b)){
        used.add(a+'>'+b); loop.push(a);
        const lst = nb[b], idx = lst.indexOf(a);
        const c = lst[(idx - 1 + lst.length) % lst.length];
        a = b; b = c;
      }
      loops.push(loop);
    }
    const area = lp => { let s = 0; for(let i=0;i<lp.length;i++){ const p = X[lp[i]], q = X[lp[(i+1)%lp.length]]; s += p[0]*q[1] - q[0]*p[1]; } return s / 2; };
    const faces = [], holes = [];
    for(const lp of loops){ const A = area(lp); if(A > 1e-14) faces.push({lp, A, holes: []}); else if(A < -1e-14) holes.push({lp, A}); }
    holes.sort((p, q) => p.A - q.A); holes.shift(); // самый отрицательный — сам треугольник
    const pip = (pt, lp) => { let c = false;
      for(let i=0, j=lp.length-1; i<lp.length; j=i++){ const a = X[lp[i]], b = X[lp[j]];
        if((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0]-a[0]) * (pt[1]-a[1]) / (b[1]-a[1]) + a[0]) c = !c; }
      return c; };
    for(const h of holes){
      const p = X[h.lp[0]], q = X[h.lp[1]], dx = q[0]-p[0], dy = q[1]-p[1];
      const pt = [(p[0]+q[0])/2 - dy*1e-4, (p[1]+q[1])/2 + dx*1e-4];
      let host = null;
      for(const fc of faces) if(pip(pt, fc.lp) && (!host || fc.A < host.A)) host = fc;
      if(host) host.holes.push(h.lp);
    }
    const out = [];
    const segCross = (p1, p2, p3, p4) => {
      const d = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
      const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
      return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    };
    for(const fc of faces){
      const faceStart = out.length;
      let poly = fc.lp.slice();
      for(const h of fc.holes.sort((p, q) => Math.max(...q.map(v => X[v][0])) - Math.max(...p.map(v => X[v][0])))){
        let hi = 0; h.forEach((v, i) => { if(X[v][0] > X[h[hi]][0]) hi = i; });
        const hv = h[hi];
        const cand = poly.map((v, i) => i).sort((i, j) => (X[poly[i]][0]-X[hv][0])**2 + (X[poly[i]][1]-X[hv][1])**2 - (X[poly[j]][0]-X[hv][0])**2 - (X[poly[j]][1]-X[hv][1])**2);
        let oi = cand[0];
        const rings = [poly, ...fc.holes];
        // мост не должен пересекать рёбра и проходить через вершины (коллинеарные
        // рёбра отверстия на одной прямой с мостом segCross не видит)
        const onBridge = (A, B, w) => {
          const cx = (B[0]-A[0])*(w[1]-A[1]) - (B[1]-A[1])*(w[0]-A[0]);
          const L2 = (B[0]-A[0])**2 + (B[1]-A[1])**2;
          if(cx*cx > 1e-12 * L2) return false;
          const t = ((w[0]-A[0])*(B[0]-A[0]) + (w[1]-A[1])*(B[1]-A[1])) / L2;
          return t > 1e-9 && t < 1 - 1e-9;
        };
        for(const i of cand){
          let clear = true;
          for(const r of rings){
            for(let k=0;k<r.length && clear;k++){
              if(segCross(X[poly[i]], X[hv], X[r[k]], X[r[(k+1)%r.length]])) clear = false;
              else if(r[k] !== poly[i] && r[k] !== hv && onBridge(X[poly[i]], X[hv], X[r[k]])) clear = false;
            }
            if(!clear) break;
          }
          if(clear){ oi = i; break; }
        }
        poly = poly.slice(0, oi+1).concat(h.slice(hi), h.slice(0, hi), [hv, poly[oi]], poly.slice(oi+1));
      }
      const cr = (a, b, c) => (X[b][0]-X[a][0])*(X[c][1]-X[a][1]) - (X[b][1]-X[a][1])*(X[c][0]-X[a][0]);
      const idx = poly.slice();
      // Обход куска может прийти по часовой (после мостов к отверстиям или
      // когда грань смотрит против базиса): «отрезание ушей» ждёт обхода
      // против часовой, иначе ни один угол не подходит и кусок остаётся
      // необработанным — так падала булева на тонком четырёхугольнике.
      // Разворачиваем обход, а выходные треугольники возвращаем как были
      const cw = area(idx) < 0;
      if(cw) idx.reverse();
      const emit = (a, b, c) => out.push(cw ? [G[c], G[b], G[a]] : [G[a], G[b], G[c]]);
      const lid = new Map(); // глобальный номер → локальный (для проверки площадей)
      G.forEach((g, i) => { if(!lid.has(g)) lid.set(g, i); });
      const outStart = out.length;
      let guard = idx.length * idx.length + 10;
      while(idx.length > 3 && guard-- > 0){
        let cut = -1;
        // два прохода: сначала уши с допуском EPS (расстояния — у координат
        // из Float32 шум ~1e-6, и «ухо» из трёх точек на одной прямой давало
        // щепку и Т-стык), если таких нет — честно тонкие уши
        for(const tol of [EPS, 0]){
          for(let i=0;i<idx.length && cut < 0;i++){
            const a = idx[(i-1+idx.length)%idx.length], b = idx[i], c = idx[(i+1)%idx.length];
            const len = (p, q) => Math.hypot(X[q][0]-X[p][0], X[q][1]-X[p][1]) || 1;
            const lab = len(a, b), lbc = len(b, c), lca = len(c, a);
            if(cr(a, b, c) / lca <= (tol || 1e-12)) continue;
            let ok = true;
            for(const w of idx){ // точка на самой диагонали a–c тоже мешает: иначе Т-стык
              if(w === a || w === b || w === c) continue;
              if(cr(a, b, w) / lab > tol && cr(b, c, w) / lbc > tol && cr(c, a, w) / lca > -tol){ ok = false; break; }
            }
            if(ok) cut = i;
          }
          if(cut >= 0) break;
        }
        if(cut < 0) break;
        emit(idx[(cut-1+idx.length)%idx.length], idx[cut], idx[(cut+1)%idx.length]);
        idx.splice(cut, 1);
      }
      if(idx.length === 3) emit(idx[0], idx[1], idx[2]);
      else if(idx.length > 3){
        // застрял на щепке уже EPS (точки почти на одной прямой, любое ухо
        // перекрыто соседней точкой): веер — топологически замкнут, ширина
        // и так нулевая
        let per = 0; for(let i=0;i<idx.length;i++){ const p = X[idx[i]], q = X[idx[(i+1)%idx.length]]; per += Math.hypot(q[0]-p[0], q[1]-p[1]); }
        if(Math.abs(area(idx)) > EPS * per){
          // Застряли на настоящем куске: значит раньше срезали «ухо», которое
          // срезать было нельзя (допуск EPS), и остаток запутался. Раскладываем
          // ВЕСЬ кусок заново проверенным earcut из three — он держит и тонкие,
          // и невыпуклые контуры. Обход берём как у исходного куска
          const cont = poly.map(i => new THREE.Vector2(X[i][0], X[i][1]));
          const faces = THREE.ShapeUtils.triangulateShape(cont, []);
          if(!faces || !faces.length) throw new Error('could not triangulate an intersected triangle');
          out.length = outStart;
          const want = area(poly) >= 0 ? 1 : -1;
          for(const f of faces){
            const i0 = poly[f[0]], i1 = poly[f[1]], i2 = poly[f[2]];
            const cr2 = (X[i1][0]-X[i0][0])*(X[i2][1]-X[i0][1]) - (X[i1][1]-X[i0][1])*(X[i2][0]-X[i0][0]);
            out.push(cr2 * want >= 0 ? [G[i0], G[i1], G[i2]] : [G[i0], G[i2], G[i1]]);
          }
        }
        else for(let i=1;i+1<idx.length;i++) emit(idx[0], idx[i], idx[i+1]);
      }
      // Проверка: сумма площадей треугольников куска = площадь контура минус
      // отверстия. Мосты к нескольким отверстиям (буквы A и B в одной грани
      // куба) при иных положениях давали наложение — грань покрыта дважды,
      // после булевой 59 открытых и 27 немногообразных рёбер. Тогда кусок
      // раскладывается заново earcut'ом three с отверстиями
      if(fc.holes.length){
        const triA = t => { const [a, b, c] = t.map(g => X[lid.get(g)]);
          return Math.abs((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])) / 2; };
        let got = 0; for(let i=faceStart;i<out.length;i++) got += triA(out[i]);
        let want = Math.abs(fc.A); for(const h of fc.holes) want -= Math.abs(area(h));
        if(Math.abs(got - want) > 1e-9 + 1e-6 * Math.abs(fc.A)){
          const v2 = i => new THREE.Vector2(X[i][0], X[i][1]);
          const tri = THREE.ShapeUtils.triangulateShape(fc.lp.map(v2), fc.holes.map(h => h.map(v2)));
          if(tri && tri.length){
            const all = fc.lp.concat(...fc.holes), sg = area(fc.lp) >= 0 ? 1 : -1;
            out.length = faceStart;
            for(const f of tri){
              const i0 = all[f[0]], i1 = all[f[1]], i2 = all[f[2]];
              const c2 = (X[i1][0]-X[i0][0])*(X[i2][1]-X[i0][1]) - (X[i1][1]-X[i0][1])*(X[i2][0]-X[i0][0]);
              out.push(c2 * sg >= 0 ? [G[i0], G[i1], G[i2]] : [G[i0], G[i2], G[i1]]);
            }
          }
        }
      }
    }
    return out;
  };
  const frags = []; // {ids, side, parent}
  const constrPieces = new Set();
  const cut = (T, pl, segs, side) => T.forEach((t, i) => {
    const s = segs.get(i);
    const touched = s || t.some((v, e) => onEdge.has(EKey(v, t[(e+1)%3])));
    if(!touched){ frags.push({ids: t, side, parent: i}); return; }
    for(const fr of retri(t, pl[i], s || [])) frags.push({ids: fr, side, parent: i});
  });
  cut(TA, plA, segA, 0); cut(TB, plB, segB, 1);
  // совпавшие с чужой гранью куски: попутно (same) или встречно (opposite)
  const onState = frags.map(fr => {
    const cop = (fr.side === 0 ? copA : copB).get(fr.parent);
    if(!cop) return null;
    const [p, q, r] = fr.ids, c = P[p].clone().add(P[q]).add(P[r]).multiplyScalar(1/3);
    const myN = (fr.side === 0 ? plA : plB)[fr.parent].n;
    for(const o of cop){
      const T = fr.side === 0 ? TB : TA, pl = (fr.side === 0 ? plB : plA)[o];
      const loc = locate(c, T[o], pl.n);
      if(!loc.out) return pl.n.dot(myN) > 0 ? 'same' : 'opposite';
    }
    return null;
  });
  const constr = constrPieces;
  for(const M of [segA, segB]) for(const L of M.values()) for(const [p, q] of L) constr.add(EKey(p, q));
  const par = frags.map((_, i) => i);
  const root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
  const byEdge = new Map();
  frags.forEach((fr, i) => { if(onState[i]) return; for(let e=0;e<3;e++){
    const ek = EKey(fr.ids[e], fr.ids[(e+1)%3]);
    if(constr.has(ek)) continue;
    const k = fr.side + '#' + ek, j = byEdge.get(k);
    if(j === undefined) byEdge.set(k, i); else { const r1 = root(i), r2 = root(j); if(r1 !== r2) par[r1] = r2; }
  }});
  const comps = new Map();
  frags.forEach((fr, i) => { if(onState[i]) return; const r = root(i); if(!comps.has(r)) comps.set(r, []); comps.get(r).push(i); });
  const keep = new Array(frags.length).fill(false), flip = new Array(frags.length).fill(false);
  for(const list of comps.values()){
    let best = list[0], ba = -1;
    for(const i of list){ const [p, q, r] = frags[i].ids;
      const ar = new THREE.Vector3().subVectors(P[q], P[p]).cross(new THREE.Vector3().subVectors(P[r], P[p])).lengthSq();
      if(ar > ba){ ba = ar; best = i; } }
    const fr = frags[best], [p, q, r] = fr.ids;
    const inOther = inside(P[p].clone().add(P[q]).add(P[r]).multiplyScalar(1/3), fr.side === 0 ? TB : TA);
    let k, fl = false;
    // пересечение: от обоих тел остаётся то, что внутри другого, обход не
    // трогаем — так по двум видам чертежа получается тело, совпадающее с
    // каждым силуэтом (классический приём blueprint-моделирования)
    if(op === 'intersect') k = inOther;
    else if(op === 'union') k = !inOther;
    else { if(fr.side === 0) k = !inOther; else { k = inOther; fl = true; } }
    for(const i of list){ keep[i] = k; flip[i] = fl; }
  }
  frags.forEach((fr, i) => {
    const st = onState[i]; if(!st) return;
    // объединение: попутные — одна грань (от A), встречные — исчезают;
    // вычитание: грань A остаётся только там, где B подходит к ней встречно
    if(op === 'union' || op === 'intersect') keep[i] = st === 'same' && fr.side === 0;
    else keep[i] = st === 'opposite' && fr.side === 0;
  });
  const arr = [];
  frags.forEach((fr, i) => {
    if(!keep[i]) return;
    const [p, q, r] = flip[i] ? [fr.ids[0], fr.ids[2], fr.ids[1]] : fr.ids;
    for(const id of [p, q, r]) arr.push(P[id].x, P[id].y, P[id].z);
  });
  return new Float32Array(arr);
}
// дыры и рёбра на три грани в массиве вершин (как open/nonmanifold у get_state)
function meshHealthOf(pos){
  const cnt = new Map();
  for(let o=0;o<pos.length;o+=9){
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    if(Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) < 1e-6) continue;
    for(let e=0;e<3;e++){
      const o1 = o+e*3, o2 = o+((e+1)%3)*3;
      const k1 = keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2 = keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      if(k1 === k2) continue;
      const ek = k1 < k2 ? k1+'|'+k2 : k2+'|'+k1;
      cnt.set(ek, (cnt.get(ek) || 0) + 1);
    }
  }
  let open = 0, nm = 0;
  for(const c of cnt.values()){ if(c === 1) open++; else if(c > 2) nm++; }
  return {open, nm};
}
// полный цикл заживления до сходимости: одиночный прогон оставляет сотни
// Т-стыков, когда стенки новой экструзии скользят вдоль старых стенок
// (например, поднятые донья гравировки); healTJunctions чинит ≤16 за вызов
// Сварка вершин ближе eps. BSP выдаёт одну и ту же точку пересечения с
// разницей в один квант округления (0.001 мм): ключи вершин расходятся, и в
// сетке остаются щели (два скругления с общим углом давали 6 открытых рёбер)
function weldVertices(eps){
  const pos = mesh.geometry.attributes.position.array;
  const grid = new Map();
  const cellKey = (i, j, k) => i + ',' + j + ',' + k;
  let changed = false;
  for(let i=0;i<pos.length;i+=3){
    const x = pos[i], y = pos[i+1], z = pos[i+2];
    const ci = Math.floor(x/eps), cj = Math.floor(y/eps), ck = Math.floor(z/eps);
    let hit = null;
    for(let a=-1;a<=1 && !hit;a++) for(let b=-1;b<=1 && !hit;b++) for(let c=-1;c<=1 && !hit;c++){
      const arr = grid.get(cellKey(ci+a, cj+b, ck+c));
      if(!arr) continue;
      for(const r of arr)
        if(Math.abs(r[0]-x) <= eps && Math.abs(r[1]-y) <= eps && Math.abs(r[2]-z) <= eps){ hit = r; break; }
    }
    if(hit){
      if(hit[0] !== x || hit[1] !== y || hit[2] !== z){
        pos[i] = hit[0]; pos[i+1] = hit[1]; pos[i+2] = hit[2]; changed = true;
      }
    } else {
      const kk = cellKey(ci, cj, ck);
      let arr = grid.get(kk);
      if(!arr){ arr = []; grid.set(kk, arr); }
      arr.push([x, y, z]);
    }
  }
  if(changed) mesh.geometry.attributes.position.needsUpdate = true;
  return changed;
}
// Лишние вершины на прямых: BSP оставляет точки разрезов посреди прямых
// рёбер (стык скруглений), лечилка Т-стыков тянет к ним треугольники-иглы
// через всю грань. Короткая сторона иглы — сотые мм, и округление 0.001
// перекашивает её плоскость на градусы: грань распадается на треугольники
// с разной заливкой. Вершина, лежащая между двумя соседями на одной прямой,
// стягивается в ближайшего из них, если форма от этого не меняется: каждый
// её треугольник остаётся в своей плоскости и не выворачивается. Концы
// нарисованных линий и точки не трогаем — на них держатся области граней
function collapseCollinearVertices(){
  const TOL = 0.002;
  const protectedPts = [];
  for(const g of guides) protectedPts.push(g.a, g.b);
  for(const a of anchors) protectedPts.push(a.pos);
  // концы линий — по корзинам 0.02 мм: перебор всех концов на каждую вершину
  // (260 линий полки × 7 тысяч вершин) занимал почти всю чистку после фаски
  const PC = 0.02, pGrid = new Map(), pk = (x, y, z) => x + ',' + y + ',' + z;
  for(const P of protectedPts){
    const k = pk(Math.floor(P.x / PC), Math.floor(P.y / PC), Math.floor(P.z / PC));
    let l = pGrid.get(k); if(!l) pGrid.set(k, l = []); l.push(P);
  }
  const isProtected = v => {
    const x0 = Math.floor((v.x - 0.01) / PC), x1 = Math.floor((v.x + 0.01) / PC);
    const y0 = Math.floor((v.y - 0.01) / PC), y1 = Math.floor((v.y + 0.01) / PC);
    const z0 = Math.floor((v.z - 0.01) / PC), z1 = Math.floor((v.z + 0.01) / PC);
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) for(let z=z0;z<=z1;z++){
      const l = pGrid.get(pk(x, y, z));
      if(l && l.some(P => P.distanceToSquared(v) < 1e-4)) return true;
    }
    return false;
  };
  const V = (arr, o) => new THREE.Vector3(arr[o], arr[o+1], arr[o+2]);
  let total = 0;
  for(let pass=0; pass<20; pass++){
    const pos = mesh.geometry.attributes.position.array;
    const nT = pos.length/9;
    const verts = new Map(); // key -> {p, tris:[{t, j}]}
    for(let t=0;t<nT;t++) for(let j=0;j<3;j++){
      const o = t*9 + j*3;
      const k = keyOf(pos[o], pos[o+1], pos[o+2]);
      let e = verts.get(k);
      if(!e){ e = {p: V(pos, o), tris: []}; verts.set(k, e); }
      e.tris.push({t, j});
    }
    const touched = new Uint8Array(nT);
    let n = 0;
    for(const [vk, ve] of verts){
      if(ve.tris.some(r => touched[r.t])) continue;
      const v = ve.p;
      if(isProtected(v)) continue;
      // соседи
      const nb = new Map();
      for(const r of ve.tris) for(let j=0;j<3;j++){
        if(j === r.j) continue;
        const o = r.t*9 + j*3;
        const k = keyOf(pos[o], pos[o+1], pos[o+2]);
        if(!nb.has(k)) nb.set(k, verts.get(k).p);
      }
      const nbl = [...nb.entries()];
      // пара соседей, между которыми v лежит на прямой
      let bestU = null, bestD = null, bestLen = 0, uDist = Infinity;
      for(let i=0;i<nbl.length;i++) for(let m=i+1;m<nbl.length;m++){
        const A = nbl[i][1], B = nbl[m][1];
        const AB = new THREE.Vector3().subVectors(B, A);
        const L = AB.length();
        if(L < 1e-6) continue;
        const d = AB.clone().multiplyScalar(1/L);
        const s = new THREE.Vector3().subVectors(v, A).dot(d);
        if(s <= 1e-6 || s >= L - 1e-6) continue;
        const F = A.clone().addScaledVector(d, s);
        if(F.distanceTo(v) > TOL) continue;
        if(L > bestLen){ bestLen = L; bestD = d; }
        for(const [k, P] of [nbl[i], nbl[m]]){
          const dist = P.distanceTo(v);
          if(dist < uDist){ uDist = dist; bestU = k; }
        }
      }
      if(!bestU) continue;
      const u = nb.get(bestU), d = bestD;
      const onLine = X => {
        const w = new THREE.Vector3().subVectors(X, v);
        return w.addScaledVector(d, -w.dot(d)).length() < TOL;
      };
      let ok = true;
      for(const r of ve.tris){
        const o = r.t*9;
        const a = V(pos, o + ((r.j+1)%3)*3), b = V(pos, o + ((r.j+2)%3)*3);
        const ka = keyOf(a.x,a.y,a.z), kb = keyOf(b.x,b.y,b.z);
        if(ka === bestU || kb === bestU) continue; // треугольник на ребре v-u схлопнется
        if(!onLine(a) && !onLine(b)){
          // b должна лежать в плоскости, натянутой на прямую и точку a
          const nrm = new THREE.Vector3().subVectors(a, v).cross(d);
          const L = nrm.length();
          if(L < 1e-9 || Math.abs(new THREE.Vector3().subVectors(b, v).dot(nrm)) / L > TOL){ ok = false; break; }
        }
        // обход не должен вывернуться
        const nOld = new THREE.Vector3().subVectors(a, v).cross(new THREE.Vector3().subVectors(b, v));
        const nNew = new THREE.Vector3().subVectors(a, u).cross(new THREE.Vector3().subVectors(b, u));
        if(nNew.length() > 1e-6 && nOld.dot(nNew) <= 0){ ok = false; break; }
      }
      if(!ok) continue;
      for(const r of ve.tris){
        const o = r.t*9 + r.j*3;
        pos[o] = u.x; pos[o+1] = u.y; pos[o+2] = u.z;
        touched[r.t] = 1;
      }
      n++;
    }
    if(!n) break;
    total += n;
    mesh.geometry.attributes.position.needsUpdate = true;
    cleanupMesh();
  }
  return total;
}
// Щель-трещина от булевых: петля из нескольких почти коллинеарных точек на
// ребре (площадь ~0, периметр доли мм) — не дырка, а осколок. Закрываем
// веером (петли boundaryLoops уже развёрнуты наружу). Настоящие дыры не трогаем
function closeSliverHoles(){
  const loops = boundaryLoops().filter(L => {
    if(L.length > 8) return false;
    const ar = new THREE.Vector3();
    for(let i=1;i+1<L.length;i++) ar.add(new THREE.Vector3().subVectors(L[i], L[0]).cross(new THREE.Vector3().subVectors(L[i+1], L[0])));
    let per = 0;
    for(let i=0;i<L.length;i++) per += L[i].distanceTo(L[(i+1)%L.length]);
    return ar.length()/2 < 0.05 && per < 2;
  });
  if(!loops.length) return 0;
  const pos = mesh.geometry.attributes.position.array;
  const add = [];
  const merge = new Map(); // ключ вершины -> куда стянуть
  for(const L of loops){
    let per = 0;
    for(let i=0;i<L.length;i++) per += L[i].distanceTo(L[(i+1)%L.length]);
    // трещина в сотые мм из коллинеарных точек: треугольник нулевой площади
    // cleanupMesh выбросит — такие точки просто стягиваем в одну
    if(per < 0.05){ for(const P of L) merge.set(keyOf(P.x,P.y,P.z), L[0]); continue; }
    for(let i=1;i+1<L.length;i++)
      for(const P of [L[0], L[i], L[i+1]]) add.push(P.x, P.y, P.z);
  }
  if(merge.size) for(let i=0;i<pos.length;i+=3){
    const T = merge.get(keyOf(pos[i], pos[i+1], pos[i+2]));
    if(T){ pos[i] = T.x; pos[i+1] = T.y; pos[i+2] = T.z; }
  }
  const out = new Float32Array(pos.length + add.length);
  out.set(pos); out.set(add, pos.length);
  setMeshFromArray(out);
  return loops.length;
}
// Сварка только краёв трещин: вершины открытых рёбер (у ребра один
// треугольник), стоящие ближе eps друг к другу, сводятся в одну. Общая сварка
// 0.012 мм трогала и здоровые места (вырез 200–250° получал дыры)
function weldOpenVertices(eps){
  const pos = mesh.geometry.attributes.position.array, cnt = new Map(), ends = new Map();
  for(let o=0;o<pos.length;o+=9){
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    if(Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) < 1e-6) continue;
    for(let e=0;e<3;e++){
      const o1=o+e*3, o2=o+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      if(k1 === k2) continue;
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      cnt.set(ek, (cnt.get(ek)||0) + 1);
      ends.set(k1, [pos[o1],pos[o1+1],pos[o1+2]]); ends.set(k2, [pos[o2],pos[o2+1],pos[o2+2]]);
    }
  }
  const open = new Map(); // ключ -> позиция
  for(const [ek, c] of cnt){ if(c !== 1) continue; for(const k of ek.split('|')) open.set(k, ends.get(k)); }
  if(open.size < 2) return 0;
  const grid = new Map(), target = new Map();
  const cell = (x,y,z) => Math.floor(x/eps)+','+Math.floor(y/eps)+','+Math.floor(z/eps);
  for(const [k, p] of open){
    let hit = null;
    const ci = Math.floor(p[0]/eps), cj = Math.floor(p[1]/eps), ck = Math.floor(p[2]/eps);
    for(let a=-1;a<=1 && !hit;a++) for(let b=-1;b<=1 && !hit;b++) for(let c=-1;c<=1 && !hit;c++){
      for(const r of grid.get((ci+a)+','+(cj+b)+','+(ck+c)) || [])
        if(Math.abs(r[0]-p[0]) <= eps && Math.abs(r[1]-p[1]) <= eps && Math.abs(r[2]-p[2]) <= eps){ hit = r; break; }
    }
    if(hit){ target.set(k, hit); continue; }
    const cc = cell(p[0], p[1], p[2]);
    let arr = grid.get(cc); if(!arr){ arr = []; grid.set(cc, arr); }
    arr.push(p);
  }
  if(!target.size) return 0;
  for(let i=0;i<pos.length;i+=3){
    const T = target.get(keyOf(pos[i], pos[i+1], pos[i+2]));
    if(T){ pos[i] = T[0]; pos[i+1] = T[1]; pos[i+2] = T[2]; }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  return target.size;
}
// рёбра с одним треугольником — по тем же ключам, по которым рисуются рёбра
function openEdgeCount(){
  const pos = mesh.geometry.attributes.position.array, cnt = new Map();
  for(let o=0;o<pos.length;o+=9){
    // вырожденный треугольник (площадь 0) — не грань, как в extractEdges
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    if(Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) < 1e-6) continue;
    for(let e=0;e<3;e++){
    const o1=o+e*3, o2=o+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    if(k1 === k2) continue;
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    cnt.set(ek, (cnt.get(ek)||0) + 1);
    }
  }
  let n = 0; for(const c of cnt.values()) if(c === 1) n++;
  return n;
}
// Лоскут-игла, прилипший к ребру: треугольник нулевой высоты, чья длинная
// сторона — ребро, у которого уже три треугольника, а две короткие — ничьи.
// Его рёбра рисовались обрывками у выреза. Лишний треугольник выбрасываем
function dropFlapSlivers(){
  const pos = mesh.geometry.attributes.position.array, nT = pos.length/9;
  const key = (o) => keyOf(pos[o], pos[o+1], pos[o+2]);
  const ek = (a, b) => a < b ? a+'|'+b : b+'|'+a;
  const cnt = new Map();
  for(let t=0;t<nT;t++) for(let e=0;e<3;e++){
    const k = ek(key(t*9+e*3), key(t*9+((e+1)%3)*3));
    cnt.set(k, (cnt.get(k)||0) + 1);
  }
  const keep = [];
  let dropped = 0;
  for(let t=0;t<nT;t++){
    const o = t*9;
    const P = j => new THREE.Vector3(pos[o+j*3], pos[o+j*3+1], pos[o+j*3+2]);
    let e0 = 0, Lm = -1;
    for(let e=0;e<3;e++){ const L = P(e).distanceTo(P((e+1)%3)); if(L > Lm){ Lm = L; e0 = e; } }
    const h = Lm > 1e-9 ? new THREE.Vector3().subVectors(P(1), P(0)).cross(new THREE.Vector3().subVectors(P(2), P(0))).length() / Lm : 0;
    const kL = ek(key(o+e0*3), key(o+((e0+1)%3)*3));
    const k1 = ek(key(o+((e0+1)%3)*3), key(o+((e0+2)%3)*3)), k2 = ek(key(o+((e0+2)%3)*3), key(o+e0*3));
    if(h < 0.02 && cnt.get(kL) >= 3 && cnt.get(k1) === 1 && cnt.get(k2) === 1){ dropped++; continue; }
    for(let j=0;j<9;j++) keep.push(pos[o+j]);
  }
  if(dropped) setMeshFromArray(new Float32Array(keep));
  return dropped;
}
function healAll(){
  weldVertices(0.0015); // полтора кванта: сшивает только «расщеплённые» точки
  cleanupMesh();
  healCoplanarOverlaps(); // самый дорогой проход — ровно один раз
  // Т-стыки: healTJunctions чинит ≤16 за вызов. Потолок 40 проходов (640
  // стыков) не хватал на вырез сразу нескольких областей (шесть сегментов
  // обода — 108 дыр оставалось); цикл и так выходит, когда сетка сошлась
  for(let i=0;i<250;i++){
    const len0 = mesh.geometry.attributes.position.array.length;
    cleanupMesh(); healTJunctions();
    if(mesh.geometry.attributes.position.array.length === len0) break;
  }
  healCracks();
  removeInvertedShells();
}
// Добивка после сшивки Т-стыков (общая для healAll и гравировки текста)
function healCracks(){
  // Трещины вдоль рёбер: точки пересечения у соседних граней после булевых
  // расходятся на сотые мм (65.59 и 65.60), обе стороны ребра остаются
  // «граничными» — рёбра рисовались обрывками линий вокруг выреза. Если после
  // сшивки такие остались — сварка крупнее (0.012 мм, на порядок мельче шага
  // 0.1) и досшивка. Только при трещинах: сварка «на всякий случай» ломала
  // здоровый вырез (у хорды 20–60° появлялись дыры)
  if(openEdgeCount() > 0 && weldOpenVertices(0.012)){
    for(let i=0;i<250;i++){
      const len0 = mesh.geometry.attributes.position.array.length;
      cleanupMesh(); healTJunctions();
      if(mesh.geometry.attributes.position.array.length === len0) break;
    }
  }
  if(dropFlapSlivers()) cleanupMesh();
  // соседние щели влияют друг на друга (закрыли одну — другая сменила
  // обход), поэтому несколько проходов до исчезновения
  for(let i=0;i<4 && closeSliverHoles();i++) cleanupMesh();
}
// знаковый объём меша по массиву позиций (дивергентная формула)
function meshVolumeOf(arr){
  let v = 0;
  for(let i=0;i<arr.length;i+=9)
    v += (arr[i]   * (arr[i+4]*arr[i+8] - arr[i+5]*arr[i+7])
        - arr[i+1] * (arr[i+3]*arr[i+8] - arr[i+5]*arr[i+6])
        + arr[i+2] * (arr[i+3]*arr[i+7] - arr[i+4]*arr[i+6])) / 6;
  return v;
}
// рёбра, на которых сходятся больше двух треугольников (касание углом, как
// у диагоналей пиксельного шрифта): тело замкнуто, но не «многообразно» —
// для печати такое место неоднозначно
function nonManifoldEdgeCount(){
  const pos = mesh.geometry.attributes.position.array, cnt = new Map();
  for(let o=0;o<pos.length;o+=9) for(let e=0;e<3;e++){
    const o1=o+e*3, o2=o+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    if(k1 === k2) continue;
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    cnt.set(ek, (cnt.get(ek)||0) + 1);
  }
  let n = 0; for(const c of cnt.values()) if(c > 2) n++;
  return n;
}
// Загиб на Т-стыке: вершина r соседа u лежит на ребре x–y треугольника t,
// а u и t — через общее ребро a–b — смотрят в разные стороны и накрывают
// друг друга (u = кусок t, вывернутый наизнанку). Сетка замкнута, но
// folded_edges > 0 — так бывало на краю полосы накатки на стенке колпака
// (треугольнички 0.04 мм). Ремонт: t режем в точке r на два; тот, что
// совпадает с u обратным обходом, выпадает вместе с u; соседа w через
// ребро x–y тоже режем в r — стык честный, сетка остаётся замкнутой.
// Только щепки (площадь u < 0.05 мм²); за проход — непересекающиеся пары
function repairFoldPairs(pos, maxPasses = 4){
  let cur = pos;
  for(let pass = 0; pass < maxPasses; pass++){
    const nT = cur.length / 9, P = new Map(), T = [];
    for(let t = 0; t < nT; t++){
      const k = [];
      for(let j = 0; j < 3; j++){
        const o = t*9 + j*3, kk = keyOf(cur[o], cur[o+1], cur[o+2]);
        if(!P.has(kk)) P.set(kk, [cur[o], cur[o+1], cur[o+2]]);
        k.push(kk);
      }
      T.push(k);
    }
    const half = new Map();
    for(let t = 0; t < nT; t++) for(let e = 0; e < 3; e++) half.set(T[t][e] + '>' + T[t][(e+1)%3], t);
    const nrm = t => {
      const [p, q, r] = T[t].map(k => P.get(k));
      const u = [q[0]-p[0], q[1]-p[1], q[2]-p[2]], v = [r[0]-p[0], r[1]-p[1], r[2]-p[2]];
      return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    };
    // r на отрезке x–y (не в концах), с допуском 0.002 мм
    const onSeg = (r, x, y) => {
      const d = [y[0]-x[0], y[1]-x[1], y[2]-x[2]], L2 = d[0]*d[0] + d[1]*d[1] + d[2]*d[2];
      if(!(L2 > 0)) return false;
      const s = ((r[0]-x[0])*d[0] + (r[1]-x[1])*d[1] + (r[2]-x[2])*d[2]) / L2;
      if(s <= 1e-6 || s >= 1 - 1e-6) return false;
      return Math.hypot(x[0] + s*d[0] - r[0], x[1] + s*d[1] - r[1], x[2] + s*d[2] - r[2]) < 0.002;
    };
    const drop = new Set(), add = [], used = new Set();
    for(let t = 0; t < nT; t++){
      if(used.has(t)) continue;
      const nt = nrm(t), lt = Math.hypot(...nt);
      if(lt < 1e-12) continue;
      for(let e = 0; e < 3 && !used.has(t); e++){
        const a = T[t][e], b = T[t][(e+1)%3], u = half.get(b + '>' + a);
        if(u == null || used.has(u)) continue;
        const nu = nrm(u), lu = Math.hypot(...nu);
        if(lu < 1e-12 || lu / 2 > 0.05) continue;
        if((nt[0]*nu[0] + nt[1]*nu[1] + nt[2]*nu[2]) / (lt * lu) > -0.98) continue;
        const r = T[u].find(k => k !== a && k !== b);
        // ребро t (не a–b), на котором лежит r
        for(let f = 0; f < 3; f++){
          if(f === e) continue;
          const x = T[t][f], y = T[t][(f+1)%3], o = T[t][(f+2)%3];
          if(!onSeg(P.get(r), P.get(x), P.get(y))) continue;
          const w = half.get(y + '>' + x);
          if(w == null || w === u || used.has(w)) break;
          const z = T[w].find(k => k !== x && k !== y);
          const parts = [[x, r, o], [r, y, o]];
          const us = new Set(T[u]);
          const keep = parts.filter(p => !(p.every(k => us.has(k))));
          if(keep.length !== 1) break; // не тот случай — t не накрывает u
          drop.add(t); drop.add(u); drop.add(w);
          add.push(keep[0], [y, r, z], [r, x, z]);
          for(const q of [t, u, w]) used.add(q);
          break;
        }
      }
    }
    if(!drop.size) break;
    const out = [];
    for(let t = 0; t < nT; t++) if(!drop.has(t)) for(const k of T[t]) out.push(...P.get(k));
    for(const tri of add) for(const k of tri) out.push(...P.get(k));
    cur = new Float32Array(out);
  }
  return cur;
}
// Т-стыки на треугольниках нулевой площади. Булева на длинных узких гранях
// (стенка Shell 1 × 69 мм под узором из тысяч клеток) отдаёт сетку, где
// точка лежит на середине чужого ребра, а к ней прилеплен вырожденный
// треугольник (a b c), c — между a и b. Формально сетка замкнута, но чистка
// выбрасывает вырожденные — и на их месте щели (кольцо сот: 96 открытых
// рёбер, после лечения 6 и загиб). Ремонт: соседа за длинной стороной (b a d)
// режем в точке c на (b c d) + (c a d) и вырожденный убираем — стык честный.
// Перед этим вершины ближе ключа редактора сварены (weldTinyEdges): иначе
// «средняя» точка у самого конца давала новые вырожденные без конца
function resolveDegenerate(arr){
  const P = new Map(), tris = [];
  const K = o => { const k = keyOf(arr[o], arr[o+1], arr[o+2]); if(!P.has(k)) P.set(k, [arr[o], arr[o+1], arr[o+2]]); return k; };
  for(let o=0;o<arr.length;o+=9) tris.push([K(o), K(o+3), K(o+6)]);
  const alive = [], em = new Map();
  const addE = i => { const t = tris[i]; for(let e=0;e<3;e++) em.set(t[e] + '>' + t[(e+1)%3], i); };
  const delE = i => { const t = tris[i]; for(let e=0;e<3;e++){ const k = t[e] + '>' + t[(e+1)%3]; if(em.get(k) === i) em.delete(k); } };
  const cross = t => { const a = P.get(t[0]), b = P.get(t[1]), c = P.get(t[2]);
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    return Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx); };
  const len = (k1, k2) => { const a = P.get(k1), b = P.get(k2); return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); };
  for(let i=0;i<tris.length;i++){
    const t = tris[i];
    alive[i] = !(t[0] === t[1] || t[1] === t[2] || t[0] === t[2]);
    if(alive[i]) addE(i);
  }
  const queue = [];
  for(let i=0;i<tris.length;i++) if(alive[i] && cross(tris[i]) < 1e-6) queue.push(i);
  let fixed = 0, guard = queue.length * 20 + 100;
  while(queue.length && guard-- > 0){
    const i = queue.pop();
    if(!alive[i]) continue;
    const t = tris[i];
    if(cross(t) >= 1e-6) continue;
    let li = 0, lm = -1;
    for(let e=0;e<3;e++){ const L = len(t[e], t[(e+1)%3]); if(L > lm){ lm = L; li = e; } }
    const a = t[li], b = t[(li+1)%3], c = t[(li+2)%3];
    const j = em.get(b + '>' + a);
    if(j === undefined || !alive[j] || j === i) continue;
    const t2 = tris[j], ib = t2.indexOf(b), d = t2[(ib+2)%3];
    if(t2[(ib+1)%3] !== a || d === c) continue;
    delE(i); delE(j); alive[i] = false; alive[j] = false;
    for(const nt of [[b, c, d], [c, a, d]]){
      const k = tris.length; tris.push(nt); alive[k] = true; addE(k);
      if(cross(nt) < 1e-6) queue.push(k);
    }
    fixed++;
  }
  if(!fixed) return arr;
  const out = [];
  for(let i=0;i<tris.length;i++) if(alive[i]) for(const k of tris[i]) out.push(...P.get(k));
  return new Float32Array(out);
}
function foldedEdgeCount(pos){
  const edges = new Map(), N = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    a.fromArray(pos, o); b.fromArray(pos, o+3); c.fromArray(pos, o+6);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    N.push(n.lengthSq() > 1e-18 ? n.normalize() : null);
    for(let e=0;e<3;e++){
      const o1 = o + e*3, o2 = o + ((e+1)%3)*3;
      const k1 = keyOf(pos[o1], pos[o1+1], pos[o1+2]), k2 = keyOf(pos[o2], pos[o2+1], pos[o2+2]);
      if(k1 === k2) continue;
      const k = k1 < k2 ? k1+'|'+k2 : k2+'|'+k1;
      const L = edges.get(k); if(L) L.push(t); else edges.set(k, [t]);
    }
  }
  let n = 0;
  for(const L of edges.values()) if(L.length === 2 && N[L[0]] && N[L[1]] && N[L[0]].dot(N[L[1]]) < -0.98) n++;
  return n;
}
// Булева тела модели pos (Float32Array) с телом tris ([[V,V,V]…]) и починка
// результата: сварка микрорёбер и разрез соседей у вырожденных, затем
// чистка (finish). Если вышел дефект — пробует и прежний путь (выбросить
// вырожденные и лечить) и берёт тот, где дефектов меньше. Возвращает
// массив сетки; текущая сетка (mesh) по ходу меняется. round: false — второе
// тело из точек самой модели (призма лоскута): округление сдвинуло бы его
// стенки с рёбер контура на доли микрона
function solidBoolMesh(pos, tris, op, round){
  const q3 = x => Math.round(x*1000)/1000;
  const body = [];
  for(let i=0;i<pos.length;i+=9)
    body.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]), new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]),
               new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
  const R = t => round ? t.map(v => new THREE.Vector3(q3(v.x), q3(v.y), q3(v.z))) : t;
  const bop = op === 'cut' ? 'subtract' : op === 'intersect' ? 'intersect' : 'union';
  const tool = tris.map(R);
  let out = null;
  geomLastEngine = 'exact';
  if(GEOM_BOOL_ENGINE === 'manifold' && manifoldLib){
    out = manifoldBooleanOrNull(body, tool, bop);
    if(out) geomLastEngine = 'manifold';
  }
  if(!out) out = meshBoolean(body, tool, bop);
  if(!out.length) throw new Error('the result is empty');
  // Т-стыки на вырожденных треугольниках — сначала сварка микрорёбер, потом
  // честный разрез соседа (resolveDegenerate). Если результат с дефектом —
  // пробуем и прежний путь (выбросить вырожденные и лечить) и берём тот, где
  // дефектов меньше: сначала открытые и немногообразные рёбра, потом загибы
  const finish = arr => {
    setMeshFromArray(arr); cleanupMesh();
    if(openEdgeCount() > 0) healAll();
    // чистка щепок — до тех пор, пока есть что убирать: после одного прохода
    // оставались 2 щепки, их убирал уже следующий проход при открытии файла
    // («Cleaned 2 sliver triangles from this file» при каждой загрузке)
    for(let k=0; k<4 && tidySlivers() > 0; k++);
    // загибы на Т-стыках щепок — ремонт; берём, только если сетка осталась
    // замкнутой и загибов стало меньше
    const f0 = foldedEdgeCount(mesh.geometry.attributes.position.array);
    if(f0 > 0){
      const keepA = mesh.geometry.attributes.position.array.slice();
      setMeshFromArray(repairFoldPairs(keepA)); cleanupMesh();
      if(openEdgeCount() || nonManifoldEdgeCount() || foldedEdgeCount(mesh.geometry.attributes.position.array) >= f0) setMeshFromArray(keepA);
    }
    const m = mesh.geometry.attributes.position.array;
    return {arr: m, bad: (openEdgeCount() + nonManifoldEdgeCount()) * 1000 + foldedEdgeCount(m)};
  };
  let fixedOut = out;
  try{ fixedOut = resolveDegenerate(weldTinyEdges(out)); }catch(err){ console.warn('resolveDegenerate failed', err); }
  let best = finish(fixedOut);
  // Прежний путь — только когда у нового сетка открыта/немногообразна или
  // модель небольшая: на большой (кольцо сот на колпаке — 80 тысяч
  // треугольников) его лечение щелей шло минутами ради одного загиба
  const openBad = best.bad >= 1000, small = out.length / 9 < 40000;
  if(best.bad > 0 && fixedOut !== out && (openBad || small)){ const alt = finish(out); if(alt.bad < best.bad) best = alt; }
  return best.arr;
}
// ---------- второй движок булевых: Manifold (vendor/manifold.js + .wasm) ----------
// Manifold (Apache-2.0) по построению выдаёт замкнутое многообразное тело —
// без щелей и рёбер на трёх гранях, которые наш meshBoolean оставляет и
// которые потом лечит починка. Включается GEOM_BOOL_ENGINE = 'manifold' и
// грузится по требованию (manifoldLoad — асинхронно, дальше вызовы
// синхронные). Вход — наши треугольники: вершины склеиваются по keyOf (как
// во всём ядре), вырожденные (две вершины в одной) выбрасываются. Тело не
// замкнуто или Manifold отказал — null, и считает meshBoolean
let GEOM_BOOL_ENGINE = 'exact';  // 'exact' — meshBoolean, 'manifold' — Manifold
let geomLastEngine = '';         // чем посчитана последняя булева solidBoolMesh
let manifoldLib = null, manifoldLoading = null;
function manifoldLoad(){
  if(manifoldLib) return Promise.resolve(manifoldLib);
  if(!manifoldLoading)
    manifoldLoading = import('./vendor/manifold.js')
      .then(m => m.default())
      .then(w => { w.setup(); manifoldLib = w; return w; })
      .catch(err => { manifoldLoading = null; throw err; });
  return manifoldLoading;
}
function manifoldOf(tris){
  const ids = new Map(), vp = [], tv = [];
  for(const t of tris){
    const c = [0, 0, 0];
    for(let j=0;j<3;j++){
      const v = t[j], k = keyOf(v.x, v.y, v.z);
      let id = ids.get(k);
      if(id === undefined){ id = vp.length / 3; ids.set(k, id); vp.push(v.x, v.y, v.z); }
      c[j] = id;
    }
    if(c[0] === c[1] || c[1] === c[2] || c[2] === c[0]) continue;
    tv.push(c[0], c[1], c[2]);
  }
  // Каждое ребро — ровно у двух треугольников, обходящих его навстречу.
  // Тела, касающиеся ребром (кольцо копий куба), после склейки вершин дают
  // ребро на четырёх гранях: Manifold такое принимал и терял объём (кольцо
  // из четырёх кубов — минус шестая куба) — такой вход отдаём meshBoolean
  const nV = vp.length / 3, uses = new Map();
  for(let i=0;i<tv.length;i+=3) for(let j=0;j<3;j++){
    const a = tv[i+j], b = tv[i+(j+1)%3], k = a < b ? a * nV + b : b * nV + a;
    uses.set(k, (uses.get(k) || 0) + (a < b ? 1 : 1000));
  }
  for(const u of uses.values()) if(u !== 1001) throw new Error('input is not a closed 2-manifold');
  const mesh = new manifoldLib.Mesh({numProp: 3, vertProperties: new Float32Array(vp), triVerts: new Uint32Array(tv)});
  return new manifoldLib.Manifold(mesh);
}
// Булева двух тел массивом сетки, как meshBoolean, но Manifold, если он
// включён и загружен; отказал — meshBoolean. Чем посчитано — geomLastEngine
function meshBooleanAuto(aTris, bTris, op){
  geomLastEngine = 'exact';
  if(GEOM_BOOL_ENGINE === 'manifold' && manifoldLib){
    const arr = manifoldBooleanOrNull(aTris, bTris, op);
    if(arr){ geomLastEngine = 'manifold'; return arr; }
  }
  return meshBoolean(aTris, bTris, op);
}
function manifoldBooleanOrNull(aTris, bTris, op){
  let a = null, b = null, r = null;
  try{
    a = manifoldOf(aTris); b = manifoldOf(bTris);
    r = op === 'subtract' ? a.subtract(b) : op === 'intersect' ? a.intersect(b) : a.add(b);
    const m = r.getMesh(), np = m.numProp, P = m.vertProperties, T = m.triVerts;
    const out = new Float32Array(T.length * 3);
    for(let i=0;i<T.length;i++){
      const o = T[i] * np;
      out[i*3] = P[o]; out[i*3+1] = P[o+1]; out[i*3+2] = P[o+2];
    }
    return out;
  }catch(err){
    console.warn('Manifold boolean failed, using meshBoolean:', err && err.message || err);
    return null;
  }finally{
    if(r) r.delete();
    if(b) b.delete();
    if(a) a.delete();
  }
}
