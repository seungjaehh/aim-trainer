"""미니맵 이미지에서 훈련용 지형(js/mapdata.js)을 만든다.

입력 (저장소에 넣지 않는다. Riot Games 자산이다)
  maps.json   https://valorant-api.com/v1/maps 응답
  <맵>.png    위 응답의 displayIcon (미니맵, 1024x1024 RGBA)

쓰는 정보
  - 알파 채널: 불투명 = 갈 수 있는 곳, 투명 = 벽/맵 밖
  - 파랑 채널 밝기: 기본 바닥 118 보다 밝을수록 높은 층 (헤븐·래프터·램프)
  - callouts 좌표와 미니맵 변환식 (u = y*xMultiplier + xScalarToAdd, v = x*yMultiplier + yScalarToAdd)

추정인 값
  - 밝기 → 미터 환산 (M_PER_LEVEL). 층의 순서는 이미지에서 오지만 실제 높이(m)는 공개 자료가 없다.
  - 벽 높이 (WALL_H). 미니맵 안쪽의 상자·엄폐물 선은 쓰지 않는다.

실행: python tools/maps/build_mapdata.py <maps.json> <이미지 폴더>
"""
import io, json, math, sys
from PIL import Image, ImageFilter

CELL = 0.5            # 격자 한 칸 (m)
M_PER_LEVEL = 0.14    # 밝기 1단계 = 0.14 m (추정)
WALL_H = 6.0          # 벽 높이 (추정)
X0, X1, Z0, Z1 = -34.0, 34.0, -3.0, 46.0   # 훈련장 안에 들어오는 범위
EYE = 1.6
MAX_LEVEL = 145       # 이보다 밝은 값은 층이 아니라 덜 지워진 흰 윤곽선이다
COVER_AREA = 12.0     # 이보다 좁은(m²) 높은 칸 덩어리는 층이 아니라 상자·엄폐물로 본다
SEARCH = 6.0          # 콜아웃 대표점에서 이 거리 안의, 서는 곳에서 보이는 바닥을 적 자리로 쓴다

KO = {'A Long': 'A 롱', 'A Site': 'A 사이트', 'A Tower': 'A 타워(헤븐)', 'A Main': 'A 메인', 'A Tree': 'A 트리', 'A Top': 'A 탑',
      'A Rubble': 'A 러블', 'A Door': 'A 도어', 'A Rafters': 'A 래프터', 'A Back': 'A 백', 'A Ramps': 'A 램프', 'A Window': 'A 윈도우',
      'A Stairs': 'A 계단', 'A Drop': 'A 드롭', 'A Root': 'A 루트', 'A Lobby': 'A 로비', 'A Screens': 'A 스크린',
      'B Garage': 'B 개러지', 'B Site': 'B 사이트', 'B Rafters': 'B 래프터', 'B Tower': 'B 타워(헤븐)', 'B Back': 'B 백', 'B Stairs': 'B 계단',
      'C Main': 'C 메인', 'C Site': 'C 사이트', 'C Bend': 'C 벤드', 'C Hall': 'C 홀', 'C Long': 'C 롱', 'C Window': 'C 윈도우',
      'Mid Courtyard': '미드 코트야드', 'Mid Window': '미드 윈도우', 'Mid Bottom': '미드 바텀', 'Mid Mail': '미드 메일', 'Mid Vent': '미드 벤트',
      'Mid Top': '미드 탑', 'Mid Catwalk': '미드 캣워크', 'Mid Doors': '미드 도어', 'Mid Market': '미드 마켓'}
MAPS = {'Haven': '헤이븐', 'Lotus': '로터스', 'Split': '스플릿', 'Ascent': '어센트'}
SCENES = [
    ('Haven', 'A Long', ['A Site', 'A Tower']),
    ('Haven', 'A Tower', ['A Site', 'A Long']),
    ('Haven', 'Mid Courtyard', ['B Site', 'Mid Window', 'Mid Doors']),
    ('Haven', 'C Long', ['C Site', 'C Window']),
    ('Lotus', 'A Main', ['A Tree', 'A Site', 'A Top', 'A Stairs']),
    ('Lotus', 'A Rubble', ['A Main', 'A Door', 'A Tree']),
    ('Lotus', 'A Top', ['A Site', 'A Tree', 'A Drop']),
    ('Lotus', 'C Main', ['C Site', 'C Bend', 'C Hall']),
    ('Split', 'A Main', ['A Site', 'A Rafters', 'A Tower', 'A Back']),
    ('Split', 'A Ramps', ['A Tower', 'A Rafters']),
    ('Split', 'A Tower', ['A Site', 'A Main', 'A Back', 'A Screens']),
    ('Split', 'B Garage', ['B Site', 'B Rafters', 'B Tower', 'B Back']),
    ('Split', 'B Tower', ['B Site', 'B Garage', 'B Back']),
    ('Split', 'Mid Bottom', ['Mid Mail', 'Mid Vent', 'Mid Top']),
    ('Ascent', 'A Main', ['A Site', 'A Rafters', 'A Window']),
    ('Ascent', 'A Rafters', ['A Site', 'A Main']),
    ('Ascent', 'Mid Courtyard', ['Mid Catwalk', 'Mid Top', 'Mid Bottom', 'Mid Market']),
]


def name_of(c):
    sup = c['superRegionName']
    reg = c['regionName']
    return ('Mid ' if sup == 'Mid' else sup + ' ' if sup in ('A', 'B', 'C') else '') + reg


class Map:
    def __init__(self, m, path):
        im = Image.open(path).convert('RGBA')
        self.n = im.size[0]
        self.alpha = im.getchannel('A').load()
        self.blue = im.getchannel('B').filter(ImageFilter.MedianFilter(9)).load()   # 흰 윤곽선을 지운 밝기
        self.m = m
        self.call = {name_of(c): (c['location']['x'], c['location']['y']) for c in m['callouts']}

    def at(self, X, Y):
        """맵 좌표(cm) → None(벽) 또는 바닥 높이(m, 0.5 단위)"""
        m = self.m
        u = int((Y * m['xMultiplier'] + m['xScalarToAdd']) * self.n)
        v = int((X * m['yMultiplier'] + m['yScalarToAdd']) * self.n)
        if not (0 <= u < self.n and 0 <= v < self.n) or self.alpha[u, v] < 128:
            return None
        return round(max(0, min(MAX_LEVEL, self.blue[u, v]) - 118) * M_PER_LEVEL * 2) / 2


def build(mp, map_en, frm, tos, shift=(0, 0)):
    px, py = mp.call[frm][0] + shift[0], mp.call[frm][1] + shift[1]
    tx, ty = mp.call[tos[0]]
    # 정면은 첫 자리 쪽의 맵 축 방향. 맵의 벽이 대부분 축에 나란해서 격자가 깔끔해진다.
    if abs(tx - px) >= abs(ty - py):
        f = (1 if tx > px else -1, 0)
    else:
        f = (0, 1 if ty > py else -1)
    r = (-f[1], f[0])   # 위에서 보면 x 가 위, y 가 오른쪽
    to_world = lambda lx, lz: (px + (r[0] * lx + f[0] * lz) * 100, py + (r[1] * lx + f[1] * lz) * 100)
    to_local = lambda X, Y: (((X - px) * r[0] + (Y - py) * r[1]) / 100, ((X - px) * f[0] + (Y - py) * f[1]) / 100)

    nx, nz = int((X1 - X0) / CELL), int((Z1 - Z0) / CELL)
    grid = [[mp.at(*to_world(X0 + (i + .5) * CELL, Z0 + (j + .5) * CELL)) for i in range(nx)] for j in range(nz)]
    cell = lambda lx, lz: (int((lx - X0) // CELL), int((lz - Z0) // CELL))

    def h_at(lx, lz):
        i, j = cell(lx, lz)
        return grid[j][i] if 0 <= i < nx and 0 <= j < nz else None

    # 좁은 높은 덩어리 = 상자·엄폐물. 적을 그 위에 세우지 않는다.
    cover, seen = set(), set()
    for j in range(nz):
        for i in range(nx):
            if (i, j) in seen or not grid[j][i]:
                continue
            comp, todo = [], [(i, j)]
            seen.add((i, j))
            while todo:
                a, b = todo.pop()
                comp.append((a, b))
                for c, d in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                    if 0 <= c < nx and 0 <= d < nz and (c, d) not in seen and grid[d][c] == grid[b][a]:
                        seen.add((c, d))
                        todo.append((c, d))
            edge = any(a in (0, nx - 1) or b in (0, nz - 1) for a, b in comp)
            if len(comp) * CELL * CELL < COVER_AREA and not edge:
                cover.update(comp)

    base = h_at(0, 0)
    if base is None:
        return None, frm + ': 서는 곳이 벽 안'

    def clear(ax, ay, az, bx, by, bz):
        d = math.hypot(bx - ax, bz - az)
        n = max(2, int(d / 0.05))
        ox, oz = (bz - az) / d * 0.2, -(bx - ax) / d * 0.2   # 좌우 0.2 m 여유를 두고 본다
        for k in range(1, n):
            t = k / n
            for e in (-1, 0, 1):
                h = h_at(ax + (bx - ax) * t + ox * e, az + (bz - az) * t + oz * e)
                if h is None or h > ay + (by - ay) * t - 0.1:
                    return False
        return True

    spots, dropped = [], []
    for name in tos:
        cx, cz = to_local(*mp.call[name])
        best = None
        R = int(SEARCH / CELL)
        ci, cj = cell(cx, cz)
        for j in range(max(1, cj - R), min(nz - 1, cj + R + 1)):
            for i in range(max(1, ci - R), min(nx - 1, ci + R + 1)):
                h = grid[j][i]
                if (i, j) in cover:
                    continue
                if h is None or any(grid[j + b][i + a] != h for a in (-1, 0, 1) for b in (-1, 0, 1)):
                    continue   # 벽이나 단 끝에 걸치지 않는 자리만
                lx, lz = X0 + (i + .5) * CELL, Z0 + (j + .5) * CELL
                off = math.hypot(lx - cx, lz - cz)
                if off > SEARCH or lz < 6 or (best and off >= best[0]):
                    continue
                if clear(0, base + EYE, 0, lx, h + EYE, lz) and clear(0, base + EYE, 0, lx, h + 1.0, lz):
                    best = (off, lx, lz, h)
        if best:
            off, lx, lz, h = best
            spots.append({'name': KO[name], 'x': lx, 'z': lz, 'h': h, 'dist': round(math.hypot(lx, lz)), 'off': round(off, 1)})
        else:
            dropped.append(name)
    heights = {base} | {s['h'] for s in spots}
    if len(spots) < 2 or len(heights) < 2:
        return None, '%s %s: 보이는 자리 %d개, 높이 %s, 안 보임 %s' % (map_en, frm, len(spots), sorted(heights), dropped)

    # 벽은 갈 수 있는 칸 가까이(1.5 m)만 남긴다
    kind = [[None] * nx for _ in range(nz)]
    for j in range(nz):
        for i in range(nx):
            h = grid[j][i]
            if h is None:
                near = any(0 <= j + b < nz and 0 <= i + a < nx and grid[j + b][i + a] is not None for a in range(-3, 4) for b in range(-3, 4))
                kind[j][i] = -1 if near else None
            elif h > 0:
                kind[j][i] = (h, 2 if (i, j) in cover else 0)
    boxes, open_runs = [], {}
    for j in range(nz + 1):
        runs, i = {}, 0
        while j < nz and i < nx:
            k = kind[j][i]
            if k is None:
                i += 1
                continue
            s = i
            while i < nx and kind[j][i] == k:
                i += 1
            runs[(s, i, k)] = True
        for key, j0 in list(open_runs.items()):
            if key not in runs:
                s, e, k = key
                boxes.append([round(X0 + (s + e) / 2 * CELL, 2), round(Z0 + (j0 + j) / 2 * CELL, 2), (e - s) * CELL, (j - j0) * CELL, WALL_H if k == -1 else k[0], 1 if k == -1 else k[1]])
                del open_runs[key]
        for key in runs:
            open_runs.setdefault(key, j)

    # 서는 곳에서 좌우(A/D)로 갈 수 있는 최대 범위. 실제 막힘은 충돌 상자가 정한다.
    return {'id': (map_en + '-' + frm).lower().replace(' ', '-'), 'map': MAPS[map_en], 'from': KO.get(frm, frm) + (' 근처' if shift != (0, 0) else ''),
            'moved': round(math.hypot(*shift) / 100, 1),   # 서는 곳을 콜아웃 대표점에서 옮긴 거리(m). 대표점에서는 자리가 안 보일 때만 옮긴다.
            'compared': False,   # 원작(게임 안)과 대조해 확인했는지. 대조하기 전에는 True 로 바꾸지 않는다.
            'frame': {'origin': [px, py], 'forward': list(f)},   # 훈련장 원점·정면의 맵 좌표(cm). 나중에 맵 모델을 같은 자리에 놓을 때 쓴다.
            'collision': {'base': base, 'bounds': [-3.2, 3.2], 'boxes': boxes},
            'bots': {'spots': spots},
            'visual': {'kind': 'boxes'}}, (', 안 보여 뺀 자리 ' + str(dropped)) if dropped else ''


def main():
    data = json.load(io.open(sys.argv[1], encoding='utf-8'))['data']
    out = []
    for map_en, frm, tos in SCENES:
        m = [x for x in data if x['displayName'] == map_en][0]
        mp = Map(m, sys.argv[2] + '/' + map_en + '.png')
        L, msg = build(mp, map_en, frm, tos)
        if not L:
            # 대표점에서 안 보이면 8 m 안에서 가장 가까운, 자리가 보이는 바닥으로 서는 곳을 옮긴다
            cand = sorted(((a * 200, b * 200) for a in range(-4, 5) for b in range(-4, 5) if (a or b) and a * a + b * b <= 16), key=lambda c: c[0] ** 2 + c[1] ** 2)
            for c in cand:
                if mp.at(mp.call[frm][0] + c[0], mp.call[frm][1] + c[1]) is None:
                    continue
                L, m2 = build(mp, map_en, frm, tos, c)
                if L:
                    msg = m2 + ' moved %.1f m' % L['moved']
                    break
        if L:
            out.append(L)
            print('OK  ', L['id'], 'base', L['collision']['base'], 'boxes', len(L['collision']['boxes']), 'cover', sum(1 for b in L['collision']['boxes'] if b[5] == 2), [(s['h'], s['dist'], s['off']) for s in L['bots']['spots']], msg.encode('ascii', 'replace').decode())
        else:
            print('SKIP', msg.encode('ascii', 'replace').decode())
    head = ('/* tools/maps/build_mapdata.py 가 만든 파일. 직접 고치지 않는다.\n'
            '   출처: valorant-api.com 의 맵 콜아웃 좌표와 미니맵 이미지 (비공식 커뮤니티 API). 맵은 Riot Games 의 것이다.\n'
            '   벽 윤곽·층 구분은 미니맵에서 읽었고, 높이(m)는 추정이다 (밝기 1단계 = %s m, 벽 %s m).\n'
            '   원작과 대조하지 않았다 (compared: false). 정확한 재현이 아니다.\n'
            '   세 가지를 따로 둔다. collision = 이동 충돌·사격 차폐, bots = 적 자리, visual = 겉모습 (boxes 면 충돌 상자를 그대로 그린다).\n'
            '   boxes: [x, z, 폭, 깊이, 높이, 종류] 종류 0 = 높은 바닥, 1 = 벽, 2 = 상자·엄폐물 */\n' % (M_PER_LEVEL, WALL_H))
    io.open('js/mapdata.js', 'w', encoding='utf-8', newline='\n').write(
        head + '(function () {\n  window.Aim = window.Aim || {};\n  window.Aim.mapData = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n})();\n')
    print('layouts', len(out))


main()
