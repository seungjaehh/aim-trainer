/* 킬·타격 사운드. 파일 없이 WebAudio 로 합성하고, 내 소리 파일을 올려 쓸 수도 있다. */
(function (A) {
  let ctx = null, custom = null;
  const audio = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const c = audio(), o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const peak = Math.max((opts.gain || 0.5) * A.cfg.volume, 0.0002);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  function noise(start, dur, gain) {
    const c = audio(), n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
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
  const HIT = {
    tick: () => tone(2200, 0, 0.04, { type: 'square', gain: 0.18 }),
    thud: () => tone(220, 0, 0.09, { to: 90, gain: 0.7 }),
    none: () => {},
  };
  const LISTS = {
    kill: [['valo', '발로란트풍'], ['ding', '딩'], ['pop', '팝'], ['chime', '차임'], ['snap', '스냅'], ['custom', '내 파일'], ['none', '없음']],
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
  A.audio = {
    lists: LISTS,
    kill(hs) {
      const k = A.cfg.kill;
      if (k === 'none') return;
      if (k === 'custom') { if (!playCustom()) KILL.valo(hs); return; }
      (KILL[k] || KILL.valo)(hs);
    },
    hit() { (HIT[A.cfg.hit] || HIT.tick)(); },
    unlock() { try { audio().resume(); } catch (e) { /* 소리 없이도 연습은 가능 */ } },
    async loadFile(file) { custom = await audio().decodeAudioData(await file.arrayBuffer()); },
    preview() { this.unlock(); this.kill(true); },
  };
})(window.Aim = window.Aim || {});
