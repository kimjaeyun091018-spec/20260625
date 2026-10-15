"""자세한 캐릭터 도트 만들기 (플레이어 캐릭터·군단 유닛·장비 스킨)

실행:  python tools/make_heroes.py
결과:  assets/heroes.png   32x32 칸, 가로 13프레임(0~3 대기, 4~11 걷기, 12 쓰러짐) x 세로 디자인(DESIGNS 순서)
        assets/src/heroes-<디자인>.piskel  Piskel에서 열어 고칠 수 있는 한 줄짜리 원본

색 약속 (게임이 바꿔 칠하는 색):
  바깥 흰 테두리(255,255,255)  → 1P~4P 팀 색
  천 색 (7,0,0)/(7,0,1)/(7,0,2) → 스킨·유닛 색 (기본·밝게·어둡게)
  눈 흰색(255,255,255, 안쪽)    → 스킨 눈 색
"""
import base64
import io
import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
SRC = ASSETS / 'src'
W = H = 32
FRAMES = 13

OUT_LINE = (255, 255, 255, 255)
EYE = (255, 255, 255, 255)
CLOTH = ((7, 0, 0, 255), (7, 0, 1, 255), (7, 0, 2, 255))   # 기본, 밝게, 어둡게
SHADOW = (80, 73, 73, 255)
INK = (28, 24, 36, 255)

# (기본, 밝게, 어둡게)
P = {
    'steel': ((158, 168, 188, 255), (214, 222, 236, 255), (88, 96, 120, 255)),
    'dsteel': ((60, 58, 74, 255), (104, 100, 124, 255), (30, 28, 40, 255)),
    'rsteel': ((178, 52, 52, 255), (226, 98, 88, 255), (104, 26, 34, 255)),
    'skin': ((236, 184, 142, 255), (252, 214, 178, 255), (182, 124, 94, 255)),
    'leather': ((132, 90, 58, 255), (172, 124, 82, 255), (84, 56, 38, 255)),
    'dleather': ((74, 58, 52, 255), (104, 84, 74, 255), (44, 34, 32, 255)),
    'gold': ((236, 186, 64, 255), (255, 226, 120, 255), (164, 112, 34, 255)),
    'white': ((228, 230, 238, 255), (246, 247, 252, 255), (170, 174, 190, 255)),
    'hair': ((96, 62, 40, 255), (132, 88, 58, 255), (60, 38, 26, 255)),
    'bone': ((232, 222, 196, 255), (250, 244, 226, 255), (170, 156, 128, 255)),
    'fur': ((150, 120, 92, 255), (190, 160, 128, 255), (100, 78, 60, 255)),
    'green': ((70, 128, 70, 255), (108, 168, 100, 255), (40, 80, 44, 255)),
    'glass': ((120, 210, 230, 255), (200, 244, 252, 255), (60, 130, 160, 255)),
    'cloth': CLOTH,
}


class Sprite:
    def __init__(self):
        self.px = {}

    def part(self, pixels, pal, light_dir=True):
        """모양(픽셀 집합)을 칠함: 가장자리는 어둡게, 위·왼쪽 안쪽은 밝게"""
        base, light, dark = P[pal] if isinstance(pal, str) else pal
        pixels = {(int(x), int(y)) for x, y in pixels if 0 <= x < W and 0 <= y < H}
        for (x, y) in pixels:
            edge = any((x + dx, y + dy) not in pixels for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                c = dark
            elif light_dir and ((x - 1, y - 1) not in pixels or (x, y - 2) not in pixels):
                c = light
            else:
                c = base
            self.px[(x, y)] = c

    def put(self, x, y, c):
        if 0 <= x < W and 0 <= y < H:
            self.px[(int(x), int(y))] = c

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), c)
        return im


def rect(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def ellipse(cx, cy, rx, ry):
    out = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                out.add((x, y))
    return out


# ---------------------------------------------------------------- 디자인
# 각 디자인 = 몸 부품을 그리는 함수. f = 프레임 정보 (bob: 몸 위아래, legs: 다리 앞뒤)
def legs(s, f, pal='steel', boot='dleather', robe=False):
    if robe:
        return
    for i, side in enumerate((-1, 1)):
        off = f['legs'] * (1 if i == 0 else -1)
        x0 = 13 if side < 0 else 17
        lift = 1 if off > 0 and f['walk'] else 0
        s.part(rect(x0 + off, 20, x0 + off + 2, 23 - lift), pal)
        s.part(rect(x0 + off - (0 if side < 0 else 0), 24 - lift, x0 + off + 3, 25 - lift), boot)


def torso(s, f, pal, belt='leather', y0=15, y1=21, x0=11, x1=20):
    b = f['bob']
    s.part(rect(x0, y0 + b, x1, y1 + b), pal)
    if belt:
        s.part(rect(x0, y1 - 1 + b, x1, y1 + b), belt, light_dir=False)


def arm(s, f, x, pal, glove='leather'):
    b = f['bob']
    swing = f['arm']
    s.part(rect(x, 16 + b, x + 1, 19 + b + swing), pal)
    s.part(rect(x, 20 + b + swing, x + 1, 21 + b + swing), glove, light_dir=False)


def face(s, f, cx=16, cy=10, eyes=True, pal='skin'):
    b = f['bob']
    s.part(ellipse(cx + 0.5, cy + b, 5.6, 5.2), pal)
    if eyes:
        draw_eyes(s, f, cy + 1)


def draw_eyes(s, f, y, x=(17, 20), tall=2):
    b = f['bob']
    for ex in x:
        for dy in range(tall):
            s.put(ex, y + b + dy, EYE)
        s.put(ex, y + b + tall, INK) if f['blink'] else None
    if f['blink']:
        for ex in x:
            for dy in range(tall):
                s.put(ex, y + b + dy, INK)


def knight(s, f, steel='steel', plume=True, eye_glow=False, samurai=False):
    b = f['bob']
    legs(s, f, steel)
    # 등 뒤 망토
    s.part(rect(9, 14 + b, 12, 22 + b), 'cloth')
    arm(s, f, 10, steel)
    torso(s, f, steel, belt='leather')
    # 체크 무늬 겉옷 (천 색 + 흰색)
    for y in range(16, 20):
        for x in range(12, 20):
            s.put(x, y + b, CLOTH[0] if ((x // 2 + y // 2) % 2 == 0) else P['white'][0])
    for x in range(12, 20):
        s.put(x, 15 + b, P[steel][2])
    # 투구
    helm = ellipse(16.5, 9.5 + b, 6.4, 6.2) | rect(11, 9 + b, 22, 15 + b)
    s.part(helm, steel)
    # 얼굴 가리개 + 눈 틈
    s.part(rect(15, 10 + b, 22, 13 + b), (P[steel][2], P[steel][2], INK), light_dir=False)
    for x in range(16, 22):
        s.put(x, 11 + b, INK)
    for ex in (18, 21):
        s.put(ex, 11 + b, EYE if not eye_glow else (255, 82, 82, 255))
    for y in (12, 13):
        for x in range(17, 22, 2):
            s.put(x, y + b, INK)
    # 이마 줄
    for x in range(12, 22):
        s.put(x, 7 + b, P[steel][1])
    if samurai:
        # 투구 장식 (금색 뿔)
        s.part({(13, 2 + b), (13, 3 + b), (14, 3 + b), (14, 4 + b), (20, 2 + b), (20, 3 + b), (19, 3 + b), (19, 4 + b)}, 'gold', light_dir=False)
        s.part(rect(15, 3 + b, 18, 4 + b), 'gold')
    elif plume:
        # 깃털 (천 색): 투구 위에서 뒤로 넘어감
        pl = ellipse(13, 3 + b, 3.2, 2.6) | ellipse(10.5, 5 + b, 2.4, 2.4) | ellipse(15.5, 2.5 + b, 2.2, 1.8)
        s.part(pl, 'cloth')
    arm(s, f, 20, steel)
    # 방패 (뒤쪽 팔)
    sh = ellipse(9, 18 + b, 3.2, 4)
    s.part(sh, 'cloth')
    s.part(rect(8, 16 + b, 9, 20 + b), 'gold', light_dir=False)


def ranger(s, f, hood='cloth', cloak='green'):
    b = f['bob']
    legs(s, f, 'leather', boot='dleather')
    # 화살통
    s.part(rect(8, 12 + b, 10, 20 + b), 'leather')
    for x in (8, 9, 10):
        s.put(x, 11 + b, P['bone'][0])
    s.part(rect(10, 14 + b, 13, 23 + b), cloak)          # 망토 뒤
    arm(s, f, 10, 'leather')
    torso(s, f, 'leather', belt='dleather')
    s.part(rect(12, 15 + b, 19, 17 + b), cloak)          # 어깨 망토
    face(s, f)
    # 두건 (얼굴 앞쪽은 열려 있음)
    hd = (ellipse(15.5, 8.5 + b, 6.6, 6.2) | rect(9, 9 + b, 14, 16 + b)) - rect(15, 9 + b, 23, 15 + b)
    s.part(hd, hood)
    s.part({(22, 6 + b), (21, 5 + b), (23, 7 + b)}, hood, light_dir=False)
    arm(s, f, 20, 'leather', glove='dleather')


def mage(s, f, robe='cloth', hat='cloth', beard=False):
    b = f['bob']
    # 긴 로브 (다리 대신)
    sway = f['legs'] // 2
    rb = {(x, y) for y in range(15, 26) for x in range(11 - (y - 15) // 4 + (sway if y > 22 else 0), 21 + (y - 15) // 4 + (sway if y > 22 else 0))}
    s.part({(x, y + (b if y < 22 else 0)) for x, y in rb}, robe)
    for y in range(17, 25):
        s.put(16 + (sway if y > 22 else 0), y + (b if y < 22 else 0), P['gold'][0])
    arm(s, f, 10, robe, glove='skin')
    face(s, f)
    if beard:
        s.part(ellipse(18, 15 + b, 3, 2.5), 'white')
    # 넓은 챙 모자
    s.part(rect(8, 6 + b, 24, 7 + b), hat)
    cone = {(x, y + b) for y in range(-1, 6) for x in range(12 + (6 - y) // 2 - 1, 21 - (6 - y) // 2 + 1)}
    s.part(cone, hat)
    s.part({(11, 0 + b), (10, 1 + b), (12, 0 + b)}, hat, light_dir=False)   # 끝이 뒤로 접힘
    s.part(rect(13, 5 + b, 20, 5 + b), 'gold', light_dir=False)
    arm(s, f, 20, robe, glove='skin')


def berserker(s, f):
    b = f['bob']
    legs(s, f, 'cloth', boot='fur')
    arm(s, f, 10, 'skin', glove='leather')
    torso(s, f, 'skin', belt='leather')
    # 털 어깨걸이
    s.part(ellipse(14, 15.5 + b, 4.5, 2.2), 'fur')
    face(s, f)
    # 수염
    s.part(ellipse(19, 14.5 + b, 3.2, 2.4), 'hair')
    # 뿔 투구
    hm = ellipse(15.5, 7.5 + b, 6.2, 4.4) - rect(9, 9 + b, 24, 20 + b)
    s.part(hm | rect(10, 7 + b, 21, 8 + b), 'steel')
    s.part({(10, 4 + b), (9, 3 + b), (9, 2 + b), (8, 1 + b), (10, 5 + b), (9, 4 + b)}, 'bone', light_dir=False)
    s.part({(21, 4 + b), (22, 3 + b), (22, 2 + b), (23, 1 + b), (21, 5 + b), (22, 4 + b)}, 'bone', light_dir=False)
    arm(s, f, 20, 'skin', glove='leather')


def rogue(s, f):
    b = f['bob']
    legs(s, f, 'dleather', boot='dleather')
    s.part(rect(9, 14 + b, 12, 23 + b), 'dleather')   # 망토
    arm(s, f, 10, 'dleather')
    torso(s, f, 'dleather', belt='cloth')
    face(s, f)
    # 두건 + 입가리개(천 색)
    hd = (ellipse(15.5, 8.5 + b, 6.6, 6.2) | rect(9, 9 + b, 14, 16 + b)) - rect(15, 9 + b, 23, 12 + b)
    s.part(hd, 'dsteel')
    s.part(rect(15, 13 + b, 22, 15 + b), 'cloth')
    arm(s, f, 20, 'dleather', glove='dleather')


def alchemist(s, f):
    b = f['bob']
    legs(s, f, 'leather', boot='dleather')
    arm(s, f, 10, 'white')
    torso(s, f, 'white', belt='leather')
    s.part(rect(14, 16 + b, 20, 22 + b), 'cloth')     # 앞치마
    # 허리 물약
    s.part(ellipse(12, 21 + b, 1.6, 1.6), ((156, 204, 101, 255), (200, 240, 150, 255), (90, 140, 60, 255)), light_dir=False)
    face(s, f)
    # 머리카락 + 고글
    hr = ellipse(15.5, 7 + b, 6.4, 4.2) | rect(10, 7 + b, 13, 13 + b)
    s.part(hr, 'hair')
    s.part(rect(12, 6 + b, 22, 7 + b), 'leather', light_dir=False)
    s.part(ellipse(17, 6 + b, 1.6, 1.6), 'glass', light_dir=False)
    s.part(ellipse(20.5, 6 + b, 1.6, 1.6), 'glass', light_dir=False)
    arm(s, f, 20, 'white', glove='leather')


def scout(s, f):
    b = f['bob']
    legs(s, f, 'leather', boot='dleather')
    s.part(rect(9, 13 + b, 12, 22 + b), 'cloth')     # 망토
    arm(s, f, 10, 'leather')
    torso(s, f, 'leather', belt='dleather')
    s.part(rect(12, 15 + b, 19, 16 + b), 'cloth')
    face(s, f)
    # 모자 (챙 달린 가죽 모자)
    cap = ellipse(15.5, 6.5 + b, 6, 3.6) - rect(8, 8 + b, 24, 20 + b)
    s.part(cap | rect(10, 6 + b, 21, 7 + b), 'dsteel')
    s.part(rect(18, 7 + b, 24, 8 + b), 'dsteel', light_dir=False)
    s.part(rect(10, 8 + b, 12, 12 + b), 'hair')
    arm(s, f, 20, 'leather', glove='dleather')


def priest(s, f):
    mage(s, f, robe='cloth', hat=None) if False else None
    b = f['bob']
    sway = f['legs'] // 2
    rb = {(x, y) for y in range(15, 26) for x in range(11 - (y - 15) // 4 + (sway if y > 22 else 0), 21 + (y - 15) // 4 + (sway if y > 22 else 0))}
    s.part({(x, y + (b if y < 22 else 0)) for x, y in rb}, 'cloth')
    # 금색 십자
    for y in range(17, 22):
        s.put(16, y + b, P['gold'][0])
    for x in range(15, 18):
        s.put(x, 18 + b, P['gold'][0])
    arm(s, f, 10, 'cloth', glove='skin')
    face(s, f)
    hd = (ellipse(15.5, 8.5 + b, 6.6, 6.2) | rect(9, 9 + b, 14, 16 + b)) - rect(15, 9 + b, 23, 15 + b)
    s.part(hd, 'white')
    s.part(rect(12, 4 + b, 19, 4 + b), 'gold', light_dir=False)
    arm(s, f, 20, 'cloth', glove='skin')


def giant(s, f):
    """거인: 구부정한 큰 몸, 작은 머리, 엄니"""
    b = f['bob']
    for i, side in enumerate((-1, 1)):
        off = f['legs'] * (1 if i == 0 else -1)
        x0 = 11 if side < 0 else 17
        s.part(rect(x0 + off, 21, x0 + off + 3, 24), 'skin')
        s.part(rect(x0 + off - 1, 24, x0 + off + 4, 25), 'fur')
    sw = f['arm']
    s.part(rect(6, 12 + b, 9, 20 + b + sw), 'skin')               # 뒤 팔
    s.part(ellipse(7.5, 21 + b + sw, 2.2, 1.8), 'skin')
    s.part(ellipse(15.5, 15.5 + b, 8.2, 6.4), 'skin')             # 큰 몸
    s.part(ellipse(17, 17 + b, 4.5, 3.2), ((246, 200, 160, 255), (252, 222, 190, 255), (210, 160, 120, 255)), light_dir=False)  # 배
    s.part(rect(9, 20 + b, 22, 22 + b), 'cloth')                   # 허리 천
    s.part(rect(9, 20 + b, 22, 20 + b), 'leather', light_dir=False)
    s.part(ellipse(10, 11.5 + b, 4, 2.2), 'fur')                  # 털 어깨
    s.part(ellipse(18.5, 7.5 + b, 4.6, 4.2), 'skin')              # 머리
    s.put(17, 7 + b, EYE); s.put(20, 7 + b, EYE)
    s.put(17, 8 + b, INK); s.put(20, 8 + b, INK)
    for x in range(16, 22):
        s.put(x, 6 + b, P['skin'][2])                               # 눈썹
    s.put(18, 10 + b, P['bone'][0]); s.put(21, 10 + b, P['bone'][0])  # 엄니
    for x in range(18, 22):
        s.put(x, 11 + b, P['skin'][2])
    s.part(rect(21, 12 + b, 24, 20 + b + sw), 'skin')             # 앞 팔
    s.part(ellipse(22.5, 21 + b + sw, 2.4, 2), 'skin')


DESIGNS = {
    'knight': lambda s, f: knight(s, f),
    'ranger': ranger,
    'mage': mage,
    'berserker': berserker,
    'rogue': rogue,
    'alchemist': alchemist,
    'scout': scout,
    'priest': priest,
    'giant': giant,
    'darkknight': lambda s, f: knight(s, f, steel='dsteel', eye_glow=True),
    'samurai': lambda s, f: knight(s, f, steel='rsteel', samurai=True),
    'wizard': lambda s, f: mage(s, f, beard=True),
}
DESIGN_ORDER = list(DESIGNS)


def frame_info(i):
    if i < 4:   # 대기: 살짝 숨쉬기, 마지막에 눈 깜빡
        return {'bob': 1 if i in (2, 3) else 0, 'legs': 0, 'arm': 0, 'walk': False, 'blink': i == 3}
    k = i - 4   # 걷기 8프레임
    ph = math.sin(k / 8 * math.pi * 2)
    return {'bob': 1 if k % 4 in (1, 2) else 0, 'legs': round(ph * 2), 'arm': 1 if ph > 0.3 else 0, 'walk': True, 'blink': False}


def exterior_outline(im):
    """바깥 테두리 1칸 (팀 색으로 바뀜)"""
    out = im.copy()
    for y in range(H):
        for x in range(W):
            if im.getpixel((x, y))[3]:
                continue
            if any(0 <= x + dx < W and 0 <= y + dy < H and im.getpixel((x + dx, y + dy))[3] and im.getpixel((x + dx, y + dy))[:3] != SHADOW[:3]
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.putpixel((x, y), OUT_LINE)
    return out


def with_shadow(fig):
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y in range(23, 30):
        for x in range(4, 29):
            if ((x - 16) / 10.5) ** 2 + ((y - 26.5) / 2.6) ** 2 <= 1:
                base.putpixel((x, y), SHADOW)
    base.alpha_composite(fig)
    return base


def dead(fig_closed):
    """쓰러짐: 눈 감고 옆으로 누움"""
    body = fig_closed.crop((4, 0, 28, 27)).rotate(90, expand=True)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for y in range(24, 30):
        for x in range(2, 30):
            if ((x - 16) / 14) ** 2 + ((y - 27) / 3) ** 2 <= 1:
                out.putpixel((x, y), SHADOW)
    bb = body.getbbox()
    part = body.crop(bb)
    out.alpha_composite(part, (16 - part.width // 2, 29 - part.height))
    return out


def render_design(name):
    frames = []
    for i in range(12):
        s = Sprite()
        DESIGNS[name](s, frame_info(i))
        frames.append(with_shadow(exterior_outline(s.image())))
    s = Sprite()
    info = frame_info(0)
    info['blink'] = True
    DESIGNS[name](s, info)
    frames.append(dead(exterior_outline(s.image())))
    return frames


def to_piskel(name, frames):
    strip = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * W, 0))
    buf = io.BytesIO()
    strip.save(buf, 'PNG')
    layer = {'name': 'Layer 1', 'opacity': 1, 'frameCount': len(frames),
             'chunks': [{'layout': [[i] for i in range(len(frames))], 'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}]}
    return {'modelVersion': 2, 'piskel': {'name': name, 'description': '', 'fps': 12, 'height': H, 'width': W, 'layers': [json.dumps(layer)], 'hiddenFrames': [None]}}


def main():
    SRC.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGBA', (W * FRAMES, H * len(DESIGN_ORDER)), (0, 0, 0, 0))
    for r, name in enumerate(DESIGN_ORDER):
        frames = render_design(name)
        for c, fr in enumerate(frames):
            sheet.paste(fr, (c * W, r * H))
        (SRC / f'heroes-{name}.piskel').write_text(json.dumps(to_piskel(name, frames)))
    sheet.save(ASSETS / 'heroes.png')
    print('designs', DESIGN_ORDER)


if __name__ == '__main__':
    main()
