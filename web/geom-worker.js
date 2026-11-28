// Фоновый поток ZeroCAD: то же ядро геометрии (geom.js), что на странице,
// только без страницы. Пока здесь считается булева с починкой, вкладка
// отвечает: крутится, рисует, принимает клики.
//
// geom.js работает с «текущей сеткой» через mesh и setMeshFromArray —
// здесь это лёгкая подмена: тот же путь к массиву, needsUpdate поднимает
// version, как у атрибута three.js. guides и anchors (концы линий и точки,
// которые чистка не стягивает) приходят вместе с задачей.
//
// Задача: {id, fn, pos: Float32Array, guides: Float64Array [ax,ay,az,bx,by,bz…],
// anchors: Float64Array [x,y,z…], engine: 'exact' | 'manifold', …аргументы}.
// Фаска (fn 'bevelRound'): job = {tools, corners: [{f: Float64Array, union}],
// orders: [[номера инструментов]…]} — bevelRoundCore из geom.js.
// Ответ: {id, arr, ret, engine} или {id, error}
importScripts('vendor/three.min.js', 'geom.js');

let mesh = null, guides = [], anchors = [];
function setMeshFromArray(f32){
  const attr = {array: f32, version: 0, set needsUpdate(v){ if(v) this.version++; }};
  mesh = {geometry: {attributes: {position: attr}}};
}
const V3 = (a, i) => new THREE.Vector3(a[i], a[i+1], a[i+2]);
// функции ядра, которые правят текущую сетку без аргументов
const MESH_CALLS = ['cleanupMesh', 'healTJunctions', 'healCracks', 'healAll', 'healAfterBool', 'tidySlivers',
  'collapseCollinearVertices', 'healCoplanarOverlaps', 'removeInvertedShells', 'openEdgeCount', 'nonManifoldEdgeCount'];

// задачи — строго по одной: загрузка Manifold ждёт, а общая сетка одна
let geomQueue = Promise.resolve();
onmessage = e => { geomQueue = geomQueue.then(() => geomTask(e.data)); };
async function geomTask(m){
  try{
    GEOM_BOOL_ENGINE = m.engine === 'manifold' ? 'manifold' : 'exact';
    if(GEOM_BOOL_ENGINE === 'manifold'){
      try{ await manifoldLoad(); }catch(err){ console.warn('Manifold did not load:', err && err.message || err); }
    }
    setMeshFromArray(m.pos);
    guides = [];
    for(let i=0;i<m.guides.length;i+=6) guides.push({a: V3(m.guides, i), b: V3(m.guides, i+3)});
    anchors = [];
    for(let i=0;i<m.anchors.length;i+=3) anchors.push({pos: V3(m.anchors, i)});
    let arr, ret;
    if(m.fn === 'solidBoolMesh'){
      const tris = [];
      for(let i=0;i<m.tris.length;i+=9) tris.push([V3(m.tris, i), V3(m.tris, i+3), V3(m.tris, i+6)]);
      arr = solidBoolMesh(m.pos, tris, m.op, m.round);
    } else if(m.fn === 'bevelRound'){
      // фаска: инструменты рёбер и углов — Float64 [x,y,z…] по 9 на треугольник
      const T = f => { const t = []; for(let i=0;i<f.length;i+=9) t.push([V3(f, i), V3(f, i+3), V3(f, i+6)]); return t; };
      const tools = m.job.tools.map(x => ({tris: T(x.f), union: x.union}));
      const corners = m.job.corners.map(x => ({tris: T(x.f), union: x.union}));
      const r = bevelRoundCore(m.pos, tools, corners, m.job.orders);
      if(r.needPage){ postMessage({id: m.id, ret: {needPage: true}, engine: geomLastEngine}); return; }
      arr = r.arr;
      if(arr === m.pos) arr = arr.slice();
      ret = {broken: r.broken, order: r.order};
    } else if(MESH_CALLS.includes(m.fn)){
      ret = self[m.fn]();
      arr = mesh.geometry.attributes.position.array;
    } else throw new Error('unknown geometry call ' + m.fn);
    postMessage({id: m.id, arr, ret, engine: geomLastEngine}, [arr.buffer]);
  }catch(err){
    postMessage({id: m.id, error: String(err && err.message || err)});
  }
}
