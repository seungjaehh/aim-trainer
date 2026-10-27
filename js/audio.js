/* 킬·타격 사운드. 파일 없이 WebAudio 로 합성하고, 내 소리 파일을 올려 쓸 수도 있다.
   '스킨 맞춤' 은 고른 스킨의 시리즈(프라임·리버·오니…)마다 어울리는 소리를 합성해 낸다. */
(function (A) {
  let ctx = null, custom = null, skin = null, skinBufs = [], streak = 0, loadVersion = 0;
  const audio = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const c = audio(), o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const peak = Math.max((opts.gain || 0.5) * A.cfg.volume, 0.0002);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function noise(start, dur, gain, fade) {
    const c = audio(), n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (fade === false ? 1 : 1 - i / n);
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    g.gain.value = gain * A.cfg.volume;
    src.connect(g).connect(c.destination);
    src.start(c.currentTime + start);
  }

  const KILL = {
    valo: (hs) => { tone(hs ? 1568 : 1175, 0, 0.12, { type: 'triangle' }); tone(hs ? 2349 : 1760, 0.07, 0.22, { gain: 0.45 }); noise(0, 0.03, 0.25); },
    ding: (hs) => { tone(hs ? 2093 : 1568, 0, 0.5); tone(hs ? 3136 : 2349, 0, 0.35, { gain: 0.25 }); },
    pop: (hs) => { tone(hs ? 900 : 650, 0, 0.12, { to: 140, gain: 0.7 }); },
    chime: (hs) => { [0, 0.06, 0.12].forEach((t, i) => tone((hs ? 1318 : 1047) * [1, 1.25, 1.5][i], t, 0.25, { type: 'triangle', gain: 0.4 })); },
    snap: (hs) => { noise(0, 0.05, 0.6); tone(hs ? 1800 : 1200, 0, 0.06, { type: 'square', gain: 0.25 }); },
  };

  /* 스킨 시리즈별 킬사운드. hs(헤드샷)이면 한 음 높고 한 겹 더 쌓인다 */
  const SKIN = {
    prime: (p) => { tone(75, 0, 0.4, { to: 45, gain: 0.9 }); [1, 1.5, 2].forEach((m, i) => tone(880 * m * p, 0.02 + i * 0.05, 0.45, { type: 'triangle', gain: 0.35 })); },
    reaver: (p) => { tone(190, 0, 0.35, { to: 55, type: 'sawtooth', gain: 0.45 }); tone(659 * p, 0.04, 0.6, { gain: 0.35 }); tone(784 * p, 0.1, 0.6, { gain: 0.3 }); noise(0, 0.08, 0.25); },
    elderflame: (p) => { noise(0, 0.55, 0.45); tone(60, 0, 0.55, { to: 40, type: 'triangle', gain: 0.8 }); for (let i = 0; i < 4; i++) noise(0.08 + i * 0.07, 0.02, 0.5); tone(520 * p, 0.05, 0.3, { type: 'sawtooth', gain: 0.15 }); },
    glitchpop: (p) => { [1319, 1568, 1760, 2093, 1568, 2637].forEach((f, i) => tone(f * p, i * 0.04, 0.05, { type: 'square', gain: 0.22 })); noise(0.18, 0.04, 0.3); },
    oni: (p) => { [1, 2.76, 5.4, 8.9].forEach((m, i) => tone(196 * m * p, 0, 1.1 / (i + 1) + 0.15, { gain: 0.5 / (i + 1) })); noise(0, 0.03, 0.3); },
    ion: (p) => { tone(3200 * p, 0, 0.22, { to: 180, type: 'sawtooth', gain: 0.3 }); tone(1800 * p, 0.02, 0.3, { gain: 0.3 }); noise(0, 0.05, 0.35); },
    sovereign: (p) => { [523, 659, 784, 1047].forEach((f, i) => tone(f * p, i * 0.05, 0.9, { gain: 0.3 })); tone(131 * p, 0, 0.5, { gain: 0.5 }); },
    gaia: (p) => { [523, 659, 784].forEach((f, i) => { tone(f * p, i * 0.07, 0.22, { gain: 0.5 }); tone(f * 4 * p, i * 0.07, 0.04, { gain: 0.25 }); }); noise(0, 0.02, 0.3); },
    rgx: (p) => { [220, 330, 440].forEach((f) => tone(f * p, 0, 0.22, { type: 'square', gain: 0.18 })); tone(1760 * p, 0.03, 0.15, { type: 'sawtooth', gain: 0.18 }); noise(0, 0.04, 0.3); },
    spectrum: (p) => { tone(110, 0, 0.5, { to: 50, type: 'sawtooth', gain: 0.55 }); tone(1480 * p, 0.05, 0.25, { type: 'triangle', gain: 0.3 }); tone(1976 * p, 0.12, 0.3, { type: 'triangle', gain: 0.25 }); },
    champions: (p) => { [392, 523, 659, 784].forEach((f, i) => tone(f * p, i * 0.06, 0.4, { type: 'triangle', gain: 0.4 })); noise(0.2, 0.15, 0.15); },
    singularity: (p) => { tone(200, 0, 0.2, { to: 2400 * p, gain: 0.4 }); tone(70, 0.2, 0.3, { to: 35, gain: 0.8 }); noise(0.2, 0.06, 0.4); },
    recon: (p) => { noise(0, 0.04, 0.5); tone(1000 * p, 0.03, 0.05, { type: 'square', gain: 0.2 }); tone(1000 * p, 0.1, 0.05, { type: 'square', gain: 0.2 }); tone(160, 0, 0.2, { to: 70, type: 'triangle', gain: 0.6 }); },
    cyrax: (p) => { tone(300 * p, 0, 0.3, { to: 1800 * p, type: 'sawtooth', gain: 0.25 }); tone(2400 * p, 0.1, 0.25, { type: 'triangle', gain: 0.3 }); tone(90, 0, 0.25, { to: 40, gain: 0.7 }); noise(0.1, 0.05, 0.3); },
    magepunk: (p) => { for (let i = 0; i < 5; i++) noise(i * 0.03, 0.02, 0.4); tone(1100 * p, 0.02, 0.18, { type: 'square', to: 500, gain: 0.25 }); tone(2200 * p, 0.06, 0.25, { gain: 0.25 }); },
  };
  const PROFILES = Object.keys(SKIN);
  /* 시리즈 이름(소문자) 일부 → 소리 */
  const THEME_MAP = [
    ['prime', 'prime'], ['reaver', 'reaver'], ['ruination', 'reaver'], ['forsaken', 'reaver'], ['doombringer', 'reaver'], ['nocturnum', 'reaver'],
    ['elderflame', 'elderflame'], ['araxys', 'elderflame'], ['emberclad', 'elderflame'], ['ignite', 'elderflame'], ['dragon', 'elderflame'],
    ['glitchpop', 'glitchpop'], ['.exe', 'glitchpop'], ['.sys', 'glitchpop'], ['digihex', 'glitchpop'], ['byteshift', 'glitchpop'],
    ['oni', 'oni'], ['kuronami', 'oni'], ['ayakashi', 'oni'], ['songsteel', 'oni'],
    ['ion', 'ion'], ['protocol', 'ion'], ['xenohunter', 'ion'], ['xerøfang', 'ion'], ['neo frontier', 'ion'], ['lightwave', 'ion'],
    ['sovereign', 'sovereign'], ['imperium', 'sovereign'], ['monarch', 'sovereign'], ['luxe', 'sovereign'], ['celestial', 'sovereign'],
    ['gaia', 'gaia'], ['primordium', 'gaia'], ['verdant', 'gaia'], ['silvanus', 'gaia'], ['aquatica', 'gaia'],
    ['rgx', 'rgx'], ['radiant', 'rgx'], ['frequency', 'rgx'], ['retrowave', 'rgx'], ['overdrive', 'rgx'],
    ['spectrum', 'spectrum'], ['hivemind', 'spectrum'], ['venturi', 'spectrum'],
    ['champions', 'champions'], ['vct', 'champions'], ['lock//in', 'champions'], ['team ace', 'champions'],
    ['singularity', 'singularity'], ['chronovoid', 'singularity'], ['gravitational', 'singularity'], ['convergence', 'singularity'],
    ['magepunk', 'magepunk'], ['spline', 'magepunk'], ['nanobreak', 'magepunk'], ['arcane', 'magepunk'],
  ];
  function profileFor(s) {
    if (!s) return null;
    if (s.sound && SKIN[s.sound]) return s.sound;
    const name = (s.theme || '').toLowerCase();
    const words = ' ' + name + ' ';
    // 짧은 이름(ion, oni)은 'champions' 같은 낱말 속에 섞이지 않도록 단어 단위로만 맞춘다
    for (const [key, p] of THEME_MAP) if (key.length <= 3 ? words.includes(' ' + key + ' ') : name.includes(key)) return p;
    // 목록에 없는 시리즈도 매번 같은 소리가 나도록 이름으로 고른다
    let h = 0;
    for (const c of (s.themeId || s.theme || s.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return PROFILES[h % PROFILES.length];
  }

  const HIT = {
    tick: () => tone(2200, 0, 0.04, { type: 'square', gain: 0.18 }),
    thud: () => tone(220, 0, 0.09, { to: 90, gain: 0.7 }),
    none: () => {},
  };
  const LISTS = {
    kill: [['skin', '스킨 맞춤 (고른 스킨 시리즈에 맞게)'], ['valo', '발로란트풍'], ['ding', '딩'], ['pop', '팝'], ['chime', '차임'], ['snap', '스냅'], ['custom', '내 파일'], ['none', '없음']],
    hit: [['tick', '틱'], ['thud', '퉁'], ['none', '없음']],
  };

  function playCustom() {
    if (!custom) return false;
    const c = audio(), src = c.createBufferSource(), g = c.createGain();
    src.buffer = custom;
    g.gain.value = A.cfg.volume;
    src.connect(g).connect(c.destination);
    src.start();
    return true;
  }
  /* 스킨별로 내가 올린 킬사운드. 이 브라우저(IndexedDB)에만 저장되고 어디로도 올라가지 않는다 */
  const idb = () => new Promise((ok, no) => {
    const r = indexedDB.open('aimtrainer.skinsound', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const idbDo = (mode, fn) => idb().then((db) => new Promise((ok, no) => {
    const q = fn(db.transaction('s', mode).objectStore('s'));
    q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
  }));
  function playBuf(buf, gain) {
    const c = audio(), src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    g.gain.value = A.cfg.volume * (gain || 1);
    src.connect(g).connect(c.destination);
    src.start();
  }
  A.audio = {
    lists: LISTS,
    async loadSkinSound(id) {
      const version = ++loadVersion;
      skinBufs = []; streak = 0;
      if (!id) return false;
      try {
        const l = A.skins && await A.skins.localAsset(id);
        const names = l && (l.kills || (l.kill && [l.kill]));  // kills: 연속 헤드샷 1~5킬 순서
        const dec = async (data) => audio().decodeAudioData(data.slice(0));
        let bufs;
        if (names && names.length) bufs = await Promise.all(names.map((n) => fetch(A.skins.assetUrl(l, n)).then((r) => {
          if (!r.ok) throw new Error('음원을 불러오지 못했어요: ' + r.status);
          return r.arrayBuffer();
        }).then(dec)));
        else { const data = await idbDo('readonly', (s) => s.get(id)); bufs = data ? [await dec(data)] : []; }
        if (version !== loadVersion) return false;
        skinBufs = bufs;
      } catch (e) { /* 저장소를 못 써도 합성음으로 동작 */ }
      return version === loadVersion && skinBufs.length > 0;
    },
    async saveSkinSound(id, file) {
      const data = await file.arrayBuffer();
      const buf = await audio().decodeAudioData(data.slice(0));  // 재생 못 하는 파일이면 여기서 던진다
      await idbDo('readwrite', (s) => s.put(data, id));
      skinBufs = [buf];
    },
    async clearSkinSound(id) { skinBufs = []; try { await idbDo('readwrite', (s) => s.delete(id)); } catch (e) { /* 없으면 그만 */ } },
    hasSkinSound() { return skinBufs.length > 0; },
    resetStreak() { streak = 0; },
    setSkin(s) { skin = s || null; streak = 0; },
    profile() { return profileFor(skin); },
    kill(hs) {
      const k = A.cfg.kill;
      if (k === 'none') return;
      if (k === 'custom') { if (!playCustom()) KILL.valo(hs); return; }
      if (k === 'skin') {
        streak = hs ? streak + 1 : 0;  // 헤드샷 연속 킬이 이어질 때만 단계가 오르고, 5단계부터는 계속 5단계 소리
        if (skinBufs.length) { playBuf(skinBufs[Math.min(streak, skinBufs.length) - 1] || skinBufs[0]); return; }
        const p = profileFor(skin);
        if (!p) { KILL.valo(hs); return; }
        SKIN[p](hs ? 1.25 : 1);
        if (hs) tone(2637, 0.03, 0.2, { gain: 0.22 });  // 헤드샷은 높은 음이 한 겹 더
        return;
      }
      (KILL[k] || KILL.valo)(hs);
    },
    hit() { (HIT[A.cfg.hit] || HIT.tick)(); },
    unlock() { try { audio().resume(); } catch (e) { /* 소리 없이도 연습은 가능 */ } },
    async loadFile(file) { custom = await audio().decodeAudioData(await file.arrayBuffer()); },
    preview() { this.unlock(); this.kill(true); },
  };
})(window.Aim = window.Aim || {});
