// ZeroCAD — редактор целиком: ядро геометрии, команды и интерфейс.
// Один и тот же файл работает со страницы Rust-сервера и как расширение
// браузера (Manifest V3): поэтому он отдельный, а не инлайн в index.html.

// номер сборки: страницу сервера он подписывает сам, расширению — версия
// манифеста, файлу с диска — dev
const SERVER_BUILD = (document.getElementById('zcBuild') || {dataset: {}}).dataset.build || '';
// страницу отдал наш Rust-сервер — он подписал номер сборки. Тогда рядом
// резервный движок csgrs. Без сервера (расширение, файл, статический
// хостинг) всё остальное работает так же
const HAS_SERVER = !!SERVER_BUILD && SERVER_BUILD.indexOf('__') < 0;
window.ZC_BUILD = (() => {
  if(HAS_SERVER) return SERVER_BUILD;
  try{ return 'ext-' + chrome.runtime.getManifest().version; }catch(_){ return '__BUILD__'; }
})();
// ---------- сцена ----------
const view = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setScissorTest(true);
view.appendChild(renderer.domElement);
const canvas = renderer.domElement;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(1,1,1.5); scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.35); fill.position.set(-1,-1,-.5); scene.add(fill);

// оси мира в тех же цветах, что и фиксация осей: X красная, Y зелёная, Z синяя
const AXIS_COLORS = {x:0xd9534f, y:0x4cbb5c, z:0x4d7dff};
const AXIS_CSS = {x:'#d9534f', y:'#4cbb5c', z:'#4d7dff'};
// линии осей единичной длины — масштабируются под размер модели
const axisLines = [], axisLabels = [], AXIS_DIRS = {x:[1,0,0], y:[0,1,0], z:[0,0,1]};
for(const ax of ['x','y','z']){
  const v = AXIS_DIRS[ax];
  const g = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0,0,0), new THREE.Vector3(v[0],v[1],v[2])]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({color:AXIS_COLORS[ax]}));
  scene.add(l); axisLines.push(l);
  // буква на кончике — спрайт-билборд, всегда смотрит в камеру (как в Minecraft)
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = AXIS_CSS[ax];
  ctx.fillText(ax.toUpperCase(), 32, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial(
    {map: new THREE.CanvasTexture(cv), transparent:true})); // за моделью — прячется
  sp.userData.dir = v;
  scene.add(sp); axisLabels.push(sp);
}
// версия сборки в начале координат — билборд (всегда лицом к камере).
// Оранжевый текст с тёмной обводкой: читается и на белой грани, и на чёрном
// фоне сцены (как подписи поверх видео). Холст вдвое крупнее — края чёткие
const buildSprite = (()=>{
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const label = (window.ZC_BUILD && window.ZC_BUILD.indexOf('__')<0) ? window.ZC_BUILD : 'dev';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(12,14,18,0.95)';
  ctx.strokeText(label, 256, 52);
  ctx.fillStyle = '#ffa31a';
  ctx.fillText(label, 256, 52);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial(
    {map: new THREE.CanvasTexture(cv), transparent:true, depthTest:false}));
  sp.position.set(0, 0, 0);
  scene.add(sp);
  return sp;
})();

// оси соразмерны модели: чуть выступают за край, не тонут и не улетают
function updateAxesSize(len){
  for(const l of axisLines) l.scale.setScalar(len);
  for(const sp of axisLabels){
    const d = sp.userData.dir;
    sp.position.set(d[0]*len*1.1, d[1]*len*1.1, d[2]*len*1.1);
  }
}
updateAxesSize(44);

// ---------- миллиметровая сетка ----------
// Все единицы проекта — мм. 10 мм — крупная сетка, 1 мм — тонкая (в орто-видах).
function mmGrid(size, step, cCenter, cGrid){
  const g = new THREE.GridHelper(size, Math.round(size/step), cCenter, cGrid);
  g.material.depthWrite = false;
  return g;
}
const bedGrid = mmGrid(300, 10, 0x39404e, 0x232833); bedGrid.rotation.x = Math.PI/2; // «стол» под деталью в 3D
const gXY10 = mmGrid(300, 10, 0x39404e, 0x232833); gXY10.rotation.x = Math.PI/2;
const gXY1  = mmGrid(200, 1, 0x1d212a, 0x1d212a);  gXY1.rotation.x  = Math.PI/2;
const gYZ10 = mmGrid(300, 10, 0x39404e, 0x232833); gYZ10.rotation.z = Math.PI/2;
const gYZ1  = mmGrid(200, 1, 0x1d212a, 0x1d212a);  gYZ1.rotation.z  = Math.PI/2;
const gXZ10 = mmGrid(300, 10, 0x39404e, 0x232833);
const gXZ1  = mmGrid(200, 1, 0x1d212a, 0x1d212a);
const ALL_GRIDS = [bedGrid, gXY10, gXY1, gYZ10, gYZ1, gXZ10, gXZ1];
for(const g of ALL_GRIDS){ g.visible = false; scene.add(g); }
const VIEW_GRIDS = { persp:[bedGrid], ox:[gYZ1,gYZ10], oy:[gXZ1,gXZ10], oz:[gXY1,gXY10] };

let mesh = null;
// polygonOffset отодвигает грани, чтобы линии рёбер не мерцали поверх них
// белая модель с серыми тенями — как дефолтный стиль SketchUp
const mat = new THREE.MeshStandardMaterial({color:0xf2f2ee, metalness:0.0, roughness:0.85,
  flatShading:true, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1});
// изнанка граней — серо-голубая, как задняя сторона грани в SketchUp:
// после удаления грани внутренность видна и отличима от наружной стороны
let backMesh = null;
const backMat = new THREE.MeshStandardMaterial({color:0xa9b7c6, metalness:0.0, roughness:0.9,
  flatShading:true, side:THREE.BackSide, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1});

// ---------- камеры: 1 перспективная (орбита) + 3 ортогональные ----------
const persp = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
persp.up.set(0,0,1);
// старт: камера внутри рабочего октанта (+X+Y+Z), смотрит на начало
// координат «с внутренней стороны»: X уходит влево-вниз, Y вправо-вниз
// ровно как клик по углу (+X+Y+Z) ViewCube — изометрия: наклон atan(1/√2) ≈ 35.26°
const HOME_YAW = Math.PI/4, HOME_PITCH = Math.atan2(1, Math.SQRT2);
let camDist = 190, yaw = HOME_YAW, pitch = HOME_PITCH;
const camTarget = new THREE.Vector3(20,20,15);

function makeOrtho(pos, up){
  const c = new THREE.OrthographicCamera(-1,1,1,-1,1,3000);
  c.position.copy(pos); c.up.copy(up); c.lookAt(0,0,0);
  return c;
}
const D = 1000;
const orthoX = makeOrtho(new THREE.Vector3(D,0,0), new THREE.Vector3(0,0,1));
const orthoY = makeOrtho(new THREE.Vector3(0,D,0), new THREE.Vector3(0,0,1));
const orthoZ = makeOrtho(new THREE.Vector3(0,0,D), new THREE.Vector3(0,1,0));

// ---------- ViewCube: навигационный куб в углу 3D-окна ----------
const GIZMO_SIZE = 120;
const gizmoScene = new THREE.Scene();
const gizmoCam = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 10);
// куб с фасками как Navigation Cube во FreeCAD: 6 граней-табличек,
// 12 скосов-прямоугольников (цвет по направлению: X-красный, Y-зелёный,
// Z-синий) и 8 треугольных углов
const gizmoCube = (()=>{
  const A = 1, CH = 0.42, S = A - CH;
  const P = [], UV = [], G = [];
  let vc = 0;
  const push = (mi, pts, uvs) => {
    G.push({start: vc, count: pts.length/3, mi});
    P.push(...pts); UV.push(...uvs); vc += pts.length/3;
  };
  const quad = (mi, p1, p2, p3, p4, flipU) => {
    const uv = flipU ? [[1,0],[0,0],[0,1],[1,1]] : [[0,0],[1,0],[1,1],[0,1]];
    push(mi, [...p1,...p2,...p3, ...p1,...p3,...p4],
             [...uv[0],...uv[1],...uv[2], ...uv[0],...uv[2],...uv[3]]);
  };
  const quadAuto = (mi, p1, p2, p3, p4) => { // ориентация наружу автоматически
    const c0 = [(p1[0]+p3[0])/2, (p1[1]+p3[1])/2, (p1[2]+p3[2])/2];
    const u = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const v = [p3[0]-p2[0], p3[1]-p2[1], p3[2]-p2[2]];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    if(n[0]*c0[0] + n[1]*c0[1] + n[2]*c0[2] < 0) quad(mi, p1, p4, p3, p2, false);
    else quad(mi, p1, p2, p3, p4, false);
  };
  const triAuto = (mi, p1, p2, p3) => {
    const c0 = [(p1[0]+p2[0]+p3[0])/3, (p1[1]+p2[1]+p3[1])/3, (p1[2]+p2[2]+p3[2])/3];
    const u = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    const v = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const pts = (n[0]*c0[0]+n[1]*c0[1]+n[2]*c0[2] < 0)
      ? [...p1,...p3,...p2] : [...p1,...p2,...p3];
    push(mi, pts, [0,0, 1,0, 0.5,1]);
  };
  // грани-таблички (порядок материалов: RIGHT,LEFT,BACK,FRONT,TOP,BOTTOM)
  quad(0, [A,-S,-S],[A, S,-S],[A, S, S],[A,-S, S], false);   // +X RIGHT
  quad(1, [-A, S,-S],[-A,-S,-S],[-A,-S, S],[-A, S, S], false); // -X LEFT
  quad(2, [ S, A,-S],[-S, A,-S],[-S, A, S],[ S, A, S], false); // +Y BACK
  quad(3, [-S,-A,-S],[ S,-A,-S],[ S,-A, S],[-S,-A, S], false); // -Y FRONT
  quad(4, [-S,-S, A],[ S,-S, A],[ S, S, A],[-S, S, A], false); // +Z TOP
  quad(5, [-S, S,-A],[ S, S,-A],[ S,-S,-A],[-S,-S,-A], true);  // -Z BOTTOM
  // 12 фасок: свободная ось k = направление скоса -> материал 6+k
  for(let i=0;i<3;i++) for(let j=i+1;j<3;j++){
    const k = 3 - i - j;
    const pt = (iv, jv, kv) => { const p=[0,0,0]; p[i]=iv; p[j]=jv; p[k]=kv; return p; };
    for(const si of [1,-1]) for(const sj of [1,-1]){
      quadAuto(6+k,
        pt(A*si, S*sj, -S), pt(A*si, S*sj, S),
        pt(S*si, A*sj,  S), pt(S*si, A*sj, -S));
    }
  }
  // 8 треугольных углов
  for(const sx of [1,-1]) for(const sy of [1,-1]) for(const sz of [1,-1])
    triAuto(9, [A*sx, S*sy, S*sz], [S*sx, A*sy, S*sz], [S*sx, S*sy, A*sz]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
  for(const g of G) geo.addGroup(g.start, g.count, g.mi);

  const faceMat = label => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#e8eaee'; ctx.fillRect(0,0,128,128);
    // одна большая буква во всю грань — читается издалека
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2b2e35';
    ctx.fillText(label, 64, 70);
    return new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(cv),
      transparent: true, opacity: 0.55, depthWrite: false});
  };
  const solid = hex => new THREE.MeshBasicMaterial(
    {color: hex, transparent: true, opacity: 0.55, depthWrite: false});
  // R/L/B/F/T/D — как в нотации кубика Рубика (D = down, без коллизии B)
  const mats = ['R','L','B','F','T','D'].map(faceMat);
  mats.push(solid(0xd9534f), solid(0x4cbb5c), solid(0x4d7dff), solid(0xcfd4de));
  return new THREE.Mesh(geo, mats);
})();
gizmoScene.add(gizmoCube);
gizmoScene.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(gizmoCube.geometry, 25),
  new THREE.LineBasicMaterial({color: 0x596070})));
// плавный перелёт камеры к выбранному виду
let viewAnim = null;
function animateView(yaw1, pitch1){
  viewAnim = {y0:yaw, p0:pitch, y1:(yaw1===null?yaw:yaw1), p1:pitch1, t0:performance.now()};
}
// прямоугольник куба в CSS-координатах canvas (верхний правый угол 3D-окна)
function gizmoCssRect(){
  const r = canvas.getBoundingClientRect();
  const inQuad = quadChk.checked;
  const wq = inQuad ? r.width/2 : r.width;
  return {x: wq - GIZMO_SIZE - 56, y: 44, s: GIZMO_SIZE, canvasH: r.height};
}
function gizmoPose(){
  const dir = new THREE.Vector3().subVectors(persp.position, camTarget).normalize();
  gizmoCam.position.copy(dir).multiplyScalar(4);
  gizmoCam.up.set(0,0,1);
  gizmoCam.lookAt(0,0,0);
  gizmoCam.updateMatrixWorld(true);
}
// клик по грани куба -> перелёт к виду; true, если клик съеден кубом
function gizmoClick(e){
  const g = gizmoCssRect();
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left, py = e.clientY - r.top;
  if(px < g.x || px > g.x + g.s || py < g.y || py > g.y + g.s) return false;
  gizmoPose();
  raycaster.setFromCamera({x:(px-g.x)/g.s*2-1, y:-((py-g.y)/g.s*2-1)}, gizmoCam);
  const hits = raycaster.intersectObject(gizmoCube);
  if(hits.length){
    // грань / ребро / угол — по точке попадания (как Navigation Cube во FreeCAD)
    const p = hits[0].point;
    const t = 0.56; // граница фасок: |коорд| > t — скос/угол, меньше — грань
    const sx = Math.abs(p.x)>t ? Math.sign(p.x) : 0;
    const sy = Math.abs(p.y)>t ? Math.sign(p.y) : 0;
    const sz = Math.abs(p.z)>t ? Math.sign(p.z) : 0;
    if(sx===0 && sy===0){
      animateView(null, sz>=0 ? 1.5 : -1.5); // TOP/BOTTOM, yaw сохраняем
    } else {
      const yaw1 = Math.atan2(sy, sx);
      const pitch1 = Math.atan2(sz, Math.hypot(sx, sy)); // ребро/угол -> изометрия
      animateView(yaw1, Math.max(-1.5, Math.min(1.5, pitch1)));
    }
  }
  return true;
}
let orthoFit = 70;

function updateOrthoPoses(){
  orthoX.position.set(camTarget.x + D, camTarget.y, camTarget.z); orthoX.lookAt(camTarget);
  orthoY.position.set(camTarget.x, camTarget.y + D, camTarget.z); orthoY.lookAt(camTarget);
  orthoZ.position.set(camTarget.x, camTarget.y, camTarget.z + D); orthoZ.lookAt(camTarget);
}
function updateOrthoFrusta(){
  const w=view.clientWidth/2, h=view.clientHeight/2, aspect=w/h;
  for(const c of [orthoX, orthoY, orthoZ]){
    c.left=-orthoFit*aspect; c.right=orthoFit*aspect; c.top=orthoFit; c.bottom=-orthoFit;
    c.updateProjectionMatrix();
  }
}

// ---------- рёбра модели: извлечение и сшивка в цепочки ----------
// «Ребро» = цепочка отрезков между резкими углами (как в SketchUp).
// Угол сглаживания: ребро рисуем, только если излом круче него. 15° в
// точности совпадали с углом фасок круга из 24 сегментов (360/24), и рёбра
// цилиндра рисовались через одно. 35° выше огранки любого круга от 12
// сегментов (цилиндр гладкий, как softened curve в SketchUp) и ниже фаски
// 45° и стенки 90° — они по-прежнему видны. Ср. Auto Smooth 30° в Blender
const FEATURE_COS = Math.cos(35*Math.PI/180);
const CHAIN_COS   = Math.cos(25*Math.PI/180); // поворот >25° => конец цепочки («угол»)
// Жёсткие рёбра (hard edges SketchUp, Mark Sharp в Blender): отрезки, рёбра
// сетки на которых рисуются и выбираются, даже если грани сходятся под
// малым углом. Их ставят операции, которые сами создают грани-сегменты —
// скругление: рёбра между его гранями должны быть видны, а боковина
// выдавленного круга остаётся гладкой. Хранятся в проекте и истории
let hardEdges = [];      // [{a:Vector3, b:Vector3}]
// Лежит ли точка на какой-нибудь грани сетки (сетка треугольников в ячейках
// 5 мм). Нужна, чтобы отличать линии на теле от линий в воздухе
let faceTester = null;
function getFaceTester(){
  if(faceTester) return faceTester;
  const pos = mesh ? mesh.geometry.attributes.position.array : new Float32Array(0);
  const CELL = 5, grid = new Map();
  const cell = (x,y,z) => Math.floor(x/CELL) + ',' + Math.floor(y/CELL) + ',' + Math.floor(z/CELL);
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    const lo = [0,1,2].map(k => Math.floor((Math.min(pos[o+k], pos[o+3+k], pos[o+6+k]) - 0.02)/CELL));
    const hi = [0,1,2].map(k => Math.floor((Math.max(pos[o+k], pos[o+3+k], pos[o+6+k]) + 0.02)/CELL));
    for(let i=lo[0];i<=hi[0];i++) for(let j=lo[1];j<=hi[1];j++) for(let k=lo[2];k<=hi[2];k++){
      const key = i+','+j+','+k;
      let a = grid.get(key); if(!a){ a = []; grid.set(key, a); } a.push(t);
    }
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  faceTester = P => {
    for(const t of (grid.get(cell(P.x, P.y, P.z)) || [])){
      const o = t*9;
      A.fromArray(pos, o); B.fromArray(pos, o+3); C.fromArray(pos, o+6);
      v0.subVectors(B, A); v1.subVectors(C, A); v2.subVectors(P, A);
      nrm.crossVectors(v0, v1);
      const L = nrm.length();
      if(L < 1e-9) continue;
      if(Math.abs(v2.dot(nrm)) / L > 0.02) continue; // не в плоскости треугольника
      const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1);
      const den = d00*d11 - d01*d01;
      if(Math.abs(den) < 1e-12) continue;
      const v = (d11*d20 - d01*d21) / den, w = (d00*d21 - d01*d20) / den;
      const e = 0.01 / Math.sqrt(Math.max(d00, d11)); // ~0.01 мм допуска на границе
      if(v >= -e && w >= -e && v + w <= 1 + e) return true;
    }
    return false;
  };
  return faceTester;
}
// Линия в воздухе — ярко-красная: чёрная на тёмном фоне сцены не видна, а
// красная ещё и честно говорит, что эта часть не лежит на теле
const C_AIR = 0xff4d4d, C_GUIDE = 0x23262c;
const AIR_RGB = new THREE.Color(C_AIR), GUIDE_RGB = new THREE.Color(C_GUIDE);
function airColoredLine(pts, onColor, closed){
  const test = getFaceTester();
  const onRGB = new THREE.Color(onColor);
  const out = [], cols = [];
  let anyAir = false;
  const push = (P, air) => { out.push(P); const c = air ? AIR_RGB : onRGB; cols.push(c.r, c.g, c.b); };
  const list = closed ? [...pts, pts[0]] : pts;
  for(let i=0;i+1<list.length;i++){
    const a = list[i], b = list[i+1];
    const N = Math.max(1, Math.min(24, Math.ceil(a.distanceTo(b) / 1.5)));
    let prevP = a, prevAir = !test(a);
    if(i === 0) push(a, prevAir);
    for(let k=1;k<=N;k++){
      const P = a.clone().lerp(b, k/N), air = !test(P);
      if(air !== prevAir){ // граница грани: делением пополам, цвет меняется резко
        let lo = prevP, hi = P;
        for(let it=0;it<6;it++){
          const m = lo.clone().lerp(hi, 0.5);
          if((!test(m)) === prevAir) lo = m; else hi = m;
        }
        const M = lo.clone().lerp(hi, 0.5);
        push(M, prevAir); push(M.clone(), air);
      }
      if(air) anyAir = true;
      push(P, air);
      prevP = P; prevAir = air;
    }
  }
  const g = new THREE.BufferGeometry().setFromPoints(out);
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return {geometry: g, anyAir};
}
const guideAirMat = new THREE.LineBasicMaterial({vertexColors: true});
// Выбранная (зелёная) или наведённая (жёлтая) линия лежит ровно поверх
// своей нарисованной линии — две линии на одной глубине мерцают вперемешку
// (зелёное с красным). Пока линия выбрана или наведена, её собственная
// линия прячется: цвет выбора всегда главнее цвета «в воздухе»
function syncGuideOverlays(){ try{ syncGuideOverlays_(); }catch(_){ /* до объявления выбора при загрузке */ } }
function syncGuideOverlays_(){
  const polys = edgeSel.map(s => s.pts);
  if(typeof hover !== 'undefined' && hover && hover.chain) polys.push(hover.chain.pts);
  const onPoly = P => polys.some(pts => {
    for(let i=0;i+1<pts.length;i++){
      const A = pts[i], AB = new THREE.Vector3().subVectors(pts[i+1], A), L2 = AB.lengthSq();
      if(L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, A).dot(AB) / L2));
      if(A.clone().addScaledVector(AB, t).distanceToSquared(P) < 1e-6) return true;
    }
    return false;
  });
  for(const g of guides){
    const covered = polys.length > 0 && onPoly(g.a) && onPoly(g.b)
      && onPoly(g.a.clone().lerp(g.b, 0.5));
    g.line.visible = !covered;
  }
}
function recolorGuides(){
  for(const g of guides){
    const r = airColoredLine([g.a, g.b], C_GUIDE, false);
    g.line.geometry.dispose();
    if(r.anyAir){ g.line.geometry = r.geometry; g.line.material = guideAirMat; }
    else {
      r.geometry.dispose();
      g.line.geometry = new THREE.BufferGeometry().setFromPoints([g.a, g.b]);
      if(g.line.material === guideAirMat) g.line.material = new THREE.LineBasicMaterial({color: C_GUIDE});
    }
    g.air = r.anyAir;
  }
}
function onHardEdge(P, Q){
  for(const h of hardEdges){
    const d = new THREE.Vector3().subVectors(h.b, h.a);
    const L2 = d.lengthSq();
    if(L2 < 1e-12) continue;
    let ok = true;
    for(const X of [P, Q]){
      const t = new THREE.Vector3().subVectors(X, h.a).dot(d) / L2;
      if(t < -1e-4 || t > 1 + 1e-4){ ok = false; break; }
      const F = h.a.clone().addScaledVector(d, t);
      if(F.distanceToSquared(X) > 0.003*0.003){ ok = false; break; }
    }
    if(ok) return true;
  }
  return false;
}
const QP = 1000;                              // квантование координат, 0.001 мм

let chains = [];     // {pts:[Vector3], cum:[мм], total, closed}
let auxSnaps = [];   // центры дуг/окружностей (Snap Center, как во FreeCAD)
let quadSnaps = [];  // квадранты окружностей {pos, axis, sign} (Quadrant в AutoCAD)
let ringVertKeys = new Set(); // вершины многоугольников окружностей (без маркеров)
let snapRings = [];  // все окружности модели (нарисованные и рёбра тела)
let vertTris = new Map(); // ключ вершины -> [индексы треугольников] (для граней)
let edgeLines = null;   // все рёбра (тонкие тёмные)
let hiLine = null;      // подсвеченная цепочка
let hover = null;       // {chain, s}
let placing = null;     // {chain, s} — открыта всплывашка
let anchors = [];       // поставленные точки {pos, marker, bend?}
let dragPt = null;      // текущее перетаскивание {a?, isSel, start, plane, idx|bendRun, markers}
let pendingEdge = null; // нажатие на ребро: клик => выбор, движение => камера
// автосохранение включается только после первой загрузки модели: иначе
// стартовая сборка затёрла бы сохранённую работу раньше, чем её восстановят
let autosaveArmed = false, autosaveT = 0, projectDirty = false;
let activeTool = null; // инструмент на общем каркасе: R, T, Q, массив
let pendingVertex = null; // нажатие на вершину: клик => выбор, движение => камера
let edgeDrag = null;    // перенос целого ребра (как перетаскивание линии в Sketcher)
let vpEdge = null;      // окно G,V в режиме ребра: {pts0, idx, mid} — двигаем середину
let modified = false;
// нормали при драге пересчитываем не чаще раза в 120 мс (иначе fps проседает)
let normalsDirty = false, lastNormalsAt = 0;
function normalsThrottled(){
  const now = performance.now();
  if(now - lastNormalsAt > 120){
    mesh.geometry.computeVertexNormals();
    lastNormalsAt = now; normalsDirty = false;
  } else normalsDirty = true;
}
function normalsFlush(){
  if(normalsDirty){ mesh.geometry.computeVertexNormals(); normalsDirty = false; }
}

// фиксация оси при перетаскивании (X/Y/Z как в Blender)
let axisLock = null, axisGuide = null;
function setAxisLock(ax){
  axisLock = ax;
  if(axisGuide){ scene.remove(axisGuide); axisGuide.geometry.dispose(); axisGuide=null; }
  if(ax && dragPt){
    const s = dragPt.start;
    const d = {x:[1,0,0], y:[0,1,0], z:[0,0,1]}[ax];
    const col = AXIS_COLORS[ax];
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(s.x-d[0]*500, s.y-d[1]*500, s.z-d[2]*500),
      new THREE.Vector3(s.x+d[0]*500, s.y+d[1]*500, s.z+d[2]*500)]);
    axisGuide = new THREE.Line(g, new THREE.LineBasicMaterial({color:col}));
    scene.add(axisGuide);
  }
}

const kf = v => Math.round(v*QP);
const keyOf = (x,y,z) => kf(x)+','+kf(y)+','+kf(z);

// минимальный шаг ручных правок: 0.1 мм (типовая точность FDM по XY)
const SNAP = 0.1;
const snapMM = v => Math.round(v/SNAP)*SNAP;

function extractEdges(){
  chains = [];
  if(edgeLines){ scene.remove(edgeLines); edgeLines.geometry.dispose(); edgeLines = null; }
  setHover(null);
  if(!mesh) return;
  const pos = mesh.geometry.attributes.position.array;
  const eMap = new Map(); // "ka|kb" -> {ka,kb,A,B,normals:[]}
  vertTris = new Map();
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(),
        ab=new THREE.Vector3(), ac=new THREE.Vector3();
  for(let i=0;i<pos.length;i+=9){
    a.fromArray(pos,i); b.fromArray(pos,i+3); c.fromArray(pos,i+6);
    ab.subVectors(b,a); ac.subVectors(c,a);
    const n = new THREE.Vector3().crossVectors(ab,ac);
    // вырожденный треугольник (две вершины совпали после врезки хорды) —
    // не грань: его «нормаль» добавляла ребру третью грань, и посреди
    // круга рисовалось лишнее режущее ребро
    if(n.length() < 1e-6) continue;
    n.normalize();
    const vs=[a,b,c];
    for(let e=0;e<3;e++){
      const P=vs[e], Q=vs[(e+1)%3];
      const kp=keyOf(P.x,P.y,P.z), kq=keyOf(Q.x,Q.y,Q.z);
      let vt = vertTris.get(kp);
      if(!vt){ vt=[]; vertTris.set(kp, vt); }
      vt.push(i/9);
      if(kp===kq) continue;
      const ek = kp<kq ? kp+'|'+kq : kq+'|'+kp;
      let ent = eMap.get(ek);
      if(!ent){ ent={ka:kp,kb:kq,A:P.clone(),B:Q.clone(),normals:[],tris:[]}; eMap.set(ek,ent); }
      ent.normals.push(n.clone());
      ent.tris.push(i/9);
    }
  }
  // видимые рёбра: граница или излом
  const feats=[];
  for(const ent of eMap.values()){
    let dt = ent.normals.length===2 ? ent.normals[0].dot(ent.normals[1]) : -1;
    // три и больше треугольника на ребре, но все в одной плоскости и смотрят
    // в одну сторону (перекрывающиеся осколки врезки) — складки нет, ребро
    // не видимое; стык листа с гранью (разные плоскости) остаётся ребром
    if(ent.normals.length >= 3 && ent.normals.every(nn => nn.dot(ent.normals[0]) > 0.9999)) dt = 1;
    const coplanarMany = ent.normals.length >= 3 && dt === 1;
    if((ent.normals.length!==2 && !coplanarMany) || dt < FEATURE_COS
       || (hardEdges.length && dt < 0.99999 && onHardEdge(ent.A, ent.B))){ ent.feat = true; feats.push(ent); }
  }
  // Поверхности: треугольники, связанные невидимыми (гладкими) рёбрами.
  // Ребро модели — граница между одной и той же парой поверхностей, как
  // ребро B-rep во FreeCAD: где пара меняется (прямое ребро упёрлось в
  // скругление, дуга перешла на следующую грань фаски), цепочка делится
  const surf = new Int32Array(pos.length/9);
  for(let i=0;i<surf.length;i++) surf[i] = i;
  const root = i => { while(surf[i] !== i){ surf[i] = surf[surf[i]]; i = surf[i]; } return i; };
  for(const ent of eMap.values()){
    if(ent.feat || ent.tris.length !== 2) continue;
    const r1 = root(ent.tris[0]), r2 = root(ent.tris[1]);
    if(r1 !== r2) surf[r1] = r2;
  }
  for(const f of feats) f.faces = f.tris.map(root).sort((x,y)=>x-y).join(',');
  // смежность по вершинам
  const vMap = new Map();
  for(const f of feats){
    for(const k of [f.ka,f.kb]){
      if(!vMap.has(k)) vMap.set(k,[]);
      vMap.get(k).push(f);
    }
  }
  const other = (f,k) => f.ka===k ? {k:f.kb,v:f.B,from:f.A} : {k:f.ka,v:f.A,from:f.B};
  const used = new Set();
  const dir = (p,q) => new THREE.Vector3().subVectors(q,p).normalize();
  for(const f0 of feats){
    if(used.has(f0)) continue;
    used.add(f0);
    let keys=[f0.ka,f0.kb], pts=[f0.A.clone(),f0.B.clone()], closed=false;
    for(const side of [1,0]){ // 1 — растим хвост, 0 — голову
      while(true){
        const endK = side ? keys[keys.length-1] : keys[0];
        const adj = vMap.get(endK)||[];
        if(adj.length!==2) break;               // развилка или обрыв — «угол» модели
        const nxt = adj.find(x=>!used.has(x));
        if(!nxt) break;
        if(nxt.faces !== f0.faces) break;         // другая пара граней — другое ребро
        const o = other(nxt,endK);
        const endP  = side ? pts[pts.length-1] : pts[0];
        const prevP = side ? pts[pts.length-2] : pts[1];
        if(dir(prevP,endP).dot(dir(endP,o.v)) < CHAIN_COS) break; // резкий поворот
        used.add(nxt);
        if(side){ keys.push(o.k); pts.push(o.v.clone()); }
        else    { keys.unshift(o.k); pts.unshift(o.v.clone()); }
        if(o.k === (side?keys[0]:keys[keys.length-1])){ closed=true; break; }
      }
      if(closed) break;
    }
    const cum=[0];
    for(let i=1;i<pts.length;i++) cum.push(cum[i-1]+pts[i].distanceTo(pts[i-1]));
    chains.push({pts, cum, total:cum[cum.length-1], closed});
  }
  // тонкий оверлей всех рёбер
  const lp=[];
  for(const f of feats){ lp.push(f.A.x,f.A.y,f.A.z, f.B.x,f.B.y,f.B.z); }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp),3));
  edgeLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({color:0x23262c}));
  scene.add(edgeLines);
  // вершины = концы незамкнутых цепочек (углы модели)
  const cmap = new Map();
  for(const ch of chains){
    if(ch.closed) continue;
    for(const P of [ch.pts[0], ch.pts[ch.pts.length-1]]){
      const k = keyOf(P.x,P.y,P.z);
      if(!cmap.has(k)) cmap.set(k, P.clone());
    }
  }
  // концы нарисованных линий — тоже снап-вершины (Endpoint, как во FreeCAD):
  // узел «линия упёрлась в ребро» магнитится, хотя излома там нет
  for(const gd of guides){
    for(const P of [gd.a, gd.b]){
      const k = keyOf(P.x, P.y, P.z);
      if(!cmap.has(k)) cmap.set(k, P.clone());
    }
  }
  corners = [...cmap.entries()].map(([key,pos])=>({key,pos}));
  // нарисованные линии — псевдо-рёбра: наведение, бег точки, магнит середины
  for(const gd of guides){
    const len = gd.a.distanceTo(gd.b);
    if(len < 1e-6) continue;
    chains.push({pts:[gd.a.clone(), gd.b.clone()], cum:[0,len], total:len,
                 closed:false, isGuide:true, curve: gd.curve || 0});
  }
  faceTester = null; recolorGuides(); // сетка сменилась — линии в воздухе заново
  splitChainsByAnchors(); // точки на ребре делят его на выбираемые куски
  cornerHover = null;
  // оси всегда выходят за габарит модели (буквы не «поглощаются» фигурой)
  {
    let ext = 10;
    for(let i=0;i<pos.length;i++) if(pos[i] > ext) ext = pos[i];
    updateAxesSize(ext * 1.25);
  }
  // центры дуг и окружностей — снап-цели
  auxSnaps = [];
  for(const ch of chains){
    const a = fitArc(ch);
    if(a) auxSnaps.push(a.center.clone());
  }
  // центр нарисованной окружности: её сегменты — отдельные цепочки, дугу по
  // одной не подогнать, поэтому центр берётся по всей кривой
  {
    const ids = new Set(guides.filter(g => g.curve).map(g => g.curve));
    for(const id of ids){
      const ci = curveInfo(id);
      if(ci && !auxSnaps.some(c => c.distanceTo(ci.ctr) < 1e-3)) auxSnaps.push(ci.ctr.clone());
    }
  }
  computeQuadSnaps();
  cachedPatch = null; // меш изменился — кэш грани недействителен
  scheduleAutosave();
  if(typeof vGhost !== 'undefined') vGhost.visible = false;
  // выбранные рёбра больше не соответствуют сетке
  if(typeof edgeSel !== 'undefined' && edgeSel.length) clearEdgeSel();
}

// кэш плоской грани с площадным центроидом (для магнита «центр грани»)
let cachedPatch = null;
function facePatchCached(fi){
  if(cachedPatch && cachedPatch.set.has(fi)) return cachedPatch;
  cachedPatch = facePatchAt(fi);
  const pos = mesh.geometry.attributes.position.array;
  const c = new THREE.Vector3();
  let aSum = 0;
  for(const t of cachedPatch.tris){
    const o = t*9;
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    const ar = Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) / 2;
    c.x += ar*(pos[o]+pos[o+3]+pos[o+6])/3;
    c.y += ar*(pos[o+1]+pos[o+4]+pos[o+7])/3;
    c.z += ar*(pos[o+2]+pos[o+5]+pos[o+8])/3;
    aSum += ar;
  }
  cachedPatch.centroid = c.divideScalar(aSum || 1);
  cachedPatch.area = aSum;
  cachedPatch.centers = patchCenters(cachedPatch);
  return cachedPatch;
}

// Раскладка грани с прямолинейным контуром на прямоугольники полосами:
// Г-образная — 2 центра, П — 3 и т.д. Контур не прямолинеен (круг, скос)
// или прямоугольников больше HINT_MAX — берём самые крупные / центроид.
function patchCenters(patch){
  const pos = mesh.geometry.attributes.position.array;
  // граничные рёбра лоскута: встречаются ровно в одном его треугольнике
  const cnt = new Map();
  for(const t of patch.tris){
    for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      const rec = cnt.get(ek);
      if(rec) rec.n++;
      else cnt.set(ek, {n:1, a:[pos[o1],pos[o1+1],pos[o1+2]], b:[pos[o2],pos[o2+1],pos[o2+2]]});
    }
  }
  const n0 = patch.normal;
  const u = (Math.abs(n0.z) < 0.9
    ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n0).normalize();
  const v = n0.clone().cross(u);
  const o0 = patch.tris[0]*9;
  const d0 = n0.x*pos[o0]+n0.y*pos[o0+1]+n0.z*pos[o0+2];
  const segs = [];
  for(const rec of cnt.values()){
    if(rec.n !== 1) continue;
    segs.push([[rec.a[0]*u.x+rec.a[1]*u.y+rec.a[2]*u.z, rec.a[0]*v.x+rec.a[1]*v.y+rec.a[2]*v.z],
               [rec.b[0]*u.x+rec.b[1]*u.y+rec.b[2]*u.z, rec.b[0]*v.x+rec.b[1]*v.y+rec.b[2]*v.z]]);
  }
  if(!segs.length || segs.length > 400) return [patch.centroid];
  // ось разложения — вдоль самого длинного граничного ребра; при равной длине
  // берём стабильное направление, чтобы раскладка не менялась между пересчётами
  let best = 0, ex = 1, ey = 0;
  for(const s of segs){
    const dx = s[1][0]-s[0][0], dy = s[1][1]-s[0][1], L = dx*dx+dy*dy;
    if(L < 1e-12) continue;
    const l = Math.sqrt(L);
    let cx = dx/l, cy = dy/l;
    if(cx < 0 || (Math.abs(cx) < 1e-9 && cy < 0)){ cx = -cx; cy = -cy; }
    if(L > best + 1e-9 ||
       (Math.abs(L-best) <= 1e-9 && (cx > ex + 1e-9 || (Math.abs(cx-ex) <= 1e-9 && cy > ey)))){
      best = L; ex = cx; ey = cy;
    }
  }
  const rot = p => [p[0]*ex + p[1]*ey, -p[0]*ey + p[1]*ex];
  const rs = segs.map(s => [rot(s[0]), rot(s[1])]);
  // прямолинейность: каждое граничное ребро параллельно одной из осей
  for(const s of rs){
    const dx = Math.abs(s[1][0]-s[0][0]), dy = Math.abs(s[1][1]-s[0][1]);
    if(dx > 0.05 && dy > 0.05) return [patch.centroid];
  }
  const q3 = x => Math.round(x*1000)/1000;
  const ys = [...new Set(rs.flatMap(s => [q3(s[0][1]), q3(s[1][1])]))].sort((a,b)=>a-b);
  const rects = [];    // {x0,x1,y0,y1} в повёрнутой 2D-системе
  let open = new Map(); // x-интервал -> недостроенный прямоугольник из полосы ниже
  for(let i=0;i<ys.length-1;i++){
    const y0 = ys[i], y1 = ys[i+1], my = (y0+y1)/2;
    // чётность пересечений вертикальными рёбрами — внутренние x-интервалы полосы
    const xs = [];
    for(const s of rs){
      const a = s[0], b = s[1];
      if(Math.min(a[1],b[1]) < my && Math.max(a[1],b[1]) > my)
        xs.push(a[0] + (b[0]-a[0])*(my-a[1])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    const next = new Map();
    for(let j=0;j+1<xs.length;j+=2){
      const key = Math.round(xs[j]*100)+'|'+Math.round(xs[j+1]*100);
      const prev = open.get(key);
      if(prev){ prev.y1 = y1; next.set(key, prev); } // тот же интервал — растим вверх
      else { const r = {x0:xs[j], x1:xs[j+1], y0, y1}; rects.push(r); next.set(key, r); }
    }
    open = next;
  }
  if(!rects.length) return [patch.centroid];
  // единственный прямоугольник, покрывающий всю площадь — грань прямоугольная
  if(rects.length === 1){
    const r = rects[0], w = Math.abs(r.x1-r.x0), h = Math.abs(r.y1-r.y0);
    if(patch.area && Math.abs(w*h - patch.area) < Math.max(0.5, patch.area*0.02))
      patch.rectDims = [w, h];
  }
  rects.sort((a,b)=>(b.x1-b.x0)*(b.y1-b.y0)-(a.x1-a.x0)*(a.y1-a.y0));
  const un = (cx, cy) => { // поворот обратно + в 3D
    const X = cx*ex - cy*ey, Y = cx*ey + cy*ex;
    return new THREE.Vector3()
      .addScaledVector(u, X).addScaledVector(v, Y).addScaledVector(n0, d0);
  };
  patch.centerRects = []; // углы прямоугольника каждого центра — для «скотча»
  return rects.slice(0, HINT_MAX).map(r=>{
    patch.centerRects.push([un(r.x0,r.y0), un(r.x1,r.y0), un(r.x1,r.y1), un(r.x0,r.y1)]);
    return un((r.x0+r.x1)/2, (r.y0+r.y1)/2);
  });
}

// параметр s точки P на цепочке (или null, если P не лежит на ней)
function chainParamOf(ch, P){
  for(let i=1;i<ch.pts.length;i++){
    const A = ch.pts[i-1], B = ch.pts[i];
    const ab = new THREE.Vector3().subVectors(B, A);
    const L2 = ab.lengthSq();
    if(L2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, A).dot(ab)/L2));
    const Q = new THREE.Vector3().copy(A).addScaledVector(ab, t);
    if(Q.distanceTo(P) < 0.02) return ch.cum[i-1] + Math.sqrt(L2)*t;
  }
  return null;
}
// кусок цепочки между параметрами s0..s1 — самостоятельная цепочка
function subChain(ch, s0, s1){
  const pts = [chainPointAt(ch, s0)];
  for(let i=0;i<ch.pts.length;i++)
    if(ch.cum[i] > s0 + 1e-6 && ch.cum[i] < s1 - 1e-6) pts.push(ch.pts[i].clone());
  pts.push(chainPointAt(ch, s1));
  const cum = [0];
  for(let i=1;i<pts.length;i++) cum.push(cum[i-1] + pts[i].distanceTo(pts[i-1]));
  const sc = {pts, cum, total: cum[cum.length-1], closed: false};
  if(ch.isGuide) sc.isGuide = true;
  if(ch.curve) sc.curve = ch.curve;
  return sc;
}
// поставленные точки И концы линий/рёбер режут цепочки: точка на ребре или
// линия, упёршаяся в ребро, делит его на выбираемые куски (как во FreeCAD)
// X-пересечение двух отрезков-линий строго внутри обоих (не в концах)
function guideCrossPoint(g1, g2){
  const d1 = new THREE.Vector3().subVectors(g1.b, g1.a);
  const d2 = new THREE.Vector3().subVectors(g2.b, g2.a);
  const r  = new THREE.Vector3().subVectors(g2.a, g1.a);
  const a=d1.dot(d1), b=d1.dot(d2), c=d2.dot(d2), d=d1.dot(r), e=d2.dot(r);
  const den = a*c - b*b;
  if(Math.abs(den) < 1e-9) return null; // параллельны
  const t = (d*c - b*e)/den, s = (d*b - a*e)/den;
  const L1 = Math.sqrt(a), L2 = Math.sqrt(c);
  if(t*L1 < 0.05 || t*L1 > L1-0.05 || s*L2 < 0.05 || s*L2 > L2-0.05) return null;
  const P1 = g1.a.clone().addScaledVector(d1, t);
  const P2 = g2.a.clone().addScaledVector(d2, s);
  return P1.distanceTo(P2) < 0.01 ? P1 : null; // скрещивающиеся — мимо
}
function splitChainsByAnchors(){
  const cuts = anchors.map(a=>a.pos);
  for(const ch of chains) // конец одной цепочки — резак для других
    if(!ch.closed){ cuts.push(ch.pts[0]); cuts.push(ch.pts[ch.pts.length-1]); }
  // перекрёстки нарисованных линий режут ОБЕ линии: сегмент живёт от
  // перекрёстка до перекрёстка (как рёбра в SketchUp)
  for(let i=0;i<guides.length;i++)
    for(let j=i+1;j<guides.length;j++){
      const P = guideCrossPoint(guides[i], guides[j]);
      if(P) cuts.push(P);
    }
  if(!cuts.length) return;
  const out = [];
  for(const ch of chains){
    if(ch.closed){ out.push(ch); continue; } // замкнутые (окружности) не трогаем
    const ss = [];
    for(const c of cuts){
      const s = chainParamOf(ch, c);
      if(s !== null && s > 0.05 && s < ch.total - 0.05) ss.push(s);
    }
    if(!ss.length){ out.push(ch); continue; }
    ss.sort((x,y)=>x-y);
    let prev = 0;
    for(const s of [...ss, ch.total]){
      if(s - prev < 0.05){ prev = s; continue; }
      out.push(subChain(ch, prev, s));
      prev = s;
    }
  }
  chains = out;
}

function chainPointAt(chain, s){
  s = Math.max(0, Math.min(chain.total, s));
  let i=1;
  while(i<chain.cum.length-1 && chain.cum[i]<s) i++;
  const t=(s-chain.cum[i-1])/Math.max(1e-9, chain.cum[i]-chain.cum[i-1]);
  return new THREE.Vector3().lerpVectors(chain.pts[i-1], chain.pts[i], t);
}

// ---------- маркеры ----------
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
// тёмная обводка вокруг точки (сфера чуть больше, BackSide) — как маркеры FreeCAD
function addOutline(m){
  const o = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial(
    {color: 0x23262c, side: THREE.BackSide}));
  o.scale.setScalar(1.45);
  m.add(o);
  return m;
}
const ghost = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0x4da3ff})));
ghost.visible = false; scene.add(ghost);
// индикатор привязки обязан быть видим всегда: поверх маркеров точек и модели
ghost.material.depthTest = false; ghost.renderOrder = 7;
ghost.children[0].material.depthTest = false; ghost.children[0].renderOrder = 6;

// цвета как во FreeCAD: жёлтый — preselect (наведение), зелёный — selection
const C_EDGE = 0xffcc00, C_MID = 0xffcc00, C_VERT = 0xffcc00, C_SEL = 0x2ecc40;

// вершины модели (углы, где сходятся рёбра) и выбранная вершина
let corners = [];       // [{key, pos:Vector3}]
let cornerHover = null;
let sel = null;         // {pos:Vector3}
const vGhost = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:C_VERT})));
vGhost.visible = false; scene.add(vGhost);
const selMarker = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:C_SEL})));
selMarker.visible = false; scene.add(selMarker);
// маркер цели магнита при перетаскивании (зелёный — вершина, красный — ребро)
const snapDot = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0x52c752})));
snapDot.visible = false; scene.add(snapDot);
// концы выбранного ребра/линии: золотой — начало, серебряный — конец
// (не красный/синий — те визуально привязаны к осям X/Z)
const selEndA = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0xf5c542})));
const selEndB = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0xc9d1dc})));
selEndA.visible = false; selEndB.visible = false;
scene.add(selEndA); scene.add(selEndB);
function hideSelEnds(){ selEndA.visible = false; selEndB.visible = false; }
// центры выбранной грани (бирюзовые, живут пока грань выбрана)
const selCenterDots = [];
for(let i=0;i<5;i++){
  const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0x3fd9c9})));
  m.visible = false; scene.add(m); selCenterDots.push(m);
}
function hideSelCenters(){ for(const m of selCenterDots) m.visible = false; }
function showSelCenters(patch){
  hideSelCenters();
  if(!patch || !patch.centers) return;
  patch.centers.slice(0, selCenterDots.length).forEach((c, i)=>{
    selCenterDots[i].position.copy(c);
    selCenterDots[i].visible = true;
  });
}
function showSelEnds(ch){
  if(!ch || ch.closed){ hideSelEnds(); return; }
  selEndA.position.copy(ch.pts[0]); selEndA.visible = true;
  selEndB.position.copy(ch.pts[ch.pts.length-1]); selEndB.visible = true;
}

// точки-кандидаты: заранее подсвечивают середину ребра / центры грани.
// Непрямоугольная грань (Г, П, G-образная) раскладывается на прямоугольники,
// показываем центр каждого — до HINT_MAX штук.
const HINT_MAX = 5;
const hintDots = [];
for(let i=0;i<HINT_MAX;i++){
  const d = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0x3fd9c9})));
  d.visible = false; scene.add(d);
  hintDots.push(d);
}
let hintLines = []; // пунктирные диагонали-«скотч» у центров-кандидатов
function hideHints(){
  for(const d of hintDots) d.visible = false;
  for(const l of hintLines){ scene.remove(l); l.geometry.dispose(); }
  hintLines = [];
}
function showHintAt(p){
  const d = hintDots.find(x=>!x.visible);
  if(d){ d.position.copy(p); d.visible = true; }
}
// крест по диагоналям прямоугольника: видно, из чего рассчитан центр
function showHintCross(corners, n){
  const lift = c => c.clone().addScaledVector(n, 0.08);
  const g = new THREE.BufferGeometry().setFromPoints([
    lift(corners[0]), lift(corners[2]), lift(corners[1]), lift(corners[3])]);
  const l = new THREE.LineSegments(g, new THREE.LineDashedMaterial(
    {color:0x3a3f47, dashSize:1.2, gapSize:0.9, transparent:true, opacity:0.75}));
  l.computeLineDistances();
  scene.add(l);
  hintLines.push(l);
}
function showHintFor(pt){
  if(pt.chain && !pt.chain.closed && pt.kind !== 'midpoint'){
    showHintAt(chainPointAt(pt.chain, pt.chain.total/2));
  } else if(pt.kind === 'on face' && pt.centers){
    pt.centers.forEach((c, i)=>{
      showHintAt(c);
      const r = pt.centerRects && pt.centerRects[i];
      if(r && pt.faceN) showHintCross(r, pt.faceN);
    });
  }
}

// ---------- выбор грани (лоскут) и его подсветка ----------
let ppPatch=null, ppHi=null;
// мультивыбор областей одной плоскости (Ctrl+клик, FreeCAD: несколько
// профилей — одна экструзия); ppPatch становится композитом частей
let ppParts = null;
function compositeParts(){
  if(!ppParts || !ppParts.length) return null;
  if(ppParts.length === 1) return ppParts[0];
  const tris = [], set = new Set(), keys = new Set();
  let area = 0;
  for(const p of ppParts){
    for(const t of p.tris) if(!set.has(t)){ set.add(t); tris.push(t); }
    for(const k of (p.keys || [])) keys.add(k);
    area += p.area || 0;
  }
  return {tris, set, keys, normal: ppParts[0].normal.clone(),
          area, parts: ppParts.length};
}
// плоскость области: смещение вдоль нормали (для проверки копланарности)
function patchPlaneD(p){
  const pos = mesh.geometry.attributes.position.array, o = p.tris[0]*9;
  return p.normal.x*pos[o] + p.normal.y*pos[o+1] + p.normal.z*pos[o+2];
}
// Ctrl+I — инвертировать выбор (Select → Invert в Blender, Invert Selection
// в SketchUp): выбираются все ДРУГИЕ области той же плоскости с той же
// стороной, выбранные снимаются. Выделил середину — получил всё вокруг,
// дальше E с Ctrl вырезает остальное
function invertFaceSelection(){
  if(!ppParts || !ppParts.length) return false;
  const pos = mesh.geometry.attributes.position.array;
  const base = ppParts[0], n = base.normal, d = patchPlaneD(base);
  const taken = new Set();
  for(const p of ppParts) for(const t of p.tris) taken.add(t);
  const parts = [];
  for(let t=0; t<pos.length/9; t++){
    if(taken.has(t)) continue;
    const o = t*9;
    if(Math.abs(n.x*pos[o] + n.y*pos[o+1] + n.z*pos[o+2] - d) > 0.05) continue;
    const tn = triNormalAt(t);
    if(tn.dot(n) < 0.999) continue;
    const pa = facePatchAt(t);
    let area = 0;
    for(const u of pa.tris){
      taken.add(u);
      const q = u*9;
      const ux=pos[q+3]-pos[q], uy=pos[q+4]-pos[q+1], uz=pos[q+5]-pos[q+2];
      const vx=pos[q+6]-pos[q], vy=pos[q+7]-pos[q+1], vz=pos[q+8]-pos[q+2];
      area += Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) / 2;
    }
    if(area < 1e-4) continue; // вырожденные осколки не выбираем
    pa.area = area;
    parts.push(pa);
  }
  if(!parts.length){ warnTip('Nothing else on this plane'); return false; }
  ppParts = parts;
  ppPatch = compositeParts();
  showPatch(ppPatch, C_SEL);
  showFacePalette();
  return true;
}
// курсор «поворот камеры»: кружок-стрелка, пока в инструменте зажат Ctrl
// (Ctrl+ЛКМ — временная орбита); отпустил Ctrl — снова крестик рисования
const ORBIT_CURSOR = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">' +
  '<path d="M11 3.5a7.5 7.5 0 1 1-6.4 3.6" fill="none" stroke="#10131a" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M11 3.5a7.5 7.5 0 1 1-6.4 3.6" fill="none" stroke="#f2f5fa" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M6.2 2.2l-1.9 5.6 5.8-1.2z" fill="#f2f5fa" stroke="#10131a" stroke-width="1"/>' +
  '</svg>') + '") 11 11, grab';
function updateOrbitCursor(on){
  const toolActive = pointMode || lineMode || circleMode || !!activeTool
    || (typeof offLive !== 'undefined' && !!offLive)
    || (typeof textMode !== 'undefined' && textMode);
  // курсор-орбиту снимаем всегда: окно Extrude могло закрыться (Add/Cut с
  // зажатым Ctrl), пока Ctrl держали, — иначе кружок так и оставался
  if(!on){
    if(canvas.style.cursor === ORBIT_CURSOR) canvas.style.cursor = toolActive ? 'crosshair' : '';
    return;
  }
  if(!toolActive && !exLive) return; // окно Extrude тоже даёт Ctrl-орбиту
  canvas.style.cursor = ORBIT_CURSOR;
}
window.addEventListener('keydown', e=>{ if(e.key === 'Control') updateOrbitCursor(true); });
// Зажатые Ctrl/Shift/Alt: классы на body, по ним в бейджиках белеют слова
// модификаторов. Состояние берём из флагов самого события (а не только из
// нажатия клавиши) — так оно не «залипает», если клавишу отпустили вне окна
function syncModifierClasses(e){
  if(activeTool && activeTool.modChange) activeTool.modChange(e);
  if(typeof exLive !== 'undefined' && exLive && !!(e.ctrlKey || e.metaKey) !== exCtrl){
    exCtrl = !!(e.ctrlKey || e.metaKey); paintExOp();
  }
  const b = document.body.classList;
  b.toggle('ctrlHeld', !!(e.ctrlKey || e.metaKey));
  b.toggle('shiftHeld', !!e.shiftKey);
  b.toggle('altHeld', !!e.altKey);
}
for(const type of ['keydown', 'keyup', 'pointermove', 'pointerdown'])
  window.addEventListener(type, syncModifierClasses, true);
window.addEventListener('blur', ()=>{
  document.body.classList.remove('ctrlHeld', 'shiftHeld', 'altHeld');
  if(typeof exLive !== 'undefined' && exLive && exCtrl){ exCtrl = false; paintExOp(); } // Ctrl отпущен вне окна
});
// слова модификаторов в подписях клавиш оборачиваем автоматически — любые
// нынешние и будущие бейджики получают подсветку без правок в их коде
const MOD_RE = /\b(Ctrl|Cmd|Shift|Alt)\b/g;
const MOD_CLASS = {Ctrl: 'mod-ctrl', Cmd: 'mod-ctrl', Shift: 'mod-shift', Alt: 'mod-alt'};
function markModifierWords(root){
  for(const k of root.querySelectorAll('.key')){
    if(k.querySelector('.mod')) continue;
    // подсвечиваются только строки-команды («Ctrl — cut», «Ctrl+click — …»);
    // в описательных подсказках (.phint, .exline) слова остаются обычным текстом
    if(k.closest('.phint, .exline')) continue;
    const text = k.textContent;
    MOD_RE.lastIndex = 0;
    if(!MOD_RE.test(text)) continue;
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    k.innerHTML = esc(text).replace(MOD_RE, w => '<span class="mod ' + MOD_CLASS[w] + '">' + w + '</span>');
  }
}
window.addEventListener('keyup',   e=>{ if(e.key === 'Control') updateOrbitCursor(false); });
// Alt в линии — модификатор клика; отпущенный одиночный Alt в Windows уводит
// фокус в меню браузера, и следующий клик по сцене терялся
window.addEventListener('keyup', e=>{ if(e.key === 'Alt' && lineMode) e.preventDefault(); });
window.addEventListener('blur', ()=>updateOrbitCursor(false)); // Alt+Tab с зажатым Ctrl


// ---------- «Линия» (L — карандаш SketchUp): чертёжные хорды-направляющие ----------
let lineMode=false, lineStart=null, lastLinePt=null, lineLenStr='', lineDirLock=null, chordG=0;
let lineHostDir=null; // направление ребра, с которого стартовала линия
let lineChain=true; // true — полилиния (G,M / L), false — одиночные отрезки (G,L)
let lineLenLock=null;  // длина из окна Line: мышь задаёт только направление
let lineAngLock=null;  // угол из окна Line (к ребру-хозяину или оси): мышь выбирает сторону
let lineStartN=null;   // нормаль плоскости, в которой начата линия
let lineSnapHtml='';   // привязка конца — показывается в окне, а не у курсора
let lineLast=null;     // только что нарисованный отрезок: {A, B, snap} — правится полем Length
const linePopup = document.getElementById('linePopup');
let guides=[], rubber=null;
const lnb = document.getElementById('lnb');
function setLineMode(on){
  lineMode = on;
  lnb.hidden = !on;
  lineStart = null; lastLinePt = null; lineLenStr = ''; lineDirLock = null; lineLenLock = null; lineAngLock = null; lineStartN = null; lineSnapHtml = '';
  killRubber();
  if(on){ hideChordHint(); setHover(null); tipHide(); if(activeTool) setActiveTool(null); openLinePopup(); }
  else {
    ghost.visible = false; vGhost.visible = false; tipHide();
    // одиночный отрезок только что нарисован — окно остаётся: длину можно поправить
    if(!lineLastValid()) closeLinePopup(); else updateLineInfo();
  }
  canvas.style.cursor = on ? 'crosshair' : ''; // после выключения других режимов
  updateToolTag();
}
function killRubber(){
  if(rubber){ scene.remove(rubber); rubber.geometry.dispose(); rubber=null; }
  killAngleMark();
}
// чертёжный знак прямого угла в точке стыка с ребром-хозяином
let angleMark = null;
function killAngleMark(){
  if(angleMark){ scene.remove(angleMark); angleMark.geometry.dispose(); angleMark = null; }
}
function showAngleMark(at, hostDir, newDir, len){
  killAngleMark();
  const s = Math.max(1.2, Math.min(3, len*0.35));
  const u = hostDir.clone().multiplyScalar(s);
  const v = newDir.clone().multiplyScalar(s);
  const g = new THREE.BufferGeometry().setFromPoints([
    at.clone().add(u), at.clone().add(u).add(v), at.clone().add(v)]);
  angleMark = new THREE.Line(g, new THREE.LineBasicMaterial({color:0xd9534f}));
  scene.add(angleMark);
}
let curveSeq = 0;
// Линия поверх линии не дублируется (как рёбра в SketchUp): участки нового
// отрезка, уже накрытые существующими линиями на той же прямой, пропускаются —
// остаётся старая линия, добавляются только куски за её пределами. Иначе в
// одном месте копились две-пять линий и Del снимал их по одной
function addGuide(A, B, noExt, curve){
  const d = new THREE.Vector3().subVectors(B, A);
  const L = d.length();
  if(L < 1e-6) return;
  const u = d.clone().multiplyScalar(1/L);
  const perp = P => { const w = new THREE.Vector3().subVectors(P, A); return w.addScaledVector(u, -w.dot(u)).length(); };
  const cov = [];
  for(const g of guides){
    if(perp(g.a) > 1e-3 || perp(g.b) > 1e-3) continue; // не на этой прямой
    const t0 = new THREE.Vector3().subVectors(g.a, A).dot(u), t1 = new THREE.Vector3().subVectors(g.b, A).dot(u);
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1));
    if(hi - lo > 1e-6) cov.push([lo, hi]);
  }
  if(!cov.length){ addGuideRaw(A, B, noExt, curve); return; }
  cov.sort((x, y) => x[0] - y[0]);
  let cur = 0;
  for(const [lo, hi] of cov){
    if(lo - cur > 1e-3) addGuideRaw(A.clone().addScaledVector(u, cur), A.clone().addScaledVector(u, lo), noExt, curve);
    cur = Math.max(cur, hi);
  }
  if(L - cur > 1e-3) addGuideRaw(A.clone().addScaledVector(u, cur), B.clone(), noExt, curve);
}
function addGuideRaw(A, B, noExt, curve){
  const g = new THREE.BufferGeometry().setFromPoints([A, B]);
  // сплошная, как обычные рёбра: нарисованная линия — настоящая геометрия
  // (пунктир и в SketchUp, и во FreeCAD — только у вспомогательных построений)
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({color:0x23262c}));
  scene.add(l);
  // noExt: сегмент замкнутого контура (текст) — при расчёте областей его
  // НЕ продлевают на 1 мм за концы (продление рвёт соседние области)
  // curve: id кривой (окружности) — её сегменты выбираются как одно целое
  guides.push({a:A.clone(), b:B.clone(), line:l, noExt: !!noExt, curve: curve || 0});
}
function restoreGuides(list){
  for(const g of guides){ scene.remove(g.line); g.line.geometry.dispose(); }
  guides = [];
  for(const s of list) addGuide(s.a, s.b, s.noExt, s.curve);
}
// точка для рисования: вершина > точка на ребре (0.1 мм) > точка на грани
function linePickPoint(q){
  linePickPoint._faceCenters = null;
  linePickPoint._faceRects = null;
  linePickPoint._faceN = null;
  // поставленная точка — одна на своём месте, ей высший приоритет:
  // грань можно взять где угодно, а точку — только тут
  const an = anchorAt(q);
  if(an) return {pos: an.pos.clone(), kind:'vertex'};
  // квадранты окружностей: точка на оси, проходящей через центр. Выше
  // вершин — квадрант обычно и есть вершина круга, но подпись точнее
  {
    const P = {x:0,y:0,z:0};
    for(const qs of quadSnaps){
      projToQuad(qs.pos, q.cam, q.w, q.h, P);
      if(P.z < 1 && P.z > -1 && Math.hypot(P.x-q.mx, P.y-q.my) < 10 && !isOccluded(q, qs.pos))
        return {pos: qs.pos.clone(), kind: 'quadrant', axis: qs.axis, sign: qs.sign};
    }
  }
  const c = pickCorner(q);
  if(c) return {pos:c.pos.clone(), kind:'vertex'};
  // начало координат — привязка, как вершина (SketchUp): от него можно
  // начать рисовать и на пустой сцене
  {
    const O = new THREE.Vector3();
    const P = projToQuad(O, q.cam, q.w, q.h, {x:0,y:0,z:0});
    if(P.z < 1 && P.z > -1 && Math.hypot(P.x-q.mx, P.y-q.my) < 10 && !isOccluded(q, O))
      return {pos: O, kind: 'origin'};
  }
  // центры дуг/окружностей и центр плоской грани (Snap Center)
  {
    const P = {x:0,y:0,z:0};
    for(const cs of auxSnaps){
      projToQuad(cs, q.cam, q.w, q.h, P);
      if(P.z < 1 && P.z > -1 && Math.hypot(P.x-q.mx, P.y-q.my) < 10)
        return {pos: cs.clone(), kind:'center'};
    }
    const f = raycastFace(q);
    if(f){
      const patch = facePatchCached(f.faceIndex);
      if(patch && patch.centers){
        for(const cs of patch.centers){
          projToQuad(cs, q.cam, q.w, q.h, P);
          if(Math.hypot(P.x-q.mx, P.y-q.my) < 12)
            return {pos: cs.clone(), kind:'center'};
        }
        // центры (грань может состоять из нескольких прямоугольников) —
        // подсказки-кандидаты для hintDots, с их прямоугольниками для «скотча»
        linePickPoint._faceCenters = patch.centers;
        linePickPoint._faceRects = patch.centerRects || null;
        linePickPoint._faceN = patch.normal;
      }
    }
  }
  const h = pickEdge(q);
  if(h){
    // магнит середины ребра/линии — во всех инструментах рисования
    const midP = chainPointAt(h.chain, h.chain.total/2);
    const scr = projToQuad(midP, q.cam, q.w, q.h, {x:0,y:0,z:0});
    // радиус магнита 14 px: при 8 px на крупном плане середину было не поймать
    if(!h.chain.closed && Math.hypot(scr.x-q.mx, scr.y-q.my) < 14)
      return {pos: midP, kind:'midpoint', chain: h.chain, s: h.chain.total/2};
    return {pos:chainPointAt(h.chain, snapMM(h.s)), kind:'on edge', chain: h.chain, s: snapMM(h.s)};
  }
  const f = raycastFace(q);
  if(f){
    const p = f.point.clone();
    p.set(snapMM(p.x), snapMM(p.y), snapMM(p.z));
    return {pos:p, kind:'on face', centers: linePickPoint._faceCenters || null,
            centerRects: linePickPoint._faceRects, faceN: linePickPoint._faceN};
  }
  return null;
}
// Shift как в Draft (FreeCAD): отрезок жёстко вдоль ближайшей мировой оси
function shiftOrtho(from, to){
  const d = new THREE.Vector3().subVectors(to, from);
  const ax = (Math.abs(d.x) >= Math.abs(d.y) && Math.abs(d.x) >= Math.abs(d.z)) ? 'x'
           : (Math.abs(d.y) >= Math.abs(d.z) ? 'y' : 'z');
  const p = from.clone();
  p[ax] += snapMM(d[ax]);
  return {p, ax};
}

// автопривязка к осям как в SketchUp: резинка почти параллельна мировой оси —
// линию притягиваем к оси и красим её цветом; чуть увёл курсор — отпустило
// направление цепочки в точке s (для перпендикуляра от точки на ребре)
function chainDirAt(ch, s){
  const a = chainPointAt(ch, Math.max(0, s-0.5));
  const b = chainPointAt(ch, Math.min(ch.total, s+0.5));
  const d = new THREE.Vector3().subVectors(b, a);
  return d.lengthSq() > 1e-12 ? d.normalize() : null;
}
// цвета пойманных углов: 90 красный, 60 жёлтый, 45 голубой, 30 салатовый
const ANGLE_COLORS = {90: 0xd9534f, 60: 0xffd21f, 45: 0x4fc3ff, 30: 0x6aff3d, 0: 0xe040e0};
const ANGLE_CSS    = {90: '#d9534f', 60: '#ffd21f', 45: '#4fc3ff', 30: '#6aff3d', 0: '#e040e0'};
// угловой инференс к ребру-хозяину: магниты на 0/30/45/60/90 градусов
// (и зеркальные), как транспортир SketchUp; 90 — особый (красный пунктир)
function perpInfer(from, to, faceN){
  if(!lineHostDir) return null;
  const d = new THREE.Vector3().subVectors(to, from);
  const len = d.length();
  if(len < 1.0) return null;
  if(!faceN){ // без плоскости грани ловим только параллель
    if(Math.abs(d.dot(lineHostDir)/len) > 0.996){
      const t = snapMM(d.dot(lineHostDir));
      if(Math.abs(t) < 0.1) return null;
      return {p: from.clone().addScaledVector(lineHostDir, t), kind:'parallel', deg:0};
    }
    return null;
  }
  const n = faceN;
  const dp = d.clone().addScaledVector(n, -d.dot(n)); // проекция в плоскость
  if(dp.lengthSq() < 1e-9) return null;
  const host = lineHostDir.clone().addScaledVector(n, -lineHostDir.dot(n));
  if(host.lengthSq() < 1e-9) return null;
  host.normalize();
  const phi = Math.atan2(
    new THREE.Vector3().crossVectors(host, dp).dot(n), host.dot(dp)) * 180/Math.PI;
  let best = null;
  for(const a of [-180,-150,-135,-120,-90,-60,-45,-30,0,30,45,60,90,120,135,150,180]){
    const diff = Math.abs(phi - a);
    if(diff < 5 && (!best || diff < best.diff)) best = {a, diff};
  }
  if(!best) return null;
  const rad = best.a * Math.PI/180;
  const dir = host.clone().multiplyScalar(Math.cos(rad))
    .add(new THREE.Vector3().crossVectors(n, host).multiplyScalar(Math.sin(rad)));
  const t = snapMM(dp.length());
  if(t < 0.1) return null;
  const deg = Math.min(Math.abs(best.a), 180 - Math.abs(best.a));
  const kind = deg === 90 ? 'perpendicular' : (deg === 0 ? 'parallel' : 'angle');
  return {p: from.clone().addScaledVector(dir, t), kind, deg};
}

function axisInfer(from, to){
  const d = new THREE.Vector3().subVectors(to, from);
  const len = d.length();
  if(len < 1.0) return null;
  let bestAx = null, best = 0.992; // порог ~7 градусов
  for(const ax of ['x','y','z']){
    const c = Math.abs(d[ax]) / len;
    if(c > best){ best = c; bestAx = ax; }
  }
  if(!bestAx) return null;
  const p = from.clone();
  p[bestAx] += snapMM(d[bestAx]);
  return {p, ax: bestAx};
}

// отрезок лежит в плоскости какой-нибудь грани? Линия у нас — режущая
// хорда, «сквозь материю» ей ходить незачем (в отличие от SketchUp)
function segmentOnSomeFace(A, B){
  if(Math.abs(A.z) < 0.01 && Math.abs(B.z) < 0.01) return true; // на земле XY
  const pos = mesh.geometry.attributes.position.array;
  for(let t=0;t<pos.length/9;t++){
    const n = triNormalAt(t);
    const d0 = n.x*pos[t*9] + n.y*pos[t*9+1] + n.z*pos[t*9+2];
    if(Math.abs(n.dot(A) - d0) < 0.05 && Math.abs(n.dot(B) - d0) < 0.05) return true;
  }
  return false;
}
function commitLinePoint(pos){
  if(!lineStart){ lineStart = pos.clone(); }
  else {
    // Линия не на грани — ставим «в воздухе», как в SketchUp: грани не режет,
    // но служит ребром контура — по таким линиям F заливает новую грань
    // (после удаления граней контур для заливки иначе было не собрать)
    const onFace = segmentOnSomeFace(lineStart, pos);
    if(lineStart.distanceTo(pos) < 0.05) return;
    pushUndo();
    addGuide(lineStart, pos);
    if(onFace){ splitMeshByChord(lineStart, pos); healChordCut(); } // врезаем хорду в сетку — как режет линия в SketchUp
    extractEdges();
    // запоминаем отрезок: пока после него ничего не делали, поле Length его правит
    lineLast = {A: lineStart.clone(), B: pos.clone(), snap: undoStack[undoStack.length - 1],
                base: lineAngleBase(), n: (lineStartN || GROUND_N).clone()};
    lineLenLock = null; lineAngLock = null;
    if(lineChain){
      lineStart = pos.clone(); // полилиния продолжает цепочку
    } else {
      lineLenStr = '';
      setLineMode(false); // одиночный отрезок нарисован — инструмент выключается
      return;
    }
  }
  lineLenStr = '';
  updateLineInfo();
}
// ---------- окно Line: точная длина (VCB SketchUp, панель Line в Sketcher) ----------
function lineLastValid(){ // правка возможна, пока после отрезка ничего не делали
  return !!(lineLast && undoStack.length && undoStack[undoStack.length - 1] === lineLast.snap);
}
function openLinePopup(){
  const vr = view.getBoundingClientRect();
  linePopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 350) + 'px';
  linePopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 300) + 'px';
  linePopup.hidden = false;
  updateLineInfo();
}
function closeLinePopup(){ linePopup.hidden = true; releaseToolInput(); killLinePreview(); }
// угол линии меряется к ребру, с которого она начата (как транспортир
// SketchUp и живой угол у курсора), без ребра — к оси плоскости
function lineAngleBase(){
  return lineHostDir ? lineHostDir.clone() : textBasis(lineStartN || GROUND_N).u;
}
function lineAngleDeg(A, B, base){
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  if(len < 0.1 || !base) return null;
  return Math.round(Math.acos(Math.min(1, Math.abs(d.dot(base)) / (len * base.length()))) * 180 / Math.PI);
}
// направление под углом deg к base в плоскости n — из четырёх вариантов
// (±deg от ребра и от обратного ребра) тот, что ближе к подсказке hint
function lineDirAtAngle(base, n, deg, hint){
  const nn = n.clone().normalize(), b = base.clone().addScaledVector(nn, -base.dot(nn));
  if(b.length() < 1e-6) return null;
  b.normalize();
  const side = new THREE.Vector3().crossVectors(nn, b), th = deg * Math.PI / 180;
  let best = null, bd = -Infinity;
  for(const bb of [b, b.clone().negate()]) for(const s of [1, -1]){
    const d = bb.clone().multiplyScalar(Math.cos(th)).addScaledVector(side, s * Math.sin(th)).normalize();
    const dt = d.dot(hint);
    if(dt > bd){ bd = dt; best = d; }
  }
  return best;
}
// конец линии с учётом введённых длины и угла; курсор — только подсказка
function lineLockedEnd(cur){
  if(!lineStart || (!lineLenLock && lineAngLock == null)) return null;
  const v = new THREE.Vector3().subVectors(cur, lineStart);
  if(v.length() < 1e-6) return null;
  let dir = v.clone().normalize(), note = '';
  if(lineAngLock != null){
    const d = lineDirAtAngle(lineAngleBase(), lineStartN || GROUND_N, lineAngLock, v);
    if(d){ dir = d; note += ' · angle ' + lineAngLock + '°'; }
  }
  const len = lineLenLock || Math.max(0.1, snapMM(Math.abs(v.dot(dir))));
  if(lineLenLock) note += ' · length ' + lineLenLock + ' mm';
  return {pos: lineStart.clone().addScaledVector(dir, len), note};
}
function updateLineInfo(){
  if(linePopup.hidden) return;
  const editing = !lineStart && lineLastValid();
  line_state.textContent = lineStart ? 'end' : editing ? 'placed · edit' : 'start';
  if(document.activeElement !== line_len && !linePrev){ // идёт предпросмотр — введённое не трогаем
    line_len.value = lineLenLock ? lineLenLock
      : lineLenStr ? lineLenStr
      : lineStart && lastLinePt ? lineStart.distanceTo(lastLinePt).toFixed(1)
      : editing ? lineLast.A.distanceTo(lineLast.B).toFixed(1) : '';
  }
  // угол: живой при рисовании, у последнего отрезка — после постановки
  const deg = lineStart && lastLinePt ? lineAngleDeg(lineStart, lastLinePt, lineAngleBase())
    : editing ? lineAngleDeg(lineLast.A, lineLast.B, lineLast.base) : null;
  if(document.activeElement !== line_ang && !linePrev) line_ang.value = lineAngLock != null ? lineAngLock : (deg != null ? deg : '');
  const shown = lineAngLock != null ? Math.round(lineAngLock) : deg;
  const css = shown != null ? ANGLE_CSS[shown] || '' : ''; // 90 — красный, 60/45/30 — свои цвета
  line_ang.style.color = css; line_angl.style.color = css; line_angl.style.fontWeight = css ? '700' : '';
  line_snap.innerHTML = lineMode && lineSnapHtml ? lineSnapHtml
    : !lineStart && linePrev ? linePrev.note : '&nbsp;';
  const locks = [lineLenLock ? 'length' : '', lineAngLock != null ? 'angle' : ''].filter(Boolean).join(' and ');
  line_info.innerHTML = lineStart && locks
    ? '<span style="color:#6aff3d">' + locks + ' fixed · the cursor picks the side</span>'
    : editing ? 'new length or angle + Enter redraws the line' : '&nbsp;';
  line_hint.hidden = !hintsChk.checked;
  line_alt.hidden = !(lineMode && lineChain); // Alt+клик — только у полилинии
}
// перерисовать последний отрезок новой длиной от его начала, по тому же направлению
function resizeLastLine(len, newDir){
  if(!lineLastValid()) return false;
  const {A, B} = lineLast;
  const dir = newDir ? newDir.clone() : new THREE.Vector3().subVectors(B, A);
  if(dir.length() < 1e-9) return false;
  const B2 = A.clone().addScaledVector(dir.normalize(), len);
  if(A.distanceTo(B2) < 0.05) return false;
  undo(true);
  pushUndo();
  addGuide(A, B2);
  if(segmentOnSomeFace(A, B2)){ splitMeshByChord(A, B2); healChordCut(); }
  extractEdges();
  lineLast = {A: A.clone(), B: B2, snap: undoStack[undoStack.length - 1], base: lineLast.base, n: lineLast.n};
  updateLineInfo();
  return true;
}
// поле → замок (при рисовании) или правка последнего отрезка (после)
function lineFieldLock(which){
  if(!lineStart) return;
  if(which === 'len'){ const v = snapMM(parseFloat(line_len.value)); lineLenLock = v > 0 ? v : null; }
  else { const a = parseFloat(line_ang.value); lineAngLock = isFinite(a) ? Math.max(0, Math.min(180, a)) : null; }
  updateLineInfo();
}
// куда уйдёт конец поставленного отрезка по введённым длине и углу
function lineEditTarget(){
  const {A, B} = lineLast, oldLen = A.distanceTo(B);
  const L = snapMM(parseFloat(line_len.value)), deg = parseFloat(line_ang.value);
  const len = L > 0 ? L : oldLen;
  const oldDeg = lineAngleDeg(A, B, lineLast.base);
  const oldDir = new THREE.Vector3().subVectors(B, A).normalize();
  const dir = isFinite(deg) && oldDeg != null && Math.abs(deg - oldDeg) > 0.01
    ? lineDirAtAngle(lineLast.base, lineLast.n, Math.max(0, Math.min(180, deg)), oldDir) : null;
  return {len, dir, B2: A.clone().addScaledVector(dir || oldDir, len),
          changed: !!dir || Math.abs(len - oldLen) > 1e-6};
}
function applyLineLen(final){
  if(lineStart){
    // Enter/OK: конец ставится с введёнными длиной/углом, курсор — сторона
    const lk = final && lastLinePt ? lineLockedEnd(lastLinePt) : null;
    if(lk && lk.pos.distanceTo(lineStart) > 0.05){ commitLinePoint(lk.pos); killRubber(); }
    updateLineInfo();
    return;
  }
  if(!final || !lineLastValid()) return;
  const t = lineEditTarget();
  if(t.changed) resizeLastLine(t.len, t.dir);
  killLinePreview();
  updateLineInfo();
}
// Живой предпросмотр правки (как резинка Move/Scale в SketchUp, пока вводишь
// значение в VCB): поле меняется — пунктир от начала до нового конца, точка
// на конце и маркеры привязки модели; конец на вершине, центре или квадранте
// красится цветом этой точки. Сетка не режется, пока не нажат Enter или OK
let linePrev = null; // {line, dot, note}
function killLinePreview(){
  if(!linePrev) return;
  scene.remove(linePrev.line); linePrev.line.geometry.dispose(); linePrev.line.material.dispose();
  scene.remove(linePrev.dot); linePrev.dot.material.dispose();
  linePrev = null;
  killAngleMark();
}
function pointOnMesh(P){ // точка лежит на каком-то треугольнике (с краем)
  if(Math.abs(P.z) < 0.01) return true; // земля
  const pos = mesh.geometry.attributes.position.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tri = new THREE.Triangle();
  const q = new THREE.Vector3();
  for(let o=0;o<pos.length;o+=9){
    a.fromArray(pos, o); b.fromArray(pos, o+3); c.fromArray(pos, o+6);
    tri.set(a, b, c);
    if(tri.closestPointToPoint(P, q).distanceTo(P) < 0.05) return true;
  }
  return false;
}
function lineEndSnapAt(P){ // совпадает ли точка с точкой привязки модели
  const near = Q => Q.distanceTo(P) < 0.05;
  for(const q of quadSnaps) if(near(q.pos)) return {color: AXIS_CSS[q.axis], what: 'quadrant ' + q.axis.toUpperCase()};
  for(const c of auxSnaps) if(near(c)) return {color: 0x3fd9c9, what: 'center'};
  for(const c of corners) if(near(c.pos)) return {color: 0xe8ecf2, what: 'vertex'};
  return null;
}
function updateLinePreview(){
  if(lineStart || !lineLastValid()){ killLinePreview(); return; }
  const t = lineEditTarget();
  if(!t.changed){ killLinePreview(); updateLineInfo(); return; }
  killLinePreview();
  const {A} = lineLast, B2 = t.B2;
  const onFace = segmentOnSomeFace(A, B2) && pointOnMesh(B2);
  const deg = lineAngleDeg(A, B2, lineLast.base);
  const snap = onFace ? lineEndSnapAt(B2) : null;
  const col = !onFace ? 0xd9534f : ANGLE_COLORS[deg] != null && deg !== 0 ? ANGLE_COLORS[deg] : 0x2ecc40;
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B2]),
    new THREE.LineDashedMaterial({color: col, dashSize: 1.4, gapSize: 1.0, depthTest: false}));
  line.computeLineDistances(); line.renderOrder = 5;
  scene.add(line);
  const dot = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial(
    {color: !onFace ? 0xd9534f : snap ? snap.color : 0x2ecc40})));
  dot.position.copy(B2); dot.renderOrder = 6;
  scene.add(dot);
  const note = !onFace ? '<span style="color:#d9534f">end leaves the face · the line won’t cut faces</span>'
    : snap ? 'end on <b>' + snap.what + '</b>' : 'preview · Enter to apply';
  linePrev = {line, dot, note};
  if(deg === 90 && lineLast.base){
    const L = A.distanceTo(B2);
    if(L > 0.3) showAngleMark(A, lineLast.base.clone().normalize(),
      new THREE.Vector3().subVectors(B2, A).normalize(), L);
  }
  updateLineInfo();
}
// при рисовании введённая длина/угол сразу двигают резинку, не дожидаясь мыши
let lineRawPt = null; // курсор до замков — от него берётся сторона
function refreshLineRubber(){
  if(!lineStart || !lineRawPt) return;
  const lk = lineLockedEnd(lineRawPt);
  const pos = lk ? lk.pos : lineRawPt.clone();
  lastLinePt = pos.clone();
  ghost.position.copy(pos);
  killRubber();
  const deg = lineAngleDeg(lineStart, pos, lineAngleBase());
  const col = ANGLE_COLORS[deg] != null && deg !== 0 ? ANGLE_COLORS[deg] : 0x9aa2b1;
  rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([lineStart, pos]),
    new THREE.LineBasicMaterial({color: col}));
  scene.add(rubber);
  updateLineInfo();
}
for(const [inp, which] of [[line_len, 'len'], [line_ang, 'ang']]){
  inp.addEventListener('input', () => {
    if(lineStart){ lineFieldLock(which); refreshLineRubber(); }
    else updateLinePreview();
  });
  inp.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); lineFieldLock(which); applyLineLen(true); releaseToolInput(); }
    if(e.key === 'Escape'){ // Esc в поле: правка отменена, поля — снова по отрезку
      e.preventDefault(); releaseToolInput();
      if(!lineStart){ killLinePreview(); updateLineInfo(); }
    }
    e.stopPropagation(); // цифры поля не уходят в набор длины с клавиатуры
  });
}
document.getElementById('line_ok').addEventListener('click', () => {
  // OK — применить введённое и завершить инструмент (Finish у Draft во FreeCAD)
  // (живую длину резинки OK не ставит — только введённую руками)
  if(lineStart){ if(lineLenLock || lineAngLock != null) applyLineLen(true); }
  else applyLineLen(true); // правит, только если длина или угол изменились
  if(lineMode) setLineMode(false);
  closeLinePopup();
});
// Cancel — выйти мышью, как Esc: начатая (незаконченная) линия пропадает,
// поставленные отрезки остаются; введённое в поля не применяется
document.getElementById('line_cancel').addEventListener('click', () => {
  releaseToolInput();
  killRubber(); tipHide(); ghost.visible = false;
  lineLast = null; // окно правки не держим
  if(lineMode) setLineMode(false);
  closeLinePopup();
});

// Десятичная точка в числовых полях при русской раскладке: клавиша, где
// в латинице «.», даёт «ю» (запятая — «б»), а <input type=number> такие
// символы молча выбрасывает — «5.5» не набиралось. Эти клавиши, запятая и
// точка цифрового блока вставляют «.»: поле на время набора становится
// текстовым (у числового нельзя поставить символ в позицию курсора), а
// на выходе из поля — снова числовым
document.addEventListener('keydown', e => {
  const el = e.target;
  if(!el || el.tagName !== 'INPUT' || (el.type !== 'number' && !el.dataset.numType)) return;
  if(e.key === '.' || e.ctrlKey || e.altKey || e.metaKey) return;
  const dec = e.code === 'Period' || e.code === 'Comma' || e.code === 'NumpadDecimal'
    || e.key === ',' || e.key === 'ю' || e.key === 'б' || e.key === 'Ю' || e.key === 'Б';
  if(!dec) return;
  e.preventDefault();
  if(String(el.value).includes('.')) return;
  if(el.type === 'number'){
    el.dataset.numType = '1';
    el.type = 'text';
    el.addEventListener('blur', () => {
      const v = parseFloat(el.value);
      delete el.dataset.numType;
      el.type = 'number';
      if(isFinite(v)) el.value = v;
    }, {once: true});
    el.setSelectionRange(el.value.length, el.value.length);
  }
  const s = el.selectionStart, t = el.selectionEnd;
  el.value = el.value.slice(0, s) + '.' + el.value.slice(t);
  el.setSelectionRange(s + 1, s + 1);
  el.dispatchEvent(new Event('input', {bubbles: true}));
}, true);

// ---------- «Точка» (G,Y — Create Point в Sketcher FreeCAD) ----------
let pointMode = false;
function setPointMode(on){
  pointMode = on;
  if(on){ hideChordHint(); setLineMode(false); if(typeof circleMode !== 'undefined' && circleMode) setCircleMode(false);
          if(activeTool) setActiveTool(null); setHover(null); tipHide(); }
  else { ghost.visible = false; tipHide(); }
  canvas.style.cursor = on ? 'crosshair' : ''; // после выключения других режимов
  updateToolTag();
}

// ---------- каркас простых инструментов: R, T, Q, круговой массив ----------
// Инструмент — объект с методами on/off/down/move/up/key/esc и строкой hud.
// К событиям мыши и клавиатуры каркас подключён один раз, поэтому новый
// инструмент не требует правок в обработчиках.
function setActiveTool(tool){
  if(activeTool === tool) return;
  const prev = activeTool;
  activeTool = null;
  if(prev) prev.off();
  if(tool){
    hideChordHint(); // палитра выбора не нужна, пока в руке инструмент
    setLineMode(false);
    if(circleMode) setCircleMode(false);
    
    if(pointMode) setPointMode(false);
    if(textMode || txtLive) cancelText();
    setHover(null); tipHide();
    activeTool = tool;
    tool.on();
  }
  toolb.hidden = !tool;
  if(tool) toolb.innerHTML = tool.hud + '<br>';
  canvas.style.cursor = tool ? 'crosshair' : ''; // после выключения других режимов
  updateToolTag();
}
// точка под курсором на плоскости (за краем грани — тоже: черчение в воздухе)
function rayOnPlane(q, n, P0){
  raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, P0), hit)
    ? hit : null;
}
// цвет оси, вдоль которой лежит направление (для подписи размеров)
function axisCssOf(dir){
  if(Math.abs(dir.x) > 0.99) return AXIS_CSS.x;
  if(Math.abs(dir.y) > 0.99) return AXIS_CSS.y;
  if(Math.abs(dir.z) > 0.99) return AXIS_CSS.z;
  return 'var(--text)';
}
// привязанная точка для старта инструмента: магниты + проекция в плоскость грани
function pickOnFace(q){
  const f = raycastFace(q);
  const pt = linePickPoint(q);
  if(f && pt){
    const n = triNormalAt(f.faceIndex);
    const off = new THREE.Vector3().subVectors(pt.pos, f.point).dot(n);
    return {pos: pt.pos.clone().addScaledVector(n, -off), n, kind: pt.kind, pt, faceIndex: f.faceIndex};
  }
  if(f) return null;
  return pickGround(q, pt);
}
// Плоскость земли XY через начало координат (ground plane в SketchUp):
// под курсором нет грани — рисуем на ней. Привязки, лежащие на земле
// (начало координат, концы и середины линий), берутся точно, иначе шаг 0.1
const GROUND_N = new THREE.Vector3(0, 0, 1);
// маркер начала координат: салатовый, как «center» — точка, от которой
// можно начать (виден, пока включён рисующий инструмент)
const originMarker = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color: 0x6aff3d})));
originMarker.visible = false; scene.add(originMarker);
function pickGround(q, pt){
  if(pt && Math.abs(pt.pos.z) < 0.01)
    return {pos: new THREE.Vector3(pt.pos.x, pt.pos.y, 0), n: GROUND_N.clone(), kind: pt.kind, pt, ground: true};
  const h = rayOnPlane(q, GROUND_N, new THREE.Vector3());
  if(!h) return null;
  return {pos: new THREE.Vector3(snapMM(h.x), snapMM(h.y), 0), n: GROUND_N.clone(), kind: 'on ground', ground: true};
}
// Плоскость выбранных линий/точки: два непараллельных сегмента задают
// нормаль; одна прямая или точка — плоскость XY мира
function itemsPlaneNormal(items){
  const dirs = items.segs.map(sg => new THREE.Vector3().subVectors(sg.B, sg.A)).filter(d => d.lengthSq() > 1e-9);
  for(let i=0;i<dirs.length;i++) for(let j=i+1;j<dirs.length;j++){
    const n = new THREE.Vector3().crossVectors(dirs[i], dirs[j]);
    if(n.lengthSq() > 1e-6 * dirs[i].lengthSq() * dirs[j].lengthSq()) return n.normalize();
  }
  return null;
}
// центр для поворота/массива: на грани — её плоскость; в воздухе (середина
// висящей окружности, конец линии) — плоскость самих выбранных линий
function pickToolCenter(q, items){
  const pk = pickOnFace(q);
  if(pk) return pk;
  const pt = linePickPoint(q);
  if(!pt) return null;
  const n = itemsPlaneNormal(items) || new THREE.Vector3(0, 0, 1);
  return {pos: pt.pos.clone(), n, kind: pt.kind, pt};
}
function showPickGhost(e, q, label){
  const pt = linePickPoint(q);
  if(!pt){ ghost.visible = false; tipHide(); return null; }
  ghost.material.color.setHex(pt.kind==='vertex' || pt.kind==='center' ? C_VERT : C_EDGE);
  ghost.position.copy(pt.pos); ghost.visible = true;
  showHintFor(pt);
  tipAt(e, label + kindLabel(pt.kind));
  return pt;
}

// R — Прямоугольник (Rectangle в SketchUp): угол → противоположный угол.
// Лежит в плоскости грани по её осям; W,H + Enter — точный размер
const rectTool = {
  hud: 'RECTANGLE · click a corner, then drag or click · Ctrl — from center · Shift — square · W,H in the window · Esc — exit',
  start: null, n: null, u: null, v: null, end: null, str: '', downAt: null, ring: null,
  mods: {ctrl: false, shift: false},
  patch: null, snapKind: '', exact: false, // второй угол прилип к ориентиру — размер точный
  lockW: null, lockH: null, // размер из окна: мышь задаёт только направление
  last: null,               // только что поставленный: {A, u, v, n, sw, sh, w, h, snap}
  fieldT: 0,
  // Ctrl — от центра (SketchUp), Shift — квадрат (Figma/Illustrator/Inkscape;
  // в SketchUp Shift фиксирует подсказку Square). Держим, а не щёлкаем
  modChange(e){
    const m = {ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey};
    if(m.ctrl === this.mods.ctrl && m.shift === this.mods.shift) return;
    this.mods = m;
    if(this.start) this.preview();
  },
  wantsCtrlClick(){ return !!this.start; }, // Ctrl+клик ставит угол, а не крутит камеру
  on(){
    this.reset(); this.last = null; this.lockW = null; this.lockH = null;
    rect_w.value = ''; rect_h.value = '';
    const vr = view.getBoundingClientRect();
    rectPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 350) + 'px';
    rectPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 420) + 'px';
    rectPopup.hidden = false;
    this.ui();
  },
  off(){
    clearTimeout(this.fieldT);
    this.reset(); ghost.visible = false; tipHide(); hidePlaneTargets();
    rectPopup.hidden = true; releaseToolInput();
  },
  reset(){ this.start = null; this.end = null; this.str = ''; this.downAt = null; this.kill();
    this.patch = null; this.snapKind = ''; this.exact = false; },
  kill(){ if(this.ring){ scene.remove(this.ring); this.ring.geometry.dispose(); this.ring = null; } },
  lastValid(){ return !!(this.last && undoStack.length && undoStack[undoStack.length-1] === this.last.snap); },
  lastEdges(){ // рёбра только что поставленного — пока его правят, они не ориентиры
    if(!this.lastValid()) return null;
    const L = this.last;
    const A = L.A, B = A.clone().addScaledVector(L.u, L.sw * L.w);
    const C = B.clone().addScaledVector(L.v, L.sh * L.h), D = A.clone().addScaledVector(L.v, L.sh * L.h);
    return [[A, B], [B, C], [C, D], [D, A]];
  },
  typed(){ return this.lockW != null && this.lockH != null; },
  corners(){
    const d = new THREE.Vector3().subVectors(this.end, this.start);
    // прилипший угол — точный размер (до вершины/середины), свободный — шаг 0.1
    const rnd = this.exact ? (x => Math.round(x*1000)/1000) : snapMM;
    const du = d.dot(this.u), dv = d.dot(this.v);
    let w = rnd(du), h = rnd(dv);
    const half = this.mods.ctrl ? 0.5 : 1; // от центра: курсор — половина размера
    if(this.lockW != null) w = (Math.sign(du) || 1) * this.lockW * half;
    if(this.lockH != null) h = (Math.sign(dv) || 1) * this.lockH * half;
    if(this.mods.shift && !this.typed()){ // квадрат: сторона по большему смещению
      const m = Math.max(Math.abs(w), Math.abs(h));
      w = (Math.sign(w) || 1) * m; h = (Math.sign(h) || 1) * m;
    }
    // от центра: start — центр, курсор — угол, противоположный угол зеркален
    const A = this.mods.ctrl
      ? this.start.clone().addScaledVector(this.u, -w).addScaledVector(this.v, -h)
      : this.start.clone();
    const W = this.mods.ctrl ? 2 * w : w, H = this.mods.ctrl ? 2 * h : h;
    const B = A.clone().addScaledVector(this.u, W);
    const C = B.clone().addScaledVector(this.v, H);
    const D = A.clone().addScaledVector(this.v, H);
    return {A, B, C, D, w: W, h: H};
  },
  drawRing(c){
    this.kill();
    if(Math.abs(c.w) >= 0.1 && Math.abs(c.h) >= 0.1){
      this.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints([c.A, c.B, c.C, c.D, c.A]),
        new THREE.LineBasicMaterial({color: C_EDGE}));
      scene.add(this.ring);
    }
  },
  // окно: состояние, размеры, привязка, площадь
  ui(c){
    const live = !!this.start;
    const placed = !live && this.lastValid();
    rect_state.textContent = live ? 'size' : (placed ? 'placed' : 'corner')
      + (!live && this.typed() ? ' · fixed size' : '');
    let W = null, H = null;
    if(live && c){ W = Math.abs(c.w); H = Math.abs(c.h); }
    else if(placed){ W = this.last.w; H = this.last.h; }
    else if(this.typed()){ W = this.lockW; H = this.lockH; }
    const fmt = x => x == null || x < 0.05 ? '' : +x.toFixed(3);
    if(document.activeElement !== rect_w) rect_w.value = fmt(W);
    if(document.activeElement !== rect_h) rect_h.value = fmt(H);
    const u = live ? this.u : (placed ? this.last.u : null), v = live ? this.v : (placed ? this.last.v : null);
    rect_wl.style.color = u ? axisCssOf(u) : ''; rect_hl.style.color = v ? axisCssOf(v) : '';
    let h = '';
    if(this.snapKind) h += circSnapHtml(live ? 'Corner' : 'First corner', this.snapKind);
    if(W && H){
      const square = Math.abs(W - H) < 1e-6;
      h += (h ? '<br>' : '') + (W*H).toFixed(1) + ' mm²'
        + (square ? ' · <span style="color:#6aff3d;font-weight:700">square</span>' : '')
        + (live && this.mods.ctrl ? ' · <span style="color:#6aff3d;font-weight:700">from center</span>' : '');
    }
    if(!live && this.typed() && !placed) h += (h ? '<br>' : '') + '<span style="color:#6aff3d">click — place ' + this.lockW + ' × ' + this.lockH + '</span>';
    rect_info.innerHTML = h || '&nbsp;';
    rect_hint.hidden = !hintsChk.checked;
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(!this.start){
      const pk = pickOnFace(q);
      if(!pk) return;
      this.start = pk.pos; this.n = pk.n;
      this.patch = pk.faceIndex !== undefined ? facePatchCached(pk.faceIndex) : null;
      const b = textBasis(pk.n); this.u = b.u; this.v = b.v;
      this.end = this.start.clone();
      this.downAt = {x: e.clientX, y: e.clientY};
      this.last = null;
      if(this.typed()){ // размер задан в окне — клик ставит прямоугольник
        const half = this.mods.ctrl ? 0.5 : 1;
        this.end = this.start.clone().addScaledVector(this.u, this.lockW * half).addScaledVector(this.v, this.lockH * half);
        this.downAt = null;
        this.commit();
      }
    } else this.commit();
  },
  move(e, q){
    if(!q.inside){ ghost.visible = false; tipHide(); return; }
    this.mods = {ctrl: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey};
    if(!this.start){
      // ориентиры плоскости под курсором: вершины, середины рёбер, центры
      const pk0 = pickOnFace(q);
      if(pk0 && pk0.faceIndex !== undefined) showPlaneTargets(pk0.n, pk0.pos, facePatchCached(pk0.faceIndex), this.lastEdges());
      else if(pk0) showPlaneTargets(GROUND_N, new THREE.Vector3(), null, this.lastEdges());
      else hidePlaneTargets();
      if(pk0){
        ghost.material.color.setHex(pk0.kind==='vertex' || pk0.kind==='center' || pk0.kind==='origin' ? C_VERT : C_EDGE);
        ghost.position.copy(pk0.pos); ghost.visible = true;
      } else ghost.visible = false;
      tipHide(); // привязка — в окне
      this.snapKind = pk0 ? pk0.kind : '';
      // размер задан — призрак прямоугольника едет за курсором
      const pk = this.typed() ? pickOnFace(q) : null;
      if(pk){
        const b = textBasis(pk.n);
        const k = this.mods.ctrl ? 0.5 : 1;
        const A = this.mods.ctrl ? pk.pos.clone().addScaledVector(b.u, -this.lockW * k).addScaledVector(b.v, -this.lockH * k) : pk.pos.clone();
        const B = A.clone().addScaledVector(b.u, this.lockW), C = B.clone().addScaledVector(b.v, this.lockH), D = A.clone().addScaledVector(b.v, this.lockH);
        this.drawRing({A, B, C, D, w: this.lockW, h: this.lockH});
      } else this.kill();
      this.ui();
      return;
    }
    showPlaneTargets(this.n, this.start, this.patch);
    // второй угол липнет к вершине, середине, центру, ребру этой плоскости
    const pt = linePickPoint(q);
    const off = pt ? new THREE.Vector3().subVectors(pt.pos, this.start).dot(this.n) : 1;
    if(pt && pt.kind !== 'on face' && Math.abs(off) < 0.05){
      this.end = pt.pos.clone().addScaledVector(this.n, -off);
      this.snapKind = pt.kind; this.exact = pt.kind !== 'on edge';
      ghost.material.color.setHex(pt.kind==='vertex' || pt.kind==='center' ? C_VERT : C_EDGE);
      ghost.position.copy(this.end); ghost.visible = true;
    } else {
      ghost.visible = false;
      this.snapKind = ''; this.exact = false;
      const P = rayOnPlane(q, this.n, this.start);
      if(P) this.end = P;
    }
    this.preview(e);
  },
  preview(){
    const c = this.corners();
    this.drawRing(c);
    tipHide(); // размеры — в окне прямоугольника
    this.ui(c);
  },
  up(e){
    if(!this.start || !this.downAt) return false;
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
    this.downAt = null;
    if(moved){ this.commit(); return true; } // тянули и отпустили — прямоугольник встал
    return false;
  },
  key(e){
    if(!this.start) return false;
    const k = e.key;
    if(/^[0-9.]$/.test(k) || k === ',' || k === ';' || k === '*' || k === 'x' || k === 'X'){
      this.str += /^[0-9.]$/.test(k) ? k : ',';
      this.preview(); e.preventDefault(); return true;
    }
    if(k === 'Backspace'){ this.str = this.str.slice(0, -1); this.preview(); e.preventDefault(); return true; }
    if(k === 'Enter'){
      const parts = this.str.split(',').map(t => parseFloat(t));
      if(parts.length === 2 && parts.every(t => t > 0)){
        this.lockW = snapMM(parts[0]); this.lockH = snapMM(parts[1]);
        this.commit();
      } else if(this.typed()) this.commit();
      e.preventDefault(); return true;
    }
    return false;
  },
  esc(){ // первый Esc отменяет начатый прямоугольник, второй выходит
    if(!this.start) return false;
    this.reset(); tipHide(); hidePlaneTargets(); ghost.visible = false; this.ui(); return true;
  },
  // поля W/H: до угла — размер следующего, при растягивании — вместо мыши,
  // после постановки — перерисовать только что поставленный
  field(final){
    clearTimeout(this.fieldT);
    const w = parseFloat(rect_w.value), h = parseFloat(rect_h.value);
    this.lockW = w > 0 ? snapMM(w) : null;
    this.lockH = h > 0 ? snapMM(h) : null;
    if(this.start){
      this.preview();
      if(final && this.typed()) this.commit();
      return;
    }
    if(this.lastValid() && this.typed()){
      const run = ()=>this.recommit();
      if(final) run(); else this.fieldT = setTimeout(run, 200);
      return;
    }
    this.ui();
  },
  recommit(){
    if(!this.lastValid() || !this.typed()) return;
    const L = this.last;
    undo(true);
    this.start = L.A.clone(); this.n = L.n.clone(); this.u = L.u.clone(); this.v = L.v.clone();
    this.mods = {ctrl: false, shift: false};
    this.end = this.start.clone().addScaledVector(this.u, L.sw * this.lockW).addScaledVector(this.v, L.sh * this.lockH);
    this.commit();
  },
  commit(){
    const c = this.corners();
    if(Math.abs(c.w) < 0.1 || Math.abs(c.h) < 0.1) return;
    pushUndo();
    const snap = undoStack[undoStack.length-1];
    // замкнутый контур, как у текста: точный барьер заливки (noExt) и рез
    // по всем задетым треугольникам — внутренняя область станет гранью
    for(const [a, b] of [[c.A, c.B], [c.B, c.C], [c.C, c.D], [c.D, c.A]]){
      addGuide(a, b, true);
      splitMeshByChord(a, b, true);
    }
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    cleanupMesh();
    extractEdges();
    this.last = {A: c.A.clone(), u: this.u.clone(), v: this.v.clone(), n: this.n.clone(),
      sw: Math.sign(c.w) || 1, sh: Math.sign(c.h) || 1, w: Math.abs(c.w), h: Math.abs(c.h), snap};
    this.lockW = null; this.lockH = null;
    this.reset(); tipHide(); hidePlaneTargets(); ghost.visible = false;
    this.ui();
  }
};
makeGripDrag(rectPopup);
markModifierWords(rectPopup);
markModifierWords(document.getElementById('linePopup')); // Alt+click — белеет только Alt
markModifierWords(document.getElementById('emPopup'));   // Shift — белеет только Shift
for(const inp of [rect_w, rect_h]){
  inp.addEventListener('input', ()=>{ if(activeTool === rectTool) rectTool.field(false); });
  inp.addEventListener('blur', ()=>{ const v = parseFloat(inp.value); if(v > 0) inp.value = snapMM(v); });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === rectTool) rectTool.field(true); releaseToolInput(); }
    if(e.key === 'Escape'){ e.preventDefault(); releaseToolInput(); }
    e.stopPropagation();
  });
}
// OK — поставить начатый прямоугольник (если размер есть) и выйти из инструмента
rect_ok.addEventListener('click', ()=>{
  if(activeTool !== rectTool) return;
  clearTimeout(rectTool.fieldT);
  if(rectTool.start){ const c = rectTool.corners(); if(Math.abs(c.w) >= 0.1 && Math.abs(c.h) >= 0.1) rectTool.commit(); }
  setActiveTool(null);
});

// дельты по осям в их цветах — одной строкой
function axisTriple(dx, dy, dz){
  return '<span style="color:' + AXIS_CSS.x + '">ΔX ' + dx.toFixed(1) + '</span> · '
       + '<span style="color:' + AXIS_CSS.y + '">ΔY ' + dy.toFixed(1) + '</span> · '
       + '<span style="color:' + AXIS_CSS.z + '">ΔZ ' + dz.toFixed(1) + '</span>';
}
// T — Рулетка (Tape Measure в SketchUp): расстояние между двумя точками с
// магнитами и его разложение по осям. Замер держится на экране до нового
const tapeTool = {
  hud: 'TAPE MEASURE · click two points · Esc — clear, Esc — exit',
  a: null, b: null, line: null, dots: [],
  on(){ this.clear(); },
  off(){ this.clear(); ghost.visible = false; tipHide(); hideChordHint(); },
  clear(){
    this.a = null; this.b = null;
    if(this.line){ scene.remove(this.line); this.line.geometry.dispose(); this.line = null; }
    for(const m of this.dots) scene.remove(m);
    this.dots = [];
  },
  addDot(P){
    const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color: 0xf5c542})));
    m.position.copy(P); scene.add(m); this.dots.push(m);
  },
  drawLine(A, B){
    if(this.line){ scene.remove(this.line); this.line.geometry.dispose(); }
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]),
      new THREE.LineDashedMaterial({color: 0xf5c542, dashSize: 1.2, gapSize: 0.8}));
    this.line.computeLineDistances();
    scene.add(this.line);
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    const pt = linePickPoint(q);
    if(!pt) return;
    if(!this.a || this.b){ // новый замер
      this.clear(); hideChordHint();
      this.a = pt.pos.clone(); this.addDot(this.a);
    } else {
      this.b = pt.pos.clone(); this.addDot(this.b);
      this.drawLine(this.a, this.b);
      ghost.visible = false;
      this.pin();
    }
  },
  move(e, q){
    if(!q.inside){ ghost.visible = false; tipHide(); return; }
    if(!this.a || this.b){ showPickGhost(e, q, 'Tape · from: '); return; }
    const pt = showPickGhost(e, q, '');
    if(!pt) return;
    this.drawLine(this.a, pt.pos);
    const d = new THREE.Vector3().subVectors(pt.pos, this.a);
    tipAt(e, 'Distance <b>' + d.length().toFixed(1) + '</b> mm · ' + kindLabel(pt.kind)
      + '<br>' + axisTriple(d.x, d.y, d.z));
  },
  pin(){ // итог замера — в перетаскиваемой палитре, как данные выбранного объекта
    const d = new THREE.Vector3().subVectors(this.b, this.a);
    const vr = view.getBoundingClientRect();
    chordHint.innerHTML = CH_GRIP +
      '<div style="color:var(--text);font-weight:600">Tape<br>Distance ' + d.length().toFixed(1) + ' mm'
      + '<br><span style="color:' + AXIS_CSS.x + '">ΔX ' + d.x.toFixed(1) + '</span>'
      + '<br><span style="color:' + AXIS_CSS.y + '">ΔY ' + d.y.toFixed(1) + '</span>'
      + '<br><span style="color:' + AXIS_CSS.z + '">ΔZ ' + d.z.toFixed(1) + '</span></div>'
      + (!hintsChk.checked ? '' :
        '<div><span class="key">Click</span> — new measurement</div>'
        + '<div style="opacity:.55">Esc — clear</div>');
    chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 380) + 'px';
    chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 220) + 'px';
    chordHint.hidden = false;
    clearTimeout(showChordHint._t);
    tipHide();
  },
  esc(){ // первый Esc стирает замер, второй выходит из рулетки
    if(!this.a) return false;
    this.clear(); hideChordHint(); tipHide(); return true;
  }
};

// красное короткое сообщение у курсора
// Ошибки и предупреждения. Если открыто окно или палитра, блок встаёт над
// ним той же ширины (места сверху мало — под ним), иначе — у курсора.
// Держится 2.8 с
const WARN_ANCHORS = ['chordHint', 'exPopup', 'circPopup', 'rectPopup', 'linePopup', 'emPopup', 'offPopup', 'bevPopup', 'slicePopup', 'cylPopup', 'profPopup', 'mirPopup', 'xfPopup', 'shellPopup', 'rotPopup',
  'arrPopup', 'txtPopup', 'divPopup', 'vpanel', 'popup'];
function warnTip(msg){
  const box = document.getElementById('warnBox');
  box.textContent = msg;
  box.hidden = false;
  delete box.dataset.placed;
  placeWarn();
  clearTimeout(warnTip._t);
  warnTip._t = setTimeout(()=>{ box.hidden = true; }, 2800);
  if(!warnTip._loop){ // пока виден — следит за окном (его ширина, перетаскивание)
    warnTip._loop = true;
    const tick = ()=>{ if(box.hidden){ warnTip._loop = false; return; } placeWarn(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
}
function placeWarn(){
  const box = document.getElementById('warnBox');
  const vr = view.getBoundingClientRect();
  let anchor = null;
  for(const id of WARN_ANCHORS){
    const el = document.getElementById(id);
    if(el && !el.hidden && el.offsetWidth > 0){ anchor = el.getBoundingClientRect(); break; }
  }
  if(anchor){
    box.style.width = anchor.width + 'px';
    box.style.whiteSpace = 'normal';
    const h = box.offsetHeight, gap = 8;
    let top = anchor.top - vr.top - h - gap;              // над окном
    if(top < 0) top = anchor.bottom - vr.top + gap;       // сверху тесно — под окном
    if(top + h > vr.height) top = Math.max(0, anchor.top - vr.top - h - gap); // и снизу тесно
    box.style.left = (anchor.left - vr.left) + 'px';
    box.style.top = top + 'px';
  } else if(!box.dataset.placed || box.style.width){
    box.style.width = ''; box.style.whiteSpace = 'nowrap';
    box.style.left = Math.min(lastMX - vr.left + 16, vr.width - box.offsetWidth - 8) + 'px';
    box.style.top = Math.min(lastMY - vr.top + 12, vr.height - box.offsetHeight - 8) + 'px';
  }
  box.dataset.placed = '1';
}
// нарисованная линия, на которой лежит отрезок A-B (линия может быть длиннее)
function guideFor(A, B){
  for(const g of guides){
    const d = new THREE.Vector3().subVectors(g.b, g.a);
    const L = d.length();
    if(L < 1e-6) continue;
    const u = d.multiplyScalar(1/L);
    const vA = new THREE.Vector3().subVectors(A, g.a), vB = new THREE.Vector3().subVectors(B, g.a);
    const tA = vA.dot(u), tB = vB.dot(u);
    if(vA.addScaledVector(u, -tA).length() > 0.02 || vB.addScaledVector(u, -tB).length() > 0.02) continue;
    if(Math.max(tA, tB) < 0.05 || Math.min(tA, tB) > L - 0.05) continue;
    return g;
  }
  return null;
}
// Что умеют крутить и копировать Q и круговой массив: выбранные нарисованные
// линии (по сегментам между перекрёстками) или выбранная точка. Сетку тела
// не трогаем — поворот её части исказил бы деталь
function collectRotItems(){
  const segs = [];
  for(const es of edgeSel){
    if(!es.isGuide) continue;
    for(let i=0;i+1<es.pts.length;i++){
      const A = es.pts[i].clone(), B = es.pts[i+1].clone();
      const g = guideFor(A, B);
      segs.push({A, B, noExt: g ? !!g.noExt : false, curve: g ? (g.curve || 0) : 0});
    }
  }
  return {segs, pts: selAnchor ? [selAnchor.pos.clone()] : [], anchor: selAnchor};
}
// поставить повёрнутую копию; curveMap: старый id кривой -> id копии
function placeRotated(items, center, n, angle, curveMap){
  const qn = new THREE.Quaternion().setFromAxisAngle(n, angle);
  const rot = P => P.clone().sub(center).applyQuaternion(qn).add(center);
  for(const sg of items.segs){
    let cv = 0;
    if(sg.curve){
      if(!curveMap.has(sg.curve)) curveMap.set(sg.curve, ++curveSeq);
      cv = curveMap.get(sg.curve);
    }
    const A2 = rot(sg.A), B2 = rot(sg.B);
    addGuide(A2, B2, sg.noExt, cv);
    splitMeshByChord(A2, B2, !!(sg.noExt || sg.curve));
  }
  for(const P of items.pts) makeAnchor(rot(P));
}
// пунктирные призраки повёрнутых копий для предпросмотра
function rotGhosts(items, center, n, angles){
  const objs = [];
  const mat = new THREE.LineDashedMaterial({color: C_EDGE, dashSize: 1.0, gapSize: 0.6});
  for(const a of angles){
    const qn = new THREE.Quaternion().setFromAxisAngle(n, a);
    const rot = P => P.clone().sub(center).applyQuaternion(qn).add(center);
    const pts = [];
    for(const sg of items.segs) pts.push(rot(sg.A), rot(sg.B));
    if(pts.length){
      const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat);
      l.computeLineDistances(); scene.add(l); objs.push(l);
    }
    for(const P of items.pts){
      const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color: C_EDGE})));
      m.position.copy(rot(P)); scene.add(m); objs.push(m);
    }
  }
  return objs;
}
function killObjs(objs){
  for(const o of objs){ scene.remove(o); if(o.geometry && o.geometry !== sphereGeo) o.geometry.dispose(); }
  objs.length = 0;
}
// точка в плоскости инструмента: с магнитами, а без них — просто под курсором
function planePick(q, n, P0){
  const pt = linePickPoint(q);
  if(pt){
    const off = new THREE.Vector3().subVectors(pt.pos, P0).dot(n);
    return {pos: pt.pos.clone().addScaledVector(n, -off), kind: pt.kind};
  }
  const h = rayOnPlane(q, n, P0);
  return h ? {pos: h, kind: 'on plane'} : null;
}
function rotItemsEmpty(it){ return !it.segs.length && !it.pts.length; }
// короткое нажатие Ctrl (без клика и других клавиш) — переключатель
// «копия», как в SketchUp; зажатый Ctrl с мышью по-прежнему крутит камеру
let ctrlTapT = 0, ctrlTapDirty = true;
window.addEventListener('keydown', e=>{
  if(e.key === 'Control'){ if(!e.repeat){ ctrlTapT = performance.now(); ctrlTapDirty = false; } }
  else ctrlTapDirty = true;
});
window.addEventListener('pointerdown', ()=>{ ctrlTapDirty = true; }, true);
window.addEventListener('keyup', e=>{
  if(e.key !== 'Control' || ctrlTapDirty) return;
  if(performance.now() - ctrlTapT >= 450) return;
  if(activeTool && activeTool.ctrlTap) activeTool.ctrlTap();
});

// Q — Поворот (Rotate в SketchUp): центр → опорное направление → угол.
// Протрактор лежит в плоскости грани (или выбранных линий), липнет к 15°.
// Всё — в перетаскиваемом окне: шаги, привязка, угол, Move/Copy, число копий
const rotTool = {
  get hud(){
    return 'ROTATE · pivot → reference → angle · type ° + Enter · Ctrl — copy: '
      + (this.copy ? '<span style="color:#6aff3d">ON</span>' : 'off') + ' · Esc';
  },
  items: null, center: null, n: null, ref: null, angle: 0, copy: false, str: '',
  ghosts: [], rubber: null, aLock: false, snapped: false, snapHtml: '',
  on(){
    this.center = null; this.ref = null; this.angle = 0; this.str = ''; this.copy = false;
    this.aLock = false; this.snapHtml = '';
    rot_n.value = 1; rot_a.value = '';
    const vr = view.getBoundingClientRect();
    rotPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 360) + 'px';
    rotPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 420) + 'px';
    rotPopup.hidden = false;
    this.ui();
  },
  off(){ this.clearView(); ghost.visible = false; tipHide(); rotPopup.hidden = true; releaseToolInput(); },
  clearView(){
    killObjs(this.ghosts);
    if(this.rubber){ scene.remove(this.rubber); this.rubber.geometry.dispose(); this.rubber = null; }
  },
  drawRubber(A, B){
    if(this.rubber){ scene.remove(this.rubber); this.rubber.geometry.dispose(); }
    this.rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([A, B]),
      new THREE.LineDashedMaterial({color: 0xf5c542, dashSize: 1.2, gapSize: 0.8}));
    this.rubber.computeLineDistances();
    scene.add(this.rubber);
  },
  copies(){ return this.copy ? Math.max(1, Math.min(360, Math.round(+rot_n.value || 1))) : 1; },
  angles(a){ const out = []; for(let k=1;k<=this.copies();k++) out.push(a * k); return out; },
  showGhosts(){
    killObjs(this.ghosts);
    if(this.center && Math.abs(this.angle) > 1e-9)
      this.ghosts = rotGhosts(this.items, this.center, this.n, this.angles(this.angle));
  },
  // окно: текущий шаг, привязка, угол, режим
  ui(){
    const step = !this.center ? 0 : (!this.ref && !this.aLock ? 1 : 2);
    [...rot_steps.children].forEach((li, i) => { li.className = i < step ? 'done' : (i === step ? 'cur' : ''); });
    rot_state.textContent = this.copy ? 'copy' : 'move';
    rot_move.classList.toggle('on', !this.copy);
    rot_copy.classList.toggle('on', this.copy);
    rot_n.disabled = !this.copy;
    const deg = this.angle * 180 / Math.PI;
    if(document.activeElement !== rot_a)
      rot_a.value = (this.ref || this.aLock) && Math.abs(deg) > 1e-9 ? +deg.toFixed(2) : '';
    let h = this.snapHtml || '';
    if(this.center && (this.ref || this.aLock) && Math.abs(deg) > 1e-9){
      h += (h ? ' · ' : '') + '<b>' + deg.toFixed(1) + '°</b>'
        + (this.snapped ? ' <span style="color:#6aff3d">15° step</span>' : '')
        + (this.copy ? ' · ' + this.copies() + (this.copies() === 1 ? ' copy' : ' copies') : '');
    }
    if(this.str) h += (h ? '<br>' : '') + 'typed ' + this.str + '° (Enter)';
    rot_info.innerHTML = h || '&nbsp;';
    rot_hint.hidden = !hintsChk.checked;
    rot_ok.disabled = !(this.center && Math.abs(this.angle) > 1e-9);
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(!this.center){
      const pk = pickToolCenter(q, this.items);
      if(!pk) return;
      this.center = pk.pos; this.n = pk.n; this.snapHtml = '';
      this.ui();
      return;
    }
    if(this.aLock){ this.apply(this.angle); return; } // угол введён в окне — клик применяет
    const pk = planePick(q, this.n, this.center);
    if(!pk) return;
    const dir = pk.pos.clone().sub(this.center);
    if(dir.length() < 0.3) return;
    if(!this.ref){ this.ref = dir.normalize(); this.ui(); return; }
    this.apply(this.angle);
  },
  move(e, q){
    if(!q.inside){ ghost.visible = false; tipHide(); return; }
    if(!this.center){
      const pt = showPickGhost(e, q, '');
      tipHide(); // привязка — в окне
      this.snapHtml = pt ? circSnapHtml('Pivot', pt.kind) : '<span style="color:var(--muted)">Pivot → move over a point</span>';
      this.ui();
      return;
    }
    ghost.visible = false;
    if(this.aLock) return; // угол введён числом — мышь его не меняет
    const pk = planePick(q, this.n, this.center);
    if(!pk) return;
    this.drawRubber(this.center, pk.pos);
    const dir = pk.pos.clone().sub(this.center);
    this.snapHtml = this.ref ? '' : circSnapHtml('Reference', pk.kind);
    if(this.ref && dir.length() > 1e-6){
      let a = Math.atan2(new THREE.Vector3().crossVectors(this.ref, dir).dot(this.n), this.ref.dot(dir));
      const deg = a * 180 / Math.PI, near = Math.round(deg / 15) * 15;
      this.snapped = Math.abs(deg - near) < 2.5;
      if(this.snapped) a = near * Math.PI / 180;
      this.angle = a;
      this.showGhosts();
    }
    this.ui();
  },
  setCopy(on){
    this.copy = on;
    toolb.innerHTML = this.hud + '<br>';
    this.showGhosts();
    this.ui();
  },
  ctrlTap(){ this.setCopy(!this.copy); },
  // угол из окна/клавиатуры: предпросмотр сразу, мышь больше не крутит
  setAngleDeg(deg){
    if(!isFinite(deg)){ this.aLock = false; this.ui(); return; }
    this.angle = deg * Math.PI / 180; this.aLock = true; this.snapped = false;
    this.showGhosts(); this.ui();
  },
  key(e){
    if(!this.center) return false;
    const k = e.key;
    if(/^[0-9.]$/.test(k) || (k === '-' && !this.str)){ this.str += k; this.ui(); e.preventDefault(); return true; }
    if(k === 'Backspace' && this.str){ this.str = this.str.slice(0, -1); this.ui(); e.preventDefault(); return true; }
    if(k === 'Enter'){
      const deg = parseFloat(this.str);
      this.str = '';
      if(isFinite(deg)) this.apply(deg * Math.PI / 180);
      else if(Math.abs(this.angle) > 1e-9) this.apply(this.angle);
      e.preventDefault(); return true;
    }
    return false;
  },
  esc(){ // первый Esc сбрасывает начатый поворот, второй выходит
    if(!this.center) return false;
    this.center = null; this.ref = null; this.str = ''; this.angle = 0; this.aLock = false;
    this.clearView(); tipHide(); this.ui(); return true;
  },
  apply(angle){
    if(!this.center){ warnTip('Click the pivot first'); return; }
    if(Math.abs(angle) < 1e-9){ this.esc(); return; }
    pushUndo();
    if(!this.copy){
      // перенос: исходные сегменты стираются, кривая сохраняет свой id
      const curveMap = new Map();
      for(const sg of this.items.segs){
        eraseGuideSegment(sg.A, sg.B);
        if(sg.curve) curveMap.set(sg.curve, sg.curve);
      }
      const an = this.items.anchor;
      if(an){
        const i = anchors.indexOf(an);
        scene.remove(an.marker);
        if(i >= 0) anchors.splice(i, 1);
      }
      placeRotated(this.items, this.center, this.n, angle, curveMap);
    } else {
      // копии: каждая следующая ещё на один угол дальше, у каждой своя кривая
      for(const a of this.angles(angle)) placeRotated(this.items, this.center, this.n, a, new Map());
    }
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    clearEdgeSel(); deselect(); hideChordHint();
    setActiveTool(null);
    cleanupMesh();
    extractEdges();
  }
};
makeGripDrag(rotPopup);
rot_move.addEventListener('click', ()=>{ if(activeTool === rotTool) rotTool.setCopy(false); });
rot_copy.addEventListener('click', ()=>{ if(activeTool === rotTool) rotTool.setCopy(true); });
rot_n.addEventListener('input', ()=>{ if(activeTool === rotTool){ rotTool.showGhosts(); rotTool.ui(); } });
rot_a.addEventListener('input', ()=>{
  if(activeTool !== rotTool) return;
  const v = parseFloat(rot_a.value);
  rotTool.setAngleDeg(rot_a.value === '' ? NaN : v);
});
for(const inp of [rot_a, rot_n]){
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){
      e.preventDefault(); releaseToolInput();
      if(activeTool === rotTool && rotTool.center && Math.abs(rotTool.angle) > 1e-9) rotTool.apply(rotTool.angle);
    }
    if(e.key === 'Escape'){ e.preventDefault(); releaseToolInput(); }
    e.stopPropagation();
  });
}
rot_ok.addEventListener('click', ()=>{ if(activeTool === rotTool) rotTool.apply(rotTool.angle); });
rot_cancel.addEventListener('click', ()=>setActiveTool(null));

// ---------- Тело: Mirror (G,I) и Move / Copy / Scale (G,B) ----------
// Тело — связная часть сетки: треугольники, сцепленные общими вершинами
// (по ключу 0.001 мм). Преобразование — матрица; зеркало разворачивает
// обход. Одна функция applyBodyTransform для окон и MCP mirror_body /
// transform_body
function bodyComponents(pos){
  const n = pos.length / 9, parent = new Int32Array(n);
  for(let i=0;i<n;i++) parent[i] = i;
  const find = i => { while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const owner = new Map();
  for(let t=0;t<n;t++) for(let e=0;e<3;e++){
    const o = t*9 + e*3, k = keyOf(pos[o], pos[o+1], pos[o+2]);
    const u = owner.get(k);
    if(u === undefined) owner.set(k, t);
    else { const a = find(u), b = find(t); if(a !== b) parent[a] = b; }
  }
  const comp = new Int32Array(n);
  for(let t=0;t<n;t++) comp[t] = find(t);
  return comp;
}
function bodyTrisOf(comp, tri){
  const r = comp[tri], out = [];
  for(let t=0;t<comp.length;t++) if(comp[t] === r) out.push(t);
  return out;
}
function bodyCount(comp){ return new Set(comp).size; }
function mirrorMatrix(P, n){
  const u = n.clone().normalize(), d = 2 * u.dot(P);
  return new THREE.Matrix4().set(
    1-2*u.x*u.x, -2*u.x*u.y, -2*u.x*u.z, d*u.x,
    -2*u.y*u.x, 1-2*u.y*u.y, -2*u.y*u.z, d*u.y,
    -2*u.z*u.x, -2*u.z*u.y, 1-2*u.z*u.z, d*u.z,
    0, 0, 0, 1);
}
function scaleMatrix(C, s){
  return new THREE.Matrix4().makeTranslation(C.x, C.y, C.z)
    .multiply(new THREE.Matrix4().makeScale(s.x, s.y, s.z))
    .multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
}
function bodyBox(pos, tris){
  const b = new THREE.Box3(), v = new THREE.Vector3();
  for(const t of tris) for(let k=0;k<3;k++) b.expandByPoint(v.fromArray(pos, t*9 + k*3));
  return b;
}
// треугольники тела через матрицу, координаты до 0.001 мм (как у булевых);
// у зеркала (det < 0) обход разворачивается — нормали снова наружу
function bodyTrisTransformed(pos, tris, M){
  const flip = M.determinant() < 0, q3 = x => Math.round(x*1000) / 1000, v = new THREE.Vector3(), out = [];
  for(const t of tris){
    const p = [0, 1, 2].map(k => { v.fromArray(pos, t*9 + k*3).applyMatrix4(M); return new THREE.Vector3(q3(v.x), q3(v.y), q3(v.z)); });
    out.push(flip ? [p[0], p[2], p[1]] : p);
  }
  return out;
}
// призрак: копии тела полупрозрачным мешем
function bodyGhost(pos, tris, mats, color){
  const g = new THREE.Group(), v = new THREE.Vector3();
  for(const M of mats){
    const arr = new Float32Array(tris.length * 9);
    let o = 0;
    for(const t of tris) for(let k=0;k<3;k++){ v.fromArray(pos, t*9 + k*3).applyMatrix4(M); arr[o++] = v.x; arr[o++] = v.y; arr[o++] = v.z; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide})));
  }
  g.renderOrder = 5;
  scene.add(g);
  return g;
}
function killGroup(g){ if(g){ scene.remove(g); g.traverse(o => { if(o.geometry) o.geometry.dispose(); }); } return null; }
// tris — треугольники тела (null — вся модель); mats — по матрице на копию;
// keep — оригинал остаётся (Copy, Mirror Join), иначе тело заменяется
// первой копией. Копия, чей габарит задевает остальное, объединяется точной
// булевой, остальные просто добавляются. Линии на теле едут вместе с ним
function applyBodyTransform(tris, mats, keep){
  const pos = mesh.geometry.attributes.position.array, nT = pos.length / 9;
  if(!nT) throw new Error('the model is empty');
  const body = tris || Array.from({length: nT}, (_, i) => i);
  const inBody = new Uint8Array(nT);
  for(const t of body) inBody[t] = 1;
  const V = (arr, o) => new THREE.Vector3(arr[o], arr[o+1], arr[o+2]);
  let cur = [];
  for(let t=0;t<nT;t++) if(keep || !inBody[t]) cur.push([V(pos, t*9), V(pos, t*9+3), V(pos, t*9+6)]);
  const boxOf = list => { const b = new THREE.Box3(); for(const t of list) for(const p of t) b.expandByPoint(p); return b; };
  const v0 = meshVolumeOf(pos), snap = takeSnapshot();
  let usedBool = false;
  for(const M of mats){
    const piece = bodyTrisTransformed(pos, body, M);
    // булева — только если габарит копии задевает хоть один треугольник
    const pb = boxOf(piece).expandByScalar(0.01), tb0 = new THREE.Box3();
    const touches = cur.some(t => { tb0.makeEmpty(); tb0.expandByPoint(t[0]); tb0.expandByPoint(t[1]); tb0.expandByPoint(t[2]); return tb0.intersectsBox(pb); });
    if(touches){
      const arr = meshBoolean(cur, piece, 'union');
      usedBool = true;
      cur = [];
      for(let o=0;o<arr.length;o+=9) cur.push([V(arr, o), V(arr, o+3), V(arr, o+6)]);
    } else cur = cur.concat(piece);
  }
  if(!cur.length) throw new Error('the result is empty');
  // линии и жёсткие рёбра на теле: концы и середина лежат на его треугольниках
  const bbox = bodyBox(pos, body).expandByScalar(0.05);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tri = new THREE.Triangle(), q = new THREE.Vector3(), tb = new THREE.Box3();
  const onBody = P => {
    if(!bbox.containsPoint(P)) return false;
    for(const t of body){
      a.fromArray(pos, t*9); b.fromArray(pos, t*9+3); c.fromArray(pos, t*9+6);
      tb.makeEmpty(); tb.expandByPoint(a); tb.expandByPoint(b); tb.expandByPoint(c);
      if(tb.distanceToPoint(P) > 0.02) continue;
      tri.set(a, b, c);
      if(tri.closestPointToPoint(P, q).distanceTo(P) < 0.02) return true;
    }
    return false;
  };
  const segOnBody = (A, B) => onBody(A) && onBody(B) && onBody(A.clone().add(B).multiplyScalar(0.5));
  const moveSegs = (list, make) => {
    const out = [];
    for(const s of list){
      const on = segOnBody(s.a, s.b);
      if(!on || keep) out.push(make(s, s.a.clone(), s.b.clone()));
      if(on) for(const M of (keep ? mats : mats.slice(0, 1))) out.push(make(s, s.a.clone().applyMatrix4(M), s.b.clone().applyMatrix4(M)));
    }
    return out;
  };
  const newGuides = moveSegs(guides, (g, A, B) => ({a: A, b: B, noExt: g.noExt, curve: g.curve}));
  const newHard = moveSegs(hardEdges, (h, A, B) => ({a: A, b: B}));
  const arr = new Float32Array(cur.length * 9);
  let o = 0;
  for(const t of cur) for(const p of t){ arr[o++] = p.x; arr[o++] = p.y; arr[o++] = p.z; }
  pushHistory(snap);
  setMeshFromArray(arr);
  cleanupMesh();
  if(openEdgeCount() > 0) healAll();
  hardEdges = newHard;
  restoreGuides(newGuides);
  lastBoolPath = usedBool ? 'exact' : '';
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  clearEdgeSel(); deselect(); hidePatch(); ppPatch = null;
  extractEdges();
  return Object.assign({volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3)}, zcSummary());
}
// тело под точкой на поверхности (для MCP): null — вся модель
function zcBodyAt(point){
  if(point == null) return null;
  const t = zcFaceAt(zcV3(point, 'body_point'));
  if(t < 0) throw new Error('body_point is not on the surface of the model');
  return bodyTrisOf(bodyComponents(mesh.geometry.attributes.position.array), t);
}
// прозрачная плоскость-квадрат с рамкой: размер — по габариту модели
function toolPlaneGroup(P, n, color){
  const pos = mesh.geometry.attributes.position.array, box = new THREE.Box3();
  for(let i=0;i<pos.length;i+=3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i+1], pos[i+2]));
  const S = box.getSize(new THREE.Vector3()).length() * 0.6 + 5;
  const C = box.getCenter(new THREE.Vector3());
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(2*S, 2*S),
    new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false})));
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-S,-S],[S,-S],[S,S],[-S,S]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
    new THREE.LineBasicMaterial({color})));
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  g.position.copy(C.addScaledVector(n, n.dot(new THREE.Vector3().subVectors(P, C))));
  g.renderOrder = 4;
  scene.add(g);
  return g;
}
// общий выбор тела для окон: наведение подсвечивает связную часть, клик берёт
const bodyPick = {
  comp: null, hoverRoot: -1,
  reset(){ this.comp = bodyComponents(mesh.geometry.attributes.position.array); this.hoverRoot = -1; },
  single(){ return bodyCount(this.comp) <= 1; },
  hover(e, q, label){
    const h = raycastFace(q);
    if(!h){ if(this.hoverRoot !== -1){ hidePatch(); this.hoverRoot = -1; } tipHide(); return null; }
    const r = this.comp[h.faceIndex];
    if(r !== this.hoverRoot){ showPatch({tris: bodyTrisOf(this.comp, h.faceIndex)}, 0x4da3ff); this.hoverRoot = r; }
    tipAt(e, label + ' · click the body · Enter — the whole model');
    return h;
  },
  take(q){
    const h = raycastFace(q);
    return h ? bodyTrisOf(this.comp, h.faceIndex) : null;
  }
};
const fmtVol = v => Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');

// ---------- G,I — Mirror (Mirror во Fusion, Flip в SketchUp) ----------
// тело (одно тело в модели — сразу вся модель) → плоскость: клик по грани
// или X/Y/Z через начало, Offset сдвигает её по нормали. Join — оригинал и
// отражённая копия сливаются (половинка детали → целая), Flip — тело
// переворачивается на ту сторону
const mirTool = {
  hud: 'MIRROR · click a body (Enter — the whole model) → click a face for the plane or X/Y/Z · Join / Flip · Enter — apply · Esc — back',
  stage: 'body', tris: null, axis: 'face', P0: null, n: null, mode: 'join', ghostG: null, plane: null,
  on(){
    bodyPick.reset();
    this.tris = null; this.axis = 'face'; this.P0 = null; this.n = null; this.mode = 'join';
    this.stage = bodyPick.single() ? 'plane' : 'body';
    mir_off.value = '0';
    mirPopup.style.left = '16px'; mirPopup.style.top = '48px';
    mirPopup.hidden = false;
    this.ui();
  },
  off(){
    this.ghostG = killGroup(this.ghostG); this.plane = killGroup(this.plane);
    hidePatch(); tipHide(); mirPopup.hidden = true; releaseToolInput();
  },
  offset(){ const v = parseFloat(String(mir_off.value).replace(',', '.')); return Number.isFinite(v) ? v : 0; },
  planeP(){ return this.P0.clone().addScaledVector(this.n, this.offset()); },
  matrix(){ return mirrorMatrix(this.planeP(), this.n); },
  draw(){
    this.ghostG = killGroup(this.ghostG); this.plane = killGroup(this.plane);
    if(!this.n) return;
    const pos = mesh.geometry.attributes.position.array;
    const body = this.tris || Array.from({length: pos.length / 9}, (_, i) => i);
    this.plane = toolPlaneGroup(this.planeP(), this.n, 0x4da3ff);
    this.ghostG = bodyGhost(pos, body, [this.matrix()], 0x2ecc40);
  },
  setAxis(a){
    if(this.stage === 'body') this.stage = 'plane';
    this.axis = a;
    if(a !== 'face'){
      this.P0 = new THREE.Vector3(); this.n = new THREE.Vector3(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0);
      this.stage = 'ready';
    } else if(this.stage === 'ready'){ this.stage = 'plane'; this.P0 = null; this.n = null; }
    this.draw(); this.ui();
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 'body'){
      const t = bodyPick.take(q);
      if(!t){ warnTip('Click a body to mirror, or Enter for the whole model'); return; }
      this.tris = t; this.stage = 'plane'; tipHide(); this.ui();
      return;
    }
    if(this.stage === 'plane'){
      const h = raycastFace(q);
      if(!h){ warnTip('Click a face for the mirror plane, or press X/Y/Z'); return; }
      const r3 = x => Math.round(x*1000) / 1000;
      this.P0 = new THREE.Vector3(r3(h.point.x), r3(h.point.y), r3(h.point.z));
      this.n = triNormalAt(h.faceIndex).clone().normalize();
      this.axis = 'face'; this.stage = 'ready';
      if(!this.tris) hidePatch();
      tipHide(); this.draw(); this.ui();
      return;
    }
    if(this.stage === 'ready') this.commit();
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 'body'){ bodyPick.hover(e, q, 'Mirror'); return; }
    if(this.stage === 'plane'){
      const h = raycastFace(q);
      if(!h){ tipHide(); return; }
      this.P0 = h.point.clone(); this.n = triNormalAt(h.faceIndex).clone().normalize();
      this.draw();
      this.P0 = null; this.n = null; // только предпросмотр — плоскость ставит клик
      tipAt(e, 'Mirror plane · click the face');
    }
  },
  key(e){
    const k = e.key.toLowerCase();
    if(this.stage !== 'body' && (k === 'x' || k === 'y' || k === 'z')){ e.preventDefault(); this.setAxis(k); return true; }
    if(e.key === 'Enter'){
      e.preventDefault();
      if(this.stage === 'body'){ this.tris = null; this.stage = 'plane'; hidePatch(); tipHide(); this.ui(); }
      else if(this.stage === 'ready') this.commit();
      return true;
    }
    return false;
  },
  esc(){
    if(this.stage === 'ready'){ this.stage = 'plane'; this.P0 = null; this.n = null; this.axis = 'face'; this.draw(); this.ui(); return true; }
    if(this.stage === 'plane' && !bodyPick.single()){ this.stage = 'body'; this.tris = null; this.draw(); hidePatch(); bodyPick.hoverRoot = -1; this.ui(); return true; }
    return false;
  },
  ui(){
    mir_state.textContent = {body: 'pick a body', plane: 'pick the plane', ready: this.mode}[this.stage];
    for(const [id, a] of [['mir_face', 'face'], ['mir_x', 'x'], ['mir_y', 'y'], ['mir_z', 'z']])
      document.getElementById(id).classList.toggle('on', this.axis === a && this.stage === 'ready');
    mir_join.classList.toggle('on', this.mode === 'join');
    mir_flip.classList.toggle('on', this.mode === 'flip');
    mir_off.disabled = this.stage !== 'ready';
    mir_hint.hidden = !hintsChk.checked;
    mir_ok.disabled = this.stage !== 'ready';
    const what = this.tris ? 'Body of ' + this.tris.length + ' triangles' : 'Whole model';
    if(this.stage === 'body'){ mir_info.textContent = 'Click the body to mirror · Enter — the whole model'; return; }
    if(this.stage === 'plane'){ mir_info.textContent = what + ' · click a face for the plane or X/Y/Z'; return; }
    const pos = mesh.geometry.attributes.position.array;
    let v = 0;
    if(this.tris){ for(const t of this.tris){ const o = t*9; v += (pos[o]*(pos[o+4]*pos[o+8]-pos[o+5]*pos[o+7]) - pos[o+1]*(pos[o+3]*pos[o+8]-pos[o+5]*pos[o+6]) + pos[o+2]*(pos[o+3]*pos[o+7]-pos[o+4]*pos[o+6])) / 6; } }
    else v = meshVolumeOf(pos);
    const P = this.planeP();
    mir_info.innerHTML = what + ' · ' + fmtVol(Math.abs(v)) + ' mm³ · plane ' + (this.axis === 'face' ? 'on the face' : this.axis.toUpperCase() + ' = ' + +P.dot(this.n).toFixed(3))
      + ' · <b>' + (this.mode === 'join' ? 'Join' : 'Flip') + '</b>';
  },
  commit(){
    if(this.stage !== 'ready'){ warnTip('Pick the mirror plane first'); return; }
    const tris = this.tris, M = this.matrix(), keep = this.mode === 'join';
    this.ghostG = killGroup(this.ghostG); this.plane = killGroup(this.plane);
    try{ applyBodyTransform(tris, [M], keep); }
    catch(err){ warnTip('Mirror failed: ' + err.message); this.draw(); return; }
    setActiveTool(null);
  }
};

// ---------- G,B — Move / Copy / Scale тела (Move/Copy во Fusion, Move и Scale в SketchUp) ----------
// Move: базовая точка (привязки) → куда (привязки; X/Y/Z — по оси) или
// поля ΔX/ΔY/ΔZ. Scale: поля Scale % и по осям, опорная точка — низ-центр
// габарита (деталь остаётся на столе) или центр. Copy — оригинал остаётся;
// у Move копий может быть несколько, каждая на шаг дальше (линейный массив)
const xfTool = {
  get hud(){
    return 'MOVE / SCALE BODY · click a body (Enter — whole model) · Move: base point → target, X/Y/Z — along an axis, or type ΔX/ΔY/ΔZ · Scale: type % · short Ctrl — copy: '
      + (this.copy ? '<span style="color:#6aff3d">ON</span>' : 'off') + ' · Enter — apply · Esc — back';
  },
  stage: 'body', tris: null, mode: 'move', copy: false, base: null, target: null, axisLock: null, pivotKind: 'bottom', ghostG: null, rubber: null,
  on(){
    bodyPick.reset();
    this.tris = null; this.base = null; this.target = null; this.axisLock = null; this.copy = false;
    this.stage = bodyPick.single() ? 'edit' : 'body';
    for(const el of [xf_dx, xf_dy, xf_dz, xf_sx, xf_sy, xf_sz]) el.value = '';
    xf_s.value = ''; xf_n.value = '1';
    xfPopup.style.left = '16px'; xfPopup.style.top = '48px';
    xfPopup.hidden = false;
    this.ui();
  },
  off(){
    this.ghostG = killGroup(this.ghostG); this.killRubber();
    ghost.visible = false; hidePatch(); tipHide(); xfPopup.hidden = true; releaseToolInput();
  },
  killRubber(){ if(this.rubber){ scene.remove(this.rubber); this.rubber.geometry.dispose(); this.rubber = null; } },
  num(el){ const v = parseFloat(String(el.value).replace(',', '.')); return Number.isFinite(v) ? v : null; },
  typedDelta(){ return [xf_dx, xf_dy, xf_dz].some(el => this.num(el) != null); },
  delta(){
    if(this.typedDelta()) return new THREE.Vector3(this.num(xf_dx) || 0, this.num(xf_dy) || 0, this.num(xf_dz) || 0);
    return this.base && this.target ? this.target.clone().sub(this.base) : null;
  },
  factors(){
    const u = this.num(xf_s), f = el => { const v = this.num(el); return v != null ? v : u; };
    const s = [f(xf_sx), f(xf_sy), f(xf_sz)];
    if(s.some(x => x == null)) return s.every(x => x == null) ? null : new THREE.Vector3(...s.map(x => (x == null ? 100 : x) / 100));
    return new THREE.Vector3(s[0] / 100, s[1] / 100, s[2] / 100);
  },
  copies(){ return this.copy && this.mode === 'move' ? Math.max(1, Math.min(100, Math.round(+xf_n.value || 1))) : 1; },
  bodyIdx(){ const pos = mesh.geometry.attributes.position.array; return this.tris || Array.from({length: pos.length / 9}, (_, i) => i); },
  pivot(){
    const b = bodyBox(mesh.geometry.attributes.position.array, this.bodyIdx()), C = b.getCenter(new THREE.Vector3());
    if(this.pivotKind === 'bottom') C.z = b.min.z;
    return C;
  },
  mats(){
    if(this.mode === 'move'){
      const d = this.delta();
      if(!d || d.length() < 1e-4) return null;
      return Array.from({length: this.copies()}, (_, k) => new THREE.Matrix4().makeTranslation(d.x*(k+1), d.y*(k+1), d.z*(k+1)));
    }
    const s = this.factors();
    if(!s) return null;
    if([s.x, s.y, s.z].some(x => !(x > 0))) return 'bad';
    if(Math.abs(s.x-1) < 1e-9 && Math.abs(s.y-1) < 1e-9 && Math.abs(s.z-1) < 1e-9) return null;
    return [scaleMatrix(this.pivot(), s)];
  },
  draw(){
    this.ghostG = killGroup(this.ghostG);
    const m = this.mats();
    if(Array.isArray(m)) this.ghostG = bodyGhost(mesh.geometry.attributes.position.array, this.bodyIdx(), m, 0x2ecc40);
    this.killRubber();
    if(this.mode === 'move' && this.base && this.target && !this.typedDelta()){
      const col = this.axisLock ? {x: 0xff5a5a, y: 0x2ecc40, z: 0x4da3ff}[this.axisLock] : 0xf5c542;
      this.rubber = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.base, this.target]),
        new THREE.LineDashedMaterial({color: col, dashSize: 1.2, gapSize: 0.8, depthTest: false}));
      this.rubber.computeLineDistances(); this.rubber.renderOrder = 6;
      scene.add(this.rubber);
    }
  },
  setMode(m){ this.mode = m; this.base = null; this.target = null; this.axisLock = null; ghost.visible = false; this.draw(); this.ui(); },
  setCopy(on){ this.copy = on; toolb.innerHTML = this.hud + '<br>'; this.draw(); this.ui(); },
  ctrlTap(){ if(this.stage === 'edit') this.setCopy(!this.copy); },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 'body'){
      const t = bodyPick.take(q);
      if(!t){ warnTip('Click a body, or Enter for the whole model'); return; }
      this.tris = t; this.stage = 'edit'; tipHide(); this.ui();
      return;
    }
    if(this.mode !== 'move' || this.typedDelta()){ if(this.mats()) this.commit(); return; }
    if(!this.base){
      const pk = pickOnFace(q);
      if(!pk){ warnTip('Click the base point — a vertex, edge or face point'); return; }
      this.base = pk.pos.clone(); this.target = pk.pos.clone(); ghost.visible = false;
      this.ui(); return;
    }
    if(this.mats()) this.commit();
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 'body'){ bodyPick.hover(e, q, 'Move / Scale'); return; }
    if(this.mode !== 'move' || this.typedDelta()){ ghost.visible = false; return; }
    if(!this.base){ showPickGhost(e, q, 'Base point · '); return; }
    if(this.axisLock){
      const dir = new THREE.Vector3(this.axisLock === 'x' ? 1 : 0, this.axisLock === 'y' ? 1 : 0, this.axisLock === 'z' ? 1 : 0);
      raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
      const pk = pickOnFace(q);
      // по оси: точка привязки проецируется на ось, иначе — ближайшая к лучу
      const t = pk && pk.kind && pk.kind !== 'on face' && pk.kind !== 'on ground'
        ? new THREE.Vector3().subVectors(pk.pos, this.base).dot(dir) : snapMM(rayLineParam(raycaster.ray, this.base, dir));
      this.target = this.base.clone().addScaledVector(dir, t);
      ghost.visible = false;
    } else {
      const pk = showPickGhost(e, q, '');
      const p2 = pickOnFace(q);
      if(p2) this.target = p2.pos.clone();
      void pk;
    }
    this.draw(); this.ui();
    const d = this.delta();
    if(d) tipAt(e, (this.axisLock ? this.axisLock.toUpperCase() + ' · ' : '') + '<b>' + d.length().toFixed(1) + '</b> mm · click to ' + (this.copy ? 'copy' : 'move'));
  },
  key(e){
    const k = e.key.toLowerCase();
    if(e.key === 'Enter'){
      e.preventDefault();
      if(this.stage === 'body'){ this.tris = null; this.stage = 'edit'; hidePatch(); tipHide(); this.ui(); }
      else this.commit();
      return true;
    }
    if(this.stage === 'edit' && this.mode === 'move' && this.base && (k === 'x' || k === 'y' || k === 'z')){
      e.preventDefault(); this.axisLock = this.axisLock === k ? null : k; this.ui(); return true;
    }
    return false;
  },
  esc(){
    if(this.stage !== 'edit') return false;
    if(this.base){ this.base = null; this.target = null; this.axisLock = null; this.draw(); tipHide(); this.ui(); return true; }
    if(!bodyPick.single()){ this.stage = 'body'; this.tris = null; this.draw(); hidePatch(); bodyPick.hoverRoot = -1; this.ui(); return true; }
    return false;
  },
  ui(){
    xf_state.textContent = this.stage === 'body' ? 'pick a body' : (this.copy ? 'copy' : this.mode);
    xf_move.classList.toggle('on', this.mode === 'move');
    xf_scale.classList.toggle('on', this.mode === 'scale');
    xf_rows_move.hidden = this.mode !== 'move';
    xf_rows_scale.hidden = this.mode !== 'scale';
    xf_off.classList.toggle('on', !this.copy);
    xf_copy.classList.toggle('on', this.copy);
    xf_n.disabled = !(this.copy && this.mode === 'move');
    xf_bottom.classList.toggle('on', this.pivotKind === 'bottom');
    xf_center.classList.toggle('on', this.pivotKind === 'center');
    xf_hint.hidden = !hintsChk.checked;
    const m = this.mats();
    xf_ok.disabled = !(this.stage === 'edit' && Array.isArray(m));
    // мышь показывает смещение в полях (пока их не правят руками)
    if(this.mode === 'move' && !this.typedDelta()){
      const d = this.base && this.target ? this.target.clone().sub(this.base) : null;
      for(const [el, c] of [[xf_dx, 'x'], [xf_dy, 'y'], [xf_dz, 'z']]) el.placeholder = d ? d[c].toFixed(1) : '0';
    }
    if(this.stage === 'body'){ xf_info.textContent = 'Click the body · Enter — the whole model'; return; }
    const what = this.tris ? 'Body' : 'Whole model';
    if(m === 'bad'){ xf_info.style.color = '#ff6b6b'; xf_info.textContent = 'Scale must be above 0 %'; return; }
    xf_info.style.color = '';
    const b = bodyBox(mesh.geometry.attributes.position.array, this.bodyIdx()), sz = b.getSize(new THREE.Vector3());
    const dims = s => [s.x, s.y, s.z].map(x => +x.toFixed(2)).join(' × ');
    if(this.mode === 'move'){
      const d = this.delta();
      xf_info.innerHTML = !d ? what + ' ' + dims(sz) + ' mm · click the base point or type Δ'
        : what + ' · <b>' + d.length().toFixed(2) + '</b> mm' + (this.axisLock ? ' along ' + this.axisLock.toUpperCase() : '')
          + (this.copy ? ' · ' + this.copies() + (this.copies() === 1 ? ' copy' : ' copies') : '');
      return;
    }
    const s = this.factors();
    xf_info.innerHTML = what + ' ' + dims(sz) + (s ? ' → <b>' + dims(new THREE.Vector3(sz.x*s.x, sz.y*s.y, sz.z*s.z)) + '</b>' : '') + ' mm' + (this.copy ? ' · copy' : '');
  },
  commit(){
    const m = this.mats();
    if(!Array.isArray(m)){ warnTip(m === 'bad' ? 'Scale must be above 0 %' : this.mode === 'move' ? 'Set where to move: click the target or type Δ' : 'Type the scale in %'); return; }
    this.ghostG = killGroup(this.ghostG); this.killRubber();
    try{ applyBodyTransform(this.tris, m, this.copy); }
    catch(err){ warnTip((this.mode === 'move' ? 'Move' : 'Scale') + ' failed: ' + err.message); this.draw(); return; }
    setActiveTool(null);
  }
};

// ---------- G,H — Shell: полая деталь (Shell во Fusion, Solidify в Blender) ----------
// Внутреннее тело — плоские грани детали, сдвинутые внутрь на толщину
// стенки (shellInnerTris). У открытых граней плоскость, наоборот, уходит
// НАРУЖУ — внутреннее тело прорезает их насквозь. Итог — точная булева: тело минус
// внутреннее тело (без открытых граней — замкнутая полость внутри)

// Плоские грани тела: треугольники, сцепленные рёбрами и лежащие в плоскости
// первого (затравки) — нормаль до 0.8°, отступ до 0.02 мм; линии на грани её
// не делят. Иглы нулевой площади примыкают к соседу
function planarPatches(pos, tris){
  const list = tris || Array.from({length: pos.length / 9}, (_, i) => i);
  const nrm = t => { const o = t*9;
    return new THREE.Vector3(pos[o+3]-pos[o], pos[o+4]-pos[o+1], pos[o+5]-pos[o+2])
      .cross(new THREE.Vector3(pos[o+6]-pos[o], pos[o+7]-pos[o+1], pos[o+8]-pos[o+2])); };
  const EK = (t, e) => { const o1 = t*9+e*3, o2 = t*9+((e+1)%3)*3;
    const k1 = keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2 = keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    return k1 < k2 ? k1+'|'+k2 : k2+'|'+k1; };
  const edges = new Map();
  for(const t of list) for(let e=0;e<3;e++){ const ek = EK(t, e); let L = edges.get(ek); if(!L) edges.set(ek, L = []); L.push(t); }
  // затравки — по убыванию площади: плоскость грани берётся от крупного треугольника
  const area = new Map(list.map(t => [t, nrm(t).length()]));
  const order = [...list].sort((a, b) => area.get(b) - area.get(a));
  const patchOf = new Map(), patches = [];
  for(const seed of order){
    if(patchOf.has(seed)) continue;
    const n0 = nrm(seed);
    const id = patches.length, P = {tris: [seed], n: null};
    patches.push(P); patchOf.set(seed, id);
    if(n0.length() < 1e-9){ P.n = new THREE.Vector3(0, 0, 1); continue; }
    n0.normalize();
    const d0 = n0.x*pos[seed*9] + n0.y*pos[seed*9+1] + n0.z*pos[seed*9+2];
    const on = t => {
      const n = nrm(t), L = n.length();
      if(L >= 1e-9 && n.dot(n0) / L < 0.9999) return false;
      for(let j=0;j<3;j++) if(Math.abs(n0.x*pos[t*9+j*3] + n0.y*pos[t*9+j*3+1] + n0.z*pos[t*9+j*3+2] - d0) > 0.02) return false;
      return true;
    };
    const stack = [seed];
    while(stack.length){
      const t = stack.pop();
      for(let e=0;e<3;e++) for(const u of edges.get(EK(t, e)))
        if(!patchOf.has(u) && on(u)){ patchOf.set(u, id); P.tris.push(u); stack.push(u); }
    }
    P.n = n0;
  }
  return {patchOf, patches};
}
// грань под треугольником — для выбора открытых граней (окно и MCP)
function coplanarFaceTris(pos, seed, tris){
  const {patchOf, patches} = planarPatches(pos, tris);
  return patches[patchOf.get(seed)].tris.slice();
}
// Контуры плоской грани: рёбра, не общие с другим треугольником грани, в
// порядке обхода треугольников (внешний — против часовой вокруг нормали,
// дыры — по часовой). null — контур касается сам себя в вершине
function patchLoops(pos, tris){
  const K = o => keyOf(pos[o], pos[o+1], pos[o+2]);
  const dir = new Map();
  for(const t of tris) for(let e=0;e<3;e++){
    const o1 = t*9+e*3, o2 = t*9+((e+1)%3)*3, a = K(o1), b = K(o2);
    if(a === b) continue;
    const back = a + '>' + b, fwd = b + '>' + a;
    if(dir.has(fwd)){ const L = dir.get(fwd); L.n--; if(!L.n) dir.delete(fwd); }
    else { const L = dir.get(back); if(L) L.n++; else dir.set(back, {a, b, o: o1, n: 1}); }
  }
  const next = new Map();
  for(const E of dir.values()){
    if(E.n !== 1) return null;
    if(next.has(E.a)) return null;
    next.set(E.a, E);
  }
  const loops = [], used = new Set();
  for(const [k0] of next){
    if(used.has(k0)) continue;
    const L = [];
    let k = k0;
    while(!used.has(k)){
      const E = next.get(k);
      if(!E) return null;
      used.add(k);
      L.push({k, p: new THREE.Vector3(pos[E.o], pos[E.o+1], pos[E.o+2])});
      k = E.b;
    }
    if(k !== k0) return null;
    loops.push(L);
  }
  return loops;
}
// Многоугольник с дырами в плоскости n → треугольники (против часовой вокруг
// n). Дыры пришиваются к внешнему контуру мостом до ближайшей видимой
// вершины, потом отрезаются уши. Точки на рёбрах остаются вершинами — у
// соседних граней не появляется Т-стыков
function polygonWithHolesTris(outer, holes, n){
  const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize();
  const v = n.clone().cross(u);
  const P2 = p => ({p, x: p.dot(u), y: p.dot(v)});
  const area2 = L => { let s = 0; for(let i=0;i<L.length;i++){ const a = L[i], b = L[(i+1)%L.length]; s += a.x*b.y - b.x*a.y; } return s; };
  let poly = outer.map(P2);
  const hs = holes.map(h => h.map(P2)).sort((A, B) => Math.max(...B.map(q => q.x)) - Math.max(...A.map(q => q.x)));
  const crossSeg = (a, b, c, d) => {
    const o = (p, q, r) => (q.x-p.x)*(r.y-p.y) - (q.y-p.y)*(r.x-p.x);
    const same = (p, q) => Math.abs(p.x-q.x) < 1e-9 && Math.abs(p.y-q.y) < 1e-9;
    if(same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
    const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
  };
  for(let hi=0; hi<hs.length; hi++){
    const H = hs[hi];
    let mi = 0; H.forEach((q, i) => { if(q.x > H[mi].x) mi = i; });
    const M = H[mi];
    const cand = poly.map((q, i) => ({i, d: (q.x-M.x)**2 + (q.y-M.y)**2})).sort((a, b) => a.d - b.d);
    let pick = -1;
    const segs = [];
    for(let i=0;i<poly.length;i++) segs.push([poly[i], poly[(i+1)%poly.length]]);
    for(let j=hi;j<hs.length;j++) for(let i=0;i<hs[j].length;i++) segs.push([hs[j][i], hs[j][(i+1)%hs[j].length]]);
    for(const c of cand){
      const Q = poly[c.i];
      if(!segs.some(([a, b]) => crossSeg(M, Q, a, b))){ pick = c.i; break; }
    }
    if(pick < 0) throw new Error('cannot join a hole of a face');
    const ring = H.slice(mi).concat(H.slice(0, mi), [H[mi]]);
    poly = poly.slice(0, pick + 1).concat(ring, [poly[pick]], poly.slice(pick + 1));
  }
  const same = (p, q) => Math.abs(p.x-q.x) < 1e-9 && Math.abs(p.y-q.y) < 1e-9;
  const cr = (a, b, c) => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  const idx = poly.map((_, i) => i), out = [];
  for(const strict of [false, true]){
    let guard = idx.length * idx.length + 10;
    while(idx.length > 3 && guard-- > 0){
      let cut = false;
      for(let i=0;i<idx.length;i++){
        const A = poly[idx[(i+idx.length-1)%idx.length]], B = poly[idx[i]], C = poly[idx[(i+1)%idx.length]];
        const s = cr(A, B, C);
        if(s <= 1e-12) continue;
        let ok = true;
        for(const j of idx){
          const Q = poly[j];
          if(Q === A || Q === B || Q === C || same(Q, A) || same(Q, B) || same(Q, C)) continue;
          const e = strict ? 1e-12 : -1e-12;
          if(cr(A, B, Q) > e && cr(B, C, Q) > e && cr(C, A, Q) > e){ ok = false; break; }
        }
        if(!ok) continue;
        out.push([A.p, B.p, C.p]);
        idx.splice((i+idx.length)%idx.length, 1); cut = true; break;
      }
      if(!cut) break;
    }
    if(idx.length <= 3) break;
  }
  if(idx.length === 3 && cr(poly[idx[0]], poly[idx[1]], poly[idx[2]]) > 1e-12) out.push([poly[idx[0]].p, poly[idx[1]].p, poly[idx[2]].p]);
  else if(idx.length > 3) throw new Error('cannot triangulate a face');
  const want = area2(outer.map(P2)) + holes.reduce((s, h) => s + area2(h.map(P2)), 0);
  const got = out.reduce((s, [a, b, c]) => s + area2([P2(a), P2(b), P2(c)]), 0);
  return {tris: out, want, got};
}
// Внутреннее тело оболочки: tris — треугольники тела, open — открытые из них,
// t — стенка, ext — насколько открытые грани уходят наружу. Каждая плоская
// грань сдвигается внутрь на t (открытая — наружу на ext): вершина решает
// n·x = d + цель для всех граней вокруг (наименьшие квадраты с весом по
// углу — угол коробки выходит точно, стенка цилиндра ровной толщины, «even
// thickness» в Blender), затем грань строится заново из сдвинутых контуров.
// Грань уже стенки (сегмент обода у кармана, угол скругления) при сдвиге
// исчезает, как в настоящих CAD: ребро контура, развернувшееся назад,
// схлопывается — его концы сливаются в одну вершину, у которой свои
// плоскости, а грань, где осталось меньше трёх вершин, выпадает. Грань,
// которая всё равно вывернулась, — ошибка: стенка толще детали
function shellInnerTris(pos, tris, open, t, ext){
  const openSet = new Set(open || []);
  const {patchOf, patches} = planarPatches(pos, tris);
  const goalOf = patches.map(P => P.tris.some(x => openSet.has(x)) ? ext : -t);
  const K = o => keyOf(pos[o], pos[o+1], pos[o+2]);
  // вершины по ключу: исходная точка, плоскости вокруг с весом по углу
  const vIdx = new Map(), vP = [], vPl = [];
  for(const tr of tris){
    const o = tr*9, P = [0, 1, 2].map(j => new THREE.Vector3(pos[o+j*3], pos[o+j*3+1], pos[o+j*3+2]));
    const id = patchOf.get(tr);
    for(let j=0;j<3;j++){
      const k = K(o + j*3);
      let vi = vIdx.get(k);
      if(vi === undefined){ vi = vP.length; vIdx.set(k, vi); vP.push(P[j]); vPl.push(new Map()); }
      const w = new THREE.Vector3().subVectors(P[(j+1)%3], P[j]).angleTo(new THREE.Vector3().subVectors(P[(j+2)%3], P[j]));
      if(w > 1e-6) vPl[vi].set(id, (vPl[vi].get(id) || 0) + w);
    }
  }
  const planeD = patches.map(P => { const o = P.tris[0]*9; return P.n.x*pos[o] + P.n.y*pos[o+1] + P.n.z*pos[o+2]; });
  // группы слитых вершин (union-find)
  const parent = vP.map((_, i) => i);
  const find = i => { while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const loopsOf = patches.map(P => {
    const L = patchLoops(pos, P.tris);
    return L ? L.map(loop => loop.map(x => vIdx.get(x.k))) : null;
  });
  const gone = new Uint8Array(patches.length);
  const loopArea = (L, n) => { const c = new THREE.Vector3();
    for(let i=0;i<L.length;i++) c.add(new THREE.Vector3().crossVectors(L[i], L[(i+1)%L.length])); return c.dot(n) / 2; };
  // внешний контур грани — с наибольшей положительной площадью
  const outerOf = patches.map((P, id) => {
    if(!loopsOf[id]) return -1;
    let best = 0, ba = -Infinity;
    loopsOf[id].forEach((L, i) => { const a = loopArea(L.map(vi => vP[vi]), P.n); if(a > ba){ ba = a; best = i; } });
    return best;
  });
  const tooThick = () => new Error('the wall of ' + t + ' mm does not fit here — a thin part or a sharp inner corner (a narrow V needs up to 10 walls of room) collides with another wall');
  let X = null;
  const solve = () => {
    // члены групп: исходные точки (опора) и плоскости невыпавших граней
    const acc = new Map();
    for(let i=0;i<vP.length;i++){
      const g = find(i);
      let a = acc.get(g); if(!a){ a = {x0: new THREE.Vector3(), c: 0, pl: new Map()}; acc.set(g, a); }
      a.x0.add(vP[i]); a.c++;
      for(const [id, w] of vPl[i]) if(!gone[id]) a.pl.set(id, (a.pl.get(id) || 0) + w);
    }
    X = new Map();
    for(const [g, a] of acc){
      const x0 = a.x0.multiplyScalar(1 / a.c);
      // (Σ w n nᵀ + λI) d = Σ w (d_i + цель − n·x0) n — λ крошечный: посреди
      // грани или на ребре матрица вырождена, решение — ближайшее к опоре
      let a00=0, a01=0, a02=0, a11=0, a12=0, a22=0, r0=0, r1=0, r2=0, tw=0;
      for(const [id, w] of a.pl){
        const n = patches[id].n, b = planeD[id] + goalOf[id] - n.dot(x0);
        a00 += w*n.x*n.x; a01 += w*n.x*n.y; a02 += w*n.x*n.z; a11 += w*n.y*n.y; a12 += w*n.y*n.z; a22 += w*n.z*n.z;
        r0 += w*b*n.x; r1 += w*b*n.y; r2 += w*b*n.z; tw += w;
      }
      if(!(tw > 0)){ X.set(g, x0); continue; }
      const lam = 1e-9 * tw;
      const m = new THREE.Matrix3().set(a00+lam, a01, a02, a01, a11+lam, a12, a02, a12, a22+lam);
      if(Math.abs(m.determinant()) < 1e-30) throw new Error('cannot offset a vertex');
      const d = new THREE.Vector3(r0, r1, r2).applyMatrix3(m.invert());
      // вогнутый V-угол законно уводит вершину далеко (карман 12° — 9.6 стенки)
      if(d.length() > 60 * Math.max(t, ext)) throw new Error('the wall of ' + t + ' mm does not fit into a sharp corner here');
      X.set(g, x0.add(d));
    }
  };
  // контур грани из групп: соседние одинаковые схлопнуты
  const groupLoop = loop => {
    const out = [];
    for(const vi of loop){ const g = find(vi); if(out[out.length-1] !== g) out.push(g); }
    while(out.length > 1 && out[0] === out[out.length-1]) out.pop();
    return out;
  };
  // грань, у которой внешний контур схлопнулся, выпадает до пересчёта вершин
  const updateGone = () => {
    for(let id=0; id<patches.length; id++)
      if(!gone[id] && loopsOf[id] && groupLoop(loopsOf[id][outerOf[id]]).length < 3) gone[id] = 1;
  };
  for(let iter=0; ; iter++){
    if(iter > 400) throw tooThick();
    updateGone();
    solve();
    let changed = false;
    for(let id=0; id<patches.length; id++){
      if(gone[id] || !loopsOf[id]) continue;
      for(let li=0; li<loopsOf[id].length; li++){
        const loop = loopsOf[id][li], gl = groupLoop(loop);
        if(gl.length < 3){ if(li === outerOf[id]){ gone[id] = 1; changed = true; break; } continue; }
        // ребро, развернувшееся назад, — схлопнуть; сравниваем с исходным
        // направлением между центрами групп
        const orig = new Map();
        let merged = false;
        for(const vi of loop){ const g = find(vi); const e = orig.get(g); if(e){ e.add(vP[vi]); e.c++; } else { const v = vP[vi].clone(); v.c = 1; orig.set(g, v); } }
        for(let i=0;i<gl.length;i++){
          const a = gl[i], b = gl[(i+1)%gl.length];
          const oa = orig.get(a).clone().multiplyScalar(1 / orig.get(a).c), ob = orig.get(b).clone().multiplyScalar(1 / orig.get(b).c);
          const e0 = ob.sub(oa), e1 = X.get(b).clone().sub(X.get(a));
          if(e0.dot(e1) < 0){ parent[find(a)] = find(b); changed = merged = true; }
        }
        if(merged) continue;
        // сдвинутый контур пересёк сам себя (край кармана срезал несколько
        // сегментов обода) — участок между пересёкшимися рёбрами, меньший
        // из двух, схлопывается в одну вершину
        const n = patches[id].n, u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize(), v = n.clone().cross(u);
        const Q = gl.map(g => { const p = X.get(g); return [p.dot(u), p.dot(v)]; }), m = gl.length;
        const o = (p, q, r) => (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]);
        const bx = Q.map((p, i) => { const q = Q[(i+1)%m]; return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])]; });
        let hit = null;
        // участок — не больше нескольких толщин стенки: дальние пересечения —
        // стенка толще детали, их не лечим
        const reach = 8 * Math.max(t, ext);
        const chainOf = (i, j) => (j - i) <= m - (j - i) ? gl.slice(i + 1, j + 1) : gl.slice(j + 1).concat(gl.slice(0, i + 1));
        const small = ch => {
          if(ch.length > Math.max(3, m / 3)) return false;
          const pts = [];
          for(const vi of loop) if(ch.includes(find(vi))) pts.push(vP[vi]);
          for(const a of pts) for(const b of pts) if(a.distanceTo(b) > reach) return false;
          return true;
        };
        for(let i=0; i<m && !hit; i++) for(let j=i+2; j<m; j++){
          if(i === 0 && j === m-1) continue;
          if(bx[i][1] < bx[j][0] || bx[j][1] < bx[i][0] || bx[i][3] < bx[j][2] || bx[j][3] < bx[i][2]) continue;
          const A = Q[i], B = Q[(i+1)%m], C = Q[j], D = Q[(j+1)%m];
          const d1 = o(A, B, C), d2 = o(A, B, D), d3 = o(C, D, A), d4 = o(C, D, B), e = 1e-12;
          if(((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e)) && small(chainOf(i, j))){ hit = [i, j]; break; }
        }
        if(hit){
          const chain = chainOf(hit[0], hit[1]);
          for(const g of chain) parent[find(g)] = find(chain[0]);
          changed = true;
        }
      }
    }
    if(!changed) break;
  }
  const out = [];
  for(let id=0; id<patches.length; id++){
    if(gone[id]) continue;
    const P = patches[id], n = P.n;
    if(!loopsOf[id]){
      // контур касается сам себя — треугольники как есть
      for(const tr of P.tris){
        const o = tr*9, Q = [0, 1, 2].map(j => X.get(find(vIdx.get(K(o+j*3)))));
        const m = new THREE.Vector3().subVectors(Q[1], Q[0]).cross(new THREE.Vector3().subVectors(Q[2], Q[0]));
        if(m.length() < 1e-9) continue;
        if(m.dot(n) < 0) throw tooThick();
        out.push(Q.map(q => q.clone()));
      }
      continue;
    }
    const sArea = L => loopArea(L, n);
    const orig = loopsOf[id].map(L => sArea(L.map(vi => vP[vi])));
    const gls = loopsOf[id].map(groupLoop);
    const shifted = gls.map(gl => gl.map(g => X.get(g)));
    const outerI = outerOf[id];
    const holes = [];
    let skip = false;
    for(let i=0;i<gls.length;i++){
      const sa = gls[i].length >= 3 ? sArea(shifted[i]) : 0;
      if(i === outerI){
        if(gls[i].length < 3 || Math.abs(sa) < 1e-9){ skip = true; break; } // грань исчезла
        if(sa < 0) throw tooThick();
      } else {
        if(orig[i] > 0) throw new Error('a face has two outer outlines');
        if(gls[i].length < 3 || Math.abs(sa) < 1e-9) continue; // дыра схлопнулась
        if(sa > 0) throw tooThick();
        holes.push(shifted[i]);
      }
    }
    if(skip) continue;
    // контуры не должны пересекаться ни сами с собой, ни друг с другом
    // (остриё кармана, ушедшее в стенку отверстия)
    {
      const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize(), v = n.clone().cross(u);
      const E = [];
      for(const L of [shifted[outerI], ...holes]) for(let i=0;i<L.length;i++){
        const a = L[i], b = L[(i+1)%L.length], A = [a.dot(u), a.dot(v)], B = [b.dot(u), b.dot(v)];
        E.push({A, B, a, b, x0: Math.min(A[0], B[0]), x1: Math.max(A[0], B[0]), y0: Math.min(A[1], B[1]), y1: Math.max(A[1], B[1])});
      }
      E.sort((p, q) => p.x0 - q.x0);
      const o = (p, q, r) => (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]), e = 1e-12;
      for(let i=0;i<E.length;i++) for(let j=i+1;j<E.length && E[j].x0 <= E[i].x1;j++){
        const P = E[i], Q = E[j];
        if(P.y1 < Q.y0 || Q.y1 < P.y0) continue;
        if(P.a === Q.a || P.a === Q.b || P.b === Q.a || P.b === Q.b) continue;
        const d1 = o(P.A, P.B, Q.A), d2 = o(P.A, P.B, Q.B), d3 = o(Q.A, Q.B, P.A), d4 = o(Q.A, Q.B, P.B);
        if(((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))) throw tooThick();
      }
    }
    let r;
    try{ r = polygonWithHolesTris(shifted[outerI], holes, n); }
    catch(err){ throw tooThick(); } // контур перекручен — стенка толще детали
    if(Math.abs(r.got - r.want) > Math.max(1e-6, Math.abs(r.want) * 0.002)) throw tooThick();
    for(const tri of r.tris) out.push(tri.map(q => q.clone()));
  }
  let vol = 0;
  for(const [p, q, r] of out) vol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
  if(!(vol > 1e-3)) throw new Error('the wall of ' + t + ' mm is thicker than half of the body — no room inside');
  return out;
}
// Shell тела: одна запись истории; итог должен быть замкнут
function applyShell(tris, open, t){
  if(!(t >= 0.1)) throw new Error('wall thickness must be at least 0.1 mm');
  const pos = mesh.geometry.attributes.position.array;
  const body = tris || Array.from({length: pos.length / 9}, (_, i) => i);
  const inner = shellInnerTris(pos, body, open, t, Math.max(1, t));
  const r = zcApplySolid(inner, 'cut');
  if(r.open_edges > 0 || r.nonmanifold_edges > 0 || !(r.volume_change_mm3 < -1e-3)){
    undo(true);
    throw new Error(r.volume_change_mm3 < -1e-3 ? 'the shell came out broken here — try another wall thickness' : 'nothing was hollowed out');
  }
  return Object.assign({thickness_mm: t, open_faces: open ? open.length : 0, boolean: lastBoolPath}, r);
}
const shellTool = {
  hud: 'SHELL · click a body (Enter — the whole model) → click faces to leave open (click again — closed) · Thickness in the window · Enter — apply · Esc — back',
  stage: 'body', tris: null, faces: [], ghostG: null, hiG: null, timer: 0, err: '', innerVol: 0,
  on(){
    bodyPick.reset();
    this.tris = null; this.faces = []; this.err = ''; this.innerVol = 0;
    this.stage = bodyPick.single() ? 'faces' : 'body';
    shellPopup.style.left = '16px'; shellPopup.style.top = '48px';
    shellPopup.hidden = false;
    if(this.stage === 'faces') this.preview();
    this.ui();
  },
  off(){
    clearTimeout(this.timer);
    this.ghostG = killGroup(this.ghostG); this.hiG = killGroup(this.hiG);
    hidePatch(); tipHide(); shellPopup.hidden = true; releaseToolInput();
  },
  thick(){ const v = parseFloat(String(sh_t.value).replace(',', '.')); return Number.isFinite(v) ? v : 0; },
  bodyIdx(){ const pos = mesh.geometry.attributes.position.array; return this.tris || Array.from({length: pos.length / 9}, (_, i) => i); },
  openTris(){ return this.faces.flat(); },
  // открытые грани — оранжевым поверх тела
  paintFaces(){
    this.hiG = killGroup(this.hiG);
    const list = this.openTris();
    if(!list.length) return;
    const pos = mesh.geometry.attributes.position.array, arr = new Float32Array(list.length * 9);
    let o = 0;
    for(const t of list) for(let j=0;j<9;j++) arr[o++] = pos[t*9+j];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: 0xff9f1a, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2})));
    scene.add(g); this.hiG = g;
  },
  preview(now){
    clearTimeout(this.timer);
    const run = () => {
      this.ghostG = killGroup(this.ghostG); this.err = ''; this.innerVol = 0;
      if(this.stage !== 'faces'){ this.ui(); return; }
      const t = this.thick();
      if(!(t >= 0.1)){ this.err = 'Wall thickness must be at least 0.1 mm'; this.ui(); return; }
      try{
        const pos = mesh.geometry.attributes.position.array;
        const inner = shellInnerTris(pos, this.bodyIdx(), this.openTris(), t, Math.max(1, t));
        for(const [p, q, r] of inner) this.innerVol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
        const arr = new Float32Array(inner.length * 9);
        let o = 0;
        for(const tri of inner) for(const p of tri){ arr[o++] = p.x; arr[o++] = p.y; arr[o++] = p.z; }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const g = new THREE.Group();
        // полость — красным сквозь стенки
        g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: 0xff5a5a, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, side: THREE.DoubleSide})));
        g.renderOrder = 5;
        scene.add(g); this.ghostG = g;
      }catch(err){ this.err = err.message; }
      this.ui();
    };
    if(now) run(); else this.timer = setTimeout(() => { if(activeTool === this) run(); }, 120);
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 'body'){
      const t = bodyPick.take(q);
      if(!t){ warnTip('Click a body to hollow, or Enter for the whole model'); return; }
      this.tris = t; this.stage = 'faces'; hidePatch(); tipHide(); this.preview(true);
      return;
    }
    const h = raycastFace(q);
    if(!h) return;
    const inBody = this.tris ? this.tris.includes(h.faceIndex) : true;
    if(!inBody){ warnTip('This face belongs to another body'); return; }
    const i = this.faces.findIndex(f => f.includes(h.faceIndex));
    if(i >= 0) this.faces.splice(i, 1);
    else this.faces.push(coplanarFaceTris(mesh.geometry.attributes.position.array, h.faceIndex, this.tris));
    this.paintFaces(); this.preview(true);
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 'body'){ bodyPick.hover(e, q, 'Shell'); return; }
    const h = raycastFace(q);
    if(!h){ tipHide(); return; }
    const open = this.faces.some(f => f.includes(h.faceIndex));
    tipAt(e, open ? 'Open face · click — close it' : 'Click — leave this face open');
  },
  key(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      if(this.stage === 'body'){ this.tris = null; this.stage = 'faces'; hidePatch(); tipHide(); this.preview(true); }
      else this.commit();
      return true;
    }
    return false;
  },
  esc(){
    if(this.stage !== 'faces') return false;
    if(this.faces.length){ this.faces.pop(); this.paintFaces(); this.preview(true); return true; }
    if(!bodyPick.single()){ this.stage = 'body'; this.tris = null; this.ghostG = killGroup(this.ghostG); bodyPick.hoverRoot = -1; this.ui(); return true; }
    return false;
  },
  ui(){
    sh_state.textContent = this.stage === 'body' ? 'pick a body' : this.faces.length ? this.faces.length + ' open' : 'closed';
    sh_hint.hidden = !hintsChk.checked;
    sh_ok.disabled = !(this.stage === 'faces' && !this.err && this.innerVol > 0);
    sh_info.style.color = this.err ? '#ff6b6b' : '';
    if(this.stage === 'body'){ sh_info.textContent = 'Click the body to hollow · Enter — the whole model'; return; }
    if(this.err){ sh_info.textContent = this.err; return; }
    if(!(this.innerVol > 0)){ sh_info.innerHTML = '&nbsp;'; return; }
    sh_info.innerHTML = 'Wall <b>' + this.thick() + '</b> mm · ' + (this.faces.length
      ? this.faces.length + (this.faces.length === 1 ? ' open face' : ' open faces')
      : '<span style="color:#f5c542">closed cavity — add an open face or a hole to drain</span>');
  },
  commit(){
    clearTimeout(this.timer);
    if(this.stage !== 'faces') return;
    this.ghostG = killGroup(this.ghostG); this.hiG = killGroup(this.hiG);
    try{ applyShell(this.tris, this.openTris(), this.thick()); }
    catch(err){ warnTip('Shell failed: ' + err.message); this.paintFaces(); this.preview(true); return; }
    setActiveTool(null);
  }
};

// ---------- Revolve (G,O) и Sweep (G,W): тело из профиля ----------
// Профиль — замкнутый плоский контур: выбранные линии/рёбра (B, Ctrl+клик)
// или контур области грани под кликом (нарисованный на грани прямоугольник,
// круг; лист в воздухе после F). Revolve вращает его вокруг оси (Revolve во
// Fusion), Sweep ведёт вдоль пути (Sweep во Fusion, Follow Me в SketchUp).
// Лист-профиль в воздухе при применении поглощается телом, как грань у
// Follow Me. Тело объединяется или вычитается точной булевой (zcApplySolid).

// Треугольники тела — согласованно по соседству (общее ребро обходится
// навстречу), наружу — по знаку объёма. Построители ниже не следят за
// обходом торцов и боковин — это делает один проход здесь
function orientSolid(tris){
  const K = v => keyOf(v.x, v.y, v.z);
  const good = tris.filter(t => { const k = t.map(K); return k[0] !== k[1] && k[1] !== k[2] && k[0] !== k[2]; });
  const edges = new Map();
  good.forEach((t, i) => { for(let e=0;e<3;e++){
    const a = K(t[e]), b = K(t[(e+1)%3]), ek = a < b ? a+'|'+b : b+'|'+a;
    let L = edges.get(ek); if(!L) edges.set(ek, L = []); L.push({i, fwd: a < b});
  }});
  const flip = new Array(good.length).fill(null);
  for(let s=0;s<good.length;s++){
    if(flip[s] !== null) continue;
    flip[s] = false;
    const stack = [s];
    while(stack.length){
      const i = stack.pop(), t = good[i];
      for(let e=0;e<3;e++){
        const a = K(t[e]), b = K(t[(e+1)%3]), ek = a < b ? a+'|'+b : b+'|'+a;
        const fwd = (a < b) !== flip[i];
        for(const o of edges.get(ek)){
          if(o.i === i || flip[o.i] !== null) continue;
          flip[o.i] = (o.fwd === fwd); // сосед должен идти навстречу
          stack.push(o.i);
        }
      }
    }
  }
  let out = good.map((t, i) => flip[i] ? [t[0], t[2], t[1]] : t);
  let vol = 0; for(const [p, q, r] of out) vol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
  if(vol < 0) out = out.map(t => [t[0], t[2], t[1]]);
  return out;
}
// точки контура на одной прямой с соседями — лишние (круг после врезки: сотни)
function simplifyLoop(loop, closed = true){
  let pts = loop.slice();
  for(let changed = true; changed && pts.length > 3;){
    changed = false;
    for(let i = closed ? 0 : 1; i < pts.length - (closed ? 0 : 1) && pts.length > 3; i++){
      const a = pts[(i-1+pts.length)%pts.length], b = pts[i], c = pts[(i+1)%pts.length];
      const ac = new THREE.Vector3().subVectors(c, a), L2 = ac.lengthSq();
      const off = L2 < 1e-12 ? 0 : new THREE.Vector3().subVectors(b, a).cross(ac).length() / Math.sqrt(L2);
      if(a.distanceTo(b) < 1e-4 || off < 1e-4){ pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}
function loopPlaneNormal(loop){
  const n = new THREE.Vector3();
  for(let i=0;i<loop.length;i++){ const p = loop[i], q = loop[(i+1)%loop.length];
    n.x += (p.y-q.y)*(p.z+q.z); n.y += (p.z-q.z)*(p.x+q.x); n.z += (p.x-q.x)*(p.y+q.y); }
  return n.length() > 1e-9 ? n.normalize() : null;
}
// профиль из области грани под треугольником: один контур; лист — поглощается
function profileFromRegion(tri){
  const pos = mesh.geometry.attributes.position.array;
  cachedPatch = null;
  const patch = facePatchAt(tri);
  const loop = patchOutlineLoop(pos, patch.tris);
  if(!loop) throw new Error('the profile region must have one outline without holes');
  return {loop: simplifyLoop(loop), consume: patchIsSheet(pos, patch.tris) ? patch.tris.slice() : null,
          area: patch.area || 0, patch};
}
function profileFromLoop(loop){
  const pts = simplifyLoop(loop), n = loopPlaneNormal(pts);
  if(!n) throw new Error('the selected contour is degenerate');
  const d0 = n.dot(pts[0]);
  if(pts.some(p => Math.abs(n.dot(p) - d0) > 0.05)) throw new Error('the selected contour is not flat');
  return {loop: pts, consume: null, area: 0};
}
// Revolve: профиль в плоскости оси, по одну сторону от неё; точки на оси —
// полюса. |angle| < 360 — сектор с торцами; знак угла — в какую сторону
function revolveLoopTris(loop, A, dir, angleDeg, seg){
  const d = (angleDeg < 0 ? dir.clone().negate() : dir.clone()).normalize();
  angleDeg = Math.abs(angleDeg);
  const full = angleDeg >= 359.999;
  const ang = Math.max(0.1, Math.min(360, angleDeg)) * Math.PI / 180;
  const eps = 0.01;
  const hr = loop.map(p => { const w = new THREE.Vector3().subVectors(p, A); const h = w.dot(d); w.addScaledVector(d, -h); return {h, w}; });
  let e1 = null;
  for(const x of hr) if(x.w.length() > eps){ e1 = x.w.clone().normalize(); break; }
  if(!e1) throw new Error('the profile lies on the axis');
  const e2 = new THREE.Vector3().crossVectors(d, e1);
  const prof = hr.map(({h, w}) => {
    const r = w.dot(e1), off = w.dot(e2);
    if(Math.abs(off) > 0.05) throw new Error('the axis must lie in the plane of the profile');
    if(r < -eps) throw new Error('the profile crosses the axis — it must lie on one side of it');
    return {h, r: Math.max(0, r)};
  });
  const steps = Math.max(3, Math.round(Math.max(3, seg) * (full ? 1 : ang / (2*Math.PI))));
  const nRing = full ? steps : steps + 1;
  const pole = prof.map(pr => pr.r < 1e-6 ? A.clone().addScaledVector(d, pr.h) : null);
  const ring = prof.map((pr, i) => pole[i] ? null : Array.from({length: nRing}, (_, j) => {
    const th = j / steps * (full ? 2*Math.PI : ang);
    return A.clone().addScaledVector(d, pr.h).addScaledVector(e1, pr.r*Math.cos(th)).addScaledVector(e2, pr.r*Math.sin(th));
  }));
  const at = (i, j) => pole[i] || ring[i][j];
  const tris = [], m = prof.length;
  for(let i=0;i<m;i++){
    const i2 = (i+1) % m;
    for(let j=0;j<steps;j++){
      const j2 = full ? (j+1) % steps : j+1;
      const a = at(i, j), b = at(i2, j), c = at(i2, j2), e = at(i, j2);
      if(b !== c) tris.push([a, b, c]);
      if(a !== e) tris.push([a, c, e]);
    }
  }
  if(!full){
    for(const j of [0, steps]) for(const t of earClip(prof.map((_, i) => at(i, j)))) tris.push(t);
  }
  return orientSolid(tris);
}
// Sweep: сечение переносится вдоль пути без закрутки (поворот от прежней
// касательной к новой); на изломе — стык «на ус»: поперёк биссектрисы
// сечение растянуто на 1/cos половины угла, стенки остаются параллельными
function sweepLoopTris(loop, path, closedPath){
  const n = path.length;
  if(n < 2) throw new Error('the path needs at least 2 points');
  const T = [], miterC = [], bend = [];
  for(let k=0;k<n;k++){
    const hasIn = closedPath || k > 0, hasOut = closedPath || k < n - 1;
    const din = hasIn ? new THREE.Vector3().subVectors(path[k], path[(k-1+n)%n]).normalize() : null;
    const dout = hasOut ? new THREE.Vector3().subVectors(path[(k+1)%n], path[k]).normalize() : null;
    const t = (din && dout) ? din.clone().add(dout) : (din || dout).clone();
    if(t.length() < 1e-6) throw new Error('the path turns back on itself');
    t.normalize(); T.push(t);
    if(din && dout){
      const c = t.dot(din);
      if(c < 0.26) throw new Error('the path has a corner sharper than 30°');
      const b = dout.clone().sub(din); b.addScaledVector(t, -b.dot(t));
      miterC.push(c); bend.push(b.length() > 1e-9 ? b.normalize() : null);
    } else { miterC.push(1); bend.push(null); }
  }
  const R = [new THREE.Quaternion()];
  for(let k=1;k<n;k++) R.push(new THREE.Quaternion().setFromUnitVectors(T[k-1], T[k]).multiply(R[k-1]));
  const rel = loop.map(p => new THREE.Vector3().subVectors(p, path[0]));
  const rings = [];
  for(let k=0;k<n;k++) rings.push(rel.map(q => {
    const o = q.clone().applyQuaternion(R[k]);
    if(bend[k]) o.addScaledVector(bend[k], o.dot(bend[k]) * (1 / miterC[k] - 1));
    return o.add(path[k]);
  }));
  const tris = [], m = loop.length, last = closedPath ? n : n - 1;
  for(let k=0;k<last;k++){
    const A = rings[k], B = rings[(k+1)%n];
    for(let i=0;i<m;i++){ const i2 = (i+1) % m; tris.push([A[i], A[i2], B[i2]], [A[i], B[i2], B[i]]); }
  }
  if(!closedPath) for(const r of [rings[0], rings[n-1]]) for(const t of earClip(r)) tris.push(t);
  return orientSolid(tris);
}
// путь из выбранных линий/рёбер: одна цепочка (или замкнутая петля)
function pathFromSelection(){
  if(!edgeSel.length) return null;
  const K = p => keyOf(p.x, p.y, p.z);
  const segs = edgeSel.map(s => ({pts: s.pts, used: false}));
  const deg = new Map();
  for(const s of segs) for(const p of [s.pts[0], s.pts[s.pts.length-1]]) deg.set(K(p), (deg.get(K(p)) || 0) + 1);
  if([...deg.values()].some(d => d > 2)) throw new Error('the path branches — select one chain of lines');
  const ends = [...deg.entries()].filter(([, d]) => d === 1).map(([k]) => k);
  if(ends.length !== 0 && ends.length !== 2) throw new Error('the path lines are not connected');
  let startK = ends.length ? ends[0] : K(segs[0].pts[0]);
  const pts = [];
  let curK = startK;
  for(;;){
    const s = segs.find(x => !x.used && (K(x.pts[0]) === curK || K(x.pts[x.pts.length-1]) === curK));
    if(!s) break;
    s.used = true;
    const ord = K(s.pts[0]) === curK ? s.pts : [...s.pts].reverse();
    for(const p of (pts.length ? ord.slice(1) : ord)) pts.push(p.clone());
    curK = K(ord[ord.length-1]);
    if(!ends.length && curK === startK) break;
  }
  if(segs.some(x => !x.used)) throw new Error('the path lines are not connected');
  const closed = !ends.length;
  if(closed) pts.pop(); // последняя = первой
  return {pts, closed};
}
// начало пути — у профиля: открытый путь разворачиваем, замкнутый — сдвигаем
function orientPathToProfile(path, loop){
  const c = loop.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / loop.length);
  let pts = path.pts.slice();
  if(path.closed){
    // старт петли — в проекции центра профиля на путь (профиль посреди стороны)
    let best = null;
    for(let i=0;i<pts.length;i++){
      const A = pts[i], B = pts[(i+1)%pts.length], d = new THREE.Vector3().subVectors(B, A), L2 = d.lengthSq();
      const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, new THREE.Vector3().subVectors(c, A).dot(d) / L2));
      const X = A.clone().addScaledVector(d, t), dist = X.distanceTo(c);
      if(!best || dist < best.dist) best = {i, t, X, dist};
    }
    const n = pts.length;
    if(best.t > 1e-6 && best.t < 1 - 1e-6){ pts.splice(best.i + 1, 0, best.X); pts = pts.slice(best.i + 1).concat(pts.slice(0, best.i + 1)); }
    else { const k = (best.i + (best.t >= 0.5 ? 1 : 0)) % n; pts = pts.slice(k).concat(pts.slice(0, k)); }
  } else if(pts[pts.length-1].distanceTo(c) < pts[0].distanceTo(c)) pts.reverse();
  // лишние точки на прямой — прочь, кроме стартовой (в ней лежит профиль)
  const first = pts[0], rest = simplifyLoop(pts, path.closed);
  if(!rest.includes(first)){
    const out = [first];
    for(const p of rest) out.push(p);
    return {pts: out, closed: path.closed};
  }
  const k = rest.indexOf(first);
  return {pts: rest.slice(k).concat(rest.slice(0, k)), closed: path.closed};
}
// применить тело из профиля: одна запись истории — до поглощения листа
function applyProfileSolid(tris, op, consume){
  const snap = takeSnapshot();
  if(consume && consume.length){
    const drop = new Set(consume), pos = mesh.geometry.attributes.position.array, keep = [];
    for(let t=0;t<pos.length/9;t++) if(!drop.has(t)) for(let j=0;j<9;j++) keep.push(pos[t*9+j]);
    setMeshFromArray(new Float32Array(keep));
  }
  let r;
  try{ r = zcApplySolid(tris, op); }
  catch(err){ setMeshFromArray(snap.pos); extractEdges(); throw err; }
  undoStack[undoStack.length-1] = snap;
  if(Math.abs(r.volume_change_mm3) < 1e-3 && !(consume && consume.length)){
    undo(true);
    throw new Error(op === 'cut' ? 'nothing to cut — the solid is outside the body' : 'nothing to add — the body is already there');
  }
  return r;
}
// ---------- G,F — Loft: тело между двумя профилями (Loft во Fusion) ----------
// Воронки, переходники, горлышки: квадрат снизу, круг сверху. Вершины
// профилей сшиваются по доле длины контура: точки ОБОИХ сохраняются (углы
// квадрата и сегменты круга никуда не деваются), боковина — четырёхугольники,
// торцы — сами профили. Тело объединяется или вычитается точной булевой
function loopCentroid(loop){
  const c = new THREE.Vector3();
  for(const p of loop) c.add(p);
  return c.multiplyScalar(1 / loop.length);
}
// точка контура по доле длины s ∈ [0, 1), отсчёт от вершины start
function loopAt(loop, cum, total, s, start){
  const want = ((s % 1) + 1) % 1 * total;
  const n = loop.length;
  let lo = 0, hi = n;
  while(lo + 1 < hi){ const mid = (lo + hi) >> 1; if(cum[mid] <= want) lo = mid; else hi = mid; }
  const a = loop[(start + lo) % n], b = loop[(start + lo + 1) % n];
  const seg = cum[lo+1] - cum[lo];
  const t = seg < 1e-12 ? 0 : (want - cum[lo]) / seg;
  return a.clone().lerp(b, t);
}
function loopParams(loop, start){
  const n = loop.length, cum = [0];
  for(let i=0;i<n;i++) cum.push(cum[i] + loop[(start + i) % n].distanceTo(loop[(start + i + 1) % n]));
  const total = cum[n];
  return {cum, total, s: cum.slice(0, n).map(x => x / total)};
}
function loftLoopTris(loopA, loopB){
  if(loopA.length < 3 || loopB.length < 3) throw new Error('both profiles need at least 3 points');
  const cA = loopCentroid(loopA), cB = loopCentroid(loopB);
  const axis = new THREE.Vector3().subVectors(cB, cA);
  if(axis.length() < 0.05) throw new Error('the profiles are in the same place — move one of them');
  axis.normalize();
  // обход обоих контуров — в одну сторону вокруг оси между ними, иначе тело
  // выходит перекрученным
  const A = loopPlaneNormal(loopA), B = loopPlaneNormal(loopB);
  if(!A || !B) throw new Error('a profile is degenerate');
  const la = A.dot(axis) < 0 ? [...loopA].reverse() : loopA.slice();
  const lb = B.dot(axis) < 0 ? [...loopB].reverse() : loopB.slice();
  // старт второго контура — вершина, лежащая в ту же сторону от центра, что и
  // первая вершина первого: сшивка без закрутки
  const u = new THREE.Vector3().subVectors(la[0], cA);
  u.addScaledVector(axis, -u.dot(axis));
  if(u.length() < 1e-9) throw new Error('a profile is degenerate');
  u.normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  let start = 0, best = -Infinity;
  lb.forEach((p, i) => {
    const w = new THREE.Vector3().subVectors(p, cB);
    w.addScaledVector(axis, -w.dot(axis));
    const L = w.length();
    if(L < 1e-9) return;
    const d = w.dot(u) / L;
    if(d > best){ best = d; start = i; }
  });
  const pa = loopParams(la, 0), pb = loopParams(lb, start);
  const params = [...new Set([...pa.s, ...pb.s].map(x => Math.round(x * 1e9) / 1e9))].sort((x, y) => x - y);
  const ringA = params.map(s => loopAt(la, pa.cum, pa.total, s, 0));
  const ringB = params.map(s => loopAt(lb, pb.cum, pb.total, s, start));
  const tris = [];
  for(let i=0;i<params.length;i++){
    const j = (i + 1) % params.length;
    tris.push([ringA[i], ringA[j], ringB[j]], [ringA[i], ringB[j], ringB[i]]);
  }
  for(const t of earClip(ringA)) tris.push(t);
  for(const t of earClip(ringB)) tris.push(t);
  return orientSolid(tris);
}
const profTool = {
  kind: 'revolve', stage: 'profile', profile: null, profile2: null, axis: null, path: null, op: 'auto', ctrl: false,
  ghostG: null, axisLine: null, profLine: null, profLine2: null, hoverLine: null, tris: null, err: '', timer: 0,
  get hud(){
    return this.kind === 'revolve'
      ? 'REVOLVE · click the profile region (or select a contour first) → click the axis line or X/Y/Z · angle in the window · Enter — apply · Esc — back'
      : this.kind === 'sweep'
      ? 'SWEEP · path = the selected lines · click the profile region · Enter — apply · Esc'
      : 'LOFT · click the first profile region → click the second one · Enter — apply · Esc — back';
  },
  start(kind){ // из аккорда: Sweep требует выбранный путь
    this.kind = kind; this.profile = null; this.profile2 = null; this.axis = null; this.path = null;
    if(kind === 'sweep'){
      try{ this.path = pathFromSelection(); }catch(err){ warnTip(err.message); return; }
      if(!this.path){ warnTip('Select the path lines first (click, Ctrl+click), then G,W'); return; }
      this.stage = 'profile';
    } else {
      const lp = edgeSelLoop();
      if(lp){
        try{ this.profile = profileFromLoop(lp); }catch(err){ warnTip(err.message); return; }
        this.stage = kind === 'loft' ? 'profile2' : 'axis';
      } else this.stage = 'profile';
    }
    setActiveTool(this);
  },
  on(){
    this.op = 'auto'; this.ctrl = false; this.tris = null; this.err = '';
    pf_title.textContent = this.kind === 'revolve' ? 'Revolve' : this.kind === 'sweep' ? 'Sweep' : 'Loft';
    pf_revolve.hidden = this.kind !== 'revolve';
    pf_hint.textContent = this.kind === 'revolve'
      ? 'Profile: a closed shape drawn on a face (click its region) or a selected closed contour of lines (B). Axis: click a straight line or edge in the plane of the profile, or press X/Y/Z for a world axis through the origin. The profile must lie on one side of the axis. Angle under 360 makes a sector with flat ends; a negative angle turns the other way. A sheet profile in the air is absorbed into the solid.'
      : this.kind === 'sweep'
      ? 'Path: the lines selected before G,W (one chain, open or closed). Profile: click the closed region to sweep — usually drawn across the start of the path. The profile is carried along the path without twisting; at corners the walls meet in a miter. A sheet profile in the air is absorbed into the solid.'
      : 'Two closed profiles — regions drawn on faces, sheets in the air (F) or a selected contour of lines (B): click one, then the other, and the solid is stretched between them (a funnel, an adapter, a neck). Their vertices are stitched by the share of the outline length, so corners of both stay; the walls are straight from one profile to the other. A sheet profile is absorbed into the solid.';
    if(this.kind === 'sweep') this.showPathLine();
    profPopup.style.left = '16px'; profPopup.style.top = '48px';
    profPopup.hidden = false;
    if(this.stage !== 'profile' && this.profile) this.afterProfile();
    this.ui();
  },
  off(){
    clearTimeout(this.timer);
    this.kill(); hidePatch(); ppPatch = null; tipHide();
    for(const k of ['axisLine', 'profLine', 'profLine2', 'hoverLine']) if(this[k]){ scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
    profPopup.hidden = true; releaseToolInput();
  },
  kill(){ if(this.ghostG){ scene.remove(this.ghostG); this.ghostG.geometry.dispose(); this.ghostG = null; } },
  modChange(e){ const c = !!(e.ctrlKey || e.metaKey); if(c !== this.ctrl){ this.ctrl = c; this.preview(true); } },
  opNow(){ return this.op !== 'auto' ? this.op : this.ctrl ? 'cut' : 'join'; },
  line(pts, color){
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color, depthTest: false}));
    l.renderOrder = 6; scene.add(l); return l;
  },
  showPathLine(){
    if(this.axisLine){ scene.remove(this.axisLine); this.axisLine.geometry.dispose(); }
    const pts = this.path.pts.slice(); if(this.path.closed) pts.push(pts[0]);
    this.axisLine = this.line(pts, 0xf5c542);
  },
  setAxis(A, d, label){
    this.axis = {A: A.clone(), d: d.clone().normalize(), label};
    if(this.axisLine){ scene.remove(this.axisLine); this.axisLine.geometry.dispose(); }
    const L = 200;
    this.axisLine = this.line([A.clone().addScaledVector(this.axis.d, -L), A.clone().addScaledVector(this.axis.d, L)], 0x4da3ff);
    this.stage = 'ready'; this.preview(true);
  },
  afterProfile(){
    const lp = this.profile.loop.slice(); lp.push(lp[0]);
    if(this.profLine){ scene.remove(this.profLine); this.profLine.geometry.dispose(); }
    this.profLine = this.line(lp, 0x6aff3d);
    if(this.kind === 'sweep'){ this.path = orientPathToProfile(this.path, this.profile.loop); this.stage = 'ready'; this.preview(true); }
    else if(this.kind === 'loft'){ if(this.stage !== 'ready') this.stage = 'profile2'; }
    else if(!this.axis) this.stage = 'axis';
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 'profile'){
      const h = raycastFace(q);
      if(!h){ warnTip('Click the region to use as the profile'); return; }
      try{ this.profile = profileFromRegion(h.faceIndex); }catch(err){ warnTip(err.message); return; }
      showPatch(this.profile.patch, 0x6aff3d);
      this.afterProfile(); this.ui(); tipHide();
      return;
    }
    if(this.stage === 'profile2'){
      const h = raycastFace(q);
      if(!h){ warnTip('Click the second profile region'); return; }
      let p2;
      try{ p2 = profileFromRegion(h.faceIndex); }catch(err){ warnTip(err.message); return; }
      if(this.profile.patch && p2.patch && this.profile.patch.tris[0] === p2.patch.tris[0]){
        warnTip('Pick a different region for the second profile'); return;
      }
      this.profile2 = p2;
      const lp = p2.loop.slice(); lp.push(lp[0]);
      if(this.profLine2){ scene.remove(this.profLine2); this.profLine2.geometry.dispose(); }
      this.profLine2 = this.line(lp, 0x4da3ff);
      hidePatch();
      this.stage = 'ready'; tipHide(); this.preview(true);
      return;
    }
    if(this.stage === 'axis'){
      const pe = pickEdge(q);
      if(!pe){ warnTip('Click a straight line or edge for the axis, or press X/Y/Z'); return; }
      const pts = pe.chain.pts, A = pts[0], B = pts[pts.length-1], d = new THREE.Vector3().subVectors(B, A);
      if(d.length() < 0.1 || pts.some(p => new THREE.Vector3().subVectors(p, A).cross(d).length() / d.length() > 0.05)){
        warnTip('The axis must be a straight line'); return;
      }
      if(this.hoverLine){ scene.remove(this.hoverLine); this.hoverLine.geometry.dispose(); this.hoverLine = null; }
      this.setAxis(A, d, pe.chain.isGuide ? 'line' : 'edge');
      tipHide();
    }
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 'profile' || this.stage === 'profile2'){
      const h = raycastFace(q);
      if(!h){ hidePatch(); tipHide(); return; }
      cachedPatch = null;
      const patch = facePatchAt(h.faceIndex);
      const second = this.stage === 'profile2';
      showPatch(patch, second ? 0x4da3ff : 0x6aff3d);
      tipAt(e, (second ? 'Second profile · region ' : 'Profile · region ') + (Math.round((patch.area || 0)*10)/10) + ' mm² · click');
      return;
    }
    if(this.stage === 'axis'){
      const pe = pickEdge(q);
      if(this.hoverLine){ scene.remove(this.hoverLine); this.hoverLine.geometry.dispose(); this.hoverLine = null; }
      if(pe){ this.hoverLine = this.line(pe.chain.pts, 0x4da3ff); tipAt(e, 'Axis · ' + (pe.chain.isGuide ? 'line' : 'edge') + ' · click'); }
      else tipAt(e, 'Axis · click a straight line or edge · or X/Y/Z');
    }
  },
  key(e){
    const k = e.key.toLowerCase();
    if(this.kind === 'revolve' && (this.stage === 'axis' || this.stage === 'ready') && (k === 'x' || k === 'y' || k === 'z')){
      e.preventDefault();
      this.setAxis(new THREE.Vector3(), new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0), k.toUpperCase() + ' axis');
      return true;
    }
    if(e.key === 'Enter' && this.stage === 'ready'){ e.preventDefault(); this.commit(); return true; }
    return false;
  },
  esc(){
    if(this.kind === 'loft'){
      if(this.stage === 'ready'){
        this.stage = 'profile2'; this.profile2 = null; this.kill(); this.tris = null; this.err = '';
        if(this.profLine2){ scene.remove(this.profLine2); this.profLine2.geometry.dispose(); this.profLine2 = null; }
        this.ui(); return true;
      }
      if(this.stage === 'profile2' && this.profile && this.profile.patch){
        this.stage = 'profile'; this.profile = null; this.kill(); this.tris = null; this.err = ''; hidePatch();
        if(this.profLine){ scene.remove(this.profLine); this.profLine.geometry.dispose(); this.profLine = null; }
        this.ui(); return true;
      }
      return false;
    }
    if(this.stage === 'ready' && this.kind === 'revolve'){
      this.stage = 'axis'; this.axis = null; this.kill(); this.tris = null; this.err = '';
      if(this.axisLine){ scene.remove(this.axisLine); this.axisLine.geometry.dispose(); this.axisLine = null; }
      this.ui(); return true;
    }
    if((this.stage === 'axis' || this.stage === 'ready') && this.profile && this.profile.patch){
      this.stage = 'profile'; this.profile = null; this.axis = null; this.kill(); this.tris = null; this.err = ''; hidePatch();
      for(const k of ['axisLine', 'profLine']) if(this[k] && (k === 'profLine' || this.kind === 'revolve')){ scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
      this.ui(); return true;
    }
    return false;
  },
  params(){
    const a = parseFloat(String(pf_angle.value).replace(',', '.'));
    const s = parseInt(pf_segs.value, 10);
    return {angle: Number.isFinite(a) && Math.abs(a) >= 0.1 ? Math.max(-360, Math.min(360, a)) : 360, segs: s >= 3 ? Math.min(256, s) : 64};
  },
  build(){
    const p = this.params();
    if(this.kind === 'revolve') return revolveLoopTris(this.profile.loop, this.axis.A, this.axis.d, p.angle, p.segs);
    if(this.kind === 'loft') return loftLoopTris(this.profile.loop, this.profile2.loop);
    return sweepLoopTris(this.profile.loop, this.path.pts, this.path.closed);
  },
  preview(now){
    clearTimeout(this.timer);
    if(this.stage !== 'ready'){ this.err = ''; this.kill(); this.tris = null; this.ui(); return; }
    const run = () => {
      this.kill(); this.tris = null; this.err = '';
      try{
        this.tris = this.build();
        const arr = [];
        for(const t of this.tris) for(const v of t) arr.push(v.x, v.y, v.z);
        const cut = this.opNow() === 'cut';
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
        this.ghostG = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color: cut ? 0xff5a5a : 0x2ecc40, transparent: true,
          opacity: cut ? 0.22 : 0.3, depthWrite: false, depthTest: !cut, side: THREE.DoubleSide}));
        this.ghostG.renderOrder = 5;
        scene.add(this.ghostG);
      }catch(err){ this.tris = null; this.err = err.message; }
      this.ui();
    };
    if(now) run(); else this.timer = setTimeout(() => { if(activeTool === this) run(); }, 80);
  },
  ui(){
    const st = {profile: 'pick the profile', profile2: 'pick the second profile', axis: 'pick the axis',
                ready: this.opNow() === 'cut' ? 'cut' : 'join'}[this.stage];
    pf_state.textContent = st;
    for(const [id, o] of [['pf_auto', 'auto'], ['pf_join', 'join'], ['pf_cut', 'cut']]) document.getElementById(id).classList.toggle('on', this.op === o);
    pf_hint.hidden = !hintsChk.checked;
    pf_ok.disabled = !(this.stage === 'ready' && this.tris);
    pf_info.style.color = this.err ? '#ff6b6b' : '';
    if(this.err){ pf_info.textContent = this.err; return; }
    if(this.stage === 'profile'){ pf_info.textContent = this.kind === 'sweep'
      ? 'Path: ' + this.path.pts.length + ' points' + (this.path.closed ? ', closed' : '') + ' · click the profile region'
      : this.kind === 'loft' ? 'Click the first profile region' : 'Click the profile region'; return; }
    if(this.stage === 'profile2'){ pf_info.textContent = 'First profile: ' + this.profile.loop.length + ' points · click the second one'; return; }
    if(this.stage === 'axis'){ pf_info.textContent = 'Profile: ' + this.profile.loop.length + ' points · click the axis'; return; }
    if(this.tris){
      let v = 0; for(const [p, q, r] of this.tris) v += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
      pf_info.innerHTML = (this.kind === 'revolve' ? 'Around the ' + this.axis.label
        : this.kind === 'loft' ? this.profile.loop.length + ' → ' + this.profile2.loop.length + ' points'
        : 'Along ' + this.path.pts.length + ' points') + ' · '
        + Math.round(Math.abs(v)).toLocaleString('en-US').replace(/,/g, ' ') + ' mm³ · <b>' + (this.opNow() === 'cut' ? 'Cut' : 'Join') + '</b>';
    }
  },
  commit(){
    if(this.stage !== 'ready' || !this.tris){ warnTip('Finish the profile' + (this.kind === 'revolve' ? ' and the axis' : this.kind === 'loft' ? 's' : '')); return; }
    const tris = this.tris, op = this.opNow();
    const consume = [...(this.profile.consume || []), ...((this.profile2 && this.profile2.consume) || [])];
    this.kill();
    try{ applyProfileSolid(tris, op, consume); }
    catch(err){ warnTip(err.message); this.preview(true); return; }
    clearEdgeSel();
    setActiveTool(null);
  }
};
// Усечённый конус (цилиндр при r1 = r2) от A (радиус r1) к B (r2), замкнутый;
// один построитель для G,U и MCP add_frustum
function frustumTris(A, B, r1, r2, seg){
  const axis = new THREE.Vector3().subVectors(B, A).normalize();
  const u = (Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(axis).normalize();
  const v = axis.clone().cross(u);
  const ring = (C, r) => Array.from({length: seg}, (_, i) => {
    const t = i / seg * Math.PI * 2;
    return C.clone().addScaledVector(u, r*Math.cos(t)).addScaledVector(v, r*Math.sin(t));
  });
  const ra = ring(A, r1), rb = ring(B, r2), tris = [];
  for(let i=0;i<seg;i++){
    const j = (i+1) % seg;
    if(r1 > 0) tris.push([A, ra[j], ra[i]]);
    if(r2 > 0) tris.push([B, rb[i], rb[j]]);
    if(r1 > 0) tris.push([ra[i], ra[j], rb[j]]);
    if(r2 > 0) tris.push([ra[i], rb[j], rb[i]]);
  }
  return tris;
}
// ---------- G,U — цилиндр/конус на грани (Create → Cylinder во Fusion) ----------
// центр на грани (привязки как у окружности) → радиус мышью → высота вдоль
// нормали; наружу — Join, в тело — Cut (как Extrude; зажатый Ctrl — Cut).
// Top Ø отличный от Ø — конус (0 — остриё). Тело объединяется или вычитается
// точной булевой — та же zcApplySolid, что у MCP add_frustum
const cylTool = {
  hud: 'CYLINDER · click the center on a face → radius → height · type Ø / Height / Top Ø in the window · Ctrl — cut · Enter — apply · Esc — back',
  stage: 0, C: null, n: null, r: 0, h: 0, dLock: null, hLock: null, topD: null, seg: 0, segAuto: true,
  op: 'auto', ctrl: false, ghostG: null,
  on(){
    this.stage = 0; this.C = null; this.n = null; this.r = 0; this.h = 0;
    this.dLock = null; this.hLock = null; this.topD = null; this.segAuto = true; this.op = 'auto'; this.ctrl = false;
    cyl_d.value = ''; cyl_h.value = ''; cyl_t.value = ''; cyl_s.value = '';
    cylPopup.style.left = '16px'; cylPopup.style.top = '48px'; // в углу: клики — по модели
    cylPopup.hidden = false;
    this.ui();
  },
  off(){
    this.kill(); ghost.visible = false; tipHide();
    cylPopup.hidden = true; releaseToolInput();
  },
  kill(){ if(this.ghostG){ scene.remove(this.ghostG); this.ghostG.traverse(o => { if(o.geometry) o.geometry.dispose(); }); this.ghostG = null; } },
  modChange(e){
    const c = !!(e.ctrlKey || e.metaKey);
    if(c !== this.ctrl){ this.ctrl = c; if(this.stage >= 1) this.draw(); this.ui(); }
  },
  wantsCtrlClick(){ return this.stage >= 1; },
  radius(){ return this.dLock != null ? this.dLock / 2 : this.r; },
  height(){ return this.hLock != null ? this.hLock : this.h; },
  topR(){ return this.topD != null ? this.topD / 2 : this.radius(); },
  segs(){ return this.segAuto ? autoCircSegs(Math.max(this.radius(), this.topR(), 0.5)) : this.seg; },
  opNow(){
    if(this.op !== 'auto') return this.op;
    if(this.ctrl) return 'cut';
    return this.height() < 0 ? 'cut' : 'join';
  },
  // призрак тела: зелёный — добавить, красный — вырезать; плоский диск, пока нет высоты
  draw(){
    this.kill();
    const r = this.radius(), h = this.height(), rt = this.topR();
    if(!(r > 0) && !(rt > 0)) return;
    const cut = this.opNow() === 'cut', col = cut ? 0xff5a5a : 0x2ecc40;
    const g = new THREE.Group(), seg = this.segs();
    const A = this.C, B = this.C.clone().addScaledVector(this.n, Math.abs(h) < 0.05 ? 0.05 : h);
    const tris = frustumTris(A, B, r, Math.abs(h) < 0.05 ? r : rt, seg), arr = [];
    for(const t of tris) for(const p of t) arr.push(p.x, p.y, p.z);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    // вырез — внутри тела и скрыт гранью: рисуем его поверх, чтобы видно глубину
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: col, transparent: true, opacity: cut ? 0.22 : 0.3,
      depthWrite: false, depthTest: !cut, side: THREE.DoubleSide})));
    const axis = this.n, u = (Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(axis).normalize(), v = axis.clone().cross(u);
    const loop = (P, rr) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length: seg}, (_, i) => {
      const t = i / seg * Math.PI * 2; return P.clone().addScaledVector(u, rr*Math.cos(t)).addScaledVector(v, rr*Math.sin(t)); })),
      new THREE.LineBasicMaterial({color: col, depthTest: !cut}));
    if(r > 0) g.add(loop(A, r));
    if(Math.abs(h) >= 0.05 && rt > 0) g.add(loop(B, rt));
    g.renderOrder = 5;
    scene.add(g); this.ghostG = g;
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 0){
      const pk = pickOnFace(q);
      if(!pk || pk.ground){ warnTip('Click a face of the body for the cylinder center'); return; }
      this.C = pk.pos.clone(); this.n = pk.n.clone().normalize();
      ghost.visible = false;
      this.stage = this.dLock != null ? 2 : 1;
      this.draw(); this.ui();
      return;
    }
    if(this.stage === 1){
      if(!(this.radius() >= 0.1)){ warnTip('Move away from the center to set the radius'); return; }
      this.stage = 2; this.ui(); return;
    }
    if(this.stage === 2) this.commit();
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 0){ showPickGhost(e, q, 'Cylinder center · '); return; }
    if(this.stage === 1){
      const P = rayOnPlane(q, this.n, this.C);
      if(P && this.dLock == null){ this.r = Math.max(0.1, snapMM(P.distanceTo(this.C))); cyl_d.value = (2*this.r).toFixed(1); }
      this.draw(); this.ui();
      tipAt(e, 'Ø <b>' + (2*this.radius()).toFixed(1) + '</b> mm · click to set the height');
      return;
    }
    if(this.stage === 2){
      raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
      if(this.hLock == null){ this.h = snapMM(rayLineParam(raycaster.ray, this.C, this.n)); cyl_h.value = this.h.toFixed(1); }
      this.draw(); this.ui();
      tipAt(e, 'Height <b>' + this.height().toFixed(1) + '</b> mm · ' + (this.opNow() === 'cut' ? 'Cut' : 'Join') + ' · click to apply');
    }
  },
  key(e){
    if(e.key === 'Enter' && this.stage >= 1){ e.preventDefault(); this.enter(); return true; }
    return false;
  },
  enter(){
    if(this.stage === 1 && this.radius() >= 0.1){ this.stage = 2; this.draw(); this.ui(); return; }
    if(this.stage === 2) this.commit();
  },
  esc(){ // шаг назад: высота → радиус → центр → выход
    if(this.stage === 0) return false;
    if(this.stage === 2){ this.stage = 1; this.h = 0; this.hLock = null; cyl_h.value = ''; }
    else { this.stage = 0; this.C = null; this.kill(); }
    this.draw(); this.ui(); tipHide();
    return true;
  },
  ui(){
    cyl_state.textContent = ['center', 'radius', 'height'][this.stage] + (this.stage === 2 ? ' · ' + (this.opNow() === 'cut' ? 'cut' : 'join') : '');
    for(const [id, o] of [['cyl_auto', 'auto'], ['cyl_join', 'join'], ['cyl_cut', 'cut']])
      document.getElementById(id).classList.toggle('on', this.op === o);
    if(this.segAuto) cyl_s.placeholder = String(this.segs());
    cyl_t.placeholder = '= Ø';
    cyl_hint.hidden = !hintsChk.checked;
    const r = this.radius(), h = this.height(), rt = this.topR();
    cyl_ok.disabled = !(this.stage === 2 && Math.abs(h) >= 0.1 && r >= 0.1);
    if(this.stage === 0){ cyl_info.textContent = 'Click the center on a face'; return; }
    if(this.stage === 1){ cyl_info.textContent = 'Ø ' + (2*r).toFixed(1) + ' mm · click or Enter for the height'; return; }
    const V = Math.PI * Math.abs(h) / 3 * (r*r + r*rt + rt*rt);
    cyl_info.innerHTML = (Math.abs(rt - r) < 1e-9 ? 'Cylinder' : rt < 1e-9 ? 'Cone' : 'Frustum') + ' · ' + Math.round(V).toLocaleString('en-US').replace(/,/g, ' ') + ' mm³ · <b>' + (this.opNow() === 'cut' ? 'Cut' : 'Join') + '</b>';
  },
  commit(){
    const r = this.radius(), h = this.height(), rt = this.topR();
    if(!(r >= 0.1) || Math.abs(h) < 0.1){ warnTip('Set the radius and a height of at least 0.1 mm'); return; }
    const op = this.opNow();
    const tris = frustumTris(this.C, this.C.clone().addScaledVector(this.n, h), r, rt, this.segs());
    this.kill();
    let res;
    try { res = zcApplySolid(tris, op); }
    catch(err){ warnTip('Cylinder failed here: ' + err.message); this.draw(); return; }
    if(Math.abs(res.volume_change_mm3) < 1e-3){
      undo(true);
      warnTip(op === 'cut' ? 'Nothing to cut here — the cylinder is outside the body' : 'Nothing to add — the body is already there');
      this.draw(); return;
    }
    // следующий цилиндр — сразу с центра (размеры в полях остаются)
    this.stage = 0; this.C = null; this.h = 0; this.hLock = null; cyl_h.value = '';
    this.ui();
  }
};
// ---------- G,S — Slice: срез тела плоскостью (Bisect в Blender, Split Body во Fusion) ----------
// Остаётся сторона против нормали плоскости. Сначала точный planeCut (каждый
// треугольник отсекается, сечение — одна петля, крышка ушами); если сечение
// не одна петля (труба, вложенные контуры) — точное вычитание коробки
// полупространства. Одна функция для окна и MCP cut_plane
function slicePlaneArray(pos, P, n){
  const out = planeCut(pos, P, n);
  if(out) return out;
  const box = new THREE.Box3();
  for(let i=0;i<pos.length;i+=3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i+1], pos[i+2]));
  const R = box.getSize(new THREE.Vector3()).length() + 10;
  const C = box.getCenter(new THREE.Vector3()), O = C.clone().addScaledVector(n, n.dot(new THREE.Vector3().subVectors(P, C)));
  const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize(), w = n.clone().cross(u);
  const c = (a, b, h) => O.clone().addScaledVector(u, a*R).addScaledVector(w, b*R).addScaledVector(n, h*R);
  const q = [[-1,-1],[1,-1],[1,1],[-1,1]], lo = q.map(([a, b]) => c(a, b, 0)), hi = q.map(([a, b]) => c(a, b, 1));
  let tris = [[lo[0], lo[2], lo[1]], [lo[0], lo[3], lo[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[2], hi[3]]];
  for(let i=0;i<4;i++){ const j = (i+1)%4; tris.push([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]]); }
  let vol = 0; for(const [p, qq, r] of tris) vol += p.dot(new THREE.Vector3().crossVectors(qq, r)) / 6;
  if(vol < 0) tris = tris.map(t => [t[0], t[2], t[1]]);
  const body = [];
  for(let i=0;i<pos.length;i+=9)
    body.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]), new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]), new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
  return meshBoolean(body, tris, 'subtract');
}
// применить срез к модели: одна запись истории; линии, оставшиеся в воздухе, убираются
function applySlice(P, n, snap){
  const pos = snap ? snap.pos : mesh.geometry.attributes.position.array;
  const v0 = meshVolumeOf(pos);
  const out = slicePlaneArray(pos, P, n);
  if(!out.length) throw new Error('the plane removes the whole body');
  const dv = meshVolumeOf(out) - v0;
  if(dv > -1e-6) throw new Error('the plane does not cut the body — nothing to remove on this side');
  if(snap) pushHistory(snap); else pushUndo();
  setMeshFromArray(out);
  weldVertices(0.0015); cleanupMesh();
  if(openEdgeCount() || nonManifoldEdgeCount()) healAll();
  dropAirGuides();
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  clearEdgeSel(); deselect(); hidePatch(); ppPatch = null;
  extractEdges();
  return meshVolumeOf(mesh.geometry.attributes.position.array) - v0;
}
const sliceTool = {
  hud: 'SLICE · hover a face — the plane is parallel to it · click, move to offset, click to fix · X/Y/Z — axis plane · F — flip · Enter — apply · Esc',
  // stage 0 — плоскость ходит за гранью под курсором; 1 — плоскость поставлена,
  // мышь двигает её вдоль нормали; 2 — зафиксирована (правка полями)
  stage: 0, P0: null, n: null, offset: 0, axis: 'face', faceN: null, snap: null, committed: false,
  plane: null, ghost: null, timer: 0, result: null, t0: 0,
  on(){
    this.snap = takeSnapshot(); this.committed = false;
    this.stage = 0; this.P0 = null; this.n = null; this.offset = 0; this.axis = 'face'; this.faceN = null; this.result = null;
    // окно — в углу вида, а не у курсора: после G,S кликают по модели там же,
    // где курсор, и окно у курсора перехватывало клик
    slicePopup.style.left = '16px';
    slicePopup.style.top = '48px';
    slicePopup.hidden = false;
    sl_off.value = 0;
    this.ui();
  },
  off(){
    clearTimeout(this.timer);
    this.killVisuals();
    if(!this.committed && this.snap && this.result) this.restore();
    slicePopup.hidden = true; releaseToolInput(); tipHide();
    this.snap = null;
  },
  restore(){
    setMeshFromArray(this.snap.pos);
    hardEdges = this.snap.hard.map(h => ({a: h.a.clone(), b: h.b.clone()}));
    extractEdges();
    this.result = null;
  },
  killVisuals(){
    for(const k of ['plane', 'ghost']) if(this[k]){ scene.remove(this[k]); this[k].traverse(o => { if(o.geometry) o.geometry.dispose(); }); this[k] = null; }
  },
  planeP(){ return this.P0.clone().addScaledVector(this.n, this.offset); },
  // полупрозрачная плоскость размером с тело, по центру — проекция центра габарита
  drawPlane(P, n){
    if(this.plane){ scene.remove(this.plane); this.plane.traverse(o => { if(o.geometry) o.geometry.dispose(); }); }
    const pos = this.snap.pos, box = new THREE.Box3();
    for(let i=0;i<pos.length;i+=3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i+1], pos[i+2]));
    const S = box.getSize(new THREE.Vector3()).length() * 0.75 + 5;
    const C = box.getCenter(new THREE.Vector3());
    const O = C.clone().addScaledVector(n, n.dot(new THREE.Vector3().subVectors(P, C)));
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2*S, 2*S),
      new THREE.MeshBasicMaterial({color: 0x4da3ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false}));
    g.add(m);
    const fr = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-S,-S],[S,-S],[S,S],[-S,S]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
      new THREE.LineBasicMaterial({color: 0x4da3ff}));
    g.add(fr);
    // стрелка — в сторону, которая будет удалена
    const arr = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), Math.max(4, S * 0.25), 0xff5a5a, Math.max(1.5, S*0.06), Math.max(1, S*0.04));
    g.add(arr);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.position.copy(O.clone().addScaledVector(n, 0));
    // стрелка — у точки плоскости под курсором, а не в центре квадрата
    arr.position.copy(new THREE.Vector3().subVectors(P, O).applyQuaternion(g.quaternion.clone().invert()));
    g.renderOrder = 5;
    scene.add(g); this.plane = g;
  },
  hitFace(q){
    raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.snap.pos, 3));
    const probe = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
    probe.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(probe);
    pg.dispose();
    if(!hits.length) return null;
    const h = hits[0], o = h.faceIndex * 9, sp = this.snap.pos;
    const n = new THREE.Vector3(sp[o+3]-sp[o], sp[o+4]-sp[o+1], sp[o+5]-sp[o+2])
      .cross(new THREE.Vector3(sp[o+6]-sp[o], sp[o+7]-sp[o+1], sp[o+8]-sp[o+2])).normalize();
    return {P: h.point.clone(), n};
  },
  axisN(){ // нормаль по выбранной ориентации; знак — как у нормали грани
    if(this.axis === 'face') return this.faceN.clone();
    const a = new THREE.Vector3(this.axis === 'x' ? 1 : 0, this.axis === 'y' ? 1 : 0, this.axis === 'z' ? 1 : 0);
    return this.faceN && this.faceN.dot(a) < 0 ? a.negate() : a;
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    if(this.stage === 1){ this.stage = 2; this.ui(); return; }
    const h = this.hitFace(q);
    if(!h){ warnTip('Click a face of the body to place the slice plane'); return; }
    if(this.result) this.restore();
    this.P0 = new THREE.Vector3(Math.round(h.P.x*1000)/1000, Math.round(h.P.y*1000)/1000, Math.round(h.P.z*1000)/1000); this.faceN = h.n; this.n = this.axisN(); this.offset = 0; this.flipped = false;
    this.stage = 1; sl_off.value = 0;
    this.preview(true);
  },
  move(e, q){
    if(!q.inside) return;
    if(this.stage === 0){
      const h = this.hitFace(q);
      if(!h){ if(this.plane){ scene.remove(this.plane); this.plane = null; } tipHide(); return; }
      this.faceN = h.n;
      const n = this.axisN();
      this.drawPlane(h.P, n);
      tipAt(e, 'Slice plane · click to place');
      return;
    }
    if(this.stage === 1){ // плоскость едет вдоль нормали за мышью, шаг 0.1
      raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
      const t = snapMM(rayLineParam(raycaster.ray, this.P0, this.n));
      if(t !== this.offset){ this.offset = t; sl_off.value = t.toFixed(1); this.preview(); }
      tipHide();
    }
  },
  key(e){
    if(this.stage === 0 && !this.faceN) return false;
    const k = e.key.toLowerCase();
    if(k === 'x' || k === 'y' || k === 'z'){ this.setAxis(this.axis === k ? 'face' : k); e.preventDefault(); return true; }
    if(k === 'f' && this.P0){ this.flip(); e.preventDefault(); return true; }
    if(e.key === 'Enter' && this.P0){ this.commit(); e.preventDefault(); return true; }
    return false;
  },
  esc(){ // Esc: с поставленной плоскости — назад к выбору грани, потом выход
    if(!this.P0) return false;
    clearTimeout(this.timer);
    if(this.result) this.restore();
    this.killVisuals(); this.stage = 0; this.P0 = null; this.offset = 0; sl_off.value = 0; this.ui();
    return true;
  },
  setAxis(ax){
    this.axis = ax;
    if(this.P0){ this.n = this.axisN(); if(this.flipped) this.n.negate(); this.preview(true); }
    this.ui();
  },
  flip(){
    if(!this.P0) return;
    this.flipped = !this.flipped; this.n.negate(); this.offset = -this.offset; sl_off.value = this.offset.toFixed(1);
    this.preview(true);
  },
  preview(now){
    this.drawPlane(this.planeP(), this.n);
    this.ui();
    clearTimeout(this.timer);
    if(now) this.apply(); else this.timer = setTimeout(() => { if(activeTool === this) this.apply(); }, 70);
  },
  // результат от исходной сетки: остаток — в сцене, удаляемое — красным призраком
  apply(){
    const P = this.planeP(), n = this.n, pos = this.snap.pos;
    if(this.ghost){ scene.remove(this.ghost); this.ghost.geometry.dispose(); this.ghost = null; }
    try{
      const v0 = meshVolumeOf(pos);
      const keep = slicePlaneArray(pos, P, n);
      const vk = meshVolumeOf(keep);
      if(!keep.length){ this.fail('The plane removes the whole body — move it or press F'); return; }
      if(v0 - vk < 1e-6){ this.fail('The plane does not cut the body on this side'); return; }
      setMeshFromArray(keep); extractEdges();
      this.result = {removed: v0 - vk, kept: vk};
      const cut = slicePlaneArray(pos, P, n.clone().negate());
      if(cut.length){
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(cut, 3));
        this.ghost = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color: 0xff5a5a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide}));
        scene.add(this.ghost);
      }
      sl_info.style.color = '';
      sl_ok.disabled = false;
    }catch(err){
      console.warn('slice preview failed', err);
      this.fail('Slice failed here: ' + err.message);
      return;
    }
    this.ui();
  },
  fail(msg){
    if(this.result) this.restore();
    this.result = null; sl_ok.disabled = true;
    sl_info.style.color = '#ff6b6b'; sl_info.textContent = msg;
  },
  ui(){
    sl_state.textContent = this.stage === 0 ? 'pick a face' : this.stage === 1 ? 'move to offset · click to fix' : 'fixed';
    for(const [id, a] of [['sl_face', 'face'], ['sl_x', 'x'], ['sl_y', 'y'], ['sl_z', 'z']])
      document.getElementById(id).classList.toggle('on', this.axis === a);
    sl_flip.disabled = !this.P0; sl_off.disabled = !this.P0;
    sl_hint.hidden = !hintsChk.checked;
    if(!this.P0){ sl_ok.disabled = true; sl_info.style.color = ''; sl_info.innerHTML = 'Hover a face, click to place the plane'; return; }
    if(this.result){
      const f = x => x >= 1000 ? Math.round(x).toLocaleString('en-US').replace(/,/g, ' ') : x.toFixed(1);
      sl_info.style.color = '';
      sl_info.innerHTML = 'Removes <b>' + f(this.result.removed) + '</b> mm³ · keeps ' + f(this.result.kept) + ' mm³';
    }
  },
  commit(){
    clearTimeout(this.timer);
    if(!this.P0) return;
    if(!this.result){ this.apply(); if(!this.result){ warnTip(sl_info.textContent || 'Slice failed'); return; } }
    const P = this.planeP(), n = this.n.clone();
    this.killVisuals();
    try{
      setMeshFromArray(this.snap.pos);
      applySlice(P, n, this.snap);
      this.committed = true;
    }catch(err){
      this.restore(); warnTip(err.message); return;
    }
    setActiveTool(null);
  }
};

// ---------- Ctrl+B — Bevel (как в Blender): фаска и скругление ребра ----------
// Одно ребро или несколько (Ctrl+клик). 1 сегмент — фаска, 2+ — дуга,
// касательная к обеим граням. Size — отступ от ребра вдоль каждой грани
// (для прямого угла это и есть радиус). Вырез строится профилем, вытянутым
// вдоль ребра, и вычитается нашим BSP — как карман
function analyzeBevelEdge(pts){
  const A = pts[0], B = pts[pts.length-1];
  const e = new THREE.Vector3().subVectors(B, A);
  const L = e.length();
  if(L < 0.2) return {err: 'Edge is too short'};
  e.multiplyScalar(1/L);
  for(const P of pts){
    const off = new THREE.Vector3().subVectors(P, A);
    if(off.addScaledVector(e, -off.dot(e)).length() > 0.02) return {err: 'Only straight edges can be beveled'};
  }
  const ka = keyOf(pts[0].x, pts[0].y, pts[0].z), kb = keyOf(pts[1].x, pts[1].y, pts[1].z);
  const tr = trisOnEdge(ka, kb);
  if(tr.length !== 2) return {err: 'Edge must join exactly two faces'};
  const pos = mesh.geometry.attributes.position.array;
  const side = rec => { // наружная нормаль грани и направление от ребра в глубь грани
    const n = triNormalAtOffset(rec.i);
    const t = new THREE.Vector3().crossVectors(n, e).normalize();
    for(let j=0;j<3;j++) if(rec.k[j] !== ka && rec.k[j] !== kb){
      const C = new THREE.Vector3(pos[rec.i+j*3], pos[rec.i+j*3+1], pos[rec.i+j*3+2]);
      if(t.dot(C.sub(A)) < 0) t.negate();
    }
    return {n, t};
  };
  const s1 = side(tr[0]), s2 = side(tr[1]);
  const alpha = Math.acos(Math.max(-1, Math.min(1, s1.t.dot(s2.t))));
  if(alpha < 5*Math.PI/180 || alpha > 175*Math.PI/180) return {err: 'Faces are almost flat — nothing to bevel'};
  if(s1.t.dot(s2.n) > -1e-6) return {err: 'Only convex edges for now'};
  // Конец ребра упирается в стенку (грань смотрит назад, на ребро) — вырез
  // там кончается. Иначе за концом воздух или соседнее скругление, укоротившее
  // ребро: вырез продлевается, чтобы угол скруглился так же, как при
  // скруглении обоих рёбер разом
  const openEnd = (P, out) => {
    for(const ti of (vertTris.get(keyOf(P.x, P.y, P.z)) || []))
      if(triNormalAt(ti).dot(out) < -0.3) return false;
    return true;
  };
  return {A: A.clone(), B: B.clone(), e, L, t1: s1.t, n1: s1.n, t2: s2.t, n2: s2.n, alpha,
          openA: openEnd(A, e.clone().negate()), openB: openEnd(B, e)};
}
// профиль выреза в точке P ребра. Стороны вдоль граней вынесены на eps в
// воздух: копланарные с гранями плоскости BSP разрезает ненадёжно
function bevelProfile(ed, P, size, segs){
  const eps = 0.5;
  const T1 = P.clone().addScaledVector(ed.t1, size);
  const T2 = P.clone().addScaledVector(ed.t2, size);
  const arc = [T1];
  if(segs >= 2){
    const r = size * Math.tan(ed.alpha / 2);
    const C = T1.clone().addScaledVector(ed.n1, -r);
    const phi = Math.acos(Math.max(-1, Math.min(1, ed.n1.dot(ed.n2))));
    for(let k=1;k<segs;k++){
      const f = k / segs;
      const dir = ed.n1.clone().multiplyScalar(Math.sin((1-f)*phi))
        .addScaledVector(ed.n2, Math.sin(f*phi)).multiplyScalar(1 / Math.sin(phi));
      arc.push(C.clone().addScaledVector(dir, r));
    }
  }
  arc.push(T2);
  return {arc, loop: [T1.clone().addScaledVector(ed.n1, eps), ...arc,
    T2.clone().addScaledVector(ed.n2, eps),
    P.clone().addScaledVector(ed.n1, eps).addScaledVector(ed.n2, eps)]};
}
// запас выреза за концом ребра: у стенки — чуть-чуть, у открытого конца —
// с перекрытием соседнего скругления того же порядка размера
function bevelExt(ed, size, end){
  return (end === 'A' ? ed.openA : ed.openB) ? 2*size + 1 : 0.02;
}
function bevelPrism(ed, size, segs){
  const mA = bevelExt(ed, size, 'A'), mB = bevelExt(ed, size, 'B');
  const P0 = ed.A.clone().addScaledVector(ed.e, -mA);
  let loop = bevelProfile(ed, P0, size, segs).loop;
  const nw = new THREE.Vector3(); // Ньюэлл: профиль должен обходиться против часовой вокруг e
  for(let i=0;i<loop.length;i++){
    const a = loop[i], b = loop[(i+1)%loop.length];
    nw.x += (a.y-b.y)*(a.z+b.z); nw.y += (a.z-b.z)*(a.x+b.x); nw.z += (a.x-b.x)*(a.y+b.y);
  }
  if(nw.dot(ed.e) < 0) loop = loop.reverse();
  return buildPrismTris(loop, ed.e, ed.L + mA + mB, 0);
}
// Предпросмотр — сам результат на модели, как Bevel в Blender и Fillet во
// Fusion: тело живьём срезается при каждом изменении окна (с короткой
// задержкой, чтобы ввод не тормозил), новые рёбра видны обычными рёбрами.
// Cancel/Esc возвращает исходную сетку и выбор рёбер, OK лишь фиксирует
// уже показанное и пишет одну запись истории
const bevelTool = {
  hud: 'BEVEL · size and segments in the window (1 — chamfer, 2+ — round) · Enter — OK · Esc',
  // face: номер треугольника выбранной грани — фаска по её контурам (Chamfer
  // по грани во Fusion берёт весь контур); иначе edges — прямые рёбра
  edges: [], face: -1, loops: 'outer', snap: null, shown: null, timer: 0, committed: false,
  on(){
    const vr = view.getBoundingClientRect();
    bevPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 340) + 'px';
    bevPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 320) + 'px';
    bevPopup.hidden = false;
    bev_hint.hidden = !hintsChk.checked;
    this.snap = takeSnapshot(); this.shown = null; this.committed = false;
    bev_loops.hidden = this.face < 0;
    this.paintLoops();
    this.selKeys = edgeSel.map(es=>es.key); // вернуть выбор, если отменят
    for(const es of edgeSel) es.line.visible = false; // зелёные линии висели бы над срезом
    hideSelEnds();
    this.preview(true);
    bev_d.focus(); bev_d.select();
  },
  off(){
    clearTimeout(this.timer);
    bevPopup.hidden = true; releaseToolInput(); tipHide();
    if(!this.committed && this.snap){ // отмена: исходная сетка и прежний выбор
      if(this.shown || this.face >= 0){
        setMeshFromArray(this.snap.pos);
        restoreGuides(this.snap.guides);
        hardEdges = this.snap.hard.map(h=>({a: h.a.clone(), b: h.b.clone()}));
        extractEdges();
        for(const ch of chains) if(this.selKeys.includes(edgeSelKey(ch))) toggleEdgeSel(ch);
      }
      for(const es of edgeSel) es.line.visible = true;
    }
    this.snap = null; this.shown = null; this.face = -1;
  },
  paintLoops(){
    for(const [id, w] of [['bev_outer', 'outer'], ['bev_holes', 'holes'], ['bev_all', 'all']])
      document.getElementById(id).classList.toggle('on', this.loops === w);
  },
  params(){
    return {size: Math.max(0.1, snapMM(+bev_d.value || 0.1)),
            segs: Math.max(1, Math.min(32, Math.round(+bev_s.value || 1)))};
  },
  down(){}, move(){},
  key(e){ if(e.key === 'Enter'){ this.commit(); e.preventDefault(); return true; } return false; },
  preview(now){
    const {size, segs} = this.params();
    bev_kind.textContent = (segs === 1 ? 'chamfer' : 'round') + (this.face >= 0 ? ' · outline' : '');
    bev_info.style.color = '';
    if(this.face >= 0){
      bev_info.textContent = '…';
    } else {
      const alpha = this.edges[0].alpha;
      bev_info.textContent = segs === 1
        ? 'Face ' + (2 * size * Math.sin(alpha / 2)).toFixed(2) + ' mm wide'
        : 'R ' + (size * Math.tan(alpha / 2)).toFixed(2) + ' mm · ' + segs + ' segments';
    }
    clearTimeout(this.timer);
    if(now) this.apply();
    else this.timer = setTimeout(()=>{ if(activeTool === this) this.apply(); }, 120);
  },
  // срез тела по текущим параметрам (всегда от исходной сетки)
  apply(){
    const {size, segs} = this.params();
    const sig = size + '|' + segs + '|' + (this.face >= 0 ? this.loops : '');
    if(this.shown === sig) return true;
    const base = this.snap.pos;
    if(this.face >= 0) return this.applyFace(size, segs, sig);
    try{
      let body = [];
      for(let i=0;i<base.length;i+=9)
        body.push([new THREE.Vector3(base[i],base[i+1],base[i+2]),
                   new THREE.Vector3(base[i+3],base[i+4],base[i+5]),
                   new THREE.Vector3(base[i+6],base[i+7],base[i+8])]);
      for(const ed of this.edges){
        body = csgSubtract(body, bevelPrism(ed, size, segs));
        body = body.filter(t => new THREE.Vector3().subVectors(t[1],t[0])
          .cross(new THREE.Vector3().subVectors(t[2],t[0])).length() > 1e-6);
      }
      const q = x => Math.round(x*1000)/1000;
      const arr = [];
      for(const t of body) for(const v of t) arr.push(q(v.x), q(v.y), q(v.z));
      setMeshFromArray(new Float32Array(arr));
      healAfterBool();
      // стык нескольких скруглений: убрать вершины-разрезы на прямых и
      // заново сшить Т-стыки, иначе грани расползаются на треугольники
      if(collapseCollinearVertices()){
        for(let i=0;i<40;i++){
          const len0 = mesh.geometry.attributes.position.array.length;
          cleanupMesh(); healTJunctions();
          if(mesh.geometry.attributes.position.array.length === len0) break;
        }
        removeInvertedShells();
      }
      // рёбра между гранями скругления — жёсткие: видны и выбираются при
      // любом числе сегментов. Отрезки с запасом за концы, как у выреза
      hardEdges = this.snap.hard.map(h=>({a: h.a.clone(), b: h.b.clone()}));
      if(segs >= 2) for(const ed of this.edges){
        const P0 = ed.A.clone().addScaledVector(ed.e, -bevelExt(ed, size, 'A'));
        const P1 = ed.B.clone().addScaledVector(ed.e, bevelExt(ed, size, 'B'));
        const a0 = bevelProfile(ed, P0, size, segs).arc, a1 = bevelProfile(ed, P1, size, segs).arc;
        for(let k=0;k<a0.length;k++) hardEdges.push({a: a0[k], b: a1[k]});
      }
      extractEdges();
      this.shown = sig;
      bev_ok.disabled = false;
      return true;
    }catch(err){
      console.warn('bevel failed', err);
      setMeshFromArray(base);
      hardEdges = this.snap.hard.map(h=>({a: h.a.clone(), b: h.b.clone()}));
      extractEdges();
      this.shown = null;
      bev_info.style.color = '#ff6b6b';
      bev_info.textContent = 'Bevel failed with these values';
      bev_ok.disabled = true;
      return false;
    }
  },
  // по грани: всегда от исходной сетки; записи истории, которые делают
  // хирургия и булева, снимаются — окно пишет одну запись при OK
  applyFace(size, segs, sig){
    setMeshFromArray(this.snap.pos);
    restoreGuides(this.snap.guides);
    hardEdges = this.snap.hard.map(h=>({a: h.a.clone(), b: h.b.clone()}));
    const u0 = undoStack.length, redo0 = redoStack.slice();
    try{
      const r = bevelFaceOutlines(this.face, size, segs, this.loops);
      undoStack.length = u0; redoStack = redo0;
      clearEdgeSel(); hideSelEnds();
      extractEdges();
      this.shown = sig;
      bev_ok.disabled = false;
      const n = r.outlines || 1;
      bev_info.textContent = (n === 1 ? '1 outline' : n + ' outlines') + ' · ' + Math.abs(r.volume_change_mm3).toFixed(1) + ' mm³ removed';
      return true;
    }catch(err){
      undoStack.length = Math.min(undoStack.length, u0); redoStack = redo0;
      setMeshFromArray(this.snap.pos);
      restoreGuides(this.snap.guides);
      extractEdges();
      this.shown = null;
      bev_info.style.color = '#ff6b6b';
      bev_info.textContent = err.message.replace(/^size /, 'Size ');
      bev_ok.disabled = true;
      return false;
    }
  },
  commit(){
    clearTimeout(this.timer);
    if(!this.apply()){ warnTip('Bevel failed on this edge'); return; }
    pushHistory(this.snap); // одна запись: Ctrl+Z вернёт тело до фаски
    this.committed = true;
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    clearEdgeSel(); hideChordHint();
    setActiveTool(null);
  }
};

// Выбранные линии лежат на стенке цилиндра? Каждая точка — на расстоянии
// от оси между прогибом хорды и радиусом, и хоть одна вне плоскости круга
// (иначе это линия на самом круге, её ось не очевидна). Из колец одной оси
// берём самое густое. Как Circular Pattern во Fusion, который сам берёт ось
// выбранной цилиндрической грани
function cylinderFor(items){
  const pts = [];
  for(const sg of items.segs) pts.push(sg.A, sg.B);
  for(const P of items.pts) pts.push(P);
  if(!pts.length) return null;
  let best = null;
  for(const r of snapRings){
    const sag = r.R * (1 - Math.cos(Math.PI / Math.max(3, r.segs))) + 0.01;
    let ok = true, off = false;
    for(const P of pts){
      const w = new THREE.Vector3().subVectors(P, r.ctr), h = w.dot(r.n);
      const d = w.addScaledVector(r.n, -h).length();
      if(d > r.R + 0.01 || d < r.R - sag){ ok = false; break; }
      if(Math.abs(h) > 0.01) off = true;
    }
    if(ok && off && (!best || r.segs > best.segs)) best = r;
  }
  return best;
}
// Подсказка массива: ось через центр (синяя) и радиус от оси до выбранного
// (жёлтый пунктир) — видно, вокруг чего и на каком радиусе пойдут копии
function arrayAxisGuides(items, C, n){
  const pts = [];
  for(const sg of items.segs) pts.push(sg.A, sg.B);
  for(const P of items.pts) pts.push(P);
  if(!pts.length || !C || !n) return [];
  const M = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  const h = new THREE.Vector3().subVectors(M, C).dot(n);
  const foot = C.clone().addScaledVector(n, h);
  const R = foot.distanceTo(M);
  const L = Math.max(10, R * 0.4);
  const out = [];
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      foot.clone().addScaledVector(n, -L), foot.clone().addScaledVector(n, L)]),
    new THREE.LineBasicMaterial({color: 0x4fa3ff, depthTest: false}));
  axis.renderOrder = 5; scene.add(axis); out.push(axis);
  if(R > 0.05){
    const rad = new THREE.Line(new THREE.BufferGeometry().setFromPoints([foot, M]),
      new THREE.LineDashedMaterial({color: 0xffcc00, dashSize: 1.2, gapSize: 0.8, depthTest: false}));
    rad.computeLineDistances(); rad.renderOrder = 5; scene.add(rad); out.push(rad);
  }
  return out;
}
// G,A — Круговой массив (PolarPattern во FreeCAD): выбранные линии/точка
// размножаются вокруг центра. Угол 360 — копии ровно по кругу, меньше —
// веером от исходника до крайней копии включительно
const arrTool = {
  hud: 'POLAR ARRAY · click the center · count and angle in the window · Enter — OK · Esc',
  items: null, center: null, n: null, ghosts: [], cyl: null, auto: false,
  on(){
    this.center = null;
    const vr = view.getBoundingClientRect();
    arrPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 340) + 'px';
    arrPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 420) + 'px';
    arr_status.textContent = 'click the array center';
    arrPopup.hidden = false;
    // линии на стенке цилиндра: ось найдена сама, число копий — «ровное»
    this.cyl = cylinderFor(this.items);
    this.auto = !!this.cyl;
    if(this.cyl){
      this.center = this.cyl.ctr.clone(); this.n = this.cyl.n.clone();
      arr_n.value = ringAutoCount(this.cyl.segs); arr_a.value = 360;
      arr_status.textContent = 'cylinder axis · click to pick another center · Enter — OK';
    }
    this.preview();
  },
  // строки режима цилиндра: радиус и сегменты, статус шага, кнопки делителей
  ui(){
    const c = this.cyl;
    for(const el of [arr_cyl, arr_sugg]) el.style.display = c ? '' : 'none';
    arr_hint.style.display = c && hintsChk.checked ? '' : 'none';
    arr_auto.style.display = c && this.auto ? '' : 'none';
    if(!c){ arr_stat.style.display = 'none'; return; }
    arr_cyl.innerHTML = '<div>Cylinder R ' + c.R.toFixed(1) + ' mm</div><div>' + c.segs + ' segments</div>';
    const cnt = Math.max(2, Math.min(360, Math.round(+arr_n.value || 6)));
    const total = Math.max(1, Math.min(360, +arr_a.value || 360));
    const step = Math.abs(total - 360) < 1e-6 ? 360 / cnt : total / (cnt - 1);
    const k = step / (360 / c.segs);
    const onWall = Math.abs(k - Math.round(k)) < 1e-6;
    arr_stat.style.display = '';
    arr_stat.style.color = onWall ? '#6aff3d' : '#ffcc00';
    arr_stat.textContent = onWall ? 'on the wall' : '⚠ off the wall faces';
    arr_sugg.innerHTML = ringCounts(c.segs)
      .map(v => '<button class="dvs' + (v === cnt && Math.abs(total - 360) < 1e-6 ? ' sel' : '') + '" data-n="' + v + '">' + v + '</button>').join('');
  },
  off(){ killObjs(this.ghosts); arrPopup.hidden = true; releaseToolInput(); ghost.visible = false; tipHide(); },
  angles(){
    const cnt = Math.max(2, Math.min(360, Math.round(+arr_n.value || 6)));
    const total = Math.max(1, Math.min(360, +arr_a.value || 360));
    const step = Math.abs(total - 360) < 1e-6 ? 360 / cnt : total / (cnt - 1);
    const out = [];
    for(let k=1;k<cnt;k++) out.push(k * step * Math.PI / 180);
    return out;
  },
  preview(center, n){
    killObjs(this.ghosts);
    const C = center || this.center, N = n || this.n;
    if(C){
      this.ghosts = rotGhosts(this.items, C, N, this.angles());
      this.ghosts.push(...arrayAxisGuides(this.items, C, N));
    }
    this.ui();
  },
  // центр и ось по точке под курсором: центр или квадрант окружности — ось
  // самой окружности (отверстие вала — ось шестерни), иначе нормаль грани.
  // Раньше ось всегда была нормалью грани под курсором: щелчок по стенке
  // давал горизонтальную ось, и копии разлетались в воздух — «зависит от камеры»
  pickCenter(q){
    const pt = linePickPoint(q);
    if(pt && (pt.kind === 'center' || pt.kind === 'quadrant')){
      const ring = snapRings.find(r => pt.kind === 'center' ? r.ctr.distanceTo(pt.pos) < 0.05
        : Math.abs(r.ctr.distanceTo(pt.pos) - r.R) < 0.05 && Math.abs(new THREE.Vector3().subVectors(pt.pos, r.ctr).dot(r.n)) < 0.05);
      if(ring) return {pos: pt.kind === 'center' ? pt.pos.clone() : ring.ctr.clone(), n: ring.n.clone(), kind: pt.kind};
    }
    return pickToolCenter(q, this.items);
  },
  down(e, q){
    if(e.button !== 0 || !q.inside) return;
    const pk = this.pickCenter(q);
    if(!pk) return;
    this.center = pk.pos; this.n = pk.n;
    this.cyl = null; // центр выбран руками — ось цилиндра больше не действует
    arr_status.textContent = 'center set · click to move it · Enter — OK';
    this.preview();
  },
  move(e, q){
    if(!q.inside){ ghost.visible = false; tipHide(); if(!this.center) this.preview(); return; }
    showPickGhost(e, q, this.center ? 'Array · move center: ' : 'Array · center: ');
    // центр ещё не поставлен — копии и ось видны сразу за курсором
    if(!this.center){
      const pk = this.pickCenter(q);
      this.preview(pk && pk.pos, pk && pk.n);
    }
  },
  key(e){
    if(e.key === 'Enter'){ this.commit(); e.preventDefault(); return true; }
    return false;
  },
  commit(){
    if(!this.center){ arr_status.textContent = 'click the array center first'; return; }
    pushUndo();
    for(const a of this.angles()) placeRotated(this.items, this.center, this.n, a, new Map());
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    clearEdgeSel(); deselect(); hideChordHint();
    setActiveTool(null);
    extractEdges();
  }
};

// ---------- «Окружность» (G,C — круг в Sketcher FreeCAD) ----------
// центр (с магнитами) -> радиус мышью или цифрами+Enter -> врезка 48 хордами
let circleMode = false, circleCenter = null, circlePlane = null, circleR = 0, circleRStr = '';
let circleDown = null; // точка нажатия: press-drag-release ставит круг за один жест
// Число сегментов окружности: SketchUp рисует круг 24 отрезками, Blender —
// 32; берём 24 и даём менять вживую (настоящих дуг у нас нет, круг всегда
// многоугольник, и его густота — осознанный выбор пользователя)
const circPopup = document.getElementById('circPopup'),
      circ_seg = document.getElementById('circ_seg');
function circSegs(){
  return Math.max(3, Math.min(360, Math.round(+circ_seg.value || 24)));
}
// Густота по размеру: отклонение хорды от настоящей окружности не больше
// 0.05 мм (как допуск сетки в экспорте Fusion/FreeCAD) — кратно 4, чтобы
// вершины легли на оси круга; не меньше 12 (грани гладкие при сглаживании
// 35°) и не больше 96 (булевым не тяжело)
function autoCircSegs(R){
  const a = Math.acos(Math.max(-1, 1 - 0.05 / Math.max(R, 0.05)));
  const n = Math.ceil(Math.PI / Math.max(a, 1e-6) / 4) * 4;
  return Math.max(12, Math.min(96, n));
}
let circAuto = true;   // сегменты следуют за размером, пока их не поменяли руками
let circLast = null;   // только что поставленный круг: {center, plane, R, snap}
let circPatch = null;  // область грани, на которой стоит центр
let circFixedR = null; // размер введён до центра: круг едет за курсором, клик ставит
let circRLock = false; // размер введён при растягивании: мышь его не перебивает
const circ_d = document.getElementById('circ_d'), circ_r = document.getElementById('circ_r');
function circLastValid(){ // правка возможна, пока после круга ничего не делали
  return !!(circLast && undoStack.length && undoStack[undoStack.length-1] === circLast.snap);
}
// часть круга вне области грани, на которой стоит центр? Черчение в воздухе
// разрешено (как вся плоскость эскиза во FreeCAD), окно лишь предупреждает
// часть круга не лежит ни на одной грани (в воздухе)? Черчение в воздухе
// разрешено (как вся плоскость эскиза во FreeCAD), окно лишь предупреждает
function circleBeyondFace(center, normal, R){
  if(!center || !(R > 0.1)) return false;
  const test = getFaceTester();
  const pts = circlePoints(center, normal, R);
  for(let i=0;i<pts.length;i++){
    const a = pts[i], b = pts[(i+1)%pts.length];
    if(!test(a) || !test(a.clone().lerp(b, 0.5))) return true;
  }
  return false;
}
// привязка словами: сильные магниты — ярко-салатовым, как в тултипах
function circSnapHtml(what, kind){
  const strong = kind === 'vertex' || kind === 'midpoint' || kind === 'center' || kind === 'perpendicular' || kind === 'origin' || kind === 'quadrant';
  return '<span style="color:var(--muted)">' + what + ' →</span> '
    + (strong ? '<span style="color:#6aff3d;font-weight:700">' + kind + '</span>' : kind);
}
function updateCircInfo(snapKind, beyond){
  const live = !!circleCenter;
  const R = live ? circleR : (circLastValid() ? circLast.R : 0);
  // поля Ø/R показывают текущий размер, пока пользователь в них не пишет
  const shown = R > 0.1 ? R : (circFixedR || 0);
  if(document.activeElement !== circ_d && document.activeElement !== circ_r){
    circ_d.value = shown > 0.1 ? +(2*shown).toFixed(3) : '';
    circ_r.value = shown > 0.1 ? +shown.toFixed(3) : '';
  }
  if(beyond === undefined) beyond = live ? circleBeyondFace(circleCenter, circlePlane, circleR)
    : (circLastValid() ? circleBeyondFace(circLast.center, circLast.plane, circLast.R) : false);
  let h = '';
  if(snapKind) h += snapKind;
  if(circRLock && live) h += (h ? ' · ' : '') + '<span style="color:#6aff3d">typed size · Enter — place</span>';
  if(!live && circFixedR) h += (h ? ' · ' : '') + '<span style="color:#6aff3d">click — place Ø ' + (2*circFixedR).toFixed(1) + '</span>';
  if(beyond) h += (h ? '<br>' : '') + '<span style="color:#ff4d4d;font-weight:700">beyond the face</span>'
    + ' <span style="color:var(--muted)">— the red part is in the air</span>';
  if(!h) h = '&nbsp;';
  circ_info.innerHTML = h;
  circ_typed.hidden = !circleRStr;
  circ_typed.textContent = circleRStr ? 'typed Ø ' + circleRStr + ' mm (Enter)' : '';
  circ_state.textContent = live ? 'size' : (R > 0.1 ? 'placed' : 'center');
  if(!live && circFixedR) circ_state.textContent += ' · fixed Ø';
  circ_auto.hidden = !circAuto;
  circ_hint.hidden = !hintsChk.checked;
}
// перерисовать только что поставленный круг с новым Ø или числом сегментов
function recommitCircle(R){
  if(!circLastValid()) return false;
  const c = circLast;
  undo(true);
  circleCenter = c.center.clone(); circlePlane = c.plane.clone(); circleR = R;
  commitCircle();
  return true;
}
// Ориентиры плоскости (SketchUp показывает точки вывода): вершины, середины
// рёбер и центры грани, лежащие в плоскости круга, плюс сами рёбра — видно,
// куда можно поставить центр и до чего дотянуть радиус
let planeTargets = [], planeTargetLines = null, planeTargetKey = '', planeTargetChains = null;
function hidePlaneTargets(){
  for(const m of planeTargets){ scene.remove(m); m.material.dispose(); }
  planeTargets = [];
  if(planeTargetLines){ scene.remove(planeTargetLines); planeTargetLines.geometry.dispose(); planeTargetLines = null; }
  planeTargetKey = ''; planeTargetChains = null;
}
// skip — отрезки [A, B], чьи рёбра не показывать: только что поставленная
// фигура, которую ещё правят в окне, — её же вершины и середины бессмысленны
function showPlaneTargets(n, P0, patch, skip){
  const d = n.dot(P0);
  const key = n.x.toFixed(3) + ',' + n.y.toFixed(3) + ',' + n.z.toFixed(3) + ',' + d.toFixed(2)
    + '|' + (patch && patch.tris.length ? patch.tris[0] : -1) + '|' + guides.length
    + '|' + (skip ? skip.map(sg => keyOf(sg[0].x, sg[0].y, sg[0].z)).join(';') : '');
  if(key === planeTargetKey && planeTargetChains === chains) return;
  hidePlaneTargets();
  planeTargetKey = key; planeTargetChains = chains;
  const inPl = P => Math.abs(n.dot(P) - d) < 0.01;
  const seen = new Set();
  const add = (P, color) => {
    const k = keyOf(P.x, P.y, P.z) + '|' + color;
    if(seen.has(k) || planeTargets.length >= 300) return;
    seen.add(k);
    const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color})));
    m.position.copy(P); scene.add(m); planeTargets.push(m);
  };
  const lp = [];
  const onSkip = P => skip && skip.some(([A, B]) => {
    const AB = new THREE.Vector3().subVectors(B, A), L2 = AB.lengthSq();
    if(L2 < 1e-12) return false;
    const t = new THREE.Vector3().subVectors(P, A).dot(AB) / L2;
    return t > -1e-4 && t < 1 + 1e-4 && A.clone().addScaledVector(AB, t).distanceToSquared(P) < 1e-6;
  });
  for(const ch of chains){
    if(!ch.pts.every(inPl)) continue;
    if(skip && ch.pts.every(onSkip)) continue;
    for(let i=0;i+1<ch.pts.length;i++) lp.push(ch.pts[i], ch.pts[i+1]);
    if(ch.closed || ch.curve) continue; // у окружности ориентир — центр
    add(ch.pts[0], 0xe8ecf2); add(ch.pts[ch.pts.length-1], 0xe8ecf2);
    add(chainPointAt(ch, ch.total/2), 0x3fd9c9);
  }
  for(const c of auxSnaps) if(inPl(c)) add(c, 0x3fd9c9);
  for(const qs of quadSnaps) if(inPl(qs.pos)) add(qs.pos, AXIS_CSS[qs.axis]);
  if(patch && patch.centers) for(const c of patch.centers) add(c, 0x3fd9c9);
  if(inPl(new THREE.Vector3())) add(new THREE.Vector3(), 0x6aff3d); // начало координат
  if(lp.length){
    planeTargetLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lp),
      new THREE.LineBasicMaterial({color: 0x3fd9c9}));
    planeTargetLines.renderOrder = 2;
    scene.add(planeTargetLines);
  }
}
let circleRing = null;
function killRing(){ if(circleRing){ scene.remove(circleRing); circleRing.geometry.dispose(); circleRing = null; } }
function setCircleMode(on){
  circleMode = on;
  circleCenter = null; circlePlane = null; circleRStr = '';
  killRing(); hidePlaneTargets();
  circleDown = null; circLast = null; circAuto = true; circFixedR = null; circRLock = false;
  if(on){
    hideChordHint();
    setLineMode(false); if(activeTool) setActiveTool(null);
    setHover(null); tipHide();
    const vr = view.getBoundingClientRect();
    circPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 330) + 'px';
    circPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 200) + 'px';
    circPopup.hidden = false;
    updateCircInfo();
  }
  else { ghost.visible = false; tipHide(); circPopup.hidden = true; releaseToolInput(); }
  canvas.style.cursor = on ? 'crosshair' : ''; // после выключения других режимов
  updateToolTag();
}
function circlePoints(center, normal, R, n){
  n = n || circSegs();
  const u = (Math.abs(normal.z) < 0.9
    ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(normal).normalize();
  const v = normal.clone().cross(u);
  const pts = [];
  for(let i=0;i<n;i++){
    const a = i/n*Math.PI*2;
    pts.push(center.clone().addScaledVector(u, Math.cos(a)*R).addScaledVector(v, Math.sin(a)*R));
  }
  return pts;
}
function commitCircle(){
  if(!circleCenter || circleR < 0.3) return;
  pushUndo();
  const snap = undoStack[undoStack.length-1];
  // радиус не округляем: до вершины/середины он точный, свободный — уже 0.1
  const R = Math.round(circleR * 1000) / 1000;
  circLast = {center: circleCenter.clone(), plane: circlePlane.clone(), R, snap};
  const pts = circlePoints(circleCenter, circlePlane, R);
  const cid = ++curveSeq; // все сегменты — одна кривая
  for(let i=0;i<pts.length;i++){
    const a = pts[i], b = pts[(i+1)%pts.length];
    addGuide(a, b, false, cid);
    splitMeshByChord(a, b, 'segment'); // сегмент круга: точно по отрезку, без продлений
  }
  cleanupMesh(); // врезка оставляет треугольники нулевой площади
  extractEdges();
  killRing(); hidePlaneTargets(); ghost.visible = false;
  circleCenter = null; circleRStr = ''; circleDown = null; circRLock = false;
  tipHide();
  updateCircInfo();
}
function drawCircleRing(center, normal, R){
  killRing();
  if(!(R > 0.1)) return false;
  const r = airColoredLine(circlePoints(center, normal, R), C_EDGE, true);
  circleRing = new THREE.Line(r.geometry, new THREE.LineBasicMaterial({vertexColors: true}));
  scene.add(circleRing);
  return r.anyAir;
}

// ---------- «Offset» (O — Offset из SketchUp) ----------
// Параллельный контур внутри выбранной грани. Врезается теми же хордами,
// что и текст (noExt: сегменты замкнутого контура не продлеваются при
// расчёте областей), после чего грань распадается на рамку и остров —
// каждый выбирается кликом и выдавливается E.
let offLive = null; // {n,u,v,P0,base,ccw,poly,pts,ring,typed}
function offClearRing(){
  if(offLive && offLive.ring){ scene.remove(offLive.ring); offLive.ring.geometry.dispose(); offLive.ring = null; }
}
function offTo2(loop, u, v, P0){
  return loop.map(P => { const w = new THREE.Vector3().subVectors(P, P0); return [w.dot(u), w.dot(v)]; });
}
function offArea2(poly){
  let A = 0;
  for(let i=0;i<poly.length;i++){ const j=(i+1)%poly.length; A += poly[i][0]*poly[j][1] - poly[j][0]*poly[i][1]; }
  return A/2;
}
function offPointIn(poly, p){
  let c = false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    if((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) &&
       p[0] < (poly[j][0]-poly[i][0])*(p[1]-poly[i][1])/(poly[j][1]-poly[i][1]) + poly[i][0]) c = !c;
  }
  return c;
}
// контур грани приходит с мусором: микрорёбра от Т-стыков и лишние точки
// посреди прямых. Для сдвига важны только настоящие углы — чистим, иначе
// направление микроребра случайно и «ус» улетает
function offCleanPoly(poly){
  let p = poly.slice();
  for(let pass=0; pass<4; pass++){
    const out = [];
    for(let i=0;i<p.length;i++){
      const a = out.length ? out[out.length-1] : p[(i+p.length-1)%p.length], c = p[(i+1)%p.length], b = p[i];
      if(Math.hypot(b[0]-a[0], b[1]-a[1]) < 0.01) continue;      // точка-двойник
      const ax = b[0]-a[0], ay = b[1]-a[1], cx = c[0]-b[0], cy = c[1]-b[1];
      const L1 = Math.hypot(ax, ay), L2 = Math.hypot(cx, cy);
      if(L2 > 1e-9 && L1 > 1e-9 &&
         Math.abs(ax*cy - ay*cx) < 1e-3*L1*L2 && ax*cx + ay*cy > 0) continue; // точка на прямой
      out.push(b);
    }
    if(out.length === p.length){ p = out; break; }
    p = out;
    if(p.length < 3) return poly;
  }
  return p.length >= 3 ? p : poly;
}
// сдвиг замкнутого контура внутрь на d (наружу при d < 0); стыки — «ус»
// (miter), как в SketchUp и AutoCAD. Слишком большой сдвиг выворачивает
// контур наизнанку — такой результат отбрасываем (null), окно скажет
function offsetPoly2(poly, d, ccw){
  const n = poly.length, sgn = ccw ? 1 : -1, ln = [];
  for(let i=0;i<n;i++){
    const a = poly[i], b = poly[(i+1)%n];
    const dx = b[0]-a[0], dy = b[1]-a[1], L = Math.hypot(dx, dy);
    if(L < 1e-9) return null;
    const nx = -dy/L*sgn, ny = dx/L*sgn; // единичная нормаль внутрь контура
    ln.push({px: a[0] + nx*d, py: a[1] + ny*d, dx: dx/L, dy: dy/L});
  }
  const out = [];
  for(let i=0;i<n;i++){
    const A = ln[(i+n-1)%n], B = ln[i];
    const cr = A.dx*B.dy - A.dy*B.dx;
    if(Math.abs(cr) < 1e-9){ out.push([B.px, B.py]); continue; } // рёбра на одной прямой
    const t = ((B.px-A.px)*B.dy - (B.py-A.py)*B.dx) / cr;
    const X = A.px + A.dx*t, Y = A.py + A.dy*t;
    if(Math.hypot(X-B.px, Y-B.py) > 20*Math.abs(d) + 1e-6) return null; // игла в остром угле
    out.push([X, Y]);
  }
  for(let i=0;i<n;i++){ // ребро развернулось — контур уже схлопнулся
    const j = (i+1)%n;
    if((out[j][0]-out[i][0])*ln[i].dx + (out[j][1]-out[i][1])*ln[i].dy < -1e-9) return null;
  }
  const A0 = offArea2(poly), A1 = offArea2(out);
  if(!(A1*A0 > 0) || Math.abs(A1) < 1e-6) return null;
  return out;
}
function offPreview(){
  offClearRing();
  if(!offLive) return;
  const d = snapMM(+off_d.value || 0);
  offLive.poly = Math.abs(d) < 0.05 ? null : offsetPoly2(offLive.base, d, offLive.ccw);
  if(!offLive.poly){
    offLive.pts = null;
    off_info.innerHTML = Math.abs(d) < 0.05
      ? '&nbsp;' : '<span style="color:#d9534f;font-weight:700">too large for this face</span>';
    return;
  }
  offLive.pts = offLive.poly.map(([x,y]) =>
    offLive.P0.clone().addScaledVector(offLive.u, x).addScaledVector(offLive.v, y));
  const r = airColoredLine(offLive.pts, C_EDGE, true);
  offLive.ring = new THREE.Line(r.geometry, new THREE.LineBasicMaterial({vertexColors: true}));
  scene.add(offLive.ring);
  off_info.innerHTML = (d > 0 ? 'inward' : 'outward') + ' · ' + Math.abs(d).toFixed(1) + ' mm'
    + (r.anyAir ? ' · <span style="color:#d9534f;font-weight:700">outside the face</span>' : '');
}
function openOffset(){
  if(!ppPatch) return;
  const loop = patchOutlineLoop(mesh.geometry.attributes.position.array, ppPatch.tris);
  if(!loop){ warnTip('Offset needs a face with one closed outline'); return; }
  const n = ppPatch.normal.clone(), b = textBasis(n), P0 = loop[0].clone();
  const base = offCleanPoly(offTo2(loop, b.u, b.v, P0));
  offLive = {n, u: b.u, v: b.v, P0, base, ccw: offArea2(base) > 0,
             poly: null, pts: null, ring: null, typed: false};
  off_state.textContent = base.length + ' edges';
  const vr = view.getBoundingClientRect();
  offPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 340) + 'px';
  offPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 220) + 'px';
  offPopup.hidden = false;
  offPreview();
  off_d.focus(); off_d.select();
}
function closeOffset(){
  if(!offLive) return;
  offClearRing();
  offLive = null;
  offPopup.hidden = true;
  releaseToolInput();
}
function commitOffset(){
  if(!offLive) return;
  if(!offLive.pts){ warnTip('Offset does not fit this face'); return; }
  const pts = offLive.pts;
  pushUndo();
  for(let i=0;i<pts.length;i++){
    const A = pts[i], B = pts[(i+1)%pts.length];
    if(A.distanceTo(B) < 1e-6) continue;
    addGuide(A, B, true);
    // 'segment' — рез строго по отрезку с веером в его концах. Режим
    // «вся линия» на круглой грани (веер из центра) оставлял в каждом
    // углу контура клин 0.01 мм² — те самые лишние линии-осколки
    splitMeshByChord(A, B, 'segment');
  }
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
  closeOffset();
  hidePatch(); ppPatch = null; // индексы лоскута устарели — выбор снимаем
}
// курсор над гранью задаёт расстояние (как перетаскивание в SketchUp),
// пока пользователь не ввёл число руками
function offMove(e, q){
  if(!offLive || offLive.typed) return;
  const P = rayOnPlane(q, offLive.n, offLive.P0);
  if(!P) return;
  const w = new THREE.Vector3().subVectors(P, offLive.P0);
  const p = [w.dot(offLive.u), w.dot(offLive.v)], b = offLive.base;
  let best = Infinity;
  for(let i=0;i<b.length;i++){
    const a0 = b[i], a1 = b[(i+1)%b.length];
    const dx = a1[0]-a0[0], dy = a1[1]-a0[1], L2 = dx*dx + dy*dy;
    let t = L2 > 1e-12 ? ((p[0]-a0[0])*dx + (p[1]-a0[1])*dy)/L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0]-a0[0]-dx*t, p[1]-a0[1]-dy*t));
  }
  off_d.value = snapMM(offPointIn(b, p) ? best : -best).toFixed(1);
  offPreview();
}
off_d.addEventListener('input', ()=>{ if(offLive) offLive.typed = true; offPreview(); });
off_d.addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); commitOffset(); }
  if(e.key === 'Escape'){ closeOffset(); }
  e.stopPropagation();
});
document.getElementById('off_ok').addEventListener('click', commitOffset);
document.getElementById('off_cancel').addEventListener('click', closeOffset);

// ---------- «3D Text» (G,T — 3D Text из SketchUp) ----------
// Свой вшитый пиксельный шрифт 5x7 (8-битная классика): программа не зависит
// от шрифтов системы, а прямоугольные глифы дружат с BSP и слайсерами.
// Биты строки: бит 4 — левая колонка, бит 0 — правая.
const FONT57 = {
  'A':[0x0E,0x11,0x11,0x1F,0x11,0x11,0x11],'B':[0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E],
  'C':[0x0E,0x11,0x10,0x10,0x10,0x11,0x0E],'D':[0x1E,0x11,0x11,0x11,0x11,0x11,0x1E],
  'E':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F],'F':[0x1F,0x10,0x10,0x1E,0x10,0x10,0x10],
  'G':[0x0E,0x11,0x10,0x17,0x11,0x11,0x0F],'H':[0x11,0x11,0x11,0x1F,0x11,0x11,0x11],
  'I':[0x0E,0x04,0x04,0x04,0x04,0x04,0x0E],'J':[0x07,0x02,0x02,0x02,0x02,0x12,0x0C],
  'K':[0x11,0x12,0x14,0x18,0x14,0x12,0x11],'L':[0x10,0x10,0x10,0x10,0x10,0x10,0x1F],
  'M':[0x11,0x1B,0x15,0x15,0x11,0x11,0x11],'N':[0x11,0x19,0x15,0x13,0x11,0x11,0x11],
  'O':[0x0E,0x11,0x11,0x11,0x11,0x11,0x0E],'P':[0x1E,0x11,0x11,0x1E,0x10,0x10,0x10],
  'Q':[0x0E,0x11,0x11,0x11,0x15,0x12,0x0D],'R':[0x1E,0x11,0x11,0x1E,0x14,0x12,0x11],
  'S':[0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E],'T':[0x1F,0x04,0x04,0x04,0x04,0x04,0x04],
  'U':[0x11,0x11,0x11,0x11,0x11,0x11,0x0E],'V':[0x11,0x11,0x11,0x11,0x11,0x0A,0x04],
  'W':[0x11,0x11,0x11,0x15,0x15,0x15,0x0A],'X':[0x11,0x11,0x0A,0x04,0x0A,0x11,0x11],
  'Y':[0x11,0x11,0x0A,0x04,0x04,0x04,0x04],'Z':[0x1F,0x01,0x02,0x04,0x08,0x10,0x1F],
  '0':[0x0E,0x11,0x13,0x15,0x19,0x11,0x0E],'1':[0x04,0x0C,0x04,0x04,0x04,0x04,0x0E],
  '2':[0x0E,0x11,0x01,0x02,0x04,0x08,0x1F],'3':[0x1F,0x02,0x04,0x02,0x01,0x11,0x0E],
  '4':[0x02,0x06,0x0A,0x12,0x1F,0x02,0x02],'5':[0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E],
  '6':[0x06,0x08,0x10,0x1E,0x11,0x11,0x0E],'7':[0x1F,0x01,0x02,0x04,0x08,0x08,0x08],
  '8':[0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E],'9':[0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C],
  '-':[0x00,0x00,0x00,0x0E,0x00,0x00,0x00],'.':[0x00,0x00,0x00,0x00,0x00,0x0C,0x0C],
  ' ':[0,0,0,0,0,0,0]
};
// Тело текста строится НАПРЯМУЮ по клеточной сетке (без булевых): крышка и
// дно — по 2 треугольника на закрашенную клетку, стенки — только на границе
// с пустыми клетками. Все вершины на узлах сетки — сетка водонепроницаема
// по построению (0 boundary, 0 T-стыков), в отличие от BSP-union призм.
function buildTextSolid(P, u, v, n, cells, s, above, below){
  const at = (gx,gy,h)=>P.clone().addScaledVector(u,gx*s).addScaledVector(v,gy*s).addScaledVector(n,h);
  const has = (gx,gy)=>cells.has(gx+','+gy);
  const tris = [];
  for(const key of cells){
    const [gx,gy] = key.split(',').map(Number);
    const t00=at(gx,gy,above),t10=at(gx+1,gy,above),t11=at(gx+1,gy+1,above),t01=at(gx,gy+1,above);
    const b00=at(gx,gy,-below),b10=at(gx+1,gy,-below),b11=at(gx+1,gy+1,-below),b01=at(gx,gy+1,-below);
    tris.push([t00,t10,t11],[t00,t11,t01]);  // крышка наружу (+n)
    tris.push([b00,b11,b10],[b00,b01,b11]);  // дно наружу (-n)
    if(!has(gx,gy-1)) tris.push([b00,b10,t10],[b00,t10,t00]); // стенка -v
    if(!has(gx+1,gy)) tris.push([b10,b11,t11],[b10,t11,t10]); // стенка +u
    if(!has(gx,gy+1)) tris.push([b11,b01,t01],[b11,t01,t11]); // стенка +v
    if(!has(gx-1,gy)) tris.push([b01,b00,t00],[b01,t00,t01]); // стенка -u
  }
  return tris;
}
let textMode = false, textParams = null;
let txtLive = null;    // текст уже стоит как предпросмотр: {P, n}
let txReTimer = null;  // перестройка предпросмотра при правке полей
let txPlaceDrag = null; // зажатая ЛКМ тащит стартовую точку по грани
function setTextMode(on){
  textMode = on;
  if(on){
    hideChordHint();
    setLineMode(false);
    if(circleMode) setCircleMode(false);
    
    if(pointMode) setPointMode(false);
    if(activeTool) setActiveTool(null);
    setHover(null); tipHide();
  }
  if(!on){ hidePlaneTargets(); ghost.visible = false; }
  txb.hidden = !on;
  canvas.style.cursor = on ? 'crosshair' : '';
  updateToolTag();
}
function openTextPopup(){
  txtLive = null;
  // каждый вызов начинается с нулевой экструзии: запомненное «-40» от
  // прошлого раза запускало бы тяжёлое сквозное BSP первым же кликом
  // точки (страница «зависает»); текст и высота — запоминаются
  tx_d.value = '0';
  const vr = view.getBoundingClientRect();
  txtPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 400) + 'px';
  txtPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 300) + 'px';
  txtPopup.hidden = false;
  setTextMode(true); // сразу ждём клик-точку начала текста
  tx_str.focus(); tx_str.select();
}
function closeTextPopup(){ txtPopup.hidden = true; releaseToolInput(); }
// тело минус/плюс призмы прямоугольников шрифта; врезаем в кликнутую грань
// закрашенные клетки строки в глобальной сетке текста: gx вдоль строки,
// gy вверх; шаг букв — 6 клеток (5 колонок + 1 просвет)
function textCellsOf(str){
  const cells = new Set();
  let ci = 0;
  for(const chr of str){
    const g = FONT57[chr];
    if(g && chr !== ' ')
      for(let r=0;r<7;r++) for(let c=0;c<5;c++)
        if(g[r] & (1<<(4-c))) cells.add((ci*6+c)+','+(6-r));
    ci++;
  }
  return cells;
}
// Клетки для врезки в тело — на сетке вдвое мельче, с мостиками: у диагоналей
// пиксельного шрифта (X, Z, K, V…) клетки касаются только углом, и на таком
// стыке ребро делят четыре треугольника — тело «не многообразно», слайсеры
// принтеров на это ругаются (калибровочный куб XYZ: 16 таких рёбер). В каждый
// угловой стык добавляется четвертинка соседней пустой клетки — стык получает
// толщину в полклетки, форма буквы почти не меняется
function textCellsFine(str){
  const cells = textCellsOf(str), fine = new Set();
  const has = (x, y) => cells.has(x + ',' + y);
  for(const key of cells){
    const [x, y] = key.split(',').map(Number);
    for(let a=0;a<2;a++) for(let b=0;b<2;b++) fine.add((2*x+a) + ',' + (2*y+b));
  }
  for(const key of cells){
    const [x, y] = key.split(',').map(Number);
    // (x,y) и (x+1,y+1) касаются углом, (x+1,y) и (x,y+1) пусты
    if(has(x+1, y+1) && !has(x+1, y) && !has(x, y+1)) fine.add((2*x+2) + ',' + (2*y+1));
    // (x,y) и (x-1,y+1) касаются углом, (x-1,y) и (x,y+1) пусты
    if(has(x-1, y+1) && !has(x-1, y) && !has(x, y+1)) fine.add((2*x-1) + ',' + (2*y+1));
  }
  return fine;
}
function placeTextAt(P, n){
  const {str, h, d} = textParams;
  const s = h/14; // клетка мелкой сетки (textCellsFine): буква — 10×14
  const u = Math.abs(n.z) > 0.9
    ? new THREE.Vector3(1,0,0)
    : new THREE.Vector3(0,0,1).cross(n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize(); // «вверх» по грани
  const cells = textCellsFine(str);
  if(!cells.size) return;
  // контур букв — граничные рёбра клеток, слитые в длинные отрезки по
  // строкам/столбцам; врезается в грань линиями-хордами (noExt: сегменты
  // замкнутого контура не продлеваются при заливке; режем только в
  // пределах сегмента — wholeLine резал бы соседние буквы)
  const carveOutline = ()=>{
    const H = new Map(), Vg = new Map(); // линия gy -> {gx}, линия gx -> {gy}
    const put = (m,k,x)=>{ if(!m.has(k)) m.set(k,new Set()); m.get(k).add(x); };
    for(const key of cells){
      const [gx,gy] = key.split(',').map(Number);
      if(!cells.has(gx+','+(gy-1))) put(H, gy,   gx);
      if(!cells.has(gx+','+(gy+1))) put(H, gy+1, gx);
      if(!cells.has((gx-1)+','+gy)) put(Vg, gx,   gy);
      if(!cells.has((gx+1)+','+gy)) put(Vg, gx+1, gy);
    }
    const runs = set => { // подряд идущие клетки -> интервалы [a, b+1]
      const a = [...set].sort((x,y)=>x-y), r = [];
      let s0 = a[0], prev = a[0];
      for(let i=1;i<=a.length;i++){
        if(a[i] === prev+1){ prev = a[i]; continue; }
        r.push([s0, prev+1]); s0 = a[i]; prev = a[i];
      }
      return r;
    };
    const pt = (gx,gy)=>P.clone().addScaledVector(u,gx*s).addScaledVector(v,gy*s);
    // wholeLine=true обязателен: с false треугольник, чья линия пересечения
    // ШИРЕ сегмента (середина за концами), не режется — недорез, и заливка
    // протекает сквозь границу буквы. true режет всех, кого сегмент задел;
    // лишние резы копланарны и невидимы, а барьером служит точный тест
    // «ребро на сегменте» в facePatchAt
    for(const [gy,set] of H) for(const [x0,x1] of runs(set)){
      const A = pt(x0,gy), B = pt(x1,gy);
      addGuide(A, B, true); splitMeshByChord(A, B, true);
    }
    for(const [gx,set] of Vg) for(const [y0,y1] of runs(set)){
      const A = pt(gx,y0), B = pt(gx,y1);
      addGuide(A, B, true); splitMeshByChord(A, B, true);
    }
  };
  pushUndo();
  try{
    if(d === 0){
      // чертёжный набросок: только контур — области потом выдавит выбор
      carveOutline();
      if(!modified){ modified = true; s_mod.textContent = 'yes'; }
      extractEdges();
      return;
    }
    const above = d > 0 ? d : 1.0;   // гравировка: 1 мм запаса наружу
    const below = d > 0 ? 0.5 : -d;  // выдавливание: врастаем на 0.5 мм
    const letters = buildTextSolid(P, u, v, n, cells, s, above, below);
    const q = x => Math.round(x*1000)/1000;
    if(d > 0){
      // выдавить: сначала контур основания врезается в грань — видна
      // линия соприкосновения буквы с плоскостью (как в SketchUp), и
      // основание остаётся адресуемой областью; затем добавляется
      // цельная оболочка буквы, вросшая в тело на 0.5 мм (копланарного
      // дна нет — нет мерцания; слайсеры такие союзы понимают)
      carveOutline();
      const arr = Array.from(mesh.geometry.attributes.position.array);
      for(const t of letters) for(const vv of t) arr.push(q(vv.x), q(vv.y), q(vv.z));
      setMeshFromArray(new Float32Array(arr));
    } else {
      // вдавить: одно честное вычитание, как commitPocketCSG
      const pos = mesh.geometry.attributes.position.array;
      const body = [];
      for(let i=0;i<pos.length;i+=9)
        body.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]),
                   new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]),
                   new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
      const res = csgSubtract(body, letters);
      const arr = [];
      for(const t of res){
        const ar = new THREE.Vector3().subVectors(t[1],t[0])
          .cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
        if(ar < 1e-6) continue;
        for(const vv of t) arr.push(q(vv.x), q(vv.y), q(vv.z));
      }
      setMeshFromArray(new Float32Array(arr));
      cleanupMesh();
      if(openEdgeCount() || nonManifoldEdgeCount()){
        // Т-стыков после BSP у текста сотни (healTJunctions чинит до 16 за
        // вызов) — гоняем до полной сходимости. healCoplanarOverlaps
        // обязателен: при сквозной гравировке (глубина = толщине тела) дно
        // призмы копланарно задней грани — без взаимной подрезки остаются
        // мембраны и вывернутые куски
        for(let i=0;i<80;i++){
          const len0 = mesh.geometry.attributes.position.array.length;
          cleanupMesh(); healCoplanarOverlaps(); healTJunctions();
          if(mesh.geometry.attributes.position.array.length === len0) break;
        }
        // трещины у букв (на Z калибровочного куба оставалось 39 открытых рёбер)
        healCracks();
        removeInvertedShells();
      }
    }
  }catch(err){
    console.warn('BSP-текст не удался — операция отменена', err);
    undo(true);
    return;
  }
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
}
function readTextParams(){
  const str = (tx_str.value || '').toUpperCase();
  const h = Math.max(3, +tx_h.value || 10);
  const d = snapMM(+tx_d.value || 0); // 0 — чертёжный контур без выдавливания
  if(![...str].some(ch => FONT57[ch] && ch !== ' ')) return null;
  return {str, h, d};
}
// красная точка-якорь текста: ЦЕНТР текста по горизонтали и вертикали;
// стиль — как точки-кандидаты центров (постоянный экранный размер, обводка)
let txAnchor = null;
function showTxAnchor(P){
  hideTxAnchor();
  txAnchor = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0xd9302e})));
  txAnchor.position.copy(P);
  scene.add(txAnchor);
}
function hideTxAnchor(){ if(txAnchor){ scene.remove(txAnchor); txAnchor = null; } }
// базис текста на грани: u — вдоль строки, v — «вверх» по грани
function textBasis(n){
  const u = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1,0,0)
        : new THREE.Vector3(0,0,1).cross(n).normalize();
  return {u, v: new THREE.Vector3().crossVectors(n, u).normalize()};
}
function textWidth(p){ return ([...p.str].length*6 - 1) * (p.h/7); }
// центр грани: площадь-взвешенный центроид всех треугольников плоскости
// (по плоскости, не по faceIndex — переживает переврезку текста)
function planeCentroid(n, P0){
  const pos = mesh.geometry.attributes.position.array;
  const d0 = n.dot(P0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const acc = new THREE.Vector3(); let aSum = 0;
  for(let i=0;i<pos.length;i+=9){
    A.set(pos[i],pos[i+1],pos[i+2]); B.set(pos[i+3],pos[i+4],pos[i+5]); C.set(pos[i+6],pos[i+7],pos[i+8]);
    if(Math.abs(n.dot(A)-d0)>0.05 || Math.abs(n.dot(B)-d0)>0.05 || Math.abs(n.dot(C)-d0)>0.05) continue;
    const ar = new THREE.Vector3().subVectors(B,A).cross(new THREE.Vector3().subVectors(C,A));
    if(ar.dot(n) <= 0) continue; // только грань, смотрящая как n
    const a2 = ar.length();
    acc.addScaledVector(new THREE.Vector3().add(A).add(B).add(C).multiplyScalar(1/3), a2);
    aSum += a2;
  }
  return aSum > 1e-9 ? acc.multiplyScalar(1/aSum) : P0.clone();
}
// центр грани — салатовая точка в том же стиле, что точки-кандидаты
let txCenterDot = null;
function showTxCenter(C){
  hideTxCenter();
  txCenterDot = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0x6aff3d})));
  txCenterDot.position.copy(C);
  scene.add(txCenterDot);
}
function hideTxCenter(){
  if(txCenterDot){ scene.remove(txCenterDot); txCenterDot = null; }
}
// магнит центров: P — якорь (ЦЕНТР текста); подтягивает к центру грани
// по горизонтали (u, на любой высоте) и/или вертикали (v); порог 1.5 мм.
// Совместил красную точку с салатовой — текст ровно в центре грани.
function txCenterSnap(P, n, C, p){
  const {u, v} = textBasis(n);
  const du = new THREE.Vector3().subVectors(P, C).dot(u);
  const dv = new THREE.Vector3().subVectors(P, C).dot(v);
  const sU = Math.abs(du) < 1.5, sV = Math.abs(dv) < 1.5;
  if(sU) P.addScaledVector(u, -du);
  if(sV) P.addScaledVector(v, -dv);
  return {sU, sV};
}
// подсказка магнита: обе оси — «center», одна ось — «midpoint»
function txSnapTip(e, sn){
  if(sn.sU && sn.sV)
    tipAt(e, '<span style="color:#6aff3d;font-weight:700">center</span>');
  else if(sn.sU || sn.sV)
    tipAt(e, '<span style="color:#6aff3d;font-weight:700">midpoint</span>');
  else tipHide();
}
// левый нижний угол первой буквы из якоря-центра текста
function txLeftFromAnchor(A, n, p){
  const {u, v} = textBasis(n);
  return A.clone().addScaledVector(u, -textWidth(p)/2).addScaledVector(v, -p.h/2);
}
// живой предпросмотр: текст стоит в модели, правки полей перестраивают его
// (якорь — низ центра строки, текст растёт от центра в обе стороны)
function rebuildTextLive(){
  if(!txtLive) return;
  const p = readTextParams();
  if(!p) return; // мусор в полях — оставляем предпросмотр как был
  textParams = p;
  undo(true); // снять старый предпросмотр
  placeTextAt(txLeftFromAnchor(txtLive.P, txtLive.n, p), txtLive.n.clone());
}
function finishText(){ // OK: предпросмотр уже в модели и в истории
  txtLive = null;
  hideTxAnchor(); hideTxCenter(); tipHide();
  closeTextPopup();
  if(textMode) setTextMode(false);
}
function cancelText(){ // Esc/Cancel: предпросмотр откатываем
  if(txtLive){ undo(true); txtLive = null; }
  hideTxAnchor(); hideTxCenter(); tipHide(); hidePlaneTargets(); ghost.visible = false;
  closeTextPopup();
  if(textMode) setTextMode(false);
}
tx_ok.addEventListener('click', ()=>{
  if(txtLive) finishText(); // OK фиксирует; пока точка не поставлена — ждём
});
tx_cancel.addEventListener('click', cancelText);
for(const inp of [tx_str, tx_h, tx_d]) inp.addEventListener('input', ()=>{
  clearTimeout(txReTimer);
  txReTimer = setTimeout(rebuildTextLive, 250);
});
// окна инструментов перетаскиваются за ручку ⠿ (как палитры выбора)
function makeGripDrag(win){
  let gd = null;
  win.addEventListener('pointerdown', ev=>{
    if(!ev.target.classList || !ev.target.classList.contains('chgrip')) return;
    const r = win.getBoundingClientRect();
    gd = {dx: ev.clientX - r.left, dy: ev.clientY - r.top};
    ev.preventDefault(); ev.stopPropagation();
  });
  window.addEventListener('pointermove', ev=>{
    if(!gd) return;
    const vr = view.getBoundingClientRect();
    win.style.left = (ev.clientX - vr.left - gd.dx) + 'px';
    win.style.top  = (ev.clientY - vr.top - gd.dy) + 'px';
  });
  window.addEventListener('pointerup', ()=>{ gd = null; });
}
makeGripDrag(txtPopup);
makeGripDrag(circPopup);
makeGripDrag(offPopup);
makeGripDrag(linePopup);
makeGripDrag(arrPopup);
makeGripDrag(bevPopup);
for(const inp of [bev_d, bev_s]){
  inp.addEventListener('input', ()=>{ if(activeTool === bevelTool) bevelTool.preview(); });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === bevelTool) bevelTool.commit(); }
    if(e.key === 'Escape'){ e.preventDefault(); setActiveTool(null); }
    e.stopPropagation();
  });
}
bev_ok.addEventListener('click', ()=>{ if(activeTool === bevelTool) bevelTool.commit(); });
const bev_loops = document.getElementById('bev_loops');
const cylPopup = document.getElementById('cylPopup'), cyl_d = document.getElementById('cyl_d'), cyl_h = document.getElementById('cyl_h'),
      cyl_t = document.getElementById('cyl_t'), cyl_s = document.getElementById('cyl_s'), cyl_state = document.getElementById('cyl_state'),
      cyl_info = document.getElementById('cyl_info'), cyl_ok = document.getElementById('cyl_ok'), cyl_hint = document.getElementById('cyl_hint');
{
  const num = el => { const v = parseFloat(String(el.value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
  const refresh = () => { if(activeTool !== cylTool) return; if(cylTool.stage >= 1) cylTool.draw(); cylTool.ui(); };
  cyl_d.addEventListener('input', () => { const v = num(cyl_d); cylTool.dLock = v != null && v >= 0.2 ? snapMM(v) : null; refresh(); });
  cyl_h.addEventListener('input', () => { const v = num(cyl_h); cylTool.hLock = v != null && Math.abs(v) >= 0.1 ? snapMM(v) : null; refresh(); });
  cyl_t.addEventListener('input', () => { const v = num(cyl_t); cylTool.topD = v != null && v >= 0 ? snapMM(v) : null; refresh(); });
  cyl_s.addEventListener('input', () => { const v = num(cyl_s); cylTool.segAuto = !(v >= 3); if(v >= 3) cylTool.seg = Math.min(256, Math.round(v)); refresh(); });
  for(const el of [cyl_d, cyl_h, cyl_t, cyl_s]) el.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === cylTool) cylTool.enter(); }
    if(e.key === 'Escape') releaseToolInput();
    e.stopPropagation();
  });
  for(const [id, o] of [['cyl_auto', 'auto'], ['cyl_join', 'join'], ['cyl_cut', 'cut']])
    document.getElementById(id).addEventListener('click', () => { if(activeTool !== cylTool) return; cylTool.op = o; refresh(); });
  cyl_ok.addEventListener('click', () => { if(activeTool === cylTool) cylTool.commit(); });
  document.getElementById('cyl_cancel').addEventListener('click', () => { if(activeTool === cylTool) setActiveTool(null); });
  makeGripDrag(cylPopup);
}
const $id = id => document.getElementById(id);
const mirPopup = $id('mirPopup'), mir_state = $id('mir_state'), mir_off = $id('mir_off'), mir_info = $id('mir_info'),
      mir_hint = $id('mir_hint'), mir_ok = $id('mir_ok'), mir_join = $id('mir_join'), mir_flip = $id('mir_flip');
{
  mir_off.addEventListener('input', () => { if(activeTool === mirTool && mirTool.stage === 'ready'){ mirTool.draw(); mirTool.ui(); } });
  mir_off.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === mirTool) mirTool.commit(); }
    if(e.key === 'Escape') releaseToolInput();
    e.stopPropagation();
  });
  for(const [id, a] of [['mir_face', 'face'], ['mir_x', 'x'], ['mir_y', 'y'], ['mir_z', 'z']])
    $id(id).addEventListener('click', () => { if(activeTool === mirTool) mirTool.setAxis(a); });
  for(const [el, m] of [[mir_join, 'join'], [mir_flip, 'flip']])
    el.addEventListener('click', () => { if(activeTool === mirTool){ mirTool.mode = m; mirTool.ui(); } });
  mir_ok.addEventListener('click', () => { if(activeTool === mirTool) mirTool.commit(); });
  $id('mir_cancel').addEventListener('click', () => { if(activeTool === mirTool) setActiveTool(null); });
  makeGripDrag(mirPopup);
}
const shellPopup = $id('shellPopup'), sh_t = $id('sh_t'), sh_state = $id('sh_state'), sh_info = $id('sh_info'),
      sh_hint = $id('sh_hint'), sh_ok = $id('sh_ok');
{
  sh_t.addEventListener('input', () => { if(activeTool === shellTool) shellTool.preview(); });
  sh_t.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === shellTool) shellTool.commit(); }
    if(e.key === 'Escape') releaseToolInput();
    e.stopPropagation();
  });
  sh_ok.addEventListener('click', () => { if(activeTool === shellTool) shellTool.commit(); });
  $id('sh_cancel').addEventListener('click', () => { if(activeTool === shellTool) setActiveTool(null); });
  makeGripDrag(shellPopup);
}
const xfPopup = $id('xfPopup'), xf_state = $id('xf_state'), xf_move = $id('xf_move'), xf_scale = $id('xf_scale'),
      xf_rows_move = $id('xf_rows_move'), xf_rows_scale = $id('xf_rows_scale'),
      xf_dx = $id('xf_dx'), xf_dy = $id('xf_dy'), xf_dz = $id('xf_dz'), xf_s = $id('xf_s'), xf_sx = $id('xf_sx'), xf_sy = $id('xf_sy'), xf_sz = $id('xf_sz'),
      xf_bottom = $id('xf_bottom'), xf_center = $id('xf_center'), xf_off = $id('xf_off'), xf_copy = $id('xf_copy'), xf_n = $id('xf_n'),
      xf_info = $id('xf_info'), xf_hint = $id('xf_hint'), xf_ok = $id('xf_ok');
{
  const refresh = () => { if(activeTool === xfTool){ xfTool.draw(); xfTool.ui(); } };
  for(const el of [xf_dx, xf_dy, xf_dz, xf_s, xf_sx, xf_sy, xf_sz, xf_n]){
    el.addEventListener('input', refresh);
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === xfTool) xfTool.commit(); }
      if(e.key === 'Escape') releaseToolInput();
      e.stopPropagation();
    });
  }
  xf_move.addEventListener('click', () => { if(activeTool === xfTool) xfTool.setMode('move'); });
  xf_scale.addEventListener('click', () => { if(activeTool === xfTool) xfTool.setMode('scale'); });
  xf_off.addEventListener('click', () => { if(activeTool === xfTool) xfTool.setCopy(false); });
  xf_copy.addEventListener('click', () => { if(activeTool === xfTool) xfTool.setCopy(true); });
  xf_bottom.addEventListener('click', () => { if(activeTool === xfTool){ xfTool.pivotKind = 'bottom'; refresh(); } });
  xf_center.addEventListener('click', () => { if(activeTool === xfTool){ xfTool.pivotKind = 'center'; refresh(); } });
  for(const [id, v] of [['xf_half', 50], ['xf_double', 200], ['xf_inch', 2540]])
    $id(id).addEventListener('click', () => { if(activeTool !== xfTool) return; xf_s.value = v; xf_sx.value = xf_sy.value = xf_sz.value = ''; refresh(); });
  xf_ok.addEventListener('click', () => { if(activeTool === xfTool) xfTool.commit(); });
  $id('xf_cancel').addEventListener('click', () => { if(activeTool === xfTool) setActiveTool(null); });
  makeGripDrag(xfPopup);
}
const profPopup = document.getElementById('profPopup'), pf_title = document.getElementById('pf_title'), pf_state = document.getElementById('pf_state'),
      pf_revolve = document.getElementById('pf_revolve'), pf_angle = document.getElementById('pf_angle'), pf_segs = document.getElementById('pf_segs'),
      pf_info = document.getElementById('pf_info'), pf_hint = document.getElementById('pf_hint'), pf_ok = document.getElementById('pf_ok');
{
  for(const el of [pf_angle, pf_segs]){
    el.addEventListener('input', () => { if(activeTool === profTool) profTool.preview(); });
    el.addEventListener('keydown', e => {
      if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === profTool){ profTool.preview(true); profTool.commit(); } }
      if(e.key === 'Escape') releaseToolInput();
      e.stopPropagation();
    });
  }
  for(const [id, o] of [['pf_auto', 'auto'], ['pf_join', 'join'], ['pf_cut', 'cut']])
    document.getElementById(id).addEventListener('click', () => { if(activeTool !== profTool) return; profTool.op = o; profTool.preview(true); });
  pf_ok.addEventListener('click', () => { if(activeTool === profTool) profTool.commit(); });
  document.getElementById('pf_cancel').addEventListener('click', () => { if(activeTool === profTool) setActiveTool(null); });
  makeGripDrag(profPopup);
}
const slicePopup = document.getElementById('slicePopup'), sl_off = document.getElementById('sl_off'),
      sl_state = document.getElementById('sl_state'), sl_info = document.getElementById('sl_info'),
      sl_ok = document.getElementById('sl_ok'), sl_flip = document.getElementById('sl_flip'), sl_hint = document.getElementById('sl_hint');
sl_off.addEventListener('input', () => {
  if(activeTool !== sliceTool || !sliceTool.P0) return;
  const v = +sl_off.value;
  if(!Number.isFinite(v)) return;
  sliceTool.offset = snapMM(v); if(sliceTool.stage === 1) sliceTool.stage = 2;
  sliceTool.preview();
});
sl_off.addEventListener('keydown', e => {
  if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === sliceTool) sliceTool.commit(); }
  if(e.key === 'Escape'){ releaseToolInput(); }
  e.stopPropagation();
});
for(const [id, a] of [['sl_face', 'face'], ['sl_x', 'x'], ['sl_y', 'y'], ['sl_z', 'z']])
  document.getElementById(id).addEventListener('click', () => { if(activeTool === sliceTool) sliceTool.setAxis(a); });
sl_flip.addEventListener('click', () => { if(activeTool === sliceTool) sliceTool.flip(); });
sl_ok.addEventListener('click', () => { if(activeTool === sliceTool) sliceTool.commit(); });
document.getElementById('sl_cancel').addEventListener('click', () => { if(activeTool === sliceTool) setActiveTool(null); });
makeGripDrag(slicePopup);
for(const [id, w] of [['bev_outer', 'outer'], ['bev_holes', 'holes'], ['bev_all', 'all']])
  document.getElementById(id).addEventListener('click', ()=>{
    if(activeTool !== bevelTool || bevelTool.face < 0) return;
    bevelTool.loops = w; bevelTool.paintLoops(); bevelTool.preview(true);
  });
bev_cancel.addEventListener('click', ()=>setActiveTool(null));
for(const inp of [arr_n, arr_a]){
  inp.addEventListener('input', ()=>{ if(activeTool === arrTool){ arrTool.auto = false; arrTool.preview(); } });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); if(activeTool === arrTool) arrTool.commit(); }
    if(e.key === 'Escape'){ e.preventDefault(); setActiveTool(null); }
    e.stopPropagation();
  });
}
arr_ok.addEventListener('click', ()=>{ if(activeTool === arrTool) arrTool.commit(); });
arr_sugg.addEventListener('click', ev=>{
  const v = ev.target.dataset && ev.target.dataset.n;
  if(!v || activeTool !== arrTool) return;
  arr_n.value = v; arr_a.value = 360; arrTool.auto = false;
  releaseToolInput(); arrTool.preview();
});
arr_cancel.addEventListener('click', ()=>setActiveTool(null));
// густота круга меняется вживую: предпросмотр перерисовывается сразу
circ_seg.addEventListener('input', ()=>{
  if(!circleMode) return;
  circAuto = false; // выбрал сам — больше не подставляем
  if(!circleCenter){ recommitCircle(circLast ? circLast.R : 0); updateCircInfo(); return; }
  updateCircInfo('', drawCircleRing(circleCenter, circlePlane, circleR));
});
// Ø и R — одно число в двух видах. До центра размер фиксируется (FreeCAD:
// радиус в панели, клик ставит круг), при растягивании перебивает мышь,
// после постановки перерисовывает только что поставленный круг
let circFieldT = 0;
function applyCircField(R, final){
  clearTimeout(circFieldT);
  if(!circleMode) return;
  const ok = R > 0.05;
  if(circleCenter){
    if(!ok){ circRLock = false; updateCircInfo(); return; }
    circleR = R; circRLock = true;
    if(circAuto) circ_seg.value = autoCircSegs(R);
    const air = drawCircleRing(circleCenter, circlePlane, R);
    if(final) commitCircle();
    updateCircInfo('', final ? undefined : air);
    return;
  }
  if(!ok){ circFixedR = null; killRing(); updateCircInfo(); return; }
  if(circFixedR !== null || !circLastValid()) circFixedR = R; // размер следующих кругов
  if(circAuto) circ_seg.value = autoCircSegs(R);
  if(circLastValid()){
    const run = ()=>{ recommitCircle(R); updateCircInfo(); };
    if(final) run(); else circFieldT = setTimeout(run, 200);
  }
  updateCircInfo();
}
// шаг движка 0.1 мм — это шаг радиуса; диаметр тогда кратен 0.2, иначе
// Ø 42.1 дал бы радиус 21.05. Введённое число округляется до этой сетки
const circFieldR = (inp, v) => snapMM(inp === circ_d ? v/2 : v);
for(const inp of [circ_d, circ_r]){
  const other = inp === circ_d ? circ_r : circ_d;
  const toR = v => circFieldR(inp, v);
  inp.addEventListener('input', ()=>{
    const v = parseFloat(inp.value);
    other.value = v > 0 ? +(inp === circ_d ? toR(v) : 2*toR(v)).toFixed(1) : '';
    applyCircField(v > 0 ? toR(v) : 0, false);
  });
  inp.addEventListener('blur', ()=>{ // показать округлённое: 42.1 → 42.2
    const v = parseFloat(inp.value);
    if(v > 0) inp.value = +(inp === circ_d ? 2*toR(v) : toR(v)).toFixed(1);
  });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      const v = parseFloat(inp.value);
      applyCircField(v > 0 ? toR(v) : 0, true);
      releaseToolInput();
      updateCircInfo();
    }
    if(e.key === 'Escape'){ e.preventDefault(); releaseToolInput(); }
    e.stopPropagation(); // цифры поля не уходят во ввод диаметра с клавиатуры
  });
}
// OK — завершить инструмент (как Finish у Draft-инструментов FreeCAD):
// растягиваемый или введённый круг ставится, затем выход из режима
document.getElementById('circ_ok').addEventListener('click', ()=>{
  if(!circleMode) return;
  clearTimeout(circFieldT);
  if(circleCenter && circleR > 0.3) commitCircle();
  setCircleMode(false);
});
circ_seg.addEventListener('keydown', e=>{
  if(e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); releaseToolInput(); }
  e.stopPropagation(); // цифры поля не уходят во ввод диаметра
});
// exPopup объявляется ниже — его грипп подключается там же

// Врезка отрезка A-B в копланарные треугольники меша: каждый пересечённый
// треугольник делится по линии хорды на 2-3. После этого вдоль хорды есть
// настоящие рёбра сетки, и заливка граней режется по ней точно.
// wholeLine=true (для замкнутых контуров — окружность): режем по всей линии
// хорды без правила «середина внутри отрезка», но только треугольники,
// которые сегмент реально пересекает. Линии хорд выпуклого контура не
// заходят внутрь него, лишние резы — снаружи и копланарны (невидимы).
// После врезки одиночной линии: точки реза у соседних треугольников считаются
// порознь и расходятся на квант ключа (64.916 и 64.917) — ребро распадалось
// на два «граничных», и от точки на линии к углам грани рисовались косые
// рёбра. Сшиваем такие точки и Т-стыки; дорогую лечилку наложений не зовём
function healChordCut(){
  if(mesh.geometry.attributes.position.array.length > 9*60000) return;
  weldVertices(0.0015);
  cleanupMesh();
  for(let i=0;i<60;i++){
    const len0 = mesh.geometry.attributes.position.array.length;
    healTJunctions(); cleanupMesh();
    if(mesh.geometry.attributes.position.array.length === len0) break;
  }
}
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
function triNormalAt(t){
  const pos = mesh.geometry.attributes.position.array;
  const A=new THREE.Vector3().fromArray(pos,t*9),
        B=new THREE.Vector3().fromArray(pos,t*9+3),
        C=new THREE.Vector3().fromArray(pos,t*9+6);
  return new THREE.Vector3().crossVectors(B.sub(A), C.sub(A)).normalize();
}
// пересекаются ли 2D-отрезки ab и cd (строго, касание не считается)
function segCross2(a,b,c,d){
  const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const o1=o(a,b,c), o2=o(a,b,d), o3=o(c,d,a), o4=o(c,d,b);
  return ((o1>0)!==(o2>0)) && ((o3>0)!==(o4>0));
}
// связная копланарная грань вокруг треугольника.
// Заливка идёт по общим РЁБРАМ и не пересекает направляющие («Линия»),
// лежащие в плоскости грани, — хорда режет грань на области, как в SketchUp.
function facePatchAt(triIdx, reseeded, plane){
  const pos = mesh.geometry.attributes.position.array;
  // клик пришёлся в осколок-иглу: его нормаль неточна, и плоскость грани от
  // него «плывёт» — берём грань от самого крупного треугольника рядом
  if(!reseeded){
    const o = triIdx*9, P = k => new THREE.Vector3(pos[o+k*3], pos[o+k*3+1], pos[o+k*3+2]);
    const a = P(0), b = P(1), c = P(2);
    const Lmax = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const alt = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / Math.max(Lmax, 1e-9);
    if(alt < 0.1){
      const first = facePatchAt(triIdx, true);
      let big = -1, bigA = 0;
      for(const t of first.tris){
        const q = t*9;
        const ar = new THREE.Vector3(pos[q+3]-pos[q], pos[q+4]-pos[q+1], pos[q+5]-pos[q+2])
          .cross(new THREE.Vector3(pos[q+6]-pos[q], pos[q+7]-pos[q+1], pos[q+8]-pos[q+2])).length();
        if(ar > bigA){ bigA = ar; big = t; }
      }
      if(big < 0 || big === triIdx) return first;
      const again = facePatchAt(big, true);
      return again.set.has(triIdx) ? again : first;
    }
  }
  const n0 = plane ? plane.n : triNormalAt(triIdx);
  const d0 = plane ? plane.d : n0.x*pos[triIdx*9] + n0.y*pos[triIdx*9+1] + n0.z*pos[triIdx*9+2];
  // 2D-базис плоскости для тестов пересечения с хордами
  const u = (Math.abs(n0.z) < 0.9
    ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n0).normalize();
  const v = n0.clone().cross(u);
  const to2 = (x,y,z) => [x*u.x+y*u.y+z*u.z, x*v.x+y*v.y+z*v.z];
  const inPlane = P => Math.abs(P.x*n0.x+P.y*n0.y+P.z*n0.z - d0) < 0.1;
  const cuts = guides.filter(g => inPlane(g.a) && inPlane(g.b))
    .map(g => {
      // обычная линия продлевается на 1 мм за концы, чтобы заливка не
      // «обтекала» их; сегмент замкнутого контура (noExt: текст) — нет,
      // и проверяется он ТОЧНО (общее ребро на сегменте), а не эвристикой
      const A = to2(g.a.x,g.a.y,g.a.z), B = to2(g.b.x,g.b.y,g.b.z);
      // сегмент окружности — тоже замкнутый контур: продление на 1 мм за
      // концы отрезало у соседних сегментов клинышки по 0.01–0.3 мм² вокруг
      if(g.noExt || g.curve) return {a:A, b:B, noExt:true};
      const dx = B[0]-A[0], dy = B[1]-A[1];
      const L = Math.hypot(dx,dy) || 1;
      const ex = dx/L, ey = dy/L;
      return {a:[A[0]-ex, A[1]-ey], b:[B[0]+ex, B[1]+ey], noExt:false};
    });
  // ребро лежит на сегменте cut? Оба конца на его прямой (0.05 мм) и
  // проекции перекрываются с сегментом — ловит и рёбра, лишь частично
  // накрывающие сегмент (середина такого ребра может быть за концом)
  const midOnCut = (A2, B2, cut) => {
    const ax=cut.a[0], ay=cut.a[1];
    const dx=cut.b[0]-ax, dy=cut.b[1]-ay;
    const L = Math.hypot(dx,dy);
    if(L < 1e-9) return false;
    const ux=dx/L, uy=dy/L;
    if(Math.abs((A2[0]-ax)*uy - (A2[1]-ay)*ux) > 0.05) return false;
    if(Math.abs((B2[0]-ax)*uy - (B2[1]-ay)*ux) > 0.05) return false;
    let tA = (A2[0]-ax)*ux + (A2[1]-ay)*uy;
    let tB = (B2[0]-ax)*ux + (B2[1]-ay)*uy;
    if(tA > tB){ const t=tA; tA=tB; tB=t; }
    // порог перекрытия — относительный: микроребро-осколок (0.02 мм),
    // целиком лежащее на сегменте, тоже барьер; а касание соседнего
    // коллинеарного ребра кончиком (перекрытие ~0) — нет
    const eLen = tB - tA;
    return Math.min(tB, L) - Math.max(tA, 0) > Math.min(0.04, eLen*0.45);
  };
  // смежность по рёбрам
  const eAdj = new Map();
  const triCount = pos.length/9;
  for(let t=0;t<triCount;t++){
    for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      let arr=eAdj.get(ek); if(!arr){arr=[];eAdj.set(ek,arr);} arr.push(t);
    }
  }
  const cent2 = t => {
    const o=t*9;
    return to2((pos[o]+pos[o+3]+pos[o+6])/3, (pos[o+1]+pos[o+4]+pos[o+7])/3, (pos[o+2]+pos[o+5]+pos[o+8])/3);
  };
  // осколок булевых/заливки (площадь ~0, все вершины в плоскости): нормаль у
  // него случайная, но это часть грани — иначе он рвёт её на выбираемые куски
  const sliverInPlane = t => {
    const o = t*9;
    for(let j=0;j<3;j++)
      if(Math.abs(n0.x*pos[o+j*3]+n0.y*pos[o+j*3+1]+n0.z*pos[o+j*3+2] - d0) > 0.02) return false;
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2];
    const vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    // длинная игла тоже осколок: мерим не площадь, а высоту к длинной стороне
    const wx=pos[o+6]-pos[o+3], wy=pos[o+7]-pos[o+4], wz=pos[o+8]-pos[o+5];
    const Lmax = Math.max(Math.hypot(ux,uy,uz), Math.hypot(vx,vy,vz), Math.hypot(wx,wy,wz));
    return Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx) / Math.max(Lmax, 1e-9) < 0.1;
  };
  const set = new Set([triIdx]);
  const queue = [triIdx];
  const crossesCut = (A2, B2, ct, c2) => {
    for(const cut of cuts)
      if(cut.noExt ? midOnCut(A2, B2, cut) : segCross2(ct, c2, cut.a, cut.b)) return true;
    return false;
  };
  const flood = () => {
  while(queue.length){
    const t = queue.pop();
    const ct = cent2(t);
    for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      const adj = eAdj.get(ek) || [];
      // ребро, у которого больше двух граней (грань, пришитая к краю другой:
      // залитый круг вокруг верхней грани куба), — видимое ребро и граница
      // области: квадрат и кольцо вокруг выбираются по отдельности
      if(adj.length > 2 && adj.some(t2 => triNormalAt(t2).dot(n0) < 0.999 && !sliverInPlane(t2))) continue;
      for(const t2 of adj){
        if(set.has(t2)) continue;
        if(triNormalAt(t2).dot(n0) < 0.999 && !sliverInPlane(t2)) continue;
        const o3 = t2*9;
        if(Math.abs(n0.x*pos[o3]+n0.y*pos[o3+1]+n0.z*pos[o3+2] - d0) > 0.02) continue;
        // не переступаем через хорду. Контур текста (noExt) проверяем
        // точно: врезка совпадает с рёбрами сетки, так что барьер — это
        // общее ребро, лежащее НА сегменте. Обычные линии — эвристикой
        // центроидов (сохраняет их привычное поведение с продлением).
        if(cuts.length){
          const A2 = to2(pos[o1],pos[o1+1],pos[o1+2]);
          const B2 = to2(pos[o2],pos[o2+1],pos[o2+2]);
          const c2 = cent2(t2);
          let crossed = false;
          for(const cut of cuts){
            if(cut.noExt ? midOnCut(A2, B2, cut) : segCross2(ct, c2, cut.a, cut.b)){
              crossed = true; break;
            }
          }
          if(crossed) continue;
        }
        set.add(t2); queue.push(t2);
      }
    }
  }
  };
  flood();
  // Т-стыки: после булевых и заливки соседи в грани часто делят сторону не
  // целиком (вершина посреди стороны соседа) — общего ребра нет, и ровная
  // стенка выбиралась тремя кусками. Добираем треугольники плоскости, чья
  // сторона лежит на той же прямой, что и сторона области, с перекрытием
  let planeTris = null;
  for(let pass = 0; pass < 40; pass++){
    if(!planeTris){
      planeTris = [];
      for(let t=0;t<triCount;t++){
        if(set.has(t)) continue;
        const o = t*9;
        if(Math.abs(n0.x*pos[o]+n0.y*pos[o+1]+n0.z*pos[o+2] - d0) > 0.02) continue;
        if(Math.abs(n0.x*pos[o+3]+n0.y*pos[o+4]+n0.z*pos[o+5] - d0) > 0.02) continue;
        if(Math.abs(n0.x*pos[o+6]+n0.y*pos[o+7]+n0.z*pos[o+8] - d0) > 0.02) continue;
        if(triNormalAt(t).dot(n0) < 0.999 && !sliverInPlane(t)) continue;
        const es = [];
        for(let e=0;e<3;e++){
          const a = to2(pos[o+e*3], pos[o+e*3+1], pos[o+e*3+2]);
          const b = to2(pos[o+((e+1)%3)*3], pos[o+((e+1)%3)*3+1], pos[o+((e+1)%3)*3+2]);
          es.push({a, b, x0: Math.min(a[0],b[0]), x1: Math.max(a[0],b[0]), y0: Math.min(a[1],b[1]), y1: Math.max(a[1],b[1])});
        }
        planeTris.push({t, es});
      }
      if(!planeTris.length || planeTris.length > 20000) break;
    }
    // открытые стороны области (у ребра нет второго треугольника из области)
    const bnd = [];
    for(const t of set){
      const o = t*9;
      for(let e=0;e<3;e++){
        const o1=o+e*3, o2=o+((e+1)%3)*3;
        const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
        const adj = eAdj.get(k1<k2 ? k1+'|'+k2 : k2+'|'+k1) || [];
        if(adj.some(t2 => t2 !== t && set.has(t2))) continue;
        const a = to2(pos[o1],pos[o1+1],pos[o1+2]), b = to2(pos[o2],pos[o2+1],pos[o2+2]);
        const L = Math.hypot(b[0]-a[0], b[1]-a[1]);
        if(L < 1e-6) continue;
        bnd.push({t, a, b, L, ux:(b[0]-a[0])/L, uy:(b[1]-a[1])/L,
          x0: Math.min(a[0],b[0])-0.003, x1: Math.max(a[0],b[0])+0.003, y0: Math.min(a[1],b[1])-0.003, y1: Math.max(a[1],b[1])+0.003});
      }
    }
    let added = false;
    for(const pt of planeTris){
      if(set.has(pt.t)) continue;
      let link = null;
      for(const e of pt.es){
        for(const s of bnd){
          if(e.x1 < s.x0 || e.x0 > s.x1 || e.y1 < s.y0 || e.y0 > s.y1) continue;
          const da = Math.abs((e.a[0]-s.a[0])*s.uy - (e.a[1]-s.a[1])*s.ux);
          const db = Math.abs((e.b[0]-s.a[0])*s.uy - (e.b[1]-s.a[1])*s.ux);
          if(da > 0.002 || db > 0.002) continue;
          let tA = (e.a[0]-s.a[0])*s.ux + (e.a[1]-s.a[1])*s.uy, tB = (e.b[0]-s.a[0])*s.ux + (e.b[1]-s.a[1])*s.uy;
          if(tA > tB){ const x = tA; tA = tB; tB = x; }
          if(Math.min(tB, s.L) - Math.max(tA, 0) < 0.01) continue;
          if(cuts.length && crossesCut(s.a, s.b, cent2(s.t), cent2(pt.t))) continue;
          link = s; break;
        }
        if(link) break;
      }
      if(link){ set.add(pt.t); queue.push(pt.t); added = true; }
    }
    if(!added) break;
    flood();
  }
  // плоскость по одному (мелкому) треугольнику неточна: на стенке 40 мм уже
  // 0.1° наклона дают 0.07 мм и дальний край «не в плоскости». Уточняем
  // плоскость по найденной области (нормаль и центр, взвешенные площадью)
  // и собираем грань заново — один раз
  if((!plane || plane.iter < 3) && set.size > 1){
    const nn = new THREE.Vector3(), cc = new THREE.Vector3();
    let aw = 0;
    for(const t of set){
      const o = t*9;
      const cx = new THREE.Vector3(pos[o+3]-pos[o], pos[o+4]-pos[o+1], pos[o+5]-pos[o+2])
        .cross(new THREE.Vector3(pos[o+6]-pos[o], pos[o+7]-pos[o+1], pos[o+8]-pos[o+2]));
      const ar = cx.length();
      if(ar < 1e-9) continue;
      if(cx.dot(n0) < 0) cx.negate();
      nn.add(cx);
      cc.x += ar*(pos[o]+pos[o+3]+pos[o+6])/3; cc.y += ar*(pos[o+1]+pos[o+4]+pos[o+7])/3; cc.z += ar*(pos[o+2]+pos[o+5]+pos[o+8])/3;
      aw += ar;
    }
    if(aw > 0 && nn.lengthSq() > 0){
      nn.normalize(); cc.multiplyScalar(1/aw);
      const dn = nn.dot(cc);
      if(nn.dot(n0) < 0.9999999 || Math.abs(dn - d0) > 0.001)
        return facePatchAt(triIdx, true, {n: nn, d: dn, iter: plane ? plane.iter + 1 : 1});
    }
  }
  const keys = new Set();
  for(const t of set) for(let vv=0; vv<3; vv++){
    const o = t*9+vv*3;
    keys.add(keyOf(pos[o],pos[o+1],pos[o+2]));
  }
  return {set, tris:[...set], keys, normal:n0};
}
function showPatch(patch, color){
  hidePatch();
  if(!patch) return;
  const pos = mesh.geometry.attributes.position.array;
  const arr = new Float32Array(patch.tris.length*9);
  let o = 0;
  for(const t of patch.tris) for(let j=0;j<9;j++) arr[o++] = pos[t*9+j];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr,3));
  // подсветка лежит ТОЧНО на грани: приподнимаем её только в буфере
  // глубины (polygonOffset). Прежний сдвиг по нормали на 0.05 мм на
  // сильном зуме «отслаивался» от грани и закрывал её рёбра
  ppHi = new THREE.Mesh(g, new THREE.MeshBasicMaterial(
    {color: color || C_EDGE, transparent:true, opacity:0.35, side:THREE.DoubleSide,
     polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2}));
  scene.add(ppHi);
}
let hoverHi = null;
function showHoverPatch(patch){
  hideHoverPatch();
  if(!patch) return;
  const pos = mesh.geometry.attributes.position.array;
  const arr = new Float32Array(patch.tris.length*9);
  let o = 0;
  for(const t of patch.tris) for(let j=0;j<9;j++) arr[o++] = pos[t*9+j];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr,3));
  hoverHi = new THREE.Mesh(g, new THREE.MeshBasicMaterial(
    {color: C_EDGE, transparent:true, opacity:0.35, side:THREE.DoubleSide,
     polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3}));
  scene.add(hoverHi);
}
function hideHoverPatch(){
  if(hoverHi){ scene.remove(hoverHi); hoverHi.geometry.dispose(); hoverHi = null; }
}
function hidePatch(){
  if(ppHi){ scene.remove(ppHi); ppHi.geometry.dispose(); ppHi=null; }
  if(typeof hideSelCenters === 'function') hideSelCenters();
}
function raycastFace(q){
  raycaster.setFromCamera({x:q.mx/q.w*2-1, y:-(q.my/q.h*2-1)}, q.cam);
  const hits = raycaster.intersectObject(mesh);
  // Изнанка тоже выбирается: лист в воздухе (залитое кольцо) видно снизу
  // серо-голубой изнанкой — по нему должно быть можно кликнуть. У замкнутого
  // тела изнанка всегда дальше лицевой грани, поэтому берём ближайшее
  if(backMesh){
    const hb = raycaster.intersectObject(backMesh);
    if(hb.length && (!hits.length || hb[0].distance < hits[0].distance - 1e-6)) return hb[0];
  }
  return hits.length ? hits[0] : null;
}
// параметр t на прямой P+t*dir, ближайший к лучу
function rayLineParam(ray, P, dir){
  const O = ray.origin, d = ray.direction;
  const w0 = new THREE.Vector3().subVectors(P, O);
  const a = dir.dot(dir), b = dir.dot(d), c = d.dot(d);
  const den = a*c - b*b;
  if(Math.abs(den) < 1e-9) return 0;
  return (b*w0.dot(d) - c*w0.dot(dir)) / den;
}

const dragTip = document.getElementById('dragTip');
const toolTag = document.getElementById('toolTag');
function updateToolTag(){
  // бейдж у курсора убран по просьбе пользователя: курсор-крестик и HUD
  // внизу уже говорят, какой инструмент активен
  toolTag.hidden = true;
}
// палитра продолжений после G — полупрозрачный список у курсора
const chordHint = document.getElementById('chordHint');
let lastMX = 0, lastMY = 0;
// палитры выбора не исчезают сами; ручка ⠿ — перетащить окно
const CH_GRIP = '<div class="chgrip" title="Drag">⠿</div>';
for(const box of [chordHint, dragTip])
  new MutationObserver(()=>markModifierWords(box)).observe(box, {childList: true, subtree: true});
markModifierWords(document.getElementById('exPopup')); // постоянные подписи окна Extrude
let chGripDrag = null;
chordHint.addEventListener('pointerdown', ev=>{
  if(!ev.target.classList || !ev.target.classList.contains('chgrip')) return;
  const r = chordHint.getBoundingClientRect();
  chGripDrag = {dx: ev.clientX - r.left, dy: ev.clientY - r.top};
  ev.preventDefault(); ev.stopPropagation();
});
window.addEventListener('pointermove', ev=>{
  if(!chGripDrag) return;
  const vr = view.getBoundingClientRect();
  chordHint.style.left = (ev.clientX - vr.left - chGripDrag.dx) + 'px';
  chordHint.style.top  = (ev.clientY - vr.top - chGripDrag.dy) + 'px';
});
window.addEventListener('pointerup', ()=>{ chGripDrag = null; });
function showChordHint(){
  if(!hintsChk.checked) return; // профи подсказки не нужны
  const vr = view.getBoundingClientRect();
  // весь список инструментов: доступные — ярко, недоступные — притушены
  const row = (key, label, on) =>
    '<div'+(on ? '' : ' style="opacity:.35"')+'><span class="key">'+key+'</span> — '+label+'</div>';
  chordHint.innerHTML =
    row('L', 'Line (single segments)', true) +
    row('M', 'Polyline (chained)', true) +
    row('R', 'Rectangle on face', true) +
    row('A', 'Polar array (selected lines)', edgeSel.some(x=>x.isGuide) || !!selAnchor) +
    row('C', 'Circle on face — also C', true) +
    row('T', '3D Text on face', true) +
    row('Y', 'Point (with snaps) — also P', true) +
    row('E', 'Extrude face ±mm', !!ppPatch) +
    row('S', 'Slice the body with a plane', true) +
    row('U', 'Cylinder / cone on a face', true) +
    row('O', 'Revolve a profile around an axis', true) +
    row('W', 'Sweep a profile along the selected lines', edgeSel.length > 0) +
    row('F', 'Loft between two profiles', true) +
    row('I', 'Mirror a body', true) +
    row('B', 'Move / copy / scale a body', true) +
    row('H', 'Shell — hollow a body', true) +
    row('V', 'Vertex X/Y/Z', !!sel) +
    '<div style="opacity:.55">Esc — cancel</div>';
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 400) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 240) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t);
  showChordHint._t = setTimeout(()=>{ hideChordHint(); chordG = 0; }, 4000);
}
function hideChordHint(){
  chordHint.hidden = true; clearTimeout(showChordHint._t);
  if(typeof selCardHi !== 'undefined') unhiSelGroup(); // карточки исчезли — подсветка тоже
}
// палитра операций для выбранной грани
function showFacePalette(){
  tipHide(); // информация объекта — в шапке палитры
  // точки центров при простом выборе грани не показываем (только в
  // инструментах, где центр — снап-цель: линия, точка, окружность, текст)
  // информация в столбик: тип, сторона (у квадрата), площадь
  const areaStr = ppPatch && ppPatch.area
    ? (Math.round(ppPatch.area*10)/10) + ' mm²' : null;
  let info = 'Face' + (areaStr ? '<br>' + areaStr : '');
  if(ppPatch && ppPatch.parts > 1)
    info = 'Faces × ' + ppPatch.parts + (areaStr ? '<br>' + areaStr : '');
  else if(ppPatch && ppPatch.rectDims){
    const [a, b] = ppPatch.rectDims;
    const area = (Math.round(a*b*10)/10).toString();
    info = Math.abs(a - b) < 0.05
      ? 'Square<br>side ' + a.toFixed(1) + ' mm<br>' + area + ' mm²'
      : 'Rectangle<br>' + area + ' mm²';
  }
  const vr = view.getBoundingClientRect();
  // размеры — данные, видны всегда; команды — подсказка, гасится флагом
  chordHint.innerHTML = CH_GRIP +
    '<div style="color:var(--text);font-weight:600">' + info + '</div>' +
    (!hintsChk.checked ? '' :
    '<div><span class="key">E</span> — Extrude: drag or value · Join / Cut</div>' +
    '<div><span class="key">Ctrl+B</span> — chamfer / fillet the outline</div>' +
    '<div><span class="key">Ctrl+click</span> — multi-select (same plane)</div>' +
    '<div><span class="key">Ctrl+I</span> — invert: the other areas of this plane</div>' +
    '<div><span class="key">B</span> — bounding edges</div>' +
    '<div><span class="key">Del</span> — Delete face</div>' +
    '<div style="opacity:.55">Esc — deselect</div>');
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 380) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 150) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t); // живёт, пока выбор жив
}
// ---------- стирание рёбер и линий (Del) ----------
// Нарисованная линия стирается всегда: это разметка, а не форма — ластик
// режет её до ближайших перекрёстков, как в SketchUp.
// Ребро СЕТКИ убираем, только если оно лишнее: по обе стороны одна и та же
// плоскость (Refine shape во FreeCAD, Limited Dissolve в Blender). Ребро с
// изломом держит форму — куб без ребра развалился бы, поэтому отказываем
// и называем угол, из-за которого ребро формообразующее.
const DISSOLVE_DEG = 0.5;
function trisOnEdge(ka, kb){
  const pos = mesh.geometry.attributes.position.array;
  const out = [];
  for(let i=0;i<pos.length;i+=9){
    const k = [keyOf(pos[i],pos[i+1],pos[i+2]),
               keyOf(pos[i+3],pos[i+4],pos[i+5]),
               keyOf(pos[i+6],pos[i+7],pos[i+8])];
    if(k.indexOf(ka)>=0 && k.indexOf(kb)>=0) out.push({i, k});
  }
  return out;
}
function triNormalAtOffset(o){
  const pos = mesh.geometry.attributes.position.array;
  const a = new THREE.Vector3(pos[o],pos[o+1],pos[o+2]);
  const b = new THREE.Vector3(pos[o+3],pos[o+4],pos[o+5]);
  const c = new THREE.Vector3(pos[o+6],pos[o+7],pos[o+8]);
  return new THREE.Vector3().subVectors(b,a)
    .cross(new THREE.Vector3().subVectors(c,a)).normalize();
}
// двугранный угол на ребре в градусах; null — ребро не парное (край дырки)
function edgeDihedral(A, B){
  const t = trisOnEdge(keyOf(A.x,A.y,A.z), keyOf(B.x,B.y,B.z));
  if(t.length !== 2) return null;
  const d = Math.max(-1, Math.min(1,
    triNormalAtOffset(t[0].i).dot(triNormalAtOffset(t[1].i))));
  return Math.acos(d)*180/Math.PI;
}
// убрать лишнее ребро: два копланарных треугольника перетриангулировать по
// другой диагонали (flip). Допустимо, только когда C-D реально пересекает
// A-B — иначе четырёхугольник невыпуклый и треугольники наложились бы
function dissolveMeshEdge(A, B){
  const ka = keyOf(A.x,A.y,A.z), kb = keyOf(B.x,B.y,B.z);
  const t = trisOnEdge(ka, kb);
  if(t.length !== 2) return false;
  const pos = mesh.geometry.attributes.position.array;
  const other = rec => {
    for(let j=0;j<3;j++) if(rec.k[j]!==ka && rec.k[j]!==kb)
      return new THREE.Vector3(pos[rec.i+j*3], pos[rec.i+j*3+1], pos[rec.i+j*3+2]);
    return null;
  };
  const C = other(t[0]), D = other(t[1]);
  if(!C || !D) return false;
  const n0 = triNormalAtOffset(t[0].i);
  const u = new THREE.Vector3().subVectors(B,A).normalize();
  const v = new THREE.Vector3().crossVectors(n0, u);
  const to2 = P => [P.dot(u), P.dot(v)];
  if(!segCross2(to2(A), to2(B), to2(C), to2(D))) return false;
  const orient = (p,q,r) => new THREE.Vector3().subVectors(q,p)
    .cross(new THREE.Vector3().subVectors(r,p)).dot(n0) >= 0 ? [p,q,r] : [p,r,q];
  const keep = [];
  for(let i=0;i<pos.length;i+=9)
    if(i!==t[0].i && i!==t[1].i) for(let j=0;j<9;j++) keep.push(pos[i+j]);
  for(const tri of [orient(A,D,C), orient(D,B,C)])
    for(const p of tri) keep.push(p.x, p.y, p.z);
  setMeshFromArray(new Float32Array(keep));
  return true;
}
// вырезать участок нарисованной линии, оставив хвосты за перекрёстками
function eraseGuideSegment(A, B){
  for(let i=0;i<guides.length;i++){
    const g = guides[i];
    const d = new THREE.Vector3().subVectors(g.b, g.a);
    const L = d.length();
    if(L < 1e-6) continue;
    const u = d.multiplyScalar(1/L);
    const vA = new THREE.Vector3().subVectors(A, g.a);
    const vB = new THREE.Vector3().subVectors(B, g.a);
    const tA = vA.dot(u), tB = vB.dot(u);
    if(vA.addScaledVector(u,-tA).length() > 0.02) continue; // не на этой прямой
    if(vB.addScaledVector(u,-tB).length() > 0.02) continue;
    const t0 = Math.min(tA,tB), t1 = Math.max(tA,tB);
    if(t1 < 0.05 || t0 > L-0.05) continue;                  // мимо этого отрезка
    const tails = [], noExt = g.noExt;
    if(t0 > 0.05)   tails.push([g.a.clone(), g.a.clone().addScaledVector(u, t0)]);
    if(t1 < L-0.05) tails.push([g.a.clone().addScaledVector(u, t1), g.b.clone()]);
    scene.remove(g.line); g.line.geometry.dispose();
    guides.splice(i,1);
    for(const [pa,pb] of tails) addGuide(pa, pb, noExt, g.curve);
    return true;
  }
  return false;
}
// лежит ли на отрезке A–B (хотя бы частью) нарисованная линия
function guideAlong(A, B){
  for(const g of guides){
    const d = new THREE.Vector3().subVectors(g.b, g.a), L = d.length();
    if(L < 1e-6) continue;
    const u = d.multiplyScalar(1 / L);
    const vA = new THREE.Vector3().subVectors(A, g.a), vB = new THREE.Vector3().subVectors(B, g.a);
    const tA = vA.dot(u), tB = vB.dot(u);
    if(vA.addScaledVector(u, -tA).length() > 0.02 || vB.addScaledVector(u, -tB).length() > 0.02) continue;
    if(Math.max(tA, tB) < 0.05 || Math.min(tA, tB) > L - 0.05) continue;
    return true;
  }
  return false;
}
function deleteSelEdges(){
  if(!edgeSel.length) return;
  const warn = msg => warnTip(msg);
  // сначала проверяем все сегменты: стираем либо всё, либо ничего
  const jobs = [];
  for(const s of edgeSel){
    for(let i=0;i+1<s.pts.length;i++){
      const A = s.pts[i], B = s.pts[i+1];
      if(s.isGuide){ jobs.push({guide:true, A, B}); continue; }
      const ang = edgeDihedral(A, B);
      // по ребру, которое стереть нельзя (край дыры, излом формы), может
      // идти нарисованная линия — выбор цепляет ребро, и линия оставалась
      // навсегда. Стираем линию (разметку), ребро сетки не трогаем
      const hasGuide = guideAlong(A, B);
      if(ang === null){
        if(hasGuide){ jobs.push({guide:true, A, B}); continue; }
        // край дыры: как Erase в SketchUp — стёртое ребро забирает грань,
        // которую ограничивало (дыру потом закрывают одной гранью — F)
        const t = trisOnEdge(keyOf(A.x,A.y,A.z), keyOf(B.x,B.y,B.z));
        if(t.length === 1){ jobs.push({face: t[0].i / 9}); continue; }
        warn('Border of a hole — nothing to merge'); return;
      }
      if(ang > DISSOLVE_DEG){
        if(hasGuide){ jobs.push({guide:true, A, B}); continue; }
        warn('Edge holds the shape (∠ ' + ang.toFixed(1) + '°) — can’t erase');
        return;
      }
      jobs.push({guide:false, A, B});
    }
  }
  pushUndo();
  let done = 0;
  // грани — первыми: номера треугольников верны только до правки сетки
  const faceTris = new Set();
  for(const j of jobs) if(j.face != null) for(const t of facePatchAt(j.face).tris) faceTris.add(t);
  if(faceTris.size){
    const pos = mesh.geometry.attributes.position.array, keep = [];
    for(let t=0;t<pos.length/9;t++){
      if(faceTris.has(t)) continue;
      for(let k=0;k<9;k++) keep.push(pos[t*9+k]);
    }
    setMeshFromArray(new Float32Array(keep));
    ppPatch = null; hidePatch(); cachedPatch = null;
    done++;
  }
  for(const j of jobs){
    if(j.face != null) continue;
    done += (j.guide ? eraseGuideSegment(j.A, j.B) : dissolveMeshEdge(j.A, j.B)) ? 1 : 0;
  }
  if(!done){ undo(true); warn('Nothing to erase'); return; }
  clearEdgeSel(); hideChordHint();
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
}
// B — «рёбра границы» выбранной грани: Bounding Edges из контекстного меню
// SketchUp, Select Boundary Loop в Blender. Заодно это ответ на вопрос
// «как выбрать круг целиком»: выбрал круглую площадку — нажал B
function selectPatchBoundary(){
  if(!ppPatch) return;
  const pos = mesh.geometry.attributes.position.array;
  const cnt = new Map();
  for(const t of ppPatch.tris) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    const r = cnt.get(ek);
    if(r) r.n++;
    else cnt.set(ek, {n:1, a:new THREE.Vector3(pos[o1],pos[o1+1],pos[o1+2]),
                            b:new THREE.Vector3(pos[o2],pos[o2+1],pos[o2+2])});
  }
  // Сравниваем не «ребро в ребро»: хорда круга в сетке разбита на куски,
  // поэтому берём середину каждого граничного ребра и ищем цепочку,
  // через которую она проходит
  const mids = [];
  for(const r of cnt.values()) if(r.n === 1) mids.push(r.a.clone().add(r.b).multiplyScalar(0.5));
  const distToChain = (M, c) => {
    let best = 1e9;
    for(let i=0;i+1<c.pts.length;i++){
      const A = c.pts[i], B = c.pts[i+1];
      const d = new THREE.Vector3().subVectors(B, A);
      const L2 = d.lengthSq();
      if(L2 < 1e-12) continue;
      let t = new THREE.Vector3().subVectors(M, A).dot(d) / L2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, M.distanceTo(A.clone().addScaledVector(d, t)));
    }
    return best;
  };
  const picked = [];
  for(const c of chains)
    if(mids.some(M => distToChain(M, c) < 0.01)) picked.push(c);
  if(!picked.length) return;
  hidePatch(); ppPatch = null; ppParts = null;
  clearEdgeSel();
  for(const c of picked) toggleEdgeSel(c);
  showEdgePalette(picked[0]);
}
// B при выбранном ребре/линии — достроить выбор до замкнутого контура: самый
// короткий плоский цикл рёбер и линий через это ребро (Select Loop в Blender,
// Bounding Edges в SketchUp — от грани). Дальше F заливает, Shift+F выравнивает
function selectContourFromEdge(){
  if(edgeSel.length !== 1) return false;
  const s = chains.find(c => edgeSelKey(c) === edgeSel[0].key);
  if(!s || s.closed) return false;
  const K = p => keyOf(p.x,p.y,p.z);
  const ends = c => [K(c.pts[0]), K(c.pts[c.pts.length-1])];
  const [ku, kv] = ends(s);
  const A = s.pts[0], B = s.pts[s.pts.length-1];
  const dir = new THREE.Vector3().subVectors(B, A);
  if(dir.length() < 1e-6) return false;
  dir.normalize();
  // плоскости-кандидаты: сама кривая (дуга) или ребро + соседняя цепочка
  const normals = [];
  const addN = P => {
    const n = new THREE.Vector3().subVectors(P, A).cross(dir);
    if(n.length() < 0.05) return;
    n.normalize();
    if(!normals.some(m => Math.abs(m.dot(n)) > 0.999)) normals.push(n);
  };
  for(const p of s.pts) addN(p);
  if(!normals.length)
    for(const c of chains){
      if(c === s || c.closed) continue;
      const [a, b] = ends(c);
      if(a === ku || a === kv || b === ku || b === kv) for(const p of c.pts) addN(p);
    }
  let best = null;
  for(const n of normals){
    const d0 = n.dot(A);
    if(s.pts.some(p => Math.abs(n.dot(p) - d0) > 0.05)) continue;
    const adj = new Map();
    for(const c of chains){
      if(c === s || c.closed || c.pts.some(p => Math.abs(n.dot(p) - d0) > 0.05)) continue;
      const [a, b] = ends(c);
      if(a === b) continue;
      if(!adj.has(a)) adj.set(a, []);
      if(!adj.has(b)) adj.set(b, []);
      adj.get(a).push({to: b, c}); adj.get(b).push({to: a, c});
    }
    // Дейкстра от одного конца ребра к другому
    const dist = new Map([[kv, 0]]), prev = new Map(), done = new Set();
    while(true){
      let cur = null, cd = Infinity;
      for(const [k, dd] of dist) if(!done.has(k) && dd < cd){ cd = dd; cur = k; }
      if(cur === null || cur === ku) break;
      done.add(cur);
      for(const e of adj.get(cur) || []){
        const nd = cd + e.c.total;
        if(nd < (dist.has(e.to) ? dist.get(e.to) : Infinity)){ dist.set(e.to, nd); prev.set(e.to, {from: cur, c: e.c}); }
      }
    }
    if(!dist.has(ku)) continue;
    const path = [];
    for(let k = ku; k !== kv; k = prev.get(k).from) path.push(prev.get(k).c);
    const cost = dist.get(ku);
    if(!best || cost < best.cost) best = {cost, path};
  }
  if(!best){ warnTip('No closed flat contour through this edge'); return true; }
  clearEdgeSel();
  for(const c of [s, ...best.path]) toggleEdgeSel(c);
  showEdgePalette(s);
  return true;
}
// Shift+F — ровная грань по плоскому контуру: всё, что внутри контура отходит
// от его плоскости (фасеты окружности, осколки, остатки граней), срезается или
// добирается до плоскости, и остаётся одна грань. Закрытое тело — булевыми
// (минус призма над плоскостью, плюс призма под ней), тело с дырками — стираем
// треугольники внутри контура и заливаем
function flatFillLoop(loop){
  const n = new THREE.Vector3();
  for(let i=0;i<loop.length;i++){ // нормаль Ньюэлла — по обходу контура
    const p = loop[i], q = loop[(i+1)%loop.length];
    n.x += (p.y-q.y)*(p.z+q.z); n.y += (p.z-q.z)*(p.x+q.x); n.z += (p.x-q.x)*(p.y+q.y);
  }
  if(n.length() < 1e-9) return false;
  n.normalize();
  const c = loop.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1/loop.length);
  const d0 = n.dot(c);
  if(loop.some(p => Math.abs(n.dot(p) - d0) > 0.05)){ warnTip('Shift+F needs a flat contour'); return true; }
  const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize();
  const v = n.clone().cross(u);
  const poly = loop.map(p => [p.dot(u), p.dot(v)]);
  const inPoly = (x, y) => {
    let inside = false;
    for(let i=0, j=poly.length-1; i<poly.length; j=i++){
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
    }
    return inside;
  };
  let mnx=1e9, mxx=-1e9, mny=1e9, mxy=-1e9;
  for(const [x, y] of poly){ mnx=Math.min(mnx,x); mxx=Math.max(mxx,x); mny=Math.min(mny,y); mxy=Math.max(mxy,y); }
  // насколько грань может отходить от плоскости и всё ещё считаться «этой»
  const tol = Math.min(5, Math.max(1, Math.hypot(mxx-mnx, mxy-mny) * 0.15));
  const pos = mesh.geometry.attributes.position.array;
  const inside = new Set(), avgN = new THREE.Vector3();
  let dMin = 0, dMax = 0;
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    let far = false, cx = 0, cy = 0;
    const ds = [];
    for(let j=0;j<3;j++){
      const P = new THREE.Vector3(pos[o+j*3], pos[o+j*3+1], pos[o+j*3+2]);
      const dd = n.dot(P) - d0;
      if(Math.abs(dd) > tol){ far = true; break; }
      ds.push(dd); cx += P.dot(u)/3; cy += P.dot(v)/3;
    }
    if(far || !inPoly(cx, cy)) continue;
    const tn = triNormalAt(t);
    if(Math.abs(tn.dot(n)) < 0.5) continue; // стенки поперёк плоскости — не эта грань
    inside.add(t); avgN.add(tn);
    for(const dd of ds){ dMin = Math.min(dMin, dd); dMax = Math.max(dMax, dd); }
  }
  if(!inside.size) return fillLoop(loop); // внутри пусто — обычная заливка
  if(dMax - dMin < 0.02 && !loopFillPieces(loop)?.air.length){ warnTip('This contour is already a flat face'); return true; }
  const out = avgN.dot(n) >= 0 ? 1 : -1; // куда смотрят старые грани — наружу
  const nOut = n.clone().multiplyScalar(out);
  const loopOut = out > 0 ? loop : [...loop].reverse(); // обход против часовой вокруг nOut
  const bulge = out > 0 ? dMax : -dMin, dent = out > 0 ? -dMin : dMax;
  const snap = takeSnapshot();
  const closed = boundaryLoops().length === 0;
  try{
    if(closed){
      let body = [];
      for(let i=0;i<pos.length;i+=9)
        body.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]),
                   new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]),
                   new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
      if(bulge > 0.01) body = csgSubtract(body, buildPrismTris(loopOut, nOut, bulge + 1, 0));
      if(dent > 0.01) body = csgUnion(body, buildPrismTris(loopOut, nOut, 0, dent + 1));
      const q = x => Math.round(x*1000)/1000;
      const arr = [];
      for(const t of body){
        const ar = new THREE.Vector3().subVectors(t[1],t[0]).cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
        if(ar < 1e-6) continue;
        for(const vv of t) arr.push(q(vv.x), q(vv.y), q(vv.z));
      }
      pushHistory(snap);
      setMeshFromArray(new Float32Array(arr));
      healAfterBool();
    } else {
      pushHistory(snap);
      const keep = [];
      for(let t=0;t<pos.length/9;t++) if(!inside.has(t)) for(let k=0;k<9;k++) keep.push(pos[t*9+k]);
      // точки контура — ровно в плоскость (вместе с этими же вершинами соседей):
      // иначе треугольники заливки чуть не в одной плоскости и грань
      // распадается на выбираемые по отдельности куски
      const moved = new Map();
      for(let i=0;i<loop.length;i++){
        const dd = n.dot(loop[i]) - d0;
        if(Math.abs(dd) < 1e-5) continue;
        const P = loop[i].clone().addScaledVector(n, -dd);
        moved.set(keyOf(loop[i].x, loop[i].y, loop[i].z), P);
        loop[i] = P;
      }
      if(moved.size) for(let i=0;i<keep.length;i+=3){
        const P = moved.get(keyOf(keep[i], keep[i+1], keep[i+2]));
        if(P){ keep[i] = P.x; keep[i+1] = P.y; keep[i+2] = P.z; }
      }
      setMeshFromArray(new Float32Array(keep));
      extractEdges();
      const n0 = undoStack.length;
      const f = loopFillPieces(loop);
      if(!(f && f.covered && fillLoopAir(f))) fillLoop(loop);
      undoStack.length = Math.min(undoStack.length, n0); // одна запись истории на всё
      healAll(); // вершины соседей посреди сторон контура — сшить Т-стыки
    }
  }catch(err){
    console.warn('flat fill failed', err);
    applySnapshot(snap);
    warnTip('Flat fill failed on this contour');
    return true;
  }
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
  return true;
}
// удаление выбранной грани (ластик/Del в SketchUp): дырка в оболочке — норма,
// модель перестаёт быть замкнутой, пока дырку не закроют
function deleteFacePatch(){
  if(!ppPatch) return;
  pushUndo();
  const pos = mesh.geometry.attributes.position.array;
  const keep = [];
  for(let t=0;t<pos.length/9;t++){
    if(ppPatch.set.has(t)) continue;
    for(let j=0;j<9;j++) keep.push(pos[t*9+j]);
  }
  setMeshFromArray(new Float32Array(keep));
  ppPatch = null; hidePatch(); hideChordHint();
  extractEdges();
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
// триангуляция плоского (почти) контура отрезанием ушей — держит и Г-формы
function earClip(loop){
  const n = new THREE.Vector3(); // нормаль по Ньюэллу
  for(let i=0;i<loop.length;i++){
    const p=loop[i], q2=loop[(i+1)%loop.length];
    n.x += (p.y-q2.y)*(p.z+q2.z);
    n.y += (p.z-q2.z)*(p.x+q2.x);
    n.z += (p.x-q2.x)*(p.y+q2.y);
  }
  if(n.lengthSq() < 1e-12) return [];
  n.normalize();
  const u = (Math.abs(n.z)<0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize();
  const v = n.clone().cross(u);
  const pts = loop.map(p=>({p, x:p.dot(u), y:p.dot(v)}));
  const cross = (a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const idx = pts.map((_,i)=>i);
  const tris = [];
  let guard = idx.length*idx.length + 10;
  while(idx.length > 3 && guard-- > 0){
    let cut = false;
    for(let i=0;i<idx.length;i++){
      const A=pts[idx[(i+idx.length-1)%idx.length]], B=pts[idx[i]], C=pts[idx[(i+1)%idx.length]];
      if(cross(A,B,C) <= 1e-9) continue; // не ухо: вогнутый угол
      let ok = true;
      for(const j of idx){
        if(A===pts[j]||B===pts[j]||C===pts[j]) continue;
        const P=pts[j];
        if(cross(A,B,P)>=-1e-9 && cross(B,C,P)>=-1e-9 && cross(C,A,P)>=-1e-9){ ok=false; break; }
      }
      if(!ok) continue;
      tris.push([A.p,B.p,C.p]);
      idx.splice(i,1); cut = true; break;
    }
    if(!cut) break;
  }
  if(idx.length===3) tris.push([pts[idx[0]].p, pts[idx[1]].p, pts[idx[2]].p]);
  return tris;
}
// F — залить ближайшую к курсору дырку (Fill, как F в Blender)
function fillHole(){
  // край листа в воздухе (залитое кольцо) — не дырка: внутри уже грань
  const loops = boundaryLoops().filter(L => {
    const f = loopFillPieces(L);
    return !(f && f.covered && !f.air.length);
  });
  if(!loops.length) return false;
  let bestL = loops[0];
  if(loops.length > 1){
    const q = quadPos({clientX:lastMX, clientY:lastMY});
    let bd = 1e18;
    const P = {x:0,y:0,z:0};
    for(const L of loops){
      const c = L.reduce((s,p)=>s.add(p), new THREE.Vector3()).multiplyScalar(1/L.length);
      projToQuad(c, q.cam, q.w, q.h, P);
      const d = Math.hypot(P.x-q.mx, P.y-q.my);
      if(d < bd){ bd = d; bestL = L; }
    }
  }
  return fillLoop(bestL);
}

// ---------- выбор рёбер Ctrl+кликом (как во FreeCAD/SketchUp) ----------
// замкнулся контур — показываем «стеклянную» грань-предпросмотр и F заливает
let edgeSel = [], selPreview = null, selLabel = null;
function edgeSelKey(ch){
  const a = ch.pts[0], b = ch.pts[ch.pts.length-1], m = ch.pts[Math.floor(ch.pts.length/2)];
  const k1 = keyOf(a.x,a.y,a.z), k2 = keyOf(b.x,b.y,b.z);
  return (k1<k2 ? k1+'|'+k2 : k2+'|'+k1) + '|' + keyOf(m.x,m.y,m.z);
}
function killSelPreview(){
  if(selPreview){ scene.remove(selPreview); selPreview.geometry.dispose(); selPreview = null; }
  if(selLabel){
    scene.remove(selLabel);
    selLabel.geometry.dispose();
    selLabel.material.map.dispose();
    selLabel.material.dispose();
    selLabel = null;
  }
}
function clearEdgeSel(){
  if(typeof selCardHi !== 'undefined') unhiSelGroup();
  for(const s of edgeSel){ scene.remove(s.line); s.line.geometry.dispose(); }
  edgeSel = [];
  syncGuideOverlays();
  killSelPreview();
  hideSelEnds();
  if(vpEdge){ vpEdge = null; vpanel.hidden = true; } // окно G,V ребра живёт, пока живо ребро
}
function toggleEdgeSel(ch){
  // выбор взаимоисключающий: рёбра снимают выбор грани и точки
  deselect();
  hidePatch(); ppPatch = null;
  const key = edgeSelKey(ch);
  const i = edgeSel.findIndex(s=>s.key===key);
  if(i>=0){
    scene.remove(edgeSel[i].line); edgeSel[i].line.geometry.dispose();
    edgeSel.splice(i,1);
  } else {
    const g = new THREE.BufferGeometry().setFromPoints(ch.pts);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({color:C_SEL}));
    scene.add(l);
    edgeSel.push({pts: ch.pts.map(p=>p.clone()), key, line:l, isGuide: !!ch.isGuide});
  }
  syncGuideOverlays();
  updateSelPreview();
}
// выбранные рёбра сцепляются в один замкнутый цикл? -> точки контура
function edgeSelLoop(){
  if(edgeSel.length < 2) return null;
  const K = p => keyOf(p.x,p.y,p.z);
  const segs = edgeSel.map(s=>({a:s.pts[0], b:s.pts[s.pts.length-1], pts:s.pts, used:false}));
  const deg = new Map();
  for(const s of segs){ deg.set(K(s.a),(deg.get(K(s.a))||0)+1); deg.set(K(s.b),(deg.get(K(s.b))||0)+1); }
  for(const d of deg.values()) if(d!==2) return null;
  const loop = [];
  let cur = segs[0]; cur.used = true;
  loop.push(...cur.pts.slice(0,-1));
  const startK = K(cur.a);
  let endK = K(cur.b), usedCount = 1;
  while(endK !== startK){
    const nx = segs.find(s=>!s.used && (K(s.a)===endK || K(s.b)===endK));
    if(!nx) return null;
    nx.used = true; usedCount++;
    const ordered = K(nx.a)===endK ? nx.pts : [...nx.pts].reverse();
    loop.push(...ordered.slice(0,-1));
    endK = K(ordered[ordered.length-1]);
  }
  return usedCount === segs.length ? loop : null; // куски вне цикла — не контур
}
// Контур уже закрыт гранью? Берём точки заведомо внутри контура (центры
// его триангуляции) и ищем треугольник сетки в той же плоскости, который
// их накрывает. Если есть — заливать нечего, «стекло» с F не предлагаем
function loopAlreadyFilled(loop){
  const tris = earClip(loop);
  if(!tris.length || !mesh) return false;
  const n = new THREE.Vector3().subVectors(tris[0][1], tris[0][0])
    .cross(new THREE.Vector3().subVectors(tris[0][2], tris[0][0]));
  if(n.lengthSq() < 1e-12) return false;
  n.normalize();
  const d0 = n.dot(loop[0]);
  const samples = tris.map(t => t[0].clone().add(t[1]).add(t[2]).multiplyScalar(1/3));
  const pos = mesh.geometry.attributes.position.array;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const side = (P, Q, R) => new THREE.Vector3().subVectors(Q, P).cross(new THREE.Vector3().subVectors(R, P)).dot(n);
  for(let i=0;i<pos.length;i+=9){
    A.set(pos[i],pos[i+1],pos[i+2]); B.set(pos[i+3],pos[i+4],pos[i+5]); C.set(pos[i+6],pos[i+7],pos[i+8]);
    if(Math.abs(n.dot(A)-d0) > 0.02 || Math.abs(n.dot(B)-d0) > 0.02 || Math.abs(n.dot(C)-d0) > 0.02) continue;
    const area = side(A, B, C);
    if(Math.abs(area) < 1e-9) continue;
    for(const P of samples){
      const c1 = side(A, B, P), c2 = side(B, C, P), c3 = side(C, A, P);
      if(area > 0 ? (c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6)
                  : (c1 <= 1e-6 && c2 <= 1e-6 && c3 <= 1e-6)) return true;
    }
  }
  return false;
}
// Заливка контура, который частично лежит на грани (круг, вылезший за край
// верхней грани куба): заливается только пустое место — как грань в
// SketchUp, замкнутая дугой и ребром грани. Круг режется по границе
// копланарной области (ребра, у которых там одна грань), куски, центр
// которых на грани, отбрасываются. Рёбра квадрата остаются на стыке видимыми.
// Возвращает {air: [[V3...]], covered: число кусков на грани, n: нормаль грани}
function loopFillPieces(loop){
  const tris = earClip(loop);
  if(!tris.length || !mesh) return null;
  const n = new THREE.Vector3();
  for(let i=0;i<loop.length;i++){
    const a=loop[i], b=loop[(i+1)%loop.length];
    n.x += (a.y-b.y)*(a.z+b.z); n.y += (a.z-b.z)*(a.x+b.x); n.z += (a.x-b.x)*(a.y+b.y);
  }
  if(n.lengthSq() < 1e-12) return null;
  n.normalize();
  const d0 = n.dot(loop[0]);
  const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize();
  const v = n.clone().cross(u);
  const to2 = P => ({x: P.dot(u), y: P.dot(v)});
  const to3 = q => u.clone().multiplyScalar(q.x).addScaledVector(v, q.y).addScaledVector(n, d0);
  // граница копланарной области сетки
  const pos = mesh.geometry.attributes.position.array;
  const cnt = new Map();
  let faceN = null;
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    let ok = true;
    for(let j=0;j<3;j++)
      if(Math.abs(n.x*pos[o+j*3] + n.y*pos[o+j*3+1] + n.z*pos[o+j*3+2] - d0) > 0.02){ ok = false; break; }
    if(!ok) continue;
    const tn = triNormalAt(t);
    if(Math.abs(tn.dot(n)) < 0.999) continue;
    if(!faceN) faceN = tn.dot(n) > 0 ? n.clone() : n.clone().negate();
    for(let e=0;e<3;e++){
      const o1 = o+e*3, o2 = o+((e+1)%3)*3;
      const k1 = keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2 = keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      const r = cnt.get(ek);
      if(r) r.c++;
      else cnt.set(ek, {c:1, a: to2(new THREE.Vector3(pos[o1],pos[o1+1],pos[o1+2])),
                              b: to2(new THREE.Vector3(pos[o2],pos[o2+1],pos[o2+2]))});
    }
  }
  const cuts = [...cnt.values()].filter(r => r.c === 1);
  let polys = tris.map(t => t.map(to2));
  for(const c of cuts){
    const dx = c.b.x - c.a.x, dy = c.b.y - c.a.y, L = Math.hypot(dx, dy);
    if(L < 1e-9) continue;
    const mnx = Math.min(c.a.x, c.b.x), mxx = Math.max(c.a.x, c.b.x);
    const mny = Math.min(c.a.y, c.b.y), mxy = Math.max(c.a.y, c.b.y);
    const next = [];
    for(const poly of polys){
      let px0=1e9, px1=-1e9, py0=1e9, py1=-1e9;
      for(const q of poly){ px0=Math.min(px0,q.x); px1=Math.max(px1,q.x); py0=Math.min(py0,q.y); py1=Math.max(py1,q.y); }
      if(px1 < mnx-1e-6 || px0 > mxx+1e-6 || py1 < mny-1e-6 || py0 > mxy+1e-6){ next.push(poly); continue; }
      const sd = poly.map(q => ((q.x-c.a.x)*dy - (q.y-c.a.y)*dx) / L);
      if(!sd.some(x => x > 1e-6) || !sd.some(x => x < -1e-6)){ next.push(poly); continue; }
      const f = [], b = [];
      for(let i=0;i<poly.length;i++){
        const j = (i+1) % poly.length, si = sd[i], sj = sd[j];
        if(si >= -1e-6) f.push(poly[i]);
        if(si <= 1e-6) b.push(poly[i]);
        if((si > 1e-6 && sj < -1e-6) || (si < -1e-6 && sj > 1e-6)){
          const t = si / (si - sj);
          const X = {x: poly[i].x + (poly[j].x-poly[i].x)*t, y: poly[i].y + (poly[j].y-poly[i].y)*t};
          f.push(X); b.push(X);
        }
      }
      if(f.length >= 3) next.push(f);
      if(b.length >= 3) next.push(b);
    }
    polys = next;
  }
  const test = getFaceTester();
  const air = [];
  let covered = 0;
  for(const poly of polys){
    const c = poly.reduce((s, q) => ({x: s.x + q.x/poly.length, y: s.y + q.y/poly.length}), {x:0, y:0});
    let area = 0;
    for(let i=0;i<poly.length;i++){ const a = poly[i], b = poly[(i+1)%poly.length]; area += a.x*b.y - b.x*a.y; }
    if(Math.abs(area) < 1e-8) continue;
    if(test(to3(c))) covered++;
    else air.push(poly.map(to3));
  }
  return {air, covered, n, faceN};
}
// залить только пустые куски; ориентация — как у грани, к которой примыкают
function fillLoopAir(info){
  if(!info || !info.air.length) return false;
  const flip = info.faceN && info.faceN.dot(info.n) < 0;
  const pos = mesh.geometry.attributes.position.array;
  const q = x => Math.round(x*1000)/1000;
  const add = [];
  for(const poly of info.air)
    for(let i=1;i+1<poly.length;i++){
      const tri = flip ? [poly[0], poly[i+1], poly[i]] : [poly[0], poly[i], poly[i+1]];
      for(const P of tri) add.push(q(P.x), q(P.y), q(P.z));
    }
  pushUndo();
  // Стык с ребром грани: точки кусков лежат посреди рёбер квадрата, у
  // которых уже по две грани (верх и бок) — лечилка Т-стыков берёт только
  // граничные рёбра. Поэтому здесь все треугольники, на ребре которых лежит
  // новая точка, делятся явно — иначе вдоль стыка остаются щели
  const pts = [];
  { const seen = new Set();
    for(let i=0;i<add.length;i+=3){
      const k = keyOf(add[i], add[i+1], add[i+2]);
      if(!seen.has(k)){ seen.add(k); pts.push([add[i], add[i+1], add[i+2]]); }
    } }
  const queue = [];
  const all = [...pos, ...add];
  for(let i=0;i<all.length;i+=9) queue.push(all.slice(i, i+9));
  const out = [];
  let guard = 200000;
  while(queue.length && guard-- > 0){
    const T = queue.pop();
    let done = false;
    for(let e=0;e<3 && !done;e++){
      const A = [T[e*3], T[e*3+1], T[e*3+2]], b = (e+1)%3, c = (e+2)%3;
      const B = [T[b*3], T[b*3+1], T[b*3+2]];
      const ab = [B[0]-A[0], B[1]-A[1], B[2]-A[2]];
      const L2 = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
      if(L2 < 1e-9) continue;
      for(const v of pts){
        const tp = ((v[0]-A[0])*ab[0] + (v[1]-A[1])*ab[1] + (v[2]-A[2])*ab[2]) / L2;
        if(tp <= 1e-4 || tp >= 1-1e-4) continue;
        if(Math.hypot(v[0]-A[0]-ab[0]*tp, v[1]-A[1]-ab[1]*tp, v[2]-A[2]-ab[2]*tp) > 0.002) continue;
        const C = [T[c*3], T[c*3+1], T[c*3+2]];
        queue.push([...A, ...v, ...C], [...v, ...B, ...C]);
        done = true; break;
      }
    }
    if(!done) out.push(...T);
  }
  setMeshFromArray(new Float32Array(out));
  weldVertices(0.0015);
  cleanupMesh();
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
  return true;
}
function updateSelPreview(){
  killSelPreview();
  hideChordHint();
  const loop = edgeSelLoop();
  if(!loop) return;
  const fill = loopFillPieces(loop);
  if(fill && fill.covered && !fill.air.length) return; // грань уже есть — заливать нечего
  // «стекло» — только там, где F действительно зальёт
  const tris = fill && fill.covered
    ? fill.air.flatMap(poly => poly.slice(1, -1).map((P, i) => [poly[0], P, poly[i+2]]))
    : earClip(loop);
  if(!tris.length) return;
  // «стекло»: еле заметная плёнка — место, которое можно залить
  const arr = new Float32Array(tris.length*9);
  let o = 0;
  for(const t of tris) for(const p of t){ arr[o++]=p.x; arr[o++]=p.y; arr[o++]=p.z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr,3));
  selPreview = new THREE.Mesh(g, new THREE.MeshBasicMaterial(
    {color:0xbfe8ff, transparent:true, opacity:0.18, side:THREE.DoubleSide, depthWrite:false}));
  scene.add(selPreview);
  if(hintsChk.checked){
    // прямо на «стекле» — клавиша-кейкап F и подпись Fill face (вдвое мельче)
    const cnv = document.createElement('canvas'); cnv.width = cnv.height = 256;
    const cx = cnv.getContext('2d');
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.lineWidth = 7; cx.strokeStyle = '#eaf4ff'; cx.fillStyle = '#eaf4ff';
    cx.shadowColor = 'rgba(10,14,20,0.9)'; cx.shadowBlur = 8;
    const r = 14, x0 = 78, y0 = 40, w = 100; // рамка клавиши
    cx.beginPath();
    cx.moveTo(x0+r, y0); cx.arcTo(x0+w, y0, x0+w, y0+w, r);
    cx.arcTo(x0+w, y0+w, x0, y0+w, r); cx.arcTo(x0, y0+w, x0, y0, r);
    cx.arcTo(x0, y0, x0+w, y0, r); cx.closePath(); cx.stroke();
    cx.font = '700 64px system-ui,sans-serif';
    cx.fillText('F', 128, y0 + w/2 + 3);
    cx.font = '700 34px system-ui,sans-serif';
    cx.fillText('Fill face', 128, 202);
    const tex = new THREE.CanvasTexture(cnv);
    // базис грани: подпись лежит в её плоскости, «верх» текста — к +Z мира
    const c = loop.reduce((s,p)=>s.add(p), new THREE.Vector3()).multiplyScalar(1/loop.length);
    const nn = new THREE.Vector3();
    for(let i=0;i<loop.length;i++){
      const p=loop[i], q2=loop[(i+1)%loop.length];
      nn.x += (p.y-q2.y)*(p.z+q2.z); nn.y += (p.z-q2.z)*(p.x+q2.x); nn.z += (p.x-q2.x)*(p.y+q2.y);
    }
    nn.normalize();
    if(nn.dot(new THREE.Vector3().subVectors(persp.position, c)) < 0) nn.negate();
    const helper = Math.abs(nn.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0);
    const vv = helper.clone().addScaledVector(nn, -helper.dot(nn)).normalize();
    const uu = new THREE.Vector3().crossVectors(vv, nn);
    // размер — от габаритов контура, чтобы влезало и на маленькую грань
    let mnU=1e9, mxU=-1e9, mnV=1e9, mxV=-1e9;
    for(const p of loop){
      const a=p.dot(uu), b=p.dot(vv);
      if(a<mnU)mnU=a; if(a>mxU)mxU=a; if(b<mnV)mnV=b; if(b>mxV)mxV=b;
    }
    const size = Math.max(4, Math.min(mxU-mnU, mxV-mnV) * 0.6);
    selLabel = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false}));
    selLabel.setRotationFromMatrix(new THREE.Matrix4().makeBasis(uu, vv, nn));
    selLabel.position.copy(c).addScaledVector(nn, 0.15);
    scene.add(selLabel);
  }
  if(hintsChk.checked){
    const vr = view.getBoundingClientRect();
    chordHint.innerHTML =
      '<div>Closed contour · <span class="key">F</span> — fill face</div>' +
      '<div><span class="key">Shift+F</span> — one flat face: replace what’s inside</div>' +
      '<div style="opacity:.55">Esc — deselect</div>';
    chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 380) + 'px';
    chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 150) + 'px';
    chordHint.hidden = false;
    clearTimeout(showChordHint._t);
    showChordHint._t = setTimeout(hideChordHint, 4000);
  }
}
// заливка контура: ориентация — рёбра новой грани против существующих
function fillLoop(loop){
  const pos = mesh.geometry.attributes.position.array;
  const dirSet = new Set();
  for(let t=0;t<pos.length/9;t++) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    dirSet.add(keyOf(pos[o1],pos[o1+1],pos[o1+2])+'>'+keyOf(pos[o2],pos[o2+1],pos[o2+2]));
  }
  let same=0, opp=0;
  for(let i=0;i<loop.length;i++){
    const a=loop[i], b=loop[(i+1)%loop.length];
    const ka=keyOf(a.x,a.y,a.z), kb=keyOf(b.x,b.y,b.z);
    if(dirSet.has(ka+'>'+kb)) same++;
    if(dirSet.has(kb+'>'+ka)) opp++;
  }
  const tris = earClip(same>opp ? [...loop].reverse() : loop);
  if(!tris.length) return false;
  pushUndo();
  const arr = new Float32Array(pos.length + tris.length*9);
  arr.set(pos);
  let o = pos.length;
  for(const t of tris) for(const p of t){ arr[o++]=p.x; arr[o++]=p.y; arr[o++]=p.z; }
  setMeshFromArray(arr);
  extractEdges();
  return true;
}

// точное выдавливание выбранной грани: + наружу (pad), − внутрь (pocket)
const exPopup = document.getElementById('exPopup'), ex_val = document.getElementById('ex_val');
// Выдавливание по-скетчаповски: контур лоскута дублируется, по границе
// добавляются стенки нулевой высоты, и двигаются ТОЛЬКО вершины лоскута
// и верхние копии стенок — соседние области и линии остаются на месте.
// Возвращает список индексов (offset координаты x) движущихся вершин.
function beginPatchExtrude(patch){
  const pos = mesh.geometry.attributes.position.array;
  const cnt = new Map();
  for(const t of patch.tris){
    for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      const r = cnt.get(ek);
      if(r) r.n++;
      else cnt.set(ek, {n:1, a:[pos[o1],pos[o1+1],pos[o1+2]], b:[pos[o2],pos[o2+1],pos[o2+2]]});
    }
  }
  const walls = [...cnt.values()].filter(r=>r.n===1);
  const arr = new Float32Array(pos.length + walls.length*36);
  arr.set(pos);
  const idx = [], fac = [];
  for(const t of patch.tris) for(let k=0;k<9;k+=3){ idx.push(t*9+k); fac.push(1); }
  let o = pos.length;
  const put = (x,y,z,f)=>{ arr[o]=x; arr[o+1]=y; arr[o+2]=z;
    if(f){ idx.push(o); fac.push(f); } o += 3; };
  for(const w of walls){
    // стенка-квад веером через центр (центр едет на полдистанции): прямое
    // и обратное выдавливание дают совпадающие треугольники противоположной
    // ориентации — cleanupMesh их схлопнет, как «заживление» в SketchUp
    const [ax,ay,az] = w.a, [bx,by,bz] = w.b;
    const mx=(ax+bx)/2, my=(ay+by)/2, mz=(az+bz)/2;
    put(ax,ay,az,0); put(bx,by,bz,0); put(mx,my,mz,0.5);
    put(bx,by,bz,0); put(bx,by,bz,1); put(mx,my,mz,0.5);
    put(bx,by,bz,1); put(ax,ay,az,1); put(mx,my,mz,0.5);
    put(ax,ay,az,1); put(ax,ay,az,0); put(mx,my,mz,0.5);
  }
  setMeshFromArray(arr); // треугольники лоскута остались на своих индексах
  return {idx, fac};
}

// уборка после выдавливания: вырожденные треугольники и «нулевые пары»
// (совпадающие треугольники противоположной ориентации — внутренние
// перегородки от выдавливания туда-обратно) удаляются
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
function healTJunctions(){
  for(let guard=0; guard<16; guard++){
    const pos = mesh.geometry.attributes.position.array;
    const nT = pos.length/9;
    const verts = new Map();
    for(let i=0;i<pos.length;i+=3)
      verts.set(keyOf(pos[i],pos[i+1],pos[i+2]), [pos[i],pos[i+1],pos[i+2]]);
    const cnt = new Map();
    for(let t=0;t<nT;t++) for(let e=0;e<3;e++){
      const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
      const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
      const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
      cnt.set(ek,(cnt.get(ek)||0)+1);
    }
    let split = null; // {t, e, v}
    outer:
    for(let t=0;t<nT;t++){
      for(let e=0;e<3;e++){
        const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
        const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
        const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
        if(cnt.get(ek) !== 1) continue; // только граничные
        const A=[pos[o1],pos[o1+1],pos[o1+2]], B=[pos[o2],pos[o2+1],pos[o2+2]];
        const ab=[B[0]-A[0],B[1]-A[1],B[2]-A[2]];
        const L2 = ab[0]*ab[0]+ab[1]*ab[1]+ab[2]*ab[2];
        if(L2 < 1e-9) continue;
        for(const [k, v] of verts){
          if(k===k1 || k===k2) continue;
          const tp = ((v[0]-A[0])*ab[0]+(v[1]-A[1])*ab[1]+(v[2]-A[2])*ab[2])/L2;
          if(tp <= 1e-3 || tp >= 1-1e-3) continue;
          const qx=A[0]+ab[0]*tp, qy=A[1]+ab[1]*tp, qz=A[2]+ab[2]*tp;
          if(Math.hypot(v[0]-qx, v[1]-qy, v[2]-qz) > 0.01) continue;
          split = {t, e, v};
          break outer;
        }
      }
    }
    if(!split) break;
    // делим треугольник по точке на ребре
    const {t, e, v} = split;
    const o = t*9;
    const V = [[pos[o],pos[o+1],pos[o+2]],[pos[o+3],pos[o+4],pos[o+5]],[pos[o+6],pos[o+7],pos[o+8]]];
    const a = e, b = (e+1)%3, c = (e+2)%3;
    const out = new Float32Array(pos.length + 9);
    out.set(pos.subarray(0, o));
    out.set([...V[a], ...v, ...V[c],  ...v, ...V[b], ...V[c]], o);
    out.set(pos.subarray(o+9), o+18);
    setMeshFromArray(out);
  }
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

// ---------- свои булевы операции (классический BSP, по мотивам csg.js) ----
// «прорезать насквозь» считается прямо в браузере — движок самодостаточен
const CSG_EPS = 1e-5;
function csgPlane(a,b,c){
  const n = new THREE.Vector3().subVectors(b,a)
    .cross(new THREE.Vector3().subVectors(c,a));
  const L = n.length();
  if(L < 1e-12) return null;
  n.multiplyScalar(1/L);
  return {n, w: n.dot(a)};
}
function csgPoly(verts){
  const p = csgPlane(verts[0], verts[1], verts[2]);
  if(!p) return null;
  // площадь исходного треугольника: мерило, насколько надёжна его плоскость
  const a = new THREE.Vector3().subVectors(verts[1], verts[0])
    .cross(new THREE.Vector3().subVectors(verts[2], verts[0])).length();
  return {v: verts, p, a};
}
function csgSplit(plane, poly, cofront, coback, front, back){
  const COP=0, FRONT=1, BACK=2, SPAN=3;
  let type = 0; const types = [];
  for(const v of poly.v){
    const t = plane.n.dot(v) - plane.w;
    const ty = t < -CSG_EPS ? BACK : (t > CSG_EPS ? FRONT : COP);
    type |= ty; types.push(ty);
  }
  if(type === COP){ (plane.n.dot(poly.p.n) > 0 ? cofront : coback).push(poly); }
  else if(type === FRONT){ front.push(poly); }
  else if(type === BACK){ back.push(poly); }
  else {
    const f=[], b=[];
    for(let i=0;i<poly.v.length;i++){
      const j=(i+1)%poly.v.length;
      const ti=types[i], tj=types[j], vi=poly.v[i], vj=poly.v[j];
      if(ti !== BACK) f.push(vi);
      if(ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
      if((ti|tj) === SPAN){
        const t = (plane.w - plane.n.dot(vi)) /
          plane.n.dot(new THREE.Vector3().subVectors(vj, vi));
        const v = vi.clone().lerp(vj, t);
        f.push(v); b.push(v.clone());
      }
    }
    // куски наследуют плоскость родителя: пересчёт по первым трём вершинам
    // на тонком осколке (вершины почти на одной прямой) давал перекошенную
    // плоскость, и такой осколок потом резал соседей криво — грани
    // скругления расползались на треугольники с изломом в несколько градусов
    const inherit = vs => ({v: vs, p: {n: poly.p.n.clone(), w: poly.p.w}, a: poly.a});
    if(f.length >= 3) front.push(inherit(f));
    if(b.length >= 3) back.push(inherit(b));
  }
}
function csgNode(polys){
  const n = {plane:null, front:null, back:null, polys:[]};
  if(polys && polys.length) csgBuild(n, polys);
  return n;
}
function csgBuild(node, polys){
  const stack = [[node, polys]];
  while(stack.length){
    const [nd, ps] = stack.pop();
    if(!ps.length) continue;
    if(!nd.plane){
      // секущая плоскость узла — от самого крупного многоугольника, а не от
      // первого: плоскость осколка-иглы определена плохо и режет всё дерево
      let best = ps[0];
      for(const q of ps) if(q.a > best.a) best = q;
      nd.plane = {n: best.p.n.clone(), w: best.p.w};
    }
    const front=[], back=[];
    for(const p of ps) csgSplit(nd.plane, p, nd.polys, nd.polys, front, back);
    if(front.length){ if(!nd.front) nd.front = csgNode(); stack.push([nd.front, front]); }
    if(back.length){ if(!nd.back) nd.back = csgNode(); stack.push([nd.back, back]); }
  }
}
function csgClipPolys(node, polys){
  const out = [];
  const stack = [[node, polys]];
  while(stack.length){
    const [nd, ps] = stack.pop();
    if(!ps.length) continue;
    if(!nd.plane){ for(const p of ps) out.push(p); continue; }
    const front=[], back=[];
    for(const p of ps) csgSplit(nd.plane, p, front, back, front, back);
    if(nd.front) stack.push([nd.front, front]);
    else for(const p of front) out.push(p);
    if(nd.back) stack.push([nd.back, back]); // без задней ветви всё отсекается
  }
  return out;
}
function csgClipTo(node, bsp){
  const stack = [node];
  while(stack.length){
    const nd = stack.pop();
    nd.polys = csgClipPolys(bsp, nd.polys);
    if(nd.front) stack.push(nd.front);
    if(nd.back) stack.push(nd.back);
  }
}
function csgAllPolys(node, out){
  const stack = [node];
  while(stack.length){
    const nd = stack.pop();
    for(const p of nd.polys) out.push(p);
    if(nd.front) stack.push(nd.front);
    if(nd.back) stack.push(nd.back);
  }
  return out;
}
function csgInvert(node){
  const stack = [node];
  while(stack.length){
    const nd = stack.pop();
    for(const p of nd.polys){ p.v.reverse(); p.p.n.negate(); p.p.w = -p.p.w; }
    if(nd.plane){ nd.plane.n.negate(); nd.plane.w = -nd.plane.w; }
    const tmp = nd.front; nd.front = nd.back; nd.back = tmp;
    if(nd.front) stack.push(nd.front);
    if(nd.back) stack.push(nd.back);
  }
}
// A минус B; входы — массивы треугольников [V3,V3,V3]
// объединение A∪B тем же BSP (порядок клипов — как union в csg.js);
// нужно 3D-тексту: срастить призмы букв в одно тело без внутренних стенок
// Треугольники тела A разделяются по габариту B: те, что целиком вне его
// (с запасом), заведомо снаружи B и идут в результат нетронутыми. Раньше
// бесконечные плоскости B резали их по всей модели (хорда на ободе колеса
// рассекала крышки насквозь), пересчитанные вершины уезжали на 0.002 мм от
// соседей — и после второго выреза в сетке оставались десятки дыр.
// Классифицирует B по-прежнему полное дерево A (его узлы те же, что у
// обрезанного в csg.js: clipTo меняет полигоны, не плоскости), но осколки
// этого дерева в результат не попадают
function csgSplitByBox(aTris, bTris){
  const box = new THREE.Box3();
  for(const t of bTris) for(const v of t) box.expandByPoint(v);
  box.expandByScalar(0.05);
  const near = [], far = [];
  const tb = new THREE.Box3();
  for(const t of aTris){
    tb.makeEmpty(); tb.expandByPoint(t[0]); tb.expandByPoint(t[1]); tb.expandByPoint(t[2]);
    (tb.intersectsBox(box) ? near : far).push(t);
  }
  return {near, far};
}
const csgMk = ts => ts.map(t=>csgPoly([t[0].clone(),t[1].clone(),t[2].clone()])).filter(Boolean);
function csgFan(polys, out){ // полигон -> веер треугольников
  for(const p of polys)
    for(let i=2;i<p.v.length;i++) out.push([p.v[0], p.v[i-1], p.v[i]]);
  return out;
}
// Второе тело из нескольких далёких кусков (Ctrl+I выбрал шесть сегментов по
// ободу) целиком снова накрывает габаритом всю модель — локальность не
// работает, и швы у обода расходились (102 дыры). Куски, чьи габариты не
// соприкасаются, обрабатываются по очереди, каждый локально; соседние
// (буквы текста) остаются одной группой
function csgClusters(tris){
  const par = tris.map((_, i) => i);
  const root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
  const byKey = new Map();
  tris.forEach((t, i) => { for(const v of t){ const k = keyOf(v.x, v.y, v.z); const j = byKey.get(k); if(j === undefined) byKey.set(k, i); else { const a = root(i), b = root(j); if(a !== b) par[a] = b; } } });
  const comps = new Map();
  tris.forEach((t, i) => { const r = root(i); if(!comps.has(r)) comps.set(r, []); comps.get(r).push(t); });
  let groups = [...comps.values()].map(ts => { const box = new THREE.Box3(); for(const t of ts) for(const v of t) box.expandByPoint(v); return {ts, box: box.expandByScalar(0.5)}; });
  for(let merged = true; merged && groups.length > 1;){ // сливаем группы с пересекающимися габаритами
    merged = false;
    outer: for(let i=0;i<groups.length;i++) for(let j=i+1;j<groups.length;j++){
      if(groups[i].box.intersectsBox(groups[j].box)){
        groups[i].ts.push(...groups[j].ts); groups[i].box.union(groups[j].box); groups.splice(j, 1); merged = true; break outer;
      }
    }
  }
  return groups.map(g => g.ts);
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
let lastBoolPath = '';
// после булевой: лечилки (сварка, Т-стыки, трещины — секунды на крупной
// сетке) нужны, только если в сетке остались щели или рёбра с 3+ гранями;
// точный результат обычно чист — хватает чистки вырожденных треугольников
function healAfterBool(){
  cleanupMesh();
  if(openEdgeCount() === 0 && nonManifoldEdgeCount() === 0) return;
  healAll();
} // 'exact' | 'bsp' — для отладки и тестов
function exactBool(aTris, bTris, op){
  try{
    if(!aTris.length || !bTris.length) return null;
    if(openEdgesOfTris(aTris) || openEdgesOfTris(bTris)) return null;
    const arr = meshBoolean(aTris, bTris, op), tris = [];
    for(let i=0;i<arr.length;i+=9)
      tris.push([new THREE.Vector3(arr[i],arr[i+1],arr[i+2]), new THREE.Vector3(arr[i+3],arr[i+4],arr[i+5]),
                 new THREE.Vector3(arr[i+6],arr[i+7],arr[i+8])]);
    if(openEdgesOfTris(tris)) return null;
    return tris;
  }catch(err){ console.warn('exact boolean failed, falling back to BSP:', err.message); return null; }
}
function csgUnion(aTris, bTris){
  const ex = exactBool(aTris, bTris, 'union');
  lastBoolPath = ex ? 'exact' : 'bsp';
  if(ex) return ex;
  const groups = csgClusters(bTris);
  if(groups.length > 1){ let cur = aTris; for(const g of groups) cur = csgUnionOne(cur, g); return cur; }
  return csgUnionOne(aTris, bTris);
}
function csgSubtract(aTris, bTris){
  const ex = exactBool(aTris, bTris, 'subtract');
  lastBoolPath = ex ? 'exact' : 'bsp';
  if(ex) return ex;
  const groups = csgClusters(bTris);
  if(groups.length > 1){ let cur = aTris; for(const g of groups) cur = csgSubtractOne(cur, g); return cur; }
  return csgSubtractOne(aTris, bTris);
}
function csgUnionOne(aTris, bTris){
  const {near, far} = csgSplitByBox(aTris, bTris);
  const aAll = csgNode(csgMk(aTris)), aN = csgNode(csgMk(near)), b = csgNode(csgMk(bTris));
  csgClipTo(aN, b);
  csgClipTo(b, aAll);
  csgInvert(b);
  csgClipTo(b, aAll);
  csgInvert(b);
  const out = far.map(t => [t[0].clone(), t[1].clone(), t[2].clone()]);
  csgFan(csgAllPolys(aN, []), out);
  return csgFan(csgAllPolys(b, []), out);
}
function csgSubtractOne(aTris, bTris){
  const {near, far} = csgSplitByBox(aTris, bTris);
  const aAll = csgNode(csgMk(aTris)), aN = csgNode(csgMk(near)), b = csgNode(csgMk(bTris));
  csgInvert(aAll); csgInvert(aN);
  csgClipTo(aN, b);
  csgClipTo(b, aAll);
  csgInvert(b);
  csgClipTo(b, aAll);
  csgInvert(b);
  csgInvert(aN); // A — обратно наружу; B — вывернуть: стенки выреза смотрят внутрь выреза
  csgInvert(b);
  const out = far.map(t => [t[0].clone(), t[1].clone(), t[2].clone()]);
  csgFan(csgAllPolys(aN, []), out);
  return csgFan(csgAllPolys(b, []), out);
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
    if(TA.length && inside(cen(TA[0]), TB)) return new Float32Array(op === 'union' ? shell(TB) : []);
    const par = TB.map((_, i) => i), root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
    const byV = new Map();
    TB.forEach((t, i) => { for(const v of t){ const j = byV.get(v); if(j === undefined) byV.set(v, i); else { const r1 = root(i), r2 = root(j); if(r1 !== r2) par[r1] = r2; } } });
    const comps = new Map(); TB.forEach((t, i) => { const r = root(i); if(!comps.has(r)) comps.set(r, []); comps.get(r).push(t); });
    let out = shell(TA);
    for(const c of comps.values()){
      const inA = inside(cen(c[0]), TA);
      if(op === 'union' && !inA) out = out.concat(shell(c));
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
        out.push([G[idx[(cut-1+idx.length)%idx.length]], G[idx[cut]], G[idx[(cut+1)%idx.length]]]);
        idx.splice(cut, 1);
      }
      if(idx.length === 3) out.push([G[idx[0]], G[idx[1]], G[idx[2]]]);
      else if(idx.length > 3){
        // застрял на щепке уже EPS (точки почти на одной прямой, любое ухо
        // перекрыто соседней точкой): веер — топологически замкнут, ширина
        // и так нулевая
        let per = 0; for(let i=0;i<idx.length;i++){ const p = X[idx[i]], q = X[idx[(i+1)%idx.length]]; per += Math.hypot(q[0]-p[0], q[1]-p[1]); }
        if(Math.abs(area(idx)) > EPS * per) throw new Error('could not triangulate an intersected triangle');
        for(let i=1;i+1<idx.length;i++) out.push([G[idx[0]], G[idx[i]], G[idx[i+1]]]);
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
    if(op === 'union') k = !inOther;
    else { if(fr.side === 0) k = !inOther; else { k = inOther; fl = true; } }
    for(const i of list){ keep[i] = k; flip[i] = fl; }
  }
  frags.forEach((fr, i) => {
    const st = onState[i]; if(!st) return;
    // объединение: попутные — одна грань (от A), встречные — исчезают;
    // вычитание: грань A остаётся только там, где B подходит к ней встречно
    if(op === 'union') keep[i] = st === 'same' && fr.side === 0;
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

// внешний контур лоскута по снимку (до предпросмотрных стенок):
// направленные граничные рёбра сцепляются в CCW-петлю вокруг нормали
function patchOutlineLoop(pos, trisIdx){
  const cnt = new Map();
  for(const t of trisIdx) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    const r = cnt.get(ek);
    if(r) r.n++;
    else cnt.set(ek, {n:1, ka:k1, kb:k2,
      a:new THREE.Vector3(pos[o1],pos[o1+1],pos[o1+2]),
      b:new THREE.Vector3(pos[o2],pos[o2+1],pos[o2+2])});
  }
  const nxt = new Map();
  let edges = 0;
  for(const r of cnt.values()) if(r.n===1){ nxt.set(r.ka, r); edges++; }
  const first = nxt.values().next().value;
  if(!first) return null;
  const loop = [];
  let cur = first, guard = edges + 2;
  const startK = cur.ka;
  while(guard-- > 0){
    loop.push(cur.a.clone());
    if(cur.kb === startK) // замкнулись; несколько петель (дырки) — отказ
      return (loop.length >= 3 && loop.length === edges) ? loop : null;
    cur = nxt.get(cur.kb);
    if(!cur) return null;
  }
  return null;
}
// замкнутая призма над контуром: от +above снаружи грани до -below внутрь
function buildPrismTris(loop, n, above, below){
  const top = loop.map(p=>p.clone().addScaledVector(n, above));
  const bot = loop.map(p=>p.clone().addScaledVector(n, -below));
  const out = [];
  for(const t of earClip(top)) out.push(t);          // крышка наружу (+n)
  for(const t of earClip([...bot].reverse())) out.push(t); // дно наружу (-n)
  for(let i=0;i<loop.length;i++){
    const j=(i+1)%loop.length;
    out.push([bot[i], bot[j], top[j]]);
    out.push([bot[i], top[j], top[i]]);
  }
  return out;
}
// Карман — честное булево вычитание нашим BSP прямо в браузере: тело
// минус призма контура. Режет насквозь, под углом, через углы — без
// антиматерии (сервеный /api/bool с csgrs остаётся запасным путём).
function commitPocketCSG(snap, patchTris, n, depth){
  setMeshFromArray(snap.pos.slice()); // предпросмотрные стенки выбрасываем
  // Призму строим по треугольникам самого лоскута: крышки — его копии,
  // стенки — по граничным рёбрам. Так карман работает и когда у грани
  // НЕСКОЛЬКО петель (крышка колеса: обод + отверстие вала) — прежняя
  // сборка по одной петле там сдавалась и оставляла вывернутые ошмётки.
  // Запас 1 мм только СНАРУЖИ; вглубь ровно depth, иначе +20 после -20
  // не сходится
  const prism = buildPatchPrismRange(snap.pos, patchTris, n, -depth, 1.0);
  try{
    const pos = mesh.geometry.attributes.position.array;
    const bodyTris = [];
    for(let i=0;i<pos.length;i+=9)
      bodyTris.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]),
                     new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]),
                     new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
    const res = csgSubtract(bodyTris, prism);
    const q = x => Math.round(x*1000)/1000; // сетка ключей — микрощели слипаются
    const arr = [];
    for(const t of res){
      const ar = new THREE.Vector3().subVectors(t[1],t[0])
        .cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
      if(ar < 1e-6) continue; // вырожденные осколки BSP
      for(const v of t) arr.push(q(v.x), q(v.y), q(v.z));
    }
    setMeshFromArray(new Float32Array(arr));
    healAfterBool();     // у BSP — осколки, копланарные наложения и Т-стыки
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  }catch(err){
    console.warn('BSP-карман не удался — операция отменена', err);
    undo(true);
    return;
  }
  extractEdges();
}

let exLive = null; // живой предпросмотр: {idx, set, n, applied, sheet}
// Операция выдавливания (Fusion 360: Join / Cut, знак расстояния — только
// направление). Пока пользователь не выбрал сам, операция следует за
// направлением: в тело — Cut, из тела — Join; у листа в воздухе — Join всегда
// Одно правило: зажатый Ctrl — Cut (тянуть грань, Enter или OK с Ctrl).
// Грань, отпущенная с зажатым Ctrl, помнит Cut до конца сессии окна
let exOpManual = null; // null — авто, 'cut' — закреплено Ctrl+тянуть
let exCtrl = false;    // Ctrl зажат прямо сейчас
function exOp(){
  if(exOpManual) return exOpManual;
  if(exCtrl) return 'cut';
  if(!exLive) return 'join';
  return (!exLive.sheet && exLive.applied < 0) ? 'cut' : 'join';
}
// Бессмысленная операция: Cut, уходящий в пустоту, или Add внутрь уже
// сплошного тела — ничего не изменят. Проверка по точкам призмы: центры
// треугольников лоскута, сдвинутые на 1/4, 1/2 и 3/4 высоты; «внутри тела» —
// нечётное число пересечений луча со снимком сетки до выдавливания
function exPointInside(P){
  raycaster.set(P, new THREE.Vector3(0.5773, 0.5774, 0.5775).normalize());
  const hits = raycaster.intersectObject(exLive.probe);
  let n = 0, last = -1;
  for(const h of hits){ if(h.distance - last > 1e-5){ n++; last = h.distance; } }
  return n % 2 === 1;
}
function exNoOp(){
  if(!exLive || !exLive.probe || !exLive.applied) return null;
  const op = exOp();
  if(exLive.sheet) return op === 'cut' ? 'cut' : null; // лист: вычитать не из чего
  const d = exLive.applied;
  let inside = 0, total = 0;
  for(const c of exLive.samples) for(const f of [0.25, 0.5, 0.75]){
    total++;
    if(exPointInside(c.clone().addScaledVector(exLive.n, d * f))) inside++;
  }
  if(op === 'cut' && inside === 0) return 'cut';
  if(op === 'join' && inside === total) return 'join';
  return null;
}
// призма выдавливания не пересекает чужих поверхностей: точки по всей высоте
// и чуть дальше торца — все внутри тела (вырез) или все снаружи (добавление)
function exPrismClear(d){
  if(!exLive || !exLive.probe || !exLive.samples || !d) return false;
  const inside = d < 0;
  for(const c of exLive.samples)
    for(const f of [0.1, 0.35, 0.6, 0.85, 1]){
      const t = f === 1 ? d + Math.sign(d) * 0.05 : d * f; // за торцом — ещё 0.05 мм
      if(exPointInside(c.clone().addScaledVector(exLive.n, t)) !== inside) return false;
    }
  return true;
}
function paintExOp(){
  const cut = exOp() === 'cut';
  ex_ok.textContent = cut ? 'Cut' : 'Add';
  ex_ok.classList.toggle('cut', cut);
  const noop = exNoOp();
  ex_ok.disabled = !!noop;
  ex_note.hidden = !noop;
  ex_note.textContent = noop === 'cut'
    ? 'Nothing to cut: the face moves into empty space. Release Ctrl to add, or go into the body.'
    : noop === 'join' ? 'Nothing to add: the body is already there. Hold Ctrl to cut, or go outward.' : '';
  for(const el of exPopup.querySelectorAll('.exline')) el.hidden = !hintsChk.checked; // подсказки — под флагом
}
function setExOp(op){ exOpManual = op; paintExOp(); }
// лоскут — лист (у контура есть открытое ребро: с обратной стороны воздух)?
function patchIsSheet(pos, tris){
  const cnt = new Map();
  for(let t=0;t<pos.length/9;t++) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    cnt.set(ek, (cnt.get(ek)||0) + 1);
  }
  for(const t of tris) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    if(cnt.get(k1<k2 ? k1+'|'+k2 : k2+'|'+k1) === 1) return true;
  }
  return false;
}
// булева операция тела-снимка с призмой лоскута от lo до hi вдоль нормали
// Булевы работают только с замкнутыми телами. Листы в воздухе (соседние
// залитые куски) в них не участвуют: сетка делится на связные части по
// рёбрам ровно с двумя гранями, части с открытым ребром откладываются и
// возвращаются после операции как есть
function splitClosedParts(pos){
  const nT = pos.length/9;
  const keyAt = o => keyOf(pos[o], pos[o+1], pos[o+2]);
  const edges = new Map();
  for(let t=0;t<nT;t++) for(let e=0;e<3;e++){
    const k1 = keyAt(t*9+e*3), k2 = keyAt(t*9+((e+1)%3)*3);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    let a = edges.get(ek); if(!a){ a = []; edges.set(ek, a); } a.push(t);
  }
  const par = new Int32Array(nT); for(let i=0;i<nT;i++) par[i] = i;
  const root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
  for(const a of edges.values())
    if(a.length === 2){ const r1 = root(a[0]), r2 = root(a[1]); if(r1 !== r2) par[r1] = r2; }
  const open = new Set();
  // открытое ребро (одна грань) — у листа; стык с тремя гранями — нет:
  // так тело, к краю которого пришит лист, само остаётся замкнутым
  for(const a of edges.values()) if(a.length === 1) open.add(root(a[0]));
  const closed = [], aside = [];
  for(let t=0;t<nT;t++){
    const dst = open.has(root(t)) ? aside : closed;
    for(let j=0;j<9;j++) dst.push(pos[t*9+j]);
  }
  return {closed, aside};
}
function extrudeCSG(basePos, prism, op){
  const parts = splitClosedParts(basePos);
  const cp = parts.closed;
  const body = [];
  for(let i=0;i<cp.length;i+=9)
    body.push([new THREE.Vector3(cp[i],cp[i+1],cp[i+2]),
               new THREE.Vector3(cp[i+3],cp[i+4],cp[i+5]),
               new THREE.Vector3(cp[i+6],cp[i+7],cp[i+8])]);
  const res = op === 'cut' ? (body.length ? csgSubtract(body, prism) : [])
    : (body.length ? csgUnion(body, prism) : prism);
  const q = x => Math.round(x*1000)/1000;
  const arr = [...parts.aside];
  for(const t of res){
    const ar = new THREE.Vector3().subVectors(t[1],t[0]).cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
    if(ar < 1e-6) continue;
    for(const v of t) arr.push(q(v.x), q(v.y), q(v.z));
  }
  setMeshFromArray(new Float32Array(arr));
  healAfterBool();
}
let exFaceDrag = null; // грань тянут мышью при открытом окне Extrude
// белая пунктирная ось выдавливания через центр грани (как ось в SketchUp)
let exAxisLine = null;
function showExAxis(center, n){
  hideExAxis();
  const L = 80;
  const g = new THREE.BufferGeometry().setFromPoints([
    center.clone().addScaledVector(n, -L), center.clone().addScaledVector(n, L)]);
  exAxisLine = new THREE.Line(g, new THREE.LineDashedMaterial({
    color: 0xffffff, dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0.8}));
  exAxisLine.computeLineDistances();
  scene.add(exAxisLine);
}
function hideExAxis(){
  if(exAxisLine){ scene.remove(exAxisLine); exAxisLine.geometry.dispose(); exAxisLine = null; }
}
function openExtrude(){
  if(!ppPatch) return;
  pushUndo(); // снимок ДО дублирования контура: Esc вернёт всё как было
  // центроид лоскута — опора белой оси (до дублирования контура)
  const posC = mesh.geometry.attributes.position.array;
  const c = new THREE.Vector3();
  let cn = 0;
  for(const t of ppPatch.tris){
    for(let k=0;k<9;k+=3){ c.x += posC[t*9+k]; c.y += posC[t*9+k+1]; c.z += posC[t*9+k+2]; cn++; }
  }
  if(cn) c.multiplyScalar(1/cn);
  const ex = beginPatchExtrude(ppPatch);
  const sheet = patchIsSheet(posC, ppPatch.tris);
  // снимок тела до выдавливания — для проверки «операция что-то изменит?»
  const snapPos = undoStack[undoStack.length-1].pos;
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(snapPos, 3));
  const probe = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
  probe.updateMatrixWorld(true);
  const step = Math.max(1, Math.floor(ppPatch.tris.length / 12));
  const samples = [];
  for(let i=0;i<ppPatch.tris.length;i+=step){
    const o = ppPatch.tris[i]*9;
    samples.push(new THREE.Vector3((snapPos[o]+snapPos[o+3]+snapPos[o+6])/3,
      (snapPos[o+1]+snapPos[o+4]+snapPos[o+7])/3, (snapPos[o+2]+snapPos[o+5]+snapPos[o+8])/3));
  }
  exLive = {idx: ex.idx, fac: ex.fac, set: new Set(ex.idx),
            n: ppPatch.normal.clone(), applied: 0, sheet, probe, samples};
  // Through all и End size: абсолютные позиции от исходных (торец масштабируется
  // вокруг центра контура), глубина тела под гранью, треугольники лоскута
  {
    const posE = mesh.geometry.attributes.position.array, nn = ppPatch.normal.clone().normalize();
    exLive.base = Float32Array.from(ex.idx.map(i => [posE[i], posE[i+1], posE[i+2]]).flat());
    const loop = patchOutlineLoop(snapPos, ppPatch.tris);
    exLive.center = loop ? loop.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / loop.length) : c.clone();
    exLive.tris = ppPatch.tris.slice();
    exLive.area = ppPatch.area || 0;
    const d0 = nn.dot(new THREE.Vector3().fromArray(snapPos, ppPatch.tris[0]*9));
    let below = 0;
    for(let i=0;i<snapPos.length;i+=3) below = Math.max(below, d0 - (nn.x*snapPos[i] + nn.y*snapPos[i+1] + nn.z*snapPos[i+2]));
    exLive.below = below;
    exLive.through = false; exLive.taper = 1;
  }
  ex_taper.value = 100;
  exOpManual = null; exCtrl = false;
  paintExOp();
  showExAxis(c, ppPatch.normal);
  const vr = view.getBoundingClientRect();
  exPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 360) + 'px';
  exPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 130) + 'px';
  exPopup.hidden = false;
  paintExVal();
  ex_val.focus(); ex_val.select();
}
// целые миллиметры — зелёным: видно, что дробной части нет
function paintExVal(){
  const v = +ex_val.value;
  ex_val.classList.toggle('whole', Number.isFinite(v) && Math.abs(v - Math.round(v)) < 1e-9);
}
// сдвиг грани к значению v — модель меняется прямо под роликом/цифрами
function applyExtrudeLive(v){
  if(!exLive) return;
  v = Math.round(v*10)/10;
  const d = v - exLive.applied, k = exLive.taper || 1;
  if(d || exLive.shownTaper !== k){
    // позиции от исходных: сдвиг по нормали и масштаб торца вокруг центра
    // контура (End size), стенки-веера — на полпути (f = 0.5)
    const pos = mesh.geometry.attributes.position.array, B = exLive.base, C = exLive.center, n = exLive.n;
    exLive.idx.forEach((i, j)=>{
      const f = exLive.fac[j], sc = (k - 1) * f, bx = B[j*3], by = B[j*3+1], bz = B[j*3+2];
      pos[i]   = bx + n.x*v*f + (bx - C.x)*sc;
      pos[i+1] = by + n.y*v*f + (by - C.y)*sc;
      pos[i+2] = bz + n.z*v*f + (bz - C.z)*sc;
    });
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    if(ppHi){ ppHi.position.addScaledVector(n, d); ppHi.visible = k === 1; } // зелёная подсветка едет с гранью
    if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    exLive.applied = v; exLive.shownTaper = k;
  }
  paintExVal();
  paintExOp();
  paintExInfo();
}
// строка данных окна Extrude: что получится — видна всегда (данные не гейтятся)
function paintExInfo(){
  if(!exLive) return;
  const k = exLive.taper || 1, v = exLive.applied;
  ex_through.classList.toggle('on', !!exLive.through);
  ex_through.disabled = exLive.sheet || exLive.below < 0.05;
  const parts = [];
  if(exLive.through) parts.push('Through all · body ' + exLive.below.toFixed(1) + ' mm under the face');
  else parts.push('Face ' + (Math.round(exLive.area*10)/10) + ' mm²');
  if(Math.abs(k - 1) > 1e-6){
    const endArea = exLive.area * k * k;
    // угол стенки для круглой грани той же площади — ориентир уклона
    const r = Math.sqrt(exLive.area / Math.PI), ang = v ? Math.atan(r * Math.abs(1 - k) / Math.abs(v)) * 180 / Math.PI : 0;
    parts.push('end ' + (Math.round(endArea*10)/10) + ' mm²' + (v ? ' · walls ≈ ' + ang.toFixed(1) + '° ' + (k < 1 ? 'in' : 'out') : ''));
    if(exLive.sheet) parts.push('<span style="color:#ffb347">End size needs a solid, not a sheet</span>');
  }
  ex_info.innerHTML = parts.join('<br>');
}
function setExThrough(on){
  if(!exLive) return;
  exLive.through = !!on && !exLive.sheet && exLive.below >= 0.05;
  if(exLive.through){
    const v = -snapMM(exLive.below + 1); // на 1 мм за конец тела: без плёнки у дна
    ex_val.value = v.toFixed(1);
    setExOp('cut');
    applyExtrudeLive(v);
  } else {
    if(exOpManual === 'cut' && !exCtrl) setExOp(null);
    paintExInfo();
  }
}
function releaseToolInput(){ // фокус обратно на сцену
  const el = document.activeElement;
  if(el && el.tagName === 'INPUT') el.blur();
}
function commitExtrude(){
  const noop = exNoOp();
  if(noop){ // бессмысленно — окно остаётся, пользователь поправит
    warnTip(noop === 'cut' ? 'Nothing to cut here' : 'Nothing to add here');
    return;
  }
  hideExAxis(); exFaceDrag = null; releaseToolInput();
  exLive && updateOrbitCursor(false);
  if(!exLive){ exPopup.hidden = true; return; }
  applyExtrudeLive(snapMM(+ex_val.value||0));
  if(exLive.taper && Math.abs(exLive.taper - 1) > 1e-6 && exLive.applied && !exLive.sheet){ commitTaperExtrude(); return; }
  const applied = exLive.applied, n = exLive.n.clone(), op = exOp(), sheet = exLive.sheet;
  // Быстрый путь (грань просто сдвинулась, проверка по объёму) законен, только
  // если призма выдавливания целиком в теле (вырез) или целиком снаружи
  // (добавление). Иначе грань проходит сквозь другую поверхность: сквозной
  // вырез −31 из дна толщиной 30 оставлял под дном «пробку» в 1 мм, а объём
  // формально сходился
  const prismClear = exPrismClear(applied);
  exLive = null;
  exPopup.hidden = true;
  if(!applied){ undo(true); return; } // нулевая высота: откат без повтора
  const patchTris = ppPatch ? ppPatch.tris.slice() : null;
  const patchArea = ppPatch ? (ppPatch.area || 0) : 0;
  // --- операции, которых нет у «просто сдвинуть грань» ---
  if(patchTris && (sheet || (op === 'join' && applied < 0) || (op === 'cut' && applied > 0))){
    const snap = undoStack[undoStack.length-1];
    hidePatch(); ppPatch = null;
    const lo = Math.min(0, applied), hi = Math.max(0, applied);
    try{
      if(sheet && op === 'cut'){ // лист не тело: вычитать не из чего
        undo(true); warnTip('Cut needs a solid — this face is a sheet in the air'); return;
      }
      if(sheet){
        // Join от листа: лист убирается, а остальное тело объединяется с
        // замкнутой призмой (лист становится её крышкой). Простая склейка не
        // годится: стенки призмы ложатся на бока тела и оставляют щели
        const drop = new Set(patchTris);
        const keep = [];
        for(let t=0;t<snap.pos.length/9;t++)
          if(!drop.has(t)) for(let j=0;j<9;j++) keep.push(snap.pos[t*9+j]);
        extrudeCSG(new Float32Array(keep), buildPatchPrismRange(snap.pos, patchTris, n, lo, hi), 'join');
      } else if(op === 'join'){
        // Join против нормали: союз с призмой под гранью (у сплошного тела
        // там уже материал — Fusion в таком случае тоже ничего не меняет)
        extrudeCSG(snap.pos, buildPatchPrismRange(snap.pos, patchTris, n, lo, hi), 'join');
      } else {
        // Cut по нормали: вычесть призму над гранью (срезает то, что над ней)
        extrudeCSG(snap.pos, buildPatchPrismRange(snap.pos, patchTris, n, lo, hi), 'cut');
      }
      if(!modified){ modified = true; s_mod.textContent = 'yes'; }
    }catch(err){
      console.warn('extrude operation failed', err);
      undo(true); warnTip('Extrude failed'); return;
    }
    extractEdges();
    return;
  }
  if(applied < 0 && ppPatch){
    const snap = undoStack[undoStack.length-1];
    hidePatch(); ppPatch = null;
    // Результат предпросмотра проверяем ДО лечилок: стенки уже растянуты,
    // и для частого случая «опустить грань» (деталь стала тоньше) сетка уже
    // замкнута. Лечилки вслепую тут запускать нельзя — healCoplanarOverlaps
    // рассчитан на встречные стенки и разрушает корректную сетку, если
    // грань просто опустилась
    cleanupMesh();
    if(prismClear && extrudeLooksClean(snap.pos, applied, patchArea)){ extractEdges(); return; }
    // лечилка ради быстрого пути имеет смысл, только если призма целиком в
    // теле: сквозной вырез в шестерне тратил на неё 2.2 с перед булевой
    if(prismClear){
      healAll();
      if(extrudeLooksClean(snap.pos, applied, patchArea)){ extractEdges(); return; }
    }
    // не сошлось — карман режет соседний материал, нужна булева
    commitPocketCSG(snap, patchTris, n, -applied);
    return;
  }
  hidePatch(); ppPatch = null;
  // Если предпросмотр уже дал замкнутое тело с точным объёмом (обычный
  // подъём грани), берём его как есть: ни булевых, ни лечилок
  cleanupMesh();
  if(patchTris && prismClear && extrudeLooksClean(undoStack[undoStack.length-1].pos, applied, patchArea)){
    extractEdges();
    return;
  }
  // Выдавливание наружу = Pad: во FreeCAD это всегда булев союз, и мы
  // делаем так же — тело ДО операции плюс замкнутая призма поднятия.
  // Локальная сшивка не справляется, когда стенки проходят сквозь другие
  // грани (поднятые донья кармана): получается тело внутри тела.
  // На крупных сетках (колесо — 26 000 треугольников) BSP слишком дорог:
  // там только точный путь, а если он не прошёл — локальная сшивка
  let padded = false;
  const bigMesh = mesh.geometry.attributes.position.array.length/9 > 6000;
  if(patchTris && mesh.geometry.attributes.position.array.length/9 <= 80000){
    const before = mesh.geometry.attributes.position.array.slice();
    const snap = undoStack[undoStack.length-1];
    try{
      const prism = buildPatchPrism(snap.pos, patchTris, n, applied);
      const body = [];
      for(let i=0;i<snap.pos.length;i+=9)
        body.push([new THREE.Vector3(snap.pos[i],snap.pos[i+1],snap.pos[i+2]),
                   new THREE.Vector3(snap.pos[i+3],snap.pos[i+4],snap.pos[i+5]),
                   new THREE.Vector3(snap.pos[i+6],snap.pos[i+7],snap.pos[i+8])]);
      const res = bigMesh ? exactBool(body, prism, 'union') : csgUnion(body, prism);
      if(!res) throw new Error('exact union failed on a large mesh');
      const q = x => Math.round(x*1000)/1000;
      const arr = [];
      for(const t of res){
        const ar = new THREE.Vector3().subVectors(t[1],t[0])
          .cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
        if(ar < 1e-6) continue;
        for(const vv of t) arr.push(q(vv.x), q(vv.y), q(vv.z));
      }
      setMeshFromArray(new Float32Array(arr));
      healAfterBool();
      padded = true;
    }catch(err){
      console.warn('union не удался — локальная сшивка', err);
      setMeshFromArray(before);
    }
  }
  if(!padded) healAll();
  extractEdges();
}
// Операция прошла честно? Сетка замкнута, а объём изменился ровно на
// площадь лоскута x высоту. Если да — лечить нечего и звать булевы незачем
function extrudeLooksClean(snapPos, applied, patchArea){
  if(!(patchArea > 0)) return false;
  if(countBoundaryEdges() !== 0) return false;
  const want = meshVolumeOf(snapPos) + applied * patchArea;
  // грань ушла на всю толщину и дальше — прошла сквозь противоположную
  // стенку: объём формально сходится (64000 − 42·1600 = −3200), но тело
  // вывернуто. Такой результат не берём — вычитание сделает BSP честно
  if(want <= 0.5) return false;
  const got = meshVolumeOf(mesh.geometry.attributes.position.array);
  return Math.abs(got - want) < Math.max(0.5, Math.abs(applied) * patchArea * 0.002);
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
      if(protectedPts.some(P => P.distanceToSquared(v) < 1e-4)) continue;
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
// сколько рёбер сетки встречается ровно один раз (дыры/Т-стыки).
// Ключи СТРОГИЕ (0.001): keyOf с шагом 0.01 «склеивает» реальные щели,
// и рваная после сквозной экструзии сетка выглядела бы здоровой
function countBoundaryEdges(){
  const pos = mesh.geometry.attributes.position.array;
  const k = (x,y,z) => x.toFixed(3)+','+y.toFixed(3)+','+z.toFixed(3);
  const em = new Map();
  for(let i=0;i<pos.length;i+=9) for(let e=0;e<3;e++){
    const a=i+e*3, b=i+((e+1)%3)*3;
    const k1=k(pos[a],pos[a+1],pos[a+2]), k2=k(pos[b],pos[b+1],pos[b+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    em.set(ek,(em.get(ek)||0)+1);
  }
  let n = 0;
  for(const c of em.values()) if(c===1) n++;
  return n;
}
// замкнутая призма поднятия лоскута: низ — сами треугольники (нормаль -n),
// верх — подняты на h (+n), стенки — на граничных рёбрах лоскута
function buildPatchPrism(pos, trisIdx, n, h){
  return buildPatchPrismRange(pos, trisIdx, n, 0, h);
}
function buildPatchPrismRange(pos, trisIdx, n, hLow, hHigh){
  const V = o => new THREE.Vector3(pos[o], pos[o+1], pos[o+2]);
  const cnt = new Map();
  for(const t of trisIdx) for(let e=0;e<3;e++){
    const o1=t*9+e*3, o2=t*9+((e+1)%3)*3;
    const k1=keyOf(pos[o1],pos[o1+1],pos[o1+2]), k2=keyOf(pos[o2],pos[o2+1],pos[o2+2]);
    const ek = k1<k2 ? k1+'|'+k2 : k2+'|'+k1;
    const r = cnt.get(ek);
    if(r) r.n++;
    else cnt.set(ek, {n:1, a:V(o1), b:V(o2)});
  }
  const lo = v => v.clone().addScaledVector(n, hLow);
  const up = v => v.clone().addScaledVector(n, hHigh);
  const out = [];
  for(const t of trisIdx){
    const A=V(t*9), B=V(t*9+3), C=V(t*9+6);
    out.push([lo(A), lo(C), lo(B)]);                  // низ наружу (-n)
    out.push([up(A), up(B), up(C)]);                  // верх наружу (+n)
  }
  for(const w of cnt.values()) if(w.n===1){
    out.push([lo(w.a), lo(w.b), up(w.b)]);            // стенка наружу
    out.push([lo(w.a), up(w.b), up(w.a)]);
  }
  return out;
}
// Выдавливание с End size ≠ 100 % (Draft/Taper у Extrude во Fusion): призма
// лоскута, торец которой масштабирован вокруг центра контура, объединяется с
// телом или вычитается точной булевой — работает и наружу, и в тело (карман
// с уклоном), и у граней с отверстиями. Предпросмотр откатывается к снимку
// до окна, призма строится по тем же треугольникам лоскута
function commitTaperExtrude(){
  const L = exLive, v = L.applied, k = L.taper, op = exOp(), n = L.n.clone().normalize();
  exLive = null; exPopup.hidden = true;
  hideExAxis(); exFaceDrag = null; releaseToolInput(); updateOrbitCursor(false);
  undo(true); // снимок до окна: без предпросмотрных стенок
  hidePatch(); ppPatch = null; cachedPatch = null;
  const pos = mesh.geometry.attributes.position.array;
  const V = o => new THREE.Vector3(pos[o], pos[o+1], pos[o+2]);
  const top = P => P.clone().addScaledVector(n, v).add(new THREE.Vector3().subVectors(P, L.center).multiplyScalar(k - 1));
  const tris = [], cnt = new Map();
  for(const t of L.tris){
    const A = V(t*9), B = V(t*9+3), C = V(t*9+6);
    tris.push([A, C, B], [top(A), top(B), top(C)]);
    for(const [P, Q] of [[A, B], [B, C], [C, A]]){
      const ka = keyOf(P.x, P.y, P.z), kb = keyOf(Q.x, Q.y, Q.z), ek = ka < kb ? ka+'|'+kb : kb+'|'+ka;
      const r = cnt.get(ek); if(r) r.n++; else cnt.set(ek, {n: 1, P, Q});
    }
  }
  for(const w of cnt.values()) if(w.n === 1) tris.push([w.P, w.Q, top(w.Q)], [w.P, top(w.Q), top(w.P)]);
  try{
    const r = zcApplySolid(tris, op === 'cut' ? 'cut' : 'join', false);
    if(r.open_edges || r.nonmanifold_edges || !r.volume_change_mm3){
      undo(true);
      warnTip(r.volume_change_mm3 ? 'Extrude with end size failed here' : 'Nothing to ' + (op === 'cut' ? 'cut' : 'add') + ' here');
      return false;
    }
    return r;
  }catch(err){
    console.warn('taper extrude failed', err);
    warnTip('Extrude with end size failed here');
    return false;
  }
}
function closeExtrude(){ // Esc: стенки уже врезаны — откат всей сессии окна
  hideExAxis(); exFaceDrag = null; releaseToolInput();
  updateOrbitCursor(false);
  if(exLive){ exLive = null; undo(true); }
  exPopup.hidden = true;
}
ex_val.addEventListener('input', ()=>{
  const v = +ex_val.value;
  if(exLive && exLive.through) setExThrough(false); // своё число — уже не «насквозь»
  if(Number.isFinite(v)) applyExtrudeLive(snapMM(v)); else paintExVal();
});
const ex_through = document.getElementById('ex_through'), ex_taper = document.getElementById('ex_taper'),
      ex_info = document.getElementById('ex_info');
ex_through.addEventListener('click', ()=>{ if(exLive) setExThrough(!exLive.through); });
ex_taper.addEventListener('input', ()=>{
  if(!exLive) return;
  const pct = +ex_taper.value;
  if(!Number.isFinite(pct) || pct < 5 || pct > 500) return; // пока набирают — не трогаем
  exLive.taper = pct / 100;
  applyExtrudeLive(exLive.applied);
});
ex_taper.addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); commitExtrude(); }
  if(e.key === 'Escape'){ closeExtrude(); }
  e.stopPropagation();
});
ex_val.addEventListener('keydown', e=>{
  if(e.key === 'Enter'){
    e.preventDefault();
    if(e.ctrlKey){ setExOp('cut'); if(exNoOp()){ setExOp(null); warnTip('Nothing to cut here'); return; } }
    commitExtrude();
  }
  if(e.key === 'Escape'){ closeExtrude(); }
  e.stopPropagation();
});
document.getElementById('ex_ok').addEventListener('click', e=>{
  if(e.ctrlKey){ setExOp('cut'); if(exNoOp()){ setExOp(null); warnTip('Nothing to cut here'); return; } }
  commitExtrude();
});
document.getElementById('ex_cancel').addEventListener('click', closeExtrude);
makeGripDrag(exPopup); // ручка ⠿ окна Extrude
const vpanel = document.getElementById('vpanel'), vp_t = document.getElementById('vp_t'),
      vx=document.getElementById('vx'), vy=document.getElementById('vy'), vz=document.getElementById('vz');

// «в центре» — салатовым: пойманную середину/центр видно с одного взгляда
function kindLabel(kind){
  return (kind === 'midpoint' || kind === 'center' || kind === 'origin' || kind === 'quadrant' || kind === 'vertex')
    ? '<span style="color:#6aff3d;font-weight:700">' + kind + '</span>'
    : kind;
}
function tipAt(e, html){
  const vr = view.getBoundingClientRect();
  dragTip.style.left = (e.clientX-vr.left+16)+'px';
  dragTip.style.top  = (e.clientY-vr.top+12)+'px';
  dragTip.innerHTML = html;
  dragTip.hidden = false;
}
function tipHide(){ dragTip.hidden = true; }

function updateVPanel(){
  const p = vpEdge ? vpEdge.mid : (selAnchor ? selAnchor.pos : (sel && sel.pos));
  if(!p) return;
  vx.value = p.x.toFixed(1);
  vy.value = p.y.toFixed(1);
  vz.value = p.z.toFixed(1);
}
function selectVertex(pos){
  selAnchor = null;
  clearEdgeSel(); // выбор взаимоисключающий
  hidePatch(); ppPatch = null;
  sel = {pos: pos.clone()};
  selMarker.position.copy(sel.pos); selMarker.visible = true;
  updateVPanel(); // значения готовы, но окно ввода откроет только G,V
}
// окно точного ввода — у курсора, как все остальные окна.
// Для ребра/линии показываем координаты СЕРЕДИНЫ: правка двигает всё ребро
// целиком (та же механика, что M-move, только числами — AutoCAD-стиль)
function openVPanel(){
  vpEdge = null;
  if(!sel && !selAnchor && edgeSel.length === 1){
    const ch = edgeSel[0];
    const pts = ch.pts.map(p=>p.clone());
    const mid = pts[0].clone().add(pts[pts.length-1]).multiplyScalar(0.5);
    const im = buildIndexMap(pts);
    vpEdge = {pts0: pts, idx: pts.map(p=>im.get(keyOf(p.x,p.y,p.z))||[]), mid};
    vp_t.textContent = ch.isGuide ? 'Line' : 'Edge';
  } else {
    vp_t.textContent = 'Vertex';
  }
  const vr = view.getBoundingClientRect();
  vpanel.style.left = Math.min(lastMX - vr.left + 20, vr.width - 300) + 'px';
  vpanel.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 240) + 'px';
  updateVPanel();
  vpanel.hidden = false;
}
makeGripDrag(vpanel); // ручка ⠿, как у остальных окон
// палитра выбранной вершины: координаты — данные, команды — подсказка
function showVertexPalette(){
  tipHide();
  const p = sel && sel.pos;
  const info = 'Vertex' + (p
    ? '<br><span style="color:'+AXIS_CSS.x+';font-weight:600">X ' + p.x.toFixed(1) + '</span>' +
      '<br><span style="color:'+AXIS_CSS.y+';font-weight:600">Y ' + p.y.toFixed(1) + '</span>' +
      '<br><span style="color:'+AXIS_CSS.z+';font-weight:600">Z ' + p.z.toFixed(1) + '</span>'
    : '');
  const vr = view.getBoundingClientRect();
  chordHint.innerHTML = CH_GRIP +
    '<div style="color:var(--text);font-weight:600">' + info + '</div>' +
    (!hintsChk.checked ? '' :
    '<div><span class="key">G,V</span> — edit X/Y/Z</div>' +
    '<div><span class="key">Alt+drag</span> — ring</div>' +
    '<div><span class="key">Shift</span> — column</div>' +
    '<div style="opacity:.55">Esc — deselect</div>');
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 420) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 170) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t); // живёт, пока выбор жив
}
// выбранная точка — зелёная, как ребро и грань (selection во FreeCAD)
let selAnchor = null;
function selectAnchor(a){
  deselect();
  clearEdgeSel();
  hidePatch(); ppPatch = null;
  selAnchor = a;
  if(a.marker) a.marker.visible = false; // вместо неё — зелёный маркер выбора
  selMarker.position.copy(a.pos); selMarker.visible = true;
  updateVPanel(); // окно ввода откроет G,V
  showPointPalette();
}
function showPointPalette(){
  tipHide();
  // шапка с данными — всегда: тип и координаты построчно в цветах осей
  const p = selAnchor && selAnchor.pos;
  const info = 'Point' + (p
    ? '<br><span style="color:'+AXIS_CSS.x+';font-weight:600">X ' + p.x.toFixed(1) + '</span>' +
      '<br><span style="color:'+AXIS_CSS.y+';font-weight:600">Y ' + p.y.toFixed(1) + '</span>' +
      '<br><span style="color:'+AXIS_CSS.z+';font-weight:600">Z ' + p.z.toFixed(1) + '</span>'
    : '');
  const vr = view.getBoundingClientRect();
  chordHint.innerHTML = CH_GRIP +
    '<div style="color:var(--text);font-weight:600">' + info + '</div>' +
    (!hintsChk.checked ? '' :
    '<div><span class="key">Drag</span> — move point</div>' +
    '<div><span class="key">G,V</span> — edit X/Y/Z</div>' +
    '<div><span class="key">Del</span> — delete point</div>' +
    '<div style="opacity:.55">Esc — deselect</div>');
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 380) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 180) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t); // живёт, пока выбор жив
}
// M — двигать выбранное ребро: grab-стиль Blender (ребро следует за мышью,
// клик фиксирует, X/Y/Z — ось, Esc — отмена); клавиша M — Move из SketchUp
function startEdgeMove(){
  const s = edgeSel[0];
  if(!s) return;
  const pts = s.pts.map(p=>p.clone());
  const q = quadPos({clientX: lastMX, clientY: lastMY});
  const nrm = q.is3D
    ? new THREE.Vector3().subVectors(persp.position, camTarget).normalize()
    : q.cam.position.clone().normalize();
  const mid = pts[0].clone().add(pts[pts.length-1]).multiplyScalar(0.5);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, mid);
  // захват от текущего курсора, спроецированного на плоскость — без прыжка
  const rc = canvas.getBoundingClientRect();
  const lx = (lastMX - rc.left) - q.ox, ly = (lastMY - rc.top) - q.oy;
  raycaster.setFromCamera({x: lx/q.w*2-1, y: -(ly/q.h*2-1)}, q.cam);
  const grab0 = new THREE.Vector3();
  if(!raycaster.ray.intersectPlane(plane, grab0)) grab0.copy(mid);
  // вершины сетки посреди ребра (Т-стыки от линий, пересёкших его) едут
  // вместе с ребром — иначе ребро переламывается и грани гнутся криво
  // Сравнение по расстоянию, а не по ключу: точка линии на границе округления
  // ключа (64.9785) не совпадала с вершиной сетки (64.9784) — ребро не двигалось
  const idx = pts.map(() => []);
  {
    const posA = mesh.geometry.attributes.position.array;
    const P = new THREE.Vector3(), base = pts.slice(), extra = new Map();
    for(let i=0;i<posA.length;i+=3){
      P.set(posA[i], posA[i+1], posA[i+2]);
      let hit = -1;
      for(let j=0;j<base.length;j++) if(base[j].distanceToSquared(P) < 0.012*0.012){ hit = j; break; }
      if(hit >= 0){ idx[hit].push(i); continue; }
      for(let j=0;j+1<base.length;j++){
        const d = new THREE.Vector3().subVectors(base[j+1], base[j]), L2 = d.lengthSq();
        if(L2 < 1e-12) continue;
        const t = new THREE.Vector3().subVectors(P, base[j]).dot(d) / L2;
        if(t <= 0 || t >= 1) continue;
        if(base[j].clone().addScaledVector(d, t).distanceTo(P) < 0.012){
          const k = keyOf(P.x, P.y, P.z);
          if(!extra.has(k)){ extra.set(k, idx.length); pts.push(P.clone()); idx.push([]); }
          idx[extra.get(k)].push(i);
          break;
        }
      }
    }
  }
  edgeDrag = {
    pts0: pts.map(p=>p.clone()),
    idx,
    grab0, q0: {cam:q.cam, ox:q.ox, oy:q.oy, w:q.w, h:q.h},
    plane,
    snap: takeSnapshot(), snapPushed: false,
    grabMode: true,
    normal: edgeFaceNormal(pts[0], pts.length > 1 ? pts[1] : pts[0]),
    baseEnd: s.pts[s.pts.length-1].clone(), // конец цепочки (в pts0 после него — Т-стыки)
    nLock: false, typed: ''
  };
  clearEdgeSel(); hideChordHint();
  edgeFoldInfo(); // по сетке до сдвига: позиции вершин грани — исходные
  // линии, которые поедут с ребром (концы на нём или на сгибаемой грани)
  {
    const base = s.pts;
    const onChain = P => {
      for(let j=0;j+1<base.length;j++){
        const dd = new THREE.Vector3().subVectors(base[j+1], base[j]), L2 = dd.lengthSq();
        if(L2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, base[j]).dot(dd) / L2));
        if(base[j].clone().addScaledVector(dd, t).distanceTo(P) < 0.012) return true;
      }
      return false;
    };
    const fw = edgeDrag.foldW || new Map();
    edgeDrag.guideMoves = [];
    for(const g of guides){
      const kA = keyOf(g.a.x,g.a.y,g.a.z), kB = keyOf(g.b.x,g.b.y,g.b.z);
      const onA = onChain(g.a), onB = onChain(g.b);
      if(onA || onB || fw.has(kA) || fw.has(kB))
        edgeDrag.guideMoves.push({g, a0: g.a.clone(), b0: g.b.clone(), onA, onB, kA, kB});
    }
  }
  openEmPopup();
}
// нормаль грани под ребром (среднее граней, в плоскости которых оно лежит):
// «вдавить линию в грань» — сделать из неё V-канавку
function edgeFaceNormal(A, B){
  const pos = mesh.geometry.attributes.position.array;
  const dir = new THREE.Vector3().subVectors(B, A);
  if(dir.length() < 1e-6) return null;
  dir.normalize();
  // треугольники у конца ребра, в чьей плоскости лежит направление ребра.
  // Конец может лежать не в вершине, а посреди ребра сетки (линия от точки на
  // ребре) — касание треугольника любой его точкой, а не только вершиной
  const cand = [];
  const tri = new THREE.Triangle(), cp = new THREE.Vector3();
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    if(Math.min(pos[o], pos[o+3], pos[o+6]) > A.x + 0.012 || Math.max(pos[o], pos[o+3], pos[o+6]) < A.x - 0.012 ||
       Math.min(pos[o+1], pos[o+4], pos[o+7]) > A.y + 0.012 || Math.max(pos[o+1], pos[o+4], pos[o+7]) < A.y - 0.012 ||
       Math.min(pos[o+2], pos[o+5], pos[o+8]) > A.z + 0.012 || Math.max(pos[o+2], pos[o+5], pos[o+8]) < A.z - 0.012) continue;
    tri.set(new THREE.Vector3().fromArray(pos, o), new THREE.Vector3().fromArray(pos, o+3), new THREE.Vector3().fromArray(pos, o+6));
    if(tri.closestPointToPoint(A, cp).distanceTo(A) > 0.012) continue;
    const w = new THREE.Vector3(pos[o+3]-pos[o], pos[o+4]-pos[o+1], pos[o+5]-pos[o+2])
      .cross(new THREE.Vector3(pos[o+6]-pos[o], pos[o+7]-pos[o+1], pos[o+8]-pos[o+2]));
    const ar = w.length();
    if(ar < 1e-4) continue;
    if(Math.abs(w.dot(dir)) / ar > 0.05) continue; // ребро не в плоскости этого треугольника
    cand.push({t, ar, n: w.multiplyScalar(1/ar)});
  }
  cand.sort((a, b) => b.ar - a.ar);
  // нормаль берём у всей грани (плоскость, уточнённая по области), а не у
  // треугольников у ребра: после булевых это иглы, наклонённые на градусы.
  // Ребро на стыке двух граней — среднее их нормалей, как Normal в Blender
  const sum = new THREE.Vector3(), used = [];
  for(const c of cand){
    if(used.some(p => p.set.has(c.t))) continue;
    const p = facePatchAt(c.t);
    used.push(p);
    const pn = p.normal.clone();
    if(pn.dot(c.n) < 0) pn.negate();
    sum.add(pn);
    if(used.length === 2) break;
  }
  return sum.lengthSq() > 1e-9 ? sum.normalize() : null;
}
// Окно Move edge (как окна Line/Offset): расстояние от грани, на которой
// лежало ребро, — поле From face (ввод + Enter), сдвиг по осям, привязка.
// Раньше это был тултип у курсора — число нельзя было ввести мышью
const emPopup = document.getElementById('emPopup'), em_follow = document.getElementById('em_follow'), em_straight = document.getElementById('em_straight');
function openEmPopup(){
  tipHide();
  const vr = view.getBoundingClientRect();
  emPopup.style.left = Math.min(lastMX - vr.left + 28, vr.width - 360) + 'px';
  emPopup.style.top  = Math.min(lastMY - vr.top + 16, vr.height - 330) + 'px';
  emPopup.hidden = false;
  em_dist.value = '';
  updateEmPopup(new THREE.Vector3());
}
function closeEmPopup(){ emPopup.hidden = true; if(document.activeElement === em_dist) em_dist.blur(); }
function updateEmPopup(d, err){
  const ed = edgeDrag;
  if(!ed || emPopup.hidden) return;
  tipHide();
  const N = ed.normal, s = N ? d.dot(N) : null;
  em_state.textContent = ed.nLock ? 'perpendicular to the face' : axisLock ? 'along ' + axisLock.toUpperCase() : 'free';
  if(document.activeElement !== em_dist) em_dist.value = s == null ? '' : (Math.abs(s) < 0.05 ? '0' : s.toFixed(1));
  em_dist.disabled = !N;
  em_xyz.innerHTML =
    '<span style="color:'+AXIS_CSS.x+';font-weight:600">X '+d.x.toFixed(1)+'</span> · ' +
    '<span style="color:'+AXIS_CSS.y+';font-weight:600">Y '+d.y.toFixed(1)+'</span> · ' +
    '<span style="color:'+AXIS_CSS.z+';font-weight:600">Z '+d.z.toFixed(1)+'</span>';
  em_snap.innerHTML = err ? '<span style="color:#ff6b6b">' + err + '</span>'
    : ed.snapped && !ed.typed ? '<span style="color:#52c752;font-weight:700">on ' + ed.snapped.what + '</span>'
    : ed.nLock && s != null && s < -0.01 ? 'into the body · <b>V groove</b> on apply'
    : '&nbsp;';
  em_follow.classList.toggle('on', ed.endMode !== 'straight');
  em_straight.classList.toggle('on', ed.endMode === 'straight');
  em_hint.hidden = !hintsChk.checked;
}
// поле From face: число — сдвиг перпендикулярно грани; знак — как вела мышь,
// явный минус — в тело
em_dist.addEventListener('input', () => {
  if(!edgeDrag || !edgeDrag.normal) return;
  edgeDrag.nKey = true; edgeDrag.nLock = true; setAxisLock(null);
  edgeDrag.typed = em_dist.value;
  applyEdgeTyped();
});
em_dist.addEventListener('keydown', e => {
  if(e.key === 'Enter'){ e.preventDefault(); if(edgeDrag){ if(edgeDrag.typed) applyEdgeTyped(); finishEdgeMove(); } }
  else if(e.key === 'Escape'){ e.preventDefault(); em_dist.blur(); cancelEdgeMove(); }
  e.stopPropagation(); // цифры поля не уходят в сцену
});
document.getElementById('em_ok').addEventListener('click', () => { if(edgeDrag){ if(edgeDrag.typed) applyEdgeTyped(); finishEdgeMove(); } });
document.getElementById('em_cancel').addEventListener('click', () => cancelEdgeMove());
// переключатель торцов: пересчитываем соседей и повторяем предпросмотр
function setEdgeEnd(mode){
  if(!edgeDrag || edgeDrag.endMode === mode) return;
  edgeDrag.endMode = mode;
  edgeDrag.slide = undefined;
  if(edgeDrag.lastD) applyEdgeDelta(edgeDrag.lastD.clone());
  updateEmPopup(edgeDrag.lastD || new THREE.Vector3());
}
document.getElementById('em_follow').addEventListener('click', () => setEdgeEnd('face'));
document.getElementById('em_straight').addEventListener('click', () => setEdgeEnd('straight'));
function cancelEdgeMove(){
  if(!edgeDrag) return;
  const pushed = edgeDrag.snapPushed;
  edgeDrag = null; setAxisLock(null); snapDot.visible = false;
  closeEmPopup();
  if(pushed) undo(true);
}
makeGripDrag(emPopup);
// Магнит переноса ребра (инференс Move в SketchUp): конец или середина
// ребра, пришедшие на экране ближе 14 px к точке привязки (поставленная
// точка P, вершина, центр, квадрант), прилипают к ней. Ребро едет целиком —
// параллельно себе, без перекоса; при замке (N, X/Y/Z) сдвиг берётся вдоль
// замка, и магнит срабатывает, только если конец так действительно на точку
// попадает
function edgeMoveSnap(d){
  const ed = edgeDrag, q0 = ed.q0;
  const pts = ed.pts0, last = ed.baseEnd;
  const handles = [pts[0]];
  if(last && last.distanceTo(pts[0]) > 1e-6) handles.push(last, pts[0].clone().lerp(last, 0.5));
  const lockDir = ed.nLock && ed.normal ? ed.normal
    : axisLock ? new THREE.Vector3(axisLock==='x'?1:0, axisLock==='y'?1:0, axisLock==='z'?1:0) : null;
  const targets = [];
  for(const a of anchors) targets.push({p: a.pos, what: 'point'});
  for(const q of quadSnaps) targets.push({p: q.pos, what: 'quadrant'});
  for(const c of auxSnaps) targets.push({p: c, what: 'center'});
  for(const c of corners) targets.push({p: c.pos, what: 'vertex'});
  const P = {x:0,y:0,z:0}, H = {x:0,y:0,z:0};
  let best = null, bestPx = 14;
  for(const t of targets){
    if(pts.some(p => p.distanceToSquared(t.p) < 1e-6)) continue; // своя же вершина
    projToQuad(t.p, q0.cam, q0.w, q0.h, P);
    if(!(P.z > -1 && P.z < 1)) continue;
    for(const h of handles){
      let dd = new THREE.Vector3().subVectors(t.p, h);
      if(lockDir){
        dd = lockDir.clone().multiplyScalar(dd.dot(lockDir));
        if(h.clone().add(dd).distanceTo(t.p) > 0.05) continue; // по замку на точку не попасть
      }
      projToQuad(h.clone().add(d), q0.cam, q0.w, q0.h, H);
      const px = Math.hypot(H.x - P.x, H.y - P.y);
      if(px < bestPx){ bestPx = px; best = {d: dd, target: t.p, what: t.what}; }
    }
  }
  return best;
}
// Сгиб по N (линия вдавливается в грань): двигать только вершины линии мало —
// после булевых у линии узкие треугольники, и выходил шип, а не V. Грани по
// обе стороны линии (в её плоскости) сгибаются целиком: вершина на расстоянии
// x от линии сдвигается на d·(1 − x/L), L — дальняя точка грани с этой
// стороны. Стенка-прямоугольник даёт две ровные плоскости V; вершины на
// краях, общие с соседними гранями (верх, низ), едут вместе с ними
function edgeFoldInfo(){
  const ed = edgeDrag;
  if(ed.fold !== undefined) return ed.fold;
  ed.fold = null;
  const N = ed.normal, A = ed.pts0[0], B = ed.baseEnd;
  if(!N || !B || A.distanceTo(B) < 1e-6) return null;
  const u = new THREE.Vector3().subVectors(B, A).normalize();
  const side = new THREE.Vector3().crossVectors(u, N).normalize();
  const pos = mesh.geometry.attributes.position.array;
  const d0 = N.dot(A);
  const moving = new Set();
  for(const arr of ed.idx) for(const o of arr) moving.add(o);
  // затравки — треугольники этой плоскости, касающиеся линии
  const onLine = P => {
    const w = new THREE.Vector3().subVectors(P, A);
    const t = w.dot(u);
    return t > -0.012 && t < A.distanceTo(B) + 0.012 && w.addScaledVector(u, -t).length() < 0.012;
  };
  const patches = [];
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    let touch = false, inPlane = true;
    for(let j=0;j<3;j++){
      const P = new THREE.Vector3(pos[o+j*3], pos[o+j*3+1], pos[o+j*3+2]);
      if(Math.abs(N.dot(P) - d0) > 0.05){ inPlane = false; break; }
      if(onLine(P)) touch = true;
    }
    if(!inPlane || !touch || patches.some(p => p.set.has(t))) continue;
    if(Math.abs(triNormalAt(t).dot(N)) < 0.99) continue;
    patches.push(facePatchAt(t));
  }
  if(!patches.length) return null;
  // все копии вершины (по ключу): вершина края общая с соседней гранью
  const byKey = new Map();
  for(let i=0;i<pos.length;i+=3){
    const k = keyOf(pos[i], pos[i+1], pos[i+2]);
    let a = byKey.get(k); if(!a){ a = []; byKey.set(k, a); }
    a.push(i);
  }
  const verts = new Map(); // key -> {P, s}
  for(const p of patches) for(const t of p.tris) for(let j=0;j<3;j++){
    const o = t*9+j*3;
    const k = keyOf(pos[o], pos[o+1], pos[o+2]);
    if(verts.has(k)) continue;
    const P = new THREE.Vector3(pos[o], pos[o+1], pos[o+2]);
    verts.set(k, {P, s: new THREE.Vector3().subVectors(P, A).dot(side)});
  }
  let Lp = 0, Ln = 0;
  for(const v of verts.values()){ if(v.s > Lp) Lp = v.s; if(-v.s > Ln) Ln = -v.s; }
  const offs = [];
  ed.foldW = new Map(); // ключ вершины -> вес сгиба (для концов линий на грани)
  for(const [k, v] of verts){
    const L = v.s >= 0 ? Lp : Ln;
    if(L < 1e-6) continue;
    const w = 1 - Math.abs(v.s) / L;
    if(w <= 1e-6) continue;
    ed.foldW.set(k, w);
    for(const o of byKey.get(k) || []){
      if(moving.has(o)) continue;
      offs.push({o, P0: v.P, w});
    }
  }
  // пустой список сдвигов тоже годится: у простой грани двигаются только
  // вершины линии, а края граней (Lp, Ln) нужны вырезу клина
  ed.fold = (Lp > 1e-6 || Ln > 1e-6) ? {offs, Lp, Ln, side} : null;
  return ed.fold;
}
// Концы линии на рёбрах соседних граней (стенка кармана → наружная стенка):
// чистый сдвиг по нормали выводил конец из плоскости соседа — наружная грань
// кривилась, и её контур потом не заливался одной гранью. Конец дополнительно
// скользит вдоль самой линии ровно настолько, чтобы остаться в плоскости
// соседа: e = s·(N + k·u), k = −(N·n)/(u·n). Сдвиг вдоль линии не выводит
// половинки V из их плоскостей (обе их границы параллельны u), поэтому V
// остаётся ровной, а соседние грани — плоскими
function edgeSlideInfo(){
  const ed = edgeDrag;
  if(ed.slide !== undefined) return ed.slide;
  ed.slide = null;
  const N = ed.normal, A = ed.pts0[0], B = ed.baseEnd;
  if(!N || !B) return null;
  const L = A.distanceTo(B);
  if(L < 1e-6) return null;
  const u = new THREE.Vector3().subVectors(B, A).normalize();
  // End: Straight — торцы поперёк линии, ровно на её концах. Линия сохраняет
  // длину, на соседней грани появляется новое ребро (Press/Pull, который
  // режет всё на пути). Follow face (по умолчанию) — торцы ложатся в
  // плоскости соседних граней, и конец линии едет вдоль неё вместе с ними
  if(ed.endMode === 'straight'){
    ed.slide = {A, u, L, N, kA: 0, kB: 0, nA: null, nB: null};
    return ed.slide;
  }
  const pos = ed.snap.pos;
  // Соседняя грань у конца линии. Раньше: треугольник с ВЕРШИНОЙ в 0.012 мм
  // от конца, из них самый большой. Конец посреди ребра сетки не находил
  // соседа (торец клина вставал поперёк — лишний вырез), а щепка у угла давала
  // чужую нормаль. Теперь: треугольники, которых конец касается любой точкой,
  // группы с почти одинаковой нормалью, побеждает наибольшая суммарная площадь,
  // нормаль — среднее по площади
  const tri = new THREE.Triangle(), cp = new THREE.Vector3();
  const kAt = E => {
    const groups = [];
    for(let t=0;t<pos.length/9;t++){
      const o = t*9;
      if(Math.min(pos[o], pos[o+3], pos[o+6]) > E.x + 0.012 || Math.max(pos[o], pos[o+3], pos[o+6]) < E.x - 0.012 ||
         Math.min(pos[o+1], pos[o+4], pos[o+7]) > E.y + 0.012 || Math.max(pos[o+1], pos[o+4], pos[o+7]) < E.y - 0.012 ||
         Math.min(pos[o+2], pos[o+5], pos[o+8]) > E.z + 0.012 || Math.max(pos[o+2], pos[o+5], pos[o+8]) < E.z - 0.012) continue;
      tri.set(new THREE.Vector3().fromArray(pos, o), new THREE.Vector3().fromArray(pos, o+3), new THREE.Vector3().fromArray(pos, o+6));
      if(tri.closestPointToPoint(E, cp).distanceTo(E) > 0.012) continue;
      const w = new THREE.Vector3(pos[o+3]-pos[o], pos[o+4]-pos[o+1], pos[o+5]-pos[o+2])
        .cross(new THREE.Vector3(pos[o+6]-pos[o], pos[o+7]-pos[o+1], pos[o+8]-pos[o+2]));
      const ar = w.length();
      if(ar < 1e-4) continue;
      const n = w.clone().multiplyScalar(1/ar);
      if(Math.abs(n.dot(N)) > 0.99 || Math.abs(n.dot(u)) < 0.05) continue; // своя грань / вдоль линии
      const c = new THREE.Vector3(pos[o]+pos[o+3]+pos[o+6], pos[o+1]+pos[o+4]+pos[o+7], pos[o+2]+pos[o+5]+pos[o+8]).multiplyScalar(ar / 3);
      const g = groups.find(q => q.n.dot(n) > 0.999);
      if(g){ g.sum.add(w); g.ar += ar; g.c.add(c); } else groups.push({n, sum: w.clone(), ar, c});
    }
    groups.sort((p, q) => q.ar - p.ar);
    const best = groups.length ? groups[0].sum.normalize() : null;
    if(!best) return {k: 0, n: null};
    // точка самой соседней грани (центр масс треугольников группы): торец клина
    // кладём в её плоскость, а не в плоскость через конец линии — конец бывает
    // не точно в углу (привязка к сетке 0.1), и оставалась тонкая стенка
    const onFace = groups[0].c.multiplyScalar(1 / groups[0].ar);
    const k = -N.dot(best) / u.dot(best);
    return Math.abs(k) <= 5 ? {k, n: best, p: onFace} : {k: 0, n: null};
  };
  const ra = kAt(A), rb = kAt(B);
  ed.slide = {A, u, L, N, kA: ra.k, kB: rb.k, nA: ra.n, nB: rb.n, pA: ra.p, pB: rb.p};
  return ed.slide;
}
// точка внутри тела? чётность пересечений луча с треугольниками сетки
function pointInsideMesh(P, pos){
  const dir = new THREE.Vector3(0.5773, 0.5774, 0.5775).normalize();
  const ray = new THREE.Ray(P, dir), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  let n = 0;
  for(let o=0;o<pos.length;o+=9){
    a.fromArray(pos, o); b.fromArray(pos, o+3); c.fromArray(pos, o+6);
    if(ray.intersectTriangle(a, b, c, false, hit)) n++;
  }
  return n % 2 === 1;
}
// Вдавить линию по N внутрь — это вырез клина, а не сгиб сетки: у конца линии
// на соседней грани (наружная стенка обода) сгиб складывал её треугольники
// внахлёст. Клин: сечение — треугольник (края граней по обе стороны линии в
// плоскости грани и вершина на глубине) плюс запас наружу, вдоль линии — до
// плоскостей соседних граней у концов; если за соседней гранью пусто, клин
// выходит за неё на запас и режет соседа ровным V-вырезом
function edgeMoveCutPrism(s, extra = 0){
  const ed = edgeDrag, fold = ed.fold, sl = ed.slide;
  if(!fold || !sl || s > -0.01) return null;
  const {A, u, L, N} = sl, side = fold.side;
  const m = Math.max(1, -s * 0.5);
  // Сечение (вдоль side, вдоль N), выпуклое, обход фиксируем по объёму ниже.
  // Стороны V продлены по своей же прямой за линии сгиба на e: раньше угол
  // сечения стоял ровно на сгибе и уходил наружу по плоскости соседней грани —
  // клин лежал в плоскостях верха и низа шестерни, а с щепками прошлой
  // канавки это давало сотни крошечных областей и щели (вторая канавка на
  // той же впадине). Форма канавки та же — клин пересекает соседей поперёк
  const e = Math.max(1, -s * 0.5);
  const ext = (a) => { const len = Math.hypot(a, -s); return [a + a / len * e, -s / len * e]; };
  const [pa, pb] = ext(fold.Lp), [na, nb] = ext(-fold.Ln), top = Math.max(pb, nb) + m;
  const sec = [[pa, pb], [pa, top], [na, top], [na, nb], [0, s]];
  const capT = (n, tEnd, a, b) => {
    if(!n) return tEnd;
    const un = u.dot(n);
    if(Math.abs(un) < 1e-6) return tEnd;
    // точка сечения на плоскости соседа — через саму соседнюю грань, если она
    // найдена (конец линии мог лечь не точно в угол), иначе через конец линии
    const p = n === sl.nA ? sl.pA : n === sl.nB ? sl.pB : null;
    const off = p ? n.dot(new THREE.Vector3().subVectors(p, A.clone().addScaledVector(u, tEnd))) : 0;
    return tEnd + (off - a * side.dot(n) - b * N.dot(n)) / un;
  };
  const snapPos = ed.snap.pos;
  const margin = (n, tEnd, sign) => {
    if(!n) return 0;
    // За соседом пусто? Раньше — одна точка на середине глубины: если соседняя
    // грань уже надрезана прошлой канавкой, точка падала в её пустоту, и клин
    // уходил на 8 мм сквозь соседа (лишний вырез, разные объёмы у одинаковых
    // зубьев). Теперь точки по всему сечению V — продлеваем, только если пусто везде
    const probes = [[0, s * 0.5], [0, s * 0.9], [fold.Lp * 0.5, s * 0.25], [-fold.Ln * 0.5, s * 0.25],
                    [fold.Lp * 0.2, s * 0.6], [-fold.Ln * 0.2, s * 0.6]];
    for(const [a, b] of probes){
      const t = capT(n, tEnd, a, b) + sign * 0.3;
      const Q = A.clone().addScaledVector(side, a).addScaledVector(N, b).addScaledVector(u, t);
      if(pointInsideMesh(Q, snapPos)) return 0;
    }
    return Math.max(2, fold.Lp, fold.Ln, -s) * 1.5;
  };
  // extra — торцы чуть за плоскостью соседа: при повторе, если торец лёг
  // ровно на уже изменённую соседнюю грань и точная булева не прошла
  const mA = margin(sl.nA, 0, -1) + extra, mB = margin(sl.nB, L, +1) + extra;
  const P = (a, b, t) => A.clone().addScaledVector(side, a).addScaledVector(N, b).addScaledVector(u, t);
  const S = sec.map(([a, b]) => P(a, b, capT(sl.nA, 0, a, b) - mA));
  const E = sec.map(([a, b]) => P(a, b, capT(sl.nB, L, a, b) + mB));
  const tris = [];
  for(let i=1;i+1<sec.length;i++){ tris.push([S[0], S[i+1], S[i]]); tris.push([E[0], E[i], E[i+1]]); }
  for(let i=0;i<sec.length;i++){
    const j = (i+1) % sec.length;
    tris.push([S[i], S[j], E[j]]); tris.push([S[i], E[j], E[i]]);
  }
  let vol = 0;
  for(const [p, q, r] of tris) vol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
  if(vol < 0) for(const t of tris){ const x = t[1]; t[1] = t[2]; t[2] = x; }
  return tris;
}
function applyEdgeDelta(d, e){
  if(!edgeDrag.snapPushed){
    pushHistory(edgeDrag.snap);
    edgeDrag.snapPushed = true;
  }
  edgeDrag.lastD = d.clone();
  const posE = mesh.geometry.attributes.position.array;
  // сгиб граней — только при движении по нормали (N); без N грани на место
  const fold = edgeDrag.nLock ? edgeFoldInfo() : (edgeDrag.fold || null);
  const slide = edgeDrag.nLock ? edgeSlideInfo() : null;
  // сдвиг точки: по нормали на глубину, плюс скольжение вдоль линии, чтобы
  // конец остался в плоскости соседней грани (см. edgeSlideInfo)
  const disp = (P, w) => {
    if(!slide) return d.clone().multiplyScalar(w);
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, slide.A).dot(slide.u) / slide.L));
    const s = d.dot(slide.N), k = slide.kA + (slide.kB - slide.kA) * t;
    return slide.N.clone().multiplyScalar(s * w).addScaledVector(slide.u, s * k * w);
  };
  if(fold) for(const f of fold.offs){
    const np = edgeDrag.nLock ? f.P0.clone().add(disp(f.P0, f.w)) : f.P0;
    posE[f.o] = np.x; posE[f.o+1] = np.y; posE[f.o+2] = np.z;
  }
  // нарисованные линии едут вместе с ребром: сама линия — целиком, линии,
  // упёршиеся в неё, — своим концом, линии на сгибаемой грани — по весу сгиба.
  // Раньше линия оставалась на старом месте и висела в воздухе красной
  for(const r of edgeDrag.guideMoves){
    const wOf = (on, k) => on ? 1 : (edgeDrag.nLock && edgeDrag.foldW && edgeDrag.foldW.get(k)) || 0;
    const wa = wOf(r.onA, r.kA), wb = wOf(r.onB, r.kB);
    r.g.a.copy(r.a0).add(disp(r.a0, wa));
    r.g.b.copy(r.b0).add(disp(r.b0, wb));
    r.g.line.geometry.dispose();
    r.g.line.geometry = new THREE.BufferGeometry().setFromPoints([r.g.a, r.g.b]);
  }
  for(let i=0;i<edgeDrag.pts0.length;i++){
    const np = edgeDrag.pts0[i].clone().add(disp(edgeDrag.pts0[i], 1));
    for(const bi of edgeDrag.idx[i]){ posE[bi]=np.x; posE[bi+1]=np.y; posE[bi+2]=np.z; }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  normalsThrottled();
  updateEmPopup(d);
  if(!modified){ modified=true; s_mod.textContent='yes'; }
}
// введённое число: сдвиг на столько вдоль нормали (N), оси (X/Y/Z) или
// направления, куда уже тянули мышью (VCB SketchUp, ввод числа в G Blender)
function applyEdgeTyped(){
  let v = parseFloat(edgeDrag.typed.replace(',', '.'));
  // по нормали без явного минуса знак берём, куда вела мышь: потянул в тело
  // и набрал 5.5 — это 5.5 в тело
  if(edgeDrag.nLock && isFinite(v) && !edgeDrag.typed.includes('-') && edgeDrag.mouseSign < 0) v = -v;
  let dir = null;
  if(edgeDrag.nLock && edgeDrag.normal) dir = edgeDrag.normal.clone();
  else if(axisLock) dir = new THREE.Vector3(axisLock==='x'?1:0, axisLock==='y'?1:0, axisLock==='z'?1:0);
  else if(edgeDrag.lastD && edgeDrag.lastD.lengthSq() > 1e-9) dir = edgeDrag.lastD.clone().normalize();
  if(!dir){ updateEmPopup(new THREE.Vector3(), 'pick a direction: drag, Shift, X/Y/Z or N'); return; }
  applyEdgeDelta(dir.multiplyScalar(isFinite(v) ? v : 0));
}
function finishEdgeMove(){
  // по N внутрь — честный вырез клина вместо сгиба (сгиб — только предпросмотр)
  const ed = edgeDrag;
  if(ed && ed.nLock && ed.lastD && ed.normal && ed.snapPushed){
    const s = ed.lastD.dot(ed.normal);
    edgeSlideInfo();
    const moved = mesh.geometry.attributes.position.array.slice();
    const vSnap = meshVolumeOf(ed.snap.pos), vFold = meshVolumeOf(moved);
    // второй заход — торцы клина на 0.05 мм за плоскостью соседа: если торец
    // лёг ровно на соседнюю грань, уже изменённую прошлой канавкой, почти
    // совпадающие грани не дают точной булевой замкнуть результат
    for(const extra of [0, 0.05]){
      const prism = edgeMoveCutPrism(s, extra);
      if(!prism) break;
      try{
        const sp = ed.snap.pos, body = [];
        for(let i=0;i<sp.length;i+=9)
          body.push([new THREE.Vector3(sp[i],sp[i+1],sp[i+2]), new THREE.Vector3(sp[i+3],sp[i+4],sp[i+5]),
                     new THREE.Vector3(sp[i+6],sp[i+7],sp[i+8])]);
        // только точный путь: BSP на шестерне считал 17 с и рвал сетку (сотни
        // щелей, дальше каждый зубец хуже); сгиб предпросмотра замкнут — лучше он
        const res = exactBool(body, prism, 'subtract');
        if(!res) throw new Error('exact wedge cut failed');
        const q = x => Math.round(x*1000)/1000, arr = [];
        for(const t of res){
          const k = t.map(v => keyOf(v.x, v.y, v.z));
          if(k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; // иглы не трогаем — см. openEdgesOfTris
          for(const v of t) arr.push(q(v.x), q(v.y), q(v.z));
        }
        setMeshFromArray(new Float32Array(arr));
        healAfterBool();
        if(openEdgeCount() || nonManifoldEdgeCount()) throw new Error('wedge cut left gaps');
        // замкнуто, но почти ничего не снято (классификация приняла клин за
        // пустой) — это не канавка: сгиб предпросмотра снимал заметный объём
        const vCut = meshVolumeOf(mesh.geometry.attributes.position.array);
        if(vFold - vSnap < -1 && vCut - vSnap > (vFold - vSnap) * 0.5) throw new Error('wedge cut removed too little');
        lastBoolPath = 'exact';
        // линия канавки уехала со сгибом дальше выреза, хорды сверху частично
        // срезаны — повисшие в воздухе линии убираем: край выреза теперь ребро
        dropAirGuides();
        break;
      }catch(err){
        console.warn('edge cut failed' + (extra ? ' (retry)' : ''), err);
        setMeshFromArray(moved); // остаётся сгиб
        lastBoolPath = '';
      }
    }
  }
  edgeDrag = null; setAxisLock(null); snapDot.visible = false; closeEmPopup();
  tipHide(); normalsFlush(); extractEdges();
}

// палитра операций для выбранного ребра — как у грани и точки;
// в шапке данные объекта, F не упоминаем — подскажем при замкнутом контуре
// сводка по кривой: радиус по всем её точкам и число сегментов
function curveInfo(id){
  const cs = chains.filter(c=>c.curve === id);
  if(!cs.length) return null;
  const pts = [];
  for(const c of cs) for(const p of c.pts) pts.push(p);
  const ctr = new THREE.Vector3();
  for(const p of pts) ctr.add(p);
  ctr.multiplyScalar(1/pts.length);
  let R = 0, segs = 0;
  for(const p of pts) R += p.distanceTo(ctr);
  for(const c of cs) segs += c.pts.length - 1;
  return {R: R/pts.length, ctr, segs};
}
// Что выбрано, если рёбер несколько (после B, Ctrl+клика). Выбор делится на
// части: окружность (нарисованная кривая целиком и/или замкнутое круглое
// ребро тела — лежащие друг на друге считаются одной), остальные рёбра —
// по связности концов: квадрат, прямоугольник, замкнутый контур, цепочка.
// Каждую часть палитра показывает карточкой: наведение — жёлтым на модели,
// клик — выбрать только её
function describeEdgeSel(){
  const byKey = new Map(chains.map(c => [edgeSelKey(c), c]));
  const sel = edgeSel.map(s => byKey.get(s.key)).filter(Boolean);
  const groups = [];
  const curveIds = new Set();
  const rest = [];
  for(const c of sel){
    if(c.curve){ curveIds.add(c.curve); continue; }
    const arc = c.closed && c.pts.length >= 7 ? fitArc(c) : null;
    if(arc) groups.push({kind: 'circle', R: arc.R, segs: c.pts.length - 1, body: true, ctr: arc.center, chains: [c]});
    else rest.push(c);
  }
  for(const id of curveIds){
    const all = chains.filter(c => c.curve === id);
    const inSel = sel.filter(c => c.curve === id);
    if(inSel.length !== all.length){ rest.push(...inSel); continue; }
    const ci = curveInfo(id);
    // кривая на круглом ребре тела — одна окружность: данные кривой, рёбра обоих
    const twin = groups.find(g => g.kind === 'circle' && g.body && Math.abs(g.R - ci.R) < 0.05 && g.ctr.distanceTo(ci.ctr) < 0.05);
    if(twin){ Object.assign(twin, {R: ci.R, segs: ci.segs, body: false, ctr: ci.ctr}); twin.chains.push(...inSel); }
    else groups.push({kind: 'circle', R: ci.R, segs: ci.segs, body: false, ctr: ci.ctr, chains: inSel});
  }
  // остальное — связные куски по общим концам
  const K = p => keyOf(p.x, p.y, p.z);
  const par = rest.map((_, i) => i);
  const root = i => { while(par[i] !== i){ par[i] = par[par[i]]; i = par[i]; } return i; };
  const byEnd = new Map();
  rest.forEach((c, i) => {
    for(const P of [c.pts[0], c.pts[c.pts.length-1]]){
      const k = K(P);
      if(byEnd.has(k)){ const r1 = root(i), r2 = root(byEnd.get(k)); if(r1 !== r2) par[r1] = r2; }
      else byEnd.set(k, i);
    }
  });
  const comps = new Map();
  rest.forEach((c, i) => { const r = root(i); if(!comps.has(r)) comps.set(r, []); comps.get(r).push(c); });
  for(const cs of comps.values()){
    const deg = new Map();
    for(const c of cs) for(const P of [c.pts[0], c.pts[c.pts.length-1]]) deg.set(K(P), (deg.get(K(P))||0) + 1);
    const closed = cs.length > 1 && [...deg.values()].every(d => d === 2);
    const len = cs.reduce((sum, c) => sum + c.total, 0);
    const straight = c => { const A = c.pts[0], B = c.pts[c.pts.length-1], d = new THREE.Vector3().subVectors(B, A);
      return d.length() > 1e-6 && Math.abs(c.total - d.length()) < 1e-3; };
    let kind = closed ? 'contour' : 'chain', dims = null;
    if(closed && cs.length === 4 && cs.every(straight)){
      const dir = c => new THREE.Vector3().subVectors(c.pts[c.pts.length-1], c.pts[0]).normalize();
      // у прямоугольника каждое ребро перпендикулярно двум соседним
      const perp = cs.every(c => cs.filter(o => o !== c && Math.abs(dir(o).dot(dir(c))) < 1e-3).length === 2);
      if(perp){
        const ls = cs.map(c => c.total).sort((x, y) => x - y);
        dims = [ls[0], ls[3]];
        kind = Math.abs(ls[0] - ls[3]) < 0.05 ? 'square' : 'rectangle';
      }
    }
    groups.push({kind, chains: cs, len, dims,
      lines: cs.filter(c => c.isGuide).length, edges: cs.filter(c => !c.isGuide).length});
  }
  return {groups, sel,
    guidesOnly: sel.length > 0 && sel.every(c => c.isGuide),
    bodyStraight: sel.length > 0 && !groups.some(g => g.kind === 'circle')
      && sel.every(c => !c.isGuide && !c.closed)};
}
// подсветка части выбора при наведении на её карточку: жёлтые линии поверх,
// зелёные линии этих рёбер на время прячутся (иначе мерцают вперемешку)
let selCardHi = {lines: [], hidden: []};
function unhiSelGroup(){
  for(const l of selCardHi.lines){ scene.remove(l); l.geometry.dispose(); }
  for(const sl of selCardHi.hidden) sl.visible = true;
  selCardHi = {lines: [], hidden: []};
}
function hiSelGroup(g){
  unhiSelGroup();
  for(const ch of g.chains){
    const key = edgeSelKey(ch);
    const s = edgeSel.find(x => x.key === key);
    if(s && s.line.visible){ s.line.visible = false; selCardHi.hidden.push(s.line); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ch.pts),
      new THREE.LineBasicMaterial({color: C_EDGE}));
    l.renderOrder = 3; scene.add(l); selCardHi.lines.push(l);
  }
}
function showEdgePalette(ch){
  unhiSelGroup();
  const d = edgeSel.length ? describeEdgeSel() : null;
  // одна нарисованная окружность и одно ребро/отрезок — прежняя палитра
  // (у отрезка там концы с координатами); круглое ребро тела и составной
  // выбор — сводка по частям
  const g0 = d && d.groups.length === 1 ? d.groups[0] : null;
  const plainCircle = g0 && g0.kind === 'circle' && !g0.body && g0.chains.every(c => c.curve);
  if(d && d.groups.length && !plainCircle && !(edgeSel.length === 1 && (!g0 || g0.kind !== 'circle'))){
    showEdgeSelSummary(d);
    return;
  }
  tipHide();
  showSelEnds(ch && ch.curve ? null : ch); // концы — только у отрезка
  const arc = ch && fitArc(ch);
  const cur = ch && ch.curve ? curveInfo(ch.curve) : null;
  const info = cur
    ? 'Circle<br>Ø <b>' + (cur.R*2).toFixed(1) + '</b> mm'
      + '<br>R ' + cur.R.toFixed(1) + ' mm<br>' + cur.segs + ' segments'
    : (ch
      ? (ch.isGuide ? 'Line' : 'Edge') + ' · ' + ch.total.toFixed(1) + ' mm'
        + (arc ? ' · R ' + arc.R.toFixed(1) + ' mm' : '')
      : 'Edge');
  // цифры координат — в цветах осей; сама точка-маркер золотая/серебряная
  const fmt = p =>
    '<span style="color:'+AXIS_CSS.x+'">'+p.x.toFixed(1)+'</span> · ' +
    '<span style="color:'+AXIS_CSS.y+'">'+p.y.toFixed(1)+'</span> · ' +
    '<span style="color:'+AXIS_CSS.z+'">'+p.z.toFixed(1)+'</span>';
  const ends = (ch && !ch.closed && !cur)
    ? '<div style="font-weight:600"><span style="color:#f5c542">●</span> ' + fmt(ch.pts[0]) + '</div>' +
      '<div style="font-weight:600"><span style="color:#c9d1dc">●</span> ' + fmt(ch.pts[ch.pts.length-1]) + '</div>'
    : '';
  const vr = view.getBoundingClientRect();
  // размеры и координаты — данные, видны всегда; команды гасятся флагом
  chordHint.innerHTML = CH_GRIP +
    '<div style="color:var(--text);font-weight:600">' + info + '</div>' + ends +
    (!hintsChk.checked ? '' :
    '<div><span class="key">M</span> — move edge</div>' +
    '<div><span class="key">G,V</span> — move by X/Y/Z</div>' +
    '<div><span class="key">G,Y</span> — point / divide</div>' +
    '<div><span class="key">Del</span> — erase edge / line</div>' +
    (edgeSel.length === 1 && ch && !ch.closed ? '<div><span class="key">B</span> — select the closed contour through it</div>' : '') +
    (() => { // выбран замкнутый контур, который можно залить
      const lp = edgeSelLoop();
      if(!lp) return '';
      const f = loopFillPieces(lp);
      const flat = '<div><span class="key">Shift+F</span> — one flat face: replace what’s inside</div>';
      if(f && f.covered && !f.air.length) return flat;
      return '<div><span class="key">F</span> — ' + (f && f.covered ? 'fill the empty part' : 'fill face') + '</div>' + flat;
    })() +
    (ch && !ch.isGuide ? '<div><span class="key">Ctrl+B</span> — chamfer / fillet</div>' : '') +
    (ch && ch.isGuide ? '<div><span class="key">Q</span> — rotate / copy</div>'
      + '<div><span class="key">G,A</span> — polar array</div>' : '') +
    '<div><span class="key">Ctrl+click</span> — multi-select</div>' +
    '<div style="opacity:.55">Esc — deselect</div>');
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 420) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 170) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t); // палитра выбора живёт, пока выбор жив
}
function showEdgeSelSummary(d){
  tipHide(); hideSelEnds(); unhiSelGroup();
  const ind = t => '<div style="padding-left:18px">' + t + '</div>';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const card = g => {
    if(g.kind === 'circle')
      return 'Circle' + (g.body ? ' <span style="opacity:.6">(edge of the body)</span>' : '')
        + ind('Ø <b>' + (2*g.R).toFixed(1) + '</b> mm') + ind('R ' + g.R.toFixed(1) + ' mm') + ind(g.segs + ' segments');
    const what = [g.edges ? plural(g.edges, 'edge', 'edges') : '', g.lines ? plural(g.lines, 'line', 'lines') : '']
      .filter(Boolean).join(' + ');
    if(g.kind === 'square') return 'Square' + ind('side <b>' + g.dims[0].toFixed(1) + '</b> mm') + ind(what);
    if(g.kind === 'rectangle') return 'Rectangle' + ind('<b>' + g.dims[1].toFixed(1) + ' × ' + g.dims[0].toFixed(1) + '</b> mm') + ind(what);
    return (g.kind === 'contour' ? 'Closed contour' : (g.chains.length === 1 ? (g.lines ? 'Line' : 'Edge') : 'Chain'))
      + ind('<b>' + g.len.toFixed(1) + '</b> mm') + (g.chains.length > 1 ? ind(what) : '');
  };
  const many = d.groups.length > 1;
  const info = many
    ? 'Selection · ' + d.groups.length + ' parts'
      + '<div style="font-size:.8em;font-weight:400;opacity:.6">hover — show · click — select only it</div>'
      + d.groups.map((g, i) => '<div class="selcard" data-g="' + i + '">' + card(g) + '</div>').join('')
    : card(d.groups[0]);
  const lp = edgeSelLoop();
  let fillRow = '';
  if(lp){
    const f = loopFillPieces(lp);
    if(!(f && f.covered && !f.air.length))
      fillRow = '<div><span class="key">F</span> — ' + (f && f.covered ? 'fill the empty part' : 'fill face') + '</div>';
    fillRow += '<div><span class="key">Shift+F</span> — one flat face: replace what’s inside</div>';
  } else if(edgeSel.length === 1){
    fillRow = '<div><span class="key">B</span> — select the closed contour through it</div>';
  }
  const vr = view.getBoundingClientRect();
  chordHint.innerHTML = CH_GRIP +
    '<div style="color:var(--text);font-weight:600">' + info + '</div>' +
    (!hintsChk.checked ? '' :
    fillRow +
    (d.guidesOnly ? '<div><span class="key">Q</span> — rotate / copy</div>'
      + '<div><span class="key">G,A</span> — polar array</div>' : '') +
    (d.bodyStraight ? '<div><span class="key">Ctrl+B</span> — chamfer / fillet</div>' : '') +
    '<div><span class="key">Del</span> — erase edges / lines</div>' +
    '<div><span class="key">Ctrl+click</span> — add / remove</div>' +
    '<div style="opacity:.55">Esc — deselect</div>');
  if(many){
    for(const el of chordHint.querySelectorAll('.selcard')){
      const g = d.groups[+el.dataset.g];
      el.addEventListener('mouseenter', ()=>hiSelGroup(g));
      el.addEventListener('mouseleave', unhiSelGroup);
      el.addEventListener('click', ev=>{
        ev.stopPropagation();
        unhiSelGroup();
        clearEdgeSel();
        for(const ch of g.chains) toggleEdgeSel(ch);
        showEdgePalette(g.chains[0]);
      });
    }
  }
  chordHint.style.left = Math.min(lastMX - vr.left + 44, vr.width - 460) + 'px';
  chordHint.style.top  = Math.min(lastMY - vr.top + 20, vr.height - 170) + 'px';
  chordHint.hidden = false;
  clearTimeout(showChordHint._t);
}
function deleteSelAnchor(){
  if(!selAnchor) return;
  pushUndo(); // снимок хранит и точки — Ctrl+Z вернёт
  const i = anchors.indexOf(selAnchor);
  scene.remove(selAnchor.marker);
  if(i >= 0) anchors.splice(i, 1);
  deselect(); hideChordHint();
}
function deselect(){
  sel = null; selAnchor = null; selMarker.visible = false;
  for(const a of anchors) if(a.marker) a.marker.visible = true;
  vpanel.hidden = true; clearRingMarkers();
}

// перенос всех совпадающих вершин буфера в новую позицию
function moveVerticesByKey(oldPos, newPos){
  const pos = mesh.geometry.attributes.position.array;
  const k0 = keyOf(oldPos.x, oldPos.y, oldPos.z);
  for(let i=0;i<pos.length;i+=3)
    if(keyOf(pos[i],pos[i+1],pos[i+2])===k0){ pos[i]=newPos.x; pos[i+1]=newPos.y; pos[i+2]=newPos.z; }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  if(!modified){ modified=true; s_mod.textContent='yes'; }
}
for(const inp of [vx,vy,vz]) inp.addEventListener('change', ()=>{
  if(!sel && !selAnchor && !vpEdge) return;
  pushUndo();
  const np = new THREE.Vector3(snapMM(+vx.value||0), snapMM(+vy.value||0), snapMM(+vz.value||0));
  if(vpEdge){
    // ребро/линия: числа задают новую СЕРЕДИНУ — сдвигаем все точки на дельту
    const d = np.clone().sub(vpEdge.mid);
    const posE = mesh.geometry.attributes.position.array;
    for(let i=0;i<vpEdge.pts0.length;i++){
      const p2 = vpEdge.pts0[i].add(d);
      for(const bi of vpEdge.idx[i]){ posE[bi]=p2.x; posE[bi+1]=p2.y; posE[bi+2]=p2.z; }
    }
    vpEdge.mid.copy(np);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    if(!modified){ modified=true; s_mod.textContent='yes'; }
    // extractEdges пересобирает цепочки и сбрасывает выбор — переизбираем
    // сдвинутое ребро (по новым концам) и возвращаем окно на место
    const a = vpEdge.pts0[0].clone(), b = vpEdge.pts0[vpEdge.pts0.length-1].clone();
    const L = vpanel.style.left, T = vpanel.style.top;
    extractEdges();
    const K = p=>keyOf(p.x,p.y,p.z);
    const nch = chains.find(c=>!c.closed &&
      ((K(c.pts[0])===K(a) && K(c.pts[c.pts.length-1])===K(b)) ||
       (K(c.pts[0])===K(b) && K(c.pts[c.pts.length-1])===K(a))));
    if(nch){
      toggleEdgeSel(nch); showSelEnds(nch);
      const pts = nch.pts.map(p=>p.clone());
      const im = buildIndexMap(pts);
      vpEdge = {pts0: pts, idx: pts.map(p=>im.get(keyOf(p.x,p.y,p.z))||[]),
                mid: pts[0].clone().add(pts[pts.length-1]).multiplyScalar(0.5)};
      vp_t.textContent = nch.isGuide ? 'Line' : 'Edge';
      vpanel.style.left = L; vpanel.style.top = T; vpanel.hidden = false;
      updateVPanel();
    }
    return;
  }
  if(selAnchor){
    // точка, врезанная в ребро, тянет за собой и совпадающие вершины сетки
    moveVerticesByKey(selAnchor.pos, np);
    selAnchor.pos.copy(np); selAnchor.marker.position.copy(np);
  } else {
    moveVerticesByKey(sel.pos, np);
    sel.pos.copy(np);
  }
  selMarker.position.copy(np);
  updateVPanel(); extractEdges();
});
function makeAnchor(p){
  // поставленная точка — белая с обводкой, как вершина эскиза FreeCAD
  const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:0xf7f9fc})));
  m.position.copy(p); scene.add(m);
  const a = {pos:p.clone(), marker:m};
  anchors.push(a);
  return a;
}
function clearAnchors(){
  for(const a of anchors){ scene.remove(a.marker); }
  anchors = [];
}

// ---------- отмена (Ctrl+Z) ----------
let undoStack = [];
function takeSnapshot(){
  return {
    pos: mesh.geometry.attributes.position.array.slice(),
    anchors: anchors.map(a=>({pos: a.pos.clone(),
      bend: a.bend ? {pts0: a.bend.pts0.map(p=>p.clone()), t: a.bend.t.slice(), j: a.bend.j} : null})),
    guides: guides.map(g=>({a: g.a.clone(), b: g.b.clone(), noExt: g.noExt, curve: g.curve})),
    hard: hardEdges.map(h=>({a: h.a.clone(), b: h.b.clone()}))
  };
}
let redoStack = [];
// любое новое действие пишет историю и обнуляет ветку повтора
function pushHistory(snap){
  undoStack.push(snap);
  if(undoStack.length>30) undoStack.shift();
  redoStack = [];
}
function pushUndo(){ pushHistory(takeSnapshot()); }
function applySnapshot(s){
  setMeshFromArray(s.pos);
  hardEdges = (s.hard || []).map(h=>({a: h.a.clone(), b: h.b.clone()}));
  clearAnchors();
  for(const sa of s.anchors){ const a = makeAnchor(sa.pos); if(sa.bend) a.bend = sa.bend; }
  restoreGuides(s.guides || []);
  deselect(); closePopup(); tipHide(); hidePatch(); ppPatch=null;
  extractEdges();
}
function undo(noRedo){
  const s = undoStack.pop();
  if(!s) return;
  if(!noRedo){ // текущее состояние — в ветку повтора (Ctrl+Shift+Z)
    redoStack.push(takeSnapshot());
    if(redoStack.length>30) redoStack.shift();
  }
  applySnapshot(s);
  modified = undoStack.length > 0;
  s_mod.textContent = modified ? 'yes' : 'no';
}
function redo(){
  const s = redoStack.pop();
  if(!s) return;
  undoStack.push(takeSnapshot()); // напрямую: ветку повтора не сбрасываем
  if(undoStack.length>30) undoStack.shift();
  applySnapshot(s);
  modified = true;
  s_mod.textContent = 'yes';
}

// ---------- подсветка наведённой цепочки ----------
function setHover(h, isMid){
  hover = h;
  if(hiLine){ scene.remove(hiLine); hiLine.geometry.dispose(); hiLine=null; }
  if(h){
    const g = new THREE.BufferGeometry().setFromPoints(h.chain.pts);
    hiLine = new THREE.Line(g, new THREE.LineBasicMaterial({color:C_EDGE}));
    scene.add(hiLine);
    ghost.material.color.setHex(isMid ? C_MID : C_EDGE);
    ghost.position.copy(chainPointAt(h.chain, h.s));
    ghost.visible = true;
  } else if(!placing){
    ghost.visible = false;
  }
  if(guides.length) syncGuideOverlays();
}

// ---------- окружности и дуги ----------
// окружность через 3 точки (в 3D): центр, нормаль плоскости, радиус
function circle3(A,B,C){
  const ab = new THREE.Vector3().subVectors(B,A);
  const ac = new THREE.Vector3().subVectors(C,A);
  const n = new THREE.Vector3().crossVectors(ab,ac);
  const n2 = n.lengthSq();
  if(n2 < 1e-9) return null; // коллинеарны
  const center = new THREE.Vector3()
    .addScaledVector(new THREE.Vector3().crossVectors(n, ab), ac.lengthSq())
    .addScaledVector(new THREE.Vector3().crossVectors(ac, n), ab.lengthSq())
    .multiplyScalar(1/(2*n2)).add(A);
  return {center, n, R: center.distanceTo(A)};
}
// цепочка — дуга одной окружности? (кэш на объекте цепочки)
function fitArc(chain){
  if(chain._arc !== undefined) return chain._arc;
  const pts = chain.pts;
  let res = null;
  if(pts.length >= 4){
    const i1 = chain.closed ? (pts.length/3)|0 : (pts.length/2)|0;
    const i2 = chain.closed ? (2*pts.length/3)|0 : pts.length-1;
    const c = circle3(pts[0], pts[i1], pts[i2]);
    // почти прямая цепочка (стенка по хорде, осколки после булевых) тоже
    // укладывается в 0.05 мм — на дугу радиусом в сотни метров, и её центр
    // висел в воздухе маркером привязки. Дуга — только если заметно
    // поворачивает: радиус не больше десяти длин цепочки (дуга ≥ ~6°)
    if(c && c.R <= chain.total * 10){
      res = c;
      for(const p of pts)
        if(Math.abs(p.distanceTo(c.center) - c.R) > 0.05){ res = null; break; }
    }
  }
  chain._arc = res;
  return res;
}
// сэмплер дуги через концы A,B и ручку P: t∈[0..1] -> точка дуги
function arcSampler(A,B,P){
  const c3 = circle3(A,B,P);
  if(!c3){ const f = t => new THREE.Vector3().lerpVectors(A,B,t); f.R = 0; return f; }
  const {center, R} = c3;
  const u = new THREE.Vector3().subVectors(A,center).normalize();
  const w = c3.n.clone().normalize();
  const v = new THREE.Vector3().crossVectors(w,u);
  const ang = X => { const d=new THREE.Vector3().subVectors(X,center); return Math.atan2(d.dot(v), d.dot(u)); };
  const TAU = Math.PI*2;
  let thB = ((ang(B)%TAU)+TAU)%TAU, thP = ((ang(P)%TAU)+TAU)%TAU;
  if(thB < 1e-9) thB = TAU;
  const sweep = (thP > thB) ? thB - TAU : thB; // дуга обязана проходить через ручку
  const f = t => center.clone()
    .addScaledVector(u, Math.cos(t*sweep)*R)
    .addScaledVector(v, Math.sin(t*sweep)*R);
  f.R = R;
  return f;
}
// индексы вершин буфера для набора точек (один проход по мешу)
function buildIndexMap(points){
  const im = new Map();
  for(const p of points) im.set(keyOf(p.x,p.y,p.z), []);
  const pos = mesh.geometry.attributes.position.array;
  for(let i=0;i<pos.length;i+=3){
    const arr = im.get(keyOf(pos[i],pos[i+1],pos[i+2]));
    if(arr) arr.push(i);
  }
  return im;
}
// живая смена радиуса дуги: применяется сразу, попап остаётся открытым
let radiusEdited = false; // pushUndo один раз на сессию редактирования
function applyRadiusLive(Rnew){
  if(!placing) return;
  const chain = placing.chain;
  const arc = fitArc(chain);
  if(!arc || !(Rnew > 0.2)) return;
  if(!radiusEdited){ pushUndo(); radiusEdited = true; }
  const ratio = Rnew / arc.R;
  const oldMid = chainPointAt(chain, chain.total/2);
  const im = buildIndexMap(chain.pts);
  const pos = mesh.geometry.attributes.position.array;
  const nUnit = arc.n.clone().normalize();
  for(const p of chain.pts){
    const v = new THREE.Vector3().subVectors(p, arc.center);
    const h = v.dot(nUnit);
    const ip = v.addScaledVector(nUnit, -h);
    if(ip.lengthSq() < 1e-12) continue;
    const np = arc.center.clone().addScaledVector(ip.normalize(), Rnew).addScaledVector(nUnit, h);
    const arr = im.get(keyOf(p.x,p.y,p.z)) || [];
    for(const i of arr){ pos[i]=np.x; pos[i+1]=np.y; pos[i+2]=np.z; }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  if(!modified){ modified=true; s_mod.textContent='yes'; }
  extractEdges();
  // находим эту же дугу в пересобранных цепочках — по ожидаемой середине
  const expMid = arc.center.clone().addScaledVector(
    new THREE.Vector3().subVectors(oldMid, arc.center), ratio);
  let best=null, bd=1e9;
  for(const ch of chains){
    const a2 = fitArc(ch);
    if(!a2 || Math.abs(a2.R - Rnew) > 0.1) continue;
    const d = chainPointAt(ch, ch.total/2).distanceTo(expMid);
    if(d < bd){ bd = d; best = ch; }
  }
  if(best && bd < 2){
    placing.chain = best;
    placing.s = Math.max(0, Math.min(best.total, placing.s * ratio));
    p_len.textContent = best.total.toFixed(1);
    p_off.value = placing.s.toFixed(1);
    p_off.max = best.total.toFixed(1);
    ghost.position.copy(chainPointAt(best, placing.s));
    ghost.visible = true;
  } else {
    closePopup();
  }
}

// ---------- геометрия меша ----------
function setMeshFromArray(f32){
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(f32, 3));
  geo.computeVertexNormals();
  if(mesh){ scene.remove(mesh); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  // изнанка тем же мешем не рисуется (culling) — компаньон с BackSide
  if(backMesh) scene.remove(backMesh); // геометрия общая, dispose уже сделан
  backMesh = new THREE.Mesh(geo, backMat);
  scene.add(backMesh);
  s_tris.textContent = f32.length/9;
}

// врезаем точку P в рёбра (ka-kb): каждый треугольник с таким ребром делим надвое
function splitEdgeAt(chain, s){
  const P = chainPointAt(chain, Math.max(0.1, Math.min(chain.total-0.1, s)));
  let i=1;
  while(i<chain.cum.length-1 && chain.cum[i]<s) i++;
  const A=chain.pts[i-1], B=chain.pts[i];
  const ka=keyOf(A.x,A.y,A.z), kb=keyOf(B.x,B.y,B.z), kp=keyOf(P.x,P.y,P.z);
  if(kp===ka || kp===kb) return null; // попали в существующую вершину — просто ставим точку
  const pos = mesh.geometry.attributes.position.array;
  const out = [];
  const V=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];
  for(let o=0;o<pos.length;o+=9){
    for(let v=0;v<3;v++) V[v].fromArray(pos,o+v*3);
    const K=V.map(v=>keyOf(v.x,v.y,v.z));
    let done=false;
    for(let e=0;e<3 && !done;e++){
      const p=e, q=(e+1)%3, r=(e+2)%3;
      if((K[p]===ka&&K[q]===kb)||(K[p]===kb&&K[q]===ka)){
        out.push(V[p].x,V[p].y,V[p].z, P.x,P.y,P.z, V[r].x,V[r].y,V[r].z);
        out.push(P.x,P.y,P.z, V[q].x,V[q].y,V[q].z, V[r].x,V[r].y,V[r].z);
        done=true;
      }
    }
    if(!done) for(let v=0;v<3;v++) out.push(V[v].x,V[v].y,V[v].z);
  }
  setMeshFromArray(new Float32Array(out));
  return P;
}

// ---------- параметры и запрос к Rust ----------
// ---------- стартовые фигуры: куб и колесо (порт src/geometry.rs) ----------
// Считаются в браузере, поэтому приложение не зависит от сервера. Сервер
// остаётся только для резервного движка csgrs (колесо булевыми).
// Ограничения параметров — как WheelParams::clamped
const clampN = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
function wheelClamped(p){
  const q = {...p};
  q.dia = clampN(q.dia, 10, 400);
  q.thk = clampN(q.thk, 1, 100);
  q.n = Math.min(Math.max(0, Math.trunc(q.n)), 90); // 0 — гладкий диск без карманов
  if(q.n > 0) q.mouth = clampN(q.mouth, 1, 360 / q.n - 1);
  q.shaft = clampN(q.shaft, 0.5, q.dia - 4);
  q.depth = clampN(q.depth, 0, q.dia / 2);
  return q;
}
const wheelApex = p => Math.max(p.dia / 2 - p.depth, p.shaft / 2 + 1); // дно кармана
const wheelPitch = p => p.n ? 2 * Math.PI * (p.dia / 2) / p.n : 0;   // шаг по ободу
// куб как Part Box во FreeCAD: угол в начале координат, рост в +X+Y+Z
function buildCubeArray(size){
  const s = size;
  const P = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const quads = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[3,0,4,7]]; // CCW снаружи
  const out = new Float32Array(12 * 9);
  let o = 0;
  const put = i => { out[o++] = P[i][0]; out[o++] = P[i][1]; out[o++] = P[i][2]; };
  for(const q of quads){ put(q[0]); put(q[1]); put(q[2]); put(q[0]); put(q[2]); put(q[3]); }
  return out;
}
// шар как у куба стоит в углу начала координат: центр (r, r, r), лежит на
// рабочей плоскости. UV-сетка 32 × 16, у полюсов — треугольники без
// вырожденных (иначе булевым и выбору граней достаются нулевые площади)
function buildSphereArray(d){
  const r = d / 2, SL = 32, ST = 16, out = [];
  const P = (i, k) => {
    const th = Math.PI * k / ST, ph = 2 * Math.PI * i / SL;
    return [r + r * Math.sin(th) * Math.cos(ph), r + r * Math.sin(th) * Math.sin(ph), r + r * Math.cos(th)];
  };
  for(let k=0;k<ST;k++) for(let i=0;i<SL;i++){
    const a = P(i, k), b = P(i+1, k), c = P(i+1, k+1), e = P(i, k+1);
    if(k > 0) out.push(...a, ...e, ...b);        // (вниз, на восток) — нормаль наружу
    if(k < ST - 1) out.push(...b, ...e, ...c);
  }
  return new Float32Array(out);
}
// пирамида: квадратное основание в углу начала координат, вершина над центром
function buildPyramidArray(s){
  const A = [0,0,0], B = [s,0,0], C = [s,s,0], D = [0,s,0], T = [s/2, s/2, s];
  return new Float32Array([
    ...A, ...C, ...B,  ...A, ...D, ...C,             // основание (−Z)
    ...A, ...B, ...T,  ...B, ...C, ...T,  ...C, ...D, ...T,  ...D, ...A, ...T
  ]);
}
// колесо-дозатор: контур (окружность с V-карманами) на угловой сетке 2°,
// крышки кольцевыми поясами (мелкие ячейки — чистые врезки), стенки
const WHEEL_STEPS = 180, WHEEL_CAP_RINGS = 4;
function wheelContourR(p, a){
  const rOut = p.dia / 2;
  if(p.n === 0) return rOut;
  const apex = wheelApex(p), hw = p.mouth * Math.PI / 180 / 2, sector = 2 * Math.PI / p.n;
  let d = a % sector;
  if(d > sector / 2) d -= sector;
  if(Math.abs(d) >= hw) return rOut;
  // стенки кармана прямые: пересечение луча с отрезком «устье — апекс»
  const mx = rOut * Math.cos(hw), my = rOut * Math.sin(hw);
  const den = Math.cos(Math.abs(d)) * my - Math.sin(Math.abs(d)) * (mx - apex);
  if(Math.abs(den) < 1e-12) return rOut;
  return clampN(apex * my / den, Math.min(apex, rOut), rOut);
}
function buildWheelArray(p){
  const rs = p.shaft / 2, z0 = 0, z1 = p.thk, S = WHEEL_STEPS, K = WHEEL_CAP_RINGS;
  const rings = [];
  for(let k=0;k<=K;k++) rings.push(new Array(S));
  for(let i=0;i<S;i++){
    const a = 2 * Math.PI * i / S, c = Math.cos(a), sn = Math.sin(a), rOut = wheelContourR(p, a);
    for(let k=0;k<=K;k++){ const r = rs + (rOut - rs) * k / K; rings[k][i] = [c * r, sn * r]; }
  }
  const out = new Float32Array(S * (K * 4 + 4) * 9);
  let o = 0;
  const tri = (a, za, b, zb, c, zc) => {
    out[o++] = a[0]; out[o++] = a[1]; out[o++] = za;
    out[o++] = b[0]; out[o++] = b[1]; out[o++] = zb;
    out[o++] = c[0]; out[o++] = c[1]; out[o++] = zc;
  };
  for(let k=0;k<K;k++){ // крышки: верхняя (+Z) и нижняя (−Z)
    const rin = rings[k], rout = rings[k+1];
    for(let i=0;i<S;i++){
      const j = (i + 1) % S;
      tri(rin[i], z1, rout[i], z1, rout[j], z1);
      tri(rin[i], z1, rout[j], z1, rin[j], z1);
      tri(rin[i], z0, rout[j], z0, rout[i], z0);
      tri(rin[i], z0, rin[j], z0, rout[j], z0);
    }
  }
  const inner = rings[0], outer = rings[K];
  for(let i=0;i<S;i++){ // внешняя стенка и стенка отверстия под вал
    const j = (i + 1) % S;
    tri(outer[i], z0, outer[j], z0, outer[j], z1);
    tri(outer[i], z0, outer[j], z1, outer[i], z1);
    tri(inner[i], z0, inner[i], z1, inner[j], z1);
    tri(inner[i], z0, inner[j], z1, inner[j], z0);
  }
  return out;
}
function readParams(){
  return {dia:+dia.value, thk:+thk.value, shaft:+sh.value,
          n:+n.value, depth:+dep.value, mouth:+w.value};
}
function queryString(p){
  const engine = document.querySelector('input[name=engine]:checked').value;
  const shape = document.querySelector('input[name=shape]:checked').value;
  return `shape=${shape}&size=${p.dia}&dia=${p.dia}&thk=${p.thk}&shaft=${p.shaft}&n=${p.n}&depth=${p.depth}&mouth=${p.mouth}&engine=${engine}`;
}

function parseSTL(buf){
  const dv = new DataView(buf);
  const count = dv.getUint32(80, true);
  const pos = new Float32Array(count*9);
  let off = 84;
  for(let i=0;i<count;i++){
    off += 12;
    for(let j=0;j<9;j++){ pos[i*9+j] = dv.getFloat32(off, true); off += 4; }
    off += 2;
  }
  return pos;
}

let inflight = null;
async function rebuild(){
  const p = readParams();
  v_dia.textContent = p.dia+' mm'; v_thk.textContent = p.thk+' mm';
  v_sh.textContent = p.shaft+' mm'; v_n.textContent = p.n;
  v_dep.textContent = p.depth+' mm'; v_w.textContent = p.mouth+'°';

  if(inflight){ inflight.abort(); inflight = null; }
  const shape = document.querySelector('input[name=shape]:checked').value;
  const engine = document.querySelector('input[name=engine]:checked').value;
  const cp = wheelClamped(p);
  let arr, genUs;
  if(engine === 'csg' && shape !== 'cube' && HAS_SERVER){
    // резервный движок — колесо булевыми csgrs на сервере
    const ctl = inflight = new AbortController();
    let res;
    try{
      res = await fetch('/api/wheel.stl?'+queryString(p), {signal: ctl.signal});
      arr = parseSTL(await res.arrayBuffer());
    }catch(e){ return; }
    if(inflight !== ctl) return; // пока ждали, параметры сменились
    inflight = null;
    genUs = +res.headers.get('X-Gen-Us');
  } else {
    const t0 = performance.now();
    const size = clampN(p.dia, 2, 400);
    arr = shape === 'cube' ? buildCubeArray(size)
      : shape === 'sphere' ? buildSphereArray(size)
      : shape === 'pyramid' ? buildPyramidArray(size)
      : buildWheelArray(cp);
    genUs = Math.round((performance.now() - t0) * 1000);
  }
  setMeshFromArray(arr);
  closePopup(); clearAnchors(); deselect(); tipHide(); setLineMode(false);
  restoreGuides([]); curveSeq = 0; // новая модель — старые линии над ней не висят
  hardEdges = [];
  modified = false; s_mod.textContent = 'no';
  undoStack = []; // новая серверная модель — новая точка отсчёта
  extractEdges();

  camDist = Math.max(p.dia*1.9, 60);
  orthoFit = p.dia*0.62;
  updateOrthoFrusta();
  bedGrid.position.z = -0.05; // рабочая плоскость z=0, сетка и оси лежат на ней
  // орбита и орто-виды смотрят на центр модели (куб растёт из начала координат)
  const isBlock = shape !== 'wheel'; // куб, шар, пирамида растут из начала координат
  if(isBlock) camTarget.set(p.dia/2, p.dia/2, p.dia/2);
  else camTarget.set(0, 0, p.thk/2);
  updateOrthoPoses();
  projectHandle = null; projectName = 'untitled'; setProjectDirty(false);
  s_apex.textContent = shape === 'wheel' ? wheelApex(cp).toFixed(2)+' mm' : '–';
  s_pitch.textContent = shape === 'wheel' ? wheelPitch(cp).toFixed(2)+' mm' : '–';
  s_gen.textContent = genUs >= 1000 ? (genUs/1000).toFixed(1)+' ms' : genUs+' µs';
}

// ---------- файл: проект .zcad, автосохранение, экспорт ----------
// Правда модели — меш в браузере (после ручных правок сервер про него не
// знает), поэтому и проект, и все экспорты берутся отсюда.
const PROJECT_FORMAT = 'zerocad', PROJECT_VERSION = 1, AUTOSAVE_KEY = 'zc_autosave';
let projectHandle = null;   // File System Access API: Ctrl+S пишет в тот же файл
let projectName = 'untitled';

function downloadBlob(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
function f32ToB64(f32){
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = '';
  for(let i=0;i<u8.length;i+=0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i+0x8000));
  return btoa(bin);
}
function b64ToF32(b64){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
const v3a = v => [+v.x.toFixed(6), +v.y.toFixed(6), +v.z.toFixed(6)];
const a3v = a => new THREE.Vector3(a[0], a[1], a[2]);

function setProjectDirty(d){
  projectDirty = d;
  s_file.textContent = projectName + (d ? ' •' : '');
  document.title = (d ? '• ' : '') + projectName + ' — ZeroCAD';
}
function projectData(){
  return {
    format: PROJECT_FORMAT, version: PROJECT_VERSION,
    build: window.ZC_BUILD, saved: new Date().toISOString(),
    shape: document.querySelector('input[name=shape]:checked').value,
    params: {dia:+dia.value, thk:+thk.value, sh:+sh.value, n:+n.value, dep:+dep.value, w:+w.value},
    mesh: f32ToB64(mesh.geometry.attributes.position.array),
    guides: guides.map(g=>({a: v3a(g.a), b: v3a(g.b), noExt: !!g.noExt, curve: g.curve || 0})),
    hard: hardEdges.map(h=>({a: v3a(h.a), b: v3a(h.b)})),
    anchors: anchors.map(a=>({pos: v3a(a.pos),
      bend: a.bend ? {pts0: a.bend.pts0.map(v3a), t: a.bend.t.slice(), j: a.bend.j} : null})),
    curveSeq,
    camera: {yaw, pitch, camDist, target: v3a(camTarget)}
  };
}
function loadProjectData(d, name){
  if(!d || d.format !== PROJECT_FORMAT) throw new Error('not a ZeroCAD project');
  if(d.version > PROJECT_VERSION) throw new Error('project from a newer ZeroCAD');
  const radio = document.querySelector('input[name=shape][value="' + d.shape + '"]');
  if(radio) radio.checked = true;
  applyShapeUI();
  for(const id in (d.params || {})){ const el = document.getElementById(id); if(el) el.value = d.params[id]; }
  // закрыть всё, что висело от прежней модели
  closeExtrude(); cancelText(); closePopup(); deselect(); clearEdgeSel(); hideChordHint(); tipHide();
  
  if(lineMode) setLineMode(false);
  if(circleMode) setCircleMode(false);
  if(pointMode) setPointMode(false);
  if(activeTool) setActiveTool(null);
  hidePatch(); ppPatch = null; ppParts = null;
  setMeshFromArray(b64ToF32(d.mesh));
  hardEdges = (d.hard || []).map(h=>({a: a3v(h.a), b: a3v(h.b)}));
  restoreGuides((d.guides || []).map(g=>({a: a3v(g.a), b: a3v(g.b), noExt: g.noExt, curve: g.curve})));
  clearAnchors();
  for(const sa of (d.anchors || [])){
    const a = makeAnchor(a3v(sa.pos));
    if(sa.bend) a.bend = {pts0: sa.bend.pts0.map(a3v), t: sa.bend.t, j: sa.bend.j};
  }
  curveSeq = Math.max(d.curveSeq || 0, ...guides.map(g=>g.curve || 0), 0);
  if(d.camera){
    yaw = d.camera.yaw; pitch = d.camera.pitch; camDist = d.camera.camDist;
    camTarget.copy(a3v(d.camera.target));
  }
  undoStack = []; redoStack = [];
  modified = true; s_mod.textContent = 'yes';
  extractEdges();
  if(name) projectName = name.replace(/\.zcad$/i, '');
  setProjectDirty(false);
}
function scheduleAutosave(){
  if(!autosaveArmed) return;
  setProjectDirty(true);
  clearTimeout(autosaveT);
  autosaveT = setTimeout(()=>{
    // тяжёлая сетка может не влезть в квоту localStorage — тогда молча
    // пропускаем: файл проекта (Ctrl+S) остаётся надёжным путём
    try{ localStorage.setItem(AUTOSAVE_KEY,
      JSON.stringify(Object.assign(projectData(), {name: projectName}))); }catch(_){}
  }, 800);
}
async function saveProject(saveAs){
  if(!mesh) return;
  const blob = new Blob([JSON.stringify(projectData())], {type: 'application/json'});
  if(window.showSaveFilePicker){
    try{
      if(!projectHandle || saveAs){
        projectHandle = await window.showSaveFilePicker({
          suggestedName: projectName + '.zcad',
          types: [{description: 'ZeroCAD project', accept: {'application/json': ['.zcad']}}]});
      }
      const wr = await projectHandle.createWritable();
      await wr.write(blob); await wr.close();
      projectName = projectHandle.name.replace(/\.zcad$/i, '');
      setProjectDirty(false);
      return;
    }catch(err){
      if(err && err.name === 'AbortError') return; // закрыли диалог — ничего не делаем
      projectHandle = null;                        // нет доступа — обычная загрузка
    }
  }
  downloadBlob(blob, projectName + '.zcad');
  setProjectDirty(false);
}
function loadProjectText(text, name){
  try{ loadProjectData(JSON.parse(text), name); }
  catch(err){ alert('Cannot open project: ' + err.message); }
}
// Open… принимает и проект .zcad, и сетку .stl (как File → Open во FreeCAD):
// STL — это экспорт для принтера, без линий, точек и истории, но открыть
// свою же выгрузку обратно должно быть можно без поиска кнопки Import
async function openFileAny(file, handle){
  if(/\.stl$/i.test(file.name)){ importSTL(await file.arrayBuffer(), file.name); return; }
  loadProjectText(await file.text(), file.name);
  if(handle) projectHandle = handle;
}
async function openProject(){
  if(window.showOpenFilePicker){
    try{
      const [h] = await window.showOpenFilePicker({
        types: [
          {description: 'ZeroCAD project or STL mesh', accept: {'application/json': ['.zcad', '.json'], 'model/stl': ['.stl']}},
          {description: 'ZeroCAD project', accept: {'application/json': ['.zcad', '.json']}},
          {description: 'STL mesh', accept: {'model/stl': ['.stl']}}
        ]});
      await openFileAny(await h.getFile(), h);
      return;
    }catch(err){ if(err && err.name === 'AbortError') return; }
  }
  f_file.value = '';
  f_file.click();
}

// --- импорт STL: бинарный и текстовый (ASCII); единицы — миллиметры ---
function parseSTLAny(buf){
  const dv = new DataView(buf);
  if(buf.byteLength >= 84){
    const cnt = dv.getUint32(80, true);
    if(84 + cnt*50 === buf.byteLength) return parseSTL(buf); // бинарный: размер сходится
  }
  const text = new TextDecoder().decode(new Uint8Array(buf));
  const nums = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  if(nums.length && nums.length % 9 === 0) return new Float32Array(nums);
  if(buf.byteLength >= 84) return parseSTL(buf); // размер не сошёлся — пробуем как бинарный
  return new Float32Array(0);
}
function importSTL(buf, name){
  const raw = parseSTLAny(buf);
  if(!raw.length || raw.length % 9 !== 0 || raw.some(v => !isFinite(v))){
    alert('Cannot import: no valid triangles in ' + (name || 'the file'));
    return;
  }
  pushUndo(); // Ctrl+Z вернёт прежнюю модель
  closeExtrude(); cancelText(); closePopup(); deselect(); clearEdgeSel(); hideChordHint(); tipHide();
  
  if(lineMode) setLineMode(false);
  if(circleMode) setCircleMode(false);
  if(pointMode) setPointMode(false);
  if(activeTool) setActiveTool(null);
  hidePatch(); ppPatch = null; ppParts = null;
  const q = x => Math.round(x*1000)/1000; // та же сетка ключей, что у правок
  const arr = new Float32Array(raw.length);
  for(let i=0;i<raw.length;i++) arr[i] = q(raw[i]);
  setMeshFromArray(arr);
  restoreGuides([]); clearAnchors(); curveSeq = 0; hardEdges = [];
  cleanupMesh();
  modified = true; s_mod.textContent = 'yes';
  extractEdges();
  // камера на модель
  const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const size = box.getSize(new THREE.Vector3()), maxd = Math.max(size.x, size.y, size.z, 1);
  box.getCenter(camTarget);
  camDist = Math.max(maxd * 1.9, 60);
  orthoFit = maxd * 0.62;
  updateOrthoFrusta(); updateOrthoPoses();
  projectHandle = null;
  projectName = (name || 'imported').replace(/\.stl$/i, '');
  setProjectDirty(true);
  const open = countBoundaryEdges();
  if(open) warnTip('Imported mesh is not closed: ' + open + ' open edges');
}

// --- геометрия для экспорта: вершины без дублей (ключ 0.001 мм) ---
function indexedMesh(){
  const pos = mesh.geometry.attributes.position.array;
  const map = new Map(), verts = [], tris = [];
  for(let i=0;i<pos.length;i+=9){
    const f = [];
    for(let j=0;j<3;j++){
      const x = pos[i+j*3], y = pos[i+j*3+1], z = pos[i+j*3+2];
      const k = keyOf(x, y, z);
      let id = map.get(k);
      if(id === undefined){ id = verts.length; verts.push([x, y, z]); map.set(k, id); }
      f.push(id);
    }
    if(f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) tris.push(f); // без вырожденных
  }
  return {verts, tris};
}
function buildSTL(){
  const pos = mesh.geometry.attributes.position.array;
  const cnt = pos.length/9;
  const buf = new ArrayBuffer(84 + cnt*50);
  const dv = new DataView(buf);
  dv.setUint32(80, cnt, true);
  const A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3(),
        e1=new THREE.Vector3(),e2=new THREE.Vector3(),N=new THREE.Vector3();
  let off = 84;
  for(let i=0;i<pos.length;i+=9){
    A.fromArray(pos,i); B.fromArray(pos,i+3); C.fromArray(pos,i+6);
    N.crossVectors(e1.subVectors(B,A), e2.subVectors(C,A)).normalize();
    for(const v of [N,A,B,C]){ dv.setFloat32(off,v.x,true); dv.setFloat32(off+4,v.y,true); dv.setFloat32(off+8,v.z,true); off+=12; }
    dv.setUint16(off, 0, true); off += 2;
  }
  return buf;
}
function buildOBJ(){
  const {verts, tris} = indexedMesh();
  const out = ['# ZeroCAD ' + window.ZC_BUILD + ' — units: millimetres, Z up', 'o ' + projectName];
  for(const v of verts) out.push('v ' + v[0].toFixed(4) + ' ' + v[1].toFixed(4) + ' ' + v[2].toFixed(4));
  for(const t of tris) out.push('f ' + (t[0]+1) + ' ' + (t[1]+1) + ' ' + (t[2]+1));
  return out.join('\n') + '\n';
}
// --- 3MF: ZIP без сжатия (STORE) + XML модели; единицы — миллиметры ---
const CRC_TABLE = (()=>{
  const t = new Uint32Array(256);
  for(let q=0;q<256;q++){ let c = q; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[q] = c >>> 0; }
  return t;
})();
function crc32(u8){
  let c = 0xFFFFFFFF;
  for(let i=0;i<u8.length;i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZipStore(files){ // [{name, data: Uint8Array}]
  const enc = new TextEncoder(), now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for(const f of files){
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true);
    lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true);
    ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + sz;
  }
  const cdSize = central.reduce((acc, u) => acc + u.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((acc, u) => acc + u.length, 0));
  let o = 0;
  for(const u of all){ out.set(u, o); o += u.length; }
  return out;
}
function build3MF(){
  const {verts, tris} = indexedMesh();
  const enc = new TextEncoder();
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<metadata name="Application">ZeroCAD ' + window.ZC_BUILD + '</metadata>',
    '<resources><object id="1" type="model"><mesh><vertices>'];
  for(const v of verts) xml.push('<vertex x="' + v[0].toFixed(4) + '" y="' + v[1].toFixed(4) + '" z="' + v[2].toFixed(4) + '"/>');
  xml.push('</vertices><triangles>');
  for(const t of tris) xml.push('<triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>');
  xml.push('</triangles></mesh></object></resources>', '<build><item objectid="1"/></build>', '</model>');
  return makeZipStore([
    {name: '[Content_Types].xml', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')},
    {name: '_rels/.rels', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')},
    {name: '3D/3dmodel.model', data: enc.encode(xml.join('\n'))}
  ]);
}
// --- STEP AP214, гранёное тело (FACETED_BREP): каждый треугольник — плоская
// грань. Точных цилиндров нет — для них нужно B-rep ядро (OCCT/truck) ---
function buildSTEP(){
  const {verts, tris} = indexedMesh();
  const num = v => { let t = (+v.toFixed(6)).toString(); if(!/[.eE]/.test(t)) t += '.'; return t; };
  const esc = t => t.replace(/'/g, "''");
  const nm = esc(projectName);
  const L = [];
  let id = 0;
  const add = txt => { L.push('#' + (++id) + '=' + txt + ';'); return id; };
  const appCtx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#" + appCtx + ")");
  const prodCtx = add("PRODUCT_CONTEXT('',#" + appCtx + ",'mechanical')");
  const prod = add("PRODUCT('" + nm + "','" + nm + "','',(#" + prodCtx + "))");
  add("PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#" + prod + "))");
  const form = add("PRODUCT_DEFINITION_FORMATION('','',#" + prod + ")");
  const defCtx = add("PRODUCT_DEFINITION_CONTEXT('part definition',#" + appCtx + ",'design')");
  const pdef = add("PRODUCT_DEFINITION('design','',#" + form + ",#" + defCtx + ")");
  const pds = add("PRODUCT_DEFINITION_SHAPE('','',#" + pdef + ")");
  const uLen = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const uAng = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const uSol = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = add("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#" + uLen + ",'distance_accuracy_value','confusion accuracy')");
  const ctx = add("(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#" + unc +
    "))GLOBAL_UNIT_ASSIGNED_CONTEXT((#" + uLen + ",#" + uAng + ",#" + uSol + "))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))");
  const o = add("CARTESIAN_POINT('',(0.,0.,0.))");
  const dz = add("DIRECTION('',(0.,0.,1.))");
  const dx = add("DIRECTION('',(1.,0.,0.))");
  const ax = add("AXIS2_PLACEMENT_3D('',#" + o + ",#" + dz + ",#" + dx + ")");
  const pts = verts.map(v => add("CARTESIAN_POINT('',(" + num(v[0]) + "," + num(v[1]) + "," + num(v[2]) + "))"));
  const faces = tris.map(t => {
    const loop = add("POLY_LOOP('',(#" + pts[t[0]] + ",#" + pts[t[1]] + ",#" + pts[t[2]] + "))");
    const bound = add("FACE_OUTER_BOUND('',#" + loop + ",.T.)");
    return add("FACE('',(#" + bound + "))");
  });
  const shell = add("CLOSED_SHELL('',(" + faces.map(f => '#' + f).join(',') + "))");
  const brep = add("FACETED_BREP('" + nm + "',#" + shell + ")");
  const rep = add("FACETED_BREP_SHAPE_REPRESENTATION('" + nm + "',(#" + brep + ",#" + ax + "),#" + ctx + ")");
  add("SHAPE_DEFINITION_REPRESENTATION(#" + pds + ",#" + rep + ")");
  const stamp = new Date().toISOString().slice(0, 19);
  return ['ISO-10303-21;', 'HEADER;',
    "FILE_DESCRIPTION(('ZeroCAD faceted solid'),'2;1');",
    "FILE_NAME('" + nm + ".step','" + stamp + "',(''),(''),'ZeroCAD " + esc(String(window.ZC_BUILD)) + "','ZeroCAD','');",
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}
function exportAs(kind){
  if(!mesh) return;
  if(kind === 'stl') downloadBlob(new Blob([buildSTL()], {type: 'model/stl'}), projectName + '.stl');
  if(kind === 'obj') downloadBlob(new Blob([buildOBJ()], {type: 'text/plain'}), projectName + '.obj');
  if(kind === '3mf') downloadBlob(new Blob([build3MF()], {type: 'model/3mf'}), projectName + '.3mf');
  if(kind === 'step'){
    // гранёный STEP описывает ТВЁРДОЕ тело: с дырой в оболочке он был бы
    // некорректным файлом, а не «почти» моделью
    if(countBoundaryEdges() !== 0){
      alert('STEP needs a closed solid. The model has holes — close them (F) and export again.');
      return;
    }
    downloadBlob(new Blob([buildSTEP()], {type: 'application/step'}), projectName + '.step');
  }
}
function downloadSTL(){ exportAs('stl'); }

// ---------- мышь ----------
// режим окон: false = одно 3D на весь вьюпорт, true = 4 окна
const quadChk = document.getElementById('quadview');
function applyViewMode(){
  view.classList.toggle('single', !quadChk.checked);
  if(window.__vcReady) placeVcNav();
}
quadChk.addEventListener('change', applyViewMode);
applyViewMode();

// какой квадрант под курсором: его камера и локальные координаты
function quadPos(e){
  const r = canvas.getBoundingClientRect();
  const x=e.clientX-r.left, y=e.clientY-r.top;
  const inside = x>=0 && y>=0 && x<r.width && y<r.height;
  if(!quadChk.checked)
    return {mx:x, my:y, w:r.width, h:r.height, cam:persp, ox:0, oy:0, is3D:true, inside};
  const w=r.width/2, h=r.height/2;
  const right = x>=w, bottom = y>=h;
  const cam = (!right && !bottom) ? persp : (right && !bottom) ? orthoX
            : (!right && bottom) ? orthoY : orthoZ;
  return {mx: x-(right?w:0), my: y-(bottom?h:0), w, h, cam,
          ox: right?w:0, oy: bottom?h:0, is3D: cam===persp, inside};
}
function projToQuad(v, cam, w, h, out){
  const p = v.clone().project(cam);
  out.x=(p.x+1)/2*w; out.y=(1-p.y)/2*h; out.z=p.z;
  return out;
}
// ближайшее ребро к курсору (в пикселях 3D-окна)
// Точка закрыта телом? Луч из камеры в точку упирается в грань раньше неё.
// Рёбра и вершины за телом не видны — магнитить и подсвечивать их нельзя
// (курсор над верхней гранью ловил заднее вертикальное ребро на той же
// экранной линии). Допуск — чтобы ребро на самой грани оставалось видимым
function isOccluded(q, P){
  const o = projToQuad(P, q.cam, q.w, q.h, {x:0,y:0,z:0});
  raycaster.setFromCamera({x: o.x/q.w*2-1, y: -(o.y/q.h*2-1)}, q.cam);
  const hits = raycaster.intersectObject(mesh);
  if(!hits.length) return false;
  const t = new THREE.Vector3().subVectors(P, raycaster.ray.origin).dot(raycaster.ray.direction);
  return hits[0].distance < t - (0.02 + t*0.002);
}
function pickEdge(q, excl){
  const P1={x:0,y:0,z:0}, P2={x:0,y:0,z:0};
  const cands = []; // порог 8px; ближайшее к курсору видимое
  for(const ch of chains){
    for(let i=1;i<ch.pts.length;i++){
      if(excl && (ch.pts[i-1].distanceTo(excl)<1e-3 || ch.pts[i].distanceTo(excl)<1e-3)) continue;
      projToQuad(ch.pts[i-1], q.cam, q.w, q.h, P1);
      projToQuad(ch.pts[i],   q.cam, q.w, q.h, P2);
      if(P1.z>1||P2.z>1||P1.z<-1||P2.z<-1) continue;
      const dx=P2.x-P1.x, dy=P2.y-P1.y;
      const L2=dx*dx+dy*dy; if(L2<1e-9) continue;
      let t=((q.mx-P1.x)*dx+(q.my-P1.y)*dy)/L2;
      t=Math.max(0,Math.min(1,t));
      const ex=P1.x+t*dx-q.mx, ey=P1.y+t*dy-q.my;
      const d=Math.hypot(ex,ey);
      if(d<8) cands.push({d, chain:ch, i});
    }
  }
  cands.sort((a,b)=>a.d-b.d);
  for(const best of cands){
    // перспективно-честная позиция: ближайшая точка 3D-отрезка к лучу курсора
    // (экранная доля пути в перспективе врёт — точка «обгоняла» курсор)
    const ch = best.chain, i = best.i;
    const A = ch.pts[i-1], B = ch.pts[i];
    const segLen = ch.cum[i] - ch.cum[i-1];
    raycaster.setFromCamera({x: q.mx/q.w*2-1, y: -(q.my/q.h*2-1)}, q.cam);
    const dir = new THREE.Vector3().subVectors(B, A).normalize();
    const t3 = Math.max(0, Math.min(segLen, rayLineParam(raycaster.ray, A, dir)));
    if(isOccluded(q, A.clone().addScaledVector(dir, t3))) continue;
    return {chain: ch, s: ch.cum[i-1] + t3};
  }
  return null;
}
function anchorAt(q){
  const P={x:0,y:0,z:0};
  for(const a of anchors){
    projToQuad(a.marker.position, q.cam, q.w, q.h, P);
    if(P.z < 1 && P.z > -1 && Math.hypot(P.x-q.mx, P.y-q.my) < 12) return a;
  }
  return null;
}
// ближайшая вершина модели (жёлтая привязка)
function pickCorner(q, excl){
  const P={x:0,y:0,z:0};
  let best=null, bestD=10;
  for(const c of corners){
    if(excl && c.pos.distanceTo(excl)<1e-3) continue;
    projToQuad(c.pos, q.cam, q.w, q.h, P);
    if(P.z>1||P.z<-1) continue;
    const d=Math.hypot(P.x-q.mx, P.y-q.my);
    if(d<bestD && !isOccluded(q, c.pos)){ bestD=d; best=c; }
  }
  return best;
}

// всплывашка
const popup=document.getElementById('popup'), p_len=document.getElementById('p_len'),
      p_off=document.getElementById('p_off'),
      p_radrow=document.getElementById('p_radrow'), p_rad=document.getElementById('p_rad');
function openPopup(e, q){
  placing = {chain:hover.chain, s:hover.s};
  p_len.textContent = placing.chain.total.toFixed(1);
  p_off.value = placing.s.toFixed(1);
  p_off.max = placing.chain.total.toFixed(1);
  tipHide(); // подсказка у курсора не должна перекрывать окошко
  // выбранное ребро и точка — зелёные (selection, как во FreeCAD)
  if(hiLine) hiLine.material.color.setHex(C_SEL);
  ghost.material.color.setHex(C_SEL);
  radiusEdited = false;
  const arc = fitArc(placing.chain);
  p_radrow.hidden = !arc;
  if(arc) p_rad.value = arc.R.toFixed(1);
  const vr = view.getBoundingClientRect();
  popup.style.left = Math.min(e.clientX-vr.left+14, vr.width-190)+'px';
  popup.style.top  = Math.min(e.clientY-vr.top+8, vr.height-120)+'px';
  popup.hidden = false;
  ghost.position.copy(chainPointAt(placing.chain, placing.s));
  ghost.visible = true;
  p_off.focus(); p_off.select();
}
function closePopup(){
  placing = null; popup.hidden = true;
  if(!hover) ghost.visible = false;
}
p_off.addEventListener('input', ()=>{
  if(!placing) return;
  placing.s = Math.max(0, Math.min(placing.chain.total, +p_off.value||0));
  ghost.position.copy(chainPointAt(placing.chain, placing.s));
});
p_rad.addEventListener('change', ()=>{
  applyRadiusLive(Math.max(0.2, Math.round((+p_rad.value||0)*10)/10));
});
// колесо мыши над полями попапа: шаг 0.1 мм, модель обновляется сразу
function wheelStep(inp, apply){
  inp.addEventListener('wheel', e=>{
    e.preventDefault();
    const v = Math.round(((+inp.value||0) - Math.sign(e.deltaY)*0.1)*10)/10;
    inp.value = v.toFixed(1);
    apply(v);
  }, {passive:false});
}
wheelStep(p_rad, v=>applyRadiusLive(Math.max(0.2, v)));
wheelStep(ex_val, v=>applyExtrudeLive(v)); // ролик над полем двигает грань вживую
wheelStep(p_off, v=>{
  if(!placing) return;
  placing.s = Math.max(0, Math.min(placing.chain.total, v));
  ghost.position.copy(chainPointAt(placing.chain, placing.s));
});
// найти цепочку (ребро), проходящую через точку P
function chainAtPoint(P){
  for(const ch of chains){
    if(ch.isGuide) continue;
    for(let i=1;i<ch.pts.length;i++){
      const a = ch.pts[i-1], b = ch.pts[i];
      const ab = new THREE.Vector3().subVectors(b, a);
      const L2 = ab.lengthSq();
      if(L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1,
        new THREE.Vector3().subVectors(P, a).dot(ab) / L2));
      if(a.clone().addScaledVector(ab, t).distanceTo(P) < 0.02)
        return {chain: ch, s: ch.cum[i-1] + t*Math.sqrt(L2)};
    }
  }
  return null;
}
// Divide через точку в центре: окошко (перетаскиваемое) с выбором из «ровных»
// количеств, живым превью; камера остаётся свободной, пока окно открыто
const divPopup = document.getElementById('divPopup');
const dv_info = document.getElementById('dv_info');
const dv_sugg = document.getElementById('dv_sugg');
let divCtx = null;   // {chain}
let divN = 1;
let divDots = [];    // превью-точки
function clearDivDots(){ for(const m of divDots) scene.remove(m); divDots = []; }
function divideCounts(L){
  const counts = [];
  for(let k=1;k<=19;k++){
    const s = L/(k+1);
    if(Math.abs(s*10 - Math.round(s*10)) < 1e-6) counts.push(k);
  }
  return counts.length ? counts : [1,2,3,4,9]; // редкая длина без ровных вариантов
}
// ---- квадранты окружностей (Quadrant в AutoCAD, Snap к оси) ----
// Точка окружности, в которую ведёт луч из центра строго вдоль мировой оси:
// отрезок «центр — квадрант» лежит на оси X, Y или Z. Берутся только оси,
// лежащие в плоскости круга (у круга на XY — ±X и ±Y). Точка — на самой
// нарисованной геометрии (ringPointAt), у круга с кратным 4 числом
// сегментов это его вершина
function computeQuadSnaps(){
  quadSnaps = [];
  const rings = [];
  const same = r => rings.some(o => o.ctr.distanceTo(r.ctr) < 1e-3 && Math.abs(o.R - r.R) < 1e-3
    && Math.abs(o.n.dot(r.n)) > 0.999);
  for(const id of new Set(guides.filter(g => g.curve).map(g => g.curve))){
    const r = ringFromCurve(id);
    if(r && !same(r)) rings.push(r);
  }
  const ends = edgeChainEnds(), walked = new Set();
  for(const ch of chains){
    if(ch.isGuide || walked.has(ch)) continue;
    if(ch.closed && ch.pts.length < 7) continue;
    const r = ch.closed ? ringFromPts(ch.pts) : ringFromEdgeChains(ch, ends, walked);
    if(ch.closed) walked.add(ch);
    if(r && !same(r)) rings.push(r);
  }
  ringVertKeys = new Set();
  snapRings = rings;
  for(const r of rings){
    for(const [x, y] of r.p2){
      const P = r.ctr.clone().addScaledVector(r.u, x).addScaledVector(r.v, y);
      ringVertKeys.add(keyOf(P.x, P.y, P.z));
    }
    for(const ax of ['x', 'y', 'z']){
      const dir = new THREE.Vector3(...AXIS_DIRS[ax]);
      if(Math.abs(dir.dot(r.n)) > 1e-3) continue; // ось не лежит в плоскости круга
      const th = Math.atan2(dir.dot(r.v), dir.dot(r.u));
      for(const sign of [1, -1]){
        const P = ringPointAt(r, sign > 0 ? th : th + Math.PI);
        if(!quadSnaps.some(q => q.pos.distanceTo(P) < 1e-3)) quadSnaps.push({pos: P, axis: ax, sign});
      }
    }
  }
}
// Маркеры точек привязки, пока в руке инструмент, ставящий точку (SketchUp
// показывает точки вывода, FreeCAD — снап-маркеры): вершины модели и концы
// линий — светлые, центры окружностей — бирюзовые, квадранты — в цветах
// осей. Магнит к ним — в linePickPoint, маркеры только делают его видимым.
// Вершины самих окружностей не рисуем (по 32 точки на круг — каша, у круга
// ориентиры — центр и квадранты), но магнит к ним остаётся. Моделей с
// тысячами вершин (гравировка текста) вершины тоже не засыпают
const SNAP_MARK_MAX_VERTS = 600;
let snapMarkers = [], snapMarkersFor = null;
function syncSnapMarkers(on){
  const stamp = on ? [quadSnaps, corners, auxSnaps] : null;
  const same = snapMarkersFor && stamp && stamp.every((x, i) => x === snapMarkersFor[i]);
  if(same) return;
  for(const m of snapMarkers){ scene.remove(m); m.material.dispose(); }
  snapMarkers = []; snapMarkersFor = stamp;
  if(!on) return;
  const seen = new Set();
  const add = (P, color) => {
    const k = keyOf(P.x, P.y, P.z);
    if(seen.has(k)) return;
    seen.add(k);
    const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color})));
    m.position.copy(P); m.renderOrder = 3;
    scene.add(m); snapMarkers.push(m);
  };
  for(const q of quadSnaps) add(q.pos, AXIS_CSS[q.axis]); // квадрант важнее вершины на том же месте
  for(const c of auxSnaps) add(c, 0x3fd9c9);
  const verts = corners.filter(c => !ringVertKeys.has(c.key));
  if(verts.length <= SNAP_MARK_MAX_VERTS) for(const c of verts) add(c.pos, 0xe8ecf2);
}

// ---- деление окружности (Divide в SketchUp, Circular Pattern в Fusion) ----
// Окружность — это либо нарисованная кривая (сегменты-линии с общим curve id),
// либо замкнутое круглое ребро тела. Вершины сортируются по углу вокруг
// центра; точка под углом θ — пересечение луча из центра с многоугольником,
// то есть лежит ровно на нарисованной геометрии
function ringFromPts(list){
  const pts = [], seen = new Set();
  for(const q of list){ const k = keyOf(q.x, q.y, q.z); if(!seen.has(k)){ seen.add(k); pts.push(q.clone()); } }
  if(pts.length < 6) return null;
  // черновой центр — среднее вершин; у ребра тела есть лишние точки от
  // Т-стыков на хордах, они сдвигают среднее (у R10 на 0.25 мм), поэтому
  // точный центр — площадной центроид многоугольника
  const ctr = new THREE.Vector3();
  for(const q of pts) ctr.add(q);
  ctr.multiplyScalar(1/pts.length);
  const u = new THREE.Vector3().subVectors(pts[0], ctr);
  if(u.length() < 0.05) return null;
  u.normalize();
  let n = null, best = 0;
  for(const q of pts){
    const c = new THREE.Vector3().subVectors(q, ctr).cross(u);
    if(c.length() > best){ best = c.length(); n = c; }
  }
  if(!n || best < 1e-6) return null;
  n.normalize().negate(); // (q − ctr) × u = −n: обход против часовой вокруг n
  const v = new THREE.Vector3().crossVectors(n, u);
  for(const q of pts) if(Math.abs(new THREE.Vector3().subVectors(q, ctr).dot(n)) > 0.01) return null; // не в плоскости
  const TAU = Math.PI*2;
  const sorted = () => pts.map(q => {
    const w = new THREE.Vector3().subVectors(q, ctr);
    const x = w.dot(u), y = w.dot(v);
    return {x, y, a: ((Math.atan2(y, x) % TAU) + TAU) % TAU};
  }).sort((i, j) => i.a - j.a);
  let items = sorted();
  let A = 0, cx = 0, cy = 0;
  for(let i=0;i<items.length;i++){
    const p = items[i], q = items[(i+1)%items.length], cr = p.x*q.y - q.x*p.y;
    A += cr; cx += (p.x + q.x)*cr; cy += (p.y + q.y)*cr;
  }
  if(Math.abs(A) < 1e-9) return null;
  ctr.addScaledVector(u, cx/(3*A)).addScaledVector(v, cy/(3*A));
  items = sorted();
  // дуга, а не полный круг, — большой разрыв по углу
  let gap = 0;
  for(let i=0;i<items.length;i++){
    const a0 = items[i].a, a1 = i+1 < items.length ? items[i+1].a : items[0].a + TAU;
    gap = Math.max(gap, a1 - a0);
  }
  if(gap > Math.PI/2.5) return null;
  // окружность: вершины на радиусе R, точки на хордах — не глубже прогиба
  // самой длинной хорды
  const rs = items.map(i => Math.hypot(i.x, i.y)), R = Math.max(...rs);
  if(R < 0.05 || Math.min(...rs) < R*Math.cos(gap/2) - 0.01) return null;
  // настоящие углы многоугольника (без точек посреди хорд) — число сегментов
  let segs = 0;
  for(let i=0;i<items.length;i++){
    const a = items[(i+items.length-1)%items.length], b = items[i], c = items[(i+1)%items.length];
    const cr = (b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x);
    if(Math.abs(cr) > 1e-3*Math.hypot(b.x-a.x, b.y-a.y)*Math.hypot(c.x-b.x, c.y-b.y)) segs++;
  }
  return {ctr, R, n, u, v, p2: items.map(i => [i.x, i.y]), ang: items.map(i => i.a), segs};
}
function ringFromCurve(id){
  const list = [];
  for(const g of guides) if(g.curve === id) list.push(g.a, g.b);
  return ringFromPts(list);
}
// окружность, на которой лежит точка P (или null)
function ringAt(P){
  for(const g of guides){
    if(!g.curve) continue;
    const ab = new THREE.Vector3().subVectors(g.b, g.a), L2 = ab.lengthSq();
    if(L2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, g.a).dot(ab) / L2));
    if(g.a.clone().addScaledVector(ab, t).distanceTo(P) < 2e-3){
      const r = ringFromCurve(g.curve);
      if(r) return r;
    }
  }
  const loc = chainAtPoint(P); // ребро тела
  if(!loc) return null;
  if(loc.chain.closed) return ringFromPts(loc.chain.pts);
  return ringFromEdgeChains(loc.chain);
}
// Круглое ребро тела (дно кармана, край отверстия) распадается на цепочки
// по граням стенки. Идём от конца к концу по соседним цепочкам, выбирая
// самое прямое продолжение в плоскости круга: стенка уходит под 90°,
// угол квадрата — тоже 90°, их отсекает порог 60°. Замкнулись — проверка
// на окружность в ringFromPts
function edgeChainEnds(){ // конец цепочки -> цепочки тела, которые там кончаются
  const ends = new Map();
  for(const c of chains){
    if(c.isGuide || c.closed) continue;
    for(const e of [c.pts[0], c.pts[c.pts.length-1]]){
      const k = keyOf(e.x, e.y, e.z);
      if(!ends.has(k)) ends.set(k, []);
      ends.get(k).push(c);
    }
  }
  return ends;
}
// ends — готовая карта концов (обход всех цепочек не строит её заново),
// walked — сюда складываются пройденные цепочки
function ringFromEdgeChains(c0, ends, walked){
  const kOf = q => keyOf(q.x, q.y, q.z);
  ends = ends || edgeChainEnds();
  const used = walked || new Set();
  used.add(c0);
  const pts = c0.pts.slice(), startK = kOf(c0.pts[0]);
  let tail = c0.pts[c0.pts.length-1], prev = c0.pts[c0.pts.length-2], n = null;
  for(let guard=0; guard<720 && kOf(tail) !== startK; guard++){
    const din = new THREE.Vector3().subVectors(tail, prev).normalize();
    let best = null, bestC = null, bestDot = 0.5; // поворот круче 60° — не окружность
    for(const c of ends.get(kOf(tail)) || []){
      if(used.has(c)) continue;
      const seq = kOf(c.pts[0]) === kOf(tail) ? c.pts : c.pts.slice().reverse();
      const dout = new THREE.Vector3().subVectors(seq[1], seq[0]).normalize();
      if(n && Math.abs(dout.dot(n)) > 1e-3) continue;
      const d = din.dot(dout);
      if(d > bestDot){ bestDot = d; best = seq; bestC = c; }
    }
    if(!best) return null;
    used.add(bestC);
    for(let i=1;i<best.length;i++) pts.push(best[i]);
    prev = best[best.length-2]; tail = best[best.length-1];
    if(!n && pts.length >= 3){
      const c = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[1]));
      if(c.length() > 1e-9) n = c.normalize();
    }
  }
  return kOf(tail) === startK ? ringFromPts(pts) : null;
}
function ringAngleOf(ring, P){
  const w = new THREE.Vector3().subVectors(P, ring.ctr);
  const TAU = Math.PI*2;
  return ((Math.atan2(w.dot(ring.v), w.dot(ring.u)) % TAU) + TAU) % TAU;
}
function ringPointAt(ring, th){
  const TAU = Math.PI*2, m = ring.p2.length;
  th = ((th % TAU) + TAU) % TAU;
  let i = m - 1; // ребро pts[i] → pts[i+1]; до первой вершины — замыкающее
  for(let k=0;k<m;k++){ if(ring.ang[k] <= th) i = k; else break; }
  const A = ring.p2[i], B = ring.p2[(i+1)%m];
  const dx = Math.cos(th), dy = Math.sin(th), ex = B[0]-A[0], ey = B[1]-A[1];
  const den = ex*dy - ey*dx;
  let t = Math.abs(den) < 1e-12 ? 0 : (A[1]*dx - A[0]*dy) / den;
  if(t < 1e-4) t = 0; else if(t > 1 - 1e-4) t = 1; // у вершины — ровно в вершину
  return ring.ctr.clone().addScaledVector(ring.u, A[0] + t*ex).addScaledVector(ring.v, A[1] + t*ey);
}
// «ровные» количества — делители числа сегментов: шаг кратен сегменту, и
// от вершины каждая точка попадает в вершину (сетка не режется). Нет
// делителей (простое число сегментов) — обычный набор
function ringCounts(segs){
  const d = [];
  for(let k=2;k<=Math.min(segs, 360);k++) if(segs % k === 0) d.push(k);
  if(d.length >= 3) return d.slice(0, 12);
  return [...new Set([...d, 2, 3, 4, 6, 8, 12])].sort((a, b) => a - b);
}
function ringAutoCount(segs){
  const c = ringCounts(segs);
  for(const k of [4, 6, 3, 8]) if(c.includes(k) && segs % k === 0) return k;
  return c.includes(4) ? 4 : c[0]; // делителей нет (7 сегментов) — привычные 4
}
// точка поставлена на окружность — окно деления в режиме круга
function openDivideRing(ring, P, seedUndo){
  // первая точка в вершине многоугольника? Только тогда делители дают вершины
  let onVertex = false;
  for(const [x, y] of ring.p2)
    if(ring.ctr.clone().addScaledVector(ring.u, x).addScaledVector(ring.v, y).distanceTo(P) < 1e-3){ onVertex = true; break; }
  divCtx = {ring, th0: ringAngleOf(ring, P), seedUndo, onVertex, auto: true};
  divN = ringAutoCount(ring.segs);
  ghost.visible = false; hideHints(); setHover(null); tipHide();
  document.getElementById('dv_cntrow').style.display = '';
  document.getElementById('dv_hint').style.display = hintsChk.checked ? '' : 'none';
  const vr = view.getBoundingClientRect();
  divPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 360) + 'px';
  divPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 260) + 'px';
  divPopup.hidden = false;
  renderDividePreview();
  dv_n.focus(); dv_n.select();
}
function openDivide(ch){
  divCtx = {chain: ch};
  document.getElementById('dv_cntrow').style.display = 'none';
  document.getElementById('dv_hint').style.display = 'none';
  divN = divideCounts(ch.total)[0];
  // будущие точки показывает превью — призрак в центре только путает
  ghost.visible = false; hideHints(); setHover(null); tipHide();
  const vr = view.getBoundingClientRect();
  divPopup.style.left = Math.min(lastMX - vr.left + 20, vr.width - 260) + 'px';
  divPopup.style.top  = Math.min(lastMY - vr.top + 12, vr.height - 160) + 'px';
  divPopup.hidden = false;
  renderDividePreview();
}
// строка статуса окна Divide: [цвет, текст] или null — строки нет
function setDivStat(st){
  dv_stat.style.display = st ? '' : 'none';
  dv_stat.style.color = st ? st[0] : '';
  dv_stat.textContent = st ? st[1] : '';
}
function renderDividePreview(){
  clearDivDots();
  if(!divCtx) return;
  if(divCtx.ring){
    const r = divCtx.ring, N = divN, step = 360/N;
    dv_len.innerHTML = '<div>Circle R ' + r.R.toFixed(1) + ' mm</div><div>' + r.segs + ' segments</div>';
    const even = r.segs % N === 0;
    dv_info.innerHTML = '<div>' + N + ' points · every ' + (+step.toFixed(2)) + '°</div>'
      + '<div>arc ' + (2*Math.PI*r.R/N).toFixed(2) + ' mm</div>';
    setDivStat(even && divCtx.onVertex ? ['#6aff3d', 'on vertices']
      : !even ? ['#ffcc00', '⚠ between vertices'] : null);
    document.getElementById('dv_auto').style.display = divCtx.auto ? '' : 'none';
    for(let k=1;k<N;k++){
      const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:C_EDGE})));
      m.position.copy(ringPointAt(r, divCtx.th0 + k*Math.PI*2/N));
      scene.add(m); divDots.push(m);
    }
    if(document.activeElement !== dv_n) dv_n.value = N;
    dv_sugg.innerHTML = ringCounts(r.segs)
      .map(k => '<button class="dvs'+(k===N?' sel':'')+'" data-n="'+k+'">'+k+'</button>').join('');
    return;
  }
  const ch = divCtx.chain, L = ch.total;
  // первая строка — что делим: длина ребра/линии, радиус и длина дуги/окружности
  const arc = fitArc(ch);
  dv_len.innerHTML = '<div>' + (ch.closed && arc ? 'Circle R ' + arc.R.toFixed(1) + ' mm'
    : arc ? 'Arc R ' + arc.R.toFixed(1) + ' mm' : (ch.isGuide ? 'Line' : 'Edge'))
    + '</div><div>length ' + L.toFixed(1) + ' mm</div>';
  const spacing = L/(divN+1);
  const aligned = Math.abs(spacing*10 - Math.round(spacing*10)) < 1e-6;
  dv_info.innerHTML = '<div>' + divN + ' point' + (divN>1?'s':'') + ' · ' + (divN+1) + ' parts</div>'
    + '<div>spacing ' + spacing.toFixed(2) + ' mm</div>';
  setDivStat(aligned ? null : ['#ffcc00', '⚠ off 0.1 mm grid']);
  for(let i=1;i<=divN;i++){
    const m = addOutline(new THREE.Mesh(sphereGeo,
      new THREE.MeshBasicMaterial({color:C_EDGE})));
    m.position.copy(chainPointAt(ch, L*i/(divN+1)));
    scene.add(m); divDots.push(m);
  }
  dv_sugg.innerHTML = divideCounts(L)
    .map(k => '<button class="dvs'+(k===divN?' sel':'')+'" data-n="'+k+'">'+k+'</button>').join('');
}
dv_sugg.addEventListener('click', ev=>{
  const n = ev.target.dataset && ev.target.dataset.n;
  if(n){ divN = +n; if(divCtx && divCtx.ring) divCtx.auto = false; releaseToolInput(); renderDividePreview(); }
});
dv_n.addEventListener('input', ()=>{
  const v = Math.round(+dv_n.value);
  if(divCtx && divCtx.ring && v >= 2 && v <= 360){ divN = v; divCtx.auto = false; renderDividePreview(); }
});
dv_n.addEventListener('keydown', e=>{
  if(e.key === 'Enter'){ e.preventDefault(); commitDivide(); }
  if(e.key === 'Escape'){ e.preventDefault(); cancelDivide(); releaseToolInput(); }
  e.stopPropagation(); // цифры не уходят в горячие клавиши
});
function commitDivide(){
  if(!divCtx) return;
  if(divCtx.ring){
    const {ring, th0, seedUndo} = divCtx, N = divN;
    const targets = [];
    for(let k=1;k<N;k++) targets.push(ringPointAt(ring, th0 + k*Math.PI*2/N));
    cancelDivide();
    if(!seedUndo) pushUndo(); // первая точка уже стояла — снимок нужен здесь
    for(const P of targets){
      if(anchors.some(a => a.pos.distanceTo(P) < 1e-3)) continue;
      const loc = chainAtPoint(P); // круглое ребро тела делится, линия — нет
      const Q = loc ? (splitEdgeAt(loc.chain, loc.s) || P) : P;
      makeAnchor(Q);
      extractEdges();
    }
    return;
  }
  const ch0 = divCtx.chain, L = ch0.total, n = divN;
  const targets = [];
  for(let i=1;i<=n;i++) targets.push(chainPointAt(ch0, L*i/(n+1)));
  cancelDivide();
  pushUndo();
  for(const P of targets){
    const loc = chainAtPoint(P); // цепочки пересобираются после каждого сплита
    const Q = loc ? (splitEdgeAt(loc.chain, loc.s) || P) : P;
    makeAnchor(Q);
    extractEdges();
  }
}
function cancelDivide(){ divCtx = null; clearDivDots(); divPopup.hidden = true; }
document.getElementById('dv_ok').addEventListener('click', commitDivide);
document.getElementById('dv_cancel').addEventListener('click', cancelDivide);
// окно можно перетаскивать за любое пустое место
let dvDrag = null;
divPopup.addEventListener('pointerdown', ev=>{
  if(ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return;
  dvDrag = {x: ev.clientX, y: ev.clientY,
            left: parseFloat(divPopup.style.left)||0, top: parseFloat(divPopup.style.top)||0};
  try{ divPopup.setPointerCapture(ev.pointerId); }catch(_){}
});
divPopup.addEventListener('pointermove', ev=>{
  if(!dvDrag) return;
  divPopup.style.left = (dvDrag.left + ev.clientX - dvDrag.x) + 'px';
  divPopup.style.top  = (dvDrag.top  + ev.clientY - dvDrag.y) + 'px';
});
divPopup.addEventListener('pointerup', ()=>{ dvDrag = null; });

// точка ставится кликом по призраку (и сразу тянется) — кнопки не нужны
function placePlacingPoint(){
  if(!placing) return null;
  pushUndo();
  placing.s = snapMM(placing.s);
  const P = splitEdgeAt(placing.chain, placing.s) || chainPointAt(placing.chain, placing.s);
  const a = makeAnchor(P);
  closePopup(); setHover(null); extractEdges();
  // цепочка запоминается всегда: Alt при перетаскивании включит изгиб дугой
  const kP = keyOf(P.x,P.y,P.z);
  const ch = chains.find(c=>c.pts.some(pt=>keyOf(pt.x,pt.y,pt.z)===kP));
  if(ch && !ch.closed && ch.pts.length>=3){
    a.bend = {pts0: ch.pts.map(p=>p.clone()),
              t: ch.cum.map(v=>v/ch.total),
              j: ch.pts.findIndex(pt=>keyOf(pt.x,pt.y,pt.z)===kP)};
  }
  return a;
}
window.addEventListener('keydown', e=>{
  if(divCtx && e.key === 'Enter'){ e.preventDefault(); commitDivide(); return; }
  if(edgeDrag && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement.tagName!=='INPUT'){
    if(e.code === 'KeyN' || e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'т'){
      e.preventDefault();
      if(!edgeDrag.normal){ warnTip('No face under this edge'); return; }
      edgeDrag.nKey = !edgeDrag.nKey; edgeDrag.nLock = edgeDrag.nKey;
      if(edgeDrag.nLock) setAxisLock(null);
      if(edgeDrag.typed) applyEdgeTyped();
      else updateEmPopup(edgeDrag.lastD || new THREE.Vector3());
      return;
    }
    const ch = /^[0-9]$/.test(e.key) ? e.key
      : (e.key === '-' || e.code === 'NumpadSubtract') ? '-'
      : (e.key === '.' || e.key === ',' || e.code === 'NumpadDecimal' || e.code === 'Period' || e.code === 'Comma') ? '.' : null;
    if(ch){
      e.preventDefault();
      if(ch === '-') edgeDrag.typed = edgeDrag.typed.startsWith('-') ? edgeDrag.typed.slice(1) : '-' + edgeDrag.typed;
      else if(!(ch === '.' && edgeDrag.typed.includes('.'))) edgeDrag.typed += ch;
      applyEdgeTyped();
      return;
    }
    if(e.key === 'Backspace' && edgeDrag.typed){
      e.preventDefault();
      edgeDrag.typed = edgeDrag.typed.slice(0, -1);
      applyEdgeTyped();
      return;
    }
    if(e.key === 'Enter'){ e.preventDefault(); if(edgeDrag.typed) applyEdgeTyped(); finishEdgeMove(); return; }
    if(e.code === 'KeyF' || e.key.toLowerCase() === 'f'){ // торцы: по соседней грани / поперёк линии
      e.preventDefault(); setEdgeEnd(edgeDrag.endMode === 'straight' ? 'face' : 'straight'); return;
    }
  }
  if((dragPt || edgeDrag) && !e.ctrlKey && !e.altKey && !e.metaKey){
    const ax = {KeyX:'x', KeyY:'y', KeyZ:'z'}[e.code]
             || {x:'x', y:'y', z:'z'}[e.key.toLowerCase()]; // как в Blender
    if(ax){
      e.preventDefault(); setAxisLock(axisLock===ax ? null : ax);
      if(edgeDrag){ edgeDrag.nKey = false; edgeDrag.nLock = false; if(edgeDrag.typed) applyEdgeTyped(); }
      return;
    }
  }
  // P — точка (Point): то же, что G,Y
  if((e.code==='KeyP' || e.key.toLowerCase()==='p') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(chordG){ chordG = 0; hideChordHint(); }
    setPointMode(!pointMode);
    return;
  }
  // Ctrl+B — фаска/скругление выбранных рёбер (Bevel в Blender)
  if((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyB'
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(activeTool === bevelTool){ setActiveTool(null); return; }
    const mesheEdges = edgeSel.filter(x=>!x.isGuide);
    if(!mesheEdges.length && ppPatch){ // грань: фаска по её контурам
      if(ppParts && ppParts.length > 1){ warnTip('Select one face to bevel its outline'); return; }
      hideChordHint();
      bevelTool.edges = []; bevelTool.face = ppPatch.tris[0];
      hidePatch(); ppPatch = null; ppParts = null;
      setActiveTool(bevelTool);
      return;
    }
    if(!mesheEdges.length){ warnTip('Select an edge of the body or a face to bevel'); return; }
    const eds = [];
    for(const es of mesheEdges){
      const ed = analyzeBevelEdge(es.pts);
      if(ed.err){ warnTip(ed.err); return; }
      eds.push(ed);
    }
    hideChordHint();
    bevelTool.edges = eds; bevelTool.face = -1; setActiveTool(bevelTool);
    return;
  }
  // Q — поворот/копия выбранных линий или точки (Rotate в SketchUp)
  if((e.code==='KeyQ' || e.key.toLowerCase()==='q') && !chordG && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(activeTool === rotTool){ setActiveTool(null); return; }
    const it = collectRotItems();
    if(rotItemsEmpty(it)){ warnTip('Select drawn lines or a point to rotate'); return; }
    hideChordHint();
    rotTool.items = it; setActiveTool(rotTool);
    return;
  }
  // G,I — Mirror тела, G,B — Move / Copy / Scale тела (раньше B — рёбра границы), G,H — Shell
  for(const [code, ch, tool] of [['KeyI', 'i', mirTool], ['KeyB', 'b', xfTool], ['KeyH', 'h', shellTool]]){
    if((e.code===code || e.key.toLowerCase()===ch) && chordG && !e.ctrlKey && !e.altKey && !e.metaKey
       && document.activeElement.tagName!=='INPUT'){
      e.preventDefault(); chordG = 0; hideChordHint();
      if(!(mesh.geometry.attributes.position.array.length)){ warnTip('The model is empty'); return; }
      setActiveTool(activeTool === tool ? null : tool);
      return;
    }
  }
  // G,O — Revolve (тело вращения профиля), G,W — Sweep (профиль вдоль пути),
  // G,F — Loft (тело между двумя профилями); раньше O — отступ грани, F — заливка
  for(const [code, ch, kind] of [['KeyO', 'o', 'revolve'], ['KeyW', 'w', 'sweep'], ['KeyF', 'f', 'loft']]){
    if((e.code===code || e.key.toLowerCase()===ch) && chordG && !e.ctrlKey && !e.altKey && !e.metaKey
       && document.activeElement.tagName!=='INPUT'){
      e.preventDefault(); chordG = 0; hideChordHint();
      if(activeTool === profTool && profTool.kind === kind) setActiveTool(null);
      else { setActiveTool(null); profTool.start(kind); }
      return;
    }
  }
  // G,U — цилиндр/конус на грани (Create → Cylinder во Fusion)
  if((e.code==='KeyU' || e.key.toLowerCase()==='u') && chordG && !e.ctrlKey && !e.altKey && !e.metaKey
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    setActiveTool(activeTool === cylTool ? null : cylTool);
    return;
  }
  // G,S — срез плоскостью (Bisect в Blender, Split Body во Fusion)
  if((e.code==='KeyS' || e.key.toLowerCase()==='s') && chordG && !e.ctrlKey && !e.altKey && !e.metaKey
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    setActiveTool(activeTool === sliceTool ? null : sliceTool);
    return;
  }
  // G,A — круговой массив выбранных линий или точки (PolarPattern во FreeCAD)
  if((e.code==='KeyA' || e.key.toLowerCase()==='a') && chordG && !e.ctrlKey && !e.altKey && !e.metaKey
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    const it = collectRotItems();
    if(rotItemsEmpty(it)){ warnTip('Select drawn lines or a point for the array'); return; }
    arrTool.items = it; setActiveTool(arrTool);
    return;
  }
  // T — рулетка (Tape Measure в SketchUp); G,T занят 3D-текстом
  if((e.code==='KeyT' || e.key.toLowerCase()==='t') && !chordG && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    setActiveTool(activeTool === tapeTool ? null : tapeTool);
    return;
  }
  // R — прямоугольник (Rectangle в SketchUp); G,R — то же аккордом
  if((e.code==='KeyR' || e.key.toLowerCase()==='r') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(chordG){ chordG = 0; hideChordHint(); setActiveTool(rectTool); }
    else setActiveTool(activeTool === rectTool ? null : rectTool);
    return;
  }
  // G,V — фокус в поля X/Y/Z выбранной вершины/точки или ребра (середина)
  if((e.code==='KeyV' || e.key.toLowerCase()==='v') && chordG
     && (sel || selAnchor || edgeSel.length === 1)
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    openVPanel(); // окно ввода X/Y/Z — у курсора
    vx.focus(); vx.select();
    return;
  }
  if(lineMode && lineStart){ // набор длины отрезка с клавиатуры (Measurements SketchUp)
    if(/^[0-9]$/.test(e.key) || e.key==='.' || e.key===','){
      lineLenStr += (e.key===',' ? '.' : e.key);
      updateLineInfo();
      e.preventDefault(); return;
    }
    if(e.key==='Backspace'){ lineLenStr = lineLenStr.slice(0,-1); e.preventDefault(); return; }
    if(e.key==='Enter' && lineLenStr){
      const len = parseFloat(lineLenStr);
      const dir = lineDirLock || (lastLinePt && lastLinePt.distanceTo(lineStart)>0.05
        ? new THREE.Vector3().subVectors(lastLinePt, lineStart).normalize() : null);
      if(len>0 && dir){
        commitLinePoint(lineStart.clone().addScaledVector(dir, snapMM(len)));
        killRubber();
      }
      e.preventDefault(); return;
    }
  }
  // аккорд G,… как в Sketcher (FreeCAD): G — «geometry», затем L или M
  if((e.code==='KeyG' || e.key.toLowerCase()==='g') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = performance.now();
    showChordHint();
    return;
  }
  if((e.code==='KeyL' || e.key.toLowerCase()==='l') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(chordG && performance.now() - chordG < 3000){
      chordG = 0; hideChordHint();
      lineChain = false; setLineMode(true); // G,L — одиночный отрезок
    } else {
      // L — тоже одиночный отрезок (нарисовал — инструмент выключился);
      // непрерывная цепочка — это G,M (полилиния)
      lineChain = false; setLineMode(!lineMode);
    }
    return;
  }
  // клавиши активного инструмента каркаса (размеры, Enter)
  if(activeTool && activeTool.key && document.activeElement.tagName!=='INPUT' && activeTool.key(e)) return;
  // ввод радиуса окружности цифрами
  if(circleMode && (circleCenter || circLastValid()) && document.activeElement.tagName!=='INPUT'){
    if(/^[0-9]$/.test(e.key) || e.key==='.' || e.key===','){
      circleRStr += (e.key===',' ? '.' : e.key); updateCircInfo(); e.preventDefault(); return;
    }
    if(e.key==='Backspace' && circleRStr){ circleRStr = circleRStr.slice(0,-1); updateCircInfo(); e.preventDefault(); return; }
    if(e.key==='Enter'){
      const d = parseFloat(circleRStr); // с клавиатуры вводится диаметр
      circleRStr = '';
      if(circleCenter){
        if(d > 0.4) circleR = snapMM(d/2); // радиус на сетке 0.1
        if(circAuto) circ_seg.value = autoCircSegs(circleR);
        commitCircle();
      } else if(d > 0.4){ // Ø после постановки — перерисовать круг (как в SketchUp)
        if(circAuto) circ_seg.value = autoCircSegs(snapMM(d/2));
        recommitCircle(snapMM(d/2));
      }
      updateCircInfo();
      e.preventDefault(); return;
    }
  }
  // G,Y — точка
  if((e.code==='KeyY' || e.key.toLowerCase()==='y') && chordG
     && performance.now() - chordG < 4000 && !e.ctrlKey && !e.altKey && !e.metaKey
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    setPointMode(true); return;
  }
  // G,T — 3D-текст на грани
  if((e.code==='KeyT' || e.key.toLowerCase()==='t') && chordG
     && performance.now() - chordG < 4000 && !e.ctrlKey && !e.altKey && !e.metaKey
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    openTextPopup(); return;
  }
  // C — окружность (Circle, как C в SketchUp); G,C — то же аккордом
  if((e.code==='KeyC' || e.key.toLowerCase()==='c') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && document.activeElement.tagName!=='INPUT'){
    e.preventDefault();
    if(chordG){ chordG = 0; hideChordHint(); setCircleMode(true); }
    else setCircleMode(!circleMode);
    return;
  }
  // F — залить выбранный контур, а без выбора — дырку (Fill, как F в Blender)
  if((e.code==='KeyF' || e.key.toLowerCase()==='f') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !dragPt && !lineMode && !pointMode && !circleMode && !textMode && !activeTool
     && document.activeElement.tagName!=='INPUT'){
    const selLoop = edgeSelLoop();
    if(e.shiftKey){ // Shift+F — одна ровная грань вместо всего, что внутри контура
      e.preventDefault();
      if(!selLoop){ warnTip('Shift+F: select one closed flat contour'); return; }
      if(flatFillLoop(selLoop)){ clearEdgeSel(); hideChordHint(); }
      return;
    }
    const fill = selLoop ? loopFillPieces(selLoop) : null;
    if(fill && fill.covered && !fill.air.length){
      warnTip('This contour is already a face'); e.preventDefault(); return;
    }
    if(fill && fill.covered && fillLoopAir(fill)){ clearEdgeSel(); hideChordHint(); e.preventDefault(); return; }
    if(selLoop && fillLoop(selLoop)){ clearEdgeSel(); hideChordHint(); e.preventDefault(); return; }
    // что-то выбрано, но это не один замкнутый контур — F ничего не делает
    // (палитра F и не предлагает); «ближайшая дырка» — только без выбора
    if(edgeSel.length || ppPatch || selAnchor || sel){
      if(edgeSel.length) warnTip('F fills one closed contour — select only its edges');
      e.preventDefault(); return;
    }
    if(fillHole()){ e.preventDefault(); return; }
  }
  // Del — стереть выбранное ребро/линию (Refine shape во FreeCAD)
  if((e.key==='Delete' || e.key==='Backspace') && edgeSel.length && !dragPt
     && !edgeDrag && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); deleteSelEdges(); return;
  }
  // Del — удалить выбранную точку (как удаление вершины во FreeCAD)
  if((e.key==='Delete' || e.key==='Backspace') && selAnchor && !dragPt
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); deleteSelAnchor(); return;
  }
  // B — рёбра границы выбранной грани (Bounding Edges в SketchUp)
  if((e.code==='KeyB' || e.key.toLowerCase()==='b') && !e.ctrlKey && !e.altKey && !e.metaKey
     && ppPatch && !dragPt
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); selectPatchBoundary(); return;
  }
  // B при одном выбранном ребре/линии — замкнутый плоский контур через него
  if((e.code==='KeyB' || e.key.toLowerCase()==='b') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !ppPatch && edgeSel.length === 1 && !dragPt && !edgeDrag
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); selectContourFromEdge(); return;
  }
  // Del — удалить выбранную грань (как ластик по грани в SketchUp)
  if((e.key==='Delete' || e.key==='Backspace') && ppPatch && !dragPt
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); deleteFacePatch(); return;
  }
  // O — параллельный контур внутри грани (Offset в SketchUp)
  if((e.code==='KeyO' || e.key.toLowerCase()==='o') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !lineMode && !dragPt && (ppPatch || offLive)
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    if(offLive) closeOffset(); else openOffset();
    return;
  }
  // Ctrl+I — инвертировать выбор областей плоскости (Blender Select → Invert)
  if((e.code==='KeyI' || e.key.toLowerCase()==='i' || e.key.toLowerCase()==='ш') && (e.ctrlKey || e.metaKey)
     && !e.altKey && !e.shiftKey && ppPatch && !exLive && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); invertFaceSelection(); return;
  }
  // E — точное выдавливание выбранной грани (Extrude, как E в Blender)
  if((e.code==='KeyE' || e.key.toLowerCase()==='e') && !e.ctrlKey && !e.altKey && !e.metaKey
     && ppPatch && !offLive && !lineMode && !dragPt
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint(); openExtrude(); return;
  }
  if((e.code==='KeyM' || e.key.toLowerCase()==='m') && !e.ctrlKey && !e.altKey && !e.metaKey
     && chordG && performance.now() - chordG < 3000
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); chordG = 0; hideChordHint();
    lineChain = true; setLineMode(true); // G,M — полилиния
    return;
  }
  // M — двигать выбранное ребро (Move, как в SketchUp)
  if((e.code==='KeyM' || e.key.toLowerCase()==='m') && !e.ctrlKey && !e.altKey && !e.metaKey
     && !chordG && edgeSel.length === 1 && !dragPt && !edgeDrag
     && document.activeElement.tagName!=='INPUT'){
    e.preventDefault(); startEdgeMove(); return;
  }
  if((e.ctrlKey || e.metaKey) && e.shiftKey
     && (e.code==='KeyZ' || e.key.toLowerCase()==='z')){ // Ctrl+Shift+Z — повтор
    e.preventDefault(); redo(); return;
  }
  if((e.ctrlKey || e.metaKey) && !e.shiftKey
     && (e.code==='KeyZ' || e.key.toLowerCase()==='z')){ // e.code — работает и в русской раскладке
    e.preventDefault(); undo(); return;
  }
  if(e.ctrlKey && e.altKey && e.code==='KeyQ'){ // как в Blender: Toggle Quad View
    e.preventDefault();
    quadChk.checked = !quadChk.checked;
    applyViewMode();
    return;
  }
  if(e.key==='Escape'){
    if(edgeDrag){ // отмена переноса ребра — вернуть как было
      const pushed = edgeDrag.snapPushed;
      edgeDrag = null; setAxisLock(null); snapDot.visible = false; closeEmPopup();
      if(pushed) undo(true);
    }
    closePopup(); deselect(); tipHide(); clearEdgeSel();
    hideChordHint(); chordG = 0; closeExtrude(); closeOffset(); cancelDivide();
    hidePatch(); ppPatch=null; // снять выбор плоскости
    if(pointMode) setPointMode(false);
    if(activeTool && !(activeTool.esc && activeTool.esc())) setActiveTool(null);
    if(circleMode){
      if(circleCenter){ circleCenter=null; circleRStr=''; circRLock = false; killRing(); hidePlaneTargets(); updateCircInfo(); }
      else setCircleMode(false);
    }
    if(lineMode){
      if(lineStart){ lineStart=null; lastLinePt=null; lineLenStr=''; lineDirLock=null; lineLenLock=null; lineAngLock=null; killRubber(); updateLineInfo(); }
      else setLineMode(false);
    }
    if(!lineMode && !linePopup.hidden){ closeLinePopup();
    }
    
    cancelText(); // 3D-текст: откат предпросмотра и закрытие окна
  }
});

let drag=null;
// кольцо одинаковых вершин: тот же радиус и Z; anyZ — «колонна» по всем высотам
function ringCornersAt(pos, anyZ){
  const r0 = Math.hypot(pos.x, pos.y), z0 = pos.z;
  return corners.filter(cc =>
    Math.abs(Math.hypot(cc.pos.x, cc.pos.y) - r0) < 0.05 &&
    (anyZ || Math.abs(cc.pos.z - z0) < 0.05));
}
let ringMarkers = [];
function clearRingMarkers(){ for(const m of ringMarkers) scene.remove(m); ringMarkers = []; }

// начать перетаскивание точки (a) или выбранной вершины (c)
function beginDrag(a, c, q, altKey, pointerId, ctrlKey, shiftKey){
  // кольцо: Alt (loop-select Blender), Ctrl, или вершина уже выбрана двойным кликом;
  // Shift дополнительно превращает кольцо в «колонну» (обе крышки разом)
  const wantRing = !!c && (altKey || ctrlKey || shiftKey ||
    (sel && sel.ring && sel.pos.distanceTo(c.pos) < 1e-3));
  if(c) selectVertex(c.pos);
  if(wantRing){ sel.ring = true; clearRingMarkers(); }
  const tgt = a ? a.pos : sel.pos;
  const nrm = q.is3D
    ? new THREE.Vector3().subVectors(persp.position, camTarget).normalize()
    : q.cam.position.clone().normalize(); // орто: строго в плоскости вида
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, tgt);
  dragPt = {a, isSel: !!c, start: tgt.clone(), plane,
            q0: {cam:q.cam, ox:q.ox, oy:q.oy, w:q.w, h:q.h},
            snap: takeSnapshot(), snapPushed: false,
            markers: a ? [a.marker] : [selMarker]};
  if(wantRing){ // кольцевая симметрия: тянем все повторяющиеся вершины
    const ring = ringCornersAt(tgt, shiftKey);
    const byKey = new Map();
    const items = ring.map(cc => {
      const it = {ang: Math.atan2(cc.pos.y, cc.pos.x), z0: cc.pos.z, idx: []};
      byKey.set(keyOf(cc.pos.x, cc.pos.y, cc.pos.z), it);
      return it;
    });
    const pos = mesh.geometry.attributes.position.array;
    for(let i=0;i<pos.length;i+=3){
      const it = byKey.get(keyOf(pos[i], pos[i+1], pos[i+2]));
      if(it) it.idx.push(i);
    }
    dragPt.ringRun = {items, r0: Math.hypot(tgt.x, tgt.y), z0: tgt.z};
  } else if(a && a.bend && altKey){ // Alt = режим дуги (как модификаторы Move в SketchUp)
    const im = buildIndexMap(a.bend.pts0);
    dragPt.bendRun = {
      A: a.bend.pts0[0].clone(),
      B: a.bend.pts0[a.bend.pts0.length-1].clone(),
      t: a.bend.t, j: a.bend.j,
      cur: a.bend.pts0.map(p=>p.clone()),
      idx: a.bend.pts0.map(p=>im.get(keyOf(p.x,p.y,p.z))||[])
    };
  } else {
    const pos = mesh.geometry.attributes.position.array;
    const k0 = keyOf(tgt.x, tgt.y, tgt.z);
    const idx=[];
    for(let i=0;i<pos.length;i+=3) if(keyOf(pos[i],pos[i+1],pos[i+2])===k0) idx.push(i);
    dragPt.idx = idx;
  }
  try{ canvas.setPointerCapture(pointerId); }catch(_){}
}

canvas.addEventListener('pointerdown', e=>{
  const q = quadPos(e);
  if(!q.inside) return;
  // гасим только транзитную G-палитру; палитра выбора живёт до нового выбора
  if(chordG){ hideChordHint(); chordG = 0; }
  if(e.button===0 && gizmoClick(e)) return; // клик по ViewCube
  if(edgeDrag && edgeDrag.grabMode){ // перенос ребра: клик фиксирует
    if(e.button === 0) finishEdgeMove();
    return;
  }
  // ЛКМ по самому лоскуту при открытом окне Extrude — тянуть мышью вдоль
  // нормали (значение в поле бежит следом); другая грань — обычный выбор
  if(exLive && e.button === 0 && q.inside){
    const f = raycastFace(q);
    if(f){
      const o = f.faceIndex*9;
      if(exLive.set.has(o) && exLive.set.has(o+3) && exLive.set.has(o+6)){
        const rc = canvas.getBoundingClientRect();
        const lx = (e.clientX - rc.left) - q.ox, ly = (e.clientY - rc.top) - q.oy;
        raycaster.setFromCamera({x: lx/q.w*2-1, y: -(ly/q.h*2-1)}, q.cam);
        exFaceDrag = {
          q0: {cam: q.cam, ox: q.ox, oy: q.oy, w: q.w, h: q.h},
          base: f.point.clone(), n: exLive.n.clone(),
          t0: rayLineParam(raycaster.ray, f.point, exLive.n),
          v0: exLive.applied
        };
        try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
        return;
      }
    }
  }
  // окно выдавливания живёт при вращении и пустых кликах; закрывается оно
  // только когда кликом ВЫБРАН другой объект (см. развязки кликов ниже).
  // Ctrl+ЛКМ мимо выдавливаемой грани — временная орбита (на грани — Cut)
  if(exLive && e.button === 0 && e.ctrlKey && q.is3D){
    drag = {x: e.clientX, y: e.clientY, b: 1};
    try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
    return;
  }
  if(divCtx){ // окно деления открыто: камера свободна, инструменты — на паузе
    tipHide();
    if(q.is3D){
      drag = {x: e.clientX, y: e.clientY, b: e.button};
      try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
    }
    return;
  }
  if(placing){
    // клик по бегунку-точке — поставить её и сразу тянуть
    const gp = {x:0,y:0,z:0};
    projToQuad(ghost.position, q.cam, q.w, q.h, gp);
    if(e.button===0 && Math.hypot(gp.x-q.mx, gp.y-q.my) < 12){
      const a = placePlacingPoint();
      if(a) beginDrag(a, null, q, e.altKey, e.pointerId);
      return;
    }
    closePopup();
    return;
  }
  // в режимах инструментов камера не отнимается: ПКМ — сдвиг, СКМ — вращение,
  // а Ctrl+ЛКМ — временная орбита (отпустил — инструмент снова в руке)
  if((e.button === 2 || e.button === 1 || (e.button === 0 && e.ctrlKey))
     && (pointMode || circleMode || lineMode || textMode || activeTool) && q.is3D
     && !(activeTool && activeTool.wantsCtrlClick && activeTool.wantsCtrlClick())){
    drag = {x: e.clientX, y: e.clientY, b: e.button === 0 ? 1 : e.button};
    try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
    return;
  }
  if(pointMode){ // режим «Точка»: клик ставит точку с привязками
    if(e.button===0 && q.inside){
      const pt = linePickPoint(q) || pickGround(q);
      if(!pt) return;
      // точка на окружности — ставим её и предлагаем разложить по кругу
      const ring = pt.kind !== 'center' && pt.kind !== 'origin' && !pt.ground ? ringAt(pt.pos) : null;
      if(ring){
        let seedUndo = false;
        if(!anchors.some(a => a.pos.distanceTo(pt.pos) < 1e-3)){
          pushUndo(); seedUndo = true;
          const loc = chainAtPoint(pt.pos);
          makeAnchor(loc ? (splitEdgeAt(loc.chain, loc.s) || pt.pos) : pt.pos);
          extractEdges();
        }
        openDivideRing(ring, pt.pos, seedUndo);
        return;
      }
      if(pt.kind === 'midpoint' && pt.chain){
        openDivide(pt.chain); // центр -> окошко деления с превью
        return;
      }
      if((pt.kind === 'on edge') && pt.chain && !pt.chain.isGuide){
        pushUndo();
        const P = splitEdgeAt(pt.chain, pt.s) || pt.pos;
        makeAnchor(P);
        extractEdges();
        return;
      }
      // здесь уже стоит точка — не дублируем её второй такой же
      if(anchors.some(a=>a.pos.distanceTo(pt.pos) < 1e-3)) return;
      pushUndo(); makeAnchor(pt.pos); extractEdges();
    }
    return;
  }
  if(textMode){ // режим «3D Text»: клик ставит красную стартовую точку,
    // зажатая ЛКМ тащит её по грани (сетка 0.1), отпускание фиксирует
    if(e.button===0 && q.inside){
      const p = readTextParams();
      if(p){
        textParams = p;
        // предпросмотр — наша же геометрия, и луч попадал бы в сами буквы
        // (якорь уезжал от грани наружу с каждым кликом). Снимаем его ДО
        // луча: целимся всегда в чистое тело, как SketchUp целится мимо
        // собственного превью
        if(txtLive) undo(true);
        const f = raycastFace(q);
        if(!f){ // мимо тела: вернуть предпросмотр на прежнее место
          if(txtLive) placeTextAt(txLeftFromAnchor(txtLive.P, txtLive.n, p), txtLive.n);
          return;
        }
        const n = triNormalAt(f.faceIndex);
        // якорь = центр текста: к вершине, середине ребра, центру грани или
        // круга прилипает точно; иначе — сетка 0.1 в плоскости грани
        const pk = pickOnFace(q); // предпросмотр уже снят — магниты по чистому телу
        const snapped = pk && pk.faceIndex !== undefined && pk.kind !== 'on face';
        const P = snapped ? pk.pos.clone()
          : new THREE.Vector3(snapMM(f.point.x), snapMM(f.point.y), snapMM(f.point.z));
        if(!snapped) P.addScaledVector(n, -new THREE.Vector3().subVectors(P, f.point).dot(n));
        hidePlaneTargets(); ghost.visible = false; tipHide();
        const C = planeCentroid(n, f.point); // центр грани (чистой)
        const sn = txCenterSnap(P, n, C, p); // магнит к центру грани
        placeTextAt(txLeftFromAnchor(P, n, p), n);
        txtLive = {P: P.clone(), n: n.clone(), C};
        showTxAnchor(P);
        showTxCenter(C);
        txSnapTip(e, sn);
        txPlaceDrag = {
          q0: {cam: q.cam, ox: q.ox, oy: q.oy, w: q.w, h: q.h},
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, f.point),
          n: n.clone(), lastT: performance.now(), dirty: false
        };
        try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
      }
    }
    return;
  }
  if(offLive){ // окно Offset: клик по сцене врезает контур
    if(e.button === 0 && q.inside) commitOffset();
    return;
  }
  if(activeTool){ activeTool.down(e, q); return; }
  if(circleMode){ // режим «Окружность»: центр, затем радиус
    if(e.button===0 && q.inside){
      if(!circleCenter){
        const pk = pickOnFace(q); // грань, а если под курсором её нет — земля XY
        if(pk){
          circlePlane = pk.n;
          circleCenter = pk.pos.clone(); // центр строго в плоскости грани/земли
          circleR = 0;
          circleDown = {x: e.clientX, y: e.clientY};
          circPatch = pk.faceIndex !== undefined ? facePatchCached(pk.faceIndex) : null;
          circLast = null; circAuto = true; circleRStr = ''; circRLock = false;
          if(circFixedR){ // размер уже задан в окне — клик ставит круг
            circleR = circFixedR; circleDown = null;
            circ_seg.value = autoCircSegs(circleR);
            commitCircle();
          }
          updateCircInfo();
        }
      } else {
        commitCircle();
      }
    }
    return;
  }
  if(lineMode){ // режим «Линия»: клики ставят точки хорды
    if(e.button===0 && q.inside){
      const pt = linePickPoint(q) || pickGround(q);
      if(pt){
        // Alt+клик в полилинии — «перо поднято»: отрезок от прежней точки не
        // рисуется, щелчок ставит новое начало (как Break/новый старт у
        // полилинии), инструмент остаётся в руке
        if(e.altKey && lineChain && lineStart){
          lineStart = null; lastLinePt = null; lineLenStr = ''; lineLenLock = null; lineAngLock = null;
          killRubber();
        }
        let pos = pt.pos;
        if(lineStart && e.shiftKey) pos = shiftOrtho(lineStart, pos).p; // 90°, как в Draft
        else if(lineStart && (pt.kind==='on face' || pt.kind==='on edge' || pt.kind==='on ground')){
          const a = axisInfer(lineStart, pos); // клик кладёт точку туда же, куда тянуло
          if(a) pos = a.p;
          else {
            const f = raycastFace(q);
            const pp = perpInfer(lineStart, pos, f ? triNormalAt(f.faceIndex) : null);
            if(pp) pos = pp.p;
          }
        }
        { const lk = lineLockedEnd(pos); if(lk) pos = lk.pos; }
        const wasFirst = !lineStart;
        if(wasFirst){ // плоскость линии — для угла из окна
          const f0 = raycastFace(q);
          lineStartN = f0 ? triNormalAt(f0.faceIndex) : GROUND_N.clone();
        }
        commitLinePoint(pos);
        // стартовали с ребра/линии — запоминаем его направление для
        // угловых магнитов; точка/вершина тоже знает своё ребро-хозяина
        if(wasFirst){
          if(pt.chain && pt.s !== undefined){
            lineHostDir = chainDirAt(pt.chain, pt.s);
          } else {
            lineHostDir = null;
            for(const ch of chains){
              if(ch.closed) continue;
              const s = chainParamOf(ch, pos);
              if(s !== null){ lineHostDir = chainDirAt(ch, s); break; }
            }
          }
        }
        lineDirLock = null;
        killRubber();
      }
    }
    return;
  }
  if(e.button===0){
    const a = anchorAt(q);
    const c = a ? null : pickCorner(q);
    // точки тянутся сразу; вершины — только с модификатором (кольцо/колонна),
    // обычный клик по вершине лишь выбирает, а драг остаётся камерой
    if(a || (c && (e.altKey || e.ctrlKey || e.shiftKey))){
      if(exLive) closeExtrude(); // взялся за другой объект — окно закрывается
      beginDrag(a, c, q, e.altKey, e.pointerId, e.ctrlKey, e.shiftKey);
      return;
    }
    if(c){
      if(exLive) closeExtrude();
      pendingVertex = {pos: c.pos.clone(), x: e.clientX, y: e.clientY};
      try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
      return;
    }
    if(e.ctrlKey && hover){ // Ctrl+клик: копим выбор рёбер (FreeCAD/SketchUp)
      toggleEdgeSel(hover.chain);
      if(edgeSel.length) showEdgePalette(hover.chain); else hideChordHint(); // шапка — по составу
      return;
    }
    if(hover){
      if(hover.chain.isGuide){ // клик по линии — выбор, как у рёбер
        const ch = hover.chain;
        clearEdgeSel();
        // окружность — единая кривая: сегменты берутся вместе (Arc/Circle
        // в SketchUp выбирается целиком). Alt+клик — только один сегмент
        if(ch.curve && !e.altKey){
          for(const c of chains) if(c.curve === ch.curve) toggleEdgeSel(c);
        } else toggleEdgeSel(ch);
        showEdgePalette(ch);
        return;
      }
      // решение клик/драг откладываем до движения мыши
      pendingEdge = {chain: hover.chain, s: hover.s, x: e.clientX, y: e.clientY,
                     q0: {cam:q.cam, ox:q.ox, oy:q.oy, w:q.w, h:q.h}, is3D: q.is3D};
      try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
      return;
    }
  }
  tipHide();
  if(q.is3D){ // орбита/сдвиг — только в 3D-окне
    // ЛКМ без движения — это клик: на грани выберет её, в пустоте снимет выбор
    drag={x:e.clientX, y:e.clientY, b:e.button,
          click: e.button===0 ? {x:e.clientX, y:e.clientY} : null};
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointerup', e=>{
  if(activeTool && activeTool.up && activeTool.up(e)){ drag = null; return; }
  if(circleMode && circleCenter && circleDown){
    // тянули от центра и отпустили — круг ставится сразу, а не ждёт клика
    const moved = Math.hypot(e.clientX-circleDown.x, e.clientY-circleDown.y) > 4;
    circleDown = null;
    if(moved && circleR > 0.3 && !circRLock){ commitCircle(); return; }
  }
  if(txPlaceDrag){ // отпустили точку текста — финальная перестройка
    if(txPlaceDrag.dirty && txtLive){
      undo(true);
      placeTextAt(txLeftFromAnchor(txtLive.P, txtLive.n, textParams), txtLive.n.clone());
    }
    txPlaceDrag = null;
    return;
  }
  if(exFaceDrag){ // отпустили лоскут — значение остаётся, окно живёт
    exFaceDrag = null;
    setExOp(e.ctrlKey ? 'cut' : null); // отпустил с Ctrl — Cut закреплён
    if(exOpManual === 'cut' && exNoOp()) setExOp(null); // но не бессмысленный Cut в пустоту
    return;
  }
  if(edgeDrag){
    edgeDrag = null; pendingEdge = null;
    tipHide(); normalsFlush(); extractEdges();
  } else if(pendingEdge){
    // без движения — это клик по ребру: зелёный выбор (как во FreeCAD)
    const pe = pendingEdge; pendingEdge = null;
    if(exLive) closeExtrude(); // выбран другой объект — окно инструмента прочь
    clearEdgeSel();
    toggleEdgeSel(pe.chain);
    showEdgePalette(pe.chain);
  }
  if(pendingVertex){
    // без движения — клик по вершине: зелёный выбор + панель X/Y/Z
    const pv = pendingVertex; pendingVertex = null;
    if(exLive) closeExtrude();
    selectVertex(pv.pos);
    showVertexPalette();
  }
  if(drag && drag.click && !pointMode && !lineMode && !circleMode && !textMode && !divCtx && !activeTool
     && Math.hypot(e.clientX-drag.click.x, e.clientY-drag.click.y) < 3){
    // клик ЛКМ без движения: по грани — выбрать её, в пустоту — снять весь выбор
    const q = quadPos(e);
    const f = q.inside ? raycastFace(q) : null;
    if(f){
      if(exLive) closeExtrude(); // выбрана другая грань — окно закрывается
      clearEdgeSel(); deselect(); // грань снимает выбор рёбер и точки
      if(e.ctrlKey && ppPatch && ppParts && ppParts.length){
        // Ctrl+клик: собрать несколько областей ОДНОЙ плоскости (FreeCAD);
        // повторный Ctrl+клик по выбранной области снимает её
        const k = ppParts.findIndex(p=>p.set.has(f.faceIndex));
        if(k >= 0){
          if(ppParts.length > 1) ppParts.splice(k, 1);
        } else {
          const np = facePatchCached(f.faceIndex);
          const base = ppParts[0];
          if(np.normal.dot(base.normal) > 0.999
             && Math.abs(patchPlaneD(np) - patchPlaneD(base)) < 0.05)
            ppParts.push(np);
          else ppParts = [np]; // другая плоскость — новый выбор
        }
      } else {
        ppParts = [facePatchCached(f.faceIndex)]; // кэш знает размеры (rectDims)
      }
      ppPatch = compositeParts();
      showPatch(ppPatch, C_SEL);
      showFacePalette();
    } else if(!exLive){ // пустой клик при открытом окне ничего не трогает
      deselect(); clearEdgeSel(); hideChordHint();
      hidePatch(); ppPatch = null;
    }
  }
  if(dragPt){
    normalsFlush();
    // после изгиба запоминаем новые позиции цепочки для следующего раза
    if(dragPt.bendRun && dragPt.a && dragPt.a.bend)
      dragPt.a.bend.pts0 = dragPt.bendRun.cur.map(p=>p.clone());
    // отпустили не сдвинув — это был клик: выбираем точку зелёным (FreeCAD)
    const clickedAnchor = dragPt.a && !dragPt.snapPushed
      && dragPt.start.distanceTo(dragPt.a.pos) < 0.05 ? dragPt.a : null;
    setAxisLock(null);
    snapDot.visible = false;
    dragPt=null; tipHide(); extractEdges();
    if(clickedAnchor) selectAnchor(clickedAnchor);
  }
  drag=null;
});
const raycaster = new THREE.Raycaster();
// Окно тащат за ⠿ — курсор занят окном, а не моделью: захват указателя
// на ручке, чтобы движение не доходило до сцены, и снятая подсветка
let winDragging = false;
window.addEventListener('pointerdown', ev=>{
  if(!ev.target.classList || !ev.target.classList.contains('chgrip')) return;
  winDragging = true;
  try{ ev.target.setPointerCapture(ev.pointerId); }catch(_){}
  setHover(null); hideHoverPatch(); hideHints();
  if(typeof vGhost !== 'undefined') vGhost.visible = false;
  document.body.classList.add('winDrag');
}, true);
for(const type of ['pointerup', 'pointercancel'])
  window.addEventListener(type, ()=>{ winDragging = false; document.body.classList.remove('winDrag'); }, true);
canvas.addEventListener('pointermove', e=>{
  if(winDragging) return;
  const q = quadPos(e);
  lastMX = e.clientX; lastMY = e.clientY;
  hideHints(); // кандидаты пересчитываются каждым движением
  hideHoverPatch(); // жёлтая подсветка наведения ставится заново ниже
  if(!toolTag.hidden){ // бейдж инструмента следует за курсором
    const vr = view.getBoundingClientRect();
    toolTag.style.left = (e.clientX - vr.left + 14)+'px';
    toolTag.style.top  = (e.clientY - vr.top - 20)+'px';
  }
  if(pendingVertex){
    if(Math.hypot(e.clientX-pendingVertex.x, e.clientY-pendingVertex.y) > 4){
      // потащили с вершины — это камера, геометрию двигают инструменты
      const pv = pendingVertex; pendingVertex = null;
      vGhost.visible = false; tipHide();
      if(!drag) drag = {x: pv.x, y: pv.y, b: 0};
    }
  }
  if(pendingEdge && !edgeDrag){
    if(Math.hypot(e.clientX-pendingEdge.x, e.clientY-pendingEdge.y) > 4){
      // прямое перетаскивание ребра отключено: потащили — значит крутим
      // камеру; двигать геометрию — только через инструменты
      const pe = pendingEdge; pendingEdge = null;
      setHover(null); tipHide();
      if(!drag) drag = {x: pe.x, y: pe.y, b: 0}; // орбита с точки нажатия
    }
  }
  if(edgeDrag){
    const rc = canvas.getBoundingClientRect();
    const q0 = edgeDrag.q0;
    const lx=(e.clientX-rc.left)-q0.ox, ly=(e.clientY-rc.top)-q0.oy;
    raycaster.setFromCamera({x:lx/q0.w*2-1, y:-(ly/q0.h*2-1)}, q0.cam);
    const hit = new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(edgeDrag.plane, hit)) return;
    let d = new THREE.Vector3(snapMM(hit.x-edgeDrag.grab0.x),
      snapMM(hit.y-edgeDrag.grab0.y), snapMM(hit.z-edgeDrag.grab0.z));
    if(edgeDrag.typed) return; // введено число — мышь больше не двигает
    // Shift — пока зажат, строго перпендикулярно грани (как N, но без фиксации)
    edgeDrag.nLock = !!edgeDrag.normal && (edgeDrag.nKey || e.shiftKey);
    if(edgeDrag.nLock){
      // по нормали: ближайшая к лучу мыши точка на прямой нормали через ребро
      // (проекция на плоскость экрана глохла, когда нормаль смотрит на камеру)
      const N = edgeDrag.normal, O = edgeDrag.grab0, r = raycaster.ray;
      const w0 = new THREE.Vector3().subVectors(O, r.origin);
      const b = N.dot(r.direction), dd = N.dot(w0), ee = r.direction.dot(w0);
      const den = 1 - b*b;
      const s = den > 1e-6 ? snapMM((b*ee - dd) / den) : snapMM(new THREE.Vector3().subVectors(hit, O).dot(N));
      d = N.clone().multiplyScalar(s);
      if(s !== 0) edgeDrag.mouseSign = Math.sign(s);
    } else if(axisLock){ // X/Y/Z — движение только вдоль выбранной оси (Blender)
      if(axisLock !== 'x') d.x = 0;
      if(axisLock !== 'y') d.y = 0;
      if(axisLock !== 'z') d.z = 0;
    } else if(e.shiftKey){
      // Shift без грани под ребром — прилипание к доминирующей оси (SketchUp)
      const ax = Math.abs(d.x) >= Math.abs(d.y) && Math.abs(d.x) >= Math.abs(d.z) ? 'x'
               : Math.abs(d.y) >= Math.abs(d.z) ? 'y' : 'z';
      if(ax !== 'x') d.x = 0;
      if(ax !== 'y') d.y = 0;
      if(ax !== 'z') d.z = 0;
    }
    const sn = edgeMoveSnap(d);
    edgeDrag.snapped = sn;
    if(sn){
      d = sn.d;
      snapDot.material.color.setHex(0x52c752);
      snapDot.position.copy(sn.target); snapDot.visible = true;
    } else snapDot.visible = false;
    applyEdgeDelta(d, e);
    return;
  }
  if(txPlaceDrag){ // 3D-текст: точка старта едет за курсором по грани
    const rc = canvas.getBoundingClientRect();
    const q0 = txPlaceDrag.q0;
    const lx=(e.clientX-rc.left)-q0.ox, ly=(e.clientY-rc.top)-q0.oy;
    raycaster.setFromCamera({x:lx/q0.w*2-1, y:-(ly/q0.h*2-1)}, q0.cam);
    const hit = new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(txPlaceDrag.plane, hit)) return;
    const P = new THREE.Vector3(snapMM(hit.x), snapMM(hit.y), snapMM(hit.z));
    P.addScaledVector(txPlaceDrag.n, -new THREE.Vector3().subVectors(P, hit).dot(txPlaceDrag.n));
    // магнит к центру грани: ось текста вспыхивает салатовым
    const sn = txtLive && txtLive.C
      ? txCenterSnap(P, txPlaceDrag.n, txtLive.C, textParams) : {sU:false, sV:false};
    if(txtLive && P.distanceTo(txtLive.P) > 0.05){
      txtLive.P.copy(P);
      if(txAnchor) txAnchor.position.copy(P);
      txSnapTip(e, sn);
      txPlaceDrag.dirty = true;
      // контур/выдавливание перестраиваем на лету; гравировка (BSP,
      // сотни мс) — только при отпускании кнопки
      const now = performance.now();
      if(textParams.d >= 0 && now - txPlaceDrag.lastT > 120){
        txPlaceDrag.lastT = now;
        txPlaceDrag.dirty = false;
        undo(true);
        placeTextAt(txLeftFromAnchor(P, txtLive.n, textParams), txtLive.n);
      }
    }
    return;
  }
  if(exFaceDrag){ // окно Extrude: лоскут едет за мышью, цифры — за ним
    const rc = canvas.getBoundingClientRect();
    const q0 = exFaceDrag.q0;
    const lx=(e.clientX-rc.left)-q0.ox, ly=(e.clientY-rc.top)-q0.oy;
    raycaster.setFromCamera({x:lx/q0.w*2-1, y:-(ly/q0.h*2-1)}, q0.cam);
    const t = rayLineParam(raycaster.ray, exFaceDrag.base, exFaceDrag.n);
    const v = snapMM(exFaceDrag.v0 + t - exFaceDrag.t0);
    ex_val.value = v.toFixed(1);
    if(exLive && exLive.through && v !== exLive.applied) setExThrough(false);
    applyExtrudeLive(v);
    return;
  }
  if(dragPt){
    // драг привязан к окну, где начался (курсор может выходить за его границы)
    const rc = canvas.getBoundingClientRect();
    const q0 = dragPt.q0;
    const lx = (e.clientX-rc.left) - q0.ox, ly = (e.clientY-rc.top) - q0.oy;
    raycaster.setFromCamera({x: lx/q0.w*2-1, y: -(ly/q0.h*2-1)}, q0.cam);
    const hit = new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(dragPt.plane, hit)) return;
    hit.set(snapMM(hit.x), snapMM(hit.y), snapMM(hit.z)); // привязка 0.1 мм
    if(axisLock){ // движение только вдоль зафиксированной оси
      const st = dragPt.start;
      hit.set(axisLock==='x' ? hit.x : st.x,
              axisLock==='y' ? hit.y : st.y,
              axisLock==='z' ? hit.z : st.z);
    }
    // кольцевая симметрия: тянем все повторяющиеся вершины
    if(dragPt.ringRun){
      const rr = dragPt.ringRun;
      const st = dragPt.start;
      const posR = mesh.geometry.attributes.position.array;
      // по умолчанию — движение в плоскости кольца (только радиус);
      // высота меняется только при зафиксированной оси Z (клавиша Z)
      let dr = 0, dz = 0;
      if(axisLock === 'z'){
        dz = hit.z - st.z;
      } else {
        const ru = Math.hypot(st.x, st.y) || 1;
        dr = ((hit.x - st.x)*st.x + (hit.y - st.y)*st.y) / ru;
      }
      const nR = snapMM(Math.max(0.2, rr.r0 + dr));
      const dzs = snapMM(dz);
      if(!dragPt.snapPushed){ // история для Ctrl+Z
        pushHistory(dragPt.snap);
        dragPt.snapPushed = true;
      }
      for(const it of rr.items){
        const nx = Math.cos(it.ang)*nR, ny = Math.sin(it.ang)*nR;
        const zi = it.z0 + dzs; // каждая вершина на своей высоте
        for(const i of it.idx){ posR[i]=nx; posR[i+1]=ny; posR[i+2]=zi; }
      }
      const nz = rr.z0 + dzs;
      mesh.geometry.attributes.position.needsUpdate = true;
      normalsThrottled();
      if(sel){
        const sa = Math.atan2(st.y, st.x);
        sel.pos.set(Math.cos(sa)*nR, Math.sin(sa)*nR, nz);
        selMarker.position.copy(sel.pos);
        updateVPanel();
      }
      tipAt(e, 'ring ×'+rr.items.length+' vertices<br>R '+nR.toFixed(1)+' mm · Z '+nz.toFixed(1)+' mm'
               +(axisLock==='z' ? ' · axis Z' : ' · (Z — height)'));
      if(!modified){ modified=true; s_mod.textContent='yes'; }
      return;
    }
    // магнит к чужим вершинам и рёбрам (inference при Move, как в SketchUp)
    let snapLabel = null;
    snapDot.visible = false;
    if(!dragPt.bendRun){
      const qd = {mx:lx, my:ly, w:q0.w, h:q0.h, cam:q0.cam};
      const tc = pickCorner(qd, dragPt.start);
      const te = tc ? null : pickEdge(qd, dragPt.start);
      if(tc || te){
        const tp = tc ? tc.pos.clone() : chainPointAt(te.chain, te.s);
        snapDot.material.color.setHex(tc ? 0x52c752 : 0xd9534f);
        snapDot.position.copy(tp);
        snapDot.visible = true;
        snapLabel = tc ? '→ vertex' : '→ on edge';
        if(axisLock){ // цель проецируется на зафиксированную ось
          hit[axisLock] = tp[axisLock];
          snapLabel += ' (axis '+axisLock.toUpperCase()+')';
        } else {
          hit.copy(tp); // прилипаем точно, без округления
        }
      }
    }
    if(!dragPt.snapPushed){ // первый сдвиг — пишем историю для Ctrl+Z
      pushHistory(dragPt.snap);
      dragPt.snapPushed = true;
    }
    const pos = mesh.geometry.attributes.position.array;
    if(dragPt.bendRun){
      // гнём цепочку дугой через её концы и ручку (bulge как в SketchUp)
      const br = dragPt.bendRun;
      const f = arcSampler(br.A, br.B, hit);
      for(let i=1;i<br.cur.length-1;i++){
        const np = f(br.t[i]);
        for(const bi of br.idx[i]){ pos[bi]=np.x; pos[bi+1]=np.y; pos[bi+2]=np.z; }
        br.cur[i].copy(np);
      }
      const hp = br.cur[br.j];
      for(const m of dragPt.markers) m.position.copy(hp);
      if(dragPt.a) dragPt.a.pos.copy(hp);
      tipAt(e, f.R ? 'Arc R <b>'+f.R.toFixed(1)+'</b> mm' : 'straight');
      mesh.geometry.attributes.position.needsUpdate = true;
      normalsThrottled();
      if(!modified){ modified=true; s_mod.textContent='yes'; }
      return;
    } else {
      for(const i of dragPt.idx){ pos[i]=hit.x; pos[i+1]=hit.y; pos[i+2]=hit.z; }
      for(const m of dragPt.markers) m.position.copy(hit);
      if(dragPt.a) dragPt.a.pos.copy(hit);
      if(dragPt.isSel && sel){ sel.pos.copy(hit); updateVPanel(); }
      const st = dragPt.start,
            fmt = (v,d)=>v.toFixed(1)+' <span class="d">Δ'+(d>=0?'+':'')+d.toFixed(1)+'</span>';
      tipAt(e, (axisLock ? 'axis '+axisLock.toUpperCase()+'<br>' : '')
               +(snapLabel ? snapLabel+'<br>' : '')
               +'X '+fmt(hit.x,hit.x-st.x)+'<br>Y '+fmt(hit.y,hit.y-st.y)+'<br>Z '+fmt(hit.z,hit.z-st.z));
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    normalsThrottled();
    if(!modified){ modified=true; s_mod.textContent='yes'; }
    return;
  }
  if(drag){
    const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
    if(drag.b===2){
      const dir = new THREE.Vector3().subVectors(camTarget, persp.position).normalize();
      const right = new THREE.Vector3().crossVectors(dir, persp.up).normalize();
      const upv = new THREE.Vector3().crossVectors(right, dir);
      camTarget.addScaledVector(right, -dx*camDist*0.0015);
      camTarget.addScaledVector(upv, dy*camDist*0.0015);
    } else {
      yaw -= dx*0.01;
      pitch = Math.max(-1.5, Math.min(1.5, pitch + dy*0.01));
    }
    return;
  }
  if(divCtx) return;                // окно деления: только камера, наведение молчит
  if(placing) return;               // пока открыта всплывашка — наведение заморожено
  if(pointMode){ // призрак точки с привязками
    if(!q.inside){ ghost.visible=false; tipHide(); return; }
    const pt = linePickPoint(q) || pickGround(q); // пусто под курсором — земля XY
    if(pt){
      ghost.material.color.setHex(pt.kind==='vertex' || pt.kind==='center' || pt.kind==='quadrant' ? C_VERT : C_EDGE);
      ghost.position.copy(pt.pos); ghost.visible = true;
      showHintFor(pt);
      let msg = 'Point · ' + kindLabel(pt.kind);
      if(pt.kind === 'quadrant') // на какой оси через центр круга
        msg += ' <span style="color:' + AXIS_CSS[pt.axis] + ';font-weight:700">'
          + (pt.sign > 0 ? '+' : '−') + pt.axis.toUpperCase() + '</span>';
      // координаты будущей точки — каждая ось своей строкой, в цвете оси
      // (X кр., Y зел., Z син.), тем же кеглем, что и заголовок
      for(const ax of ['x', 'y', 'z'])
        msg += '<br><span style="color:'+AXIS_CSS[ax]+'"><b>'+ax.toUpperCase()+'</b> '+pt.pos[ax].toFixed(1)+'</span>';
      if(pt.chain && pt.s !== undefined){ // расстояния до концов ребра (AutoCAD)
        msg += '<br>◀ ' + pt.s.toFixed(1) + ' mm · '
             + (pt.chain.total - pt.s).toFixed(1) + ' mm ▶';
      }
      tipAt(e, msg);
    } else { ghost.visible = false; tipHide(); }
    return;
  }
  if(offLive){ offMove(e, q); return; }
  if(activeTool){ activeTool.move(e, q); return; }
  if(circleMode){ // превью окружности за курсором
    if(!q.inside){ ghost.visible=false; killRing(); tipHide(); return; }
    if(!circleCenter){
      const pt = pickOnFace(q); // грань, а если под курсором её нет — земля XY
      if(pt && pt.faceIndex !== undefined) showPlaneTargets(pt.n, pt.pos, facePatchCached(pt.faceIndex));
      else if(pt) showPlaneTargets(GROUND_N, new THREE.Vector3(), null);
      else hidePlaneTargets();
      if(pt){
        ghost.material.color.setHex(pt.kind==='vertex' || pt.kind==='center' || pt.kind==='origin' ? C_VERT : C_EDGE);
        ghost.position.copy(pt.pos); ghost.visible = true;
        if(pt.pt) showHintFor(pt.pt);
        tipHide(); // привязка центра — в окне круга, тултип у курсора не нужен
        updateCircInfo(circSnapHtml('Center', pt.kind));
        if(circFixedR) drawCircleRing(pt.pos, pt.n, circFixedR);
        else killRing();
      } else {
        ghost.visible = false; tipHide(); killRing();
        updateCircInfo('<span style="color:var(--muted)">Center → move over the model</span>');
      }
      return;
    }
    tipHide(); // размеры — в окне круга, второй тултип не нужен
    showPlaneTargets(circlePlane, circleCenter, circPatch);
    // Магниты радиуса: вершина, середина ребра, центр, точка на ребре и
    // перпендикуляр к ребру (круг, вписанный в квадрат, касается сторон)
    let snapKind = '';
    const pt = circRLock ? null : linePickPoint(q);
    const inPlane = P => Math.abs(new THREE.Vector3().subVectors(P, circleCenter).dot(circlePlane)) < 0.05;
    if(circRLock){
      ghost.visible = false; // размер введён в окне — мышь его не меняет
    } else if(pt && pt.kind !== 'on face' && inPlane(pt.pos)){
      let P = pt.pos, kind = kindLabel(pt.kind);
      if(pt.kind === 'on edge' && pt.chain){
        // основание перпендикуляра из центра на отрезок ребра под курсором
        const ch = pt.chain;
        let best = null;
        for(let i=0;i+1<ch.pts.length;i++){
          const A = ch.pts[i], B = ch.pts[i+1];
          const AB = new THREE.Vector3().subVectors(B, A), L2 = AB.lengthSq();
          if(L2 < 1e-12) continue;
          const t = new THREE.Vector3().subVectors(circleCenter, A).dot(AB) / L2;
          if(t < 0 || t > 1) continue;
          const F = A.clone().addScaledVector(AB, t);
          if(!best || F.distanceTo(P) < best.distanceTo(P)) best = F;
        }
        if(best){
          const sc = projToQuad(best, q.cam, q.w, q.h, {x:0,y:0,z:0});
          if(Math.hypot(sc.x - q.mx, sc.y - q.my) < 14){ P = best; kind = 'perpendicular'; }
        }
      }
      circleR = Math.max(0.1, new THREE.Vector3().subVectors(P, circleCenter)
        .addScaledVector(circlePlane, -new THREE.Vector3().subVectors(P, circleCenter).dot(circlePlane)).length());
      ghost.material.color.setHex(pt.kind==='vertex' || pt.kind==='center' || kind==='perpendicular' ? C_VERT : C_EDGE);
      ghost.position.copy(P); ghost.visible = true;
      snapKind = circSnapHtml('Radius', pt.kind === 'on edge' && kind !== 'perpendicular' ? 'on edge' : (kind === 'perpendicular' ? kind : pt.kind));
    } else {
      ghost.visible = false;
      snapKind = circRLock ? '' : circSnapHtml('Radius', 'free · 0.1 mm step');
      // свободно — по плоскости круга (за краем грани тоже: черчение в воздухе)
      const p = rayOnPlane(q, circlePlane, circleCenter);
      if(p) circleR = Math.max(0.1, snapMM(p.distanceTo(circleCenter)));
    }
    if(circAuto) circ_seg.value = autoCircSegs(circleR);
    updateCircInfo(snapKind, drawCircleRing(circleCenter, circlePlane, circleR));
    return;
  }
  if(lineMode){ // резинка и привязки в режиме «Линия»
    if(!q.inside){ ghost.visible=false; killRubber(); tipHide(); return; }
    const pt = linePickPoint(q) || pickGround(q); // пусто под курсором — земля XY
    if(pt){
      let pos = pt.pos, note = kindLabel(pt.kind), axSnap = null, perpSnap = null;
      if(lineStart && e.shiftKey){ // Shift: строго 90° вдоль ближайшей оси (Draft)
        const o = shiftOrtho(lineStart, pos);
        pos = o.p;
        note += ' · 90° axis ' + o.ax.toUpperCase();
      } else if(lineStart && (pt.kind==='on face' || pt.kind==='on edge' || pt.kind==='on ground')){
        axSnap = axisInfer(lineStart, pos); // сильные магниты (вершина/центр) важнее оси
        if(axSnap){ pos = axSnap.p; note = 'on axis ' + axSnap.ax.toUpperCase(); }
        else {
          const f = raycastFace(q);
          perpSnap = perpInfer(lineStart, pos, f ? triNormalAt(f.faceIndex) : null);
          if(perpSnap){
            pos = perpSnap.p;
            note = perpSnap.kind === 'angle'
              ? perpSnap.deg + '° to edge' : perpSnap.kind + ' to edge';
          }
        }
      }
      lineRawPt = pos.clone();
      { const lk = lineLockedEnd(pos); if(lk){ pos = lk.pos; note += lk.note; } }
      lastLinePt = pos.clone();
      ghost.material.color.setHex(pt.kind==='vertex' ? C_VERT : C_EDGE);
      ghost.position.copy(pos); ghost.visible = true;
      showHintFor(pt);
      let msg = 'Line · ' + note;
      if(lineStart){
        killRubber();
        const rg = new THREE.BufferGeometry().setFromPoints([lineStart, pos]);
        let rubMat;
        if(axSnap) rubMat = new THREE.LineBasicMaterial({color:AXIS_COLORS[axSnap.ax]});
        else if(perpSnap && perpSnap.kind !== 'parallel')
          // пойманный угол: пунктир своего цвета (90 кр., 60 ж., 45 гол., 30 сал.)
          rubMat = new THREE.LineDashedMaterial(
            {color: ANGLE_COLORS[perpSnap.deg] || 0xe040e0, dashSize:1.4, gapSize:1.0});
        else if(perpSnap) rubMat = new THREE.LineBasicMaterial({color:0xe040e0}); // параллель
        else rubMat = new THREE.LineBasicMaterial({color:0x9aa2b1});
        rubber = new THREE.Line(rg, rubMat);
        if(rubMat.isLineDashedMaterial) rubber.computeLineDistances();
        scene.add(rubber);
        if(perpSnap && perpSnap.kind === 'perpendicular' && lineHostDir){
          const L = lineStart.distanceTo(pos);
          if(L > 0.3)
            showAngleMark(lineStart, lineHostDir,
              new THREE.Vector3().subVectors(pos, lineStart).normalize(), L);
        }
        msg += '<br>L '+lineStart.distanceTo(pos).toFixed(1)+' mm';
        if(lineHostDir){ // живой угол к ребру-хозяину (как в Sketcher)
          const d = new THREE.Vector3().subVectors(pos, lineStart);
          const len = d.length();
          if(len > 0.1){
            const deg = Math.round(Math.acos(Math.min(1, Math.abs(d.dot(lineHostDir))/len))*180/Math.PI);
            // точный угол из таблицы красится всегда — даже если привязку
            // перехватили ось или магнит ребра (например, ∠ 0° вдоль хозяина)
            const degCss = perpSnap ? (ANGLE_CSS[perpSnap.deg] || '#e040e0')
                                    : (ANGLE_CSS[deg] || null);
            msg += degCss
              ? ' · <span style="color:'+degCss+';font-weight:700">∠ '+deg+'°</span>'
              : ' · ∠ '+deg+'°';
          }
        }
        // финиш ляжет на ребро/линию — расстояния до его концов (как у точки);
        // при активной угловой/осевой привязке конец уже не на ребре — молчим
        let distHtml = '';
        if(pt.chain && pt.s !== undefined && !axSnap && !perpSnap && !e.shiftKey){
          distHtml = '◀ ' + pt.s.toFixed(1) + ' mm · ' + (pt.chain.total - pt.s).toFixed(1) + ' mm ▶';
          msg += '<br>' + distHtml;
        }
        if(lineLenStr) msg += '<br>typed: '+lineLenStr+' mm (Enter)';
        lineSnapHtml = note + (distHtml ? '<br>' + distHtml : '');
        if(e.altKey && lineChain){ // Alt зажат: клик начнёт новую линию — резинку прячем
          killRubber();
          lineSnapHtml = '<span style="color:#fff;font-weight:700">new start</span> · ' + kindLabel(pt.kind);
        }
      } else {
        // начало линии: во что попал курсор (вершина, середина, центр,
        // квадрант с осью) — второй строкой окна, как у конца
        let s = note;
        if(pt.kind === 'quadrant')
          s += ' <span style="color:' + AXIS_CSS[pt.axis] + ';font-weight:700">'
            + (pt.sign > 0 ? '+' : '−') + pt.axis.toUpperCase() + '</span>';
        if(pt.chain && pt.s !== undefined)
          s += '<br>◀ ' + pt.s.toFixed(1) + ' mm · ' + (pt.chain.total - pt.s).toFixed(1) + ' mm ▶';
        lineSnapHtml = s;
      }
      // окно Line открыто — привязка, длина и угол там; тултип у курсора прятался бы под окном
      updateLineInfo();
      if(linePopup.hidden) tipAt(e, msg); else tipHide();
    } else { ghost.visible=false; killRubber(); tipHide(); lineSnapHtml = ''; updateLineInfo(); }
    return;
  }
  if(textMode){ // 3D-текст: без жёлтых подсветок, но ориентиры и магниты — как у круга
    setHover(null); vGhost.visible = false; cornerHover = null;
    hidePatch(); ppPatch = null;
    if(!txtLive && !txPlaceDrag){ // пока текст не поставлен: вершины, середины, центры
      const pk = q.inside ? pickOnFace(q) : null;
      if(pk && pk.faceIndex !== undefined){
        showPlaneTargets(pk.n, pk.pos, facePatchCached(pk.faceIndex));
        const strong = pk.kind !== 'on face';
        ghost.material.color.setHex(pk.kind==='vertex' || pk.kind==='center' || pk.kind==='origin' ? C_VERT : C_EDGE);
        ghost.position.copy(pk.pos); ghost.visible = strong;
        if(strong) tipAt(e, 'Text anchor → ' + kindLabel(pk.kind)); else tipHide();
      } else { hidePlaneTargets(); ghost.visible = false; tipHide(); }
    }
    return;
  }
  // приоритет привязок как в SketchUp: вершина > середина > ребро
  // поставленная точка подсвечивается раньше вершин и всего остального
  // при наведении — только подсветка, без тултипов (данные покажет выбор)
  const anh = q.inside ? anchorAt(q) : null;
  if(anh){
    setHover(null); cornerHover = null;
    if(!ppPatch) hidePatch();
    vGhost.position.copy(anh.pos); vGhost.visible = true;
    tipHide();
    return;
  }
  const c = q.inside ? pickCorner(q) : null;
  if(c){
    setHover(null);
    if(!ppPatch) hidePatch();
    cornerHover = c;
    vGhost.position.copy(c.pos); vGhost.visible = true;
    tipHide();
    return;
  }
  cornerHover = null; vGhost.visible = false;
  const h = q.inside ? pickEdge(q) : null;
  if(h){
    // preselect как во FreeCAD: ребро жёлтое, точку не предлагаем
    setHover(h);
    ghost.visible = false;
    if(!ppPatch) hidePatch();
    tipHide();
    return;
  }
  setHover(null);
  // наведение на грань — жёлтая заливка. Работает и когда грань уже
  // выбрана: иначе Ctrl+клик по соседним граням шёл бы вслепую
  if(q.inside){
    const f = raycastFace(q);
    if(f){
      if(!(ppPatch && ppPatch.set.has(f.faceIndex))) // выбранную не перекрашиваем
        showHoverPatch(facePatchCached(f.faceIndex));
      tipHide();
      return;
    }
    if(!ppPatch) hidePatch();
  }
  tipHide();
});
// двойной клик: по вершине — кольцо одинаковых вершин (loop как в Max/Maya),
// по грани — выбрать плоскую область (границы: рёбра модели + линии)
canvas.addEventListener('dblclick', e=>{
  const q = quadPos(e);
  // пока работает инструмент, двойной клик ничего не выбирает: в SketchUp
  // и FreeCAD активный инструмент забирает клики себе целиком
  if(!q.inside || lineMode || placing
     || textMode || pointMode || circleMode || exLive || divCtx || activeTool) return;
  const c = pickCorner(q);
  if(c){
    selectVertex(c.pos);
    sel.ring = true;
    clearRingMarkers();
    for(const cc of ringCornersAt(c.pos)){
      const m = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({color:C_SEL})));
      m.position.copy(cc.pos);
      scene.add(m);
      ringMarkers.push(m);
    }
    return;
  }
  const hf = raycastFace(q);
  if(hf){
    clearEdgeSel(); deselect();
    ppPatch = facePatchCached(hf.faceIndex);
    ppParts = [ppPatch]; // мультивыбор стартует с этой области
    showPatch(ppPatch, C_SEL); // выбранная грань — зелёная
    showFacePalette();         // список доступных операций (P / E / Esc)
  }
});
canvas.addEventListener('contextmenu', e=>e.preventDefault());
canvas.addEventListener('wheel', e=>{
  const q = quadPos(e);
  if(!q.inside) return;
  e.preventDefault();
  const k = 1+Math.sign(e.deltaY)*0.1;
  if(q.is3D){
    camDist = Math.max(20, Math.min(1200, camDist*k));
  } else { // зум орто-видов (общий для трёх)
    orthoFit = Math.max(5, Math.min(400, orthoFit*k));
    updateOrthoFrusta();
  }
}, {passive:false});

// ---------- рендер 4 окон ----------
function resize(){
  renderer.setSize(view.clientWidth, view.clientHeight);
  updateOrthoFrusta();
  if(window.__vcReady) placeVcNav();
}
window.addEventListener('resize', resize);

function renderViewport(cam, x, y, w, h, grids){
  for(const g of ALL_GRIDS) g.visible = grids.includes(g);
  renderer.setViewport(x,y,w,h);
  renderer.setScissor(x,y,w,h);
  renderer.render(scene, cam);
}

let last=performance.now(), frames=0, fpsT=0;
function loop(t){
  const w=view.clientWidth, h=view.clientHeight, hw=w/2, hh=h/2;
  if(viewAnim){ // перелёт к виду, выбранному на ViewCube
    const k = Math.min(1, (performance.now()-viewAnim.t0)/250);
    const ease = k*(2-k);
    let dy = viewAnim.y1 - viewAnim.y0;
    dy = ((dy+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
    yaw = viewAnim.y0 + dy*ease;
    pitch = viewAnim.p0 + (viewAnim.p1-viewAnim.p0)*ease;
    if(k>=1) viewAnim = null;
  }
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  persp.position.set(
    camTarget.x + camDist*cp*Math.cos(yaw),
    camTarget.y + camDist*cp*Math.sin(yaw),
    camTarget.z + camDist*sp);
  persp.lookAt(camTarget);

  if(window.__vcReady) updateVcArrows();
  // маркеры-точки: постоянный экранный размер ~7px, масштаб от реального
  // расстояния до камеры (не «раздуваются» при приближении)
  const dot = (m, k) => { if(m.visible !== false) m.scale.setScalar(
    persp.position.distanceTo(m.position) * (k || 0.0045)); };
  dot(ghost); dot(vGhost, 0.005); dot(selMarker); dot(snapDot, 0.005);
  for(const m of ringMarkers) dot(m);
  for(const m of divDots) dot(m);
  for(const a of anchors) dot(a.marker);
  for(const d of hintDots) dot(d, 0.005); // середина ребра, центры грани — заметнее
  // начало координат подсвечено, пока в руке рисующий инструмент
  originMarker.visible = !!(pointMode || lineMode || circleMode || activeTool === rectTool || (textMode && !txtLive));
  dot(originMarker, 0.004);
  for(const m of planeTargets) dot(m, 0.0035);
  if(!lineMode && !linePopup.hidden && !lineLastValid()) closeLinePopup();
  if(linePrev && (lineStart || !lineLastValid())) killLinePreview();
  if(linePrev) dot(linePrev.dot);
  // точки привязки (вершины, центры, квадранты) — у всех инструментов,
  // ставящих точки с магнитом (и пока правится длина поставленной линии)
  syncSnapMarkers((pointMode || lineMode || activeTool === rectTool || activeTool === tapeTool || !!linePrev || !!edgeDrag) && !divCtx);
  for(const m of snapMarkers) dot(m, 0.004);
  if(activeTool && activeTool.dots) for(const m of activeTool.dots) dot(m);
  if(txAnchor) dot(txAnchor, 0.0035);       // якорь текста (красный центр)
  if(txCenterDot) dot(txCenterDot, 0.0035); // центр грани (салатовый)
  dot(selEndA); dot(selEndB);
  for(const m of selCenterDots) dot(m, 0.0035);
  // билборды масштабируются от реального расстояния до камеры —
  // постоянный экранный размер при любом зуме
  for(const sp of axisLabels){
    const d = persp.position.distanceTo(sp.position);
    sp.scale.setScalar(d*0.05);
  }
  {
    const d = persp.position.length(); // надпись версии в начале координат
    buildSprite.scale.set(d*0.19, d*0.036, 1);
  }

  if(quadChk.checked){
    persp.aspect = hw/hh; persp.updateProjectionMatrix();
    renderViewport(persp,  0,  hh, hw, hh, VIEW_GRIDS.persp); // 3D — слева сверху
    renderViewport(orthoX, hw, hh, hw, hh, VIEW_GRIDS.ox);    // +X — справа сверху
    renderViewport(orthoY, 0,  0,  hw, hh, VIEW_GRIDS.oy);    // +Y — слева снизу
    renderViewport(orthoZ, hw, 0,  hw, hh, VIEW_GRIDS.oz);    // +Z — справа снизу
  } else {
    persp.aspect = w/h; persp.updateProjectionMatrix();
    renderViewport(persp, 0, 0, w, h, VIEW_GRIDS.persp);      // одно 3D на всё
  }
  { // ViewCube поверх 3D-окна
    const g = gizmoCssRect();
    gizmoPose();
    renderer.setViewport(g.x, g.canvasH - g.y - g.s, g.s, g.s);
    renderer.setScissor(g.x, g.canvasH - g.y - g.s, g.s, g.s);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(gizmoScene, gizmoCam);
    renderer.autoClear = true;
  }

  frames++; fpsT+=t-last; last=t;
  if(fpsT>500){ document.getElementById('fps').textContent=(1000*frames/fpsT).toFixed(0)+' fps'; frames=0; fpsT=0; }
  requestAnimationFrame(loop);
}

// ---------- привязка UI ----------
['dia','thk','sh','n','dep','w'].forEach(id=>{
  document.getElementById(id).addEventListener('input', rebuild);
});
document.querySelectorAll('input[name=engine]').forEach(r=>r.addEventListener('change', rebuild));
if(!HAS_SERVER){ // расширение или файл: csgrs живёт только на сервере
  const csg = document.querySelector('input[name=engine][value=csg]');
  csg.disabled = true;
  csg.parentElement.style.opacity = '.45';
  csg.parentElement.title = 'Needs the ZeroCAD server';
}
// у каждой фигуры своя стартовая конфигурация: куб — заготовка 40 мм,
// колесо — рабочая шестерёнка дозатора
const SHAPE_PRESET = {
  cube:    {dia:40},
  wheel:   {dia:140, thk:11, sh:5, n:4, dep:10, w:4},
  sphere:  {dia:40},
  pyramid: {dia:40}
};
function applyShapePreset(){
  const kind = document.querySelector('input[name=shape]:checked').value;
  for(const id in SHAPE_PRESET[kind]) document.getElementById(id).value = SHAPE_PRESET[kind][id];
}
function applyShapeUI(){
  const kind = document.querySelector('input[name=shape]:checked').value;
  document.getElementById('wheelOnly').hidden = kind !== 'wheel';
  document.getElementById('dia_label').childNodes[0].nodeValue =
    kind === 'wheel' || kind === 'sphere' ? 'Diameter ' : 'Size ';
}
document.querySelectorAll('input[name=shape]').forEach(r=>r.addEventListener('change', ()=>{
  applyShapePreset(); applyShapeUI(); rebuild();
}));
applyShapeUI();
// флаг подсказок: палитра аккордов и обучающий текст; состояние запоминается
const hintsChk = document.getElementById('hintsChk');
try{ hintsChk.checked = localStorage.getItem('zc_hints') !== '0'; }catch(_){}
function applyHints(){
  const on = hintsChk.checked;
  document.querySelectorAll('.hint').forEach(el => el.hidden = !on);
  try{ localStorage.setItem('zc_hints', on ? '1' : '0'); }catch(_){}
}
hintsChk.addEventListener('change', applyHints);
applyHints();
document.getElementById('stl').addEventListener('click', ()=>exportAs('stl'));
document.getElementById('x_3mf').addEventListener('click', ()=>exportAs('3mf'));
document.getElementById('x_obj').addEventListener('click', ()=>exportAs('obj'));
document.getElementById('x_step').addEventListener('click', ()=>exportAs('step'));
document.getElementById('f_save').addEventListener('click', e=>saveProject(e.shiftKey));
document.getElementById('f_open').addEventListener('click', openProject);
document.getElementById('f_import').addEventListener('click', ()=>{ f_stl.value = ''; f_stl.click(); });
f_stl.addEventListener('change', async ()=>{
  const file = f_stl.files && f_stl.files[0];
  if(file) importSTL(await file.arrayBuffer(), file.name);
});
// перетаскивание файла на сцену: .stl — импорт, .zcad — открыть проект
view.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
view.addEventListener('drop', async e=>{
  e.preventDefault();
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(!file) return;
  if(/\.stl$/i.test(file.name)) importSTL(await file.arrayBuffer(), file.name);
  else if(/\.zcad$/i.test(file.name)) loadProjectText(await file.text(), file.name);
  else warnTip('Drop an .stl or .zcad file');
});
f_file.addEventListener('change', async ()=>{
  const file = f_file.files && f_file.files[0];
  if(file) await openFileAny(file, null);
});
// Ctrl+S / Ctrl+Shift+S / Ctrl+O — как во всех редакторах; по e.code, чтобы
// работало и в русской раскладке, и прямо из полей ввода
window.addEventListener('keydown', e=>{
  if(!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if(e.code === 'KeyS'){ e.preventDefault(); e.stopPropagation(); saveProject(e.shiftKey); }
  else if(e.code === 'KeyO'){ e.preventDefault(); e.stopPropagation(); openProject(); }
}, true);
// несохранённые правки в открытом файле: браузер спросит перед закрытием
window.addEventListener('beforeunload', e=>{
  if(projectDirty && projectHandle){ e.preventDefault(); e.returnValue = ''; }
});
document.getElementById('reset').addEventListener('click', ()=>{
  applyShapePreset(); // стартовая конфигурация текущей фигуры
  // тот же стартовый ракурс, что при открытии и у кнопки ⌂ ViewCube, с тем
  // же плавным перелётом (раньше здесь был зашит старый угол yaw -1.1)
  animateView(HOME_YAW, HOME_PITCH);
  rebuild(); // rebuild сам наведёт орбиту на центр модели и выставит дистанцию
});

// кнопки вокруг ViewCube
const vcnav = document.getElementById('vcnav');
function placeVcNav(){
  const g = gizmoCssRect();
  const B = {home:[g.x-24, g.y-2], left:[g.x-24, g.y+g.s/2-10],
             right:[g.x+g.s+4, g.y+g.s/2-10], up:[g.x+g.s/2-10, g.y-24],
             down:[g.x+g.s/2-10, g.y+g.s+4]};
  for(const b of vcnav.children){
    const p = B[b.dataset.act];
    b.style.left = p[0]+'px';
    b.style.top  = p[1]+'px';
  }
}
vcnav.addEventListener('click', e=>{
  const act = e.target.dataset && e.target.dataset.act;
  if(!act) return;
  const Q = Math.PI/4;
  if(act==='home') animateView(HOME_YAW, HOME_PITCH);
  else if(act==='left') animateView(yaw + Q, pitch);
  else if(act==='right') animateView(yaw - Q, pitch);
  else if(act==='up') animateView(yaw, Math.min(1.5, pitch + Q));
  else if(act==='down') animateView(yaw, Math.max(-1.5, pitch - Q));
});
window.__vcReady = true;
placeVcNav();
// стрелки наклона прячутся на пределе (дальше крутить некуда)
const vcUp = vcnav.querySelector('[data-act=up]');
const vcDown = vcnav.querySelector('[data-act=down]');
function updateVcArrows(){
  vcUp.style.visibility = pitch >= 1.5 - 1e-3 ? 'hidden' : '';
  vcDown.style.visibility = pitch <= -1.5 + 1e-3 ? 'hidden' : '';
}

// ---------- стартовый экран (Welcome в SketchUp, заставка Blender) ----------
// Вся страница — одна 3D-сцена: название ZEROCAD объёмными буквами нашим
// пиксельным шрифтом и тем же построителем, что у 3D Text (buildTextSolid),
// ставится над карточками и вписывается в окно с запасом на покачивание.
// Если долго ничего не трогать — пасхалка CAD INVADERS (attract mode, как
// у аркадных автоматов): цифры-захватчики маршируют, Space — играть, Esc — назад
const startScreen = document.getElementById('startScreen');
let startGL = null;
const INVADER_IDLE_MS = 30000;
// объёмный пиксельный меш по клеткам (центр в нуле): крышки светлые,
// стенки цветные — как название
function pixelGeometry(cells, w, hgt, depth, topHex, sideHex){
  const tris = buildTextSolid(new THREE.Vector3(), new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0),
    new THREE.Vector3(0,0,1), cells, 1, depth, 0);
  const pos = [], col = [], top = new THREE.Color(topHex), side = new THREE.Color(sideHex);
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for(const t of tris){
    const nz = A.subVectors(t[1], t[0]).cross(B.subVectors(t[2], t[0])).normalize().z;
    const c = Math.abs(nz) > 0.9 ? top : side;
    for(const q of t){ pos.push(q.x - w/2, q.y - hgt/2, q.z - depth/2); col.push(c.r, c.g, c.b); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
function startTitleScene(){
  const cv = document.getElementById('startCanvas');
  const renderer = new THREE.WebGLRenderer({canvas: cv, antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scn = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 2000);
  scn.add(new THREE.AmbientLight(0xffffff, 0.62));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-0.6, 0.9, 1.2); scn.add(sun);
  const lambert = new THREE.MeshLambertMaterial({vertexColors: true, flatShading: true});
  const edgeMat = new THREE.LineBasicMaterial({color: 0x23262c});
  const textGroup = (str, depth, sideHex) => {
    const cells = textCellsOf(str), w = [...str].length * 6 - 1;
    const geo = pixelGeometry(cells, w, 7, depth, 0xf2f4f7, sideHex);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, lambert));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat));
    g.userData.w = w;
    return g;
  };
  const title = textGroup('ZEROCAD', 1.6, 0xff8a3d);
  scn.add(title);

  // ---- CAD INVADERS ----
  // Игра — пособие по горячим клавишам. Корабль собран из клеток нашего
  // шрифта: L P C R E превращают его в букву инструмента (клетки 5×7
  // морфятся — лишние утапливаются, недостающие выдавливаются), 0 — обратно
  // в ноль, Space — выстрел тем, чем корабль сейчас является. Захватчики —
  // цифры и буквы-команды: цифру берёт любой выстрел, букву — только её
  // инструмент; чужой выстрел отскакивает, и подсказка говорит, что нажать
  const FW = 96, FH = 64;                       // полуширина и полувысота поля, клетки
  const field = new THREE.Group(); field.visible = false; scn.add(field);
  const floorGrid = new THREE.GridHelper(240, 24, 0x3a4150, 0x262b35);
  floorGrid.rotation.x = Math.PI / 2; floorGrid.position.z = -8; field.add(floorGrid);
  const gameTitle = textGroup('CAD INVADERS', 2.2, 0x4da3ff);
  gameTitle.scale.setScalar(1.3); gameTitle.position.set(0, -24, 3);
  field.add(gameTitle);
  const DIGIT_SCALE = 1.6, CELL_W = 5 * DIGIT_SCALE, CELL_H = 7 * DIGIT_SCALE;
  const DIGIT_SIDE = [0, 0x6aff3d, 0x6aff3d, 0x4da3ff, 0x4da3ff, 0xff8a3d, 0xff8a3d, 0xd9534f, 0xd9534f, 0xf5c542];
  // формы корабля = инструменты: буква, оружие, цвет, перезарядка, чему учит
  const WEAPONS = {
    '0': {name: 'Zero',      color: 0x4da3ff, cd: 0.35, tip: 'Zero — the basic shot: takes digits only'},
    L:   {name: 'Line',      color: 0xff8a3d, cd: 0.3,  tip: 'Line — one edge, one target'},
    P:   {name: 'Points',    color: 0xc9a4ff, cd: 0.55, tip: 'Points — three points fan out 5° apart'},
    C:   {name: 'Circle',    color: 0x4da3ff, cd: 1.1,  tip: 'Circle — a closed curve takes everything inside'},
    R:   {name: 'Rectangle', color: 0x6aff3d, cd: 0.9,  tip: 'Rectangle — a wide closed contour'},
    E:   {name: 'Extrude',   color: 0xd9534f, cd: 2.0,  tip: 'Extrude — a flat profile grows into a solid and pierces the column · hold Ctrl — cut'},
    // Ctrl — Cut, как в окне Extrude редактора: форма та же, E, снаряд — отрицательный
    'E-':{name: 'Extrude cut', color: 0xd9534f, cd: 2.0, tip: 'Ctrl+E — Extrude cut: a negative solid takes E− invaders'},
    // аккорды G,… как в Sketcher FreeCAD: G — корабль становится «G» и ждёт
    // вторую клавишу; стреляют только законченные аккорды
    G:   {name: 'Chord',       color: 0x9aa2b1, cd: 0, noFire: true,
          tip: 'Chord — now press A (Polar array), M (Polyline), T (3D Text), V (X/Y/Z) or Y (Point)'},
    GA:  {name: 'Polar array', color: 0x4da3ff, cd: 1.4, tip: 'G,A — Polar array: copies gather around the nose and fan out'},
    GM:  {name: 'Polyline',    color: 0xf5c542, cd: 1.4, tip: 'G,M — Polyline: one chain jumps from target to target'},
    GT:  {name: '3D Text',     color: 0xff8a3d, cd: 2.0, tip: 'G,T — 3D Text: the word is typed letter by letter and sweeps a wide strip'},
    GV:  {name: 'X/Y/Z',       color: 0x6aff3d, cd: 1.6, tip: 'G,V — exact X/Y/Z: the crosshair flies straight to the target, shields or not'},
    GY:  {name: 'Point',       color: 0xc9a4ff, cd: 0.7, tip: 'G,Y — Point with snaps, the same tool as P: it bends toward the nearest target'}
  };
  const TOOL_KEYS = ['L', 'P', 'C', 'R', 'E'];
  const kinds = {};
  for(let d=1; d<=9; d++)
    kinds[d] = {geo: pixelGeometry(textCellsOf(String(d)), 5, 7, 3, 0xf2f4f7, DIGIT_SIDE[d]), pts: d * 10, letter: false};
  // буквы-захватчики наоборот: крышка цвета инструмента, стенки белые
  for(const L of TOOL_KEYS)
    kinds[L] = {geo: pixelGeometry(textCellsOf(L), 5, 7, 3, WEAPONS[L].color, 0xf2f4f7), pts: 50, letter: true};
  // E− — «отрицательная» E: пластина 7×9 с вырезанной насквозь буквой, как
  // карман после Extrude с Ctrl. Берёт её только выдавливание с Ctrl
  {
    const cells = new Set(), e = textCellsOf('E');
    for(let gx=0; gx<7; gx++) for(let gy=0; gy<9; gy++)
      if(!e.has((gx - 1) + ',' + (gy - 1))) cells.add(gx + ',' + gy);
    kinds['E-'] = {geo: pixelGeometry(cells, 7, 9, 3, 0x9aa2b1, 0xd9534f), pts: 70, letter: true,
                  scale: DIGIT_SCALE * 5 / 7}; // пластина шире буквы — ужимаем до той же клетки
  }
  // двухбуквенные захватчики — аккорды GA и GM: берёт только свой аккорд
  const CHORD_SCALE = 1.15;
  const CHORDS = ['GA', 'GM', 'GT', 'GV', 'GY'];
  for(const ch of CHORDS)
    kinds[ch] = {geo: pixelGeometry(textCellsOf(ch), 11, 7, 3, WEAPONS[ch].color, 0xf2f4f7), pts: 80, letter: true,
                 scale: CHORD_SCALE, w: 11 * CHORD_SCALE, h: 7 * CHORD_SCALE};

  // корабль: 35 клеток одним InstancedMesh, у каждой своя «высота» 0…1
  const SHIP_DEPTH = 3;
  const cellGeo = new THREE.BoxGeometry(1, 1, 1);
  {
    const nrm = cellGeo.attributes.normal, cols = [], top = new THREE.Color(0xf2f4f7), side = new THREE.Color(0x4da3ff);
    for(let i=0;i<nrm.count;i++){ const c = Math.abs(nrm.getZ(i)) > 0.9 ? top : side; cols.push(c.r, c.g, c.b); }
    cellGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  }
  // свой материал: общий с обычными мешами three r128 компилирует без
  // инстансинга, и все 35 клеток рисовались одним кубом в центре
  const ship = new THREE.InstancedMesh(cellGeo, lambert.clone(), 35);
  ship.userData.cut = false; // форма E с зажатым Ctrl: клетки вдавлены внутрь
  ship.frustumCulled = false;
  ship.scale.setScalar(DIGIT_SCALE);
  const SHIP_HW = CELL_W / 2, SHIP_HH = CELL_H / 2;
  field.add(ship);
  const cellK = new Float32Array(35);
  let shipForm = '0', shipCells = textCellsOf('0');
  const mtx = new THREE.Matrix4(), q0 = new THREE.Quaternion(), vP = new THREE.Vector3(), vS = new THREE.Vector3();
  function layoutShip(dt){
    const rate = dt / 0.15; // превращение за 0.15 с
    // Ctrl в форме E — клетки уходят «в минус»: растут от передней
    // плоскости назад, как карман при Extrude с Ctrl
    const sign = shipForm === 'E' && G.ctrl ? -1 : 1;
    for(let gy=0; gy<7; gy++) for(let gx=0; gx<5; gx++){
      const n = gy * 5 + gx, want = shipCells.has(gx + ',' + gy) ? sign : 0;
      cellK[n] += Math.max(-rate * 2, Math.min(rate * 2, want - cellK[n]));
      const k = cellK[n], a = Math.abs(k);
      const sxy = a < 0.002 ? 0.0001 : 0.35 + 0.65 * a, sz = Math.max(0.0001, a * SHIP_DEPTH);
      // клетка растёт от задней плоскости вперёд — как выдавливание;
      // отрицательная — от передней назад, как вырез
      vP.set(gx + 0.5 - 2.5, gy + 0.5 - 3.5, k >= 0 ? sz / 2 - SHIP_DEPTH / 2 : SHIP_DEPTH / 2 - sz / 2); vS.set(sxy, sxy, sz);
      ship.setMatrixAt(n, mtx.compose(vP, q0, vS));
    }
    ship.instanceMatrix.needsUpdate = true;
  }
  function snapShip(){ for(let n=0;n<35;n++) cellK[n] = shipCells.has((n % 5) + ',' + Math.floor(n / 5)) ? 1 : 0; layoutShip(0); }

  const bombGeo = new THREE.BoxGeometry(1.2, 4, 1.2);
  const bombs = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(bombGeo, new THREE.MeshLambertMaterial({color: 0xf2f4f7}));
    m.visible = false; field.add(m); return m;
  });
  const orange = new THREE.MeshLambertMaterial({color: 0xff8a3d});
  const blue = new THREE.MeshLambertMaterial({color: 0x4da3ff});
  const green = new THREE.MeshLambertMaterial({color: 0x6aff3d});
  const red = new THREE.MeshLambertMaterial({color: 0xd9534f});
  const white = new THREE.MeshLambertMaterial({color: 0xf7f9fc});
  const darkEdge = new THREE.LineBasicMaterial({color: 0x23262c});
  const SHIP_Y = -FH + 6, NOSE_Y = SHIP_Y + SHIP_HH + 1.5;
  const hudTools = document.getElementById('stTools'), hudTip = document.getElementById('stTip');
  const keyLabel = f => f.length === 2 && f[0] === 'G' ? 'G,' + f[1] : f;
  hudTools.innerHTML = ['0', ...TOOL_KEYS, ...CHORDS].map(f => '<span data-f="' + f + '"><b>' + keyLabel(f) + '</b>' + WEAPONS[f].name + '</span>').join('');
  const fx = []; // догорающие следы (ломаная полилинии)
  const shots = [];
  const cool = {};
  let tipT = 0;
  const HI_KEY = 'zc_invaders_hi';
  let hi = 0; try{ hi = +localStorage.getItem(HI_KEY) || 0; }catch(_){}
  const hud = document.getElementById('stHud'), hudScore = document.getElementById('stScore'), hudMsg = document.getElementById('stMsg');
  const G = {mode: 'off', invaders: [], dir: 1, stepT: 0, score: 0, lives: 3, wave: 0,
             keys: {left: false, right: false}, shipX: 0, hitT: 0, lastAct: performance.now(), t: 0,
             demoTarget: null, ctrl: false};
  snapShip(); // после G: раскладка клеток читает G.ctrl
  function clearShots(){
    for(const p of shots) field.remove(p.obj); shots.length = 0;
    for(const f of fx) field.remove(f.obj); fx.length = 0;
  }
  function newWave(){
    for(const inv of G.invaders) field.remove(inv.mesh);
    G.invaders = [];
    // сверху крупные цифры, снизу мелкие; среди них буквы-команды — все
    // сразу (игра учит каждой клавише с первой волны)
    const ROW_DIGITS = [[8, 9], [6, 7], [4, 5], [2, 3], [1, 2]];
    const letters = [...TOOL_KEYS, 'E-', ...CHORDS];
    const drop = Math.min(G.wave, 4) * 4;
    ROW_DIGITS.forEach((pair, r) => {
      for(let c=0;c<11;c++){
        const k = Math.random() < 0.3 ? letters[Math.floor(Math.random() * letters.length)]
          : pair[Math.floor(Math.random() * pair.length)];
        const mesh = new THREE.Mesh(kinds[k].geo, lambert);
        mesh.scale.setScalar(kinds[k].scale || DIGIT_SCALE);
        // своя фаза, скорость и размах покачивания у каждого
        const inv = {k, x: -80 + c * 16, y: 48 - r * 13 - drop, alive: true, mesh, flashT: 0,
                     ph: Math.random() * Math.PI * 2, sp: 0.7 + Math.random() * 1.6,
                     ay: 0.25 + Math.random() * 0.45, ax: 0.1 + Math.random() * 0.3};
        mesh.position.set(inv.x, inv.y, 0);
        field.add(mesh); G.invaders.push(inv);
      }
    });
    // каждой буквы — не меньше двух, каждого аккорда — не меньше одного:
    // случай не должен оставить волну без R, E или G,V
    for(const L of letters){
      let have = G.invaders.filter(i => i.k === L).length;
      const need = CHORDS.includes(L) ? 1 : 2;
      const digits = G.invaders.filter(i => !kinds[i.k].letter);
      while(have < need && digits.length){
        const i = digits.splice(Math.floor(Math.random() * digits.length), 1)[0];
        i.k = L; i.mesh.geometry = kinds[L].geo; i.mesh.scale.setScalar(kinds[L].scale || DIGIT_SCALE);
        have++;
      }
    }
    G.dir = 1; G.stepT = 0; G.demoTarget = null; G.edges = 0;
    clearShots(); for(const bm of bombs) bm.visible = false;
  }
  function resetGame(){
    G.score = 0; G.lives = 3; G.wave = 0; G.shipX = 0; G.hitT = 0;
    for(const id in cool) cool[id] = 0;
    shipForm = '0'; shipCells = textCellsOf('0'); snapShip(); paintTools();
    newWave();
  }
  function saveHi(){ if(G.score > hi){ hi = G.score; try{ localStorage.setItem(HI_KEY, String(hi)); }catch(_){} } }
  function paintHud(){
    const pad = n => String(n).padStart(4, '0');
    hudScore.textContent = G.mode === 'attract' ? 'HI ' + pad(hi)
      : 'SCORE ' + pad(G.score) + '    LIVES ' + '♥'.repeat(Math.max(0, G.lives)) + '    HI ' + pad(Math.max(hi, G.score));
    hudMsg.innerHTML = G.mode === 'attract' ? '<b>Space</b> — play · <b>Esc</b> — back to ZeroCAD'
      : G.mode === 'over' ? 'Game over · <b>Space</b> — again · <b>Esc</b> — back'
      : '<b>L P C R E 0</b> — press: become the tool, release: fire · <b>G</b> then <b>A M T V Y</b> — chords · <b>Ctrl</b> + E — cut · <b>← →</b> — move · <b>Esc</b> — back';
  }
  function paintTools(){ for(const el of hudTools.children) el.classList.toggle('on', el.dataset.f === shipForm); }
  function tip(html){ hudTip.innerHTML = html; hudTip.style.opacity = 1; tipT = 2.2; }
  function setForm(f){
    if(!WEAPONS[f] || f === shipForm) return;
    shipForm = f; shipCells = textCellsOf(f.length === 2 ? f[1] : f); // у аккорда корабль — вторая буква
    if(f === 'G') G.chordT = G.t;
    paintTools();
    tip('<b>' + keyLabel(f) + '</b>' + WEAPONS[f].tip);
  }
  function setMode(m){
    G.mode = m;
    const inGame = m !== 'off';
    startScreen.classList.toggle('game', inGame);
    hud.hidden = !inGame;
    field.visible = inGame; title.visible = !inGame;
    gameTitle.visible = m === 'attract' || m === 'over';
    ship.visible = m !== 'over';
    if(m === 'attract') resetGame();
    if(m === 'play'){ resetGame(); gameTitle.visible = false; }
    if(m === 'off'){ G.lastAct = performance.now(); G.keys.left = G.keys.right = false; clearShots(); }
    G.ctrl = false;
    hudTip.style.opacity = 0; tipT = 0;
    downAt = null;
    paintHud();
  }
  // ---- выстрелы: у каждой формы свой снаряд и своя «анимация построения»
  function edgeBox(w, hgt, d, mat){ // объёмный брусок с тёмными рёбрами, как тело в редакторе
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, hgt, d);
    g.add(new THREE.Mesh(geo, mat));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), darkEdge));
    return g;
  }
  const yellowMat = new THREE.MeshLambertMaterial({color: 0xf5c542});
  // отрезок ломаной между двумя точками — объёмный брусок
  function segmentBox(a, b){
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, len), 0.8, 0.8), yellowMat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    m.rotation.z = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return m;
  }
  const cutMat = new THREE.MeshLambertMaterial({color: 0x2b2f38});
  const cutEdge = new THREE.LineBasicMaterial({color: 0xd9534f});
  function cutBox(w, hgt, d){
    const g = new THREE.Group(), geo = new THREE.BoxGeometry(w, hgt, d);
    g.add(new THREE.Mesh(geo, cutMat));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), cutEdge));
    return g;
  }
  function fire(){
    const f = shipForm;
    if(WEAPONS[f].noFire || (cool[f] || 0) > 0) return false;
    cool[f] = WEAPONS[f].cd;
    const x = G.shipX, tool = f === 'E' && G.ctrl ? 'E-' : f;
    const add = p => { p.tool = tool; p.hits = new Set(); p.age = 0; p.build = p.build || 0; field.add(p.obj); shots.push(p); };
    if(f === '0'){
      add({x, y: NOSE_Y, vx: 0, vy: 130, hw: 0.7, hh: 1.2, obj: edgeBox(1.4, 2.4, 1.4, white)});
    } else if(f === 'L'){
      add({x, y: NOSE_Y, vx: 0, vy: 130, hw: 0.6, hh: 3, obj: edgeBox(0.9, 6, 0.9, orange)});
    } else if(f === 'P'){
      for(const deg of [-5, 0, 5]){
        const a = deg * Math.PI / 180, obj = addOutline(new THREE.Mesh(sphereGeo, white));
        obj.scale.setScalar(1.3);
        add({x, y: NOSE_Y, vx: Math.sin(a) * 115, vy: Math.cos(a) * 115, hw: 1.3, hh: 1.3, obj});
      }
    } else if(f === 'C'){
      add({x, y: NOSE_Y + 7, vx: 0, vy: 80, build: 0.3, r: 7, area: true, obj: new THREE.Group(), arc: -1});
    } else if(f === 'R'){
      const obj = new THREE.Group(), W = 22, Hh = 8, t = 1;
      const sides = [[0, Hh/2, W, t], [W/2, 0, t, Hh], [0, -Hh/2, W, t], [-W/2, 0, t, Hh]];
      for(const [sx, sy, sw, sh] of sides){ const e = edgeBox(sw, sh, t, green); e.position.set(sx, sy, 0); e.visible = false; obj.add(e); }
      add({x, y: NOSE_Y + 5, vx: 0, vy: 95, build: 0.28, hw: W/2, hh: Hh/2, area: true, obj});
    } else if(f === 'E'){
      // обычное — красное тело растёт вперёд; с Ctrl — тёмный «вырез»
      // с красными рёбрами уходит назад, в плоскость поля
      const obj = tool === 'E-' ? cutBox(14, 6, 1) : edgeBox(14, 6, 1, red);
      obj.scale.z = 0.15;
      add({x, y: NOSE_Y + 4, vx: 0, vy: 70, build: 0.4, hw: 7, hh: 3, pierce: true, obj});
    } else if(f === 'GA'){
      // круговой массив: шесть копий по очереди встают на дугу вокруг носа
      // (построение), потом разлетаются веером
      [-25, -15, -5, 5, 15, 25].forEach((deg, k) => {
        const a = deg * Math.PI / 180, obj = edgeBox(1.6, 1.6, 1.6, blue);
        obj.visible = false;
        add({x, y: NOSE_Y, vx: Math.sin(a) * 110, vy: Math.cos(a) * 110, build: 0.3, hw: 0.9, hh: 0.9,
             ang: a, order: k, obj});
      });
    } else if(f === 'GM'){
      // полилиния: одна цепочка, после попадания перескакивает к ближайшей
      // своей цели; следом остаётся ломаная
      const obj = new THREE.Group(), head = edgeBox(1.8, 1.8, 1.8, yellowMat);
      obj.add(head);
      add({x, y: NOSE_Y, vx: 0, vy: 150, hw: 1, hh: 1, jumps: 4, head, last: [x, NOSE_Y], obj});
    } else if(f === 'GT'){
      // 3D-текст: слово набирается буква за буквой у носа и летит широкой
      // полосой — берёт всех своих, кого накрыло; чужая буква — щит
      const obj = new THREE.Group(), S = 0.8, word = 'ZERO';
      [...word].forEach((ch, k) => {
        const m = new THREE.Mesh(pixelGeometry(textCellsOf(ch), 5, 7, 2, 0xf2f4f7, 0xff8a3d), lambert);
        m.scale.setScalar(S); m.position.x = (k * 6 + 2.5 - (word.length * 6 - 1) / 2) * S; m.visible = false;
        obj.add(m);
      });
      add({x, y: NOSE_Y + 5, vx: 0, vy: 75, build: 0.45, hw: (word.length * 6 - 1) * S / 2, hh: 7 * S / 2, wide: true, obj});
    } else if(f === 'GV'){
      // точные X/Y/Z: перекрестие в цветах осей летит прямо в цель — сначала
      // в захватчика G,V, иначе в ближайшую цифру; щиты не мешают
      const pool = G.invaders.filter(i => i.alive && i.k === 'GV');
      const cand = pool.length ? pool : G.invaders.filter(i => i.alive && !kinds[i.k].letter);
      let target = null, best = Infinity;
      for(const i of cand){ const d = Math.hypot(i.x - x, i.y - NOSE_Y); if(d < best){ best = d; target = i; } }
      if(!target){ cool[f] = 0; return false; }
      const obj = new THREE.Group();
      const axis = (w, h, d, color) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({color}));
      obj.add(axis(9, 0.6, 0.6, 0xd9534f), axis(0.6, 9, 0.6, 0x4cbb5c), axis(0.6, 0.6, 9, 0x4d7dff));
      add({x, y: NOSE_Y, vx: 0, vy: 0, build: 0.35, target, from: [x, NOSE_Y], hw: 0, hh: 0, obj});
    } else if(f === 'GY'){
      // точка с магнитом: летит вверх и подтягивается к ближайшей своей цели
      const obj = addOutline(new THREE.Mesh(sphereGeo, new THREE.MeshLambertMaterial({color: 0xffcc00})));
      obj.scale.setScalar(1.7);
      add({x, y: NOSE_Y, vx: 0, vy: 120, hw: 1.5, hh: 1.5, magnet: true, obj});
    }
    return true;
  }
  // цифру берёт любой выстрел, букву — только её инструмент. G,Y в
  // редакторе — та же точка, что P, поэтому они берут друг друга
  const TOOL_ALIAS = {GY: 'P'};
  const sameTool = (a, b) => (TOOL_ALIAS[a] || a) === (TOOL_ALIAS[b] || b);
  const eligible = (p, i) => !kinds[i.k].letter || sameTool(i.k, p.tool);
  function killInvader(i){
    i.alive = false; field.remove(i.mesh);
    if(G.mode === 'play'){ G.score += kinds[i.k].pts; paintHud(); }
  }
  function blocked(i, p){ // чужой выстрел отскочил: буква вздрагивает и подсказывает клавишу
    i.flashT = 0.35;
    if(i.k === 'E-') tip('<b>Ctrl+E</b>E− invader — become E and fire with Ctrl held (Extrude cut)');
    else if(CHORDS.includes(i.k)) tip('<b>' + keyLabel(i.k) + '</b>' + i.k + ' invader — press G, then ' + i.k[1] + ' (' + WEAPONS[i.k].name + ')');
    else if(i.k === 'E' && p && p.tool === 'E-') tip('<b>E</b>E invader — release Ctrl: a plain Extrude adds');
    else tip('<b>' + i.k + '</b>' + i.k + ' invader — press ' + i.k + ' (' + WEAPONS[i.k].name + ') to take it');
  }
  function updateShots(dt, alive){
    for(let n = shots.length - 1; n >= 0; n--){
      const p = shots[n];
      p.age += dt;
      if(p.target){
        // G,V: перекрестие долетает за время построения и бьёт точно
        const f = Math.min(1, p.age / p.build), t = p.target;
        p.x = p.from[0] + (t.x - p.from[0]) * f; p.y = p.from[1] + (t.y - p.from[1]) * f;
        p.obj.position.set(p.x, p.y, 0); p.obj.rotation.z += dt * 6;
        if(f >= 1){
          if(t.alive){ if(eligible(p, t)) killInvader(t); else blocked(t, p); }
          field.remove(p.obj); shots.splice(n, 1);
        }
        continue;
      }
      const building = p.age < p.build;
      if(building){
        // построение у носа корабля: круг дорисовывается дугой, рамка —
        // сторона за стороной, профиль вытягивается в тело
        const f = p.age / p.build;
        p.x = G.shipX;
        if(p.tool === 'C'){
          const arc = Math.max(0.05, f * Math.PI * 2);
          if(Math.abs(arc - p.arc) > 0.01){
            for(const c of p.obj.children) c.geometry.dispose();
            p.obj.clear();
            p.obj.add(new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.7, 6, 40, arc), blue));
            p.arc = arc;
          }
        } else if(p.tool === 'R'){
          p.obj.children.forEach((e, k) => { e.visible = f >= k / 4; });
        } else if(p.tool === 'E' || p.tool === 'E-'){
          p.obj.scale.z = 0.15 + f * 7.85;
        } else if(p.tool === 'GT'){
          p.obj.children.forEach((m, k) => { m.visible = f >= k / p.obj.children.length; });
        } else if(p.tool === 'GA'){
          // копия встаёт на дугу вокруг носа, когда до неё дошла очередь
          p.obj.visible = f >= p.order / 6;
          p.x = G.shipX + Math.sin(p.ang) * 7; p.y = NOSE_Y + Math.cos(p.ang) * 7 - 2;
        }
      } else {
        if(p.tool === 'C' && p.arc < Math.PI * 2 - 0.01){
          for(const c of p.obj.children) c.geometry.dispose();
          p.obj.clear(); p.obj.add(new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.7, 6, 40, Math.PI * 2), blue)); p.arc = Math.PI * 2;
        }
        if(p.tool === 'R') p.obj.children.forEach(e => { e.visible = true; });
        if(p.tool === 'E' || p.tool === 'E-') p.obj.scale.z = 8;
        if(p.tool === 'GA') p.obj.visible = true;
        if(p.tool === 'GT') p.obj.children.forEach(m => { m.visible = true; });
        if(p.magnet){ // магнит привязки: подруливает к ближайшей своей цели выше
          let tgt = null, best = 20;
          for(const i of alive){
            if(!i.alive || i.y < p.y || !eligible(p, i)) continue;
            const d = Math.abs(i.x - p.x);
            if(d < best){ best = d; tgt = i; }
          }
          if(tgt) p.vx = Math.max(-70, Math.min(70, p.vx + Math.sign(tgt.x - p.x) * 260 * dt));
        }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if(p.head) p.head.position.set(p.x, p.y, 0); // группа полилинии стоит в нуле, едет голова
      else p.obj.position.set(p.x, p.y, p.tool === 'E' ? 4 : p.tool === 'E-' ? -4 : 0);
      if(p.tool === 'C') p.obj.rotation.z += dt * 2;
      let done = p.y > FH + 8 || p.y < -FH - 10 || Math.abs(p.x) > FW + 10;
      if(!building && !done){
        const hitNow = [];
        for(const i of alive){
          if(!i.alive || p.hits.has(i)) continue;
          const iw = (kinds[i.k].w || CELL_W) / 2, ih = (kinds[i.k].h || CELL_H) / 2;
          const hit = p.r
            ? Math.hypot(Math.max(Math.abs(p.x - i.x) - iw, 0), Math.max(Math.abs(p.y - i.y) - ih, 0)) <= p.r
            : Math.abs(p.x - i.x) <= iw + p.hw && Math.abs(p.y - i.y) <= ih + p.hh;
          if(hit) hitNow.push(i);
        }
        if(hitNow.length){
          const good = hitNow.filter(i => eligible(p, i)), bad = hitNow.filter(i => !eligible(p, i));
          if(p.pierce){
            // тело идёт насквозь по цифрам и своим буквам, но чужая буква —
            // щит: на ней выдавливание разбивается (снизу вверх по колонне)
            for(const i of hitNow.sort((a, b) => a.y - b.y)){
              if(!eligible(p, i)){ blocked(i, p); done = true; break; }
              killInvader(i); p.hits.add(i);
            }
          } else if(p.wide){
            // широкая полоса: своих под ней берёт, чужая буква останавливает
            for(const i of good) killInvader(i);
            if(bad.length){ blocked(bad[0], p); done = true; }
            else for(const i of good) p.hits.add(i);
          } else if(p.jumps){
            // полилиния: попала в свою — ломаная дотягивается до неё и
            // поворачивает к ближайшей следующей своей цели; чужая — щит
            const first = hitNow.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
            if(!eligible(p, first)){ blocked(first, p); done = true; }
            else {
              killInvader(first); p.hits.add(first);
              p.obj.add(segmentBox(p.last, [first.x, first.y]));
              p.last = [first.x, first.y]; p.x = first.x; p.y = first.y;
              p.jumps--;
              let next = null, best = 46;
              for(const i of alive){
                if(!i.alive || p.hits.has(i) || !eligible(p, i)) continue;
                const d = Math.hypot(i.x - p.x, i.y - p.y);
                if(d < best){ best = d; next = i; }
              }
              if(!p.jumps || !next) done = true;
              else { const d = Math.max(1e-6, best); p.vx = (next.x - p.x) / d * 150; p.vy = (next.y - p.y) / d * 150; }
            }
          } else if(p.area){
            // контур забирает всех своих внутри; одни чужие — отскок
            if(good.length) for(const i of good) killInvader(i); else blocked(bad[0], p);
            done = true;
          } else {
            const first = hitNow.sort((a, b) => a.y - b.y)[0];
            if(eligible(p, first)) killInvader(first); else blocked(first, p);
            done = true;
          }
        }
      }
      if(done){
        shots.splice(n, 1);
        // ломаная ещё немного видна — понятно, как прошла цепочка
        if(p.head && p.obj.children.length > 1){ p.obj.remove(p.head); fx.push({obj: p.obj, t: 0.5}); }
        else field.remove(p.obj);
      }
    }
  }
  // демо: корабль сам выбирает открытого снизу захватчика, превращается в
  // нужную букву, подъезжает и стреляет — показывает, как играть
  function demoPilot(dt, alive){
    if(!G.demoTarget || !G.demoTarget.alive){
      const lowest = new Map();
      for(const i of alive) if(!lowest.has(i.x) || lowest.get(i.x).y > i.y) lowest.set(i.x, i);
      const open = [...lowest.values()];
      const letters = open.filter(i => kinds[i.k].letter);
      const pool = letters.length ? letters : open;
      G.demoTarget = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      if(G.demoTarget){
        const k = G.demoTarget.k;
        setForm(k === 'E-' ? 'E' : kinds[k].letter ? k : '0');
        G.ctrl = k === 'E-'; // демо «зажимает» Ctrl для выреза
      }
    }
    const t = G.demoTarget;
    if(!t) return;
    const dx = t.x - G.shipX;
    G.shipX += Math.sign(dx) * Math.min(Math.abs(dx), 70 * dt);
    if(Math.abs(dx) < 2 && !shots.length) fire();
  }
  function update(dt){
    const alive = G.invaders.filter(i => i.alive);
    const playing = G.mode === 'play';
    for(const id in cool) cool[id] = Math.max(0, cool[id] - dt);
    if(tipT > 0){ tipT -= dt; if(tipT <= 0) hudTip.style.opacity = 0; }
    G.t += dt;
    // покачивание в объёме: у каждого свой ритм; отскок — вздрагивание
    for(const i of alive){
      i.mesh.rotation.y = Math.sin(G.t * i.sp + i.ph) * i.ay;
      i.mesh.rotation.x = Math.sin(G.t * i.sp * 0.7 + i.ph * 1.3) * i.ax;
      if(i.flashT > 0){ i.flashT = Math.max(0, i.flashT - dt); i.mesh.scale.setScalar((kinds[i.k].scale || DIGIT_SCALE) * (1 + 0.35 * i.flashT / 0.35)); }
    }
    // марш: чем меньше захватчиков, тем чаще шаг. Игра учебная — темп
    // спокойный, и вниз строй опускается только после полного прохода
    // туда-обратно (каждый второй разворот), чтобы успеть сменить форму
    G.stepT -= dt;
    if(G.stepT <= 0 && alive.length){
      G.stepT = 0.12 + 0.9 * alive.length / 55;
      const edge = alive.some(i => Math.abs(i.x + G.dir * 2) > FW - 8);
      const down = edge && (++G.edges % 2 === 0);
      for(const i of alive){
        if(down) i.y -= 4; else if(!edge) i.x += G.dir * 2;
        i.mesh.position.set(i.x, i.y, 0);
      }
      if(edge) G.dir = -G.dir;
      // бомба от нижнего захватчика случайной колонки — редко и не больше
      // двух в воздухе
      const free = bombs.find(bm => !bm.visible);
      if(playing && free && bombs.filter(bm => bm.visible).length < 2 && Math.random() < 0.2){
        const cols = new Map();
        for(const i of alive) if(!cols.has(i.x) || cols.get(i.x).y > i.y) cols.set(i.x, i);
        const shooters = [...cols.values()];
        const s = shooters[Math.floor(Math.random() * shooters.length)];
        free.position.set(s.x, s.y - CELL_H / 2 - 1, 0); free.visible = true;
      }
      if(playing && alive.some(i => i.y - CELL_H / 2 <= SHIP_Y + SHIP_HH)){ G.lives = 0; saveHi(); setMode('over'); return; }
    }
    if(!playing && (alive.some(i => i.y < -8) || !alive.length)) newWave(); // демо и «game over» идут по кругу
    if(G.mode === 'attract') demoPilot(dt, alive);
    // корабль
    if(playing){
      G.shipX += ((G.keys.right ? 1 : 0) - (G.keys.left ? 1 : 0)) * 75 * dt;
    }
    G.shipX = Math.max(-FW + 8, Math.min(FW - 8, G.shipX));
    ship.position.set(G.shipX, SHIP_Y, 0);
    layoutShip(dt);
    // корабль стоит ровно и наклоняется только в движении — в сторону, куда
    // едет (и под клавишами, и у демо-пилота); наклон плавно набирается и уходит
    const vx = dt > 0 && G.prevShipX !== undefined ? (G.shipX - G.prevShipX) / dt : 0;
    G.prevShipX = G.shipX;
    const leanTo = Math.max(-1, Math.min(1, vx / 75));
    G.lean = (G.lean || 0) + (leanTo - (G.lean || 0)) * Math.min(1, dt * 10);
    ship.rotation.set(0, G.lean * 0.35, -G.lean * 0.12);
    if(G.hitT > 0){ G.hitT -= dt; ship.visible = Math.floor(G.hitT * 10) % 2 === 0; if(G.hitT <= 0) ship.visible = G.mode !== 'over'; }
    updateShots(dt, alive);
    for(let n = fx.length - 1; n >= 0; n--){ fx[n].t -= dt; if(fx[n].t <= 0){ field.remove(fx[n].obj); fx.splice(n, 1); } }
    // бомбы
    for(const bm of bombs){
      if(!bm.visible) continue;
      bm.position.y -= 32 * dt; // медленные бомбы — есть время увернуться
      if(bm.position.y < -FH - 4){ bm.visible = false; continue; }
      if(playing && G.hitT <= 0 && Math.abs(bm.position.x - G.shipX) <= SHIP_HW + 0.6 && Math.abs(bm.position.y - SHIP_Y) <= SHIP_HH + 2){
        bm.visible = false; G.lives--; G.hitT = 1.2; paintHud();
        if(G.lives <= 0){ saveHi(); setMode('over'); return; }
      }
    }
    if(playing && !G.invaders.some(i => i.alive)){ G.wave++; newWave(); }
  }
  // вписать название над карточками и поле игры в окно
  function layout(){
    const w = cv.clientWidth, hh = Math.max(1, cv.clientHeight);
    renderer.setSize(w, hh, false);
    cam.aspect = w / hh; cam.updateProjectionMatrix();
  }
  const tanH = Math.tan(cam.fov * Math.PI / 360);
  const t0 = performance.now();
  let last = t0, raf = 0, sizeKey = '';
  const draw = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const key = cv.clientWidth + 'x' + cv.clientHeight;
    if(key !== sizeKey){ sizeKey = key; layout(); }
    const s = (now - t0) / 1000;
    let camZ;
    if(G.mode === 'off'){
      // над карточками: центр — середина пустого блока #stTitleSpace, запас
      // ширины на покачивание (ближний край буквы растёт в перспективе)
      const box = document.getElementById('stTitleSpace').getBoundingClientRect();
      const vr = cv.getBoundingClientRect();
      const fracH = Math.max(0.15, box.height / Math.max(1, vr.height));
      const ndcY = 1 - 2 * ((box.top + box.height / 2) - vr.top) / Math.max(1, vr.height);
      const zW = (title.userData.w / 2 + 2) / (tanH * cam.aspect * 0.76);
      const zH = (7 / 2 + 2) / (tanH * fracH * 0.8);
      camZ = Math.max(zW, zH, 20);
      title.position.set(0, ndcY * camZ * tanH, 0);
      title.rotation.y = Math.sin(s * 0.6) * 0.32;
      title.rotation.x = -0.28 + Math.sin(s * 0.45) * 0.08;
      if(now - G.lastAct > INVADER_IDLE_MS) setMode('attract');
    } else {
      // поле наклонено и медленно покачивается — видно, что всё объёмное
      camZ = 1.12 * Math.max((FW + 8) / (tanH * cam.aspect), (FH + 10) / tanH);
      field.rotation.x = -0.42; field.rotation.y = Math.sin(s * 0.25) * 0.12;
      field.position.y = 4;
      if(G.mode === 'attract' || G.mode === 'over') gameTitle.rotation.y = Math.sin(s * 0.8) * 0.2;
      update(dt);
    }
    cam.position.set(0, 0, camZ); cam.lookAt(0, 0, 0);
    renderer.render(scn, cam);
  };
  const frame = () => { draw(performance.now()); raf = requestAnimationFrame(frame); };
  let downAt = null;
  startScreen.addEventListener('pointermove', e => {
    if(G.mode === 'off'){ G.lastAct = performance.now(); return; }
    if(G.mode === 'attract'){ // сдвинули мышь — назад к карточкам
      if(!downAt) downAt = {x: e.clientX, y: e.clientY};
      else if(Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8){ downAt = null; setMode('off'); }
    }
  });
  startScreen.addEventListener('pointerdown', () => {
    if(G.mode === 'off') G.lastAct = performance.now();
    else if(G.mode === 'attract' || G.mode === 'over'){ downAt = null; setMode('off'); }
  });
  startScreen.addEventListener('wheel', () => { if(G.mode === 'off') G.lastAct = performance.now(); }, {passive: true});
  return {
    start(){ G.lastAct = performance.now(); last = performance.now(); if(!raf) frame(); },
    stop(){ cancelAnimationFrame(raf); raf = 0; if(G.mode !== 'off') setMode('off'); },
    poke(){ G.lastAct = performance.now(); },
    // клавиши игры; true — съедено
    key(e, down){
      if(G.mode === 'off') return false;
      const k = e.key;
      const lk = (k || '').toLowerCase();
      const left = k === 'ArrowLeft' || e.code === 'KeyA' || lk === 'a' || lk === 'ф',
            right = k === 'ArrowRight' || e.code === 'KeyD' || lk === 'd' || lk === 'в';
      if(e.key === 'Control') G.ctrl = down && G.mode === 'play';
      // по e.code — клавиши работают и в русской раскладке, как в редакторе;
      // запасной разбор по e.key (code бывает пустым: экранные клавиатуры,
      // автоматизация) — с русскими буквами на тех же клавишах
      let form = {KeyL: 'L', KeyP: 'P', KeyC: 'C', KeyR: 'R', KeyE: 'E', KeyG: 'G', Digit0: '0', Numpad0: '0'}[e.code]
        || {l: 'L', 'д': 'L', p: 'P', 'з': 'P', c: 'C', 'с': 'C', r: 'R', 'к': 'R', e: 'E', 'у': 'E', g: 'G', 'п': 'G', '0': '0'}[lk];
      // вторая клавиша аккорда: G уже нажата (корабль «G», 4 с) — A и M
      // значат инструмент, а не движение влево
      const isA = e.code === 'KeyA' || lk === 'a' || lk === 'ф', isM = e.code === 'KeyM' || lk === 'm' || lk === 'ь';
      const isT = e.code === 'KeyT' || lk === 't' || lk === 'е', isV = e.code === 'KeyV' || lk === 'v' || lk === 'м';
      const isY = e.code === 'KeyY' || lk === 'y' || lk === 'н';
      const chordOpen = down ? shipForm === 'G' && G.t - (G.chordT || 0) < 4 : CHORDS.includes(G.pending);
      if(chordOpen && isA) form = 'GA';
      if(chordOpen && isM) form = 'GM';
      if(chordOpen && isT) form = 'GT';
      if(chordOpen && isV) form = 'GV';
      if(chordOpen && isY) form = 'GY';
      const space = k === ' ' || e.code === 'Space';
      if(!down){
        if(left || isA) G.keys.left = false;
        if(right) G.keys.right = false;
        // стреляем клавишей инструмента, а не пробелом: нажал — корабль стал
        // буквой, отпустил — выстрел этой буквой (Ctrl ещё зажат — вырез).
        // Руки учатся тем же клавишам, что в редакторе
        // стреляет только отпускание той клавиши, что дала форму (A после
        // G,A стреляет, просто A — движение)
        if(form && G.mode === 'play' && form === shipForm && G.pending === form){ G.ctrl = e.ctrlKey; fire(); G.pending = null; }
        return true;
      }
      if(k === 'Escape'){ setMode('off'); return true; }
      if(G.mode === 'attract'){ if(space) setMode('play'); else setMode('off'); return true; }
      if(G.mode === 'over'){ if(space) setMode('play'); return true; }
      if(left && form !== 'GA') G.keys.left = true;
      if(right) G.keys.right = true;
      if(form && !e.repeat){ setForm(form); G.pending = form; if(form === 'G') G.chordT = G.t; }
      if(space) tip('<b>L P C R E 0</b>Fire with the tool keys: press — the ship becomes the tool, release — it fires · G, then A M T V or Y — chords');
      return true;
    },
    get mode(){ return G.mode; },
    // n кадров по dtMs без requestAnimationFrame — для проверок и будущего
    // слоя команд (скрытая вкладка не крутит rAF)
    step(n, dtMs){ for(let i=0;i<n;i++) draw(last + (dtMs || 16)); },
    setMode, G, fire, shots, setForm,
    get form(){ return shipForm; }
  };
}
function openStartScreen(){
  let hasSession = false;
  try{ hasSession = !!localStorage.getItem(AUTOSAVE_KEY); }catch(_){}
  document.getElementById('st_continue').hidden = !hasSession;
  document.getElementById('st_foot').textContent =
    (window.ZC_BUILD && window.ZC_BUILD.indexOf('__') < 0 ? window.ZC_BUILD : 'dev')
    + (HAS_SERVER ? '' : ' · no server needed');
  startScreen.hidden = false;
  try{
    if(!startGL) startGL = startTitleScene();
    startGL.start();
  }catch(err){ console.warn('start title not rendered', err); } // без WebGL — просто карточки
  const first = startScreen.querySelector(hasSession ? '#st_continue' : '.st-card');
  if(first) first.focus();
}
function closeStartScreen(){
  if(startScreen.hidden) return;
  startScreen.hidden = true;
  if(startGL) startGL.stop();
}
async function startWithShape(kind){
  const radio = document.querySelector('input[name=shape][value="' + kind + '"]');
  if(!radio) return;
  radio.checked = true;
  applyShapePreset(); applyShapeUI();
  closeStartScreen();
  await rebuild();
}
startScreen.querySelectorAll('.st-card').forEach(b =>
  b.addEventListener('click', () => startWithShape(b.dataset.shape)));
document.getElementById('st_continue').addEventListener('click', closeStartScreen);
document.getElementById('st_open').addEventListener('click', () => { closeStartScreen(); openProject(); });
document.getElementById('st_import').addEventListener('click', () => { closeStartScreen(); f_stl.value = ''; f_stl.click(); });
// обучение через игру — сразу, без 30 секунд ожидания демо
document.getElementById('st_learn').addEventListener('click', e => {
  e.currentTarget.blur(); // Space в игре — выстрел, а не повторное нажатие кнопки
  if(startGL) startGL.setMode('play');
});
document.getElementById('f_new').addEventListener('click', openStartScreen);
// пока открыт стартовый экран, клавиши не доходят до сцены. Esc — продолжить
// (последняя сессия или то, что уже на сцене); Ctrl+O/S ловятся раньше
window.addEventListener('keydown', e => {
  if(startScreen.hidden) return;
  // идёт CAD INVADERS — клавиши игре (Space не нажимает карточку в фокусе)
  if(startGL && startGL.key(e, true)){ e.preventDefault(); e.stopImmediatePropagation(); return; }
  if(startGL) startGL.poke();
  if(e.key === 'Escape'){ e.preventDefault(); closeStartScreen(); }
  if(e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') return; // фокус по карточкам
  e.stopImmediatePropagation();
}, true);
window.addEventListener('keyup', e => {
  if(!startScreen.hidden && startGL && startGL.key(e, false)){ e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

// ---------- Команды без мыши и связь с агентом (MCP) ----------
// Каждая команда — те же функции, что зовут инструменты мыши (одно
// приложение, не два): линия — commitLinePoint, выдавливание — окно
// Extrude и commitExtrude. Реестр описывает параметры JSON-схемой: тот же
// список сервер отдаёт агенту в MCP tools/list. Грани адресуются
// геометрически — точкой на грани (и нормалью), а не индексами треугольников:
// индексы меняются после каждого реза
const zcV3 = (a, name) => {
  if(!Array.isArray(a) || a.length !== 3 || a.some(x => !Number.isFinite(+x)))
    throw new Error(name + ' must be [x, y, z] in mm');
  return new THREE.Vector3(+a[0], +a[1], +a[2]);
};
// Готовое замкнутое тело из треугольников (конус, тело вращения, труба) —
// в модель: new заменяет её, join/cut — через BSP с лечением швов.
// Ориентация — по знаку объёма, координаты округляются до 0.001 мм
function zcApplySolid(tris, op, round = true){
  let vol = 0;
  for(const [p, q, r] of tris) vol += p.dot(new THREE.Vector3().crossVectors(q, r)) / 6;
  if(vol < 0) tris = tris.map(t => [t[0], t[2], t[1]]);
  const q3 = x => Math.round(x*1000)/1000;
  const toArr = list => {
    const arr = [];
    for(const t of list){
      const ar = new THREE.Vector3().subVectors(t[1],t[0]).cross(new THREE.Vector3().subVectors(t[2],t[0])).length();
      if(ar < 1e-6) continue;
      for(const vv of t) arr.push(q3(vv.x), q3(vv.y), q3(vv.z));
    }
    return new Float32Array(arr);
  };
  const pos = mesh.geometry.attributes.position.array;
  const v0 = meshVolumeOf(pos);
  const snap = takeSnapshot();
  let out;
  if(op === 'new') out = toArr(tris);
  else {
    const body = [];
    for(let i=0;i<pos.length;i+=9)
      body.push([new THREE.Vector3(pos[i],pos[i+1],pos[i+2]), new THREE.Vector3(pos[i+3],pos[i+4],pos[i+5]),
                 new THREE.Vector3(pos[i+6],pos[i+7],pos[i+8])]);
    // round: false — второе тело из точек самой модели (призма лоскута):
    // округление сдвинуло бы его стенки с рёбер контура на доли микрона
    const R = t => round ? t.map(v => new THREE.Vector3(q3(v.x), q3(v.y), q3(v.z))) : t;
    out = meshBoolean(body, tris.map(R), op === 'cut' ? 'subtract' : 'union');
    lastBoolPath = 'exact';
  }
  if(!out.length) throw new Error('the result is empty');
  pushHistory(snap);
  if(op === 'new') restoreGuides([]);
  setMeshFromArray(out);
  if(op !== 'new'){ cleanupMesh(); if(openEdgeCount() > 0) healAll(); }
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  clearEdgeSel(); deselect(); hidePatch(); ppPatch = null;
  extractEdges();
  return Object.assign({solid_volume_mm3: +Math.abs(vol).toFixed(3),
    volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3)}, zcSummary());
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
function zcSummary(){
  const pos = mesh.geometry.attributes.position.array;
  const box = new THREE.Box3();
  for(let i=0;i<pos.length;i+=3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i+1], pos[i+2]));
  const r3 = v => [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
  return {
    triangles: pos.length / 9,
    volume_mm3: +meshVolumeOf(pos).toFixed(3),
    bbox_min: r3(box.min), bbox_max: r3(box.max),
    open_edges: openEdgeCount(),   // 0 — тело замкнуто
    nonmanifold_edges: nonManifoldEdgeCount(), // рёбра с 3+ треугольниками: слайсеры на них ругаются
    lines: guides.length,
    undo_steps: undoStack.length
  };
}
// грань под точкой: треугольник, содержащий точку (до 0.05 мм); с нормалью —
// ещё и смотрящий в её сторону (точка на ребре принадлежит двум граням)
function zcFaceAt(P, normal){
  const pos = mesh.geometry.attributes.position.array;
  const tri = new THREE.Triangle(), q = new THREE.Vector3();
  let best = -1, bestD = 0.05;
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    tri.set(new THREE.Vector3(pos[o],pos[o+1],pos[o+2]), new THREE.Vector3(pos[o+3],pos[o+4],pos[o+5]),
            new THREE.Vector3(pos[o+6],pos[o+7],pos[o+8]));
    if(tri.getArea() < 1e-6) continue;
    tri.closestPointToPoint(P, q);
    const d = q.distanceTo(P);
    if(d > bestD) continue;
    if(normal && triNormalAt(t).dot(normal) < 0.99) continue;
    best = t; bestD = d;
  }
  return best;
}
// Срез тела плоскостью без булевых: BSP на косой плоскости дробил даже
// простое тело (98 треугольников → 533 и 157 открытых рёбер), и лечение
// сетки потом разгонялось до тысяч. Здесь каждый треугольник отсекается по
// плоскости; точка на ребре считается от концов, упорядоченных по ключу, —
// у двух соседей она выходит бит в бит одинаковой, щелей нет. Контур среза
// (отрезки от оставшихся кусков) сцепляется в петли и закрывается крышкой,
// смотрящей по нормали. Остаётся сторона против нормали. null — контур не
// замкнулся или петли вложены (дырка в сечении — крышка без дыр не годится)
function planeCut(pos, P, n){
  const EPS = 1e-5;
  const V = o => new THREE.Vector3(pos[o], pos[o+1], pos[o+2]);
  const dist = X => { const d = n.dot(X) - n.dot(P); return Math.abs(d) < EPS ? 0 : d; };
  const K = X => keyOf(X.x, X.y, X.z);
  const cross = (A, B, dA, dB) => {
    // порядок концов по ключу — одинаковая точка у обоих треугольников ребра
    if(K(A) > K(B)){ const T = A; A = B; B = T; const t = dA; dA = dB; dB = t; }
    return A.clone().lerp(B, dA / (dA - dB));
  };
  const out = [], segs = [];
  const push = (a, b, c) => out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for(let o=0;o<pos.length;o+=9){
    const vs = [V(o), V(o+3), V(o+6)], ds = vs.map(dist);
    if(ds.every(d => d >= 0)){
      // всё на снимаемой стороне; треугольник в самой плоскости, смотрящий
      // против нормали, — это и есть сечение, его не выбрасываем
      if(ds.every(d => d === 0) && new THREE.Vector3().subVectors(vs[1], vs[0]).cross(new THREE.Vector3().subVectors(vs[2], vs[0])).dot(n) < 0){
        push(vs[0], vs[1], vs[2]);
        for(let e=0;e<3;e++) segs.push([vs[(e+1)%3], vs[e]]);
      }
      continue;
    }
    const poly = [];
    for(let e=0;e<3;e++){
      const A = vs[e], B = vs[(e+1)%3], dA = ds[e], dB = ds[(e+1)%3];
      if(dA <= 0) poly.push({p: A, on: dA === 0});
      if((dA < 0 && dB > 0) || (dA > 0 && dB < 0)) poly.push({p: cross(A, B, dA, dB), on: true});
    }
    for(let k=1;k+1<poly.length;k++) push(poly[0].p, poly[k].p, poly[k+1].p);
    // ребро куска, лежащее в плоскости, — край сечения (крышка обходит его обратно)
    for(let k=0;k<poly.length;k++){
      const a = poly[k], b = poly[(k+1)%poly.length];
      if(a.on && b.on && K(a.p) !== K(b.p)) segs.push([b.p, a.p]);
    }
  }
  if(!out.length) return new Float32Array(0);
  if(!segs.length) return new Float32Array(out); // плоскость мимо тела
  // сцепить отрезки в петли
  const next = new Map();
  for(const [a, b] of segs){
    const ka = K(a);
    if(!next.has(ka)) next.set(ka, []);
    next.get(ka).push(b);
  }
  const used = new Set(), loops = [];
  for(const [a0] of segs){
    const k0 = K(a0);
    if(used.has(k0) || !next.has(k0)) continue;
    const loop = [];
    let cur = a0, guard = segs.length + 2;
    while(guard-- > 0){
      const kc = K(cur);
      if(used.has(kc)) break;
      used.add(kc); loop.push(cur);
      const nx = (next.get(kc) || []).find(p => !used.has(K(p)) || K(p) === k0);
      if(!nx) return null;
      if(K(nx) === k0) break;
      cur = nx;
    }
    if(loop.length >= 3) loops.push(loop);
  }
  if(!loops.length) return null;
  if(loops.length > 1) return null; // вложенные/несколько сечений — пока не поддержано
  // крышка по тем же точкам, что края кусков: Т-стыков между ними нет
  const loop = loops[0];
  const tris = earClip(loop);
  if(!tris.length) return null;
  for(const [a, b, c] of tris){
    const tn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if(tn.dot(n) >= 0) push(a, b, c); else push(a, c, b);
  }
  return new Float32Array(out);
}
// Сквозной вырез области грани до параллельной обратной грани (отверстие в
// пластине) — без булевых. BSP на пластине с уже вырезанными дырками рос до
// тысяч треугольников, оставлял щели и тянулся секундами. Здесь: контур
// области переносится на обратную грань хордами (с линиями, как у круга),
// обе области снимаются, стенки сшиваются «молнией» между верхним и нижним
// контуром по положению вдоль контура — точки врезки с каждой стороны свои,
// но каждая встаёт в стенку, и Т-стыков нет
function zcCutThrough(tri){
  let pos = mesh.geometry.attributes.position.array;
  const patchTop = facePatchCached(tri);
  const n = triNormalAt(tri).clone().normalize();
  const top = patchOutlineLoop(pos, patchTop.tris);
  if(!top) throw new Error('the face region must have one outline without holes');
  const newell = L => {
    const w = new THREE.Vector3();
    for(let i=0;i<L.length;i++){ const p = L[i], q = L[(i+1)%L.length];
      w.x += (p.y-q.y)*(p.z+q.z); w.y += (p.z-q.z)*(p.x+q.x); w.z += (p.x-q.x)*(p.y+q.y); }
    return w;
  };
  if(newell(top).dot(n) < 0) top.reverse();
  // контур не должен касаться края грани: иначе стенка легла бы на боковину
  const K = X => keyOf(X.x, X.y, X.z);
  const c = top.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / top.length);
  // толщина: ближайшая грань ниже по -n, смотрящая против n
  const ray = new THREE.Ray(c.clone().addScaledVector(n, -1e-3), n.clone().negate());
  const hit = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  let depth = Infinity, exitTri = -1;
  for(let o=0;o<pos.length;o+=9){
    A.fromArray(pos, o); B.fromArray(pos, o+3); Cc.fromArray(pos, o+6);
    if(!ray.intersectTriangle(A, B, Cc, false, hit)) continue;
    const dd = hit.distanceTo(c);
    if(dd > 1e-3 && dd < depth){ depth = dd; exitTri = o/9; }
  }
  if(exitTri < 0) throw new Error('nothing below this region to cut through');
  if(triNormalAt(exitTri).dot(n) > -0.999) throw new Error('the opposite face is not parallel to this one');
  const bot = top.map(p => p.clone().addScaledVector(n, -depth));
  // обратная грань должна лежать под всем контуром
  const test = getFaceTester();
  for(let i=0;i<bot.length;i++)
    if(!test(bot[i]) || !test(bot[i].clone().lerp(bot[(i+1)%bot.length], 0.5)))
      throw new Error('the opposite face does not cover the whole outline');
  const v0 = meshVolumeOf(pos);
  pushUndo();
  // врезать контур в обратную грань: линии держат область, хорды режут сетку
  for(let i=0;i<bot.length;i++){
    const a = bot[i], b = bot[(i+1)%bot.length];
    if(a.distanceTo(b) < 1e-6) continue;
    addGuide(a, b, true);
    splitMeshByChord(a, b, 'segment');
  }
  cleanupMesh(); extractEdges();
  pos = mesh.geometry.attributes.position.array;
  const tb = zcFaceAt(c.clone().addScaledVector(n, -depth), n.clone().negate());
  const tt = zcFaceAt(c, n);
  if(tb < 0 || tt < 0){ undo(true); throw new Error('could not find the regions after cutting the outline'); }
  cachedPatch = null;
  const pTop = facePatchAt(tt), pBot = facePatchAt(tb);
  const loopT = patchOutlineLoop(pos, pTop.tris), loopB = patchOutlineLoop(pos, pBot.tris);
  if(!loopT || !loopB){ undo(true); throw new Error('the outline on the opposite face did not close'); }
  if(newell(loopT).dot(n) < 0) loopT.reverse();
  if(newell(loopB).dot(n) < 0) loopB.reverse(); // оба — против часовой вокруг n
  // положение точки вдоль контура (по проекции на верхнюю петлю)
  const cum = [0];
  for(let i=0;i<loopT.length;i++) cum.push(cum[i] + loopT[i].distanceTo(loopT[(i+1)%loopT.length]));
  const per = cum[loopT.length];
  const param = P => {
    const Q = P.clone().addScaledVector(n, n.dot(new THREE.Vector3().subVectors(loopT[0], P)));
    let best = 0, bd = Infinity;
    for(let i=0;i<loopT.length;i++){
      const a = loopT[i], b = loopT[(i+1)%loopT.length], ab = new THREE.Vector3().subVectors(b, a);
      const L2 = ab.lengthSq(); if(L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(Q, a).dot(ab) / L2));
      const d = a.clone().addScaledVector(ab, t).distanceTo(Q);
      if(d < bd){ bd = d; best = cum[i] + t * Math.sqrt(L2); }
    }
    return best % per;
  };
  const sT = loopT.map((p, i) => ({p, s: cum[i]}));
  const sB = loopB.map(p => ({p, s: param(p)}));
  // нижнюю петлю начинаем с точки, ближайшей к началу верхней
  let b0 = 0;
  for(let j=1;j<sB.length;j++){ const dj = Math.min(sB[j].s, per - sB[j].s), db = Math.min(sB[b0].s, per - sB[b0].s); if(dj < db) b0 = j; }
  const B2 = sB.slice(b0).concat(sB.slice(0, b0)).map((x, k) => ({p: x.p, s: k === 0 && x.s > per/2 ? x.s - per : x.s}));
  for(let k=1;k<B2.length;k++) if(B2[k].s < B2[k-1].s - per/2) B2[k].s += per;
  const T2 = sT.concat([{p: sT[0].p, s: per}]);
  B2.push({p: B2[0].p, s: B2[0].s + per});
  const drop = new Set([...pTop.tris, ...pBot.tris]);
  const out = [];
  for(let t=0;t<pos.length/9;t++) if(!drop.has(t)) for(let j=0;j<9;j++) out.push(pos[t*9+j]);
  const walls = [];
  let i = 0, j = 0;
  while(i < T2.length - 1 || j < B2.length - 1){
    const nextT = i < T2.length - 1 ? T2[i+1].s : Infinity, nextB = j < B2.length - 1 ? B2[j+1].s : Infinity;
    if(nextT <= nextB){ walls.push([T2[i].p, T2[i+1].p, B2[j].p]); i++; }
    else { walls.push([T2[i].p, B2[j+1].p, B2[j].p]); j++; }
  }
  const push = (a, b, c2) => out.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z);
  // стенка отверстия смотрит внутрь отверстия (к оси): проверим по первой
  const axis = c;
  const w0 = walls[0], wn = new THREE.Vector3().subVectors(w0[1], w0[0]).cross(new THREE.Vector3().subVectors(w0[2], w0[0]));
  const mid = w0[0].clone().add(w0[1]).add(w0[2]).multiplyScalar(1/3);
  const toAxis = new THREE.Vector3().subVectors(axis, mid); toAxis.addScaledVector(n, -toAxis.dot(n));
  const flip = wn.dot(toAxis) < 0;
  for(const [a, b, c2] of walls) flip ? push(a, c2, b) : push(a, b, c2);
  setMeshFromArray(new Float32Array(out));
  cleanupMesh();
  hidePatch(); ppPatch = null; clearEdgeSel(); deselect();
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
  const dv = meshVolumeOf(mesh.geometry.attributes.position.array) - v0;
  if(dv >= 0 || openEdgeCount() > 0){ undo(true); throw new Error('cut through did not close the body here'); }
  return Object.assign({face_area_mm2: +patchTop.area.toFixed(3), depth_mm: +depth.toFixed(3), volume_change_mm3: +dv.toFixed(3)}, zcSummary());
}
// Фаска/скругление по всему внешнему контуру грани — прямые участки и дуги
// разом (bevel_edges умеет только прямые рёбра: после скругления вертикальных
// рёбер фаска по верху шла лишь по прямым, дуги оставались острыми).
// Без булевых, для «призматического» края: стенки вдоль контура
// перпендикулярны грани. В грань врезается контур отступа (в углах — по
// биссектрисе, отступ от обеих сторон — size), полоса между краем и ним
// снимается, край стенок опускается на size, между ними — профиль: одна
// полоса для фаски, segs для скругления, сшитые «молнией» с точками
// врезки. Остальная грань не двигается — тонкие треугольники у отверстий не
// выворачиваются; внутренние контуры не трогаются
function zcBevelFaceLoop(tri, size, segs){
  let pos = mesh.geometry.attributes.position.array;
  const n = triNormalAt(tri).clone().normalize();
  const d0 = n.dot(new THREE.Vector3().fromArray(pos, tri*9));
  const patch = facePatchCached(tri);
  const K = X => keyOf(X.x, X.y, X.z);
  const Kp = (arr, o) => keyOf(arr[o], arr[o+1], arr[o+2]);
  const newell = L => {
    const w = new THREE.Vector3();
    for(let i=0;i<L.length;i++){ const p = L[i], q = L[(i+1)%L.length];
      w.x += (p.y-q.y)*(p.z+q.z); w.y += (p.z-q.z)*(p.x+q.x); w.z += (p.x-q.x)*(p.y+q.y); }
    return w.dot(n) / 2;
  };
  // граничные рёбра области, сцепленные в петли; внешняя — самая большая
  const chainLoops = (trisList, arr, edgeFilter) => {
    const cnt = new Map();
    for(const t of trisList) for(let e=0;e<3;e++){
      const o1 = t*9+e*3, o2 = t*9+((e+1)%3)*3, k1 = Kp(arr, o1), k2 = Kp(arr, o2);
      if(k1 === k2) continue;
      const ek = k1 < k2 ? k1+'|'+k2 : k2+'|'+k1;
      const r = cnt.get(ek);
      if(r) r.c++; else cnt.set(ek, {c: 1, ka: k1, kb: k2, a: new THREE.Vector3().fromArray(arr, o1), b: new THREE.Vector3().fromArray(arr, o2)});
    }
    const next = new Map();
    for(const r of cnt.values()) if(r.c === 1 && (!edgeFilter || edgeFilter(r))) next.set(r.ka, r);
    const loops = [], used = new Set();
    for(const [k0] of next){
      if(used.has(k0)) continue;
      const L = []; let k = k0, guard = next.size + 2;
      while(guard-- > 0 && !used.has(k)){ const r = next.get(k); if(!r) break; used.add(k); L.push(r.a); k = r.kb; }
      if(k === k0 && L.length >= 3) loops.push(L);
    }
    return loops;
  };
  const loops = chainLoops(patch.tris, pos);
  if(!loops.length) throw new Error('the face region has no closed outline');
  loops.sort((a, b) => Math.abs(newell(b)) - Math.abs(newell(a)));
  let P = loops[0];
  if(newell(P) < 0) P = P.slice().reverse(); // против часовой вокруг n
  const m = P.length;
  const ins = [];
  for(let i=0;i<m;i++){
    const e = new THREE.Vector3().subVectors(P[(i+1)%m], P[i]);
    ins.push(e.length() < 1e-9 ? null : new THREE.Vector3().crossVectors(n, e.normalize()));
  }
  const miter = [];
  for(let i=0;i<m;i++){
    let a = ins[(i-1+m)%m], b = ins[i];
    if(!a) a = b; if(!b) b = a;
    if(!a) throw new Error('degenerate outline');
    const bis = a.clone().add(b);
    if(bis.length() < 1e-6) throw new Error('the outline turns back on itself');
    bis.normalize();
    const c = bis.dot(a);
    if(c < 0.35) throw new Error('the outline has a corner sharper than 40° — too sharp to bevel');
    miter.push(bis.multiplyScalar(size / c));
  }
  const I = P.map((p, i) => p.clone().add(miter[i]));
  // 2D в плоскости грани
  const u = (Math.abs(n.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(n).normalize();
  const v = n.clone().cross(u);
  const to2 = X => [X.dot(u), X.dot(v)];
  const P2 = P.map(to2), I2 = I.map(to2);
  const inPoly = (poly, [x, y]) => {
    let inside = false;
    for(let i=0, j=poly.length-1; i<poly.length; j=i++){
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi) + xi) inside = !inside;
    }
    return inside;
  };
  // отступ не должен пересекать себя и внутренние контуры (отверстия)
  for(let i=0;i<m;i++) if(new THREE.Vector3().subVectors(I[(i+1)%m], I[i]).dot(new THREE.Vector3().subVectors(P[(i+1)%m], P[i])) < 0)
    throw new Error('size ' + size + ' mm is bigger than the rounded corners of the outline');
  for(const H of loops.slice(1)) for(const q of H) if(!inPoly(I2, to2(q)))
    throw new Error('size ' + size + ' mm reaches a hole in the face');
  // стенки у контура: перпендикулярны и не ниже size
  const outlineKeys = new Map(P.map((p, i) => [K(p), i]));
  const inPatch = new Set(patch.tris);
  const depth = new Array(m).fill(0);
  for(let t=0;t<pos.length/9;t++){
    if(inPatch.has(t)) continue;
    let hit = -1;
    for(let j=0;j<3;j++){ const i = outlineKeys.get(Kp(pos, t*9+j*3)); if(i !== undefined) hit = i; }
    if(hit < 0) continue;
    const tn = triNormalAt(t);
    if(tn.lengthSq() < 1e-12) continue;
    if(Math.abs(tn.dot(n)) > 0.02) throw new Error('the walls along the outline are not perpendicular to the face');
    for(let j=0;j<3;j++){
      const i = outlineKeys.get(Kp(pos, t*9+j*3));
      if(i === undefined) continue;
      for(let jj=0;jj<3;jj++){
        const dd = -new THREE.Vector3().fromArray(pos, t*9+jj*3).sub(P[i]).dot(n);
        if(dd > depth[i]) depth[i] = dd;
      }
    }
  }
  if(depth.some(d => d < size + 0.05)) throw new Error('size ' + size + ' mm is taller than the walls along the outline');
  const v0 = meshVolumeOf(pos);
  pushUndo();
  // 1) врезать контур отступа в грань
  for(let i=0;i<m;i++){
    const a = I[i], b = I[(i+1)%m];
    if(a.distanceTo(b) > 1e-6) splitMeshByChord(a, b, 'segment');
  }
  cleanupMesh();
  pos = mesh.geometry.attributes.position.array;
  // 2) полоса грани между краем и отступом — снять
  const onPlane = o => Math.abs(n.x*pos[o]+n.y*pos[o+1]+n.z*pos[o+2] - d0) < 0.02;
  const strip = new Set(), inner = [];
  for(let t=0;t<pos.length/9;t++){
    const o = t*9;
    if(!onPlane(o) || !onPlane(o+3) || !onPlane(o+6) || triNormalAt(t).dot(n) < 0.99) continue;
    const c = new THREE.Vector3((pos[o]+pos[o+3]+pos[o+6])/3, (pos[o+1]+pos[o+4]+pos[o+7])/3, (pos[o+2]+pos[o+5]+pos[o+8])/3);
    const c2 = to2(c);
    if(!inPoly(P2, c2)) continue;
    if(inPoly(I2, c2)) inner.push(t); else strip.add(t);
  }
  // внутренний край оставшейся грани — точки врезки на контуре отступа
  const onInset = r => {
    const mid = r.a.clone().add(r.b).multiplyScalar(0.5);
    for(let i=0;i<m;i++){
      const a = I[i], ab = new THREE.Vector3().subVectors(I[(i+1)%m], a), L2 = ab.lengthSq();
      if(L2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(mid, a).dot(ab) / L2));
      if(a.clone().addScaledVector(ab, t).distanceTo(mid) < 0.01) return true;
    }
    return false;
  };
  const innerLoops = chainLoops(inner, pos, onInset);
  if(innerLoops.length !== 1){ undo(true); throw new Error('the inset outline did not cut cleanly into the face'); }
  let Q = innerLoops[0];
  if(newell(Q) < 0) Q = Q.slice().reverse();
  // положение точки врезки вдоль контура отступа: индекс отрезка + доля
  const paramI = X => {
    let best = 0, bd = Infinity;
    for(let i=0;i<m;i++){
      const a = I[i], ab = new THREE.Vector3().subVectors(I[(i+1)%m], a), L2 = ab.lengthSq();
      const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, new THREE.Vector3().subVectors(X, a).dot(ab) / L2));
      const dd = a.clone().addScaledVector(ab, t).distanceTo(X);
      if(dd < bd){ bd = dd; best = i + t; }
    }
    return best;
  };
  // 3) профиль: кольцо k (0 — в стенке, segs — в грани) в точках контура
  const prof = (i, k) => {
    const phi = k / segs * Math.PI / 2;
    const a = segs === 1 ? k : 1 - Math.cos(phi), b = segs === 1 ? 1 - k : 1 - Math.sin(phi);
    return P[i].clone().addScaledVector(miter[i], a).addScaledVector(n, -size * b);
  };
  const out = [];
  for(let t=0;t<pos.length/9;t++) if(!strip.has(t)) for(let j=0;j<9;j++) out.push(pos[t*9+j]);
  // край стенок — вниз на size (только вершины контура в стенках)
  for(let o=0;o<out.length;o+=3){
    const i = outlineKeys.get(keyOf(out[o], out[o+1], out[o+2]));
    if(i === undefined) continue;
    const Wp = prof(i, 0);
    out[o] = Wp.x; out[o+1] = Wp.y; out[o+2] = Wp.z;
  }
  const band = [];
  for(let k=0;k<segs-1;k++) for(let i=0;i<m;i++){
    const j = (i+1) % m;
    band.push([prof(i, k), prof(j, k), prof(j, k+1)], [prof(i, k), prof(j, k+1), prof(i, k+1)]);
  }
  // последняя полоса — «молния» между кольцом segs-1 и точками врезки
  const last = [];
  for(let i=0;i<=m;i++) last.push({p: prof(i % m, segs - 1), s: i});
  const qs = Q.map(p => ({p, s: paramI(p)}));
  let q0 = 0;
  for(let k=1;k<qs.length;k++) if(Math.min(qs[k].s, m - qs[k].s) < Math.min(qs[q0].s, m - qs[q0].s)) q0 = k;
  const qz = qs.slice(q0).concat(qs.slice(0, q0)).map(x => ({p: x.p, s: x.s}));
  if(qz[0].s > m / 2) qz[0].s -= m;
  for(let k=1;k<qz.length;k++) while(qz[k].s < qz[k-1].s - m / 2) qz[k].s += m;
  qz.push({p: qz[0].p, s: qz[0].s + m});
  let a = 0, b = 0;
  while(a < last.length - 1 || b < qz.length - 1){
    const na = a < last.length - 1 ? last[a+1].s : Infinity, nb = b < qz.length - 1 ? qz[b+1].s : Infinity;
    if(na <= nb){ band.push([last[a].p, last[a+1].p, qz[b].p]); a++; }
    else { band.push([last[a].p, qz[b+1].p, qz[b].p]); b++; }
  }
  // ориентация полос — наружу: от внутренней точки профиля в тело
  const tb = band.find(t => new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).lengthSq() > 1e-12) || band[0];
  const bn = new THREE.Vector3().subVectors(tb[1], tb[0]).cross(new THREE.Vector3().subVectors(tb[2], tb[0]));
  const bodyward = n.clone().negate().add(ins[0] || ins.find(Boolean)); // внутрь тела у края: вниз и внутрь
  const flip = bn.dot(bodyward) > 0;
  for(const [A, B, C] of band){
    const q = flip ? [A, C, B] : [A, B, C];
    for(const X of q) out.push(X.x, X.y, X.z);
  }
  setMeshFromArray(new Float32Array(out));
  cleanupMesh();
  hidePatch(); ppPatch = null; clearEdgeSel(); deselect(); cachedPatch = null;
  if(!modified){ modified = true; s_mod.textContent = 'yes'; }
  extractEdges();
  const dv = meshVolumeOf(mesh.geometry.attributes.position.array) - v0;
  if(dv >= 0 || openEdgeCount() > 0 || nonManifoldEdgeCount() > 0){ undo(true); throw new Error('the bevel did not close the body here'); }
  return {outline_points: m, volume_change_mm3: +dv.toFixed(3)};
}
// Нарисованные линии, которые после выреза или фаски повисли в воздухе
// (контур круга над снятой фаской): середина и концы не лежат на сетке.
// Линии на земле (z = 0) — законное построение, их не трогаем
function dropAirGuides(){
  const pos = mesh.geometry.attributes.position.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tri = new THREE.Triangle(), q = new THREE.Vector3();
  const box = new THREE.Box3();
  const onMesh = P => {
    for(let o=0;o<pos.length;o+=9){
      a.fromArray(pos, o); b.fromArray(pos, o+3); c.fromArray(pos, o+6);
      box.makeEmpty(); box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c);
      if(box.distanceToPoint(P) > 0.02) continue;
      tri.set(a, b, c);
      if(tri.closestPointToPoint(P, q).distanceTo(P) < 0.02) return true;
    }
    return false;
  };
  let dropped = 0;
  for(let i=guides.length-1;i>=0;i--){
    const g = guides[i];
    if(Math.abs(g.a.z) < 0.01 && Math.abs(g.b.z) < 0.01) continue;
    const mid = g.a.clone().add(g.b).multiplyScalar(0.5);
    if(onMesh(mid) && onMesh(g.a) && onMesh(g.b)) continue;
    scene.remove(g.line); g.line.geometry.dispose();
    guides.splice(i, 1); dropped++;
  }
  if(dropped) extractEdges();
  return dropped;
}
// Фаска/скругление контуров грани — общая для Ctrl+B по грани и MCP
// bevel_outline. Внешний контур — сначала хирургия без булевых
// (zcBevelFaceLoop), края отверстий и всё, что она не берёт, — точной булевой
function bevelFaceOutlines(tri, size, segs, which){
  cachedPatch = null;
  if(which === 'outer'){
    try{ return zcBevelFaceLoop(tri, size, segs); }
    catch(err){
      // ошибки размера — ответ; прочие ограничения хирургии — к булевой
      if(/sharper|bigger than|taller|no closed outline/.test(err.message)) throw err;
      cachedPatch = null;
    }
  }
  return zcBevelLoopsCSG(tri, size, segs, which);
}
// Сквозной вырез области точной булевой (Through All во Fusion): призма
// лоскута от 1 мм над гранью до выхода за тело по -n. В отличие от
// zcCutThrough не нужна параллельная обратная грань, а область может быть с
// отверстиями; тот остаётся запасным путём
function zcCutThroughCSG(tri){
  const pos = mesh.geometry.attributes.position.array;
  const n = triNormalAt(tri).clone().normalize();
  const patch = facePatchCached(tri);
  const d0 = n.dot(new THREE.Vector3().fromArray(pos, tri*9));
  let dmin = 0;
  for(let i=0;i<pos.length;i+=3) dmin = Math.min(dmin, n.x*pos[i] + n.y*pos[i+1] + n.z*pos[i+2] - d0);
  if(dmin > -0.01) throw new Error('nothing below this region to cut through');
  const prism = buildPatchPrismRange(pos, patch.tris, n, dmin - 1, 1);
  const r = zcApplySolid(prism, 'cut', false);
  if(!(r.volume_change_mm3 < 0)){ undo(true); throw new Error('cut through removed nothing here'); }
  if(r.open_edges || r.nonmanifold_edges){ undo(true); throw new Error('cut through did not close the body here'); }
  delete r.solid_volume_mm3;
  dropAirGuides(); r.lines = guides.length;
  return Object.assign({face_area_mm2: +patch.area.toFixed(3)}, r);
}
// Фаска/скругление контуров грани точной булевой: вдоль каждого контура
// вычитается кольцевое тело, сечение которого — профиль (от стенки на
// глубине size до отступа size в грани) плюс запас над гранью и снаружи
// стенки. Годится и для краёв отверстий (bevel по дырам сыра), которые
// zcBevelFaceLoop не трогает. Контуры — из направленных граничных рёбер
// лоскута: треугольники против часовой вокруг n, область слева от ребра,
// внутрь грани — n × ребро и у внешнего контура, и у отверстий
function zcBevelLoopsCSG(tri, size, segs, which){
  const pos = mesh.geometry.attributes.position.array;
  const n = triNormalAt(tri).clone().normalize();
  const patch = facePatchCached(tri);
  const Kp = o => keyOf(pos[o], pos[o+1], pos[o+2]);
  const cnt = new Map();
  for(const t of patch.tris) for(let e=0;e<3;e++){
    const o1 = t*9+e*3, o2 = t*9+((e+1)%3)*3, k1 = Kp(o1), k2 = Kp(o2);
    if(k1 === k2) continue;
    const ek = k1 < k2 ? k1+'|'+k2 : k2+'|'+k1, r = cnt.get(ek);
    if(r) r.c++; else cnt.set(ek, {c: 1, ka: k1, kb: k2, a: new THREE.Vector3().fromArray(pos, o1)});
  }
  const next = new Map();
  for(const r of cnt.values()) if(r.c === 1) next.set(r.ka, r);
  const loops = [], used = new Set();
  for(const [k0] of next){
    if(used.has(k0)) continue;
    const L = []; let k = k0, guard = next.size + 2;
    while(guard-- > 0 && !used.has(k)){ const r = next.get(k); if(!r) break; used.add(k); L.push(r.a); k = r.kb; }
    if(k === k0 && L.length >= 3) loops.push(L);
  }
  if(!loops.length) throw new Error('the face region has no closed outline');
  const area = L => { const w = new THREE.Vector3();
    for(let i=0;i<L.length;i++){ const p = L[i], q = L[(i+1)%L.length];
      w.x += (p.y-q.y)*(p.z+q.z); w.y += (p.z-q.z)*(p.x+q.x); w.z += (p.x-q.x)*(p.y+q.y); }
    return w.dot(n) / 2; };
  const outer = loops.filter(L => area(L) > 0).sort((a, b) => area(b) - area(a))[0];
  const pick = loops.filter(L => which === 'all' || (which === 'holes' ? area(L) < 0 : L === outer));
  if(!pick.length) throw new Error(which === 'holes' ? 'this face has no holes' : 'the face region has no outer outline');
  // контуры не должны сойтись ближе двух размеров: кольца наложатся
  const segDist = (p, a, b) => { const ab = new THREE.Vector3().subVectors(b, a), L2 = ab.lengthSq();
    const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / L2));
    return a.clone().addScaledVector(ab, t).distanceTo(p); };
  for(const A of pick) for(const B of loops){
    if(A === B) continue;
    for(const p of A) for(let j=0;j<B.length;j++)
      if(segDist(p, B[j], B[(j+1)%B.length]) < 2*size + 0.05) throw new Error('size ' + size + ' mm reaches another outline of the face');
  }
  const eUp = Math.max(0.5, size * 0.5);
  const ring = [];
  // лишние точки контура (Т-стыки от разбиения граней лежат на прямых
  // участках: у отверстия Ø6 после выреза было 133 точки вместо 48) дают
  // короткие шумные отрезки — биссектрисы гуляют, кольцо пересекает себя
  const simplify = L => {
    let pts = L.slice();
    for(let changed = true; changed && pts.length > 3;){
      changed = false;
      for(let i=0;i<pts.length && pts.length > 3;i++){
        const a = pts[(i-1+pts.length)%pts.length], b = pts[i], c = pts[(i+1)%pts.length];
        const ac = new THREE.Vector3().subVectors(c, a), L2 = ac.lengthSq();
        const off = L2 < 1e-12 ? 0 : new THREE.Vector3().subVectors(b, a).cross(ac).length() / Math.sqrt(L2);
        // только точки на прямой в пределах допуска булевой: сдвиг настоящей
        // вершины уводит кольцо из плоскости стенки — щепки и протечки
        if(off < 1e-5){ pts.splice(i, 1); changed = true; i--; }
      }
    }
    return pts;
  };
  for(const P0 of pick){
    const P = simplify(P0);
    const m = P.length;
    // направления сторон у вершины — до соседей не ближе 0.05 мм: микроотрезок
    // рядом с вершиной (точка врезки в 5 мкм от неё) крутит биссектрису, и
    // фаска у отверстия Ø6 недобирала 2–7 % объёма
    const far = (i, step) => { for(let g=1, j=i; g<m; g++){ j = (j + step + m) % m; if(P[j].distanceTo(P[i]) >= 0.05) return P[j]; } return P[(i + step + m) % m]; };
    const miter = [];
    for(let i=0;i<m;i++){
      const ea = new THREE.Vector3().subVectors(P[i], far(i, -1)), eb = new THREE.Vector3().subVectors(far(i, 1), P[i]);
      if(ea.length() < 1e-9 || eb.length() < 1e-9) throw new Error('degenerate outline');
      const a = new THREE.Vector3().crossVectors(n, ea.normalize()), b = new THREE.Vector3().crossVectors(n, eb.normalize());
      const bis = a.clone().add(b);
      if(bis.length() < 1e-6) throw new Error('the outline turns back on itself');
      bis.normalize();
      const c = bis.dot(a);
      if(c < 0.35) throw new Error('the outline has a corner sharper than 40° — too sharp to bevel');
      miter.push(bis.multiplyScalar(size / c));
    }
    const reversed = f => { for(let i=0;i<m;i++){ const j = (i+1)%m; // микроотрезки — шум, не разворот
      if(P[j].distanceTo(P[i]) < 0.05) continue;
      if(new THREE.Vector3().subVectors(f(j), f(i)).dot(new THREE.Vector3().subVectors(P[j], P[i])) < 0) return true; } return false; };
    if(reversed(i => P[i].clone().add(miter[i]))) throw new Error('size ' + size + ' mm is bigger than the rounded corners of the outline');
    // запас наружу стенки: у маленького отверстия кольцо не должно перейти ось
    let eOut = Math.min(0.5, size * 0.5);
    for(let g=0; g<4 && reversed(i => P[i].clone().addScaledVector(miter[i], -eOut / size)); g++) eOut /= 2;
    if(eOut < 0.1 || reversed(i => P[i].clone().addScaledVector(miter[i], -eOut / size)))
      throw new Error('the hole is too small to bevel');
    const prof = (i, k) => {
      const phi = k / segs * Math.PI / 2;
      const a = segs === 1 ? k : 1 - Math.cos(phi), b = segs === 1 ? 1 - k : 1 - Math.sin(phi);
      return P[i].clone().addScaledVector(miter[i], a).addScaledVector(n, -size * b);
    };
    // Концы профиля чуть продлены за стенку и над гранью: кольцо пересекает
    // их поперёк, а не касается ребром в самой плоскости (после прошлой
    // булевой точки контура отходят от прямой на ~2e-5 — ровно на допуске,
    // и шов у стенки протекал). У фаски — вдоль её же прямой (геометрия та
    // же), у скругления, которое подходит к стенке и грани по касательной, —
    // сдвиг на 2 мкм наружу
    const dC = 0.05, dR = 0.002;
    const sec = i => {
      const S = [];
      for(let k=0;k<=segs;k++) S.push(prof(i, k));
      const mh = miter[i].clone().normalize();
      if(segs === 1){
        const dir = new THREE.Vector3().subVectors(S[1], S[0]).normalize();
        S[0].addScaledVector(dir, -dC); S[1].addScaledVector(dir, dC);
      } else {
        S[0].addScaledVector(mh, -dR); S[segs].addScaledVector(n, dR);
      }
      const O = P[i].clone().addScaledVector(miter[i], -eOut / size);
      S.push(S[segs].clone().addScaledVector(n, eUp), O.clone().addScaledVector(n, eUp), O.clone().addScaledVector(n, -size - dC));
      return S;
    };
    const secs = P.map((_, i) => sec(i));
    for(let i=0;i<m;i++){
      const A = secs[i], B = secs[(i+1)%m], s = A.length;
      for(let j=0;j<s;j++){ const jj = (j+1)%s; ring.push([A[j], A[jj], B[jj]], [A[j], B[jj], B[j]]); }
    }
  }
  // обход колец — по знаку объёма каждого по отдельности не нужен: все
  // сечения построены одинаково, zcApplySolid разворачивает целиком
  const r = zcApplySolid(ring, 'cut', false);
  if(!(r.volume_change_mm3 < 0)){ undo(true); throw new Error('the bevel removed nothing here'); }
  if(r.open_edges || r.nonmanifold_edges){ undo(true); throw new Error('the bevel did not close the body here'); }
  delete r.solid_volume_mm3;
  dropAirGuides(); r.lines = guides.length;
  return Object.assign({outlines: pick.length, outline_points: pick.reduce((s, L) => s + L.length, 0)}, r);
}
// Реализация команд агента. Схема (описания и параметры) — в tools.js;
// здесь только `run` и флаг `image`, имена обязаны совпадать.
const ZC_COMMANDS = {
  get_state: {
    run: () => zcSummary()
  },
  new_shape: {
    async run(a){
      const kind = a.shape === 'gear' ? 'wheel' : a.shape;
      if(!['cube', 'wheel', 'sphere', 'pyramid'].includes(kind)) throw new Error('unknown shape ' + a.shape);
      const radio = document.querySelector('input[name=shape][value="' + kind + '"]');
      radio.checked = true; applyShapePreset(); applyShapeUI();
      if(a.size != null){
        const dia = document.getElementById('dia');
        dia.value = Math.max(+dia.min, Math.min(+dia.max, +a.size));
      }
      closeStartScreen();
      await rebuild();
      return zcSummary();
    }
  },
  draw_line: {
    run(a){
      const A = zcV3(a.from, 'from'), B = zcV3(a.to, 'to');
      const onFace = segmentOnSomeFace(A, B);
      const chain = lineChain;
      lineChain = false; setLineMode(true); lineStartN = null;
      try{ commitLinePoint(A); commitLinePoint(B); }
      finally{ if(lineMode) setLineMode(false); closeLinePopup(); lineChain = chain; }
      return Object.assign({cuts_face: onFace}, zcSummary());
    }
  },
  draw_circle: {
    run(a){
      const R = +a.radius;
      if(!(R >= 0.3)) throw new Error('radius must be at least 0.3 mm');
      const n = zcV3(a.normal, 'normal');
      if(n.length() < 1e-9) throw new Error('normal must not be zero');
      circleCenter = zcV3(a.center, 'center'); circlePlane = n.normalize(); circleR = R;
      circ_seg.value = a.segments ? Math.max(3, Math.min(360, Math.round(+a.segments))) : autoCircSegs(R);
      commitCircle();
      return zcSummary();
    }
  },
  extrude_face: {
    run(a){
      const d = +a.distance;
      if(!Number.isFinite(d) || Math.abs(d) < 0.05) throw new Error('distance must be a number of mm');
      const t = zcFaceAt(zcV3(a.point, 'point'), a.normal ? zcV3(a.normal, 'normal').normalize() : null);
      if(t < 0) throw new Error('no face at this point');
      const k = a.end_scale == null ? 1 : +a.end_scale;
      if(!(k >= 0.05 && k <= 5)) throw new Error('end_scale must be between 0.05 and 5');
      const v0 = meshVolumeOf(mesh.geometry.attributes.position.array);
      clearEdgeSel(); deselect();
      ppParts = null; ppPatch = facePatchCached(t);
      const area = ppPatch.area;
      openExtrude();
      ex_val.value = snapMM(d);
      exOpManual = a.operation === 'join' || a.operation === 'cut' ? a.operation : null;
      exLive.taper = k; ex_taper.value = Math.round(k * 100); // End size окна
      applyExtrudeLive(snapMM(d));
      const v1 = undoStack.length;
      commitExtrude();
      if(Math.abs(k - 1) > 1e-6 && !exLive && undoStack.length < v1){ releaseToolInput(); throw new Error('extrude with end_scale failed here (nothing to ' + (d < 0 ? 'cut' : 'add') + ', or the solid did not close)'); }
      if(exLive){ closeExtrude(); throw new Error('nothing to ' + (exOp() === 'cut' ? 'cut' : 'add') + ' here'); }
      releaseToolInput();
      return Object.assign({face_area_mm2: +area.toFixed(3),
        volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3)}, zcSummary());
    }
  },
  cut_through: {
    run(a){
      const t = zcFaceAt(zcV3(a.point, 'point'), a.normal ? zcV3(a.normal, 'normal').normalize() : null);
      if(t < 0) throw new Error('no face at this point');
      cachedPatch = null;
      try{ return zcCutThroughCSG(t); }
      catch(err){
        if(/nothing below/.test(err.message)) throw err;
        cachedPatch = null;
        return zcCutThrough(t); // запасной путь: хирургия без булевых
      }
    }
  },
  add_text: {
    run(a){
      const n = zcV3(a.normal, 'normal');
      if(n.length() < 1e-9) throw new Error('normal must not be zero');
      n.normalize();
      const C = zcV3(a.center, 'center');
      if(zcFaceAt(C, n) < 0) throw new Error('no face with this normal at the centre point');
      const str = String(a.text || '').toUpperCase();
      if(![...str].some(ch => FONT57[ch] && ch !== ' ')) throw new Error('no printable letters (A–Z, 0–9)');
      const h = Math.max(3, +a.height || 10), d = snapMM(+a.depth || 0);
      textParams = {str, h, d};
      const v0 = meshVolumeOf(mesh.geometry.attributes.position.array), u0 = undoStack.length;
      placeTextAt(txLeftFromAnchor(C, n, textParams), n);
      if(undoStack.length === u0 || (d !== 0 && Math.abs(meshVolumeOf(mesh.geometry.attributes.position.array) - v0) < 1e-6))
        throw new Error('text could not be placed here');
      const cells = textCellsFine(str).size, s = h / 14;
      return Object.assign({letter_area_mm2: +(cells * s * s).toFixed(3), text_width_mm: +textWidth(textParams).toFixed(3),
        volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3)}, zcSummary());
    }
  },
  export_stl: {
    run(a){
      const buf = new Uint8Array(buildSTL());
      let bin = '';
      for(let i=0;i<buf.length;i+=0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const st = zcSummary();
      return Object.assign({stl_base64: btoa(bin), name: String(a.name || projectName || 'zerocad'), bytes: buf.length}, st);
    }
  },
  bevel_edges: {
    run(a){
      if(!Array.isArray(a.points) || !a.points.length) throw new Error('points must list at least one point on an edge');
      const size = +a.size;
      if(!(size >= 0.1)) throw new Error('size must be at least 0.1 mm');
      const segs = Math.max(1, Math.min(32, Math.round(a.segments == null ? 8 : +a.segments)));
      const found = [], info = [];
      a.points.forEach((pt, i) => {
        const P = zcV3(pt, 'points[' + i + ']');
        // ребро тела, на котором лежит точка (ближайший отрезок цепочки, ≤ 0.05 мм)
        let best = null, bd = 0.05, second = Infinity;
        for(const ch of chains){
          if(ch.isGuide || ch.closed) continue;
          let d = Infinity;
          for(let k=0;k+1<ch.pts.length;k++){
            const A = ch.pts[k], ab = new THREE.Vector3().subVectors(ch.pts[k+1], A), L2 = ab.lengthSq();
            if(L2 < 1e-12) continue;
            const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(P, A).dot(ab) / L2));
            d = Math.min(d, A.clone().addScaledVector(ab, t).distanceTo(P));
          }
          if(d < bd){ second = bd; bd = d; best = ch; }
          else if(d < second) second = d;
        }
        if(!best) throw new Error('no edge of the body at points[' + i + ']');
        if(second < 0.05 && second - bd < 1e-6) throw new Error('points[' + i + '] is at a corner — pick a point along the edge');
        if(found.some(f => f.ch === best)) return; // то же ребро дважды
        const ed = analyzeBevelEdge(best.pts);
        if(ed.err) throw new Error('points[' + i + ']: ' + ed.err);
        // отступ должен уместиться на обеих гранях: размер 60 на кубе 40 молча
        // срезал полкуба. Точка середины ребра, сдвинутая на size в глубь каждой
        // грани, обязана остаться на этой грани
        const M = ed.A.clone().lerp(ed.B, 0.5);
        for(const [t, n] of [[ed.t1, ed.n1], [ed.t2, ed.n2]])
          if(zcFaceAt(M.clone().addScaledVector(t, size), n) < 0)
            throw new Error('points[' + i + ']: size ' + size + ' mm does not fit on the faces of this edge');
        found.push({ch: best, ed});
        const deg = ed.alpha * 180 / Math.PI;
        info.push(segs === 1
          ? {edge_length_mm: +ed.L.toFixed(3), angle_deg: +deg.toFixed(2), chamfer_face_width_mm: +(2 * size * Math.sin(ed.alpha / 2)).toFixed(3)}
          : {edge_length_mm: +ed.L.toFixed(3), angle_deg: +deg.toFixed(2), radius_mm: +(size * Math.tan(ed.alpha / 2)).toFixed(3)});
      });
      if(activeTool) setActiveTool(null);
      clearEdgeSel(); deselect(); hidePatch(); ppPatch = null;
      const v0 = meshVolumeOf(mesh.geometry.attributes.position.array), u0 = undoStack.length;
      bevelTool.edges = found.map(f => f.ed); bevelTool.face = -1;
      bev_d.value = size; bev_s.value = segs;
      setActiveTool(bevelTool);  // on(): снимок и предпросмотр по полям окна
      bevelTool.commit();         // одна запись истории на все рёбра
      if(activeTool === bevelTool){ setActiveTool(null); throw new Error('bevel failed with these values (too big for the faces?)'); }
      if(undoStack.length === u0) throw new Error('bevel did not change the body');
      return Object.assign({kind: segs === 1 ? 'chamfer' : 'round', edges: info,
        volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3)}, zcSummary());
    }
  },
  bevel_outline: {
    run(a){
      const size = +a.size;
      if(!(size >= 0.1)) throw new Error('size must be at least 0.1 mm');
      const segs = Math.max(1, Math.min(32, Math.round(a.segments == null ? 1 : +a.segments)));
      const t = zcFaceAt(zcV3(a.point, 'point'), a.normal ? zcV3(a.normal, 'normal').normalize() : null);
      if(t < 0) throw new Error('no face at this point');
      if(activeTool) setActiveTool(null);
      const which = a.outlines || 'outer';
      if(!['outer', 'holes', 'all'].includes(which)) throw new Error('outlines must be outer, holes or all');
      return Object.assign({kind: segs === 1 ? 'chamfer' : 'round'}, bevelFaceOutlines(t, size, segs, which), zcSummary());
    }
  },
  undo: {
    run(){ if(!undoStack.length) throw new Error('nothing to undo'); undo(); return zcSummary(); }
  },
  cut_plane: {
    // тот же срез, что G,S в редакторе (applySlice)
    run(a){
      const P = zcV3(a.point, 'point'), n = zcV3(a.normal, 'normal');
      if(n.length() < 1e-9) throw new Error('normal must not be zero');
      n.normalize();
      const dv = applySlice(P, n);
      return Object.assign({volume_change_mm3: +dv.toFixed(3)}, zcSummary());
    }
  },
  add_frustum: {
    run(a){
      const A = zcV3(a.from, 'from'), B = zcV3(a.to, 'to');
      const r1 = +a.r1, r2 = +a.r2, op = a.operation || 'join';
      if(!(r1 >= 0) || !(r2 >= 0) || r1 + r2 < 0.1) throw new Error('radii must be ≥ 0 mm, not both zero');
      if(A.distanceTo(B) < 0.1) throw new Error('from and to must be at least 0.1 mm apart');
      const seg = Math.max(3, Math.min(256, Math.round(+a.segments || 48)));
      return zcApplySolid(frustumTris(A, B, r1, r2, seg), op); // тот же построитель, что G,U
    }
  },
  add_revolve: {
    run(a){
      const B = a.base ? zcV3(a.base, 'base') : new THREE.Vector3();
      const ax = a.axis ? zcV3(a.axis, 'axis') : new THREE.Vector3(0,0,1);
      if(ax.length() < 1e-9) throw new Error('axis must not be zero');
      ax.normalize();
      const seg = Math.max(3, Math.min(256, Math.round(+a.segments || 64)));
      if(!Array.isArray(a.profile)) throw new Error('profile must be [[r, h], ...]');
      const prof = [];
      for(const q of a.profile){
        if(!Array.isArray(q) || q.length !== 2 || !Number.isFinite(+q[0]) || !Number.isFinite(+q[1])) throw new Error('profile points must be [r, h]');
        const r = +q[0], h = +q[1];
        if(r < -1e-9) throw new Error('profile r must be ≥ 0');
        const last = prof[prof.length-1];
        if(last && Math.hypot(last[0]-r, last[1]-h) < 1e-4) continue;
        prof.push([Math.max(0, r), h]);
      }
      if(prof.length < 3) throw new Error('profile needs at least 3 distinct points');
      if(prof[0][0] > 1e-6 || prof[prof.length-1][0] > 1e-6) throw new Error('profile must start and end on the axis (r = 0) so the solid is closed');
      const u = (Math.abs(ax.z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).cross(ax).normalize();
      const v = ax.clone().cross(u);
      const rows = prof.map(([r, h]) => {
        const C = B.clone().addScaledVector(ax, h);
        if(r < 1e-6) return {pole: C};
        return {ring: Array.from({length: seg}, (_, i) => { const t = i / seg * Math.PI * 2;
          return C.clone().addScaledVector(u, r*Math.cos(t)).addScaledVector(v, r*Math.sin(t)); })};
      });
      const tris = [];
      for(let k=0;k+1<rows.length;k++){
        const A = rows[k], C = rows[k+1];
        if(A.pole && C.pole) throw new Error('profile runs along the axis between points ' + k + ' and ' + (k+1));
        for(let i=0;i<seg;i++){
          const j = (i+1) % seg;
          if(A.pole) tris.push([A.pole, C.ring[j], C.ring[i]]);
          else if(C.pole) tris.push([A.ring[i], A.ring[j], C.pole]);
          else { tris.push([A.ring[i], A.ring[j], C.ring[j]]); tris.push([A.ring[i], C.ring[j], C.ring[i]]); }
        }
      }
      return zcApplySolid(tris, a.operation || 'join');
    }
  },
  add_sweep: {
    run(a){
      if(!Array.isArray(a.path)) throw new Error('path must be [[x, y, z], ...]');
      const P = [], idx = [];
      a.path.forEach((q, k) => { const X = zcV3(q, 'path point'); if(P.length && P[P.length-1].distanceTo(X) < 1e-4) return; P.push(X); idx.push(k); });
      if(P.length < 2) throw new Error('path needs at least 2 distinct points');
      const per = (val, name) => {
        if(Array.isArray(val)){
          if(val.length !== a.path.length) throw new Error(name + ' array must have one value per path point');
          return idx.map(k => +val[k]);
        }
        return P.map(() => +val);
      };
      const R = per(a.radius, 'radius'), S = a.side_radius == null ? R : per(a.side_radius, 'side_radius');
      if([...R, ...S].some(x => !(x > 0))) throw new Error('radii must be > 0 mm');
      const seg = Math.max(3, Math.min(128, Math.round(+a.segments || 24)));
      const n = P.length, T = P.map((_, k) => new THREE.Vector3().subVectors(P[Math.min(n-1, k+1)], P[Math.max(0, k-1)]).normalize());
      const side = a.side ? zcV3(a.side, 'side') : (Math.abs(T[0].z) < 0.9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0));
      side.addScaledVector(T[0], -side.dot(T[0]));
      if(side.length() < 1e-6) throw new Error('side must not be parallel to the start of the path');
      side.normalize();
      const rings = [];
      for(let k=0;k<n;k++){
        if(k > 0){ // перенос без закрутки: поворот от прежней касательной к новой
          side.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(T[k-1], T[k]));
          side.addScaledVector(T[k], -side.dot(T[k])).normalize();
        }
        const up = new THREE.Vector3().crossVectors(T[k], side);
        rings.push(Array.from({length: seg}, (_, i) => { const t = i / seg * Math.PI * 2;
          return P[k].clone().addScaledVector(side, S[k]*Math.cos(t)).addScaledVector(up, R[k]*Math.sin(t)); }));
      }
      const tris = [];
      for(let k=0;k+1<n;k++) for(let i=0;i<seg;i++){
        const j = (i+1) % seg;
        tris.push([rings[k][i], rings[k][j], rings[k+1][j]]); tris.push([rings[k][i], rings[k+1][j], rings[k+1][i]]);
      }
      for(let i=0;i<seg;i++){
        const j = (i+1) % seg;
        tris.push([P[0], rings[0][j], rings[0][i]]); tris.push([P[n-1], rings[n-1][i], rings[n-1][j]]);
      }
      return zcApplySolid(tris, a.operation || 'join');
    }
  },
  shell_body: {
    // то же, что окно Shell (G,H): applyShell
    run(a){
      const t = +a.thickness;
      if(!(t >= 0.1)) throw new Error('thickness must be at least 0.1 mm');
      const tris = zcBodyAt(a.body_point), pos = mesh.geometry.attributes.position.array;
      const open = [];
      for(const f of (a.open_faces || [])){
        const P = zcV3(f.point, 'open face point'), n = f.normal ? zcV3(f.normal, 'open face normal').normalize() : null;
        const tri = zcFaceAt(P, n);
        if(tri < 0) throw new Error('no face at open face point ' + JSON.stringify(f.point));
        if(tris && !tris.includes(tri)) throw new Error('open face ' + JSON.stringify(f.point) + ' is not on the body');
        open.push(...coplanarFaceTris(pos, tri, tris));
      }
      return applyShell(tris, open, t);
    }
  },
  mirror_body: {
    // то же, что окно Mirror (G,I): applyBodyTransform с матрицей зеркала
    run(a){
      const n = zcV3(a.plane_normal, 'plane_normal');
      if(n.length() < 1e-9) throw new Error('plane_normal must not be zero');
      const mode = a.mode || 'join';
      if(mode !== 'join' && mode !== 'flip') throw new Error('mode must be join or flip');
      const r = applyBodyTransform(zcBodyAt(a.body_point), [mirrorMatrix(zcV3(a.plane_point, 'plane_point'), n.normalize())], mode === 'join');
      return Object.assign({boolean: lastBoolPath || 'none'}, r);
    }
  },
  transform_body: {
    // то же, что окно Move / Scale (G,B): перенос, масштаб, копии
    run(a){
      const tris = zcBodyAt(a.body_point), copies = Math.round(+a.copies || 0);
      if(copies < 0 || copies > 100) throw new Error('copies must be 0…100');
      const pos = mesh.geometry.attributes.position.array;
      if(a.move != null && a.scale != null) throw new Error('give move or scale, not both');
      let mats;
      if(a.move != null){
        const d = zcV3(a.move, 'move');
        if(d.length() < 1e-4) throw new Error('move must not be zero');
        mats = Array.from({length: Math.max(1, copies)}, (_, k) => new THREE.Matrix4().makeTranslation(d.x*(k+1), d.y*(k+1), d.z*(k+1)));
      } else if(a.scale != null){
        const s = Array.isArray(a.scale) ? zcV3(a.scale, 'scale') : new THREE.Vector3(+a.scale, +a.scale, +a.scale);
        if(![s.x, s.y, s.z].every(x => x > 0)) throw new Error('scale factors must be > 0');
        let C;
        if(a.pivot != null) C = zcV3(a.pivot, 'pivot');
        else { const b = bodyBox(pos, tris || Array.from({length: pos.length / 9}, (_, i) => i)); C = b.getCenter(new THREE.Vector3()); C.z = b.min.z; }
        if(copies > 1) throw new Error('scale makes at most one copy');
        mats = [scaleMatrix(C, s)];
      } else throw new Error('give move [dx, dy, dz] or scale');
      const r = applyBodyTransform(tris, mats, copies > 0);
      return Object.assign({boolean: lastBoolPath || 'none'}, r);
    }
  },
  loft_profiles: {
    // тот же построитель, что G,F в редакторе (loftLoopTris)
    run(a){
      const one = (v, name) => {
        if(!Array.isArray(v) || v.length < 3) throw new Error(name + ' must be [[x, y, z], ...] with at least 3 points');
        return profileFromLoop(v.map(q => zcV3(q, name + ' point'))).loop;
      };
      const tris = loftLoopTris(one(a.profile_a, 'profile_a'), one(a.profile_b, 'profile_b'));
      return applyProfileSolid(tris, a.operation || 'join', null);
    }
  },
  revolve_profile: {
    // тот же построитель, что G,O в редакторе (revolveLoopTris)
    run(a){
      if(!Array.isArray(a.profile) || a.profile.length < 3) throw new Error('profile must be [[x, y, z], ...] with at least 3 points');
      const prof = profileFromLoop(a.profile.map(q => zcV3(q, 'profile point')));
      const d = zcV3(a.axis_direction, 'axis_direction');
      if(d.length() < 1e-9) throw new Error('axis_direction must not be zero');
      const angle = a.angle == null ? 360 : +a.angle;
      if(!(Math.abs(angle) >= 0.1 && Math.abs(angle) <= 360)) throw new Error('angle must be 0.1…360 degrees, negative — the other way');
      const seg = Math.max(3, Math.min(256, Math.round(+a.segments || 64)));
      return applyProfileSolid(revolveLoopTris(prof.loop, zcV3(a.axis_point, 'axis_point'), d, angle, seg), a.operation || 'join', null);
    }
  },
  sweep_profile: {
    // тот же построитель, что G,W в редакторе (sweepLoopTris)
    run(a){
      if(!Array.isArray(a.profile) || a.profile.length < 3) throw new Error('profile must be [[x, y, z], ...] with at least 3 points');
      if(!Array.isArray(a.path) || a.path.length < 2) throw new Error('path must be [[x, y, z], ...] with at least 2 points');
      const prof = profileFromLoop(a.profile.map(q => zcV3(q, 'profile point')));
      const closed = !!a.closed;
      const pts = a.path.map(q => zcV3(q, 'path point')).filter((p, i, arr) => !i || p.distanceTo(arr[i-1]) > 1e-4);
      const path = orientPathToProfile({pts, closed}, prof.loop);
      return applyProfileSolid(sweepLoopTris(prof.loop, path.pts, path.closed), a.operation || 'join', null);
    }
  },
  move_edge: {
    // тот же сдвиг ребра, что M + Shift/N + число в окне: startEdgeMove,
    // ввод расстояния, finishEdgeMove (V-канавка — вырез клина точной булевой)
    run(a){
      const P = zcV3(a.point, 'point'), d = +a.distance;
      if(!Number.isFinite(d) || Math.abs(d) < 0.05) throw new Error('distance must be a number of mm');
      const near = (ch, Q) => ch.pts.some((B, i) => {
        if(!i) return false;
        const A = ch.pts[i-1], ab = new THREE.Vector3().subVectors(B, A), L2 = ab.lengthSq();
        if(L2 < 1e-12) return false;
        const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(Q, A).dot(ab) / L2));
        return A.clone().addScaledVector(ab, t).distanceTo(Q) < 0.05;
      });
      // нарисованная линия важнее ребра сетки под ней — как при клике
      const ch = chains.find(c => c.isGuide && near(c, P)) || chains.find(c => near(c, P));
      if(!ch) throw new Error('no line or edge at this point');
      if(edgeDrag) cancelEdgeMove();
      const v0 = meshVolumeOf(mesh.geometry.attributes.position.array), u0 = undoStack.length;
      clearEdgeSel(); toggleEdgeSel(ch);
      startEdgeMove();
      if(!edgeDrag) throw new Error('this line cannot be moved');
      if(!edgeDrag.normal){ cancelEdgeMove(); throw new Error('the line does not lie on a face — nothing to move it perpendicular to'); }
      const end = a.end || 'face';
      if(end !== 'face' && end !== 'straight'){ cancelEdgeMove(); throw new Error('end must be face or straight'); }
      edgeDrag.endMode = end;
      edgeDrag.nKey = true; edgeDrag.nLock = true;
      edgeDrag.mouseSign = d < 0 ? -1 : 1; edgeDrag.typed = String(Math.abs(d));
      applyEdgeTyped();
      finishEdgeMove();
      clearEdgeSel(); hideChordHint();
      return Object.assign({volume_change_mm3: +(meshVolumeOf(mesh.geometry.attributes.position.array) - v0).toFixed(3),
        history_steps: undoStack.length - u0}, zcSummary());
    }
  },
  screenshot: {
    image: true,
    run(a){
      if(a.yaw != null) yaw = +a.yaw * Math.PI / 180;
      if(a.pitch != null) pitch = Math.max(-1.5, Math.min(1.5, +a.pitch * Math.PI / 180));
      if(a.fit){
        const pos = mesh.geometry.attributes.position.array, box = new THREE.Box3();
        for(let i=0;i<pos.length;i+=3) box.expandByPoint(new THREE.Vector3(pos[i], pos[i+1], pos[i+2]));
        box.getCenter(camTarget);
        const r = box.getSize(new THREE.Vector3()).length() / 2;
        camDist = Math.max(20, Math.min(1200, r / Math.sin(persp.fov * Math.PI / 360) * 1.15));
      }
      // снимок своего размера: вкладка может быть узкой или фоновой (цикл стоит)
      const W = Math.max(200, Math.min(2000, Math.round(+a.width || 1000)));
      const H = Math.max(200, Math.min(2000, Math.round(+a.height || 700)));
      const pr = renderer.getPixelRatio();
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      persp.aspect = W / H; persp.updateProjectionMatrix();
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      persp.position.set(camTarget.x + camDist*cp*Math.cos(yaw), camTarget.y + camDist*cp*Math.sin(yaw), camTarget.z + camDist*sp);
      persp.lookAt(camTarget);
      renderViewport(persp, 0, 0, W, H, VIEW_GRIDS.persp);
      const data = renderer.domElement.toDataURL('image/jpeg', 0.88).split(',')[1];
      renderer.setPixelRatio(pr);
      resize(); // холст — обратно по размеру окна
      return {image: data, mime: 'image/jpeg'};
    }
  }
};
// Схема для MCP tools/list — из tools.js; здесь, в ZC_COMMANDS, только
// реализация. Два списка разошлись бы молча, поэтому источник один, а
// расхождение имён — сразу ошибка при загрузке (её видно в консоли вкладки).
function zcToolList(){
  return ZC_TOOLS;
}
(function checkToolRegistry(){
  const schema = ZC_TOOLS.map(t => t.name).sort(), impl = Object.keys(ZC_COMMANDS).sort();
  const missing = schema.filter(n => !ZC_COMMANDS[n]);
  const extra = impl.filter(n => !ZC_TOOLS.some(t => t.name === n));
  if(missing.length || extra.length)
    console.error('tools.js и ZC_COMMANDS разошлись:',
      missing.length ? 'нет реализации: ' + missing.join(', ') : '',
      extra.length ? 'нет схемы: ' + extra.join(', ') : '');
})();
// выполнить команду: один вызов — один шаг агента; метка «AI is drawing»
async function zcRun(name, args){
  const c = ZC_COMMANDS[name];
  if(!c) throw new Error('unknown command ' + name);
  zcAgentBadge(name);
  // открытый инструмент с предпросмотром (Slice, Bevel) при закрытии вернул бы
  // свой снимок и затёр изменение агента — закрываем его, как Esc; чтение
  // модели и снимок экрана инструмент не трогают
  if(activeTool && !['get_state', 'screenshot', 'export_stl'].includes(name)) setActiveTool(null);
  lastBoolPath = '';
  const res = await c.run(args || {});
  // каким путём прошли булевы инструментов: exact — точный, bsp — запасной
  if(lastBoolPath && res && typeof res === 'object' && !Array.isArray(res)) res.boolean = lastBoolPath;
  return res;
}
window.zc = {run: zcRun, tools: zcToolList}; // и для консоли разработчика
let zcBadgeT = 0;
function zcAgentBadge(name){
  let b = document.getElementById('zcAgent');
  if(!b){
    b = document.createElement('div'); b.id = 'zcAgent';
    b.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:9;padding:6px 14px;'
      + 'border-radius:8px;background:#1f2a1f;border:1px solid #2ecc40;color:#b8f5b8;font:600 15px system-ui;pointer-events:none';
    view.appendChild(b);
  }
  b.textContent = 'AI is drawing · ' + name;
  b.hidden = false;
  clearTimeout(zcBadgeT); zcBadgeT = setTimeout(() => { b.hidden = true; }, 2500);
}
// Agent link: страницу отдал наш сервер — слушаем его команды (SSE), ответ —
// POST. Без сервера (расширение, файл) модуль молчит, редактор тот же
if(HAS_SERVER && window.EventSource){
  // Своя метка вкладки: команды сервер шлёт только ведущей — той, что открыли
  // последней или в которую пользователь только что переключился. Без этого
  // две открытые вкладки выполняли одну команду агента обе, и вторая модель
  // менялась молча.
  const zcTab = Math.floor(Math.random() * 1e15) + 1;
  const es = new EventSource('/agent/events?tab=' + zcTab);
  es.addEventListener('open', () => {
    fetch('/agent/hello', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({build: window.ZC_BUILD, tools: zcToolList(), tab: zcTab})}).catch(() => {});
  });
  // смотрим на эту вкладку — значит, рисовать агент должен в ней
  window.addEventListener('focus', () => {
    fetch('/agent/lead', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tab: zcTab})}).catch(() => {});
  });
  es.addEventListener('command', async ev => {
    let msg;
    try{ msg = JSON.parse(ev.data); }catch(_){ return; }
    let out;
    try{
      const c = ZC_COMMANDS[msg.tool];
      const result = await zcRun(msg.tool, msg.args);
      out = {id: msg.id, ok: true, image: !!(c && c.image), result};
    }catch(err){
      out = {id: msg.id, ok: false, error: String(err && err.message || err)};
    }
    fetch('/agent/result', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(out)})
      .catch(() => {});
  });
}

resize();
(async ()=>{
  let restored = false;
  try{
    const txt = localStorage.getItem(AUTOSAVE_KEY);
    if(txt){
      const d = JSON.parse(txt);
      loadProjectData(d, d.name ? d.name + '.zcad' : null);
      restored = true;
    }
  }catch(err){ console.warn('autosave not restored', err); }
  if(!restored) await rebuild();
  autosaveArmed = true;
  openStartScreen();
})();
requestAnimationFrame(loop);
