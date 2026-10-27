// 3D-сцена окна «Телеметрия» на Three.js, в духе GoFast: тёмная трасса без ярких краёв, тонкие линии кругов
// (А — по педалям, Б — пунктиром), маркеры начала торможения, минимальной скорости и газа, машины контуром сверху.
// Линии рисуются лентами с минимальной толщиной в пикселях: на всей Нордшляйфе (20 км) они не пропадают,
// а вблизи у них настоящая ширина в метрах. Координаты: X — восток, Y — высота, Z — юг.
import * as THREE from 'three';
// дополнения Three.js лежат рядом (three-jsm, обновляются scripts/sync-three-jsm.js): установщик не берёт папку examples из node_modules
import { GLTFLoader } from './three-jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './three-jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from './three-jsm/environments/RoomEnvironment.js';

// педаль считается нажатой больше чем на 5%: ниже — шум датчика и лёгкое касание
const PEDAL_ON = 0.05;
const COLORS = { a: 0x4a9bf5, b: 0xf29a38, track: 0x1c1e21, edge: 0x30343a, bg: 0x111214 };
// цвет кузова 3D-машин — те же, что у А и Б во всём окне (линии, графики, карточки), чуть глубже для лака:
// А — синяя, Б — оранжевая (полупрозрачный «призрак»). Красный не берём — он у тормоза.
const PAINT = { a: 0x2a78e4, b: 0xf08a24 };

// 3D-модель для вида от третьего лица: «2019 McLaren 720S GT3» — Ddiaz Design (sketchfab.com/ddiaz-design), лицензия CC BY 4.0.
// Сжата для приложения (детали объединены, сетка упрощена, текстуры WebP, сжатие meshopt). Краска кузова — материал «Paint»:
// его перекрашиваем, карбон, стёкла и диски остаются как есть. Пока модель грузится (или если не загрузилась) — простая своя.
let carModel = null;
function loadCarModel() {
  if (!carModel) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    carModel = loader.loadAsync('/telemetry/models/mclaren720sgt3.glb').then((gltf) => {
      const src = gltf.scene;
      src.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(src);
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      const k = 4.7 / Math.max(size.x, size.z);   // настоящая длина машины — 4,7 м
      const inner = new THREE.Group();
      inner.add(src);
      src.position.set(-center.x, -box.min.y, -center.z);
      inner.scale.setScalar(k);
      if (size.x > size.z) inner.rotation.y = Math.PI / 2; // длиной поперёк — разворачиваем
      inner.rotation.y += CAR_TURN;
      const wrap = new THREE.Group();
      wrap.add(inner);
      return wrap;
    }).catch((e) => { console.warn('3D-модель машины не загрузилась:', e); return null; });
  }
  return carModel;
}
// куда смотрит нос модели: 0 — к −Z (как у машины сцены), π — модель развёрнута задом
const CAR_TURN = Math.PI;

function paintModel(model, color, ghost) {
  const m = model.clone(true);
  m.traverse((o) => {
    if (!o.isMesh) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((mat) => {
      const c = mat.clone();
      if (/Paint/i.test(mat.name)) { c.color = new THREE.Color(color); c.map = null; }
      if (ghost) { c.transparent = true; c.opacity = Math.min(c.opacity ?? 1, 0.5); c.depthWrite = false; }
      return c;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
  return m;
}
// зоны педалей на линии А: тормоз (красный, при отпускании — к оранжевому), газ, накат
// (отпускание тормоза — светло-красное, а не оранжевое: оранжевый у круга Б)
const ZONE = { brk: 0xff4b3e, trail: 0xff8f86, thr: 0x39d17b, coast: 0xe6e8eb };

// Лента вдоль линии: у каждой вершины своя точка линии, нормаль (в плоскости XZ) и смещение.
// Смещение = база (половина ширины трассы) + добавка (половина толщины линии); у обеих — минимум в пикселях.
const ribbonMaterial = (opts = {}) => new THREE.ShaderMaterial({
  uniforms: {
    uMpp: { value: 0 }, uColor: { value: new THREE.Color(opts.color ?? 0xffffff) }, uOpacity: { value: opts.opacity ?? 1 }, uLift: { value: opts.lift ?? 0 },
    // пунктир: длина штриха в метрах, но не короче uDashPx пикселей (0 — сплошная)
    uDash: { value: opts.dash ?? 0 }, uDashPx: { value: opts.dashPx ?? 0 },
  },
  vertexColors: !!opts.vertexColors,
  // soft — мягкие края (сглаживание по ширине ленты): без него тонкие линии «рубятся» на пиксели
  transparent: (opts.opacity ?? 1) < 1 || !!opts.soft,
  defines: opts.soft ? { SOFT: 1 } : {},
  depthWrite: opts.depthWrite ?? true,
  side: THREE.DoubleSide,
  vertexShader: `
    attribute vec2 nrm;
    attribute vec4 off; // база (м), база (px), добавка (м), добавка (px)
    attribute float along; // метров от начала линии — для пунктира
    uniform float uMpp;
    uniform float uLift;
    varying vec3 vCol;
    varying float vAlong;
    varying float vSide;
    void main() {
      vAlong = along;
      vSide = sign(off.z + off.w);
      float b = sign(off.x + off.y) * max(abs(off.x), abs(off.y) * uMpp);
      float e = sign(off.z + off.w) * max(abs(off.z), abs(off.w) * uMpp);
      // слои трассы (полотно, края, линии) разнесены по высоте на сантиметры: иначе они мерцают друг сквозь друга
      vec3 p = position + vec3(nrm.x, 0.0, nrm.y) * (b + e) + vec3(0.0, uLift, 0.0);
      #ifdef USE_COLOR
        vCol = color;
      #else
        vCol = vec3(1.0);
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uMpp;
    uniform float uDash;
    uniform float uDashPx;
    varying vec3 vCol;
    varying float vAlong;
    varying float vSide;
    void main() {
      float dl = max(uDash, uDashPx * uMpp);
      if (dl > 0.0 && mod(vAlong, dl) > dl * 0.55) discard;
      float a = uOpacity;
      #ifdef SOFT
        float w = fwidth(vSide) * 1.2;
        a *= 1.0 - smoothstep(1.0 - w, 1.0, abs(vSide));
      #endif
      gl_FragColor = vec4(uColor * vCol, a);
      #include <colorspace_fragment>
    }`,
});

// pts — Float32Array xyz (n точек); offs(k) → [[база м, база px, добавка м, добавка px] для левой и правой стороны]
function ribbon(pts, n, closed, offs, colors, alongs) {
  const pos = new Float32Array(n * 6), nrm = new Float32Array(n * 4), off = new Float32Array(n * 8), alg = new Float32Array(n * 2);
  const col = colors ? new Float32Array(n * 6) : null;
  const far = (k, j) => Math.hypot(pts[j * 3] - pts[k * 3], pts[j * 3 + 2] - pts[k * 3 + 2]) > 0.4;
  for (let k = 0; k < n; k++) {
    // соседи для касательной — не ближе 0,4 м (точки на смене цвета повторяются — по ним касательная ломалась)
    let a = k, b = k;
    for (let q = 1; q < 6; q++) { a = closed ? (k - q + n) % n : Math.max(0, k - q); if (far(k, a) || a === 0) break; }
    for (let q = 1; q < 6; q++) { b = closed ? (k + q) % n : Math.min(n - 1, k + q); if (far(k, b) || b === n - 1) break; }
    let tx = pts[b * 3] - pts[a * 3], tz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const m = Math.hypot(tx, tz) || 1;
    tx /= m; tz /= m;
    const nx = tz, nz = -tx; // влево по ходу
    const [l, r] = offs(k);
    for (let s = 0; s < 2; s++) {
      const v = k * 2 + s;
      pos[v * 3] = pts[k * 3]; pos[v * 3 + 1] = pts[k * 3 + 1]; pos[v * 3 + 2] = pts[k * 3 + 2];
      nrm[v * 2] = nx; nrm[v * 2 + 1] = nz;
      off.set(s ? r : l, v * 4);
      if (alongs) alg[v] = alongs[k];
      if (col) { col[v * 3] = colors[k * 3]; col[v * 3 + 1] = colors[k * 3 + 1]; col[v * 3 + 2] = colors[k * 3 + 2]; }
    }
  }
  const idx = [];
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const a = k * 2, b = ((k + 1) % n) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('nrm', new THREE.BufferAttribute(nrm, 2));
  g.setAttribute('off', new THREE.BufferAttribute(off, 4));
  g.setAttribute('along', new THREE.BufferAttribute(alg, 1));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Маркеры событий круга (как в GoFast): ▼ начало торможения, ■ минимальная скорость в повороте, ● снова газ.
// Точки постоянного размера в пикселях; у А и Б они сдвинуты вверх и вниз от линии, чтобы не закрывать друг друга.
const SHAPE = { brake: 0, apex: 1, gas: 2 };
const MAX_TILT = 0.52; // ~30°: дальше вид сверху превращается в 3D, для этого есть свой режим
const markerMaterial = (shift) => new THREE.ShaderMaterial({
  uniforms: { uSize: { value: 11 }, uShift: { value: shift }, uRes: { value: new THREE.Vector2(1, 1) }, uLift: { value: 0.3 } },
  transparent: true, depthTest: false,
  vertexShader: `
    attribute float shape;
    attribute vec3 color;
    uniform float uSize, uShift, uLift;
    uniform vec2 uRes;
    varying float vShape;
    varying vec3 vCol;
    void main() {
      vShape = shape; vCol = color;
      vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, uLift, 0.0), 1.0);
      gl_Position = projectionMatrix * mv;
      // от третьего лица: дальние маркеры меньше, дальше 350 м — не видны
      float k = projectionMatrix[2][3] < -0.5 ? clamp(45.0 / -mv.z, 0.0, 1.25) * step(-mv.z, 350.0) : 1.0;
      gl_Position.y += uShift * k * 2.0 / uRes.y * gl_Position.w;
      gl_PointSize = uSize * k;
    }`,
  fragmentShader: `
    varying float vShape;
    varying vec3 vCol;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float inside;
      if (vShape < 0.5) inside = step(abs(p.x) * 1.15, (1.0 - p.y) * 0.5 + 0.02) * step(-0.85, p.y) * step(p.y, 0.9);
      else if (vShape < 1.5) inside = step(max(abs(p.x), abs(p.y)), 0.72);
      else inside = step(length(p), 0.8);
      if (inside < 0.5) discard;
      gl_FragColor = vec4(vCol, 1.0);
      #include <colorspace_fragment>
    }`,
});

// События круга: начало торможения (тормоз держится дольше 0,15 с), минимум скорости до газа, первое нажатие газа после поворота
function lapEvents(lap) {
  const out = [];
  const hz = lap.n / Math.max(1, lap.end || 1);
  const hold = Math.max(2, Math.round(hz * 0.15));
  let i = 1;
  while (i < lap.n) {
    if (lap.brk[i] > 0.1 && lap.brk[i - 1] <= 0.1) {
      let k = i;
      while (k < lap.n && lap.brk[k] > 0.05) k++;
      if (k - i >= hold) {
        out.push({ i, type: 'brake' });
        // газ после поворота: первое нажатие больше 20% без тормоза
        let g = k;
        while (g < lap.n && !(lap.thr[g] > 0.2 && lap.brk[g] < 0.05)) g++;
        let m = i;
        for (let q = i; q < Math.min(lap.n, g + 1); q++) if (lap.speed[q] < lap.speed[m]) m = q;
        out.push({ i: m, type: 'apex' });
        if (g < lap.n) out.push({ i: g, type: 'gas' });
        i = Math.max(k, g);
        continue;
      }
      i = k;
    }
    i++;
  }
  return out;
}

// Машина сверху контуром (рисунок свой) — для видов сверху; 3D-модель — для вида от третьего лица; кружок — когда машина меньше пары пикселей
function carOutline(color) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 288;
  const g = cv.getContext('2d');
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = hex; g.lineWidth = 6;
  g.fillStyle = 'rgba(17, 18, 20, 0.92)';
  // кузов: нос сверху
  g.beginPath();
  g.moveTo(64, 10);
  g.bezierCurveTo(100, 12, 116, 40, 116, 80);
  g.lineTo(118, 200); g.bezierCurveTo(118, 250, 104, 276, 64, 278);
  g.bezierCurveTo(24, 276, 10, 250, 10, 200);
  g.lineTo(12, 80); g.bezierCurveTo(12, 40, 28, 12, 64, 10);
  g.closePath(); g.fill(); g.stroke();
  // кабина и стекло
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(34, 112); g.quadraticCurveTo(64, 90, 94, 112); g.lineTo(90, 180); g.quadraticCurveTo(64, 190, 38, 180); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 90); g.stroke();
  // антикрыло
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(14, 258); g.lineTo(114, 258); g.stroke();
  // колёса
  g.fillStyle = hex;
  for (const [x, y] of [[4, 56], [112, 56], [4, 196], [112, 196]]) g.fillRect(x, y, 12, 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 4.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 9;
  const top = new THREE.Group();
  top.add(m);
  return top;
}

function makeCar(color, ghost = false) {
  const g = new THREE.Group();
  const see = ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {};
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, ...see });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.3, metalness: 0.4, ...see });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.9, ...see });
  // Кузов GT: силуэт сверху (нос — вперёд), вытянутый вверх со скруглёнными краями; кабина — капля поуже
  // силуэт: от середины носа (0, f) по часовой — кривые Безье [контроль 1, контроль 2, конец]; f — нос, r — корма, w — полуширина
  const extrude = (f, curves, height, bevel) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, f);
    for (const [c1, c2, e] of curves) sh.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: height, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 });
    geo.rotateX(-Math.PI / 2); // форма лежит на земле, высота — вверх, нос — к −Z
    return geo;
  };
  const outline = (w, f, r, nose) => [
    [[w * 0.6, f], [w, f - nose * 0.4], [w, f - nose]],
    [[w, f - nose - 1], [w * 1.03, r + 1.6], [w * 1.03, r + 0.8]],
    [[w * 1.03, r + 0.2], [w * 0.7, r], [0, r]],
    [[-w * 0.7, r], [-w * 1.03, r + 0.2], [-w * 1.03, r + 0.8]],
    [[-w * 1.03, r + 1.6], [-w, f - nose - 1], [-w, f - nose]],
    [[-w, f - nose * 0.4], [-w * 0.6, f], [0, f]],
  ];
  const body = new THREE.Mesh(extrude(2.25, outline(0.86, 2.25, -2.25, 0.9), 0.36, 0.13), paint);
  body.position.y = 0.2;
  const cabin = new THREE.Mesh(extrude(0.75, outline(0.6, 0.75, -1.15, 0.45), 0.28, 0.12), dark);
  cabin.position.y = 0.72;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.05, 0.34), dark);
  wing.position.set(0, 1.12, 2.0);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.3), dark);
  splitter.position.set(0, 0.1, -2.3);
  g.add(body, cabin, wing, splitter);
  for (const x of [-0.45, 0.45]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.12), dark);
    strut.position.set(x, 0.92, 2.0);
    g.add(strut);
  }
  for (const [x, z] of [[-0.9, -1.4], [0.9, -1.4], [-0.9, 1.35], [0.9, 1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 18), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = '#' + color.toString(16).padStart(6, '0');
  c.strokeStyle = '#111214'; c.lineWidth = 8;
  c.beginPath(); c.arc(32, 32, 24, 0, Math.PI * 2); c.fill(); c.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  dot.renderOrder = 10;
  return { car: g, dot, top: carOutline(color) };
}

export class TrackScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(COLORS.bg);
    this.scene = new THREE.Scene();
    // мягкое отражение «студии» — у лака и карбона модели появляются блики
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x1a1c20, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 80, 20);
    this.scene.add(sun);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.persp = new THREE.PerspectiveCamera(55, 1, 0.3, 30000);
    this.mode = 'top';
    this.view = { cx: 0, cz: 0, h: 500, rot: 0 }; // центр, высота кадра в метрах, поворот (машина едет вверх)
    // вид сверху: follow — камера едет за машиной А по ходу движения (потянули мышью — свободный вид);
    // tilt — небольшой наклон камеры назад (0 — строго сверху, до ~30°): зажать колесо мыши и вести вверх-вниз
    this.follow = true;
    this.tilt = 0;
    this.chase = { dist: 11, head: null, pos: null };
    this.track = null;
    this.lines = { a: null, b: null };
    this.marks = { a: null, b: null };
    this.cars = {};
    for (const k of ['a', 'b']) {
      const c = makeCar(COLORS[k], k === 'b');
      c.car.visible = c.dot.visible = c.top.visible = false;
      this.scene.add(c.car, c.dot, c.top);
      this.cars[k] = c;
    }
    this.materials = [];
    loadCarModel().then((model) => {
      if (!model) return;
      for (const k of ['a', 'b']) {
        const g = this.cars[k].car;
        g.clear();
        g.add(paintModel(model, PAINT[k], k === 'b'));
      }
      this.modelReady = true;
    });
    this.bindPointer();
  }

  // ---------- содержимое ----------

  clearObj(obj) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.traverse((o) => { o.geometry?.dispose(); });
  }

  // tr: { pts: Float32Array xyz, n, closed, hwL, hwR (м, массивы или число), sectors: [индексы точек], start }
  setTrack(tr) {
    this.clearObj(this.track);
    this.track = null;
    if (!tr) return;
    const grp = new THREE.Group();
    const hw = (a, k) => (typeof a === 'number' ? a : a[k]);
    const MIN_HALF_PX = 2.5;
    const surfMat = ribbonMaterial({ color: COLORS.track });
    grp.add(new THREE.Mesh(ribbon(tr.pts, tr.n, tr.closed, (k) => [[hw(tr.hwL, k), MIN_HALF_PX, 0, 0], [-hw(tr.hwR, k), -MIN_HALF_PX, 0, 0]]), surfMat));
    const edgeMat = ribbonMaterial({ color: COLORS.edge, lift: 0.04, soft: true });
    for (const side of [1, -1]) {
      const h = side > 0 ? tr.hwL : tr.hwR;
      grp.add(new THREE.Mesh(ribbon(tr.pts, tr.n, tr.closed, (k) => [[side * hw(h, k), side * MIN_HALF_PX, -0.1, -0.5], [side * hw(h, k), side * MIN_HALF_PX, 0.1, 0.5]]), edgeMat));
    }
    // линия старта (шашки) и границы секторов — поперечные полосы
    const across = (k, color, halfLen) => {
      const n = tr.n, a = tr.closed ? (k - 1 + n) % n : Math.max(0, k - 1), b = tr.closed ? (k + 1) % n : Math.min(n - 1, k + 1);
      let tx = tr.pts[b * 3] - tr.pts[a * 3], tz = tr.pts[b * 3 + 2] - tr.pts[a * 3 + 2];
      const m = Math.hypot(tx, tz) || 1; tx /= m; tz /= m;
      const wl = hw(tr.hwL, k), wr = hw(tr.hwR, k);
      const p = new Float32Array([
        tr.pts[k * 3] + tz * wl, tr.pts[k * 3 + 1], tr.pts[k * 3 + 2] - tx * wl,
        tr.pts[k * 3] - tz * wr, tr.pts[k * 3 + 1], tr.pts[k * 3 + 2] + tx * wr,
      ]);
      const mat = ribbonMaterial({ color, lift: 0.06 });
      return new THREE.Mesh(ribbon(p, 2, false, () => [[0, 0, halfLen, 0.8], [0, 0, -halfLen, -0.8]]), mat);
    };
    grp.add(across(tr.start ?? 0, 0xd8dbe0, 0.4));
    for (const k of tr.sectors || []) grp.add(across(k, 0x6b5a26, 0.25));
    this.scene.add(grp);
    this.track = grp;
    this.trackData = tr;
  }

  // Траектория круга (тонкая, как в GoFast). По педалям — чёткие зоны без перетекания: тормоз (красный, при отпускании —
  // оранжевый; важнее газа, если нажаты обе), газ (зелёный), накат — ни одна педаль не нажата (светлый).
  // Ещё — по скорости или цветом машины. У круга Б линия — пунктиром. Плюс маркеры событий круга.
  setLine(key, lap, mode) {
    this.clearObj(this.lines[key]);
    this.clearObj(this.marks[key]);
    this.lines[key] = this.marks[key] = null;
    if (!lap) return;
    const zone = (i) => (lap.brk[i] > PEDAL_ON ? 2 : lap.thr[i] > PEDAL_ON ? 1 : 0);
    const thr = new THREE.Color(ZONE.thr), coast = new THREE.Color(ZONE.coast), red = new THREE.Color(ZONE.brk), trail = new THREE.Color(ZONE.trail);
    const zoneColor = (i, c) => {
      const z = zone(i);
      if (z === 2) return c.copy(trail).lerp(red, Math.min(1, lap.brk[i] / 0.6));
      return c.copy(z === 1 ? thr : coast);
    };
    let vMin = Infinity, vMax = -Infinity;
    if (mode === 'speed') for (let i = 0; i < lap.n; i++) { vMin = Math.min(vMin, lap.speed[i]); vMax = Math.max(vMax, lap.speed[i]); }
    const base = new THREE.Color(COLORS[key]);
    const colorOf = (i, c) => {
      if (mode === 'inputs') return zoneColor(i, c);
      if (mode === 'speed') return c.setHSL(((vMax > vMin ? (lap.speed[i] - vMin) / (vMax - vMin) : 0)) * 0.36, 0.75, 0.55);
      return c.copy(base);
    };
    // точки через ~0.8 м (на 60 Гц их избыточно), но смена зоны педалей — всегда: в этой точке цвет меняется скачком
    const P = [], C = [], A = [];
    const c = new THREE.Color(), prevC = new THREE.Color();
    let along = 0, lastPos = 0;
    const push = (i, col) => {
      along += Math.hypot(lap.pos[i * 3] - lap.pos[lastPos * 3], lap.pos[i * 3 + 2] - lap.pos[lastPos * 3 + 2]);
      lastPos = i;
      P.push(lap.pos[i * 3], lap.pos[i * 3 + 1], lap.pos[i * 3 + 2]); C.push(col.r, col.g, col.b); A.push(along);
    };
    let last = 0, lastZone = zone(0);
    push(0, colorOf(0, c));
    for (let i = 1; i < lap.n; i++) {
      const z = zone(i);
      const far = Math.hypot(lap.pos[i * 3] - lap.pos[last * 3], lap.pos[i * 3 + 2] - lap.pos[last * 3 + 2]) > 0.8;
      if (mode === 'inputs' && z !== lastZone) {
        push(i, zoneColor(i - 1, prevC));
        push(i, colorOf(i, c));
        last = i; lastZone = z;
      } else if (far || i === lap.n - 1) {
        push(i, colorOf(i, c));
        last = i; lastZone = z;
      }
    }
    const n = P.length / 3;
    const dashed = key === 'b';
    const mat = ribbonMaterial({ vertexColors: true, lift: key === 'a' ? 0.12 : 0.09, dash: dashed ? 4 : 0, dashPx: dashed ? 9 : 0, soft: true });
    const mesh = new THREE.Mesh(ribbon(new Float32Array(P), n, false, () => [[0, 0, 0.12, 1.15], [0, 0, -0.12, -1.15]], new Float32Array(C), A), mat);
    mesh.renderOrder = key === 'a' ? 3 : 2;
    this.scene.add(mesh);
    this.lines[key] = mesh;

    // маркеры: у А — цветом события, у Б — цветом машины Б; А чуть выше линии, Б — ниже
    const ev = lapEvents(lap);
    if (!ev.length) return;
    const mp = new Float32Array(ev.length * 3), ms = new Float32Array(ev.length), mc = new Float32Array(ev.length * 3);
    const evColor = { brake: new THREE.Color(ZONE.brk), apex: new THREE.Color(0xffb02e), gas: new THREE.Color(ZONE.thr) };
    ev.forEach((e, q) => {
      mp.set([lap.pos[e.i * 3], lap.pos[e.i * 3 + 1], lap.pos[e.i * 3 + 2]], q * 3);
      ms[q] = SHAPE[e.type];
      const col = key === 'a' ? evColor[e.type] : base;
      mc.set([col.r, col.g, col.b], q * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    g.setAttribute('shape', new THREE.BufferAttribute(ms, 1));
    g.setAttribute('color', new THREE.BufferAttribute(mc, 3));
    const pts = new THREE.Points(g, markerMaterial(key === 'a' ? 9 : -9));
    pts.renderOrder = 6;
    this.scene.add(pts);
    this.marks[key] = pts;
  }

  // st — состояние машины (laps.js stateAt) или null
  setCar(key, st) {
    const { car, dot, top } = this.cars[key];
    this.cars[key].on = !!st;
    car.visible = !!st;
    if (!st) { dot.visible = top.visible = false; return; }
    car.position.set(st.x, st.y + 0.05, st.z);
    car.rotation.y = -st.head;
    dot.position.set(st.x, st.y + 1, st.z);
    top.position.set(st.x, st.y + 0.3, st.z);
    top.rotation.y = -st.head;
  }

  // ---------- камера ----------

  setMode(mode) {
    // прежний режим «за машиной» — это вид сверху со слежением
    if (mode === 'follow') { mode = 'top'; this.follow = true; }
    this.mode = mode;
    this.chase.head = null;
    if (mode === 'chase') this.chase.pos = null;
  }

  setFollow(on) {
    this.follow = !!on;
    if (!on) return;
    this.view.h = Math.min(this.view.h, 160);
  }

  setTilt(rad) { this.tilt = Math.max(0, Math.min(MAX_TILT, rad)); }

  fit() {
    const tr = this.trackData;
    if (!tr) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < tr.n; k++) {
      x0 = Math.min(x0, tr.pts[k * 3]); x1 = Math.max(x1, tr.pts[k * 3]);
      z0 = Math.min(z0, tr.pts[k * 3 + 2]); z1 = Math.max(z1, tr.pts[k * 3 + 2]);
    }
    const { width, height } = this.size();
    const aspect = width / height;
    this.view.cx = (x0 + x1) / 2;
    this.view.cz = (z0 + z1) / 2;
    this.view.h = Math.max((z1 - z0), (x1 - x0) / aspect) * 1.12 + 40;
    this.view.rot = 0;
    // при слежении за машиной — сразу крупно
    if (this.follow) this.view.h = 130;
  }

  zoomBy(f) {
    if (this.mode === 'chase') this.chase.dist = Math.min(60, Math.max(5, this.chase.dist * f));
    else this.view.h = Math.min(40000, Math.max(20, this.view.h * f));
  }

  size() {
    return { width: this.canvas.clientWidth || 1, height: this.canvas.clientHeight || 1 };
  }

  // оси экрана в мире при повороте вида rot: вправо и вверх (вперёд по ходу)
  axes() {
    const r = this.view.rot;
    return { rx: Math.cos(r), rz: Math.sin(r), fx: Math.sin(r), fz: -Math.cos(r) };
  }

  bindPointer() {
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 1) return;
      // зажатое колесо — наклон; без preventDefault Windows включила бы автопрокрутку
      if (e.button === 1) e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, tilt: e.button === 1 };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* без захвата тоже работает */ }
      this.canvas.classList.add('drag');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (this.mode === 'chase') return;
      // зажатое колесо — наклон камеры (вверх-вниз)
      if (drag.tilt) { this.setTilt(this.tilt + dy * 0.004); this.onTilt?.(this.tilt); return; }
      // потянули карту — камера перестаёт следить за машиной (свободный вид)
      if (this.follow && Math.hypot(dx, dy) > 0) { this.follow = false; this.onFollowChange?.(false); }
      const mpp = this.view.h / this.size().height;
      const a = this.axes();
      this.view.cx += (-dx * a.rx + dy * a.fx) * mpp;
      this.view.cz += (-dx * a.rz + dy * a.fz) * mpp;
    });
    const end = () => { drag = null; this.canvas.classList.remove('drag'); };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0015);
      if (this.mode === 'top' && !this.follow) {
        // приближаем к точке под курсором
        const r = this.canvas.getBoundingClientRect();
        const { width, height } = this.size();
        const mpp = this.view.h / height;
        const a = this.axes();
        const sx = (e.clientX - r.left - width / 2) * mpp, sy = (e.clientY - r.top - height / 2) * mpp;
        const wx = this.view.cx + sx * a.rx - sy * a.fx;
        const wz = this.view.cz + sx * a.rz - sy * a.fz;
        const h0 = this.view.h;
        this.zoomBy(f);
        const k = this.view.h / h0;
        this.view.cx = wx - (wx - this.view.cx) * k;
        this.view.cz = wz - (wz - this.view.cz) * k;
      } else this.zoomBy(f);
    }, { passive: false });
  }

  // ---------- кадр ----------

  // focus — состояние машины А (за ней следуют камеры), dt — секунды с прошлого кадра
  render(focus, dt) {
    const { width, height } = this.size();
    const c = this.canvas;
    const pr = this.renderer.getPixelRatio();
    if (c.width !== Math.round(width * pr) || c.height !== Math.round(height * pr)) this.renderer.setSize(width, height, false);
    const aspect = width / height;
    let cam;
    let mpp = 0;
    if (this.mode === 'chase' && focus) {
      cam = this.persp;
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
      // камера мягко догоняет курс машины: так видно занос, а не дёргается на каждом отсчёте
      const k = 1 - Math.exp(-dt * 6);
      if (this.chase.head == null) this.chase.head = focus.head;
      let d = focus.head - this.chase.head;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.chase.head += d * k;
      const h = this.chase.head, fx = Math.sin(h), fz = -Math.cos(h);
      const dist = this.chase.dist;
      const want = new THREE.Vector3(focus.x - fx * dist, focus.y + dist * 0.32 + 1.2, focus.z - fz * dist);
      if (!this.chase.pos) this.chase.pos = want.clone();
      // перескочили далеко (перемотка) — камера сразу на месте, а не летит через всю трассу
      if (this.chase.pos.distanceTo(want) > 60) this.chase.pos.copy(want);
      else this.chase.pos.lerp(want, Math.min(1, k * 2.5));
      cam.position.copy(this.chase.pos);
      cam.lookAt(focus.x + fx * dist * 0.7, focus.y + 0.8, focus.z + fz * dist * 0.7);
    } else {
      cam = this.ortho;
      if (this.follow && focus) {
        this.view.cx = focus.x; this.view.cz = focus.z;
        // по ходу движения: машина всегда едет вверх
        const k = 1 - Math.exp(-dt * 4);
        let d = focus.head - this.view.rot;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.view.rot += d * k;
      }
      const h = this.view.h;
      cam.left = -h * aspect / 2; cam.right = h * aspect / 2; cam.top = h / 2; cam.bottom = -h / 2;
      cam.updateProjectionMatrix();
      const r = this.view.rot;
      const fx = Math.sin(r), fz = -Math.cos(r);
      cam.up.set(fx, 0, fz);
      // наклон: камера отходит назад (против хода) — видно чуть вперёд и бока машины
      const D = 2000, ty = this.follow && focus ? focus.y : 0;
      cam.position.set(this.view.cx - fx * Math.sin(this.tilt) * D, ty + Math.cos(this.tilt) * D, this.view.cz - fz * Math.sin(this.tilt) * D);
      cam.lookAt(this.view.cx, ty, this.view.cz);
      mpp = h / height;
    }
    this.scene.traverse((o) => { if (o.material?.uniforms?.uMpp) o.material.uniforms.uMpp.value = mpp; });
    // 3D-модель — и от третьего лица, и сверху; сверху, если машина меньше 18 пикселей, — кружок;
    // нарисованный контур — только пока модель не загрузилась (или не загрузилась вовсе)
    for (const [k, px] of [['a', 16], ['b', 13]]) {
      const c = this.cars[k];
      const ortho = cam === this.ortho;
      const big = ortho && 4.75 / (mpp || 1) >= 18;
      c.car.visible = !!c.on && (!ortho || (big && !!this.modelReady));
      c.top.visible = !!c.on && big && !this.modelReady;
      c.dot.visible = !!c.on && ortho && !big;
      c.dot.scale.set(px * mpp, px * mpp, 1);
    }
    const res = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // сверху маркеры — только вблизи: на всей трассе они слились бы в россыпь точек
    for (const m of [this.marks.a, this.marks.b]) if (m) m.visible = cam !== this.ortho || mpp < 1.4;
    for (const m of [this.marks.a, this.marks.b]) if (m) { m.material.uniforms.uRes.value.copy(res); m.material.uniforms.uSize.value = 11 * this.renderer.getPixelRatio(); m.material.uniforms.uShift.value = (m === this.marks.a ? 9 : -9) * this.renderer.getPixelRatio(); }
    this.renderer.render(this.scene, cam);
  }
}
