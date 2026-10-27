(function (A) {
  const KEY = 'aimtrainer.v1';
  const DEFAULTS = {
    sens: 0.4, dpi: 800, fov: 103,
    crosshair: '0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0',
    chScale: 1, targetSize: 1, duration: 60, bg: 'range', guide: true, holdSpeed: 'random',
    kill: 'skin', hit: 'tick', volume: 0.6,
    weapon: '', skin: '', best: {},
  };
  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  const cfg = load();
  // 기존 격자 배경을 쓰던 브라우저도 바닥이 있는 연습장으로 한 번 전환한다.
  if (!cfg.roomVersion) { cfg.bg = 'range'; cfg.roomVersion = 1; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); }
    catch (e) { /* 저장소가 막혀 있어도 동작은 계속된다 */ }
  }
  A.cfg = cfg;
  A.save = save;
})(window.Aim = window.Aim || {});
