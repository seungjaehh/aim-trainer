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
  function renderModes() {
    const box = $('modes');
    box.innerHTML = '';
    for (const m of A.modes) {
      const b = document.createElement('button');
      b.className = 'mode';
      const best = cfg.best[m.id];
      b.innerHTML = '<div class="icon"></div><h2></h2><p></p><div class="best"></div>';
      b.querySelector('.icon').textContent = m.icon;
      b.querySelector('h2').textContent = m.name;
      b.querySelector('p').textContent = m.desc;
      b.querySelector('.best').textContent = best ? '최고 점수 ' + best : '아직 기록이 없어요';
      b.onclick = () => start(m);
      box.appendChild(b);
    }
  }

  /* ---------- 진행 ---------- */
  function overlay(html) {
    $('overlay').hidden = !html;
    $('overlayCard').innerHTML = html || '';
  }
  function lock() {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => canvas.requestPointerLock());
    } catch (e) { canvas.requestPointerLock(); }
  }
  function start(mode) {
    if (!A.crossData) applyCode($('code').value);
    A.audio.unlock();
    current = mode;
    game.resize();
    game.reset(mode);
    state = 'countdown'; countdown = 3; left = cfg.duration;
    $('menu').hidden = true; overlay('');
    $('hudWeapon').hidden = true;
    lock();
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }
  function toMenu() {
    game.mouseDown = false;
    state = 'menu';
    cancelAnimationFrame(raf);
    overlay(''); $('menu').hidden = false; $('hudWeapon').hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    renderModes();
  }
  function finish() {
    state = 'result';
    if (document.pointerLockElement) document.exitPointerLock();
    const s = game.stats, score = Math.round(s.score);
    const prev = cfg.best[current.id] || 0;
    if (score > prev) { cfg.best[current.id] = score; A.save(); }
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    const rows = [
      ['처치', s.kills], ['명중률', acc + '%'],
      ['헤드샷', s.kills ? Math.round((s.heads / s.kills) * 100) + '%' : '-'],
      ['평균 처치 시간', s.kills ? (s.ttk / s.kills).toFixed(2) + '초' : '-'],
    ];
    if (current.hold) rows.splice(0, 4);
    if (current.summary) rows.push(...current.summary(game));
    const table = rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
    overlay('<h2>' + current.name + ' 결과</h2><div class="big">' + score + '</div>' +
      '<div class="msg">' + (score > prev ? '🏆 새 최고 점수!' : '최고 점수 ' + prev) + '</div>' +
      '<table>' + table + '</table><div class="actions"><button class="primary" id="again">다시 하기</button><button id="home">메뉴</button></div>');
    $('again').onclick = () => start(current);
    $('home').onclick = toMenu;
  }
  function pause() {
    game.mouseDown = false;
    state = 'pause';
    overlay('<h2>일시정지</h2><p class="msg">Esc 로 마우스가 풀렸어요.</p><div class="actions"><button class="primary" id="resume">계속하기</button><button id="home">메뉴</button></div>');
    $('resume').onclick = () => { overlay(''); state = 'run'; last = performance.now(); lock(); };
    $('home').onclick = toMenu;
  }

  function hud(ctx) {
    const s = game.stats, { W } = game, k = Math.max(1, game.H / 1080);
    ctx.font = '600 ' + Math.round(22 * k) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(left) + '초', W / 2, 44 * k);
    ctx.textAlign = 'left';
    ctx.fillText('점수 ' + Math.round(s.score), 24 * k, 44 * k);
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    ctx.fillText('명중률 ' + acc + '%', 24 * k, 74 * k);
    if (state === 'countdown') {
      ctx.textAlign = 'center';
      ctx.font = '700 ' + Math.round(96 * k) + 'px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(String(Math.ceil(countdown)), W / 2, game.cy - 120 * k);
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
      if (left <= 0) { left = 0; game.render(); hud(game.ctx); finish(); return; }
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
    if (e.key.toLowerCase() === 't' && state === 'run') start(current);
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
