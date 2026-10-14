"""도트 이미지 만들기.

실행:  python tools/make_sprites.py
만드는 것:
  assets/player.png            플레이어 32x32 x 13프레임 (원본 12프레임 + 쓰러짐 1프레임)
  assets/weapons.png           무기·상자 24x12 x 17프레임 (순서는 WEAPON_ORDER)
  assets/enemies.png           몬스터 24x24 x 6프레임 (슬라임·해골 궁수·브루트, 각 2프레임)
  assets/bosses.png            보스 40x40 x 6프레임 (거대 슬라임·해골 궁수 대장·심연의 골렘, 각 2프레임)
  assets/src/player.piskel     Piskel에서 바로 열어 고칠 수 있는 파일
  assets/src/weapons.piskel, enemies.piskel, bosses.piskel

Piskel에서 직접 고쳤다면: Piskel의 Export → PNG → "Spritesheet" (가로 한 줄)로
assets/player.png, assets/weapons.png에 덮어쓰면 됩니다. 프레임 순서만 지켜 주세요.
"""
import base64
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
SRC = ASSETS / 'src'

OUTLINE = (255, 255, 255, 255)   # 원본 캐릭터와 같은 흰 테두리
BODY = (7, 0, 0, 255)
SHADOW = (80, 73, 73, 255)

PALETTE = {
    'W': (150, 98, 60, 255),     # 나무
    'w': (110, 70, 42, 255),     # 어두운 나무
    'm': (205, 214, 228, 255),   # 밝은 금속
    'L': (250, 252, 255, 255),   # 반짝임
    'M': (140, 150, 170, 255),   # 중간 금속
    'D': (66, 70, 90, 255),      # 어두운 금속
    'g': (255, 200, 70, 255),    # 금
    'S': (120, 112, 105, 255),   # 돌
    'b': (100, 180, 255, 255),   # 렌즈
    'r': (220, 70, 70, 255),     # 빨강
}

# ---------------------------------------------------------------- 무기 (24x12, 테두리 자동)
WW, WH = 24, 12
WEAPON_ORDER = [
    'sword', 'greatsword', 'twinblades',
    'spear', 'halberd', 'lance',
    'hammer', 'warhammer', 'quakehammer',
    'bow', 'crossbow', 'longbow',
    'gun', 'shotgun', 'sniper',
    'chest', 'chest_open',
]


def rect(px, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px[(x, y)] = c


def arc_bow(px, bulge, tips):
    """오른쪽(과녁 쪽)으로 휜 활대 + 왼쪽 시위. bulge = 행마다 활대의 x 위치"""
    for y, x in zip(range(1, 11), bulge):
        px[(x, y)] = 'W'
        if 2 <= y <= 9:
            px[(x - 1, y)] = 'w'
    for y in range(2, 10):
        px[(3, y)] = 'L'  # 시위
    if tips:
        px[(bulge[0], 1)] = px[(bulge[-1], 10)] = 'g'


def design(name):
    px = {}
    if name == 'sword':
        rect(px, 1, 5, 1, 6, 'g'); rect(px, 2, 5, 4, 6, 'W'); rect(px, 5, 3, 5, 8, 'g')
        rect(px, 6, 5, 19, 6, 'm'); rect(px, 6, 5, 18, 5, 'L'); rect(px, 20, 5, 20, 6, 'm'); px[(21, 6)] = 'm'
    elif name == 'greatsword':
        rect(px, 1, 5, 3, 6, 'W'); rect(px, 4, 2, 4, 9, 'g')
        rect(px, 5, 4, 20, 7, 'm'); rect(px, 5, 4, 19, 4, 'L'); rect(px, 5, 7, 20, 7, 'M')
        rect(px, 21, 5, 21, 6, 'm'); px[(22, 6)] = 'm'
    elif name == 'twinblades':
        for y0 in (2, 8):
            rect(px, 1, y0, 3, y0 + 1, 'W'); rect(px, 4, y0 - 1, 4, y0 + 2, 'g')
            rect(px, 5, y0, 15, y0 + 1, 'm'); rect(px, 5, y0, 14, y0, 'L'); px[(16, y0 + 1)] = 'm'
    elif name == 'spear':
        rect(px, 1, 5, 16, 6, 'W')
        rect(px, 17, 3, 18, 8, 'm'); rect(px, 19, 4, 20, 7, 'm'); rect(px, 21, 5, 22, 6, 'L')
    elif name == 'halberd':
        rect(px, 1, 5, 18, 6, 'W')
        rect(px, 13, 1, 17, 4, 'm'); rect(px, 13, 1, 13, 4, 'L'); rect(px, 16, 2, 17, 4, 'M')
        rect(px, 19, 5, 22, 6, 'm'); px[(22, 5)] = 'L'
    elif name == 'lance':
        rect(px, 1, 5, 4, 6, 'W'); rect(px, 5, 2, 5, 9, 'g')
        rect(px, 6, 3, 9, 8, 'm'); rect(px, 10, 4, 14, 7, 'm'); rect(px, 15, 5, 19, 6, 'm'); rect(px, 20, 5, 21, 6, 'L')
        rect(px, 6, 3, 13, 3, 'L')
    elif name == 'hammer':
        rect(px, 1, 5, 14, 6, 'W'); rect(px, 15, 1, 20, 10, 'M'); rect(px, 20, 1, 20, 10, 'm'); rect(px, 15, 1, 19, 1, 'm')
    elif name == 'warhammer':
        rect(px, 1, 5, 13, 6, 'W'); rect(px, 14, 2, 18, 9, 'D'); rect(px, 14, 2, 18, 2, 'M')
        rect(px, 19, 5, 22, 6, 'm'); rect(px, 12, 3, 13, 3, 'm')
    elif name == 'quakehammer':
        rect(px, 1, 5, 12, 6, 'W'); rect(px, 13, 1, 21, 10, 'S'); rect(px, 13, 1, 21, 1, 'M')
        for p in [(16, 3), (17, 4), (17, 5), (18, 6), (17, 7), (16, 8)]:
            px[p] = 'g'
    elif name == 'bow':
        arc_bow(px, [4, 6, 7, 8, 8, 8, 8, 7, 6, 4], False)
        rect(px, 3, 6, 14, 6, 'W'); rect(px, 15, 5, 15, 7, 'm'); px[(16, 6)] = 'm'; px[(2, 5)] = px[(2, 7)] = 'r'
    elif name == 'crossbow':
        rect(px, 1, 5, 14, 7, 'W'); rect(px, 1, 7, 6, 7, 'w')
        rect(px, 12, 3, 13, 8, 'm'); rect(px, 11, 1, 11, 2, 'm'); rect(px, 11, 9, 11, 10, 'm')
        rect(px, 8, 4, 19, 4, 'M'); rect(px, 20, 4, 21, 4, 'm')
    elif name == 'longbow':
        arc_bow(px, [5, 7, 9, 10, 10, 10, 10, 9, 7, 5], True)
        rect(px, 3, 6, 17, 6, 'W'); rect(px, 18, 5, 18, 7, 'm'); px[(19, 6)] = 'm'; px[(2, 5)] = px[(2, 7)] = 'r'
    elif name == 'gun':
        rect(px, 4, 3, 11, 6, 'D'); rect(px, 12, 3, 17, 4, 'M'); rect(px, 4, 3, 16, 3, 'm')
        rect(px, 4, 7, 6, 9, 'W'); px[(8, 7)] = px[(9, 8)] = 'D'
    elif name == 'shotgun':
        rect(px, 1, 4, 6, 8, 'W'); rect(px, 1, 8, 3, 8, 'w'); rect(px, 7, 3, 11, 6, 'D')
        rect(px, 12, 3, 22, 4, 'M'); rect(px, 12, 3, 22, 3, 'm'); rect(px, 13, 6, 17, 7, 'W')
    elif name == 'sniper':
        rect(px, 1, 4, 4, 8, 'W'); rect(px, 5, 4, 11, 6, 'D'); rect(px, 12, 5, 22, 5, 'M')
        rect(px, 7, 1, 12, 2, 'D'); rect(px, 13, 1, 13, 2, 'b'); rect(px, 8, 7, 9, 9, 'W')
    elif name == 'chest':
        rect(px, 3, 1, 20, 4, 'W'); rect(px, 3, 1, 20, 1, 'w'); rect(px, 3, 5, 20, 5, 'g')
        rect(px, 3, 6, 20, 10, 'W'); rect(px, 3, 10, 20, 10, 'w')
        rect(px, 11, 4, 12, 7, 'g'); px[(11, 6)] = px[(12, 6)] = 'w'
        for x in (3, 20):
            rect(px, x, 1, x, 10, 'g')
    elif name == 'chest_open':
        rect(px, 3, 1, 20, 2, 'w'); rect(px, 3, 3, 20, 5, 'g'); rect(px, 5, 3, 18, 4, 'L')
        rect(px, 3, 6, 20, 10, 'W'); rect(px, 3, 10, 20, 10, 'w'); rect(px, 3, 6, 20, 6, 'g')
        for x in (3, 20):
            rect(px, x, 1, x, 10, 'g')
    else:
        raise ValueError(name)
    return px


def render_design(px):
    im = Image.new('RGBA', (WW, WH), (0, 0, 0, 0))
    for (x, y), c in px.items():
        im.putpixel((x, y), PALETTE[c])
    # 원본 캐릭터처럼 바깥쪽 1칸 흰 테두리 (활대와 시위 사이 같은 안쪽 빈칸은 그대로 비움)
    outside = set()
    stack = [(x, y) for x in range(WW) for y in (0, WH - 1)] + [(x, y) for y in range(WH) for x in (0, WW - 1)]
    while stack:
        x, y = stack.pop()
        if (x, y) in outside or not (0 <= x < WW and 0 <= y < WH) or im.getpixel((x, y))[3]:
            continue
        outside.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    out = im.copy()
    for y in range(WH):
        for x in range(WW):
            if (x, y) not in outside:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < WW and 0 <= ny < WH and im.getpixel((nx, ny))[3]:
                    out.putpixel((x, y), OUTLINE)
                    break
    return out


# ---------------------------------------------------------------- 플레이어
def load_piskel_strip(path):
    data = json.loads(Path(path).read_text())
    layer = json.loads(data['piskel']['layers'][0])
    b64 = layer['chunks'][0]['base64PNG'].split(',', 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA'), layer['frameCount']


def dead_frame(base):
    """쓰러짐: 몸을 회색으로, 눈은 X 모양"""
    fr = base.copy()
    for y in range(32):
        for x in range(32):
            p = fr.getpixel((x, y))
            if p == BODY:
                fr.putpixel((x, y), (40, 36, 40, 255))
    # 원본 눈 위치(11~12행, 13~14열 / 18~19열)를 지우고 X 눈
    for y in (11, 12):
        for x in (13, 14, 18, 19):
            fr.putpixel((x, y), (40, 36, 40, 255))
    for cx in (13, 18):  # 2x2 칸에 대각선 두 개 = 작은 X
        fr.putpixel((cx, 11), OUTLINE)
        fr.putpixel((cx + 1, 12), OUTLINE)
        fr.putpixel((cx + 1, 11), (170, 160, 165, 255))
        fr.putpixel((cx, 12), (170, 160, 165, 255))
    return fr


def to_piskel(name, frames, w, h):
    strip = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        strip.paste(f, (i * w, 0))
    buf = io.BytesIO()
    strip.save(buf, 'PNG')
    layer = {
        'name': 'Layer 1', 'opacity': 1, 'frameCount': len(frames),
        'chunks': [{'layout': [[i] for i in range(len(frames))],
                    'base64PNG': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}],
    }
    return {'modelVersion': 2, 'piskel': {
        'name': name, 'description': '', 'fps': 12, 'height': h, 'width': w,
        'layers': [json.dumps(layer)], 'hiddenFrames': [None]}}, strip


# ---------------------------------------------------------------- 몬스터
MON = {
    'G': (102, 187, 106, 255), 'g': (56, 142, 60, 255), 'L': (200, 240, 190, 255),   # 슬라임
    'B': (236, 232, 214, 255), 'b': (176, 170, 150, 255),                              # 뼈
    'O': (121, 134, 92, 255), 'o': (85, 99, 62, 255), 'T': (250, 250, 235, 255),       # 오크 피부, 엄니
    'S': (126, 120, 132, 255), 's': (88, 82, 96, 255), 'C': (255, 112, 67, 255),       # 돌, 코어
    'K': (25, 20, 30, 255), 'R': (229, 57, 53, 255), 'Y': (255, 213, 79, 255),
    'W': (150, 98, 60, 255), 'w': (110, 70, 42, 255), 'P': (126, 87, 194, 255), 'p': (81, 45, 168, 255),
    'M': (205, 214, 228, 255),
}


class Canvas:
    def __init__(self, w, h):
        self.w, self.h, self.px = w, h, {}

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[(int(x), int(y))] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def ellipse(self, cx, cy, rx, ry, c, shade=None, light=None):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                d = dx * dx + dy * dy
                if d <= 1:
                    col = c
                    if shade and (dx * 0.6 + dy * 0.8) > 0.55:
                        col = shade
                    if light and dx < -0.25 and dy < -0.25 and d < 0.55:
                        col = light
                    self.set(x, y, col)

    def image(self):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), MON[c])
        return outline(im)


def outline(im):
    w, h = im.size
    out = im.copy()
    for y in range(h):
        for x in range(w):
            if im.getpixel((x, y))[3]:
                continue
            if any(0 <= x + dx < w and 0 <= y + dy < h and im.getpixel((x + dx, y + dy))[3]
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.putpixel((x, y), OUTLINE)
    return out


def slime(f, size=24, scale=1.0, crown=False):
    c = Canvas(size, size)
    cx = size / 2
    rx, ry = (8.5 if f == 0 else 7.5) * scale, (6 if f == 0 else 7) * scale
    cy = size - 3 - ry
    c.ellipse(cx, cy, rx, ry, 'G', 'g', 'L')
    ey = int(cy - ry * 0.1)
    for ex in (int(cx - rx * 0.38), int(cx + rx * 0.3)):
        c.rect(ex, ey, ex + max(1, int(scale)), ey + max(1, int(1.6 * scale)), 'K')
    if crown:
        top = int(cy - ry) - 1
        c.rect(int(cx - 6), top - 3, int(cx + 6), top, 'Y')
        for x in (int(cx - 6), int(cx), int(cx + 6)):
            c.rect(x - 1, top - 6, x + 1, top - 4, 'Y')
        c.set(int(cx), top - 2, 'R')
    return c.image()


def skeleton(f, size=24, scale=1.0, captain=False):
    c = Canvas(size, size)
    s = scale
    cx = size // 2
    base = size - 3
    bob = 0 if f == 0 else 1
    # 다리
    c.rect(cx - int(3 * s), base - int(5 * s), cx - int(2 * s), base, 'B')
    c.rect(cx + int(1 * s), base - int(5 * s) + bob, cx + int(2 * s), base, 'B')
    # 갈비뼈 몸통
    top = base - int(12 * s)
    c.rect(cx - int(3 * s), top, cx + int(3 * s), base - int(5 * s), 'B')
    for y in range(top + 1, base - int(5 * s), 2):
        c.rect(cx - int(2 * s), y, cx + int(2 * s), y, 'b')
    c.rect(cx, top, cx, base - int(5 * s), 'B')
    # 머리
    hy = top - int(4 * s)
    c.ellipse(cx + 0.5, hy, 4.2 * s, 4 * s, 'B', 'b')
    c.rect(cx - int(2 * s), hy - 1, cx - int(1 * s), hy, 'K')
    c.rect(cx + int(1 * s), hy - 1, cx + int(2 * s), hy, 'K')
    if captain:
        c.rect(cx - int(5 * s), hy - int(5 * s), cx + int(5 * s), hy - int(3 * s), 'p')
        c.rect(cx - int(1 * s), hy - int(8 * s), cx + int(1 * s), hy - int(5 * s), 'R')
        c.rect(cx - int(6 * s), top, cx - int(4 * s), base - int(2 * s), 'P')  # 망토
        for y in range(top, base - int(2 * s)):
            c.set(cx - int(3 * s) - 1, y, 'R') if y % 3 == 0 else None
        for x in (cx - int(2 * s), cx + int(2 * s)):
            c.set(x, hy - 1, 'R')
    # 활
    bx = cx + int(5 * s)
    for i, dx in enumerate([0, 1, 2, 2, 2, 2, 2, 1, 0]):
        y = top - int(1 * s) + int(i * s)
        c.rect(bx + int(dx * s), y, bx + int(dx * s), y + int(s) - 1 if s > 1 else y, 'W')
    c.rect(bx, top - int(1 * s), bx, top + int(8 * s), 'M')
    return c.image()


def brute(f, size=24):
    c = Canvas(size, size)
    cx = size // 2
    base = size - 3
    bob = 0 if f == 0 else 1
    c.rect(cx - 6, base - 4, cx - 3, base, 'o')
    c.rect(cx + 2, base - 4 + bob, cx + 5, base, 'o')
    c.ellipse(cx, base - 10, 8, 7, 'O', 'o')
    c.rect(cx - 5, base - 6, cx + 5, base - 5, 'w')  # 허리띠
    c.ellipse(cx, base - 17, 5, 4.5, 'O', 'o')
    c.rect(cx - 3, base - 18, cx - 2, base - 18, 'R')
    c.rect(cx + 2, base - 18, cx + 3, base - 18, 'R')
    c.set(cx - 3, base - 15, 'T'); c.set(cx - 3, base - 16, 'T')
    c.set(cx + 3, base - 15, 'T'); c.set(cx + 3, base - 16, 'T')
    # 몽둥이
    c.rect(cx + 8, base - 15 + bob, cx + 9, base - 5 + bob, 'W')
    c.rect(cx + 7, base - 19 + bob, cx + 10, base - 15 + bob, 'w')
    return c.image()


def golem(f, size=40):
    c = Canvas(size, size)
    cx = size // 2
    base = size - 3
    bob = 0 if f == 0 else 1
    c.rect(cx - 10, base - 6, cx - 5, base, 's')
    c.rect(cx + 5, base - 6 + bob, cx + 10, base, 's')
    c.rect(cx - 12, base - 22, cx + 12, base - 6, 'S')
    c.rect(cx - 12, base - 8, cx + 12, base - 6, 's')
    c.rect(cx - 17, base - 21 + bob, cx - 13, base - 9 + bob, 'S')   # 팔
    c.rect(cx + 13, base - 21 - bob, cx + 17, base - 9 - bob, 'S')
    c.rect(cx - 7, base - 31, cx + 7, base - 22, 'S')                # 머리
    c.rect(cx - 7, base - 31, cx + 7, base - 30, 's')
    c.rect(cx - 4, base - 27, cx - 2, base - 26, 'C')
    c.rect(cx + 2, base - 27, cx + 4, base - 26, 'C')
    c.ellipse(cx, base - 14, 3.5, 3.5, 'C' if f == 0 else 'Y')         # 코어
    for (x, y) in [(cx - 9, base - 19), (cx + 6, base - 11), (cx - 4, base - 9), (cx + 9, base - 20)]:
        c.rect(x, y, x + 2, y, 's')
    return c.image()


def main():
    SRC.mkdir(parents=True, exist_ok=True)

    strip, count = load_piskel_strip(SRC / 'player-original.piskel')
    frames = [strip.crop((i * 32, 0, i * 32 + 32, 32)) for i in range(count)]
    frames.append(dead_frame(frames[0]))
    pk, sheet = to_piskel('player', frames, 32, 32)
    sheet.save(ASSETS / 'player.png')
    (SRC / 'player.piskel').write_text(json.dumps(pk))

    wframes = [render_design(design(n)) for n in WEAPON_ORDER]
    pk, sheet = to_piskel('weapons', wframes, WW, WH)
    sheet.save(ASSETS / 'weapons.png')
    (SRC / 'weapons.piskel').write_text(json.dumps(pk))
    eframes = [slime(0), slime(1), skeleton(0), skeleton(1), brute(0), brute(1)]
    pk, sheet = to_piskel('enemies', eframes, 24, 24)
    sheet.save(ASSETS / 'enemies.png')
    (SRC / 'enemies.piskel').write_text(json.dumps(pk))

    bframes = [slime(0, 40, 2.0, crown=True), slime(1, 40, 2.0, crown=True),
               skeleton(0, 40, 1.7, captain=True), skeleton(1, 40, 1.7, captain=True), golem(0), golem(1)]
    pk, sheet = to_piskel('bosses', bframes, 40, 40)
    sheet.save(ASSETS / 'bosses.png')
    (SRC / 'bosses.piskel').write_text(json.dumps(pk))
    print('player frames', len(frames), '| weapon frames', len(wframes), '| enemy', len(eframes), '| boss', len(bframes))


if __name__ == '__main__':
    main()
