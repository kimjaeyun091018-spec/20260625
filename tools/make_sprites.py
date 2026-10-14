"""도트 이미지 만들기.

실행:  python tools/make_sprites.py
만드는 것:
  assets/player.png            플레이어 32x32 x 13프레임 (원본 12프레임 + 쓰러짐 1프레임)
  assets/weapons.png           무기·상자 24x12 x 17프레임 (순서는 WEAPON_ORDER)
  assets/src/player.piskel     Piskel에서 바로 열어 고칠 수 있는 파일
  assets/src/weapons.piskel

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
    print('player frames', len(frames), '| weapon frames', len(wframes))


if __name__ == '__main__':
    main()
