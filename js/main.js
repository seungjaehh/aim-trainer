/* 메뉴·설정·게임 진행 흐름 */
(function (A) {
  const $ = (id) => document.getElementById(id);
  const cfg = A.cfg;
  const canvas = $('game');
  const game = new A.Game(canvas);
  let state = 'menu';  // menu | countdown | run | pause | result
  let current = null, countdown = 0, left = 0, last = 0, raf = 0;

  /* ---------- 조준선 ---------- */
  function applyCode(text, quiet) {
    try {
      A.crossData = A.crosshair.parse(text);
      cfg.crosshair = text.trim();
      A.save();
      if (!quiet) { $('codeMsg').textContent = '적용했어요'; $('codeMsg').className = 'msg ok'; }
      drawPreview();
      return true;
    } catch (e) {
      $('codeMsg').textContent = '코드를 읽지 못했어요: ' + e.message;
      $('codeMsg').className = 'msg err';
      return false;
    }
  }
  function drawPreview() {
    const c = $('preview'), x = c.getContext('2d');
    const bg = { range: ['#89949b', '#56636c'], dark: ['#303c47', '#303c47'], grid: ['#242a38', '#10131a'] }[cfg.bg] || ['#89949b', '#56636c'];
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    if (cfg.bg !== 'grid') {
      x.fillStyle = cfg.bg === 'dark' ? '#424e57' : '#68777e'; x.fillRect(0,c.height*.57,c.width,c.height*.43);
      x.strokeStyle = '#93a3a6'; x.lineWidth = 1; x.beginPath();
      for (const y of [.65,.78,.96]) { x.moveTo(0,c.height*y); x.lineTo(c.width,c.height*y); }
      for (const a of [-1,0,1,2]) { x.moveTo(c.width*.5,c.height*.57); x.lineTo(c.width*a,c.height); }
      x.stroke();
    }
    A.crosshair.draw(x, c.width / 2, c.height / 2, A.crossData, cfg.chScale);
  }

  /* ---------- 설정 UI ---------- */
  function bindNumber(id, key, after) {
    const el = $(id);
    el.value = cfg[key];
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) { cfg[key] = v; A.save(); if (after) after(); }
    });
  }
  function bindSelect(id, key, after) {
    const el = $(id);
    el.value = String(cfg[key]);
    el.addEventListener('change', () => {
      cfg[key] = typeof cfg[key] === 'number' ? Number(el.value) : el.value;
      A.save(); if (after) after();
    });
  }
  function fillOptions(sel, list, value) {
    sel.innerHTML = '';
    for (const [v, label] of list) sel.add(new Option(label, v));
    sel.value = value;
  }
  function initSettings() {
    $('code').value = cfg.crosshair;
    applyCode(cfg.crosshair, true);
    $('applyCode').onclick = () => applyCode($('code').value);
    $('code').addEventListener('input', () => { $('codeMsg').textContent = ''; });
    bindNumber('chScale', 'chScale', drawPreview);
    bindNumber('sens', 'sens');
    bindNumber('fov', 'fov');
    cfg.kill = 'skin'; cfg.targetSize = 1;  // 킬 소리는 스킨 것, 타겟 크기는 고정

    fillOptions($('hit'), A.audio.lists.hit, cfg.hit);
    bindSelect('hit', 'hit');
    $('volume').value = cfg.volume;
    $('volume').addEventListener('input', () => { cfg.volume = parseFloat($('volume').value); A.save(); });
    $('testSound').onclick = () => A.audio.preview();

    bindSelect('duration', 'duration');
    fillOptions($('holdSpeed'), [['random', '랜덤 · 칼 달리기부터 앉기까지']].concat(
      A.holdSpeeds.map((p) => [p.id, p.label + ' · ' + (p.crouch ? '약 ' : '') + p.speed.toFixed(2) + ' m/s'])), cfg.holdSpeed);
    bindSelect('holdSpeed', 'holdSpeed');
    bindSelect('bg', 'bg', drawPreview);
    $('guide').checked = cfg.guide;
    $('guide').addEventListener('change', () => { cfg.guide = $('guide').checked; A.save(); });
  }

  /* ---------- 스킨 ---------- */
  function showSkin() {
    const s = A.skins.find(cfg.weapon, cfg.skin);
    $('skinPreview').hidden = !s;
    if (s) $('skinPreview').src = s.icon;
    $('weaponImg').src = s ? s.icon : '';
    $('hudWeapon').hidden = true;
    const w = s && A.skins.weapon(cfg.weapon);
    A.audio.setSkin(s || null);
    Promise.all([A.audio.loadSkinSound(s && s.id), s && A.skins.localAsset(s.id)]).then(([has, asset]) => {
      if (s && cfg.skin !== s.id) return;
      $('skinSoundClear').hidden = !has || !!asset;
      $('skinSoundMsg').textContent = !s ? '' : has ? (asset
        ? '녹화한 킬사운드 적용 중' + (asset.kills ? ' · 연속 ' + asset.kills.length + '킬 단계' : '') + (asset.cleaned ? ' · 잡음 정리' : '') + (asset.voiceSeparated ? ' · 음성 분리' : '')
        : '올린 소리를 쓰는 중이에요 (이 브라우저에만 저장돼요)') : '파일을 올리지 않으면 이 스킨에 맞춘 합성음이 나요';
    });
    if (s) {
      const img = new Image();
      img.src = s.icon;
      A.weapon = { feedImg: img, title: w.name + ' · ' + s.name, img, muzzle: s.muzzle, rate: w.stats && w.stats.rate, reload: w.stats && w.stats.reload };
      A.skins.loadImage(s.id).then((own) => {
        if (own && A.weapon && A.weapon.feedImg === img) { A.weapon.img = own; A.weapon.fp = true; }
        if (cfg.skin === s.id) $('skinImgClear').hidden = !own || own.builtIn;
      });
    } else A.weapon = null;
  }
  function initSkinImage() {
    $('skinImg').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f || !cfg.skin) { $('skinSoundMsg').textContent = '스킨을 먼저 골라 주세요'; return; }
      try {
        const img = await A.skins.saveImage(cfg.skin, f);
        if (A.weapon) { A.weapon.img = img; A.weapon.fp = true; }
        $('skinImgClear').hidden = false;
        $('skinSoundMsg').textContent = f.name + ' 적용'; $('skinSoundMsg').className = 'msg ok';
      } catch (err) {
        $('skinSoundMsg').textContent = '이 파일은 이미지로 열 수 없어요'; $('skinSoundMsg').className = 'msg err';
      }
      e.target.value = '';
    });
    $('skinImgClear').onclick = async () => { await A.skins.clearImage(cfg.skin); $('skinImgClear').hidden = true; showSkin(); };
  }
  function initSkinSound() {
    initSkinImage();
    $('skinSound').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f || !cfg.skin) { $('skinSoundMsg').textContent = '스킨을 먼저 골라 주세요'; return; }
      try {
        await A.audio.saveSkinSound(cfg.skin, f);
        $('skinSoundClear').hidden = false;
        $('skinSoundMsg').textContent = f.name + ' 적용'; $('skinSoundMsg').className = 'msg ok';
        A.audio.preview();
      } catch (err) {
        $('skinSoundMsg').textContent = '이 파일은 재생할 수 없어요'; $('skinSoundMsg').className = 'msg err';
      }
      e.target.value = '';
    });
    $('skinSoundClear').onclick = async () => {
      await A.audio.clearSkinSound(cfg.skin);
      $('skinSoundClear').hidden = true; $('skinSoundMsg').textContent = '지웠어요. 합성음으로 돌아가요'; $('skinSoundMsg').className = 'msg';
    };
  }
  async function initSkins() {
    initSkinSound();
    try {
      const weapons = await A.skins.load();
      const w = weapons[0], ssel = $('skin');
      if (!w) throw new Error('밴달 스킨을 불러오지 못했어요');
      cfg.weapon = w.id;
      if (!w.skins.some((s) => s.id === cfg.skin)) cfg.skin = w.skins[0].id;
      fillOptions(ssel, w.skins.map((s) => [s.id, s.name]), cfg.skin);
      A.save();
      ssel.onchange = () => { cfg.skin = ssel.value; A.save(); showSkin(); };
      showSkin();
      $('skinMsg').textContent = '고른 스킨은 연습 중 화면 오른쪽 아래에 보여요.';
    } catch (e) {
      $('skin').innerHTML = '<option>불러오지 못했어요</option>';
      $('skinMsg').textContent = '스킨 목록은 인터넷 연결이 필요해요. 다른 기능은 그대로 쓸 수 있어요.';
    }
  }

  /* ---------- 모드 카드 ---------- */
  const AN = A.analysis, H = AN.history;
  const fmtNum = (v) => Math.round(v).toLocaleString('ko-KR');
  const escape = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 하루 루틴: 워밍업 → 정밀 → 플릭 → 전환 → 트래킹 → 이동 → 높이 → 각 잡기 → 반응 (약 11분)
  const ROUTINE = [
    ['grid', 60, '워밍업'], ['micro', 60, '정밀'], ['flick', 90, '플릭'], ['switch', 60, '전환'], ['track', 90, '트래킹'],
    ['strafe', 60, '이동 사격'], ['headline', 60, '높이 유지'], ['hold', 90, '각 잡기'], ['reaction', 45, '반응'],
  ].map(([id, sec, role]) => ({ id, sec, role }));
  const modeById = (id) => A.modes.find((m) => m.id === id);
  let routine = null;  // { i, results, banner }

  function card(m, extra) {
    const b = document.createElement('button');
    b.className = 'mode' + (extra ? ' ' + extra : '');
    b.innerHTML = '<div class="icon"></div><h2></h2><p></p><div class="best"></div>';
    b.querySelector('.icon').textContent = m.icon;
    b.querySelector('h2').textContent = m.name;
    b.querySelector('p').textContent = m.desc;
    return b;
  }
  function renderModes() {
    const box = $('modes');
    box.innerHTML = '';
    const total = Math.round((ROUTINE.reduce((a, s) => a + s.sec, 0) + ROUTINE.length * 4) / 60);
    const r = card({ icon: '📅', name: '하루 루틴', desc: ROUTINE.map((s) => modeById(s.id).name).join(' → ') + ' 순서로 이어서 해요. 약 ' + total + '분, 평소 기록과 비교해 오늘 컨디션과 약점을 알려 줘요.' }, 'feature');
    const streak = H.streak(), lastRun = H.list('routine').slice(-1)[0];
    r.querySelector('.best').textContent = (streak ? '🔥 ' + streak + '일 연속 · ' : '') + (lastRun ? '지난 루틴 평소 대비 ' + lastRun.score + '%' : '아직 해 본 적 없어요');
    r.onclick = startRoutine;
    box.appendChild(r);
    for (const m of A.modes) {
      const b = card(m, m.special ? 'feature' : '');
      const best = cfg.best[m.id], n = H.list(m.id).length, log = cfg.sensLog || [];
      b.querySelector('.best').textContent = m.id === 'sens'
        ? '지금 감도 ' + cfg.sens + (log.length ? ' · 마지막 조정 ' + new Date(log[log.length - 1].at).toLocaleDateString('ko-KR') : '')
        : best ? '최고 ' + fmtNum(best) + (n >= 2 ? ' · 최근 5회 평균 ' + fmtNum(H.average(m.id, 5)) : '') : '아직 기록이 없어요';
      b.onclick = () => { routine = null; start(m); };
      box.appendChild(b);
    }
    renderHistory();
  }

  /* ---------- 성장 기록 ---------- */
  function renderHistory() {
    const sel = $('historyMode');
    if (!sel.options.length) {
      for (const m of A.modes.filter((x) => !x.special)) sel.add(new Option(m.name, m.id));
      sel.add(new Option('하루 루틴 (평소 대비 %)', 'routine'));
      sel.value = cfg.historyMode || 'grid';
      sel.onchange = () => { cfg.historyMode = sel.value; A.save(); renderHistory(); };
    }
    const id = sel.value, list = H.list(id), routineView = id === 'routine';
    AN.drawTrend($('historyChart'), list, { format: routineView ? (v) => Math.round(v) + '%' : fmtNum });
    const rows = [];
    if (list.length) {
      const recent = H.average(id, 5), before = H.average(id, 5, 5);
      rows.push(['기록 수', list.length + '회']);
      rows.push(['최근 5회 평균', routineView ? Math.round(recent) + '%' : fmtNum(recent)]);
      if (before) rows.push(['그 전 5회 대비', (recent >= before ? '+' : '') + Math.round((recent / before - 1) * 100) + '%']);
      const accs = list.slice(-5).map((r) => r.acc).filter((v) => v != null);
      if (accs.length) rows.push(['최근 명중률', Math.round(AN.mean(accs)) + '%']);
      const react = list.slice(-5).map((r) => r.react).filter(Boolean);
      if (react.length) rows.push(['최근 반응', Math.round(AN.mean(react)) + 'ms']);
    }
    $('historyStats').innerHTML = rows.map((r) => '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
  }

  /* ---------- 진행 ---------- */
  function overlay(html, wide) {
    $('overlay').hidden = !html;
    $('overlayCard').className = 'card' + (wide ? ' wide' : '');
    $('overlayCard').innerHTML = html || '';
  }
  function lock() {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch (e) { canvas.requestPointerLock(); }
  }
  function start(mode, opts = {}) {
    if (!A.crossData) applyCode($('code').value);
    A.audio.unlock();
    current = mode;
    game.resize();
    game.reset(mode);
    state = 'countdown'; countdown = opts.countdown || 3;
    left = mode.trials ? Infinity : (opts.duration || cfg.duration);
    $('menu').hidden = true; overlay('');
    $('hudWeapon').hidden = true;
    if (document.pointerLockElement !== canvas) lock();  // 루틴 중에는 마우스를 잡은 채로 다음 모드로 넘어간다
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }
  function startRoutine() {
    routine = { i: 0, results: [], banner: '' };
    startStep();
  }
  function startStep() {
    const step = ROUTINE[routine.i];
    routine.banner = (routine.banner ? routine.banner + '   ·   ' : '') + '다음 ' + (routine.i + 1) + '/' + ROUTINE.length + ' ' + modeById(step.id).name + ' (' + step.role + ', ' + step.sec + '초)';
    start(modeById(step.id), { duration: step.sec, countdown: routine.i ? 4 : 3 });
  }
  function toMenu() {
    game.mouseDown = false;
    state = 'menu'; routine = null;
    cancelAnimationFrame(raf);
    overlay(''); $('menu').hidden = false; $('hudWeapon').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    renderModes();
  }

  /* 이번 판의 숫자들 (기록에 남는 값) */
  function summarize(s) {
    const r = s.extra.reactions || [];
    return {
      score: Math.round(s.score), acc: current.hold ? s.extra.trackingPct : (s.shots ? Math.round((s.hits / s.shots) * 100) : 0),
      kills: s.kills, heads: s.kills ? Math.round((s.heads / s.kills) * 100) : null,
      ttk: s.kills ? +(s.ttk / s.kills).toFixed(2) : null, react: r.length ? Math.round(AN.mean(r)) : null, sens: cfg.sens,
    };
  }
  const versus = (score, avg) => (score >= avg ? '+' : '') + Math.round((score / avg - 1) * 100) + '%';
  function analysisHtml(a) {
    if (!a.points.length && !a.trackTime) return '';
    const facts = [];
    if (a.flicks >= 3) facts.push('플릭: 지나침 ' + a.overPct + '% · 모자람 ' + a.underPct + '%');
    if (a.moving >= 3) facts.push('움직이는 타겟: 앞서 쏨 ' + a.aheadPct + '% · 뒤처짐 ' + a.behindPct + '%');
    if (a.vertical >= 3) facts.push('높이: 머리 위 ' + a.highPct + '% · 아래 ' + a.lowPct + '%');
    if (a.trackTime) facts.push('트래킹 이탈 시간: 뒤처짐 ' + a.trackBehindPct + '% · 앞섬 ' + a.trackAheadPct + '% · 위아래 ' + a.trackOffPct + '%');
    return '<div class="analysis">' + (a.points.length ? '<div class="mapbox"><canvas id="missMap"></canvas>' +
      '<div class="legend"><span><i class="h"></i>명중</span><span><i class="b"></i>몸</span><span><i class="m"></i>빗나감</span></div></div>' : '') +
      '<div class="facts"><h3>샷 분석</h3>' + facts.map((f) => '<p>' + f + '</p>').join('') +
      (a.tip ? '<p class="tip">💡 ' + escape(a.tip) + '</p>' : '<p class="msg">빗나간 샷이 거의 없어요. 좋아요!</p>') + '</div></div>';
  }
  function finish() {
    state = 'result';
    game.mouseDown = false;
    const s = game.stats, rec = summarize(s), score = rec.score;
    const prev = cfg.best[current.id] || 0, prevAvg = H.average(current.id, 10);
    if (score > prev) { cfg.best[current.id] = score; A.save(); }
    H.add(current.id, Object.assign({ routine: !!routine }, rec));
    const a = AN.shots(s.shotLog, current.hold ? s.track : null);

    if (routine) {
      routine.results.push({ mode: current, rec, prevAvg, log: s.shotLog, track: current.hold ? s.track : null });
      routine.i++;
      if (routine.i < ROUTINE.length) {
        routine.banner = current.name + ' ' + fmtNum(score) + '점' + (prevAvg ? ' (평소 ' + versus(score, prevAvg) + ')' : '');
        startStep();
        return;
      }
      if (document.pointerLockElement) document.exitPointerLock();
      routineResult();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (current.id === 'sens') { sensResult(s); return; }

    const rows = [
      ['처치', rec.kills], ['명중률', rec.acc + '%'],
      ['헤드샷', rec.heads != null ? rec.heads + '%' : '-'],
      ['평균 처치 시간', rec.ttk != null ? rec.ttk.toFixed(2) + '초' : '-'],
    ];
    if (current.hold) rows.splice(0, 4);
    if (current.summary) rows.push(...current.summary(game));
    if (prevAvg) rows.push(['최근 10회 평균 대비', versus(score, prevAvg)]);
    const table = rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
    overlay('<h2>' + current.name + ' 결과</h2><div class="big">' + fmtNum(score) + '</div>' +
      '<div class="msg">' + (score > prev ? '🏆 새 최고 점수!' : '최고 점수 ' + fmtNum(prev)) + '</div>' +
      '<div class="result-grid"><table>' + table + '</table>' + analysisHtml(a) + '</div>' +
      '<h3 class="sub">최근 추세 <small>파란 선: 점수 · 흐린 선: 5회 평균</small></h3><canvas id="trend" class="trend"></canvas>' +
      '<div class="actions"><button class="primary" id="again">다시 하기 (T)</button><button id="home">메뉴</button></div>', true);
    if ($('missMap')) AN.drawMisses($('missMap'), a.points);
    AN.drawTrend($('trend'), H.list(current.id), { format: fmtNum });
    $('again').onclick = () => start(current);
    $('home').onclick = toMenu;
  }

  function sensResult(s) {
    const rec = AN.recommendSens(cfg.sens, s.extra.ratios || []), change = rec.enough && !rec.steady;
    let body;
    if (!rec.enough) body = '<p class="msg">잴 수 있었던 플릭이 ' + rec.count + '번뿐이라 추천하기엔 부족해요. 타겟이 뜨면 한 번에 휘둘러 주세요.</p>';
    else {
      const verdict = rec.steady ? '지금 감도가 손에 잘 맞아요. 바꾸지 않아도 돼요.'
        : rec.ratio > AN.IDEAL ? '첫 동작이 타겟을 지나쳐요. 감도를 조금 낮추는 걸 추천해요.' : '첫 동작이 타겟에 못 미쳐요. 감도를 조금 올리는 걸 추천해요.';
      body = '<table>' +
        '<tr><td>첫 동작이 멈춘 곳</td><td>거리의 ' + Math.round(rec.ratio * 100) + '% <small>(기준 ' + Math.round(AN.IDEAL * 100) + '%)</small></td></tr>' +
        '<tr><td>일관성</td><td>' + (rec.spread > 0.3 ? '들쭉날쭉' : '안정적') + ' ±' + Math.round(rec.spread * 50) + '%</td></tr>' +
        '<tr><td>잰 플릭</td><td>' + rec.count + '번</td></tr></table>' +
        '<p class="tip">' + verdict + (rec.spread > 0.3 && !rec.steady ? ' 끝점이 들쭉날쭉해서 변화는 절반만 반영했어요.' : '') + '</p>' +
        (change ? '<div class="sens-change"><span>' + cfg.sens + '</span><em>→</em><b>' + rec.next + '</b><small>' + (rec.change > 0 ? '+' : '') + rec.change + '%</small></div>' +
          '<p class="hint">게임 감도도 같은 숫자로 바꿔야 연습이 이어져요. 한 번에 크게 바꾸지 않도록 −20%~+25% 안에서만 추천하고, 바꾼 뒤 한 번 더 재서 확인하세요.</p>' : '');
    }
    overlay('<h2>⚖ 감도 맞추기 결과</h2>' + body + '<div class="actions">' +
      (change ? '<button class="primary" id="applySens">' + rec.next + '로 바꾸고 다시 재기</button>' : '') +
      '<button id="again"' + (change ? '' : ' class="primary"') + '>다시 재기</button><button id="home">메뉴</button></div>');
    if ($('applySens')) $('applySens').onclick = () => {
      cfg.sensLog = (cfg.sensLog || []).concat({ at: Date.now(), from: cfg.sens, to: rec.next, ratio: +rec.ratio.toFixed(3) }).slice(-30);
      cfg.sens = rec.next; $('sens').value = cfg.sens; A.save();
      start(current);
    };
    $('again').onclick = () => start(current);
    $('home').onclick = toMenu;
  }

  function routineResult() {
    const res = routine.results, compared = res.filter((r) => r.prevAvg);
    const ratio = (r) => r.rec.score / r.prevAvg;
    const overall = compared.length ? Math.round(AN.mean(compared.map(ratio)) * 100) : 100;
    const order = compared.slice().sort((a, b) => ratio(a) - ratio(b)), weakest = order[0], strongest = order[order.length - 1];
    const track = { time: 0, ahead: 0, behind: 0, vertical: 0 };
    for (const r of res) if (r.track) for (const k in track) track[k] += r.track[k];
    const all = AN.shots(res.flatMap((r) => r.log), track);
    H.add('routine', { score: overall, steps: res.map((r) => [r.mode.id, r.rec.score]) });
    const streak = H.streak();
    const rows = res.map((r) => '<tr><td>' + r.mode.name + '</td><td>' + fmtNum(r.rec.score) + '</td><td class="' +
      (r.prevAvg ? (ratio(r) >= 1 ? 'up' : 'down') : '') + '">' + (r.prevAvg ? versus(r.rec.score, r.prevAvg) : '첫 기록') + '</td></tr>').join('');
    overlay('<h2>📅 하루 루틴 완료</h2><div class="big">' + overall + '%</div>' +
      '<div class="msg">' + (compared.length ? '평소 기록 대비' : '첫 루틴이라 다음부터 평소와 비교해요') + (streak > 1 ? ' · 🔥 ' + streak + '일 연속' : '') + '</div>' +
      '<div class="result-grid"><table><tr><th>모드</th><th>점수</th><th>평소 대비</th></tr>' + rows + '</table>' + analysisHtml(all) + '</div>' +
      (weakest && weakest !== strongest ? '<p class="tip">오늘 가장 좋았던 건 <b>' + strongest.mode.name + '</b>, 가장 약했던 건 <b>' + weakest.mode.name + '</b>이에요. 시간이 남으면 ' + weakest.mode.name + '을 한 판 더 해 보세요.</p>' : '') +
      '<h3 class="sub">루틴 추세 <small>100% = 평소</small></h3><canvas id="trend" class="trend"></canvas>' +
      '<div class="actions">' + (weakest ? '<button class="primary" id="weak">' + weakest.mode.name + ' 한 판 더</button>' : '') + '<button id="home">메뉴</button></div>', true);
    if ($('missMap')) AN.drawMisses($('missMap'), all.points);
    AN.drawTrend($('trend'), H.list('routine'), { format: (v) => Math.round(v) + '%' });
    if ($('weak')) $('weak').onclick = () => { const m = weakest.mode; routine = null; start(m); };
    $('home').onclick = toMenu;
  }
  function pause() {
    game.mouseDown = false;
    state = 'pause';
    overlay('<h2>일시정지</h2><p class="msg">Esc 로 마우스가 풀렸어요.' + (routine ? ' 메뉴로 가면 루틴이 끝나요.' : '') + '</p><div class="actions"><button class="primary" id="resume">계속하기</button><button id="home">메뉴</button></div>');
    $('resume').onclick = () => { overlay(''); state = 'run'; last = performance.now(); lock(); };
    $('home').onclick = toMenu;
  }

  function hud(ctx) {
    const s = game.stats, { W } = game, k = Math.max(1, game.H / 1080);
    ctx.font = '600 ' + Math.round(22 * k) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.textAlign = 'center';
    if (Number.isFinite(left)) ctx.fillText(Math.ceil(left) + '초', W / 2, 44 * k);
    if (routine) {
      ctx.font = '500 ' + Math.round(14 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = 'rgba(203,216,219,.9)';
      ctx.fillText('하루 루틴 ' + (routine.i + 1) + ' / ' + ROUTINE.length + ' · ' + current.name, W / 2, 68 * k);
      ctx.font = '600 ' + Math.round(22 * k) + 'px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.92)';
    }
    ctx.textAlign = 'left';
    ctx.fillText('점수 ' + Math.round(s.score), 24 * k, 44 * k);
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    ctx.fillText('명중률 ' + acc + '%', 24 * k, 74 * k);
    if (state === 'countdown') {
      ctx.textAlign = 'center';
      ctx.font = '700 ' + Math.round(96 * k) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, game.cy - 120 * k);
      if (routine && routine.banner) {
        ctx.font = '600 ' + Math.round(20 * k) + 'px system-ui, sans-serif';
        ctx.fillText(routine.banner, W / 2, game.cy - 230 * k);
      }
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (state === 'countdown') {
      countdown -= dt;
      if (countdown <= 0) { state = 'run'; }
    } else if (state === 'run') {
      game.update(dt);
      left -= dt;
      if (left <= 0 || game.over) { left = Math.max(0, left); game.render(); hud(game.ctx); finish(); return; }
    }
    game.render();
    hud(game.ctx);
  }

  /* ---------- 입력 ---------- */
  document.addEventListener('mousemove', (e) => {
    if ((state === 'run' || state === 'countdown') && document.pointerLockElement === canvas) game.look(e.movementX, e.movementY);
  });
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || state !== 'run' || document.pointerLockElement !== canvas) return;
    game.mouseDown = true;
    if (!current.hold) game.fire();
  });
  document.addEventListener('mouseup', () => { game.mouseDown = false; });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && (state === 'run' || state === 'countdown')) pause();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 't' && (state === 'run' || state === 'result') && !routine) start(current);
    if (e.key === 'Escape' && !document.pointerLockElement && (state === 'run' || state === 'countdown')) pause();
  });
  window.addEventListener('blur', () => { game.mouseDown = false; });
  window.addEventListener('resize', () => { game.resize(); if (state === 'menu') drawPreview(); });

  /* 주소 뒤에 #code=조준선코드 가 붙어 오면(디스코드 봇 링크) 그 조준선으로 바꿔 시작한다 */
  try {
    const m = /[#&]code=([^&]+)/.exec(location.hash);
    if (m) {
      const text = decodeURIComponent(m[1]);
      A.crosshair.parse(text);
      cfg.crosshair = text; A.save();
    }
  } catch (e) { /* 잘못된 코드는 무시하고 저장된 조준선을 쓴다 */ }

  initSettings();
  renderModes();
  initSkins();
  drawPreview();
})(window.Aim);
