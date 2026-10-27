(function (A) {
  const KEY = 'aimtrainer.v1';
  const DEFAULTS = {
    sens: 0.4, dpi: 800, fov: 103,
    crosshair: '0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0',
    chScale: 1, targetSize: 1, duration: 60, bg: 'dark', guide: true,
    kill: 'skin', hit: 'tick', volume: 0.6,
    weapon: '', skin: '', best: {},
  };
  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  const cfg = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); }
    catch (e) { /* 저장소가 막혀 있어도 동작은 계속된다 */ }
  }
  A.cfg = cfg;
  A.save = save;
})(window.Aim = window.Aim || {});
