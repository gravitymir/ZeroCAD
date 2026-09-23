// Загрузка ядра геометрии для тестов без браузера: из web/app.js берутся
// нужные функции верхнего уровня (тот же код, что работает в редакторе, —
// не копия), вокруг — THREE из web/vendor и константы ключей вершин.
// Конец функции — строка из одной «}» в начале строки (так оформлен app.js)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const APP = process.env.ZC_APP || path.join(ROOT, 'web', 'app.js');

function extract(src, name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('function ' + name + ' not found in web/app.js');
  const end = src.indexOf('\n}\n', start);
  if(end < 0) throw new Error('end of function ' + name + ' not found');
  return src.slice(start + 1, end + 3);
}

// names: функции app.js, которые нужны тесту (зависимости перечислять тоже)
function loadCore(names){
  const src = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
  // Uint8Array/DataView/TextEncoder нужны писателям файлов (GLB), ZC_BUILD —
  // подпись в их заголовке
  const ctx = {console, Math, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
    ArrayBuffer, DataView, TextEncoder, TextDecoder, Map, Set, Array, Number, JSON, Infinity, Error,
    Object, isFinite, ZC_BUILD: 'test'};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web', 'vendor', 'three.min.js'), 'utf8'), ctx);
  if(!ctx.THREE) throw new Error('THREE did not load from web/vendor/three.min.js');
  const qp = /const QP = (\d+);/.exec(src);
  if(!qp) throw new Error('QP not found in web/app.js');
  const code = [
    'const QP = ' + qp[1] + ';',
    'const kf = v => Math.round(v*QP);',
    'const keyOf = (x,y,z) => kf(x)+","+kf(y)+","+kf(z);',
    ...names.map(n => extract(src, n)),
    'this.keyOf = keyOf;',
    ...names.map(n => 'this.' + n + ' = ' + n + ';')
  ].join('\n');
  vm.runInContext(code, ctx, {filename: 'app.js (extracted)'});
  return ctx;
}

module.exports = {loadCore};
