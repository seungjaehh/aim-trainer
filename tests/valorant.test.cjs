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
for (const file of ['engine.js', 'modes.js', 'valorant.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox);
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

test('단차 배치의 적 자리는 모두 단상 윗면이나 바닥 위에 있다', () => {
  for (const L of Aim.valorant.LAYOUTS) for (const s of L.spots) {
    const under = L.props.filter((p) => Math.abs(s.x - p.x) <= p.w / 2 && Math.abs(s.z - p.z) <= (p.d || p.w) / 2);
    const top = under.reduce((h, p) => Math.max(h, p.h), 0);
    assert.equal(top, s.h, L.id + ' ' + JSON.stringify(s));
  }
});

test('단차 배치는 실제 맵 콜아웃 좌표에서 만들어지고 거리가 보존된다', () => {
  const { LAYOUTS, MAP_SPOTS } = Aim.valorant;
  assert.equal(LAYOUTS.length, MAP_SPOTS.length);
  MAP_SPOTS.forEach((S, i) => {
    const L = LAYOUTS[i];
    assert.ok(L.map && L.from, S.id);
    assert.ok(Math.abs(L.spots[0].x) < 0.06, S.id + ' 첫 자리는 정면');
    S.to.forEach((t, j) => {
      const real = Math.hypot(t[1] - S.from[1], t[2] - S.from[2]) / 100, s = L.spots[j];
      assert.ok(Math.abs(Math.hypot(s.x, s.z) - real) < 0.15, S.id + ' ' + t[0]);
      assert.ok(s.z > 5 && Math.abs(s.x) < 34 && s.z < 46, S.id + ' ' + t[0] + ' 훈련장 안');
    });
  });
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
