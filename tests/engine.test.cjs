const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const ctx = new Proxy({}, { get: (_, key) => key === 'createLinearGradient'
  ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
const Aim = { cfg: { fov: 103, sens: .4, targetSize: 1, bg: 'range', guide: true, chScale: 1 },
  audio: { resetStreak() {}, kill() {}, hit() {} }, crosshair: { draw() {} } };
const sandbox = { window: { Aim, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 } };
vm.createContext(sandbox);
for (const file of ['engine.js', 'modes.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), sandbox);
const game = () => new Aim.Game({ getContext: () => ctx });
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);

test('yaw and pitch share one perspective camera, including oblique views', () => {
  const g = game();
  for (const yaw of [-170,-50,0,45,170]) for (const pitch of [-80,-30,0,30,80]) {
    g.yaw = yaw; g.pitch = pitch;
    const p = g.project(yaw, pitch);
    close(p.x, g.cx); close(p.y, g.cy);
  }
  g.yaw = 0; g.pitch = 30;
  const point = g.project(35, 0), f = g.focal;
  close(point.x - g.cx, f * Math.tan(35*Math.PI/180) / Math.cos(Math.PI/6));
});

test('mouse up looks up; floor moves down; crosshair stays at the center', () => {
  const g = game(), center = [g.cx, g.cy], initial = g.worldPoint(0,0,10);
  g.look(0,-100);
  assert.ok(g.pitch > 0);
  assert.ok(g.worldPoint(0,0,10).y > initial.y);
  assert.deepEqual([g.cx,g.cy], center);
  g.pitch = -30;
  close(g.worldPoint(0,0,g.eyeHeight/Math.tan(Math.PI/6)).y, g.cy);
});

test('bot feet remain on the floor at every viewing angle', () => {
  const g = game(), t = g.bot(20,0,13), p = g.targetPosition(t);
  for (const pitch of [-25,0,25]) {
    g.yaw = 20; g.pitch = pitch;
    const foot = g.botCorners(t, { r: [-.2,1.49,.2,1.6] })[2];
    const floor = g.worldPoint(p.x + .2*Math.cos(Math.PI/9),0,p.z - .2*Math.sin(Math.PI/9));
    close(foot.x,floor.x); close(foot.y,floor.y);
  }
});

test('rendered heads and bodies use the same geometry as hit detection', () => {
  for (const az of [-28,0,28]) {
    const g = game();
    g.reset({ setup() {}, update() {}, onKill() {} });
    g.bot(az,0,9);
    g.yaw = az; g.pitch = 0;
    assert.equal(g.hitAt(true).part, 'head');
    g.fire(); assert.equal(g.stats.kills, 1); assert.equal(g.stats.heads, 1);
    g.cool = 0;
    const body = g.bot(az,0,9);
    const p = g.targetPosition(body);
    g.pitch = Math.atan2(-.5, Math.hypot(p.x,p.z))*180/Math.PI;
    assert.equal(g.hitAt(true).part, 'body');
  }
});

test('near-plane clipping renders looking up, down, sideways and behind', () => {
  const g = game();
  for (const mode of Aim.modes) {
    g.reset(mode);
    for (const yaw of [-179,-90,0,90,179]) for (const pitch of [-85,0,85]) {
      g.yaw = yaw; g.pitch = pitch;
      g.render();
    }
    g.update(.016);
  }
});

test('orbs cannot intersect the floor and cover respects its finite height', () => {
  const g = game(), t = g.orb(0,-20,14,.28);
  assert.ok(g.targetPosition(t).y - t.r > 0);
  g.targets = []; g.wall = { az: 0, side: 1, d: 12 };
  const bot = g.bot(1,0,13);
  g.yaw = 1; assert.equal(g.wallBlocks(bot), true);
  g.pitch = 30; assert.equal(g.wallBlocks(bot), false);
  g.pitch = 0; g.yaw = -1; assert.equal(g.wallBlocks(bot), false);
  for (const az of [-26,0,26]) {
    bot.az = az;
    close(g.targetPosition(bot).z, 13);
  }
});

test('hold bots move at the chosen meters per second on either side of cover', () => {
  const hold = Aim.modes.find((m) => m.id === 'hold');
  for (const profile of Aim.holdSpeeds) for (const side of [-1,1]) {
    Aim.cfg.holdSpeed = profile.id;
    const g = game(); g.reset(hold); g.m.side = side; g.wall.side = side;
    g.t = 3; g.update(0);
    const start = g.targetPosition(g.m.bot), peekAt = g.m.peekAt;
    close(peekAt, 3 + (.65-.085)/profile.speed);
    for (let frame = 0; frame < 10; frame++) g.update(.02);
    const end = g.targetPosition(g.m.bot);
    close(Math.abs(end.x-start.x), profile.speed*.2);
    close(end.z, 12.5);
    close(g.m.speed, profile.speed);
  }
  delete Aim.cfg.holdSpeed;
});

test('crouching hold bots lower the head while both feet remain grounded', () => {
  const g = game(); Aim.cfg.holdSpeed = 'crouch';
  g.reset(Aim.modes.find((m) => m.id === 'hold')); g.t = 3; g.update(0);
  const t = g.m.bot, p = g.targetPosition(t), radians = t.az*Math.PI/180;
  assert.ok(p.y < g.eyeHeight);
  const foot = g.botCorners(t, { r: [-.2,1.49,.2,1.6] })[2];
  const floor = g.worldPoint(p.x + .2*Math.cos(radians), 0, p.z - .2*Math.sin(radians));
  close(foot.x, floor.x); close(foot.y, floor.y);
  delete Aim.cfg.holdSpeed;
});
