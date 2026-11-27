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
// anchors: Float64Array [x,y,z…], …аргументы}. Ответ: {id, arr, ret} или
// {id, error}
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

onmessage = e => {
  const m = e.data;
  try{
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
    } else if(MESH_CALLS.includes(m.fn)){
      ret = self[m.fn]();
      arr = mesh.geometry.attributes.position.array;
    } else throw new Error('unknown geometry call ' + m.fn);
    postMessage({id: m.id, arr, ret}, [arr.buffer]);
  }catch(err){
    postMessage({id: m.id, error: String(err && err.message || err)});
  }
};
