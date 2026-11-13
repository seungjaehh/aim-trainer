const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ctx = new Proxy({}, { get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient'
  ? () => ({ addColorStop() {} }) : key === 'measureText' ? () => ({ width: 10 }) : () => {}, set: () => true });
const Aim = { cfg: { fov: 103, sens: .4, targetSize: 1, bg: 'range', guide: true, chScale: 1, holdSpeed: 'random' },
  audio: { resetStreak() {}, kill() {}, hit() {}, shot() {}, hurt() {} }, crosshair: { draw() {} } };
const sandbox = { window: { Aim, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }, performance };
vm.createContext(sandbox);
for (const file of ['engine.js', 'modes.js', 'mapdata.js', 'valorant.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox);
const game = () => new Aim.Game({ getContext: () => ctx });
const blank = (extra) => Object.assign({ setup() {}, update() {}, onKill() {} }, extra);
const VAL = ['preaim', 'peek', 'jiggle', 'counter', 'burst', 'terrain'];
const step = (g, sec, dt = 1 / 240) => { for (let t = 0; t < sec; t += dt) { g.t += dt; g.movePlayer(dt); } };

test('발로란트 모드는 모두 훈련 요령과 근거 자료 링크를 가진다', () => {
  for (const id of VAL.concat(['headline', 'hold'])) {
    const m = Aim.modes.find((x) => x.id === id);
    assert.ok(m, id + ' 모드가 없다');
    assert.ok(m.guide.points.length >= 2, id);
    assert.ok(m.guide.src.length >= 1, id);
    for (const s of m.guide.src) assert.match(s[1], /^https:\/\//);
  }
});

test('달리다 키를 떼면 약 0.17초, 반대 키를 누르면 약 0.16초 만에 멈춘다', () => {
  const stopTime = (counter) => {
    const g = game(); g.reset(blank({ move: true }));
    g.keys = { d: true }; step(g, 0.6);
    assert.ok(Math.abs(g.vx - Aim.MOVE.run) < 1e-6);
    g.keys = counter ? { a: true } : {};
    const dt = 1 / 1000; let t = 0;
    while (g.vx > 0 && t < 1) { g.t += dt; g.movePlayer(dt); t += dt; }
    return t;
  };
  const release = stopTime(false), counter = stopTime(true);
  assert.ok(Math.abs(release - 0.17) < 0.005, 'release ' + release);
  assert.ok(Math.abs(counter - 0.16) < 0.005, 'counter ' + counter);
});

test('Shift 걷기는 달리기의 60% 속도이고 이동 범위를 벗어나지 않는다', () => {
  const g = game(); g.reset(blank({ move: true }));
  g.bounds = { x0: -2, x1: 2 };
  g.keys = { d: true, shift: true }; step(g, 0.5);
  assert.ok(Math.abs(g.speedPct() - 0.6) < 1e-6);
  g.keys = { d: true }; step(g, 3);
  assert.equal(g.pos.x, 2);
});

test('멈춰서 쏘면 탄이 모이고 달리며 쏘면 크게 퍼진다', () => {
  const spread = (run) => {
    const g = game(); g.reset(blank({ move: true, gun: true }));
    if (run) { g.keys = { d: true }; step(g, 0.6); }
    let max = 0;
    for (let i = 0; i < 300; i++) { g.t += 1; const o = g.bulletOffset(); max = Math.max(max, Math.hypot(o.ox, o.oy)); }
    return max;
  };
  assert.ok(spread(false) <= Aim.GUN.base + 1e-9);
  assert.ok(spread(true) > 3);
});

test('연사하면 탄이 위로 올라가고 쉬면 첫 발로 돌아온다', () => {
  const g = game(); g.reset(blank({ gun: true, recoil: true }));
  let last = 0;
  for (let i = 0; i < 8; i++) { g.t += 0.1; last = g.bulletOffset().oy; }
  assert.ok(last > 4);
  g.t += 1;
  const first = g.bulletOffset();
  assert.equal(first.n, 0);
  assert.ok(Math.abs(first.oy) <= Aim.GUN.base + 1e-9);
});

test('벽 뒤의 적은 보이지 않고 옆으로 나가면 보인다', () => {
  const g = game(); g.reset(blank({ move: true, gun: true }));
  g.covers = [{ x0: -36, x1: 0, z: 6, h: 3.6 }];
  const t = g.bot(Math.atan2(-1.5, 15) * 180 / Math.PI, 0, 15);
  g.pos.x = -1.3;
  assert.equal(g.seesHead(t), false);
  assert.equal(g.seenBy(t), false);
  g.pos.x = 2.5;
  assert.equal(g.seesHead(t), true);
  assert.equal(g.seenBy(t), true);
  const a = g.targetAngles(t); g.yaw = a.az; g.pitch = a.el;
  assert.equal(g.hitAt(true).part, 'head');
  g.pos.x = -1.3;
  const b = g.targetAngles(t); g.yaw = b.az; g.pitch = b.el;
  assert.equal(g.hitAt(true), null);
});

test('코너 뒤 적은 벽 모서리 선 위에 놓인다 (프리에임 원리)', () => {
  for (let i = 0; i < 50; i++) {
    const g = game(); g.reset(blank({ move: true, gun: true }));
    g.m = {};
    const b = Aim.valorant.corner(g), p = g.targetPosition(b), s = g.m.side;
    assert.ok(-s * p.x > 0, '적은 벽 뒤쪽에 있다');
    // 적 머리와 플레이어를 잇는 선이 벽 모서리를 지나는 플레이어 위치는 이동 범위 안에 있다
    const reveal = -p.x / (p.z / Aim.valorant.WALL_Z - 1);
    assert.ok(Math.abs(reveal) <= 1.6 && Math.abs(reveal) >= 0.2, 'reveal ' + reveal);
    assert.equal(g.seenBy(b), false);
  }
});

test('계단을 오르면 눈 높이가 올라가고, 높이가 다른 적의 머리를 정확히 겨눌 수 있다', () => {
  const g = game(); g.reset(blank({ move: true, gun: true }));
  g.ground = Aim.valorant.stairs; g.bounds = { x0: -3.2, x1: 3.2 };
  g.pos.x = -3.2; g.base = g.ground(-3.2);
  assert.equal(g.base, 0);
  g.keys = { d: true }; step(g, 3);
  assert.ok(Math.abs(g.base - 1.5) < 1e-9, 'base ' + g.base);
  assert.ok(Math.abs(g.eyeY - 3.1) < 1e-9);
  g.keys = {}; step(g, 0.5);
  for (const lift of [0, 1.5, 3]) {
    const t = g.bot(10, 0, 14); if (lift) t.lift = lift;
    const a = g.targetAngles(t);
    assert.equal(Math.sign(Math.round(a.el * 1000)), Math.sign(lift - 1.5));
    g.yaw = a.az; g.pitch = a.el;
    assert.equal(g.hitAt(true).t, t);
    assert.equal(g.hitAt(true).part, 'head');
    g.remove(t);
  }
});

const useLayout = (g, L) => { g.solids = L.solids; g.bounds = { x0: L.bounds[0], x1: L.bounds[1] }; g.pos.x = 0; g.vx = 0; g.base = L.base; };

test('맵 데이터는 충돌·적 자리·겉모습을 따로 두고, 대조하지 않은 자리를 대조했다고 표시하지 않는다', () => {
  assert.ok(Aim.mapData.length >= 8);
  for (const D of Aim.mapData) {
    assert.ok(Array.isArray(D.collision.boxes) && D.collision.boxes.length, D.id);
    assert.ok(D.bots.spots.length >= 2, D.id);
    assert.equal(D.visual.kind, 'boxes', D.id);
    assert.equal(D.compared, false, D.id + ' 원작 대조 기록 없이 compared 를 켜지 않는다');
  }
  assert.ok(Aim.valorant.LAYOUTS.every((L) => L.compared === false));
});

test('맵 자리 검증: 거리·높이 — 적 자리는 콜아웃 대표점 6 m 안의 바닥이고, 표시한 거리·높이가 충돌 데이터와 맞는다', () => {
  for (const L of Aim.valorant.LAYOUTS) {
    const g = game(); g.reset(blank({ move: true, gun: true })); useLayout(g, L);
    assert.equal(g.floorAt(0, 0), L.base, L.id + ' 서는 곳');
    assert.ok(new Set(L.spots.map((s) => s.h).concat(L.base)).size >= 2, L.id + ' 높이 차이가 있어야 한다');
    for (const s of L.spots) {
      assert.ok(s.off <= 6, L.id + ' ' + s.name);
      assert.equal(g.floorAt(s.x, s.z), s.h, L.id + ' ' + s.name + ' 바닥 높이');
      assert.ok(Math.abs(Math.hypot(s.x, s.z) - s.dist) <= 0.5, L.id + ' ' + s.name + ' 거리');
      assert.ok(s.z >= 6 && s.z < 46 && Math.abs(s.x) < 34, L.id + ' ' + s.name + ' 훈련장 안');
    }
  }
});

test('맵 자리 검증: 시야 — 모든 적 자리의 머리가 서는 곳에서 보이고, 벽 뒤는 보이지 않는다', () => {
  for (const L of Aim.valorant.LAYOUTS) {
    const g = game(); g.reset(blank({ move: true, gun: true })); useLayout(g, L);
    for (const s of L.spots) {
      const t = g.bot(Math.atan2(s.x, s.z) * 180 / Math.PI, 0, s.z); if (s.h) t.lift = s.h;
      assert.equal(g.seesHead(t), true, L.id + ' ' + s.name);
      const a = g.targetAngles(t); g.yaw = a.az; g.pitch = a.el;
      assert.equal(g.hitAt(true).part, 'head', L.id + ' ' + s.name + ' 사격');
      g.remove(t);
    }
    const wall = L.solids.find((b) => b.wall && b.z - b.d / 2 > 3 && Math.abs(b.x) < 20);
    assert.ok(wall, L.id + ' 앞쪽 벽');
    assert.equal(g.segmentBlocked(0, g.eyeY, 0, wall.x, 1.6, wall.z + 0.01), true, L.id + ' 벽 안쪽');
  }
});

test('맵 자리 검증: 이동 충돌 — 좌우로 달려도 벽이나 높은 단 안으로 들어가지 않는다', () => {
  const g0 = game(); g0.reset(blank({ move: true, gun: true }));
  g0.solids = [{ x: 2.5, z: 0, w: 1, d: 2, h: 6, wall: true }, { x: -2.5, z: 0, w: 2, d: 2, h: 0.5 }];
  g0.keys = { d: true }; step(g0, 2);
  assert.ok(g0.pos.x > 1.5 && g0.pos.x <= 1.7 + 1e-9, 'wall stop ' + g0.pos.x);
  g0.bounds = { x0: -3.2, x1: 3.2 }; g0.keys = { a: true }; step(g0, 0.9);
  assert.ok(g0.pos.x < -1.5 && Math.abs(g0.base - 0.5) < 1e-9, '낮은 단은 올라선다 ' + g0.pos.x + ' ' + g0.base);
  let blocked = 0;
  for (const L of Aim.valorant.LAYOUTS) for (const key of ['a', 'd']) {
    const g = game(); g.reset(blank({ move: true, gun: true })); useLayout(g, L);
    g.keys = { [key]: true };
    for (let i = 0; i < 30; i++) {
      step(g, 0.1);
      assert.ok(g.floorAt(g.pos.x, 0) - g.base <= 0.6 + 1e-9, L.id + ' ' + key + ' x ' + g.pos.x);
    }
    if (Math.abs(g.pos.x) < 3.19) blocked++;
  }
  assert.ok(blocked > 0, '실제 자리 중 벽에 막히는 곳이 있다');
});

test('맵 자리 검증: 사격 차폐 — 상자 뒤 머리는 맞지 않고, 상자를 치우면 맞는다', () => {
  const g = game(); g.reset(blank({ move: true, gun: true }));
  const t = g.bot(0, 0, 14), a = g.targetAngles(t);
  g.yaw = a.az; g.pitch = a.el;
  assert.equal(g.hitAt(true).part, 'head');
  g.solids = [{ x: 0, z: 7, w: 2, d: 1, h: 2.2 }];
  assert.equal(g.hitAt(true), null);
  assert.equal(g.seesHead(t), false);
  g.solids = [{ x: 0, z: 7, w: 2, d: 1, h: 1.0 }];   // 낮은 상자 위로는 머리가 보인다
  assert.equal(g.hitAt(true).part, 'head');
  g.solids = [{ x: 3, z: 7, w: 2, d: 1, h: 2.2 }];   // 옆으로 비켜난 상자
  assert.equal(g.hitAt(true).part, 'head');
  // 실제 자리의 상자: 대표 사이트(헤이븐 A)에서 상자 바로 뒤 바닥의 적은 가려진다
  const L = Aim.valorant.LAYOUTS.find((v) => v.id === 'haven-a-long');
  const g2 = game(); g2.reset(blank({ move: true, gun: true })); useLayout(g2, L);
  const hidden = L.solids.filter((b) => !b.wall && b.h >= 2 && b.z > 6).some((b) => g2.segmentBlocked(0, g2.eyeY, 0, b.x * 1.04, 1.0, (b.z + b.d / 2 + 0.3) * 1.04 ));
  assert.equal(hidden, true);
});

test('모든 발로란트 모드가 임의 입력으로 20초 동안 오류 없이 돌아간다', () => {
  for (const id of VAL) {
    const mode = Aim.modes.find((x) => x.id === id);
    const g = game(); g.reset(mode);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 20 * 60; i++) {
      if (i % 20 === 0) g.keys = { a: rnd() < 0.4, d: rnd() < 0.4, shift: rnd() < 0.2 };
      const live = g.targets.find((t) => g.seesHead(t));
      if (live && rnd() < 0.5) { const a = g.targetAngles(live); g.yaw = a.az; g.pitch = a.el; }
      if (i % 9 === 0) g.fire();
      g.update(1 / 60); if (i % 15 === 0) g.render();
    }
    assert.ok(Number.isFinite(g.stats.score), id);
    const rows = mode.summary ? mode.summary(g) : [];
    for (const r of rows) assert.equal(r.length, 2, id);
    if (mode.tip) assert.equal(typeof (mode.tip(g) || ''), 'string');
  }
});
