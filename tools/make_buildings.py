"""건물 도트 만들기 (성·울타리·터렛)

실행:  python tools/make_buildings.py
결과:  assets/castle.png (64x70) · assets/fence.png (16x16) · assets/turret.png (16x26)
게임에서는 2배로 크게 그립니다.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
INK = (26, 22, 34, 255)

C = {
    'stone': (176, 182, 196, 255), 'stoneL': (214, 220, 230, 255), 'stoneD': (112, 118, 138, 255), 'stoneDD': (78, 82, 100, 255),
    'roof': (58, 104, 196, 255), 'roofL': (104, 152, 234, 255), 'roofD': (34, 62, 132, 255),
    'wood': (150, 96, 54, 255), 'woodL': (196, 138, 82, 255), 'woodD': (96, 58, 34, 255),
    'gold': (240, 196, 72, 255), 'goldD': (170, 120, 30, 255),
    'win': (255, 214, 102, 255), 'dark': (40, 34, 52, 255),
    'flag': (230, 62, 56, 255), 'flagD': (160, 30, 36, 255), 'flagB': (70, 120, 220, 255), 'flagBD': (40, 70, 150, 255),
    'rope': (120, 100, 70, 255), 'grass': (80, 140, 70, 255),
}


class Pix:
    def __init__(self, w, h, oy=0):
        self.w, self.h, self.px, self.oy = w, h, {}, oy   # oy: 모두 아래로 밀기 (깃발이 잘리지 않게)

    def set(self, x, y, c):
        y += self.oy
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[(x, y)] = C[c] if isinstance(c, str) else c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def image(self):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), c)
        # 진한 바깥 테두리
        out = im.copy()
        for y in range(self.h):
            for x in range(self.w):
                if im.getpixel((x, y))[3]:
                    continue
                if any(0 <= x + dx < self.w and 0 <= y + dy < self.h and im.getpixel((x + dx, y + dy))[3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    out.putpixel((x, y), INK)
        return out


def stone_wall(p, x0, y0, x1, y1):
    """벽돌 무늬 돌벽 (위·왼쪽 밝게, 아래 어둡게)"""
    p.rect(x0, y0, x1, y1, 'stone')
    for y in range(y0, y1 + 1):
        row = (y - y0) // 4
        if (y - y0) % 4 == 3:
            for x in range(x0, x1 + 1):
                p.set(x, y, 'stoneD')
        else:
            off = 3 if row % 2 else 0
            for x in range(x0, x1 + 1):
                if (x - x0 + off) % 7 == 6:
                    p.set(x, y, 'stoneD')
    for y in range(y0, y1 + 1):
        p.set(x0, y, 'stoneL')
        p.set(x1, y, 'stoneDD')
    for x in range(x0, x1 + 1):
        p.set(x, y1, 'stoneDD')


def battlement(p, x0, x1, y):
    for x in range(x0, x1 + 1):
        if (x - x0) % 4 < 2:
            p.rect(x, y - 2, x, y, 'stone')
            p.set(x, y - 2, 'stoneL')
    p.rect(x0, y + 1, x1, y + 2, 'stoneD')


def cone_roof(p, cx, top, base, half):
    """파란 원뿔 지붕"""
    for y in range(top, base + 1):
        w = round(half * (y - top) / max(1, base - top))
        for x in range(cx - w, cx + w + 1):
            c = 'roofL' if x < cx - w // 2 else 'roofD' if x > cx + w // 2 else 'roof'
            p.set(x, y, c)
        if (y - top) % 3 == 2:
            for x in range(cx - w, cx + w + 1, 2):
                p.set(x, y, 'roofD')
    p.rect(cx - half - 1, base + 1, cx + half + 1, base + 1, 'roofD')


def flag(p, x, y, blue=False):
    p.rect(x, y, x, y + 6, 'woodD')
    c, d = ('flagB', 'flagBD') if blue else ('flag', 'flagD')
    for i, w in enumerate((5, 5, 4, 3)):
        p.rect(x + 1, y + i, x + w, y + i, c if i < 3 else d)
    p.set(x + 2, y + 1, 'gold')


def window(p, x, y, lit=True):
    p.rect(x, y, x + 1, y + 2, 'win' if lit else 'dark')
    p.set(x, y, 'dark')
    p.set(x + 1, y, 'dark')


def castle():
    p = Pix(64, 70, oy=6)
    # 뒤쪽 성벽 + 성가퀴
    stone_wall(p, 8, 30, 55, 57)
    battlement(p, 8, 55, 29)
    # 양쪽 탑
    for tx in (4, 46):
        stone_wall(p, tx, 24, tx + 13, 59)
        battlement(p, tx, tx + 13, 23)
        cone_roof(p, tx + 6, 9, 21, 8)
        flag(p, tx + 6, 3, blue=True)
        window(p, tx + 5, 32)
        window(p, tx + 5, 44, lit=False)
    # 가운데 큰 탑
    stone_wall(p, 21, 16, 42, 59)
    battlement(p, 21, 42, 15)
    cone_roof(p, 31, 0, 13, 11)
    flag(p, 31, -4)
    for wx in (25, 36):
        window(p, wx, 22)
        window(p, wx, 32)
    p.rect(29, 24, 33, 28, 'gold')      # 문장
    p.rect(30, 25, 32, 27, 'flag')
    # 성문 (아치 + 나무 문 + 계단)
    p.rect(26, 44, 37, 59, 'dark')
    for x in range(27, 37):
        for y in range(46, 60):
            p.set(x, y, 'wood' if (x - 27) % 3 else 'woodD')
    for x in range(27, 37):
        p.set(x, 45, 'dark')
    p.set(26, 44, 'stone'); p.set(37, 44, 'stone')
    p.rect(27, 52, 36, 52, 'woodD')
    p.set(35, 53, 'gold')
    p.rect(24, 60, 39, 61, 'stoneD')
    p.rect(22, 62, 41, 63, 'stoneDD')
    return p.image()


def fence():
    p = Pix(16, 16)
    for i, x in enumerate((1, 5, 9, 13)):
        top = 1 if i % 2 else 2
        p.rect(x, top + 1, x + 2, 15, 'wood')
        p.set(x + 1, top, 'woodL')
        for y in range(top + 1, 16):
            p.set(x, y, 'woodL')
            p.set(x + 2, y, 'woodD')
    for x in range(0, 16):
        p.set(x, 6, 'rope')
        p.set(x, 11, 'rope')
    return p.image()


def turret():
    p = Pix(16, 26, oy=2)
    stone_wall(p, 2, 6, 13, 23)
    battlement(p, 2, 13, 5)
    p.rect(7, 12, 8, 16, 'dark')        # 화살 구멍
    p.rect(6, 14, 9, 14, 'dark')
    flag(p, 12, -1)
    return p.image()


def main():
    castle().save(ASSETS / 'castle.png')
    fence().save(ASSETS / 'fence.png')
    turret().save(ASSETS / 'turret.png')
    print('castle, fence, turret')


if __name__ == '__main__':
    main()
