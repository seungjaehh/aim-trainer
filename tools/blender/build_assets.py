"""연습장과 훈련 봇 모델을 만들고 조명을 텍스처로 굽는다.

실행 (저장소 루트에서):
  blender --background --python tools/blender/build_assets.py -- [해상도=2048] [샘플=128]

결과물 (assets/models/):
  range.glb        연습장. UV 두 벌: 4 m 반복 무늬용, 라이트맵용
  range_light.jpg  Cycles 로 구운 조명 (색 x 빛)
  bot.glb          훈련 봇. 엔진의 히트박스(js/engine.js BOT)와 같은 치수

좌표: Blender x = 게임 x, Blender y = 게임 z(앞), Blender z = 높이.
모든 모델은 이 스크립트가 직접 만든 것이며 외부 에셋을 쓰지 않는다.
"""
import bpy, bmesh, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RES = int(argv[0]) if argv else 2048
SPP = int(argv[1]) if len(argv) > 1 else 128
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'models')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, emit=0.0, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def srgb(hexcode):
    h = hexcode.lstrip('#')
    return tuple((lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


# ---------------------------------------------------------------- 연습장
MATS = {
    'floor': material('floor', srgb('#7c8a92')),
    'wall': material('wall', srgb('#a3adb3')),
    'trim': material('trim', srgb('#3f4d58')),
    'pillar': material('pillar', srgb('#35434e')),
    'ceiling': material('ceiling', srgb('#2c3943')),
    'beam': material('beam', srgb('#1c2a33')),
    'light': material('light', srgb('#eef4ea'), emit=6.0),
    'accent': material('accent', srgb('#ff4655')),
    'teal': material('teal', srgb('#2f9aa0')),
    'crate': material('crate', srgb('#9a7d55')),
    'metal': material('metal', srgb('#59616d'), rough=0.5),
    'glow_teal': material('glow_teal', srgb('#3fd7ff'), emit=5.0),
    'glow_warm': material('glow_warm', srgb('#ffb070'), emit=5.0),
}
ORDER = list(MATS)
bm = bmesh.new()
rects = []  # (face, 가로 m, 세로 m)


def quad(pts, mat):
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    f.material_index = ORDER.index(mat)
    a, b, c = Vector(pts[0]), Vector(pts[1]), Vector(pts[3])
    rects.append((f, (b - a).length, (c - a).length))


def box(x0, x1, y0, y1, z0, z1, mat, bottom=False, top=True):
    quad([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], mat)
    quad([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], mat)
    quad([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], mat)
    quad([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], mat)
    if top: quad([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat)
    if bottom: quad([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], mat)


X, Y, Hh = 36, 48, 10
# 바닥은 구역별로 나눠 구워야 조명 얼룩이 또렷하다
for x in range(-X, X, 12):
    for y in range(-Y, Y, 12):
        quad([(x, y, 0), (x + 12, y, 0), (x + 12, y + 12, 0), (x, y + 12, 0)], 'floor')
        quad([(x, y + 12, Hh), (x + 12, y + 12, Hh), (x + 12, y, Hh), (x, y, Hh)], 'ceiling')
for x in range(-X, X, 12):
    quad([(x + 12, Y, 0), (x, Y, 0), (x, Y, Hh), (x + 12, Y, Hh)], 'wall')
    quad([(x, -Y, 0), (x + 12, -Y, 0), (x + 12, -Y, Hh), (x, -Y, Hh)], 'wall')
for y in range(-Y, Y, 12):
    quad([(-X, y + 12, 0), (-X, y, 0), (-X, y, Hh), (-X, y + 12, Hh)], 'wall')
    quad([(X, y, 0), (X, y + 12, 0), (X, y + 12, Hh), (X, y, Hh)], 'wall')

# 허리 높이 띠와 기둥
box(-X, X, Y - 0.12, Y, 0, 1.2, 'trim'); box(-X, X, -Y, -Y + 0.12, 0, 1.2, 'trim')
box(-X, -X + 0.12, -Y, Y, 0, 1.2, 'trim'); box(X - 0.12, X, -Y, Y, 0, 1.2, 'trim')
for y in range(-Y, Y + 1, 12):
    for sx in (-1, 1):
        x0 = sx * X - (0.9 if sx > 0 else 0)
        box(x0, x0 + 0.9, max(-Y, y - 0.45), min(Y, y + 0.45), 0, Hh, 'pillar', top=False)
for x in range(-X + 12, X, 12):
    box(x - 0.45, x + 0.45, Y - 0.9, Y, 0, Hh, 'pillar', top=False)
    box(x - 0.45, x + 0.45, -Y, -Y + 0.9, 0, Hh, 'pillar', top=False)

# 천장 보와 조명판
LIGHTS = []
for y in range(-40, 41, 16):
    box(-X, X, y - 0.3, y + 0.3, Hh - 0.7, Hh, 'beam', bottom=True, top=False)
    for x in (-24, -8, 8, 24):
        box(x - 2.6, x + 2.6, y + 3.4, y + 4.2, Hh - 0.16, Hh, 'light', bottom=True, top=False)
        LIGHTS.append((x, y + 3.8))
for x in (-16, 0, 16):
    box(x - 0.25, x + 0.25, -Y, Y, Hh - 0.45, Hh, 'beam', bottom=True, top=False)

# 벽 위쪽의 색 조명 띠: 왼쪽은 청록, 오른쪽은 따뜻한 색
for y in range(-42, 43, 12):
    box(-X + 0.02, -X + 0.14, y - 3.5, y + 3.5, 6.2, 6.6, 'glow_teal', bottom=True)
    box(X - 0.14, X - 0.02, y - 3.5, y + 3.5, 6.2, 6.6, 'glow_warm', bottom=True)
box(-30, 30, Y - 0.14, Y - 0.02, 7.4, 7.7, 'glow_teal', bottom=True)
box(-30, 30, Y - 0.2, Y - 0.12, 3.2, 3.5, 'accent', bottom=True)

# 장식: 훈련 구역(|x| < 24) 밖에만 둔다
def stack(x, y, n, mat='crate', s=1.2):
    for i in range(n):
        box(x - s / 2 + i * 0.07, x + s / 2 + i * 0.07, y - s / 2, y + s / 2, i * s, (i + 1) * s, mat)

def container(x, y, mat, along_y=True, z=0.0):
    w, l, h = 2.4, 6.0, 2.6
    if along_y: box(x - w / 2, x + w / 2, y - l / 2, y + l / 2, z, z + h, mat)
    else: box(x - l / 2, x + l / 2, y - w / 2, y + w / 2, z, z + h, mat)

container(-31, 20, 'teal'); container(-31, 20.4, 'accent', z=2.6); container(-28, 31, 'metal')
container(31, 14, 'accent'); container(31, 26, 'teal'); container(31, 25.6, 'metal', z=2.6)
container(-31, -6, 'metal'); container(31, -10, 'teal')
container(-20, 44.5, 'accent', along_y=False); container(21, 44.5, 'metal', along_y=False)
for x, y, n in [(-27, 10, 3), (-25.6, 11.3, 2), (-27.2, 38, 2), (27, 4, 2), (28.3, 5.2, 3), (27, 36, 3), (25.6, 37.2, 1),
                (-28, -20, 3), (28, -24, 2), (-12, 45, 2), (10, 45.4, 3), (0, 45.6, 1), (-27, -34, 2), (27, -38, 3)]:
    stack(x, y, n)
for x, y in [(-25.5, 24), (-26.6, 24.6), (25.4, 20), (26.3, 31), (-25.5, 2), (25.6, -4), (-6, 45.8), (5, 46)]:
    box(x - 0.32, x + 0.32, y - 0.32, y + 0.32, 0, 0.95, 'metal')
# 뒤쪽 대기 공간: 낮은 단과 난간
box(-14, 14, -Y + 0.9, -40, 0, 0.45, 'trim'); box(-14, 14, -40.15, -40, 0.45, 1.3, 'metal')

mesh = bpy.data.meshes.new('range')
bm.normal_update()
detail = bm.loops.layers.uv.new('detail')
light = bm.loops.layers.uv.new('light')
for f in bm.faces:  # 4 m 마다 반복되는 무늬용 UV
    n = f.normal
    for l in f.loops:
        co = l.vert.co
        l[detail].uv = ((co.x, co.y) if abs(n.z) > 0.5 else (co.y, co.z) if abs(n.x) > 0.5 else (co.x, co.z))
        l[detail].uv = (l[detail].uv[0] / 4, l[detail].uv[1] / 4)


def pack(scale, pad=3):
    """모든 면이 직사각형이므로 선반 채우기로 라이트맵 자리를 정한다."""
    items = sorted(((max(6, int(h * scale)), max(6, int(w * scale)), i) for i, (_, w, h) in enumerate(rects)), reverse=True)
    x = y = shelf = 0
    out = {}
    for h, w, i in items:
        if x + w + pad * 2 > RES: x, y, shelf = 0, y + shelf, 0
        if y + h + pad * 2 > RES: return None
        out[i] = (x + pad, y + pad, w, h)
        x += w + pad * 2; shelf = max(shelf, h + pad * 2)
    return out


lo, hi = 0.5, 200.0
for _ in range(40):
    mid = (lo + hi) / 2
    if pack(mid): lo = mid
    else: hi = mid
slots = pack(lo)
print('lightmap density %.1f px/m, %d faces' % (lo, len(rects)))
for i, (f, _, _) in enumerate(rects):
    px, py, w, h = slots[i]
    for l, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        l[light].uv = ((px + u * w) / RES, (py + v * h) / RES)
bm.to_mesh(mesh); bm.free()
room = bpy.data.objects.new('range', mesh)
scene.collection.objects.link(room)
for name in ORDER: mesh.materials.append(MATS[name])

# 조명
for x, y in LIGHTS:
    d = bpy.data.lights.new('panel', 'AREA')
    d.shape = 'RECTANGLE'; d.size = 5.0; d.size_y = 0.7; d.energy = 1500; d.color = (1.0, 0.97, 0.92)
    o = bpy.data.objects.new('panel', d); o.location = (x, y, Hh - 0.2); scene.collection.objects.link(o)
world = bpy.data.worlds.new('w'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.45, 0.6, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.3
scene.world = world

# 굽기
img = bpy.data.images.new('range_light', RES, RES, alpha=False)
for m in MATS.values():
    n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img
    m.node_tree.nodes.active = n
mesh.uv_layers['light'].active = True
mesh.uv_layers['light'].active_render = True
scene.render.engine = 'CYCLES'
scene.cycles.samples = SPP
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 6
bpy.context.view_layer.objects.active = room
room.select_set(True)
bpy.ops.object.bake(type='COMBINED', margin=3, use_clear=True)
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 92
img.save_render(os.path.join(OUT, 'range_light.jpg'), scene=scene)

mesh.uv_layers['detail'].active = True
mesh.uv_layers['detail'].active_render = True
for m in MATS.values():  # 내보낼 때는 텍스처 없이 이름만 남긴다
    for n in [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']: m.node_tree.nodes.remove(n)


def export(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True)


export([room], 'range.glb')

# ---------------------------------------------------------------- 훈련 봇
# 원점은 머리 중심. 치수는 js/engine.js 의 BOT 표(머리 중심에서 아래로 잰 m)와 같다.
BM = {
    'armor': material('bot_armor', srgb('#646775'), rough=0.55, metal=0.2),
    'dark': material('bot_dark', srgb('#333a48'), rough=0.7),
    'limb': material('bot_limb', srgb('#565c69'), rough=0.6, metal=0.1),
    'pad': material('bot_pad', srgb('#7c7f8d'), rough=0.5, metal=0.25),
    'head': material('bot_head', srgb('#d2d4de'), rough=0.4),
    'visor': material('bot_visor', srgb('#ff4655'), emit=2.0),
}
BORDER = list(BM)


def part(b, x0, y0, x1, y1, depth, mat, bevel, front=0.0):
    """x0..x1: 좌우, y0..y1: 머리 중심에서 아래로, depth: 앞뒤 두께."""
    r = bmesh.ops.create_cube(b, size=1.0)
    vs = r['verts']
    bmesh.ops.scale(b, vec=(x1 - x0, depth, y1 - y0), verts=vs)
    bmesh.ops.translate(b, vec=((x0 + x1) / 2, front, -(y0 + y1) / 2), verts=vs)
    faces = {f for v in vs for f in v.link_faces}
    for f in faces: f.material_index = BORDER.index(mat)
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.bevel(b, geom=edges, offset=bevel, segments=3, profile=0.5, affect='EDGES')


def finish(b, name):
    for f in b.faces: f.smooth = True
    me = bpy.data.meshes.new(name)
    b.normal_update(); b.to_mesh(me); b.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    for k in BORDER: me.materials.append(BM[k])
    mod = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); mod.keep_sharp = True
    return o


up = bmesh.new()
part(up, -0.085, -0.12, 0.085, 0.12, 0.19, 'head', 0.04)                 # 머리
part(up, -0.07, -0.035, 0.07, 0.02, 0.03, 'visor', 0.01, front=-0.092)   # 눈 띠
part(up, -0.035, 0.10, 0.035, 0.19, 0.07, 'dark', 0.012)                 # 목
part(up, -0.20, 0.17, 0.20, 0.80, 0.22, 'armor', 0.045)                  # 몸통
part(up, -0.13, 0.26, 0.13, 0.50, 0.04, 'dark', 0.012, front=-0.105)     # 가슴판
part(up, -0.05, 0.56, 0.05, 0.60, 0.03, 'visor', 0.008, front=-0.108)    # 가슴 표시등
part(up, -0.36, 0.15, -0.18, 0.42, 0.20, 'pad', 0.06)                    # 어깨
part(up, 0.18, 0.15, 0.36, 0.42, 0.20, 'pad', 0.06)
upper = finish(up, 'bot_upper')

lowb = bmesh.new()
part(lowb, -0.19, 0.80, 0.19, 0.96, 0.20, 'dark', 0.03)                  # 골반
part(lowb, -0.19, 0.93, -0.035, 1.54, 0.15, 'limb', 0.04)                # 다리
part(lowb, 0.035, 0.93, 0.19, 1.54, 0.15, 'limb', 0.04)
part(lowb, -0.22, 1.49, -0.025, 1.60, 0.26, 'dark', 0.025, front=-0.04)  # 발
part(lowb, 0.025, 1.49, 0.22, 1.60, 0.26, 'dark', 0.025, front=-0.04)
lower = finish(lowb, 'bot_lower')
export([upper, lower], 'bot.glb')
for f in ('range.glb', 'range_light.jpg', 'bot.glb'):
    print('wrote', f, os.path.getsize(os.path.join(OUT, f)), 'bytes')
