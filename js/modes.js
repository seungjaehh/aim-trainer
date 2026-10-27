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
    id: 'hold', icon: '▌', name: '대기샷', desc: '벽 모서리에 조준선을 두고 기다리세요. 봇이 나오는 순간 머리를 쏘는 각도 잡기 연습이에요.',
    setup(g) {
      const side = Math.random() < 0.5 ? 1 : -1;
      g.wall = { az: 0, side, d: 12 };
      g.yaw = -side * 0.35; g.pitch = 0;
      g.m = { queue: [], side, phase: 'wait', until: g.t + rand(1, 2.4), bot: null, peekAt: 0, rounds: 0, misses: 0 };
      g.stats.extra.reactions = [];
    },
    update(g, dt) {
      const m = g.m, b = m.bot;
      if (m.phase === 'wait' && g.t >= m.until) {
        m.bot = g.bot(m.side * 2.2, 0, 12.5);
        m.phase = 'out'; m.peekAt = g.t + 0.04;
      } else if (m.phase === 'out') {
        b.az -= m.side * 16 * dt;
        if (b.az * m.side <= -1.1) { m.phase = 'hold'; m.until = g.t + rand(0.55, 1.1); }
      } else if (m.phase === 'hold' && g.t >= m.until) m.phase = 'back';
      else if (m.phase === 'back') {
        b.az += m.side * 20 * dt;
        if (b.az * m.side >= 2.2) { g.remove(b); m.bot = null; m.phase = 'wait'; m.until = g.t + rand(0.9, 2.6); m.rounds++; }
      }
    },
    onKill(g) {
      const m = g.m;
      g.stats.extra.reactions.push(Math.round((g.t - m.peekAt) * 1000));
      m.bot = null; m.phase = 'wait'; m.until = g.t + rand(0.9, 2.6); m.rounds++;
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
})(window.Aim = window.Aim || {});
