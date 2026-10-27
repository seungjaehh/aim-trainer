/* 무기 스킨. valorant-api.com 에서 불러와 화면에 총 이미지·탄창·연사 속도를 적용한다. 오프라인이면 스킨 메뉴만 비활성. */
(function (A) {
  let weapons = [];
  /* 연습에 쓸 무기·스킨 (무기 순서 그대로). [스킨 uuid, 킬사운드 이름] */
  const SET = [
    ['9c82e19d-4575-0200-1a81-3eacf00cf872', [['9bf19b77-4b33-7203-9f2c-16932970622f', 'champions'], ['000ad7b1-44b0-9345-ea47-9cbd7dcdbb38', 'gaia'], ['d8d5d7a1-4d81-8560-54bc-0692ab40f69b', 'oni']]],  // 밴달
  ];
  async function load() {
    const [res, themeRes] = await Promise.all([
      fetch('https://valorant-api.com/v1/weapons?language=ko-KR'),
      fetch('https://valorant-api.com/v1/themes').catch(() => null),
    ]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const themes = {};  // 스킨 시리즈 이름(영문)은 킬사운드를 고르는 데 쓴다
    try { if (themeRes && themeRes.ok) for (const t of (await themeRes.json()).data) themes[t.uuid] = t.displayName; } catch (e) { /* 시리즈 이름 없이도 동작 */ }
    const all = (await res.json()).data;
    weapons = SET.map(([wid, list]) => {
      const w = all.find((x) => x.uuid === wid);
      if (!w) return null;
      const st = w.weaponStats;
      return {
        id: w.uuid, name: w.displayName,
        stats: st ? { rate: st.fireRate, mag: st.magazineSize, reload: st.reloadTimeSeconds } : null,
        skins: list.map(([sid, sound]) => {
          const s = w.skins.find((x) => x.uuid === sid);
          if (!s) return null;
          return {
            id: s.uuid, name: s.displayName, sound, themeId: s.themeUuid, theme: themes[s.themeUuid] || '',
            muzzle: s.uuid === '9bf19b77-4b33-7203-9f2c-16932970622f' ? { x: 0.133, y: 0.178 } : { x: 0.17, y: 0.1 },
            icon: s.displayIcon || (s.chromas && s.chromas[0] && (s.chromas[0].fullRender || s.chromas[0].displayIcon)) || '',
          };
        }).filter((s) => s && s.icon),
      };
    }).filter((w) => w && w.skins.length);
    return weapons;
  }
  const weapon = (weaponId) => weapons.find((x) => x.id === weaponId);
  const find = (weaponId, skinId) => {
    const w = weapon(weaponId);
    return w && w.skins.find((s) => s.id === skinId);
  };
  /* 스킨별로 내가 올린 1인칭 총 이미지. 이 브라우저(IndexedDB)에만 저장된다 */
  const db = () => new Promise((ok, no) => {
    const r = indexedDB.open('aimtrainer.skinimg', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('i');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const run = (mode, fn) => db().then((d) => new Promise((ok, no) => {
    const q = fn(d.transaction('i', mode).objectStore('i'));
    q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
  }));
  /* 녹화한 기본 이미지·음원은 공개판에도 포함한다. localhost에서는 local/ 파일로 덮어쓸 수 있다. */
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  let manifest = null;
  const localAsset = async (id) => {
    const read = (base) => fetch(base + 'manifest.json?v=gaia-stacks-1').then((r) => r.ok ? r.json() : {}).then((entries) =>
      Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { ...value, base }]))).catch(() => ({}));
    if (!manifest) manifest = Promise.all([read('assets/skins/'), isLocal ? read('local/') : {}])
      .then(([bundled, local]) => ({ ...bundled, ...local }));
    return (await manifest)[id] || null;
  };
  const assetUrl = (asset, name) => asset.base + encodeURIComponent(name);
  /* decode() 는 숨겨진 탭에서 멈출 수 있어 load/error 이벤트로 기다린다 */
  const ready = (img) => new Promise((ok, no) => { if (img.complete && img.naturalWidth) ok(); else { img.onload = () => ok(); img.onerror = () => no(new Error('image')); } });
  const loadImage = async (id) => {
    try {
      const l = await localAsset(id);
      if (l && l.gun) {
        const img = new Image();
        img.src = assetUrl(l, l.gun);
        img.builtIn = true;
        await ready(img);
        return img;
      }
    } catch (e) { /* 폴더 파일이 없으면 올린 파일로 */ }
    try {
      const blob = await run('readonly', (s) => s.get(id));
      if (!blob) return null;
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await ready(img);
      return img;
    } catch (e) { return null; }
  };
  const saveImage = async (id, file) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.src = url;
    await ready(img);  // 이미지가 아니면 여기서 던진다
    await run('readwrite', (s) => s.put(file, id));
    return img;
  };
  const clearImage = async (id) => { try { await run('readwrite', (s) => s.delete(id)); } catch (e) { /* 없으면 그만 */ } };
  A.skins = { load, find, weapon, all: () => weapons, loadImage, saveImage, clearImage, localAsset, assetUrl, isLocal };
})(window.Aim = window.Aim || {});
