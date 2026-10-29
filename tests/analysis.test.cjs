const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ctx = new Proxy({}, { get: (_, key) => key === 'createLinearGradient'
  ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const store = {};
const Aim = { cfg: { fov: 103, sens: .4, targetSize: 1, bg: 'range', guide: true, chScale: 1, holdSpeed: 'random' },
  audio: { resetStreak() {}, kill() {}, hit() {} }, crosshair: { draw() {} } };
const sandbox = { window: { Aim, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
vm.createContext(sandbox);
for (const file of ['engine.js', 'modes.js', 'analysis.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox);
const AN = Aim.analysis;
const game = () => new Aim.Game({ getContext: () => ctx });
const plain = { id: 'test', setup() {}, update() {}, onKill() {} };

test('a miss is logged against the nearest target in degrees', () => {
  const g = game();
  g.reset(plain);
  g.orb(10, 0, 14, .3);
  g.yaw = 12; g.pitch = 1;  // 오른쪽 위로 빗나감
  g.fire();
  const s = g.stats.shotLog[0];
  assert.equal(s.hit, false);
  assert.ok(Math.abs(s.ex - 2) < .05, s.ex);
  assert.ok(Math.abs(s.ey - 1) < .05, s.ey);
  assert.ok(Math.abs(s.ax - 10) < .05, 'travel from where the player looked when it spawned');
});

test('overflicks and underflicks are told apart along the travel direction', () => {
  const r = .5, over = { ex: 2, ey: 0, ax: 30, ay: 0, r, vaz: 0, hit: false };
  const under = { ex: 2, ey: 0, ax: -30, ay: 0, r, vaz: 0, hit: false };  // 왼쪽으로 휘둘러 덜 감
  const a = AN.shots([over, over, over, over, under]);
  assert.equal(a.overPct, 80); assert.equal(a.underPct, 20);
  assert.match(a.tip, /지나쳐요/);
});

test('shooting behind a moving target is detected', () => {
  const behind = { ex: -1.2, ey: 0, ax: 0, ay: 0, r: .4, vaz: 10, hit: false };
  const a = AN.shots([behind, behind, behind, behind]);
  assert.equal(a.behindPct, 100);
  assert.match(a.tip, /뒤를 쏴요/);
});

test('sensitivity is lowered when the first motion overshoots, within limits', () => {
  const over = AN.recommendSens(.4, Array(12).fill(1.1));
  assert.ok(over.enough && over.next < .4 && over.next >= .32, String(over.next));
  const under = AN.recommendSens(.4, Array(12).fill(.8));
  assert.ok(under.next > .4 && under.next <= .5, String(under.next));
  assert.equal(AN.recommendSens(.4, Array(12).fill(.95)).steady, true);
  assert.equal(AN.recommendSens(.4, [1, 1]).enough, false);
});

test('the sensitivity mode measures where the first flick stops', () => {
  const g = game(), mode = Aim.modes.find((m) => m.id === 'sens');
  g.reset(mode);
  for (let i = 0; i < 30; i++) g.update(1 / 60);  // 손을 멈추고 있으면 타겟이 뜬다
  const t = g.m.trial.t, a = g.targetAngles(t);
  // 타겟 방향으로 한 번에 90%까지 휘두르고 멈춘다
  const steps = 12, dy = (a.az - g.yaw) * .9 / steps, dp = (a.el - g.pitch) * .9 / steps;
  for (let i = 0; i < steps; i++) { g.yaw += dy; g.pitch += dp; g.update(1 / 60); }
  for (let i = 0; i < 10; i++) g.update(1 / 60);
  assert.equal(g.m.ratios.length, 1);
  assert.ok(Math.abs(g.m.ratios[0] - .9) < .03, String(g.m.ratios[0]));
});

test('history keeps per-mode averages and a daily streak', () => {
  const H = AN.history;
  H.reset({});
  for (const score of [100, 200, 300]) H.add('grid', { score });
  assert.equal(H.average('grid', 2), 250);
  assert.equal(H.average('grid', 10, 1), 150);
  const day = 864e5, now = Date.now();
  H.reset({ routine: [{ at: now - 2 * day, score: 100 }, { at: now - day, score: 100 }, { at: now, score: 100 }] });
  assert.equal(H.streak(now), 3);
});
