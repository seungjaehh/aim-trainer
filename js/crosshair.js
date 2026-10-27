/* 발로란트 조준선 코드 → 캔버스. discord_bot/core/crosshair.py 와 같은 규칙으로 'P' 구역을 읽고,
   조준선은 게임 픽셀 그대로(보간 없이) 그린다. */
(function (A) {
  const COLORS = [
    ['흰색', [255, 255, 255]], ['초록', [0, 255, 0]], ['연두', [127, 255, 0]], ['황록', [223, 255, 0]],
    ['노랑', [255, 255, 0]], ['청록', [0, 255, 255]], ['분홍', [255, 0, 255]], ['빨강', [255, 0, 0]],
  ];
  const DEFAULTS = {
    c: 0, h: 1, t: 1, o: 0.5, d: 0, z: 2, a: 1.0,
    '0b': 1, '0t': 2, '0l': 6, '0v': null, '0g': 0, '0o': 3, '0a': 0.8,
    '1b': 1, '1t': 2, '1l': 2, '1v': null, '1g': 0, '1o': 10, '1a': 0.35,
  };
  const SECTIONS = ['P', 'A', 'S'];
  const LIMIT = 40;

  function parse(code) {
    const parts = String(code).trim().split(';');
    const start = parts.indexOf('P');
    if (start < 0) throw new Error('P 구역이 없어요');
    const raw = {};
    for (let i = start + 1; i + 1 < parts.length && !SECTIONS.includes(parts[i]); i += 2) raw[parts[i]] = parts[i + 1];
    const s = Object.assign({}, DEFAULTS);
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'u') { s.u = value; continue; }
      if (!(key in DEFAULTS)) continue;
      const n = parseFloat(value);
      if (Number.isNaN(n)) throw new Error('숫자가 아닌 값이 있어요: ' + key);
      if (['o', 'a', '0a', '1a'].includes(key)) s[key] = Math.min(Math.max(n, 0), 1);
      else s[key] = Math.min(Math.max(Math.trunc(n), 0), LIMIT);
    }
    return s;
  }

  function colorOf(s) {
    if (s.u && Number(s.c) === 8) {
      const hex = s.u.slice(0, 6);
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    }
    const i = s.c >= 0 && s.c < COLORS.length ? s.c : 0;
    return COLORS[i][1];
  }

  /* 중심(0,0) 기준 사각형 목록 */
  function shapes(s) {
    const list = [];
    if (s.d) list.push({ x0: -s.z / 2, y0: -s.z / 2, x1: s.z / 2, y1: s.z / 2, a: s.a });
    for (const p of ['0', '1']) {
      if (!s[p + 'b'] || s[p + 'a'] <= 0) continue;
      const len = s[p + 'l'];
      const vlen = s[p + 'g'] && s[p + 'v'] !== null ? s[p + 'v'] : len;
      const off = s[p + 'o'], half = s[p + 't'] / 2, a = s[p + 'a'];
      if (len > 0) {
        list.push({ x0: off, y0: -half, x1: off + len, y1: half, a });
        list.push({ x0: -off - len, y0: -half, x1: -off, y1: half, a });
      }
      if (vlen > 0) {
        list.push({ x0: -half, y0: -off - vlen, x1: half, y1: -off, a });
        list.push({ x0: -half, y0: off, x1: half, y1: off + vlen, a });
      }
    }
    return list;
  }

  function draw(ctx, cx, cy, s, scale) {
    scale = scale || 1;
    const rgb = colorOf(s);
    const list = shapes(s);
    const r = (v) => Math.round(v * scale);
    const box = (q, grow, style) => {
      const x0 = cx + r(q.x0 - grow), y0 = cy + r(q.y0 - grow), x1 = cx + r(q.x1 + grow), y1 = cy + r(q.y1 + grow);
      ctx.fillStyle = style;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    };
    if (s.h) for (const q of list) box(q, s.t, 'rgba(0,0,0,' + s.o + ')');
    for (const q of list) box(q, 0, 'rgba(' + rgb.join(',') + ',' + q.a + ')');
  }

  A.crosshair = { parse, draw, colorOf, COLORS };
})(window.Aim = window.Aim || {});
