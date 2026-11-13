/* WebGL 3D 장면. 공간·봇·엄폐물을 three.js 로 그리고, 조준선·HUD 는 기존 2D 캔버스가 그 위에 그린다.
   모델과 조명은 tools/blender/build_assets.py 가 만든 것(assets/models).
   히트 판정은 엔진(js/engine.js)이 그대로 맡는다. 여기서는 같은 좌표를 그리기만 한다.
   three.js 를 불러오지 못하면 이 파일은 실행되지 않고 엔진이 2D 로 그린다. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const A = window.Aim;
const canvas = document.getElementById('scene');
const BASE = 'assets/models/';
const HIGHLIGHT = 0xd648ec;
let renderer, scene, camera, room, botProto, ready = false, failed = false;
const pools = { bot: [], orb: [], cover: [], prop: [], shadow: [] };
const roomMats = [];

/* 구운 조명 x 절차적 무늬(바닥 타일 줄눈, 벽 패널 이음매) */
function roomMaterial(kind, light, uvName) {
  const m = new THREE.ShaderMaterial({
    uniforms: { light: { value: light }, gain: { value: 1 }, kind: { value: kind } },
    vertexShader: `
      varying vec2 vL; varying vec3 vW;
      void main() {
        vL = ${uvName};
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D light; uniform float gain; uniform int kind;
      varying vec2 vL; varying vec3 vW;
      float line(float v, float period, float width) {
        float d = abs(fract(v / period + 0.5) - 0.5) * period;
        return 1.0 - smoothstep(width, width + fwidth(v) * 1.5, d);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 c = texture2D(light, vL).rgb * gain;
        if (kind == 1) {            // 바닥: 4 m 타일
          float tile = hash(floor(vW.xz / 4.0));
          c *= 0.94 + 0.09 * tile;
          c *= 1.0 - 0.38 * max(line(vW.x, 4.0, 0.02), line(vW.z, 4.0, 0.02));
          c *= 1.0 - 0.10 * max(line(vW.x, 1.0, 0.006), line(vW.z, 1.0, 0.006));
        } else if (kind == 2) {     // 벽: 6 m 패널
          float along = abs(vW.x) > 35.9 ? vW.z : vW.x;
          c *= 0.95 + 0.07 * hash(floor(vec2(along / 6.0, vW.y / 2.5)));
          c *= 1.0 - 0.30 * max(line(along, 6.0, 0.025), line(vW.y, 2.5, 0.02));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  roomMats.push(m);
  return m;
}

function label(text, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.fillStyle = '#eef0e8';
  x.font = '700 120px system-ui, sans-serif'; x.fillText(text, 512, sub ? 130 : 170);
  if (sub) { x.font = '500 46px system-ui, sans-serif'; x.fillStyle = '#c9d4d1'; x.fillText(sub, 512, 210); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
}

function flat(w, d, color, x, y, z, opacity) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, -z);
  return m;
}

/* 바닥의 사격 레인·거리 표시. 2D 연습장과 같은 위치 */
function markings() {
  const g = new THREE.Group();
  for (const x of [-5, 5]) g.add(flat(0.05, 40, 0x94a6ad, x, 0.008, 20, 1));
  for (const d of [5, 10, 15, 20, 30, 40]) {
    g.add(flat(10, 0.05, 0xa8b4b4, 0, 0.012, d, 1));
    for (const x of [-5.9, 5.9]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), label(d + ' m'));
      t.rotation.x = -Math.PI / 2; t.position.set(x, 0.014, -d); g.add(t);
    }
  }
  g.add(flat(16, 0.16, 0xd6a369, 0, 0.015, 1.98, 1));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), label('PRACTICE RANGE', 'AIM  /  FOCUS  /  REPEAT'));
  sign.position.set(0, 5.4, -47.8); g.add(sign);
  return g;
}

function outline(mesh, width) {
  const mat = new THREE.MeshBasicMaterial({ color: HIGHLIGHT, side: THREE.BackSide });
  mat.onBeforeCompile = (s) => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * ' + width.toFixed(4) + ';'); };
  const o = new THREE.Mesh(mesh.geometry, mat);
  o.userData.outline = true;
  return o;
}

const WHITE = new THREE.MeshBasicMaterial({ color: 0xffffff });

function makeBot() {
  const root = new THREE.Group(), legs = new THREE.Group();
  legs.position.y = -0.8;   // 앉을 때 골반 아래만 접힌다 (엔진 botCorners 와 같은 규칙)
  root.add(legs);
  const parts = [];
  botProto.traverse((o) => {
    if (!o.isMesh) return;
    const lower = /lower/.test(o.name) || /lower/.test(o.parent.name);
    const m = new THREE.Mesh(o.geometry, o.material), line = outline(o, 0.016);
    for (const x of [m, line]) { if (lower) { x.position.y = 0.8; legs.add(x); } else root.add(x); }
    m.userData.base = o.material; parts.push(m);
  });
  root.userData = { legs, parts, flash: false };
  scene.add(root);
  return root;
}

function makeOrb() {
  const geo = new THREE.SphereGeometry(1, 32, 20);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3fd7ff, roughness: 0.35, emissive: 0x3fd7ff, emissiveIntensity: 0.35 }));
  const o = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: HIGHLIGHT, side: THREE.BackSide })); o.scale.setScalar(1.1);
  m.add(o); scene.add(m);
  return m;
}

function makeShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  makeShadow.mat = makeShadow.mat || new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), makeShadow.mat);
  m.rotation.x = -Math.PI / 2; scene.add(m);
  return m;
}

const coverMat = new THREE.MeshStandardMaterial({ color: 0x46586a, roughness: 0.85 });
const edgeMat = new THREE.MeshBasicMaterial({ color: 0xb4c0c2 });
const guideMat = new THREE.MeshBasicMaterial({ color: 0xdeb17b });
const propMat = new THREE.MeshStandardMaterial({ color: 0x9a7d55, roughness: 0.9 });
const unit = new THREE.BoxGeometry(1, 1, 1);

function makeCover() {
  const g = new THREE.Group();
  g.userData = { wall: new THREE.Mesh(unit, coverMat), edges: [0, 1].map(() => new THREE.Mesh(unit, edgeMat)), guides: [0, 1].map(() => new THREE.Mesh(unit, guideMat)) };
  g.add(g.userData.wall, ...g.userData.edges, ...g.userData.guides);
  scene.add(g);
  return g;
}
function makeProp() { const m = new THREE.Mesh(unit, propMat); scene.add(m); return m; }

/* 필요한 만큼만 꺼내 쓰고 나머지는 숨긴다 */
function take(name, n, make) {
  const p = pools[name];
  while (p.length < n) p.push(make());
  p.forEach((o, i) => { o.visible = i < n; });
  return p;
}

function setCover(g, x0, x1, z, h, guide) {
  const u = g.userData, depth = 0.4;
  u.wall.scale.set(x1 - x0, h, depth); u.wall.position.set((x0 + x1) / 2, h / 2, -(z + depth / 2));
  [[x0, 1], [x1, -1]].forEach(([x, s], i) => {
    const show = Math.abs(x) <= 30;
    u.edges[i].visible = show; u.guides[i].visible = show && guide;
    u.edges[i].scale.set(0.08, h, 0.02); u.edges[i].position.set(x + s * 0.04, h / 2, -(z - 0.011));
    u.guides[i].scale.set(0.45, 0.04, 0.02); u.guides[i].position.set(x + s * 0.225, 1.6, -(z - 0.022));
  });
}

function render(game) {
  if (!ready) return;
  const W = game.W, H = game.H;
  if (canvas.width !== W || canvas.height !== H) renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = 2 * Math.atan(H / 2 / game.focal) * 180 / Math.PI;
  camera.updateProjectionMatrix();
  camera.position.set(game.pos.x, game.eyeHeight, -game.pos.z);
  camera.rotation.set(game.pitch * Math.PI / 180, -game.yaw * Math.PI / 180, 0, 'YXZ');
  const dark = A.cfg.bg === 'dark';
  for (const m of roomMats) m.uniforms.gain.value = dark ? 0.5 : 1;

  const vis = game.targets.filter((t) => t.vis);
  const bots = vis.filter((t) => t.kind === 'bot'), orbs = vis.filter((t) => t.kind === 'orb');
  take('bot', bots.length, makeBot);
  bots.forEach((t, i) => {
    const b = pools.bot[i], p = game.targetPosition(t), u = b.userData;
    b.position.set(p.x, p.y, -p.z);
    b.rotation.y = Math.atan2(game.pos.x - p.x, p.z - game.pos.z);   // 정면이 플레이어를 향한다
    u.legs.scale.y = 1 - (t.crouch || 0) / 0.8;
    const flash = !!t.flash;
    if (flash !== u.flash) { u.flash = flash; for (const m of u.parts) m.material = flash ? WHITE : m.userData.base; }
  });
  take('orb', orbs.length, makeOrb);
  orbs.forEach((t, i) => {
    const o = pools.orb[i], p = game.targetPosition(t);
    o.position.set(p.x, p.y, -p.z); o.scale.setScalar(t.r);
    const c = t.flash ? '#ffffff' : (t.color || '#3fd7ff');
    if (o.userData.c !== c) { o.userData.c = c; o.material.color.set(c); o.material.emissive.set(c); }
  });
  const grounded = vis.filter((t) => !t.lift);
  take('shadow', grounded.length, makeShadow);
  grounded.forEach((t, i) => {
    const s = pools.shadow[i], p = game.targetPosition(t), r = t.kind === 'bot' ? 0.6 : t.r * 1.3;
    s.position.set(p.x, 0.02, -p.z); s.scale.set(r * 2, r * 1.5, 1);
    s.material.opacity = 1;
  });

  const covers = game.covers.map((c) => [c.x0, c.x1, c.z, c.h]);
  if (game.wall) {
    const w = game.wall, x = Math.tan(w.az * Math.PI / 180) * w.d, end = w.side * 36;
    covers.push([Math.min(x, end), Math.max(x, end), w.d, 3.6]);
  }
  take('cover', covers.length, makeCover);
  covers.forEach((c, i) => setCover(pools.cover[i], c[0], c[1], c[2], c[3], !!A.cfg.guide));
  take('prop', game.props.length, makeProp);
  game.props.forEach((b, i) => { const m = pools.prop[i]; m.scale.set(b.w, b.h, b.w); m.position.set(b.x, b.h / 2, -b.z); });

  renderer.render(scene, camera);
}

function active() {
  const on = ready && A.cfg.gfx !== '2d' && A.cfg.bg !== 'grid';
  canvas.style.display = on ? 'block' : 'none';
  return on;
}

async function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b242c);
  camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 200);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a545c, 1.5));
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.6); sun.position.set(6, 14, 8); scene.add(sun);

  const loader = new GLTFLoader();
  const [range, bot, light] = await Promise.all([
    loader.loadAsync(BASE + 'range.glb?v=1'), loader.loadAsync(BASE + 'bot.glb?v=1'),
    new THREE.TextureLoader().loadAsync(BASE + 'range_light.jpg?v=1'),
  ]);
  light.flipY = false; light.colorSpace = THREE.SRGBColorSpace; light.anisotropy = 4; light.needsUpdate = true;
  room = range.scene;
  room.traverse((o) => {
    if (!o.isMesh) return;
    // UV 두 벌 중 0~1 안에 들어 있는 쪽이 라이트맵
    const uv = o.geometry.attributes.uv, uv1 = o.geometry.attributes.uv1;
    let big = 0;
    for (let i = 0; i < uv.count; i += 7) big = Math.max(big, Math.abs(uv.getX(i)), Math.abs(uv.getY(i)));
    const name = big > 1.001 && uv1 ? 'uv1' : 'uv';
    const kind = /floor/.test(o.material.name) ? 1 : /wall/.test(o.material.name) ? 2 : 0;
    o.material = roomMaterial(kind, light, name);
  });
  scene.add(room, markings());
  botProto = bot.scene;
  botProto.updateMatrixWorld(true);
  ready = true;
}

A.scene3d = { active, render, get ready() { return ready; }, get failed() { return failed; } };
init().catch((e) => { failed = true; console.warn('3D 장면을 불러오지 못해 2D 로 그립니다:', e); });
