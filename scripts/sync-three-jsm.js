// Копирует нужные дополнения Three.js (загрузчик 3D-моделей и его зависимости) из node_modules/three/examples/jsm
// в overlays/telemetry/three-jsm. Сборщик (electron-builder) не кладёт в установщик папки examples из node_modules,
// поэтому эти файлы живут рядом с окном «Телеметрия». Запускать после обновления three: node scripts/sync-three-jsm.js
const fs = require('fs');
const path = require('path');

const FILES = [
  'loaders/GLTFLoader.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
  'libs/meshopt_decoder.module.js',
  'environments/RoomEnvironment.js',
];
const root = path.resolve(__dirname, '..');
const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
const to = path.join(root, 'overlays', 'telemetry', 'three-jsm');
const version = require(path.join(root, 'node_modules', 'three', 'package.json')).version;

for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
  fs.copyFileSync(path.join(from, f), path.join(to, f));
}
fs.writeFileSync(path.join(to, 'VERSION'), `three ${version} (MIT, https://github.com/mrdoob/three.js)\n`);
console.log(`Скопировано ${FILES.length} файлов three ${version} → ${path.relative(root, to)}`);
