"""도트 이미지 만들기.

실행:  python tools/make_sprites.py
만드는 것:
  assets/player.png            플레이어 32x32 x 13프레임 (원본 12프레임 + 쓰러짐(눈 감고 누움) 1프레임)
  assets/weapons.png           무기·상자 24x12 (순서는 WEAPON_ORDER)
  assets/enemies.png           몬스터 24x24 (ENEMY_ORDER 순서로 종류마다 [걷기1, 걷기2, 쓰러짐] + 마지막에 영혼)
  assets/bosses.png            보스 40x40 x 9프레임 (거대 슬라임·해골 궁수 대장·심연의 골렘, 각 [1, 2, 쓰러짐])
  assets/gear.png              장비 스킨 32x32 x 4프레임 (중세 기사·다크나이트·대마법사·사무라이, 플레이어 위에 겹쳐 그림)
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
    'o': (255, 140, 50, 255),    # 주황 (빛나는 금)
    'K': (30, 28, 36, 255),      # 검정
    'p': (126, 87, 194, 255),    # 보라
}

# ---------------------------------------------------------------- 무기 (24x12, 테두리 자동)
WW, WH = 24, 12
# 순서는 render.js의 WEAPON_SPRITES와 같아야 합니다.
WEAPON_ORDER = [
    'pistol', 'twin', 'machinegun', 'rifle', 'shotgun', 'triplet', 'minigun', 'sniper', 'combatshotgun',
    'bow', 'longbow', 'crossbow', 'rapidbow', 'heavenbow', 'repeater', 'stormbow',
    'sword', 'greatsword', 'twinblades', 'zanbato', 'bladestorm',
    'spear', 'halberd', 'lance', 'trident', 'dragonlance',
    'hammer', 'warhammer', 'quakehammer', 'titanhammer', 'earthshaker',
    'chest', 'chest_open',
    'staff', 'mace',
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
    elif name == 'pistol':
        rect(px, 4, 3, 11, 6, 'D'); rect(px, 12, 3, 17, 4, 'M'); rect(px, 4, 3, 16, 3, 'm')
        rect(px, 4, 7, 6, 9, 'W'); px[(8, 7)] = px[(9, 8)] = 'D'
    elif name == 'shotgun':
        rect(px, 1, 4, 6, 8, 'W'); rect(px, 1, 8, 3, 8, 'w'); rect(px, 7, 3, 11, 6, 'D')
        rect(px, 12, 3, 22, 4, 'M'); rect(px, 12, 3, 22, 3, 'm'); rect(px, 13, 6, 17, 7, 'W')
    elif name == 'sniper':
        rect(px, 1, 4, 4, 8, 'W'); rect(px, 5, 4, 11, 6, 'D'); rect(px, 12, 5, 22, 5, 'M')
        rect(px, 7, 1, 12, 2, 'D'); rect(px, 13, 1, 13, 2, 'b'); rect(px, 8, 7, 9, 9, 'W')
    elif name == 'twin':
        for y0 in (1, 6):
            rect(px, 5, y0, 10, y0 + 2, 'D'); rect(px, 11, y0, 16, y0 + 1, 'M'); rect(px, 5, y0, 15, y0, 'm')
            rect(px, 5, y0 + 3, 6, y0 + 4, 'W')
    elif name == 'machinegun':
        rect(px, 1, 4, 4, 7, 'W'); rect(px, 5, 3, 12, 6, 'D'); rect(px, 5, 3, 12, 3, 'M')
        rect(px, 13, 4, 22, 5, 'M'); rect(px, 13, 4, 22, 4, 'm'); rect(px, 20, 3, 20, 3, 'D')
        rect(px, 7, 7, 10, 10, 'D'); rect(px, 8, 7, 9, 9, 'M'); rect(px, 13, 6, 14, 8, 'W')
    elif name == 'rifle':
        rect(px, 1, 4, 7, 7, 'W'); rect(px, 1, 7, 4, 7, 'w'); rect(px, 8, 4, 13, 6, 'D')
        rect(px, 14, 4, 22, 5, 'M'); rect(px, 14, 4, 21, 4, 'm'); rect(px, 10, 7, 11, 9, 'D'); rect(px, 15, 6, 19, 6, 'W')
    elif name == 'triplet':
        rect(px, 3, 2, 10, 9, 'D'); rect(px, 3, 2, 10, 2, 'M')
        for y in (2, 5, 8):
            rect(px, 11, y, 19, y + 1, 'M'); rect(px, 11, y, 18, y, 'm')
        rect(px, 4, 10, 6, 11, 'W'); px[(20, 5)] = 'g'
    elif name == 'minigun':
        rect(px, 1, 4, 3, 7, 'W'); rect(px, 4, 2, 11, 9, 'D'); rect(px, 4, 2, 11, 2, 'M')
        for i, y in enumerate((3, 5, 7)):
            rect(px, 12, y, 22, y, 'M' if i != 1 else 'm')
        rect(px, 12, 4, 21, 4, 'D'); rect(px, 12, 6, 21, 6, 'D'); rect(px, 16, 2, 17, 8, 'D')
        rect(px, 6, 10, 8, 11, 'g')
    elif name == 'combatshotgun':
        rect(px, 1, 4, 5, 8, 'K'); rect(px, 6, 3, 11, 7, 'D'); rect(px, 6, 3, 11, 3, 'M')
        rect(px, 12, 3, 22, 4, 'M'); rect(px, 12, 3, 22, 3, 'm'); rect(px, 12, 6, 20, 6, 'D')
        rect(px, 8, 8, 11, 10, 'D'); px[(9, 9)] = 'r'; rect(px, 14, 7, 17, 8, 'r')
    elif name == 'rapidbow':
        arc_bow(px, [4, 5, 6, 7, 7, 7, 7, 6, 5, 4], False)
        for y in (5, 7):
            rect(px, 3, y, 13, y, 'W'); px[(14, y)] = 'm'
        px[(2, 4)] = px[(2, 8)] = 'r'
    elif name == 'heavenbow':
        for y, x in zip(range(0, 12), [5, 7, 9, 10, 11, 11, 11, 11, 10, 9, 7, 5]):
            px[(x, y)] = 'g'
            if 1 <= y <= 10:
                px[(x - 1, y)] = 'o'
        px[(5, 0)] = px[(5, 11)] = 'L'
        for y in range(1, 11):
            px[(3, y)] = 'L'
        rect(px, 3, 6, 19, 6, 'g'); rect(px, 20, 5, 20, 7, 'L'); px[(21, 6)] = 'L'; px[(12, 3)] = px[(13, 9)] = 'L'
    elif name == 'repeater':
        rect(px, 1, 6, 14, 8, 'W'); rect(px, 1, 8, 6, 8, 'w')
        rect(px, 12, 4, 13, 9, 'm'); rect(px, 11, 2, 11, 3, 'm'); rect(px, 11, 10, 11, 11, 'm')
        rect(px, 6, 1, 10, 5, 'w'); rect(px, 6, 1, 10, 1, 'W'); rect(px, 8, 5, 20, 5, 'M'); rect(px, 21, 5, 22, 5, 'm')
    elif name == 'stormbow':
        arc_bow(px, [4, 6, 7, 8, 8, 8, 8, 7, 6, 4], True)
        for y in (5, 7):
            rect(px, 3, y, 15, y, 'b'); px[(16, y)] = 'L'
        px[(9, 3)] = px[(10, 2)] = px[(9, 9)] = px[(10, 10)] = 'b'
    elif name == 'zanbato':
        rect(px, 0, 5, 3, 6, 'W'); rect(px, 4, 3, 4, 8, 'g')
        rect(px, 5, 2, 21, 8, 'm'); rect(px, 5, 2, 21, 2, 'L'); rect(px, 5, 8, 22, 8, 'M'); rect(px, 22, 3, 22, 7, 'm')
        rect(px, 8, 5, 18, 5, 'M')
    elif name == 'bladestorm':
        rect(px, 9, 4, 13, 7, 'g'); rect(px, 10, 5, 12, 6, 'r')
        rect(px, 14, 5, 22, 6, 'm'); rect(px, 14, 5, 21, 5, 'L')
        rect(px, 1, 5, 8, 6, 'm'); rect(px, 2, 6, 8, 6, 'M')
        rect(px, 10, 0, 11, 3, 'm'); rect(px, 11, 8, 12, 11, 'm')
    elif name == 'trident':
        rect(px, 1, 5, 15, 6, 'W'); rect(px, 16, 2, 17, 9, 'm')
        for y in (2, 5, 8):
            rect(px, 18, y, 21, y + (1 if y == 5 else 0), 'm')
        px[(22, 2)] = px[(22, 8)] = 'L'; rect(px, 22, 5, 23, 6, 'L')
    elif name == 'dragonlance':
        rect(px, 0, 5, 3, 6, 'r'); rect(px, 4, 2, 5, 9, 'g'); rect(px, 4, 2, 4, 9, 'o')
        rect(px, 6, 3, 9, 8, 'm'); rect(px, 10, 4, 15, 7, 'm'); rect(px, 16, 5, 21, 6, 'm'); rect(px, 22, 5, 23, 6, 'L')
        rect(px, 6, 3, 14, 3, 'L'); rect(px, 7, 6, 12, 6, 'r')
    elif name == 'titanhammer':
        rect(px, 1, 5, 12, 6, 'W'); rect(px, 13, 0, 22, 11, 'M'); rect(px, 13, 0, 22, 1, 'g'); rect(px, 13, 10, 22, 11, 'g')
        rect(px, 22, 0, 22, 11, 'm'); rect(px, 16, 4, 19, 7, 'g'); rect(px, 17, 5, 18, 6, 'o')
    elif name == 'earthshaker':
        rect(px, 1, 5, 11, 6, 'w'); rect(px, 12, 0, 22, 11, 'S'); rect(px, 12, 0, 22, 0, 'M')
        for p in [(14, 2), (15, 3), (15, 4), (16, 5), (17, 6), (17, 7), (18, 8), (19, 9), (20, 3), (19, 4), (18, 5)]:
            px[p] = 'o'
    elif name == 'staff':
        rect(px, 1, 5, 17, 6, 'W'); rect(px, 1, 6, 17, 6, 'w')
        rect(px, 18, 3, 21, 8, 'p'); rect(px, 19, 4, 20, 7, 'b'); px[(19, 4)] = 'L'
    elif name == 'mace':
        rect(px, 1, 5, 13, 6, 'W'); rect(px, 14, 3, 19, 8, 'g'); rect(px, 15, 4, 18, 7, 'o')
        px[(16, 2)] = px[(16, 9)] = px[(20, 5)] = px[(20, 6)] = 'g'
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
    """쓰러짐: 눈을 감고(가로줄) 옆으로 누운 모습. 색은 그대로라 플레이어 색·스킨이 입혀집니다."""
    fr = base.copy()
    # 그림자를 지우고 몸만 남김
    for y in range(32):
        for x in range(32):
            if fr.getpixel((x, y))[:3] == SHADOW[:3]:
                fr.putpixel((x, y), (0, 0, 0, 0))
    # 눈(11~12행)을 몸 색으로 덮고, 감은 눈 = 12행의 짧은 가로줄
    for y in (11, 12):
        for x in (13, 14, 18, 19):
            fr.putpixel((x, y), BODY)
    for x in (13, 14, 18, 19):
        fr.putpixel((x, 12), OUTLINE)
    body = fr.crop((6, 6, 26, 27)).rotate(90, expand=True)   # 머리가 왼쪽으로 가게 눕힘
    out = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    # 바닥 그림자
    for y in range(24, 30):
        for x in range(3, 30):
            dx, dy = (x - 16) / 13.5, (y - 27) / 3
            if dx * dx + dy * dy <= 1:
                out.putpixel((x, y), SHADOW)
    out.alpha_composite(body, (16 - body.width // 2, 29 - body.height))
    return out


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
    'V': (94, 53, 120, 255), 'v': (60, 30, 80, 255),                                   # 박쥐
    'A': (60, 52, 66, 255), 'a': (36, 30, 42, 255),                                    # 거미
    'N': (139, 195, 74, 255), 'n': (85, 139, 47, 255), 'F': (255, 160, 0, 255),        # 고블린, 불꽃
    'H': (144, 164, 174, 255), 'h': (96, 115, 125, 255), 'Z': (66, 72, 96, 255),       # 갑옷, 방패
    'E': (130, 255, 255, 255), 'e': (200, 240, 255, 200), 'X': (120, 200, 255, 140),   # 영혼
    'U': (255, 82, 82, 255),
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


def bat(f, size=24):
    c = Canvas(size, size)
    cx, cy = size // 2, 11
    c.ellipse(cx, cy, 4, 4.5, 'V', 'v')
    c.set(cx - 2, cy - 5, 'V'); c.set(cx + 2, cy - 5, 'V')       # 귀
    c.set(cx - 2, cy - 1, 'U'); c.set(cx + 1, cy - 1, 'U')       # 눈
    c.set(cx - 1, cy + 2, 'T'); c.set(cx + 1, cy + 2, 'T')       # 송곳니
    up = f == 0
    for side in (-1, 1):
        for i in range(1, 8):
            x = cx + side * (3 + i)
            y0 = cy - (i // 2 if up else -i // 3) - 1
            c.rect(min(x, x), y0, x, y0 + (3 if i < 6 else 1), 'v' if i % 3 == 0 else 'V')
    return c.image()


def spider(f, size=24):
    c = Canvas(size, size)
    cx, cy = size // 2, 14
    for i, dy in enumerate((-3, -1, 1, 3)):
        lift = (i + f) % 2
        for side in (-1, 1):
            c.rect(cx + side * 5 if side < 0 else cx + 5, cy + dy - lift, cx + side * 5 if side < 0 else cx + 5, cy + dy - lift, 'a')
            c.set(cx + side * 6, cy + dy - 1 - lift, 'a'); c.set(cx + side * 7, cy + dy - 1 - lift, 'a')
            c.set(cx + side * 8, cy + dy - lift, 'a'); c.set(cx + side * 9, cy + dy + 1, 'a'); c.set(cx + side * 9, cy + dy + 2, 'a')
    c.ellipse(cx, cy + 1, 5.5, 4.5, 'A', 'a')
    c.ellipse(cx, cy - 4, 3.5, 3, 'A', 'a')
    for x in (cx - 2, cx - 1, cx + 1, cx + 2):
        c.set(x, cy - 5 + (1 if x in (cx - 1, cx + 1) else 0), 'U')
    c.rect(cx - 1, cy + 1, cx + 1, cy + 3, 'R')  # 등 무늬
    return c.image()


def bomber(f, size=24):
    c = Canvas(size, size)
    cx, base = size // 2, size - 3
    bob = 0 if f == 0 else 1
    c.rect(cx - 4, base - 3, cx - 2, base, 'n'); c.rect(cx + 1, base - 3 + bob, cx + 3, base, 'n')
    c.ellipse(cx, base - 7, 4.5, 4, 'N', 'n')
    c.ellipse(cx, base - 13, 4, 3.5, 'N', 'n')
    c.set(cx - 5, base - 14, 'N'); c.set(cx + 5, base - 14, 'N')   # 뾰족 귀
    c.set(cx - 2, base - 14, 'K'); c.set(cx + 1, base - 14, 'K')
    # 머리 위로 든 폭탄 + 불꽃
    c.ellipse(cx + 1, base - 20, 3.5, 3.5, 'K')
    c.set(cx, base - 21, 'M')
    c.set(cx + 3, base - 24, 'w'); c.set(cx + 4, base - 25 + bob, 'F' if f == 0 else 'Y')
    return c.image()


def caster(f, size=24):
    c = Canvas(size, size)
    cx, base = size // 2, size - 2
    sway = 0 if f == 0 else 1
    # 로브
    for y in range(base - 13, base + 1):
        w = 2 + (y - (base - 13)) // 3
        c.rect(cx - w, y, cx + w, y, 'P' if y % 4 else 'p')
    c.ellipse(cx, base - 16, 3.6, 3.4, 'B', 'b')               # 해골 얼굴
    c.rect(cx - 2, base - 17, cx - 1, base - 16, 'K'); c.rect(cx + 1, base - 17, cx + 2, base - 16, 'K')
    c.set(cx - 2, base - 17, 'E'); c.set(cx + 2, base - 17, 'E')
    for y in range(base - 21, base - 18):                       # 두건
        c.rect(cx - 4 + (base - 19 - y), y, cx + 4 - (base - 19 - y), y, 'p')
    c.rect(cx + 6, base - 18 + sway, cx + 6, base, 'W')        # 지팡이
    c.ellipse(cx + 6.5, base - 20 + sway, 2, 2, 'E' if f == 0 else 'P')
    return c.image()


def shieldman(f, size=24):
    c = Canvas(size, size)
    cx, base = size // 2 - 1, size - 3
    bob = 0 if f == 0 else 1
    c.rect(cx - 4, base - 4, cx - 2, base, 'h'); c.rect(cx + 1, base - 4 + bob, cx + 3, base, 'h')
    c.rect(cx - 5, base - 13, cx + 4, base - 5, 'H'); c.rect(cx - 5, base - 6, cx + 4, base - 5, 'h')
    c.ellipse(cx, base - 16, 4, 3.6, 'H', 'h')
    c.rect(cx - 2, base - 16, cx + 3, base - 16, 'K')           # 투구 틈
    c.set(cx, base - 21, 'U'); c.rect(cx - 1, base - 20, cx + 1, base - 20, 'U')
    # 큰 방패 (오른쪽 = 앞)
    c.rect(cx + 5, base - 17, cx + 10, base - 2, 'Z'); c.rect(cx + 5, base - 17, cx + 10, base - 17, 'M')
    c.rect(cx + 7, base - 13, cx + 8, base - 6, 'Y'); c.rect(cx + 6, base - 10, cx + 9, base - 9, 'Y')
    return c.image()


def totem(f, size=24):
    c = Canvas(size, size)
    cx, base = size // 2, size - 2
    c.rect(cx - 5, base - 2, cx + 5, base, 's')
    c.rect(cx - 4, base - 20, cx + 4, base - 3, 'W'); c.rect(cx - 4, base - 20, cx - 3, base - 3, 'w')
    for y in (base - 14, base - 8):
        c.rect(cx - 4, y, cx + 4, y, 'w')
    eye = 'E' if f == 0 else 'P'
    c.rect(cx - 3, base - 18, cx - 2, base - 17, eye); c.rect(cx + 2, base - 18, cx + 3, base - 17, eye)
    c.rect(cx - 2, base - 12, cx + 2, base - 10, 'K'); c.rect(cx - 1, base - 11, cx + 1, base - 11, 'U')
    c.rect(cx - 7, base - 19, cx - 5, base - 17, 'P'); c.rect(cx + 5, base - 19, cx + 7, base - 17, 'P')  # 날개 장식
    c.rect(cx - 2, base - 23, cx + 2, base - 21, 'p'); c.set(cx, base - 24, 'E')
    return c.image()


def soul(size=24):
    """쓰러진 적에게서 빠져나가는 영혼"""
    c = Canvas(size, size)
    cx = size // 2
    c.ellipse(cx, 8, 5, 5, 'e')
    for y in range(9, 20):
        w = max(0, 5 - (y - 9) // 2)
        sway = 1 if (y // 3) % 2 else 0
        c.rect(cx - w + sway, y, cx + w + sway - (1 if y > 15 else 0), y, 'X' if y > 14 else 'e')
    c.rect(cx - 3, 7, cx - 2, 8, 'K'); c.rect(cx + 2, 7, cx + 3, 8, 'K')
    c.rect(cx - 1, 11, cx + 1, 11, 'K')
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for (x, y), col in c.px.items():
        im.putpixel((x, y), MON[col])
    return im   # 영혼은 테두리 없이 반투명


def dead_of(img):
    """적 쓰러짐: 회색으로 바래고 옆으로 누운 모습 (눈은 X)"""
    w, h = img.size
    gray = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y in range(h):
        for x in range(w):
            r, g, b, a = img.getpixel((x, y))
            if not a:
                continue
            if (r, g, b) == OUTLINE[:3]:
                gray.putpixel((x, y), (190, 190, 200, a))
            else:
                v = int((r * 0.3 + g * 0.5 + b * 0.2) * 0.55)
                gray.putpixel((x, y), (v + 20, v + 14, v + 26, a))
    lying = gray.rotate(-90)
    bbox = lying.getbbox() or (0, 0, w, h)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    part = lying.crop(bbox)
    out.alpha_composite(part, ((w - part.width) // 2, h - part.height - 1))
    return out


GEAR_PAL = {
    'm': (205, 214, 228, 255), 'M': (140, 150, 170, 255), 'D': (66, 70, 90, 255), 'L': (250, 252, 255, 255),
    'r': (220, 50, 50, 255), 'R': (150, 20, 30, 255), 'K': (22, 20, 30, 255), 'k': (50, 45, 62, 255),
    'g': (255, 200, 70, 255), 'B': (40, 53, 147, 255), 'b': (63, 81, 181, 255), 'y': (255, 241, 118, 255),
    'W': (110, 70, 42, 255), 'w': (70, 45, 28, 255), 'o': (230, 230, 230, 255),
}


def gear(kind):
    """플레이어 머리(맨 윗줄 7, 가로 10~20) 위에 겹쳐 그리는 장비. 눈(11~12행)은 가리지 않음."""
    c = {}
    def r(x0, y0, x1, y1, col):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c[(x, y)] = col
    if kind == 'knight':
        r(10, 6, 20, 9, 'M'); r(11, 5, 19, 5, 'M'); r(12, 4, 18, 4, 'm'); r(11, 6, 19, 6, 'm')
        r(9, 8, 10, 14, 'M'); r(20, 8, 21, 14, 'M'); r(10, 10, 20, 10, 'D')           # 챙과 볼 보호대
        r(15, 0, 16, 3, 'r'); r(14, 1, 14, 2, 'r'); r(17, 2, 18, 3, 'r')             # 깃털
        r(6, 14, 9, 16, 'm'); r(21, 14, 24, 16, 'm'); r(6, 16, 9, 16, 'M'); r(21, 16, 24, 16, 'M')  # 어깨 갑옷
    elif kind == 'darkknight':
        r(10, 5, 20, 9, 'K'); r(11, 4, 19, 4, 'k'); r(10, 10, 20, 10, 'k')
        r(9, 8, 10, 14, 'K'); r(20, 8, 21, 14, 'K')
        r(7, 1, 8, 5, 'k'); r(8, 3, 9, 5, 'K'); r(22, 1, 23, 5, 'k'); r(21, 3, 22, 5, 'K')  # 뿔
        r(12, 7, 18, 7, 'R'); r(14, 2, 16, 3, 'r')
        r(5, 14, 9, 17, 'K'); r(21, 14, 25, 17, 'K'); r(5, 13, 6, 13, 'k'); r(24, 13, 25, 13, 'k')
    elif kind == 'wizard':
        r(7, 9, 23, 10, 'B')                                                        # 챙
        for i, y in enumerate(range(8, 0, -1)):
            r(11 + i // 2, y, 19 - i // 2 + (1 if y < 3 else 0), y, 'b' if i % 3 else 'B')
        r(20, 0, 22, 1, 'B'); r(12, 8, 18, 8, 'y'); r(14, 4, 14, 4, 'y'); r(17, 6, 17, 6, 'y')
    elif kind == 'samurai':
        r(10, 6, 20, 9, 'R'); r(11, 5, 19, 5, 'R'); r(10, 9, 20, 10, 'K')
        r(8, 9, 9, 13, 'R'); r(21, 9, 22, 13, 'R'); r(8, 13, 9, 13, 'K'); r(21, 13, 22, 13, 'K')
        r(10, 3, 11, 5, 'g'); r(19, 3, 20, 5, 'g'); r(9, 1, 10, 3, 'g'); r(20, 1, 21, 3, 'g')  # 투구 장식
        r(14, 4, 16, 5, 'g')
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    for (x, y), col in c.items():
        im.putpixel((x, y), GEAR_PAL[col])
    # 어두운 테두리
    out = im.copy()
    for y in range(32):
        for x in range(32):
            if im.getpixel((x, y))[3]:
                continue
            if any(0 <= x + dx < 32 and 0 <= y + dy < 32 and im.getpixel((x + dx, y + dy))[3]
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                if not (12 <= x <= 19 and 11 <= y <= 12):  # 눈 자리는 비움
                    out.putpixel((x, y), (16, 14, 22, 255))
    return out


ENEMY_ORDER = ['slime', 'archer', 'brute', 'bat', 'spider', 'bomber', 'caster', 'shield', 'totem']


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
    makers = {'slime': slime, 'archer': skeleton, 'brute': brute, 'bat': bat, 'spider': spider,
              'bomber': bomber, 'caster': caster, 'shield': shieldman, 'totem': totem}
    eframes = []
    for k in ENEMY_ORDER:
        a, b = makers[k](0), makers[k](1)
        eframes += [a, b, dead_of(a)]
    eframes.append(soul())
    pk, sheet = to_piskel('enemies', eframes, 24, 24)
    sheet.save(ASSETS / 'enemies.png')
    (SRC / 'enemies.piskel').write_text(json.dumps(pk))

    gframes = [gear(k) for k in ('knight', 'darkknight', 'wizard', 'samurai')]
    pk, sheet = to_piskel('gear', gframes, 32, 32)
    sheet.save(ASSETS / 'gear.png')
    (SRC / 'gear.piskel').write_text(json.dumps(pk))

    bframes = []
    for a, b in [(slime(0, 40, 2.0, crown=True), slime(1, 40, 2.0, crown=True)),
                 (skeleton(0, 40, 1.7, captain=True), skeleton(1, 40, 1.7, captain=True)), (golem(0), golem(1))]:
        bframes += [a, b, dead_of(a)]
    pk, sheet = to_piskel('bosses', bframes, 40, 40)
    sheet.save(ASSETS / 'bosses.png')
    (SRC / 'bosses.piskel').write_text(json.dumps(pk))
    print('player frames', len(frames), '| weapon frames', len(wframes), '| enemy', len(eframes), '| boss', len(bframes))


if __name__ == '__main__':
    main()
