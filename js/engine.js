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
        const p = this.project(t.az, t.el);
        if (p) this.pops.push({ t: 0.7, x: p.x + (Math.random() - 0.5) * 20, y: p.y + (part === 'head' ? -0.55 : 0.1) * (this.focal / t.d), text: part === 'head' ? '160' : '40', head: part === 'head' });
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
    background() {
      const { ctx, W, H } = this;
      const themes = {
        dark: ['#242a38', '#10131a', 'rgba(255,255,255,0.05)'],
        wall: ['#b8b2a6', '#9c968a', 'rgba(0,0,0,0.08)'],
        sky: ['#7db3ec', '#4f86c4', 'rgba(255,255,255,0.12)'],
        grass: ['#5c9462', '#3f6e46', 'rgba(255,255,255,0.1)'],
      };
      if (A.cfg.bg === 'range') { this.rangeBackground(); return; }
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

    /* 사격장: 어두운 벽과 원근감 있는 바닥, 수평선의 붉은 띠 */
    rangeBackground() {
      const { ctx, W, H, cx, focal: f } = this;
      const hy = this.cy + f * Math.tan(rad(this.pitch));   // 눈높이(수평선)의 화면 y
      const top = Math.max(0, Math.min(hy, H));
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, hy));
      sky.addColorStop(0, '#1b2a3a'); sky.addColorStop(1, '#3a4f63');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, top);
      if (hy < H) {
        const floor = ctx.createLinearGradient(0, hy, 0, H);
        floor.addColorStop(0, '#59636e'); floor.addColorStop(1, '#222831');
        ctx.fillStyle = floor; ctx.fillRect(0, Math.max(0, hy), W, H - Math.max(0, hy));
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      for (let az = -180; az < 180; az += 8) {      // 벽 패널 줄
        const p = this.project(az, 0);
        if (p) { ctx.moveTo(Math.round(p.x) + 0.5, 0); ctx.lineTo(Math.round(p.x) + 0.5, top); }
      }
      ctx.stroke();
      if (hy < H) {
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath();
        for (const d of [2, 3, 4.5, 6.5, 9, 13, 20, 35]) {  // 바닥 가로줄 (눈높이 1.6m)
          const y = this.cy - f * Math.tan(rad(-Math.atan(1.6 / d) * 180 / Math.PI - this.pitch));
          if (y > hy && y < H) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5); }
        }
        for (let az = -90; az <= 90; az += 5) {       // 소실점으로 모이는 세로줄
          const p = this.project(this.yaw + az, 0);
          if (p) { ctx.moveTo(p.x, hy); ctx.lineTo(cx + (p.x - cx) * 4, H); }
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,70,85,0.5)';
      ctx.fillRect(0, Math.round(hy) - 1, W, 2);
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
      this.drawPops(ctx);
      this.drawTracers(ctx);
      this.drawWeapon(ctx);
      this.drawFeed(ctx);
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
        this.muzzle = { x: ox + tw * 0.17, y: oy + th * 0.1 };  // 이미지 윗쪽 앞 끝 근처
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
        const dx = m.x2 - m.x1, dy = m.y2 - m.y1;
        const ax = m.x1 + dx * tail, ay = m.y1 + dy * tail, bx = m.x1 + dx * head, by = m.y1 + dy * head;
        const g = ctx.createLinearGradient(ax, ay, bx, by);
        g.addColorStop(0, 'rgba(255,200,60,0)'); g.addColorStop(1, 'rgba(255,245,190,' + (0.95 * (1 - p * 0.6)) + ')');
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(1.5, 3.2 * k * (1 - p * 0.5));
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
