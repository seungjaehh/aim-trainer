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
    { part: 'body', round: false, r: [-0.20, 0.17, 0.20, 1.20], fill: '#606270' },
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
      this.yaw = 0; this.pitch = 0;
      this.targets = [];
      this.wall = null;
      this.marks = [];
      this.stats = {};
      this.t = 0;
      this.mouseDown = false;
      this.cool = 0;
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
      this.pitch = Math.max(-89, Math.min(89, this.pitch - dy * k));
    }

    /* 월드 각도(az, el) → 화면 좌표. 시야 밖이면 null */
    project(az, el) {
      const dx = wrap(az - this.yaw), dy = el - this.pitch;
      if (Math.abs(dx) > 80 || Math.abs(dy) > 80) return null;
      const f = this.focal;
      return { x: this.cx + f * Math.tan(rad(dx)), y: this.cy - f * Math.tan(rad(dy)) };
    }

    reset(mode) {
      this.mode = mode;
      this.targets = []; this.wall = null; this.marks = [];
      this.stats = { shots: 0, hits: 0, kills: 0, heads: 0, ttk: 0, score: 0, extra: {} };
      this.t = 0; this.cool = 0; this.yaw = 0; this.pitch = 0; this.banner = '';
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
      const edge = this.wallEdge();
      for (const t of list) {
        if (onlyVisible && !t.vis) continue;
        const p = this.project(t.az, t.el);
        if (!p) continue;
        const s = this.focal / t.d;
        if (edge && ((edge.side > 0 && this.cx >= edge.x) || (edge.side < 0 && this.cx <= edge.x)) && t.d >= this.wall.d) continue;
        if (t.kind === 'orb') {
          const r = t.r * s;
          if ((this.cx - p.x) ** 2 + (this.cy - p.y) ** 2 <= r * r) return { t, part: 'head' };
        } else {
          for (const b of BOT) {
            const [x0, y0, x1, y1] = b.r;
            if (this.cx >= p.x + x0 * s && this.cx <= p.x + x1 * s && this.cy >= p.y + y0 * s && this.cy <= p.y + y1 * s) return { t, part: b.part };
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

    fire() {
      if (this.cool > 0) return;
      this.cool = 0.09;
      this.stats.shots++;
      const hit = this.hitAt(true);
      if (!hit) { if (this.mode.onMiss) this.mode.onMiss(this); return; }
      const { t, part } = hit;
      this.stats.hits++;
      t.hp -= t.kind === 'orb' ? 1 : (part === 'head' ? 100 : 34);
      if (t.hp <= 0) {
        this.stats.kills++;
        if (part === 'head') this.stats.heads++;
        this.stats.ttk += this.t - t.born;
        this.stats.score += part === 'head' ? 150 : 100;
        A.audio.kill(part === 'head');
        this.marks.push({ t: 0.22, kill: true });
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
    }

    /* ---- 그리기 ---- */
    background() {
      const { ctx, W, H } = this;
      const themes = {
        dark: ['#242a38', '#10131a', 'rgba(255,255,255,0.05)'],
        wall: ['#b8b2a6', '#9c968a', 'rgba(0,0,0,0.08)'],
        sky: ['#7db3ec', '#4f86c4', 'rgba(255,255,255,0.12)'],
        grass: ['#5c9462', '#3f6e46', 'rgba(255,255,255,0.1)'],
      };
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

    drawBot(t) {
      const p = this.project(t.az, t.el);
      if (!p) return;
      const { ctx } = this, s = this.focal / t.d, g = Math.max(1.5, s * 0.02);
      const path = (b, grow) => {
        const [x0, y0, x1, y1] = b.r;
        const X = p.x + x0 * s - grow, Y = p.y + y0 * s - grow, w = (x1 - x0) * s + grow * 2, h = (y1 - y0) * s + grow * 2;
        ctx.beginPath();
        if (b.round && ctx.roundRect) ctx.roundRect(X, Y, w, h, Math.min(w, h) * 0.3 + grow); else ctx.rect(X, Y, w, h);
        ctx.fill();
      };
      ctx.fillStyle = HIGHLIGHT;
      for (const b of BOT) path(b, g);
      for (const b of BOT) { ctx.fillStyle = t.flash ? '#ffffff' : b.fill; path(b, 0); }
    }

    drawOrb(t) {
      const p = this.project(t.az, t.el);
      if (!p) return;
      const r = t.r * (this.focal / t.d), { ctx } = this;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.flash ? '#ffffff' : (t.color || '#3fd7ff');
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.strokeStyle = HIGHLIGHT; ctx.stroke();
    }

    drawWall() {
      if (!this.wall) return;
      const e = this.wallEdge();
      if (!e) return;
      const { ctx, W, H } = this;
      ctx.fillStyle = '#3a3f4d';
      if (this.wall.side > 0) ctx.fillRect(e.x, 0, W - e.x, H); else ctx.fillRect(0, 0, e.x, H);
      ctx.fillStyle = '#7b8196';
      ctx.fillRect(this.wall.side > 0 ? e.x : e.x - 3, 0, 3, H);
      if (A.cfg.guide) {  // 머리 높이 가이드
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(e.x - 14, this.cy - 1, 28, 2);
      }
    }

    render() {
      const { ctx } = this;
      this.background();
      for (const t of this.targets.slice().sort((a, b) => b.d - a.d)) {
        if (!t.vis) continue;
        if (t.kind === 'orb') this.drawOrb(t); else this.drawBot(t);
      }
      this.drawWall();
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
    }
  }

  A.Game = Game;
  A.util = { rand, pick, wrap, rad };
})(window.Aim = window.Aim || {});
