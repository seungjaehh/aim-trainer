/* 발로란트 실전 훈련 모드.
   기본기 모드와 달리 A/D 로 직접 움직이고(Shift 걷기), 움직이며 쏘면 탄이 퍼진다.
   각 모드의 guide 는 훈련 요령과 그 근거가 된 자료다. 숫자 중 '연습용'이라 적은 것은 게임 실측이 아니라 연습 난이도로 정한 값이다. */
(function (A) {
  const { rand, pick, wrap } = A.util;
  const MOVE = A.MOVE;
  const later = (g, delay, fn) => g.m.queue.push({ at: g.t + delay, fn });
  function flushQueue(g) {
    const due = g.m.queue.filter((q) => q.at <= g.t);
    g.m.queue = g.m.queue.filter((q) => q.at > g.t);
    due.forEach((q) => q.fn());
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const ms = (a) => a.length ? Math.round(mean(a) * 1000) + 'ms' : '-';
  const pct = (n, d) => d ? Math.round(n / d * 100) + '%' : '-';

  const SRC = {
    counter: ['MetaBot.GG · 카운터 스트레이핑 가이드 (코치 Dakota Chinnick)', 'https://metabot.gg/en/valorant/guides/valorant-counter-strafing-shooting-mechanics'],
    peek: ['MetaBot.GG · 피킹 가이드: 지글·숄더·와이드', 'https://metabot.gg/en/valorant/guides/valorant-peeking-guide-jiggle-wide-shoulder'],
    decel: ['Riot 개발자 측정 감속 데이터 정리', 'https://turbosmurfs.gg/?p=7691'],
    placement: ['Dignitas · 크로스헤어 플레이스먼트', 'https://dignitas.gg/articles/improving-aim-in-valorant-crosshair-placement'],
    aimlabs: ['Aimlabs Academy · 코너 피킹', 'https://aimlabs.com/articles/aimlabs-academy/improve-your-wall-peeking-on-valorants-split/'],
    netcode: ['Riot · 넷코드와 피커스 어드밴티지', 'https://technology.riotgames.com/news/peeking-valorants-netcode'],
    vandal: ['Riot · 팬텀 vs 밴달 데이터', 'https://playvalorant.com/en-us/news/dev/valorant-data-drop-phantom-vs-vandal/'],
  };

  /* 월드 좌표 (x, z) 에 선 봇 */
  function botAt(g, x, z) { return g.bot(Math.atan2(x, z) * 180 / Math.PI, 0, z); }

  /* 코너 한 판: 벽 모서리는 x=0, z=6. side>0 이면 벽이 왼쪽을 가리고 나는 오른쪽(D)으로 나간다.
     reveal 은 내가 모서리에서 몇 m 나가야 적 머리가 보이는지. */
  const WALL_Z = 6;
  function corner(g, opts = {}) {
    const m = g.m, s = pick([1, -1]), reveal = opts.reveal || rand(0.25, 1.5), z = opts.z || rand(10, 20);
    m.side = s; m.reveal = reveal;
    g.covers = [s > 0 ? { x0: -36, x1: 0, z: WALL_Z, h: 3.6 } : { x0: 0, x1: 36, z: WALL_Z, h: 3.6 }];
    g.pos.x = -s * 1.3; g.vx = 0; g.bounds = { x0: -3.4, x1: 3.4 };
    g.yaw = s * rand(6, 20); g.pitch = rand(-5, 5);
    g.props = [];
    const b = botAt(g, -s * reveal * (z / WALL_Z - 1), z);
    const stance = opts.stances ? Math.random() : 1;
    if (stance < 0.2) b.crouch = 0.4;
    else if (stance < 0.4) { b.lift = 0.8; g.props.push({ x: Math.tan(b.az * Math.PI / 180) * b.d, z: b.d, w: 1.1, h: 0.8 }); }
    m.bot = b; m.seen = 0; m.spotted = 0;
    return b;
  }
  const centerExposed = (g, b) => {
    const p = g.targetPosition(b);
    return !g.segmentBlocked(p.x, p.y, p.z, g.pos.x, 1.35, g.pos.z);
  };
  const aimGap = (g, b) => { const a = g.targetAngles(b); return Math.hypot(wrap(a.az - g.yaw), a.el - g.pitch); };

  function label(g, ctx, text, sub) {
    const k = Math.max(1, g.H / 1080);
    ctx.save(); ctx.textAlign = 'left'; ctx.fillStyle = '#cbd8db';
    ctx.font = '500 ' + Math.round(15 * k) + 'px system-ui, sans-serif';
    ctx.fillText(text, 24 * k, 104 * k);
    if (sub) { ctx.fillStyle = '#9fb0b5'; ctx.fillText(sub, 24 * k, 126 * k); }
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(203,216,219,.75)';
    ctx.font = '500 ' + Math.round(13 * k) + 'px system-ui, sans-serif';
    if (g.mode.move) ctx.fillText('A / D 이동 · Shift 걷기', g.cx, g.H - 28 * k);
    if (g.m.note && g.t < g.m.noteUntil) {
      ctx.font = '700 ' + Math.round(26 * k) + 'px system-ui, sans-serif';
      ctx.fillStyle = g.m.noteColor || '#ffffff';
      ctx.fillText(g.m.note, g.cx, g.cy - 150 * k);
    }
    ctx.restore();
  }
  function note(g, text, color) { g.m.note = text; g.m.noteUntil = g.t + 1.1; g.m.noteColor = color; }

  /* 벽 너머 적 위치 표시(정보가 있는 상황 가정)와 적의 총구 화염 */
  function enemyFx(g, ctx, b, showThroughWall) {
    if (!b) return;
    const p = g.targetPoint(b);
    if (!p) return;
    const k = Math.max(1, g.H / 1080);
    if (showThroughWall && !g.seesHead(b)) {
      ctx.save(); ctx.strokeStyle = 'rgba(255,70,85,.9)'; ctx.lineWidth = 2 * k;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 9 * k); ctx.lineTo(p.x + 9 * k, p.y); ctx.lineTo(p.x, p.y + 9 * k); ctx.lineTo(p.x - 9 * k, p.y); ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    if (b.muzzle > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, b.muzzle * 9); ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(p.x, p.y + 0.42 * p.s, Math.max(5 * k, 0.16 * p.s), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  const modes = [];

  /* ---- 프리에임: 모서리를 돌기 전에 조준선을 머리 높이·모서리 옆에 미리 둔다 ---- */
  modes.push({
    id: 'preaim', cat: 'val', icon: '◧', name: '프리에임 (코너 클리어)', move: true, gun: true,
    desc: '벽 뒤 어딘가에 적이 서 있어요. 조준선을 모서리 옆 머리 높이에 미리 두고 A/D 로 나가서, 보이는 순간 거의 움직이지 않고 쏘세요.',
    guide: {
      points: ['조준선은 모서리에 바짝, 머리 높이에 미리 둬요. 적은 항상 모서리 선에서 먼저 보여요.',
        '앉은 적·상자 위 적도 나와요. 나가기 전에 높이가 달라질 수 있는 자리를 떠올리세요.',
        '적이 보이면 반대 키로 멈춘 뒤 쏴요. 드러난 순간의 조준 오차(°)가 작을수록 프리에임이 잘 된 거예요.'],
      src: [SRC.placement, SRC.peek, SRC.aimlabs],
    },
    setup(g) { g.m = { queue: [], errs: [], ttk: [], rounds: 0 }; corner(g, { stances: true }); },
    update(g) {
      flushQueue(g);
      const m = g.m, b = m.bot;
      if (b && !m.seen && g.seesHead(b)) { m.seen = g.t; m.err = aimGap(g, b); m.errs.push(m.err); }
    },
    onKill(g, t, part) {
      const m = g.m;
      if (m.seen) {
        m.ttk.push(g.t - m.seen);
        if (m.err < 1.5) g.stats.score += 100;
        note(g, '드러난 순간 오차 ' + m.err.toFixed(1) + '°', m.err < 1.5 ? '#6be08b' : m.err < 4 ? '#f0b44c' : '#ff8a5c');
      }
      m.bot = null; m.rounds++;
      later(g, 0.9, () => corner(g, { stances: true }));
    },
    draw(g, ctx) { label(g, ctx, '프리에임 · ' + (g.m.rounds + 1) + '번째 각', g.m.errs.length ? '평균 오차 ' + mean(g.m.errs).toFixed(1) + '°' : '모서리 옆 머리 높이에 조준선을 두고 나가세요'); enemyFx(g, ctx, g.m.bot, false); },
    summary(g) {
      const m = g.m;
      return [['드러난 순간 조준 오차', m.errs.length ? mean(m.errs).toFixed(1) + '°' : '-'], ['보인 뒤 처치까지', ms(m.ttk)],
        ['오차 1.5° 이내', pct(m.errs.filter((e) => e < 1.5).length, m.errs.length)]];
    },
    tip(g) {
      const e = g.m.errs;
      if (e.length < 3) return '';
      const avg = mean(e);
      return avg < 1.5 ? '적이 보이는 순간 조준선이 이미 머리 근처예요. 실전에서도 모서리마다 같은 습관을 유지하세요.'
        : avg < 4 ? '보인 뒤 작은 보정이 필요해요. 조준선을 모서리에 더 바짝 붙이고 높이를 눈높이에 고정해 보세요.'
        : '적이 보인 뒤 크게 움직이고 있어요. 나가기 전에 멈춰서 조준선을 모서리 옆 머리 높이에 먼저 올려 두세요.';
    },
  });

  /* ---- 피킹: 위치를 아는 적을 상대로 나가서 멈추고 먼저 쏜다 ---- */
  modes.push({
    id: 'peek', cat: 'val', icon: '⇥', name: '피킹 (스윙 & 스톱)', move: true, gun: true,
    desc: '붉은 표시 자리에 적이 각을 잡고 있어요. A/D 로 나가 반대 키로 멈추고, 적이 쏘기 전에 머리를 맞히세요.',
    guide: {
      points: ['와이드 피크는 적 위치를 알 때만 해요. 나가기 전에 조준선을 붉은 표시(머리)에 맞춰 두세요.',
        '나간 뒤 반대 키를 한 번 눌러 멈추고 쏴요. 미끄러지는 중에 쏘면 탄이 퍼져요.',
        '적은 내 어깨가 보인 뒤 일정 시간 안에 쏴요(연습용 값, 이길수록 짧아져요). 늦었으면 다시 숨었다 나가세요.'],
      src: [SRC.peek, SRC.counter, SRC.netcode],
    },
    setup(g) { g.m = { queue: [], wins: 0, losses: 0, delay: 0.6, speeds: [], ttk: [] }; corner(g, { reveal: rand(0.4, 1.3) }); },
    update(g) {
      flushQueue(g);
      const m = g.m, b = m.bot;
      if (!b) return;
      if (!m.seen && g.seesHead(b)) m.seen = g.t;
      if (!m.spotted) { if (g.seenBy(b)) m.spotted = g.t; return; }
      if (g.t < m.spotted + m.delay) return;
      b.muzzle = 0.14;
      if (centerExposed(g, b)) {
        g.hurt(); m.losses++; m.delay = Math.min(0.6, m.delay + 0.03);
        note(g, '적이 먼저 쐈어요', '#ff6b78');
        g.remove(b); m.bot = null;
        later(g, 1.1, () => corner(g, { reveal: rand(0.4, 1.3) }));
      } else m.spotted = 0;  // 다시 숨었으면 적은 놓친다
    },
    onShot(g, shot) { g.m.speeds.push(shot.speed); },
    onKill(g) {
      const m = g.m;
      m.wins++; m.ttk.push(g.t - (m.seen || g.t)); m.delay = Math.max(0.38, m.delay - 0.02);
      g.stats.score += 100; m.bot = null;
      later(g, 0.9, () => corner(g, { reveal: rand(0.4, 1.3) }));
    },
    draw(g, ctx) {
      label(g, ctx, '피킹 · 승 ' + g.m.wins + ' / 패 ' + g.m.losses, '적 반응 ' + Math.round(g.m.delay * 1000) + 'ms (연습용)');
      enemyFx(g, ctx, g.m.bot, true);
    },
    summary(g) {
      const m = g.m, moving = m.speeds.filter((v) => v > MOVE.dead).length;
      return [['교전 승률', pct(m.wins, m.wins + m.losses)], ['보인 뒤 처치까지', ms(m.ttk)], ['움직이며 쏜 탄', pct(moving, m.speeds.length)]];
    },
    tip(g) {
      const m = g.m, moving = m.speeds.filter((v) => v > MOVE.dead).length;
      if (m.speeds.length >= 5 && moving / m.speeds.length > 0.35) return '탄의 ' + pct(moving, m.speeds.length) + '를 움직이며 쐈어요. 반대 키를 누르고 속도 막대가 초록이 된 뒤 쏘세요.';
      if (m.losses > m.wins) return '적이 먼저 쏘는 판이 많아요. 나가기 전에 조준선을 붉은 표시에 맞춰 두면 나간 뒤 쏘기만 하면 돼요.';
      return m.wins ? '멈추고 쏘는 흐름이 좋아요. 적 반응 시간이 짧아져도 같은 순서를 지키세요.' : '';
    },
  });

  /* ---- 지글 피크: 어깨만 보여 줘 저격수의 탄을 뺀 뒤 장전 틈에 나간다 ---- */
  modes.push({
    id: 'jiggle', cat: 'val', icon: '↔', name: '지글 피크 (샷 유도)', move: true, gun: true,
    desc: '저격수가 각을 잡고 있어요. 어깨만 살짝 내밀었다 바로 숨어 탄을 빼고, 다음 탄을 준비하는 사이에 나가서 잡으세요.',
    guide: {
      points: ['A/D 를 짧게 번갈아 눌러 0.1~0.3초만 드러나요. 몸 가운데가 보이면 맞아요.',
        '저격수는 어깨를 본 뒤 약 0.25초에 쏴요(연습용 값). 그 전에 다시 벽 뒤로 돌아오세요.',
        '탄이 빠지면 약 1.5초의 틈이 생겨요(연습용 값). 그때 나가서 멈추고 머리를 쏘세요.'],
      src: [SRC.peek, SRC.aimlabs],
    },
    setup(g) { g.m = { queue: [], baits: 0, deaths: 0, wins: 0, window: 0, expose: [] }; corner(g, { reveal: rand(0.5, 1.1), z: rand(14, 22) }); },
    update(g) {
      flushQueue(g);
      const m = g.m, b = m.bot;
      if (!b) return;
      const seen = g.seenBy(b);
      if (m.exposedAt && !seen) { m.expose.push(g.t - m.exposedAt); m.exposedAt = 0; }
      if (!m.exposedAt && seen) m.exposedAt = g.t;
      if (g.t < m.window) return;  // 다음 탄 준비 중
      if (!m.spotted) { if (seen) m.spotted = g.t; return; }
      if (g.t < m.spotted + 0.25) return;
      b.muzzle = 0.16; m.spotted = 0;
      if (centerExposed(g, b)) {
        g.hurt(); m.deaths++; note(g, '몸이 너무 많이 나왔어요', '#ff6b78');
        g.remove(b); m.bot = null;
        later(g, 1.1, () => corner(g, { reveal: rand(0.5, 1.1), z: rand(14, 22) }));
      } else { m.baits++; m.window = g.t + 1.5; g.stats.score += 60; note(g, '탄을 뺐어요! 지금 나가세요', '#6be08b'); }
    },
    onKill(g) {
      const m = g.m;
      m.wins++; g.stats.score += g.t < m.window ? 120 : 40; m.bot = null; m.window = 0;
      later(g, 0.9, () => corner(g, { reveal: rand(0.5, 1.1), z: rand(14, 22) }));
    },
    draw(g, ctx) {
      const m = g.m, k = Math.max(1, g.H / 1080);
      label(g, ctx, '지글 피크 · 탄 유도 ' + m.baits + ' · 처치 ' + m.wins + ' · 피격 ' + m.deaths, m.expose.length ? '평균 노출 ' + ms(m.expose) : '어깨만 살짝 보여 주고 돌아오세요');
      enemyFx(g, ctx, m.bot, true);
      if (m.bot && g.t < m.window) {
        const w = 220 * k, f = (m.window - g.t) / 1.5;
        ctx.fillStyle = 'rgba(12,22,29,.6)'; ctx.fillRect(g.cx - w / 2, g.cy - 200 * k, w, 8 * k);
        ctx.fillStyle = '#6be08b'; ctx.fillRect(g.cx - w / 2, g.cy - 200 * k, w * f, 8 * k);
      }
    },
    summary(g) {
      const m = g.m;
      return [['탄 유도 성공', m.baits + '회'], ['유도 뒤 처치', m.wins + '회'], ['피격', m.deaths + '회'], ['평균 노출 시간', ms(m.expose)]];
    },
    tip(g) {
      const m = g.m;
      if (m.deaths > m.baits) return '몸 가운데까지 나가는 일이 많아요. D 를 아주 짧게 누르고 바로 A 로 되돌아오세요. Shift 걷기로 폭을 줄여도 좋아요.';
      if (m.baits > m.wins + 1) return '탄은 잘 빼지만 틈을 놓치고 있어요. 총구 화염이 보이면 곧바로 나가서 멈추고 쏘세요.';
      return m.baits ? '노출 시간을 0.3초 안쪽으로 유지하면 실전에서도 정보만 얻고 살아 나올 수 있어요.' : '';
    },
  });

  /* ---- 카운터 스트레이프: 움직이다 멈추고 쏜다 ---- */
  modes.push({
    id: 'counter', cat: 'val', icon: '⇤⇥', name: '카운터 스트레이프', move: true, gun: true,
    desc: '좌우로 달리다가 반대 키로 멈춘 직후에 쏘세요. 서서 쏜 처치는 점수가 없고, 미끄러지며 쏜 탄은 퍼져요.',
    guide: {
      points: ['A 로 달리다 D 를 한 번 톡, D 로 달리다 A 를 한 번 톡. 꾹 누르면 반대로 다시 움직여요.',
        '속도 막대가 초록(30% 이하)일 때만 초탄이 정확해요. 달리다 키만 놓으면 0.170초, 반대 키를 누르면 0.160초에 멈춰요.',
        '한 발 쏘고 다시 움직여요. 양쪽 방향을 고르게 연습하세요.'],
      src: [SRC.counter, SRC.decel],
    },
    setup(g) {
      g.m = { queue: [], clean: 0, slide: 0, still: 0, stops: [] };
      g.bounds = { x0: -7, x1: 7 };
      this.spawn(g); this.spawn(g);
    },
    spawn(g) { botAt(g, g.pos.x + rand(-6, 6), rand(11, 19)); },
    update(g) { flushQueue(g); },
    onShot(g, shot) {
      const m = g.m;
      if (shot.speed > MOVE.dead) { m.slide++; note(g, '미끄러지며 쐈어요 (' + Math.round(shot.speed * 100) + '%)', '#ff8a5c'); }
      else if (shot.sinceRun > 1) m.still++;
      else { m.clean++; m.stops.push(Math.max(0, shot.sinceStop)); }
    },
    onKill(g, t, part) {
      const sh = g.shot;
      if (sh.sinceRun > 1) { g.stats.score -= part === 'head' ? 150 : 100; note(g, '먼저 움직이세요', '#f0b44c'); }
      else g.stats.score += 50;
      later(g, 0.25, () => this.spawn(g));
    },
    draw(g, ctx) { const m = g.m; label(g, ctx, '카운터 스트레이프 · 멈추고 쏜 탄 ' + m.clean + ' · 미끄러짐 ' + m.slide, '달리기 → 반대 키 → 사격 → 다시 달리기'); },
    summary(g) {
      const m = g.m, all = m.clean + m.slide + m.still;
      return [['멈추고 쏜 탄', pct(m.clean, all)], ['미끄러지며 쏜 탄', pct(m.slide, all)], ['서서 쏜 탄', pct(m.still, all)], ['멈춘 뒤 사격까지', ms(m.stops)]];
    },
    tip(g) {
      const m = g.m, all = m.clean + m.slide + m.still;
      if (all < 5) return '';
      if (m.slide / all > 0.3) return '탄의 ' + pct(m.slide, all) + '를 미끄러지는 중에 쐈어요. 반대 키를 누른 뒤 한 박자 쉬고 쏘세요. 가장 흔한 실수예요.';
      if (m.still / all > 0.4) return '서서 쏜 탄이 많아요. 한 발 쏘면 바로 반대쪽으로 움직여 다음 탄을 준비하세요.';
      return mean(m.stops) > 0.25 ? '멈추는 건 정확해요. 이제 멈춘 뒤 쏘기까지 시간(' + ms(m.stops) + ')을 줄여 보세요.' : '멈추고 쏘는 리듬이 좋아요. 실전 교전 사이사이에도 같은 리듬을 쓰세요.';
    },
  });

  /* ---- 탭·버스트·스프레이: 거리마다 다른 발수로 쏜다 ---- */
  const BANDS = [
    { id: 'far', label: '원거리 · 탭 1~2발', z: [22, 28], max: 2 },
    { id: 'mid', label: '중거리 · 3~5발 버스트', z: [12, 17], max: 5 },
    { id: 'near', label: '근거리 · 스프레이', z: [5, 8], max: 25 },
  ];
  modes.push({
    id: 'burst', cat: 'val', icon: '⁝', name: '탭 · 버스트 · 스프레이', gun: true, recoil: true, auto: true,
    desc: '거리에 따라 쏘는 방법을 바꿔요. 멀면 한두 발, 중간은 3~5발 끊어 쏘기, 가까우면 누른 채 반동을 아래로 당기세요. 방어구를 입은 봇이에요.',
    guide: {
      points: ['원거리는 한두 발씩 끊어 쏴요. 0.33초쯤 쉬면 초탄 정확도로 돌아와요(연습용 근사).',
        '중거리는 3~5발 버스트. 처음 몇 발은 위로 곧게 오르니 마우스를 살짝 내려요.',
        '근거리는 누른 채로 쏘되, 7~8발 이후엔 좌우로 흔들려요. 탄착점(주황 점)을 보며 따라가세요.'],
      src: [SRC.counter, SRC.vandal],
    },
    setup(g) { g.m = { queue: [], res: { far: [], mid: [], near: [] }, cur: null, i: 0 }; this.spawn(g); },
    spawn(g) {
      const band = BANDS[g.m.i++ % 3], z = rand(band.z[0], band.z[1]);
      const b = botAt(g, rand(-0.3, 0.3) * z, z);
      b.hp = 150;
      g.m.cur = { band, bullets: 0, maxN: 0 };
    },
    update(g) { flushQueue(g); },
    onShot(g, shot) { const c = g.m.cur; if (c) { c.bullets++; c.maxN = Math.max(c.maxN, shot.n + 1); } },
    onKill(g) {
      const c = g.m.cur, ok = c.maxN <= c.band.max;
      g.m.res[c.band.id].push({ bullets: c.bullets, ok });
      if (ok) g.stats.score += 50; else note(g, '너무 길게 쐈어요 (' + c.maxN + '발 연사)', '#f0b44c');
      g.m.cur = null;
      later(g, 0.4, () => this.spawn(g));
    },
    draw(g, ctx) { const c = g.m.cur; label(g, ctx, c ? c.band.label : '다음 봇', c ? '이번 봇에 쓴 탄 ' + c.bullets + '발' : ''); },
    summary(g) {
      return BANDS.map((b) => {
        const r = g.m.res[b.id];
        return [b.label.split(' · ')[0] + ' 처치당 탄', r.length ? mean(r.map((x) => x.bullets)).toFixed(1) + '발 · 발수 지킴 ' + pct(r.filter((x) => x.ok).length, r.length) : '-'];
      });
    },
    tip(g) {
      const r = g.m.res, bad = (id) => r[id].length >= 2 && r[id].filter((x) => !x.ok).length / r[id].length > 0.4;
      if (bad('far')) return '원거리에서 길게 쏘고 있어요. 한두 발 쏘고 손을 떼 초탄 정확도를 되찾으세요.';
      if (bad('mid')) return '중거리에서 5발 넘게 이어 쏘는 일이 많아요. 3~5발에서 끊고 다시 조준하세요.';
      const near = r.near.length ? mean(r.near.map((x) => x.bullets)) : 0;
      return near > 9 ? '근거리 스프레이에 탄이 많이 들어요(평균 ' + near.toFixed(1) + '발). 쏘는 동안 마우스를 천천히 아래로 당기세요.' : '';
    },
  });

  /* ---- 맵 단차 헤드라인: 실제 발로란트 맵의 자리에서 높이가 다른 적의 머리 높이를 미리 잡는다 ----
     · 자리 이름과 수평 좌표(cm)는 valorant-api.com/v1/maps 의 callouts 값이다 (2026-11-13 조회, 비공식 커뮤니티 API).
       좌표는 각 구역의 대표점 하나라서, 거리·방향은 "구역 중심 사이" 기준이다.
     · 높이(h, m)는 공개된 수치가 없어 추정값이다. 벽·엄폐물·시야선도 재현하지 않았다. 1:1 맵이 아니다. */
  const stairs = (x) => Math.max(0, Math.min(5, Math.floor((x + 2.4) / 0.8) + 1)) * 0.3;   // 0.3m 단 5개 → 1.5m
  const ramp = (x) => stairs(x) * 2;                                                        // 0.6m 단 5개 → 3m
  // from: [이름, x, y, 높이 | 'ramp'], to: [[이름, x, y, 높이], …]. to 의 첫 자리가 정면이다.
  const MAP_SPOTS = [
    { id: 'haven-a-long', map: '헤이븐', from: ['A 롱', 6210, -6901, 0], to: [['A 사이트', 6309, -9226, 0], ['A 타워(헤븐)', 6721, -10473, 3]] },
    { id: 'haven-a-tower', map: '헤이븐', from: ['A 타워(헤븐)', 6721, -10473, 3], to: [['A 사이트', 6309, -9226, 0], ['A 롱', 6210, -6901, 0]] },
    { id: 'lotus-a-main', map: '로터스', from: ['A 메인', 5288, 4160, 0], to: [['A 사이트', 7736, 5557, 0], ['A 트리', 6150, 5557, 0], ['A 탑', 9260, 5046, 2.5]] },
    { id: 'lotus-b-main', map: '로터스', from: ['B 메인', 4877, -48, 0], to: [['B 사이트', 6368, 668, 0], ['B 어퍼', 7683, 1517, 2.5]] },
    { id: 'split-a-main', map: '스플릿', from: ['A 메인', 6280, -4493, 0], to: [['A 사이트', 6589, -6761, 0], ['A 래프터', 5435, -6258, 3], ['A 타워(헤븐)', 4637, -6748, 3], ['A 백', 7345, -7858, 0]] },
    { id: 'split-a-ramps', map: '스플릿', from: ['A 램프', 4330, -4750, 'ramp'], to: [['A 타워(헤븐)', 4637, -6748, 3], ['A 래프터', 5435, -6258, 3]] },
    { id: 'split-b-garage', map: '스플릿', from: ['B 개러지', -2191, -3848, 0], to: [['B 사이트', -2167, -6265, 0], ['B 래프터', -637, -6071, 3], ['B 타워(헤븐)', 169, -5290, 3], ['B 백', -3107, -7417, 0]] },
    { id: 'ascent-a-main', map: '어센트', from: ['A 메인', 5322, -4710, 0], to: [['A 사이트', 6154, -6626, 0], ['A 래프터(헤븐)', 6130, -8210, 3]] },
    { id: 'ascent-a-rafters', map: '어센트', from: ['A 래프터(헤븐)', 6130, -8210, 3], to: [['A 사이트', 6154, -6626, 0], ['A 메인', 5322, -4710, 0]] },
  ];
  /* 맵 좌표 → 훈련장 좌표. 미니맵 식(u = y·xMultiplier, v = x·yMultiplier, yMultiplier < 0)대로 위에서 보면 x 가 위, y 가 오른쪽이다. */
  function buildLayout(S) {
    const [fn, fx, fy, fh] = S.from, t0 = S.to[0];
    const len = Math.hypot(t0[1] - fx, t0[2] - fy), ux = (t0[1] - fx) / len, uy = (t0[2] - fy) / len;
    const r1 = (v) => Math.round(v * 10) / 10;
    const spots = S.to.map(([name, x, y, h]) => {
      const dx = x - fx, dy = y - fy;
      return { name, x: r1((-uy * dx + ux * dy) / 100), z: r1((ux * dx + uy * dy) / 100), h, dist: Math.round(Math.hypot(dx, dy) / 100) };
    });
    const props = spots.filter((s) => s.h).map((s) => ({ x: s.x, z: s.z + 0.8, w: 5, d: 3, h: s.h, plat: true }));
    let ground = null;
    if (fh === 'ramp') {
      ground = ramp;   // 단 i: x = -2.4 + 0.8 i 부터 오른쪽 끝(4.2)까지
      for (let i = 0; i < 5; i++) props.push({ x: (-2.4 + 0.8 * i + 4.2) / 2, z: 0, w: 4.2 - (-2.4 + 0.8 * i), d: 2.4, h: (i + 1) * 0.6, plat: true });
    } else if (fh) {
      ground = () => fh;
      props.push({ x: 0, z: -0.6, w: 9, d: 3, h: fh, plat: true });
    }
    return { id: S.id, map: S.map, from: fn, name: S.map + ' · ' + fn + ' → ' + t0[0], ground, props, spots };
  }
  const LAYOUTS = MAP_SPOTS.map(buildLayout);
  const PER_LAYOUT = 4;   // 한 자리에서 잡는 적 수
  modes.push({
    id: 'terrain', cat: 'val', icon: '◭', name: '맵 단차 헤드라인', move: true, gun: true,
    desc: '헤이븐·로터스·스플릿·어센트의 실제 자리에서, 헤븐·래프터처럼 높이가 다른 곳의 적을 잡아요. 붉은 표시는 적이 설 바닥이에요. 거리는 실제 맵 좌표, 높이는 추정값이에요.',
    guide: {
      points: ['평지의 머리 높이 줄은 단차가 있으면 틀어져요. 적이 설 바닥에서 사람 키만큼 위를 기준으로 다시 잡으세요.',
        '같은 높이 차이라도 가까울수록 화면에서 더 많이 벗어나요. 가까운 헤븐은 크게, 먼 헤븐은 조금만 올려요.',
        '램프·계단을 오르내리면 내 눈 높이가 바뀌어요. 걸으면서 조준선을 계속 고쳐 잡으세요.',
        '자리 사이 거리는 실제 맵의 구역 좌표를 따랐지만 높이는 추정이고 벽과 엄폐물은 없어요. 각도 감각은 실제 게임에서 다시 맞추세요.'],
      src: [SRC.placement, SRC.aimlabs],
    },
    setup(g) { g.m = { queue: [], errs: { up: [], level: [], down: [] }, ttk: [], li: Math.floor(Math.random() * LAYOUTS.length) - 1, last: -1 }; this.layout(g); },
    layout(g) {
      const m = g.m, L = LAYOUTS[m.li = (m.li + 1) % LAYOUTS.length];
      m.L = L; m.left = PER_LAYOUT; m.last = -1;
      g.props = L.props.slice(); g.ground = L.ground;
      g.pos.x = 0; g.vx = 0; g.bounds = { x0: -3.2, x1: 3.2 };
      g.base = L.ground ? L.ground(0) : 0;
      note(g, L.name, '#8fe3ff');
      this.next(g, 1.2);
    },
    next(g, delay) {
      const m = g.m, L = m.L;
      let i = Math.floor(Math.random() * L.spots.length);
      if (L.spots.length > 2) while (i === m.last) i = Math.floor(Math.random() * L.spots.length);
      m.last = i; m.bot = null;
      m.mark = L.spots[i];
      later(g, delay, () => {
        const s = m.mark, b = botAt(g, s.x, s.z);
        if (s.h) b.lift = s.h;
        if (Math.random() < 0.2) b.crouch = 0.4;
        const a = g.targetAngles(b), dy = g.targetPosition(b).y - g.eyeY;
        m.bot = b; m.mark = null; m.seen = g.t;
        m.kind = dy > 0.4 ? 'up' : dy < -0.4 ? 'down' : 'level';
        m.err = Math.abs(a.el - g.pitch); m.errs[m.kind].push(m.err);
      });
    },
    update(g) { flushQueue(g); },
    onKill(g) {
      const m = g.m;
      m.ttk.push(g.t - m.seen);
      if (m.err < 1.5) g.stats.score += 100;
      note(g, '나타난 순간 높이 오차 ' + m.err.toFixed(1) + '°', m.err < 1.5 ? '#6be08b' : m.err < 4 ? '#f0b44c' : '#ff8a5c');
      if (--m.left <= 0) later(g, 0.7, () => this.layout(g)); else this.next(g, rand(0.7, 1.1));
    },
    draw(g, ctx) {
      const m = g.m, k = Math.max(1, g.H / 1080), s = m.mark;
      label(g, ctx, m.L.name + ' (' + Math.min(PER_LAYOUT, PER_LAYOUT - m.left + 1) + '/' + PER_LAYOUT + ')',
        s ? '다음 적: ' + s.name + ' · 약 ' + s.dist + 'm' + (s.h ? ' · 높이 약 ' + s.h + 'm(추정)' : '') : '거리는 실제 맵 좌표 · 높이는 추정 · 벽은 없어요');
      if (!s) return;
      const p = g.worldPoint(s.x, s.h + 0.03, s.z);   // 적이 설 바닥. 머리는 여기서 약 1.6m 위
      if (!p) return;
      const w = Math.max(10 * k, 0.32 * p.s), pulse = 0.6 + 0.4 * Math.sin(g.t * 14);
      ctx.save(); ctx.strokeStyle = 'rgba(255,70,85,' + pulse + ')'; ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.moveTo(p.x - w, p.y); ctx.lineTo(p.x + w, p.y);
      ctx.moveTo(p.x - w * 0.5, p.y - w * 0.7); ctx.lineTo(p.x, p.y - w * 0.15); ctx.lineTo(p.x + w * 0.5, p.y - w * 0.7); ctx.stroke();
      ctx.restore();
    },
    summary(g) {
      const e = g.m.errs, row = (a) => a.length ? mean(a).toFixed(1) + '° (' + a.length + '회)' : '-';
      return [['올려보는 자리 높이 오차', row(e.up)], ['같은 높이 자리 높이 오차', row(e.level)], ['내려보는 자리 높이 오차', row(e.down)], ['나타난 뒤 처치까지', ms(g.m.ttk)]];
    },
    tip(g) {
      const e = g.m.errs, all = e.up.concat(e.level, e.down);
      if (all.length < 4) return '';
      const worst = ['up', 'down', 'level'].filter((k) => e[k].length >= 2).sort((a, b) => mean(e[b]) - mean(e[a]))[0];
      if (!worst || mean(e[worst]) < 1.5) return '단차가 있어도 조준선이 머리 높이에 잘 올라가 있어요.';
      return worst === 'up' ? '올려보는 자리에서 높이가 가장 많이 어긋나요. 헤븐·래프터 바닥에서 사람 키만큼 더 올려 두세요.'
        : worst === 'down' ? '내려보는 자리에서 높이가 가장 많이 어긋나요. 가까운 적일수록 조준선을 더 내려야 해요.'
        : '같은 높이의 자리에서도 높이가 어긋나요. 평지 헤드라인 모드로 기준 줄부터 다시 잡아 보세요.';
    },
  });

  A.modes.push(...modes);
  A.valorant = { SRC, BANDS, corner, WALL_Z, LAYOUTS, MAP_SPOTS, stairs };
})(window.Aim = window.Aim || {});
