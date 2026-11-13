/* 1인칭 에임 엔진: 시점(yaw/pitch), 투영, 타겟, 사격 판정, 렌더링.
   발로란트 감도 규칙: 마우스 1카운트 = 0.07° × 감도. */
(function (A) {
  const YAW = 0.07;
  const rad = (d) => (d * Math.PI) / 180;
  const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* 사격장 봇 (m, 머리 중심 기준 / 아래가 +) — discord_bot 미리보기와 같은 모양 */
  const BOT = [
    { part: 'body', round: false, r: [-0.20, 0.17, 0.20, 0.80], fill: '#606270' },
    { part: 'body', round: false, r: [-0.19, 0.80, 0.19, 0.96], fill: '#434754' },
    { part: 'body', round: true, r: [-0.19, 0.93, -0.035, 1.54], fill: '#555b67' },
    { part: 'body', round: true, r: [0.035, 0.93, 0.19, 1.54], fill: '#555b67' },
    { part: 'body', round: false, r: [-0.22, 1.49, -0.025, 1.60], fill: '#303745' },
    { part: 'body', round: false, r: [0.025, 1.49, 0.22, 1.60], fill: '#303745' },
    { part: 'body', round: true, r: [-0.36, 0.15, -0.18, 0.42], fill: '#787a88' },
    { part: 'body', round: true, r: [0.18, 0.15, 0.36, 0.42], fill: '#787a88' },
    { part: 'body', round: false, r: [-0.035, 0.10, 0.035, 0.19], fill: '#3e3e4a' },
    { part: 'head', round: true, r: [-0.085, -0.12, 0.085, 0.12], fill: '#ced0da' },
  ];
  const HIGHLIGHT = '#d648ec';

  /* 이동·사격 정확도 (연습용 근사).
     감속 시간은 Riot 개발자(Riot_Classick)가 공개한 측정값: 달리다 키를 놓으면 0.170초, 반대 키를 누르면 0.160초에 완전 정지.
     이동 속도가 최고 속도의 30% 이하면 정지와 같은 정확도(데드존), 61% 이하는 걷기 수준 오차로 본다. */
  const MOVE = { run: 5.4, walk: 3.24, accel: 0.2, release: 0.17, counter: 0.16, dead: 0.30, walkPct: 0.61,
    walkErr: 2.0, runErr: 5.0 };
  /* 밴달 연사: 초탄 0.25°, 처음 몇 발은 위로 일정하게 오르고 그 뒤 좌우로 흔들린다. 0.33초 쉬면 초탄으로 돌아온다. */
  const GUN = { rate: 9.75, base: 0.25, reset: 0.33,
    rise: [0, 0.30, 0.85, 1.7, 2.7, 3.7, 4.6, 5.3, 5.8, 6.1, 6.3, 6.45, 6.5] };

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.eyeHeight = 1.6;
      this.yaw = 0; this.pitch = 0;
      this.targets = [];
      this.wall = null;
      this.marks = [];
      this.stats = {};
      this.t = 0;
      this.mouseDown = false;
      this.cool = 0;
      this.kick = 0; this.feed = []; this.pops = []; this.tracers = [];
      this.ammo = Infinity; this.reloading = 0;
      this.pos = { x: 0, z: 0 }; this.vx = 0; this.keys = {}; this.covers = []; this.props = [];
      this.impacts = []; this.spray = { n: 0, last: -9, dir: 1 }; this.hurtT = 0; this.bounds = null;
      this.lastRun = -9; this.stopAt = -9;
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.W = this.canvas.width = Math.floor(window.innerWidth * dpr);
      this.H = this.canvas.height = Math.floor(window.innerHeight * dpr);
      this.cx = Math.floor(this.W / 2);
      this.cy = Math.floor(this.H / 2);
    }

    get focal() { return this.W / 2 / Math.tan(rad(A.cfg.fov / 2)); }

    look(dx, dy) {
      const k = YAW * A.cfg.sens;
      this.yaw = wrap(this.yaw + dx * k);
      this.pitch = Math.max(-85, Math.min(85, this.pitch - dy * k));
    }

    /* 모든 물체와 바닥에 같은 카메라 회전을 적용한다. y는 위쪽이 +. */
    cameraPoint(x, y, z) {
      const yaw = rad(this.yaw), pitch = rad(this.pitch);
      x -= this.pos.x; z -= this.pos.z;
      const rx = Math.cos(yaw) * x - Math.sin(yaw) * z;
      const rz = Math.sin(yaw) * x + Math.cos(yaw) * z;
      const ry = y - this.eyeHeight;
      return { x: rx, y: Math.cos(pitch) * ry - Math.sin(pitch) * rz,
        z: Math.sin(pitch) * ry + Math.cos(pitch) * rz };
    }

    screenPoint(p) {
      if (p.z < 0.12) return null;
      const s = this.focal / p.z;
      return { x: this.cx + p.x * s, y: this.cy - p.y * s, s, depth: p.z };
    }

    worldPoint(x, y, z) { return this.screenPoint(this.cameraPoint(x, y, z)); }

    position(az, el, d) {
      return { x: Math.sin(rad(az)) * Math.cos(rad(el)) * d,
        y: this.eyeHeight + Math.sin(rad(el)) * d,
        z: Math.cos(rad(az)) * Math.cos(rad(el)) * d };
    }

    targetPosition(t) {
      // 봇의 좌우 이동은 같은 거리의 레인 위에서 이뤄져야 엄폐물 앞뒤를 뚫고 나오지 않는다.
      if (t.kind === 'bot') return { x: Math.tan(rad(t.az)) * t.d,
        y: this.eyeHeight + Math.tan(rad(t.el)) * t.d - (t.crouch || 0) + (t.lift || 0), z: t.d };
      const p = this.position(t.az, t.el, t.d);
      if (t.kind === 'orb') p.y = Math.max(t.r + 0.16, p.y);
      return p;
    }

    targetPoint(t) {
      const p = this.targetPosition(t);
      return this.worldPoint(p.x, p.y, p.z);
    }

    /* 기존 모드가 쓰는 각도도 같은 3D 카메라로 투영한다. */
    project(az, el) {
      const p = this.position(az, el, 10);
      return this.worldPoint(p.x + this.pos.x, p.y, p.z + this.pos.z);
    }

    reset(mode) {
      A.audio.resetStreak(); this.kstreak = 0; this.banner = null;
      this.mode = mode;
      this.targets = []; this.wall = null; this.marks = [];
      this.stats = { shots: 0, hits: 0, kills: 0, heads: 0, ttk: 0, score: 0, extra: {},
        shotLog: [], track: { time: 0, ahead: 0, behind: 0, vertical: 0 } };
      this.t = 0; this.cool = 0; this.yaw = 0; this.pitch = 0; this.banner = ''; this.over = false;
      this.kick = 0; this.feed = []; this.pops = []; this.tracers = []; this.reloading = 0;
      this.ammo = Infinity;
      this.pos = { x: 0, z: 0 }; this.vx = 0; this.covers = []; this.props = []; this.bounds = null;
      this.impacts = []; this.spray = { n: 0, last: -9, dir: 1 }; this.hurtT = 0; this.lastRun = -9; this.stopAt = -9;
      mode.setup(this);
    }

    orb(az, el, d, r) {
      const t = { kind: 'orb', az, el, d, r: r * A.cfg.targetSize, hp: 1, born: this.t, vis: true, fromYaw: this.yaw, fromPitch: this.pitch };
      this.targets.push(t);
      return t;
    }
    bot(az, el, d) {
      const t = { kind: 'bot', az, el, d, hp: 100, born: this.t, vis: true, fromYaw: this.yaw, fromPitch: this.pitch };
      this.targets.push(t);
      return t;
    }
    remove(t) { this.targets = this.targets.filter((x) => x !== t); }

    /* 카메라에서 본 타겟(봇은 머리) 중심의 방향과 각 반지름 */
    targetAngles(t) {
      const p = this.targetPosition(t), dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const flat = Math.hypot(dx, dz), dist = Math.hypot(flat, p.y - this.eyeHeight);
      const size = t.kind === 'orb' ? t.r : 0.1;
      return { az: Math.atan2(dx, dz) * 180 / Math.PI, el: Math.atan2(p.y - this.eyeHeight, flat) * 180 / Math.PI,
        r: Math.atan2(size, dist) * 180 / Math.PI };
    }

    /* 조준선이 타겟 중심에서 얼마나 벗어났는지 (도). ex 는 오른쪽, ey 는 위가 + */
    aimError(t) {
      const a = this.targetAngles(t), c = Math.cos(a.el * Math.PI / 180);
      return { ex: wrap(this.yaw - a.az) * c, ey: this.pitch - a.el, r: a.r,
        ax: wrap(a.az - (t.fromYaw ?? this.yaw)) * c, ay: a.el - (t.fromPitch ?? this.pitch), vaz: t.vaz || 0 };
    }

    /* 빗나간 샷은 가장 가까운 타겟을 기준으로 기록한다 */
    logShot(hit) {
      let t = hit && hit.t, best = Infinity;
      if (!t) for (const x of this.targets) {
        if (!x.vis) continue;
        const e = this.aimError(x), d = Math.hypot(e.ex, e.ey);
        if (d < best) { best = d; t = x; }
      }
      if (!t) return;
      const log = this.stats.shotLog;
      log.push(Object.assign(this.aimError(t), { hit: !!hit, part: hit ? hit.part : null, mode: this.mode.id,
        speed: this.speedPct(), n: this.spray.n }));
      if (log.length > 1500) log.shift();
    }

    /* 트래킹: 누르고 있는 동안 타겟보다 앞/뒤/위아래로 벗어난 시간 */
    trackSample(t, dt, on) {
      const tr = this.stats.track;
      tr.time += dt;
      if (on) return;
      const e = this.aimError(t), lead = e.ex * Math.sign(e.vaz || 0);
      if (Math.abs(e.ey) > Math.abs(e.ex)) tr.vertical += dt;
      else if (lead > 0) tr.ahead += dt; else if (lead < 0) tr.behind += dt;
    }

    /* 십자선 위치에 닿는 타겟과 부위 */
    hitAt(onlyVisible, oyaw = 0, opitch = 0) {
      const list = this.targets.slice().sort((a, b) => a.d - b.d);
      const aim = this.aimPoint(oyaw, opitch);
      if (!aim) return null;
      for (const t of list) {
        if (onlyVisible && !t.vis) continue;
        const p = this.targetPoint(t);
        if (!p) continue;
        const s = p.s;
        if (this.wallBlocks(t, oyaw, opitch)) continue;
        if (t.kind === 'orb') {
          const r = t.r * s;
          if ((aim.x - p.x) ** 2 + (aim.y - p.y) ** 2 <= r * r) return { t, part: 'head' };
        } else {
          for (const b of BOT) {
            const corners = this.botCorners(t, b);
            if (corners && this.pointInPolygon(aim.x, aim.y, corners)) return { t, part: b.part };
          }
        }
      }
      return null;
    }

    /* 탄이 실제로 향하는 화면 위치. 반동·이동 오차가 없으면 조준선 그대로다. */
    aimPoint(oyaw = 0, opitch = 0) {
      if (!oyaw && !opitch) return { x: this.cx, y: this.cy };
      return this.project(this.yaw + oyaw, Math.max(-89, Math.min(89, this.pitch + opitch)));
    }

    /* 엄폐물: z 가 일정한 수직 판 { x0, x1, z, h }. 기존 대기샷의 벽도 같은 형식으로 본다. */
    coverList() {
      if (!this.wall) return this.covers;
      const x = Math.tan(rad(this.wall.az)) * this.wall.d, end = this.wall.side * 36;
      return this.covers.concat({ x0: Math.min(x, end), x1: Math.max(x, end), z: this.wall.d, h: 3.6, legacy: true });
    }

    /* 두 점을 잇는 선분이 엄폐물에 막히는지 */
    segmentBlocked(ax, ay, az, bx, by, bz) {
      for (const c of this.coverList()) {
        if ((az - c.z) * (bz - c.z) >= 0) continue;
        const k = (c.z - az) / (bz - az), x = ax + (bx - ax) * k, y = ay + (by - ay) * k;
        if (x >= c.x0 && x <= c.x1 && y >= 0 && y <= c.h) return true;
      }
      return false;
    }

    /* 내 눈에서 봇 머리가 보이는지 (edge: 머리 중심에서 좌우로 벗어난 거리 m) */
    seesHead(t, edge = 0) {
      const p = this.targetPosition(t);
      return !this.segmentBlocked(this.pos.x, this.eyeHeight, this.pos.z, p.x + edge, p.y, p.z);
    }
    /* 봇이 내 몸을 볼 수 있는지. 어깨(몸 폭 0.25m)는 눈보다 먼저 드러난다. */
    seenBy(t) {
      const p = this.targetPosition(t);
      for (const dx of [-0.25, 0, 0.25]) if (!this.segmentBlocked(p.x, p.y, p.z, this.pos.x + dx, 1.35, this.pos.z)) return true;
      return false;
    }

    speedPct() { return Math.abs(this.vx) / MOVE.run; }

    /* A/D 좌우 이동. Shift 는 걷기. 반대 키를 누르면 조금 더 빨리 멈춘다(카운터 스트레이프). */
    movePlayer(dt) {
      const k = this.keys, dir = (k.d ? 1 : 0) - (k.a ? 1 : 0), max = k.shift ? MOVE.walk : MOVE.run;
      const toward = (v, goal, step) => v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step);
      const was = this.speedPct();
      if (dir && this.vx * dir < 0) this.vx += dir * MOVE.run / MOVE.counter * dt;
      else if (dir) this.vx = toward(this.vx, dir * max, MOVE.run / (Math.abs(this.vx) > max ? MOVE.release : MOVE.accel) * dt);
      else this.vx = toward(this.vx, 0, MOVE.run / MOVE.release * dt);
      let x = this.pos.x + this.vx * dt;
      const b = this.bounds;
      if (b && (x < b.x0 || x > b.x1)) { x = Math.max(b.x0, Math.min(b.x1, x)); this.vx = 0; }
      this.pos.x = x;
      const now = this.speedPct();
      if (now >= 0.8) this.lastRun = this.t;
      if (was > MOVE.dead && now <= MOVE.dead) this.stopAt = this.t;
    }

    /* 이번 탄의 조준선 대비 편차(°). 이동 오차는 원뿔 안에서 고르게 퍼진다. */
    bulletOffset() {
      const sp = this.spray, f = this.speedPct();
      if (this.t - sp.last > GUN.reset) { sp.n = 0; sp.dir = Math.random() < 0.5 ? -1 : 1; }
      const n = sp.n;
      let cone = GUN.base + (this.mode.recoil ? Math.min(n, 10) * 0.1 : 0);
      if (f > MOVE.walkPct) cone += MOVE.walkErr + (f - MOVE.walkPct) / (1 - MOVE.walkPct) * (MOVE.runErr - MOVE.walkErr);
      else if (f > MOVE.dead) cone += MOVE.walkErr;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * cone;
      let ox = Math.cos(a) * r, oy = Math.sin(a) * r;
      if (this.mode.recoil) {
        oy += GUN.rise[Math.min(n, GUN.rise.length - 1)];
        if (n >= 7) ox += sp.dir * 1.5 * Math.sin((n - 6) * 0.5);
      }
      sp.n = n + 1; sp.last = this.t;
      return { ox, oy, n, speed: f };
    }

    /* 봇에게 맞았을 때: 화면이 붉어진다 */
    hurt() {
      this.hurtT = 0.45; A.audio.resetStreak(); this.kstreak = 0;
      if (A.audio.hurt) A.audio.hurt();
    }

    wallEdge() {
      if (!this.wall) return null;
      const p = this.project(this.wall.az, 0);
      return p ? { x: p.x, side: this.wall.side } : null;
    }

    wallBlocks(t, oyaw = 0, opitch = 0) {
      const covers = this.coverList();
      if (!covers.length) return false;
      const yaw = rad(this.yaw + oyaw), pitch = rad(this.pitch + opitch), forward = Math.cos(yaw) * Math.cos(pitch);
      if (forward <= 0) return false;
      const tz = this.targetPosition(t).z;
      for (const c of covers) {
        const dz = c.z - this.pos.z;
        if (dz <= 0 || tz <= c.z) continue;
        const distance = dz / forward, x = this.pos.x + Math.sin(yaw) * Math.cos(pitch) * distance;
        const y = this.eyeHeight + Math.sin(pitch) * distance;
        if (x >= c.x0 && x <= c.x1 && y >= 0 && y <= c.h) return true;
      }
      return false;
    }

    /* 탄창·연사 속도가 있는 총을 골랐으면 그 총 (칼 등은 null) */
    gun() { const w = A.weapon; return w && w.rate ? w : (this.mode && this.mode.gun ? { rate: GUN.rate } : null); }

    reload() {
      const w = this.gun();
      if (w && !this.reloading && this.ammo < w.mag) this.reloading = w.reload || 2;
    }

    fire() {
      const w = this.gun();
      if (this.cool > 0 || this.reloading > 0) return;
      if (w && this.ammo <= 0) { this.reload(); return; }
      if (w) this.ammo--;
      // 실전 모드는 초탄 오차·이동 오차·반동을 적용한다. 기본기 모드는 조준선 그대로 맞는다.
      const off = this.mode.gun ? this.bulletOffset() : { ox: 0, oy: 0, n: 0, speed: 0 };
      const aim = this.aimPoint(off.ox, off.oy) || { x: this.cx, y: this.cy };
      if (w && this.muzzle) this.tracers.push({ t: 0.075, life: 0.075, x1: this.muzzle.x, y1: this.muzzle.y, x2: aim.x, y2: aim.y });
      this.cool = w ? Math.max(0.05, 1 / (this.mode.gun ? GUN.rate : w.rate)) : 0.09;
      this.kick = Math.min(1, this.kick + 0.7);
      this.stats.shots++;
      const hit = this.hitAt(true, off.ox, off.oy);
      this.shot = { speed: off.speed, n: off.n, sinceStop: this.t - this.stopAt, sinceRun: this.t - this.lastRun, hit: !!hit };
      if (this.mode.gun) this.impacts.push({ t: 1.4, yaw: this.yaw + off.ox, pitch: this.pitch + off.oy, hit: !!hit });
      this.logShot(hit);
      if (this.mode.onShot) this.mode.onShot(this, this.shot, hit);
      if (w && this.ammo <= 0) this.reload();
      if (!hit) { A.audio.resetStreak(); this.kstreak = 0; if (this.mode.onMiss) this.mode.onMiss(this); return; }  // 한 발이라도 놓치면 킬 소리는 1킬부터

      const { t, part } = hit;
      this.stats.hits++;
      t.hp -= t.kind === 'orb' ? 1 : (part === 'head' ? 160 : (this.mode.gun ? 40 : 34));
      if (t.kind === 'bot') {
        const p = this.targetPoint(t);
        if (p) this.pops.push({ t: 0.7, x: p.x + (Math.random() - 0.5) * 20, y: p.y + (part === 'head' ? -0.55 : 0.1) * p.s, text: part === 'head' ? '160' : '40', head: part === 'head' });
      }
      if (t.hp <= 0) {
        this.stats.kills++;
        if (part === 'head') this.stats.heads++;
        this.stats.ttk += this.t - t.born;
        this.stats.score += part === 'head' ? 150 : 100;
        A.audio.kill(part === 'head');
        this.kstreak = Math.min(5, (this.kstreak || 0) + 1);  // 빗나가거나 맞기 전까지 이어진 킬 수 (최대 5단계)
        this.banner = { t: 1.25, n: this.kstreak, head: part === 'head' };
        this.marks.push({ t: 0.22, kill: true });
        this.feed.push({ t: 4, head: part === 'head' });
        if (this.feed.length > 4) this.feed.shift();
        this.remove(t);
        this.mode.onKill(this, t, part);
      } else {
        A.audio.hit();
        this.marks.push({ t: 0.12, kill: false });
        t.flash = 0.1;
        if (this.mode.onHit) this.mode.onHit(this, t, part);
      }
    }

    update(dt) {
      this.t += dt;
      this.cool = Math.max(0, this.cool - dt);
      if (this.mode.move) this.movePlayer(dt);
      if (this.mouseDown && !this.mode.hold && this.mode.auto) this.fire();
      this.mode.update(this, dt);
      this.hurtT = Math.max(0, this.hurtT - dt);
      if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
      this.impacts = this.impacts.filter((m) => (m.t -= dt) > 0);
      for (const t of this.targets) {
        if (t.flash) t.flash = Math.max(0, t.flash - dt);
        if (t.muzzle) t.muzzle = Math.max(0, t.muzzle - dt);
        // 좌우 각속도(°/s): 움직이는 타겟을 앞서/뒤처져 쐈는지 판단할 때 쓴다
        const az = this.targetAngles(t).az;
        if (t.lastAz != null && dt > 0) t.vaz = t.vaz == null ? (az - t.lastAz) / dt : t.vaz * 0.7 + ((az - t.lastAz) / dt) * 0.3;
        t.lastAz = az;
      }
      this.marks = this.marks.filter((m) => (m.t -= dt) > 0);
      this.pops = this.pops.filter((m) => (m.t -= dt) > 0);
      this.tracers = this.tracers.filter((m) => (m.t -= dt) > 0);
      this.feed = this.feed.filter((m) => (m.t -= dt) > 0);
      this.kick = Math.max(0, this.kick - dt * 6);
      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) { this.reloading = 0; this.ammo = Infinity; }
      }
    }

    /* ---- 그리기 ---- */
    /* 카메라 뒤로 넘어가는 바닥/벽은 근평면에서 잘라 화면 뒤집힘을 막는다. */
    polygon(points, fill, stroke) {
      const near = 0.12, input = points.map((p) => this.cameraPoint(...p)), clipped = [];
      for (let i = 0; i < input.length; i++) {
        const a = input[i], b = input[(i + 1) % input.length];
        if (a.z >= near) clipped.push(a);
        if ((a.z >= near) !== (b.z >= near)) {
          const t = (near - a.z) / (b.z - a.z);
          clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
        }
      }
      if (clipped.length < 3) return;
      const screen = clipped.map((p) => this.screenPoint(p));
      const { ctx } = this;
      ctx.beginPath();
      screen.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, this.H / 1080); ctx.stroke(); }
    }

    pointInPolygon(x, y, corners) {
      let inside = false;
      for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const a = corners[i], b = corners[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }

    botCorners(t, b, grow = 0) {
      const p = this.targetPosition(t), [x0, y0, x1, y1] = b.r;
      // 각 봇은 카메라 위치를 향하는 수직 평면. 시점을 위아래로 돌려도 발은 바닥에 고정된다.
      const face = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
      const right = { x: Math.cos(face), z: -Math.sin(face) };
      const points = [[x0 - grow, y0 - grow], [x1 + grow, y0 - grow], [x1 + grow, y1 + grow], [x0 - grow, y1 + grow]]
        .map(([x, y]) => {
          // 앉기는 머리 크기를 줄이지 않고 다리를 접어 발이 계속 바닥에 닿게 한다.
          const bodyY = y > .8 ? y - (t.crouch || 0) * (y - .8) / .8 : y;
          return this.worldPoint(p.x + right.x * x, p.y - bodyY, p.z + right.z * x);
        });
      return points.every(Boolean) ? points : null;
    }

    background() {
      const { ctx, W, H } = this;
      const themes = {
        dark: ['#242a38', '#10131a', 'rgba(255,255,255,0.05)'],
        wall: ['#b8b2a6', '#9c968a', 'rgba(0,0,0,0.08)'],
        sky: ['#7db3ec', '#4f86c4', 'rgba(255,255,255,0.12)'],
        grass: ['#5c9462', '#3f6e46', 'rgba(255,255,255,0.1)'],
      };
      if (A.cfg.bg !== 'grid') { this.rangeBackground(); return; }
      const [a, b, line] = themes[A.cfg.bg] || themes.dark;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, a); grad.addColorStop(1, b);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = line; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let az = -180; az < 180; az += 10) {
        const p = this.project(az, 0);
        if (p) { ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, H); }
      }
      for (let el = -80; el <= 80; el += 10) {
        const p = this.project(this.yaw, el);
        if (p) { ctx.moveTo(0, Math.round(p.y) + 0.5); ctx.lineTo(W, Math.round(p.y) + 0.5); }
      }
      ctx.stroke();
    }

    /* 고정된 눈높이의 실내 연습장. 바닥 타일·거리선·벽을 같은 월드 좌표로 그린다. */
    rangeBackground() {
      const { ctx, W, H } = this;
      const dark = A.cfg.bg === 'dark';
      ctx.fillStyle = dark ? '#1b242c' : '#737e86'; ctx.fillRect(0, 0, W, H);
      this.polygon([[-36,10,-48],[36,10,-48],[36,10,48],[-36,10,48]], '#26323b');
      // 정면·후면·양옆 벽. 가장자리에서 바닥과 정확히 맞닿는다.
      for (const side of [-1, 1]) {
        const z = side * 48;
        for (let x = -36; x < 36; x += 6) {
          this.polygon([[x,0,z],[x+6,0,z],[x+6,10,z],[x,10,z]], dark ? '#303c47' : '#89949b', '#66717a');
          this.polygon([[x,0,z],[x+6,0,z],[x+6,1.2,z],[x,1.2,z]], '#3c4a55');
          this.polygon([[x,1.59,z-side*.02],[x+6,1.59,z-side*.02],[x+6,1.64,z-side*.02],[x,1.64,z-side*.02]], '#c78e66');
          this.polygon([[x,0,z-side*.03],[x+.18,0,z-side*.03],[x+.18,10,z-side*.03],[x,10,z-side*.03]], '#35434e');
        }
        const x = side * 36;
        for (let z = -48; z < 48; z += 8) {
          this.polygon([[x,0,z],[x,0,z+8],[x,10,z+8],[x,10,z]], dark ? '#263540' : '#697a85', '#52636e');
          this.polygon([[x-side*.02,1.59,z],[x-side*.02,1.59,z+8],[x-side*.02,1.64,z+8],[x-side*.02,1.64,z]], '#c78e66');
          this.polygon([[x-side*.03,0,z],[x-side*.03,0,z+.22],[x-side*.03,10,z+.22],[x-side*.03,10,z]], '#35434e');
        }
      }
      // 타일 크기는 4m. 시선에 따라 소실점도 함께 움직인다.
      for (let x = -36; x < 36; x += 4) for (let z = -48; z < 48; z += 4) {
        const checker = ((x + 36) / 4 + (z + 48) / 4) % 2;
        const fade = Math.min(1, Math.hypot(x + 2, z + 2) / 55);
        const v = Math.round((dark ? 66 : 103) - fade * 13 + checker * 4);
        this.polygon([[x,0,z],[x+4,0,z],[x+4,0,z+4],[x,0,z+4]], `rgb(${v},${v+10},${v+15})`, dark ? '#38444d' : '#53616a');
      }
      // 사격 레인과 거리 표시: 바닥 높이에 붙어 있어 상하 시점의 기준이 된다.
      for (const x of [-5, 5]) this.polygon([[x-.025,.008,0],[x+.025,.008,0],[x+.025,.008,40],[x-.025,.008,40]], '#94a6ad');
      for (const d of [5, 10, 15, 20, 30, 40]) {
        this.polygon([[-5,.012,d-.025],[5,.012,d-.025],[5,.012,d+.025],[-5,.012,d+.025]], '#a8b4b4');
        this.floorText(d + ' m', -5.8, d, '#cbd3d0');
        this.floorText(d + ' m', 5.8, d, '#cbd3d0');
      }
      // 발밑 사격선과 천장 조명. 과한 카메라 흔들림 없이 고정된 공간 기준만 제공한다.
      this.polygon([[-8,.015,1.9],[8,.015,1.9],[8,.015,2.06],[-8,.015,2.06]], '#d6a369');
      for (const z of [-32, -16, 0, 16, 32]) {
        this.polygon([[-36,9.7,z],[36,9.7,z],[36,9.7,z+.35],[-36,9.7,z+.35]], '#192831');
        for (const x of [-10, 10]) this.polygon([[x-1.6,9.65,z],[x+1.6,9.65,z],[x+1.6,9.65,z+.2],[x-1.6,9.65,z+.2]], '#dbe7dc');
      }
      const sign = this.worldPoint(0, 5.4, 47.9);
      if (sign && sign.depth > 4) {
        ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#e6e8df';
        ctx.font = '600 ' + Math.max(1, 1.2 * sign.s) + 'px system-ui, sans-serif';
        ctx.fillText('PRACTICE RANGE', sign.x, sign.y);
        ctx.font = '500 ' + Math.max(1, .35 * sign.s) + 'px system-ui, sans-serif'; ctx.fillStyle = '#c1ccc9';
        ctx.fillText('AIM  /  FOCUS  /  REPEAT', sign.x, sign.y + .8 * sign.s); ctx.restore();
      }
    }

    floorText(text, x, z, color) {
      const a = this.worldPoint(x - .65, .02, z + .5), b = this.worldPoint(x + .65, .02, z + .5), c = this.worldPoint(x - .65, .02, z - .5);
      if (!a || !b || !c) return;
      const ctx = this.ctx;
      ctx.save(); ctx.transform((b.x-a.x)/120, (b.y-a.y)/120, (c.x-a.x)/70, (c.y-a.y)/70, a.x, a.y);
      ctx.fillStyle = color; ctx.font = '600 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 60, 35); ctx.restore();
    }

    drawShadow(t) {
      const p = this.targetPosition(t), radius = t.kind === 'bot' ? .46 : t.r * 1.1;
      const alpha = t.kind === 'bot' ? .32 : .20 / (1 + p.y * .2);
      const points = [];
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12;
        points.push([p.x + Math.cos(a) * radius, .025, p.z + Math.sin(a) * radius * .65]);
      }
      this.polygon(points, `rgba(8,16,24,${alpha})`);
    }

    drawBot(t) {
      const p = this.targetPoint(t);
      if (!p) return;
      const { ctx } = this, g = .018;
      const path = (b, grow) => {
        const corners = this.botCorners(t, b, grow);
        if (!corners) return;
        ctx.beginPath();
        corners.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
        ctx.fill();
      };
      ctx.fillStyle = HIGHLIGHT;
      for (const b of BOT) path(b, g);
      for (const b of BOT) { ctx.fillStyle = t.flash ? '#ffffff' : b.fill; path(b, 0); }
    }

    drawOrb(t) {
      const p = this.targetPoint(t);
      if (!p) return;
      const r = t.r * p.s, { ctx } = this;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.flash ? '#ffffff' : (t.color || '#3fd7ff');
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.strokeStyle = HIGHLIGHT; ctx.stroke();
    }

    drawWall() {
      if (!this.wall) return;
      const { d, side, az } = this.wall, x = Math.tan(rad(az)) * d, end = side * 36;
      this.polygon([[x,0,d],[end,0,d],[end,3.6,d],[x,3.6,d]], '#3b4b57', '#778994');
      this.polygon([[x,0,d-.015],[x+side*.09,0,d-.015],[x+side*.09,3.6,d-.015],[x,3.6,d-.015]], '#a7b3b5');
      this.polygon([[x,0,d],[end,0,d],[end,0,d+.45],[x,0,d+.45]], '#283843');
      if (A.cfg.guide) this.polygon([[x,1.58,d-.025],[x+side*.65,1.58,d-.025],[x+side*.65,1.62,d-.025],[x,1.62,d-.025]], '#deb17b');
    }

    render() {
      const { ctx } = this;
      // 3D 장면이 켜져 있으면 공간·봇은 WebGL 이 그리고, 이 캔버스는 투명한 HUD 층이 된다.
      this.gl = !!(A.scene3d && A.scene3d.active && A.scene3d.active());
      if (this.gl) { ctx.clearRect(0, 0, this.W, this.H); A.scene3d.render(this); }
      else this.drawWorld();
      this.drawImpacts(ctx);
      if (this.mode.draw) this.mode.draw(this, ctx);
      if (this.mode.move) this.drawSpeed(ctx);
      if (this.hurtT > 0) {
        const g = ctx.createRadialGradient(this.cx, this.cy, this.H * 0.2, this.cx, this.cy, this.H * 0.75);
        g.addColorStop(0, 'rgba(255,40,50,0)'); g.addColorStop(1, 'rgba(255,40,50,' + Math.min(0.75, this.hurtT * 2.2) + ')');
        ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
      }
      // 히트마커
      for (const m of this.marks) {
        const a = Math.min(1, m.t * 6), n = m.kill ? 12 : 8, g = 5;
        ctx.strokeStyle = (m.kill ? 'rgba(255,70,70,' : 'rgba(255,255,255,') + a + ')';
        ctx.lineWidth = 2; ctx.beginPath();
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          ctx.moveTo(this.cx + sx * g, this.cy + sy * g);
          ctx.lineTo(this.cx + sx * (g + n), this.cy + sy * (g + n));
        }
        ctx.stroke();
      }
      this.drawPops(ctx);
      this.drawBanner(ctx);
      this.drawWeapon(ctx);
      this.drawTracers(ctx);
      A.crosshair.draw(ctx, this.cx, this.cy, A.crossData, A.cfg.chScale);
      this.drawFeed(ctx);
      this.drawOrientation(ctx);
    }

    /* 킬 배너. 스킨 매니페스트에 banners 이미지가 있으면 그것을, 없으면 직접 그린 배너를 쓴다.
       (직접 그린 배너는 이 프로젝트 고유 도안이며 게임 원본 배너가 아니다) */
    drawBanner(ctx) {
      const b = this.banner;
      if (!b || A.cfg.banner === 'off') return;
      const k = this.H / 1080, age = 1.25 - b.t;
      const pop = age < 0.12 ? 0.6 + 0.4 * (age / 0.12) : 1, alpha = Math.min(1, b.t / 0.3);
      const x = this.cx, y = this.H * 0.76, r = 54 * k * pop;
      const imgs = A.weapon && A.weapon.banners, img = imgs && imgs[Math.min(b.n, imgs.length) - 1];
      ctx.save(); ctx.globalAlpha = alpha;
      if (img && img.complete && img.naturalWidth) {
        const h = 190 * k * pop, w = h * img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
        ctx.restore(); return;
      }
      const hot = b.head ? '255,205,96' : '255,84,96';
      ctx.fillStyle = 'rgba(10,14,20,.82)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 4 * k; ctx.strokeStyle = 'rgba(' + hot + ',.95)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      // 바깥 고리: 처음에 퍼졌다 사라진다
      ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(' + hot + ',' + Math.max(0, 0.7 - age * 2.2) + ')';
      ctx.beginPath(); ctx.arc(x, y, r + age * 90 * k, 0, Math.PI * 2); ctx.stroke();
      // 가운데 마름모 (헤드샷은 채우고, 몸샷은 테두리만)
      const d = 20 * k * pop;
      ctx.beginPath(); ctx.moveTo(x, y - d); ctx.lineTo(x + d * 0.72, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d * 0.72, y); ctx.closePath();
      ctx.fillStyle = 'rgba(' + hot + ',1)'; ctx.strokeStyle = 'rgba(' + hot + ',1)'; ctx.lineWidth = 3 * k;
      if (b.head) ctx.fill(); else ctx.stroke();
      // 연속 킬 수만큼 위쪽에 점이 켜진다
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.42, px = x + Math.cos(a) * (r + 16 * k), py = y + Math.sin(a) * (r + 16 * k);
        ctx.fillStyle = i < b.n ? 'rgba(' + hot + ',1)' : 'rgba(255,255,255,.22)';
        ctx.beginPath(); ctx.arc(px, py, 5 * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(240,244,246,.95)'; ctx.textAlign = 'center';
      ctx.font = '700 ' + Math.round(17 * k) + 'px system-ui, sans-serif';
      ctx.fillText((b.head ? '헤드샷 ' : '') + b.n + '킬', x, y + r + 34 * k);
      ctx.restore();
    }

    drawCover(c) {
      const { x0, x1, z, h } = c;
      this.polygon([[x0,0,z],[x1,0,z],[x1,h,z],[x0,h,z]], '#3b4b57', '#778994');
      for (const [x, s] of [[x0, 1], [x1, -1]]) {
        if (Math.abs(x) > 30) continue;
        this.polygon([[x,0,z-.015],[x+s*.08,0,z-.015],[x+s*.08,h,z-.015],[x,h,z-.015]], '#a7b3b5');
        if (A.cfg.guide) this.polygon([[x,1.58,z-.025],[x+s*.45,1.58,z-.025],[x+s*.45,1.62,z-.025],[x,1.62,z-.025]], '#deb17b');
      }
    }

    /* 봇이 올라서는 상자 { x, z, w, h } */
    drawProp(b) {
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.w / 2, z1 = b.z + b.w / 2, h = b.h;
      for (const x of [x0, x1]) this.polygon([[x,0,z0],[x,0,z1],[x,h,z1],[x,h,z0]], '#6f5a41', '#3d3226');
      this.polygon([[x0,h,z0],[x1,h,z0],[x1,h,z1],[x0,h,z1]], '#a8895f', '#3d3226');
      this.polygon([[x0,0,z0],[x1,0,z0],[x1,h,z0],[x0,h,z0]], '#8d7350', '#3d3226');
    }

    drawWorld() {
      this.background();
      if (A.cfg.bg !== 'grid') for (const t of this.targets) if (t.vis && !t.lift) this.drawShadow(t);
      const items = this.targets.filter((t) => t.vis).map((t) => ({ z: this.targetPosition(t).z, t }))
        .concat(this.covers.map((c) => ({ z: c.z, c })), this.props.map((b) => ({ z: b.z + 0.01, b })));
      if (this.wall) items.push({ z: this.wall.d, wall: true });
      items.sort((a, b) => b.z - a.z);
      for (const it of items) {
        if (it.wall) this.drawWall(); else if (it.c) this.drawCover(it.c); else if (it.b) this.drawProp(it.b);
        else if (it.t.kind === 'orb') this.drawOrb(it.t); else this.drawBot(it.t);
      }
    }

    /* 탄착점: 반동과 이동 오차로 탄이 조준선에서 얼마나 벗어났는지 보여 준다 */
    drawImpacts(ctx) {
      const k = Math.max(1, this.H / 1080);
      for (const m of this.impacts) {
        const p = this.project(m.yaw, Math.max(-89, Math.min(89, m.pitch)));
        if (!p) continue;
        ctx.globalAlpha = Math.min(1, m.t * 1.5);
        ctx.fillStyle = m.hit ? '#ffe9a8' : '#ff8a5c';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* 이동 속도 막대: 초록(30% 이하)에서만 초탄이 정확하다 */
    drawSpeed(ctx) {
      const k = Math.max(1, this.H / 1080), f = this.speedPct(), w = 180 * k, x = this.cx - w / 2, y = this.cy + 150 * k;
      ctx.fillStyle = 'rgba(12,22,29,.6)'; ctx.fillRect(x, y, w, 8 * k);
      ctx.fillStyle = f <= MOVE.dead ? '#6be08b' : f <= MOVE.walkPct ? '#f0b44c' : '#ff4655';
      ctx.fillRect(x, y, w * Math.min(1, f), 8 * k);
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(x + w * MOVE.dead - k, y - 3 * k, 2 * k, 14 * k);
      ctx.font = '500 ' + Math.round(12 * k) + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220,230,232,.85)';
      ctx.fillText(f <= MOVE.dead ? '정확' : f <= MOVE.walkPct ? '걷기 오차' : '달리기 오차', this.cx, y + 26 * k);
    }

    drawOrientation(ctx) {
      const k = this.H / 1080, x = 28 * k, y = this.H - 36 * k;
      ctx.save(); ctx.textAlign = 'left'; ctx.font = '500 ' + Math.round(14*k) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(12,22,29,.65)'; ctx.fillRect(x-10*k,y-24*k,230*k,48*k);
      ctx.fillStyle = '#b8c9ce'; ctx.fillText('시선', x, y);
      ctx.fillStyle = Math.abs(this.pitch) < 1 ? '#78ddca' : '#e1e7e5';
      const label = Math.abs(this.pitch) < 1 ? '수평  0°' : (this.pitch > 0 ? '위  +' : '아래  −') + Math.abs(this.pitch).toFixed(1) + '°';
      ctx.fillText(label, x+42*k, y); ctx.restore();
    }

    /* 오른쪽 아래 무기: 쏘면 반동, 재장전하면 아래로 내려간다. 탄약 숫자도 같이 */
    drawWeapon(ctx) {
      const w = A.weapon;
      if (!w) return;
      const { W, H } = this, k = H / 1080;
      const img = w.img && w.img.complete && w.img.naturalWidth ? w.img : null;
      if (img && w.fp) {  // 내가 올린 1인칭 총: 오른쪽 아래 모서리에 붙여 그린다
        const tw = Math.min(W * 0.5, 900 * k), th = tw * img.naturalHeight / img.naturalWidth;
        const dip = this.reloading > 0 && w.reload ? Math.sin(Math.PI * (1 - this.reloading / w.reload)) : 0;
        const ox = W - tw + 20 * k - this.kick * 26 * k, oy = H - th + 30 * k + this.kick * 22 * k + dip * 260 * k;
        ctx.drawImage(img, ox, oy, tw, th);
        const muzzle = w.muzzle || { x: 0.17, y: 0.1 };
        this.muzzle = { x: ox + tw * muzzle.x, y: oy + th * muzzle.y };
      } else if (img) {
        const tw = Math.min(W * 0.34, 640 * k), th = tw * img.naturalHeight / img.naturalWidth;
        const dip = this.reloading > 0 && w.reload ? Math.sin(Math.PI * (1 - this.reloading / w.reload)) : 0;
        ctx.save();
        this.muzzle = { x: W - tw * 0.95, y: H - th * 0.5 };
        ctx.translate(W - tw * 0.52 - this.kick * 28 * k, H - th * 0.3 + this.kick * 24 * k + dip * 170 * k);
        ctx.rotate(rad(-8 - this.kick * 4 + dip * 12));
        ctx.drawImage(img, -tw / 2, -th / 2, tw, th);
        ctx.restore();
      }
      const font = (px, wt) => wt + ' ' + Math.round(px * k) + 'px Rajdhani, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
      ctx.font = font(18, 600); ctx.fillStyle = 'rgba(255,70,85,.95)';
      ctx.fillText(w.title || '', W - 36 * k, H - 16 * k);
      ctx.shadowBlur = 0;
    }

    /* 오른쪽 위 킬로그 (발로란트처럼 내 이름·무기·상대) */
    drawFeed(ctx) {
      const { W } = this, k = this.H / 1080, w = A.weapon;
      const fi = w && (w.feedImg || w.img);
      const img = fi && fi.complete && fi.naturalWidth ? fi : null;
      let y = 90 * k;
      ctx.font = '600 ' + Math.round(20 * k) + 'px Rajdhani, system-ui, sans-serif';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (const f of this.feed) {
        const rowH = 34 * k, iw = img ? 96 * k : 0;
        const ih = img ? Math.min(iw * img.naturalHeight / img.naturalWidth, rowH - 6 * k) : 0;
        const tw = 120 * k + iw + (f.head ? 70 * k : 0), x = W - 24 * k - tw;
        ctx.globalAlpha = Math.min(1, f.t * 2);
        ctx.fillStyle = 'rgba(15,25,35,.82)'; ctx.fillRect(x, y, tw, rowH);
        ctx.fillStyle = '#ff4655'; ctx.fillRect(x, y, 3 * k, rowH);
        ctx.fillStyle = '#ece8e1';
        let px = x + 12 * k;
        ctx.fillText('나', px, y + rowH / 2); px += 26 * k;
        if (img) { ctx.drawImage(img, px, y + (rowH - ih) / 2, iw, ih); px += iw + 8 * k; }
        ctx.fillText('봇', px, y + rowH / 2); px += 34 * k;
        if (f.head) { ctx.fillStyle = '#ff4655'; ctx.fillText('헤드샷', px, y + rowH / 2); }
        y += rowH + 6 * k;
      }
      ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
    }

    /* 발사 순간 총구와 조준점을 잇는 직선 전체를 짧게 표시한 뒤 밝기만 줄인다. */
    drawTracers(ctx) {
      const k = this.H / 1080;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const m of this.tracers) {
        if (m.t <= 0) continue;
        const alpha = Math.min(1, m.t / m.life);
        // 반동 중인 현재 총구와 맞춰, 위쪽 가늠쇠가 아닌 실제 총열 구멍에서 시작한다.
        const origin = this.muzzle || { x: m.x1, y: m.y1 };
        const g = ctx.createLinearGradient(origin.x, origin.y, m.x2, m.y2);
        g.addColorStop(0, 'rgba(255,210,100,0.7)'); g.addColorStop(1, 'rgba(255,245,205,0.95)');
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, 4.8 * k * (.8 + .2 * alpha));
        ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(m.x2, m.y2); ctx.stroke();
      }
      ctx.restore();
    }

    drawPops(ctx) {
      const k = this.H / 1080;
      ctx.textAlign = 'center';
      for (const p of this.pops) {
        const rise = (0.7 - p.t) * 60 * k;
        ctx.globalAlpha = Math.min(1, p.t * 3);
        ctx.font = '700 ' + Math.round((p.head ? 30 : 22) * k) + 'px Rajdhani, system-ui, sans-serif';
        ctx.fillStyle = p.head ? '#ff4655' : '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
        ctx.strokeText(p.text, p.x, p.y - rise); ctx.fillText(p.text, p.x, p.y - rise);
      }
      ctx.globalAlpha = 1;
    }
  }

  A.Game = Game;
  A.util = { rand, pick, wrap, rad };
  A.MOVE = MOVE; A.GUN = GUN; A.BOT = BOT;
})(window.Aim = window.Aim || {});
