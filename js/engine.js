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
        y: this.eyeHeight + Math.tan(rad(t.el)) * t.d, z: t.d };
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
      return this.worldPoint(p.x, p.y, p.z);
    }

    reset(mode) {
      this.mode = mode;
      this.targets = []; this.wall = null; this.marks = [];
      this.stats = { shots: 0, hits: 0, kills: 0, heads: 0, ttk: 0, score: 0, extra: {} };
      this.t = 0; this.cool = 0; this.yaw = 0; this.pitch = 0; this.banner = '';
      this.kick = 0; this.feed = []; this.pops = []; this.tracers = []; this.reloading = 0;
      this.ammo = Infinity;
      mode.setup(this);
    }

    orb(az, el, d, r) {
      const t = { kind: 'orb', az, el, d, r: r * A.cfg.targetSize, hp: 1, born: this.t, vis: true };
      this.targets.push(t);
      return t;
    }
    bot(az, el, d) {
      const t = { kind: 'bot', az, el, d, hp: 100, born: this.t, vis: true };
      this.targets.push(t);
      return t;
    }
    remove(t) { this.targets = this.targets.filter((x) => x !== t); }

    /* 십자선 위치에 닿는 타겟과 부위 */
    hitAt(onlyVisible) {
      const list = this.targets.slice().sort((a, b) => a.d - b.d);
      for (const t of list) {
        if (onlyVisible && !t.vis) continue;
        const p = this.targetPoint(t);
        if (!p) continue;
        const s = p.s;
        if (this.wallBlocks(t)) continue;
        if (t.kind === 'orb') {
          const r = t.r * s;
          if ((this.cx - p.x) ** 2 + (this.cy - p.y) ** 2 <= r * r) return { t, part: 'head' };
        } else {
          for (const b of BOT) {
            const corners = this.botCorners(t, b);
            if (corners && this.pointInPolygon(this.cx, this.cy, corners)) return { t, part: b.part };
          }
        }
      }
      return null;
    }

    wallEdge() {
      if (!this.wall) return null;
      const p = this.project(this.wall.az, 0);
      return p ? { x: p.x, side: this.wall.side } : null;
    }

    wallBlocks(t) {
      if (!this.wall) return false;
      const wall = this.wall, forward = Math.cos(rad(this.yaw)) * Math.cos(rad(this.pitch));
      if (forward <= 0) return false;
      const distance = wall.d / forward, x = Math.sin(rad(this.yaw)) * Math.cos(rad(this.pitch)) * distance;
      const y = this.eyeHeight + Math.sin(rad(this.pitch)) * distance;
      const edge = Math.tan(rad(wall.az)) * wall.d;
      return this.targetPosition(t).z > wall.d && (x-edge)*wall.side >= 0 && Math.abs(x) <= 36 && y >= 0 && y <= 3.6;
    }

    /* 탄창·연사 속도가 있는 총을 골랐으면 그 총 (칼 등은 null) */
    gun() { const w = A.weapon; return w && w.rate ? w : null; }

    reload() {
      const w = this.gun();
      if (w && !this.reloading && this.ammo < w.mag) this.reloading = w.reload || 2;
    }

    fire() {
      const w = this.gun();
      if (this.cool > 0 || this.reloading > 0) return;
      if (w && this.ammo <= 0) { this.reload(); return; }
      if (w) this.ammo--;
      if (w && this.muzzle) this.tracers.push({ t: 0.12, life: 0.12, x1: this.muzzle.x, y1: this.muzzle.y, x2: this.cx, y2: this.cy });
      this.cool = w ? Math.max(0.05, 1 / w.rate) : 0.09;
      this.kick = Math.min(1, this.kick + 0.7);
      this.stats.shots++;
      const hit = this.hitAt(true);
      if (w && this.ammo <= 0) this.reload();
      if (!hit) { A.audio.resetStreak(); if (this.mode.onMiss) this.mode.onMiss(this); return; }  // 한 발이라도 놓치면 킬 소리는 1킬부터

      const { t, part } = hit;
      this.stats.hits++;
      t.hp -= t.kind === 'orb' ? 1 : (part === 'head' ? 100 : 34);
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
      if (this.mouseDown && !this.mode.hold && this.mode.auto) this.fire();
      this.mode.update(this, dt);
      for (const t of this.targets) if (t.flash) t.flash = Math.max(0, t.flash - dt);
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
      const right = { x: Math.cos(rad(t.az)), z: -Math.sin(rad(t.az)) };
      const points = [[x0 - grow, y0 - grow], [x1 + grow, y0 - grow], [x1 + grow, y1 + grow], [x0 - grow, y1 + grow]]
        .map(([x, y]) => this.worldPoint(p.x + right.x * x, p.y - y, p.z + right.z * x));
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
      this.background();
      if (A.cfg.bg !== 'grid') for (const t of this.targets) if (t.vis) this.drawShadow(t);
      let wallDrawn = false;
      for (const t of this.targets.slice().sort((a, b) => b.d - a.d)) {
        if (this.wall && !wallDrawn && this.targetPosition(t).z < this.wall.d) { this.drawWall(); wallDrawn = true; }
        if (!t.vis) continue;
        if (t.kind === 'orb') this.drawOrb(t); else this.drawBot(t);
      }
      if (!wallDrawn) this.drawWall();
      if (this.mode.draw) this.mode.draw(this, ctx);
      // 조준선
      A.crosshair.draw(ctx, this.cx, this.cy, A.crossData, A.cfg.chScale);
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
      this.drawWeapon(ctx);
      this.drawTracers(ctx);
      this.drawFeed(ctx);
      this.drawOrientation(ctx);
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

    /* 맞힌 곳에서 떠오르는 피해량 숫자 */
    /* 총알 궤적: 발로란트처럼 총구에서 조준점으로 빠르게 날아가는 짧고 밝은 노란 줄 */
    drawTracers(ctx) {
      const k = this.H / 1080;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const m of this.tracers) {
        const p = 1 - m.t / m.life, head = Math.min(1, p * 1.25), tail = Math.max(0, head - 0.3);
        if (tail >= 1) continue;
        // 반동 중인 현재 총구와 맞춰, 위쪽 가늠쇠가 아닌 실제 총열 구멍에서 시작한다.
        const origin = this.muzzle || { x: m.x1, y: m.y1 };
        const dx = m.x2 - origin.x, dy = m.y2 - origin.y;
        const ax = origin.x + dx * tail, ay = origin.y + dy * tail, bx = origin.x + dx * head, by = origin.y + dy * head;
        const g = ctx.createLinearGradient(ax, ay, bx, by);
        g.addColorStop(0, 'rgba(255,200,60,0.22)'); g.addColorStop(1, 'rgba(255,245,190,' + (0.95 * (1 - p * 0.6)) + ')');
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, 4.8 * k * (1 - p * 0.5));
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
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
})(window.Aim = window.Aim || {});
