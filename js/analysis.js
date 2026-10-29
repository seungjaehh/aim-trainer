/* 연습 결과 분석: 빗나간 샷 방향, 감도 추천, 모드별 기록. DOM 없이 계산만 하는 부분과
   결과 화면에 그리는 작은 그래프로 나뉜다. 각도 단위는 도(°). */
(function (A) {
  const HISTORY_KEY = 'aimtrainer.history.v1';
  const KEEP = 200;  // 모드마다 남기는 최근 기록 수
  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const median = (a) => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const quantile = (a, q) => {
    const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * q, lo = Math.floor(i);
    return s.length ? s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo) : 0;
  };
  const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;

  /* 샷 기록 → 경향. 각 샷: ex(+면 타겟 오른쪽), ey(+면 위), r(타겟 반지름), ax/ay(타겟이 나타날 때부터의 이동 방향), vaz(타겟 좌우 속도) */
  function shots(log, track) {
    const near = log.filter((s) => Math.hypot(s.ex, s.ey) <= Math.max(6, s.r * 8));  // 엉뚱한 곳에 쏜 샷은 빼고 본다
    const misses = near.filter((s) => !s.hit);
    const out = { total: log.length, misses: misses.length, points: near.slice(-120) };

    // 플릭: 이동 방향으로 지나쳤는지(over) 모자랐는지(under)
    const flicks = misses.filter((s) => Math.hypot(s.ax, s.ay) >= 6);
    let over = 0, under = 0;
    for (const s of flicks) {
      const len = Math.hypot(s.ax, s.ay), along = (s.ex * s.ax + s.ey * s.ay) / len;
      if (along > s.r * 0.5) over++; else if (along < -s.r * 0.5) under++;
    }
    out.flicks = flicks.length; out.overPct = pct(over, flicks.length); out.underPct = pct(under, flicks.length);

    // 움직이는 타겟: 앞서 쐈는지 뒤처졌는지
    const moving = misses.filter((s) => Math.abs(s.vaz) > 2);
    let ahead = 0, behind = 0;
    for (const s of moving) {
      const lead = s.ex * Math.sign(s.vaz);
      if (lead > s.r * 0.5) ahead++; else if (lead < -s.r * 0.5) behind++;
    }
    out.moving = moving.length; out.aheadPct = pct(ahead, moving.length); out.behindPct = pct(behind, moving.length);

    // 높이: 빗나간 샷과 몸에 맞은 샷의 위아래 치우침 (반지름 단위)
    const vertical = near.filter((s) => !s.hit || s.part === 'body');
    out.vertical = vertical.length;
    out.lowPct = pct(vertical.filter((s) => s.ey < -s.r).length, vertical.length);
    out.highPct = pct(vertical.filter((s) => s.ey > s.r).length, vertical.length);
    out.side = mean(misses.map((s) => s.ex / s.r));

    if (track && track.time > 1) {
      out.trackTime = track.time;
      out.trackBehindPct = pct(track.behind, track.time);
      out.trackAheadPct = pct(track.ahead, track.time);
      out.trackOffPct = pct(track.vertical, track.time);
    }
    out.tip = tip(out);
    return out;
  }

  /* 가장 큰 문제 하나만 골라 한 줄로 알려 준다 */
  function tip(o) {
    const c = [];
    if (o.flicks >= 4) {
      if (o.overPct >= 55) c.push([o.overPct, '휘두를 때 타겟을 지나쳐요(오버플릭 ' + o.overPct + '%). 끝에서 손목에 브레이크를 걸거나, 감도 맞추기로 감도를 확인해 보세요.']);
      if (o.underPct >= 55) c.push([o.underPct, '휘두른 끝이 타겟에 못 미쳐요(언더플릭 ' + o.underPct + '%). 첫 동작을 끝까지 밀어 주거나, 감도 맞추기로 감도를 확인해 보세요.']);
    }
    if (o.moving >= 4) {
      if (o.behindPct >= 55) c.push([o.behindPct, '움직이는 타겟 뒤를 쏴요(' + o.behindPct + '%). 이동 방향으로 반 박자 앞에 조준선을 두세요.']);
      if (o.aheadPct >= 55) c.push([o.aheadPct, '움직이는 타겟보다 앞을 쏴요(' + o.aheadPct + '%). 멈추는 순간을 기다렸다 쏴 보세요.']);
    }
    if (o.vertical >= 4) {
      if (o.lowPct >= 50) c.push([o.lowPct, '샷이 머리보다 아래로 가요(' + o.lowPct + '%). 조준선을 머리 높이에 미리 두고 좌우로만 움직이세요.']);
      if (o.highPct >= 50) c.push([o.highPct, '샷이 머리 위로 떠요(' + o.highPct + '%). 위아래 손 움직임을 줄여 보세요.']);
    }
    if (o.trackTime) {
      if (o.trackBehindPct >= 40) c.push([o.trackBehindPct, '트래킹에서 타겟을 뒤따라가요(' + o.trackBehindPct + '% 시간). 방향이 바뀌는 순간에 더 빨리 반응해 보세요.']);
      if (o.trackAheadPct >= 40) c.push([o.trackAheadPct, '트래킹에서 타겟을 앞질러요(' + o.trackAheadPct + '% 시간). 방향 전환 뒤 과하게 따라가지 마세요.']);
    }
    if (!c.length) return o.misses >= 4 ? '빗나간 샷이 한쪽으로 치우치지 않아요. 속도보다 정확도를 먼저 챙겨 보세요.' : '';
    return c.sort((a, b) => b[0] - a[0])[0][1];
  }

  /* 감도 맞추기: 휘두른 첫 동작이 멈춘 곳 / 타겟까지 거리 의 비율로 감도를 추천한다.
     사람의 첫 동작은 보통 거리의 95% 근처에서 멈추고 미세 조정으로 마무리하므로 그 값을 기준으로 둔다. */
  const IDEAL = 0.95;
  function recommendSens(sens, ratios) {
    const r = ratios.filter((x) => x > 0.3 && x < 2.5);
    if (r.length < 8) return { enough: false, count: r.length };
    const ratio = median(r), spread = (quantile(r, 0.75) - quantile(r, 0.25)) / ratio;
    let change = IDEAL / ratio;
    if (spread > 0.3) change = 1 + (change - 1) / 2;  // 들쭉날쭉하면 반만 바꾼다
    change = Math.max(0.8, Math.min(1.25, change));  // 한 번에 크게 바꾸지 않는다
    const next = Math.round(sens * change * 1000) / 1000;
    const steady = Math.abs(ratio - IDEAL) <= 0.05;
    return { enough: true, count: r.length, ratio, spread, steady,
      next: steady ? sens : next, change: steady ? 0 : Math.round((next / sens - 1) * 100) };
  }

  /* ---------- 기록 ---------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  let book = loadHistory();
  function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(book)); } catch (e) { /* 저장 못 해도 계속 */ } }
  const history = {
    list: (id) => book[id] || [],
    add(id, rec) {
      const list = book[id] = book[id] || [];
      list.push(Object.assign({ at: Date.now() }, rec));
      if (list.length > KEEP) list.splice(0, list.length - KEEP);
      saveHistory();
    },
    /* 마지막 skip 개를 빼고 그 전 n개의 평균 점수 (방금 기록과 비교할 때 skip=1) */
    average(id, n, skip = 0) {
      const list = history.list(id), end = list.length - skip;
      const part = list.slice(Math.max(0, end - n), end).map((r) => r.score);
      return part.length ? mean(part) : 0;
    },
    /* 오늘까지 루틴을 며칠 연속 했는지 */
    streak(now = Date.now()) {
      const days = new Set(history.list('routine').map((r) => new Date(r.at).toDateString()));
      let n = 0;
      for (let d = new Date(now); days.has(d.toDateString()); d.setDate(d.getDate() - 1)) n++;
      return n;
    },
    reset(data) { book = data || {}; },
  };

  /* ---------- 그래프 ---------- */
  function setup(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }
  const INK = { muted: '#8b93a7', line: '#2a3040', text: '#e8ecf4' };

  /* 빗나간 샷 지도: 타겟 중심 기준, 반지름을 1로 맞춰 찍는다 */
  function drawMisses(canvas, points) {
    const { ctx, w, h } = setup(canvas), cx = w / 2, cy = h / 2, unit = Math.min(w, h) / 2 / 4.2;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = INK.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    for (const k of [2, 4]) { ctx.beginPath(); ctx.arc(cx, cy, unit * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(63,215,255,.18)'; ctx.strokeStyle = '#3fd7ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, unit, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const s of points) {
      const x = cx + Math.max(-4.1, Math.min(4.1, s.ex / s.r)) * unit, y = cy - Math.max(-4.1, Math.min(4.1, s.ey / s.r)) * unit;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = s.hit ? (s.part === 'body' ? '#f0b44c' : '#6be08b') : '#ff4655';
      ctx.fill(); ctx.strokeStyle = '#181c26'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.fillStyle = INK.muted; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('위', cx, 12); ctx.fillText('아래', cx, h - 4);
  }

  /* 점수 추세: 한 줄 + 최근 평균선. 마우스를 올리면 그 회차 값이 보인다 */
  function drawTrend(canvas, recs, opts = {}) {
    const { ctx, w, h } = setup(canvas), pad = { l: 44, r: 12, t: 12, b: 22 };
    const data = recs.slice(-(opts.last || 30));
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = INK.muted;
    if (data.length < 2) { ctx.textAlign = 'center'; ctx.fillText(data.length ? '두 번 이상 하면 추세가 보여요' : '아직 기록이 없어요', w / 2, h / 2); canvas.onmousemove = null; return; }
    const key = opts.key || 'score', vals = data.map((r) => r[key]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
    const X = (i) => pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const fmt = opts.format || ((v) => String(Math.round(v)));
    ctx.strokeStyle = INK.line; ctx.lineWidth = 1; ctx.textAlign = 'right';
    for (const v of [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]) {
      ctx.beginPath(); ctx.moveTo(pad.l, Math.round(Y(v)) + 0.5); ctx.lineTo(w - pad.r, Math.round(Y(v)) + 0.5); ctx.stroke();
      ctx.fillText(fmt(v), pad.l - 6, Y(v) + 4);
    }
    // 최근 5회 이동 평균 (흐린 선)
    ctx.strokeStyle = 'rgba(232,236,244,.35)'; ctx.lineWidth = 2; ctx.beginPath();
    vals.forEach((_, i) => { const a = mean(vals.slice(Math.max(0, i - 4), i + 1)); i ? ctx.lineTo(X(i), Y(a)) : ctx.moveTo(X(i), Y(a)); });
    ctx.stroke();
    ctx.strokeStyle = '#3fd7ff'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    vals.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.stroke();
    const last = data.length - 1;
    ctx.fillStyle = '#3fd7ff'; ctx.beginPath(); ctx.arc(X(last), Y(vals[last]), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK.muted; ctx.textAlign = 'left'; ctx.fillText(data.length + '회 전', pad.l, h - 6);
    ctx.textAlign = 'right'; ctx.fillText('최근', w - pad.r, h - 6);

    const base = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.onmouseleave = () => ctx.putImageData(base, 0, 0);
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect(), x = (e.clientX - rect.left) * (w / rect.width);
      const i = Math.max(0, Math.min(last, Math.round((x - pad.l) / (w - pad.l - pad.r) * last)));
      ctx.putImageData(base, 0, 0);
      ctx.strokeStyle = 'rgba(232,236,244,.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(i), pad.t); ctx.lineTo(X(i), h - pad.b); ctx.stroke();
      ctx.fillStyle = '#3fd7ff'; ctx.beginPath(); ctx.arc(X(i), Y(vals[i]), 4, 0, Math.PI * 2); ctx.fill();
      const d = new Date(data[i].at), label = (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + fmt(vals[i]) + (data[i].acc != null ? ' · ' + data[i].acc + '%' : '');
      ctx.font = '600 11px system-ui, sans-serif'; const tw = ctx.measureText(label).width + 12;
      const bx = Math.min(w - pad.r - tw, Math.max(pad.l, X(i) - tw / 2));
      ctx.fillStyle = 'rgba(15,18,24,.92)'; ctx.fillRect(bx, pad.t, tw, 20);
      ctx.fillStyle = INK.text; ctx.textAlign = 'left'; ctx.fillText(label, bx + 6, pad.t + 14);
    };
  }

  A.analysis = { shots, tip, recommendSens, history, drawMisses, drawTrend, median, mean, IDEAL };
})(window.Aim = window.Aim || {});
