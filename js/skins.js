/* 무기 스킨. valorant-api.com 에서 불러와 화면에 총 이미지·탄창·연사 속도를 적용한다. 오프라인이면 스킨 메뉴만 비활성. */
(function (A) {
  let weapons = [];
  /* 연습에 쓸 무기·스킨 (무기 순서 그대로). [스킨 uuid, 킬사운드 이름] */
  const SET = [
    ['ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a', [['d67b929f-4431-61c0-286e-3ebf3d11c4af', 'recon']]],                       // 팬텀
    ['9c82e19d-4575-0200-1a81-3eacf00cf872', [['9bf19b77-4b33-7203-9f2c-16932970622f', 'champions'], ['000ad7b1-44b0-9345-ea47-9cbd7dcdbb38', 'gaia'], ['d8d5d7a1-4d81-8560-54bc-0692ab40f69b', 'oni']]],  // 밴달
    ['e336c6b8-418d-9340-d77f-7a9e4cfe0702', [['bfd9e773-4376-1f6a-98f2-dc93f0c0607c', 'singularity'], ['83778c03-45a3-67a2-3c89-6b8598327d58', 'ion']]],  // 셰리프
    ['4ade7faa-4cf1-8376-95ef-39884480959b', [['7122d78b-4e60-eb4d-5f65-738d7c1ce9ae', 'sovereign'], ['db348da1-49f2-0bad-b70a-e4ade9d31655', 'reaver'], ['e5410554-4501-16c8-0382-13b91db12286', 'cyrax']]],  // 가디언
    ['c4883e50-4494-202c-3ec3-6b8a9284f00b', [['fb9ff2b0-4d71-d53c-364e-fe98fb5a2411', 'oni'], ['5211efa8-4efd-09bb-6cee-72b86a8a5972', 'sovereign']]],  // 마샬
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
  const loadImage = async (id) => {
    try {
      const blob = await run('readonly', (s) => s.get(id));
      if (!blob) return null;
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      return img;
    } catch (e) { return null; }
  };
  const saveImage = async (id, file) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.src = url;
    await img.decode();  // 이미지가 아니면 여기서 던진다
    await run('readwrite', (s) => s.put(file, id));
    return img;
  };
  const clearImage = async (id) => { try { await run('readwrite', (s) => s.delete(id)); } catch (e) { /* 없으면 그만 */ } };
  A.skins = { load, find, weapon, all: () => weapons, loadImage, saveImage, clearImage };
})(window.Aim = window.Aim || {});
