/* 연습 모드. 각 모드는 setup / update / onKill 로 타겟을 관리하고, g.stats 에 점수를 쌓는다.
   g.m 은 모드 전용 저장소(setup 마다 초기화)다. 각도 단위는 도(°), 거리는 m. */
(function (A) {
  const { rand, pick } = A.util;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* 일정 시간 뒤에 실행할 일을 예약한다 */
  const later = (g, delay, fn) => g.m.queue.push({ at: g.t + delay, fn });
  function flushQueue(g) {
    const due = g.m.queue.filter((q) => q.at <= g.t);
    g.m.queue = g.m.queue.filter((q) => q.at > g.t);
    due.forEach((q) => q.fn());
  }

  const modes = [];
  // 일반 이동 기준(m/s). 달리기·걷기와 앉기 약 1.90m/s는 리플레이 실측 자료를 참고한다.
  // https://github.com/yakisoba0728/vrfkit/blob/main/docs/DATA.md
  const holdSpeeds = [
    { id: 'knife', label: '칼 달리기', speed: 6.75 },
    { id: 'rifle', label: '밴달 달리기', speed: 5.40 },
    { id: 'walk', label: '밴달 걷기', speed: 3.24 },
    { id: 'crouch', label: '앉기', speed: 1.90, crouch: .19 },
  ];

  /* ---- 그리드샷: 3x3 격자 중 3개가 켜진다 ---- */
  modes.push({
    id: 'grid', icon: '▦', name: '그리드샷', desc: '3×3 칸 중 3개가 켜져요. 빠르게 지우며 클릭 정확도와 속도를 키워요.',
    setup(g) {
      g.m = { queue: [], cells: [] };
      for (let i = 0; i < 9; i++) g.m.cells.push({ az: ((i % 3) - 1) * 9, el: (1 - Math.floor(i / 3)) * 7, on: null });
      for (let i = 0; i < 3; i++) this.fill(g);
    },
    fill(g) {
      const free = g.m.cells.filter((c) => !c.on);
      const c = pick(free);
      c.on = g.orb(c.az, c.el, 15, 0.45);
    },
    update(g) { flushQueue(g); },
    onKill(g, t) { g.m.cells.forEach((c) => { if (c.on === t) c.on = null; }); this.fill(g); },
  });

  /* ---- 플릭샷: 시야 밖으로 튀어 나오는 타겟을 한 번에 ---- */
  modes.push({
    id: 'flick', icon: '⚡', name: '플릭샷', desc: '멀리 떨어진 곳에 타겟이 나타나요. 한 번에 휘둘러 맞추는 연습이에요.',
    setup(g) { g.m = { queue: [] }; this.spawn(g); },
    spawn(g) {
      const side = Math.random() < 0.5 ? -1 : 1;
      g.orb(g.yaw + side * rand(14, 55), clamp(g.pitch + rand(-14, 14), -20, 25), 14, 0.28);
    },
    update(g) { flushQueue(g); },
    onKill(g) { this.spawn(g); },
  });

  /* ---- 마이크로 플릭: 중앙 가까이 작은 타겟 ---- */
  modes.push({
    id: 'micro', icon: '·', name: '마이크로 플릭', desc: '조준선 가까이에 작은 타겟이 떠요. 손목 미세 조정과 정확도 연습이에요.',
    setup(g) { g.m = { queue: [] }; this.spawn(g); },
    spawn(g) {
      g.orb(g.yaw + rand(-8, 8), clamp(g.pitch + rand(-6, 6), -20, 25), 14, 0.17);
    },
    update(g) { flushQueue(g); },
    onKill(g) { this.spawn(g); },
  });

  /* ---- 트래킹: 움직이는 타겟에 조준선을 붙여 둔다 (마우스를 누른 채) ---- */
  modes.push({
    id: 'track', icon: '〰', name: '트래킹', desc: '움직이는 타겟에 마우스 버튼을 누른 채 조준선을 붙여 두세요. 스프레이·추적 연습이에요.',
    hold: true,
    setup(g) {
      g.m = { queue: [], on: 0, held: 0, v: 20, next: 0, t: null };
      g.m.t = g.orb(0, 0, 16, 0.45);
      g.stats.extra.trackingPct = 0;
    },
    update(g, dt) {
      const m = g.m, t = m.t;
      if (g.t >= m.next) { m.v = rand(12, 36) * (Math.random() < 0.5 ? -1 : 1); m.next = g.t + rand(0.35, 1.2); }
      t.az += m.v * dt;
      if (Math.abs(t.az) > 38) { t.az = clamp(t.az, -38, 38); m.v = -m.v; }
      t.el = Math.sin(g.t * 0.9) * 6;
      if (g.mouseDown) {
        m.held += dt;
        const hit = g.hitAt(true);
        t.color = hit ? '#ffd23f' : '#3fd7ff';
        if (hit) { m.on += dt; g.stats.score += dt * 100; }
      } else t.color = '#3fd7ff';
      g.stats.extra.trackingPct = m.held > 0 ? Math.round((m.on / m.held) * 100) : 0;
    },
    onKill() {},
    summary(g) { return [['추적 정확도', g.stats.extra.trackingPct + '%'], ['붙인 시간', g.m.on.toFixed(1) + '초']]; },
  });

  /* ---- 헤드 라인: 머리 높이에 늘어선 봇 ---- */
  modes.push({
    id: 'headline', icon: '☰', name: '헤드라인', desc: '머리 높이로 줄지어 선 봇의 머리를 클릭해요. 크로스헤어 높이 유지 연습이에요.',
    setup(g) {
      g.m = { queue: [] };
      for (let i = 0; i < 5; i++) { const b = g.bot((i - 2) * 7, 0, 9); b.slot = (i - 2) * 7; }
    },
    update(g) { flushQueue(g); },
    onKill(g, t) {
      later(g, 0.35, () => { const b = g.bot(t.slot, 0, 9); b.slot = t.slot; });
    },
  });

  /* ---- 대기샷: 벽 뒤에서 튀어나오는 봇을 각도를 잡고 기다렸다 쏜다 ---- */
  modes.push({
    id: 'hold', icon: '▌', name: '대기샷', desc: '칼 달리기부터 앉기까지, 실제 이동 속도를 기준으로 봇이 벽 뒤에서 나와요. 모서리에 조준선을 두고 머리를 맞혀 보세요.',
    setup(g) {
      const side = Math.random() < 0.5 ? 1 : -1;
      g.wall = { az: 0, side, d: 12 };
      g.yaw = -side * 0.35; g.pitch = 0;
      g.m = { queue: [], side, reach: 26, speed: 0, phase: 'wait', until: g.t + rand(1, 2.4), bot: null, peekAt: 0, rounds: 0, misses: 0 };
      g.stats.extra.reactions = [];
    },
    update(g, dt) {
      const m = g.m, b = m.bot;
      if (m.phase === 'wait' && g.t >= m.until) {
        m.profile = holdSpeeds.find((p) => p.id === A.cfg.holdSpeed) || pick(holdSpeeds);
        m.speed = m.profile.speed;
        m.x = m.side * .65;
        m.bot = g.bot(Math.atan2(m.x, 12.5) * 180 / Math.PI, 0, 12.5);
        m.bot.crouch = m.profile.crouch || 0;
        // 벽 너머에서 머리의 앞쪽 가장자리가 보이기 시작하는 시점을 속도로 계산한다.
        m.phase = 'out'; m.peekAt = g.t + (.65 - .085) / m.speed;
      } else if (m.phase === 'out') {
        // 각도/초가 아닌 월드의 m/s로 이동시켜 거리·화면 위치에 따라 속도가 달라지지 않게 한다.
        m.x -= m.side * m.speed * dt;
        b.az = Math.atan2(m.x, b.d) * 180 / Math.PI;
        if (b.az * m.side <= -m.reach) {
          g.remove(b); m.bot = null; m.phase = 'wait'; m.until = g.t + rand(0.9, 2.6); m.rounds++;
        }
      }
    },
    onKill(g) {
      const m = g.m;
      g.stats.extra.reactions.push(Math.max(0, Math.round((g.t - m.peekAt) * 1000)));
      m.bot = null; m.phase = 'wait'; m.until = g.t + rand(0.9, 2.6); m.rounds++;
    },
    draw(g, ctx) {
      const k = Math.max(1, g.H / 1080), m = g.m;
      ctx.save(); ctx.textAlign = 'left'; ctx.fillStyle = '#cbd8db';
      ctx.font = '500 ' + Math.round(15 * k) + 'px system-ui, sans-serif';
      ctx.fillText(m.phase === 'out' ? m.profile.label + ' · ' + m.speed.toFixed(2) + ' m/s' : '대기샷 · 다음 봇 대기', 24*k, 104*k);
      ctx.restore();
    },
    summary(g) {
      const r = g.stats.extra.reactions;
      const avg = r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : 0;
      return [['평균 반응', r.length ? avg + 'ms' : '-'], ['가장 빠른 반응', r.length ? Math.min(...r) + 'ms' : '-'], ['등장한 봇', String(g.m.rounds + (g.m.bot ? 1 : 0))]];
    },
  });

  /* ---- 이동 사격: 좌우로 움직이다 멈추는 봇 ---- */
  modes.push({
    id: 'strafe', icon: '⇄', name: '이동 타겟', desc: '좌우로 스트레이프하는 봇의 머리를 맞혀요. 움직임을 읽는 예측 사격 연습이에요.',
    setup(g) { g.m = { queue: [] }; this.spawn(g); },
    spawn(g) {
      const b = g.bot(rand(-15, 15), 0, 13);
      b.v = rand(7, 14) * (Math.random() < 0.5 ? -1 : 1); b.next = g.t + rand(0.25, 0.9); b.pause = 0;
    },
    update(g, dt) {
      flushQueue(g);
      for (const b of g.targets) {
        if (b.pause > 0) { b.pause -= dt; continue; }
        b.az += b.v * dt;
        if (Math.abs(b.az) > 20) { b.az = clamp(b.az, -20, 20); b.v = -b.v; }
        if (g.t >= b.next) {
          b.next = g.t + rand(0.25, 0.9);
          if (Math.random() < 0.35) b.pause = rand(0.15, 0.4);  // 멈추는 순간
          else b.v = -b.v * rand(0.8, 1.2);
        }
      }
    },
    onKill(g) { later(g, 0.3, () => this.spawn(g)); },
  });

  /* ---- 타겟 전환: 크기·거리가 다른 타겟 여러 개 ---- */
  modes.push({
    id: 'switch', icon: '⇋', name: '타겟 전환', desc: '크기와 거리가 다른 타겟 5개가 떠 있어요. 빠르게 옮겨 가며 지우는 연습이에요.',
    setup(g) { g.m = { queue: [] }; for (let i = 0; i < 5; i++) this.spawn(g); },
    spawn(g) {
      const d = rand(8, 22);
      g.orb(rand(-38, 38), rand(-14, 16), d, d * 0.02);
    },
    update(g) { flushQueue(g); },
    onKill(g) { this.spawn(g); },
  });

  /* ---- 반응 속도: 화면에 타겟이 뜨는 순간 클릭 ---- */
  modes.push({
    id: 'reaction', icon: '⏱', name: '반응 속도', desc: '조준선 근처에 타겟이 갑자기 나타나요. 보는 즉시 클릭해 반응 시간을 재요.',
    setup(g) {
      g.m = { queue: [], appeared: 0, waiting: true };
      g.stats.extra.reactions = [];
      later(g, rand(0.8, 2), () => this.show(g));
    },
    show(g) {
      g.m.t = g.orb(g.yaw + rand(-9, 9), clamp(g.pitch + rand(-6, 6), -15, 20), 12, 0.3);
      g.m.appeared = g.t;
    },
    update(g) { flushQueue(g); },
    onKill(g) {
      g.stats.extra.reactions.push(Math.round((g.t - g.m.appeared) * 1000));
      later(g, rand(0.8, 2.2), () => this.show(g));
    },
    summary(g) {
      const r = g.stats.extra.reactions;
      const avg = r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : 0;
      return [['평균 반응', r.length ? avg + 'ms' : '-'], ['가장 빠른 반응', r.length ? Math.min(...r) + 'ms' : '-']];
    },
  });

  A.modes = modes;
  A.holdSpeeds = holdSpeeds;
})(window.Aim = window.Aim || {});
