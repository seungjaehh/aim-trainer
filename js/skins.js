/* 무기 스킨. valorant-api.com 에서 불러와 HUD 에 총 이미지를 보여 준다. 오프라인이면 스킨 메뉴만 비활성. */
(function (A) {
  let weapons = [];
  async function load() {
    const res = await fetch('https://valorant-api.com/v1/weapons?language=ko-KR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    weapons = (await res.json()).data.map((w) => ({
      id: w.uuid, name: w.displayName,
      skins: w.skins.filter((s) => !/^(Random Favorite|무작위)/i.test(s.displayName)).map((s) => ({
        id: s.uuid, name: s.displayName,
        icon: s.displayIcon || (s.chromas && s.chromas[0] && (s.chromas[0].fullRender || s.chromas[0].displayIcon))
          || (s.levels && s.levels[0] && s.levels[0].displayIcon) || '',
      })).filter((s) => s.icon),
    })).filter((w) => w.skins.length);
    return weapons;
  }
  const find = (weaponId, skinId) => {
    const w = weapons.find((x) => x.id === weaponId);
    return w && w.skins.find((s) => s.id === skinId);
  };
  A.skins = { load, find, all: () => weapons };
})(window.Aim = window.Aim || {});
