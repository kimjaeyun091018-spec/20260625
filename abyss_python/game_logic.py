"""
ABYSS — 심연 (Python port core logic)

이 파일은 pygame에 의존하지 않는 '순수 로직'만 담고 있습니다.
(맵 생성, 충돌 판정, 시야 차단, 문 상태 머신, 벤트 침수 계산 등)
렌더링/입력/사운드 재생은 abyss_topdown.py 에서 담당합니다.

이렇게 분리한 이유: 로직만 따로 두면 pygame이 설치되어 있지 않은 환경에서도
동작을 유닛 테스트할 수 있고, 원본 HTML/JS 버전과의 동작 일치 여부를 쉽게 검증할 수 있습니다.
"""
import math

MAP_W, MAP_H = 40, 24
TS = 40  # 타일 픽셀 크기 (렌더링에서 사용)

# ── 타일 종류 ──────────────────────────────────────────
WALL, FLOOR, DOOR, CONSOLE, BED, PIPE, PORTHOLE, VENT, CRACK, LOCKED, LOCKER, CABINET, PANEL = range(13)

TILE_NAMES = {
    WALL: 'WALL', FLOOR: 'FLOOR', DOOR: 'DOOR', CONSOLE: 'CONSOLE', BED: 'BED',
    PIPE: 'PIPE', PORTHOLE: 'PORTHOLE', VENT: 'VENT', CRACK: 'CRACK', LOCKED: 'LOCKED',
    LOCKER: 'LOCKER', CABINET: 'CABINET', PANEL: 'PANEL',
}

SEARCHABLE = {LOCKER, CABINET, PANEL}

KEY_HIDDEN_AT = {(5, 3), (22, 7), (24, 15), (36, 16)}

SEARCH_LORE = {
    (5, 3):  '낡은 사물함을 열었습니다.\n안쪽 깊숙이 열쇠가 숨겨져 있었습니다.',
    (22, 7): '파손된 패널 뒤에서\n무언가 금속성 물건이 발견되었습니다. 열쇠입니다.',
    (24, 15): '의료 캐비닛을 뒤졌습니다.\n붕대 사이에서 열쇠가 나왔습니다.',
    (36, 16): '공구함 바닥에서\n기름 묻은 열쇠를 찾았습니다.',
}

SEARCH_EMPTY = [
    '아무것도 없습니다', '먼지뿐입니다', '누군가 먼저 뒤진 것 같습니다',
    '오래된 기록이 있지만 읽을 수 없습니다', '손자국이 있습니다', '차갑고 텅 비어 있습니다',
]

VENT_TILES = [(10, 3), (25, 13)]
VENT_TRIGGER_RADIUS = 1.6
VENT_FILL_RATE_PER_MS = 100 / 55000.0  # 벤트 하나당 55초에 100%
FLOOD_GURGLE_INTERVAL = (2200, 4200)

DOOR_OPEN_RADIUS = 1.35
DOOR_CLOSE_DELAY = 1100.0
DOOR_ANIM_MS = 320.0

MARGIN = 0.30


def build_map():
    """원본 HTML/JS 버전(abyss_topdown.html buildMap())과 동일한 맵 레이아웃."""
    m = [[WALL] * MAP_W for _ in range(MAP_H)]

    def fill(x1, y1, x2, y2, t):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                if 0 <= y < MAP_H and 0 <= x < MAP_W:
                    m[y][x] = t

    def set_(x, y, t):
        if 0 <= x < MAP_W and 0 <= y < MAP_H:
            m[y][x] = t

    # 방1: 선원실 x[2..10], y[2..8]
    fill(2, 2, 10, 8, FLOOR)
    set_(3, 3, BED); set_(4, 3, BED)
    set_(3, 4, BED); set_(4, 4, BED)
    set_(8, 6, BED); set_(9, 6, BED)
    set_(6, 5, CRACK)
    set_(10, 3, VENT)
    set_(5, 3, LOCKER)
    set_(11, 4, WALL)
    set_(11, 5, LOCKED)
    set_(11, 6, WALL)

    # 복도A: x[12..13], y[4..6]
    fill(12, 4, 13, 6, FLOOR)

    # 방2: 제어실 x[13..25], y[2..9]
    fill(13, 2, 25, 9, FLOOR)
    set_(14, 3, CONSOLE); set_(15, 3, CONSOLE); set_(16, 3, CONSOLE)
    set_(17, 3, CONSOLE); set_(18, 3, CONSOLE)
    set_(24, 3, CONSOLE); set_(24, 4, CONSOLE)
    set_(22, 7, PANEL)
    set_(19, 5, CRACK)
    set_(17, 9, WALL)
    set_(18, 9, LOCKED)
    set_(19, 9, WALL)

    # 복도B: x[17..19], y[10..12]
    fill(17, 10, 19, 12, FLOOR)
    set_(18, 11, CRACK)

    # 방3: 의무실 x[12..26], y[12..17]
    fill(12, 12, 26, 17, FLOOR)
    set_(13, 13, BED); set_(14, 13, BED)
    set_(13, 14, BED); set_(14, 14, BED)
    set_(24, 15, CABINET)
    set_(20, 15, CRACK)
    set_(25, 13, VENT)
    set_(26, 13, WALL); set_(26, 14, WALL)
    set_(26, 15, LOCKED)
    set_(26, 16, WALL); set_(26, 17, WALL)

    # 복도C: x[27..28], y[13..17]
    fill(27, 13, 28, 17, FLOOR)
    set_(27, 14, PIPE)

    # 방4: 기관실 x[28..37], y[11..18]
    fill(28, 11, 37, 18, FLOOR)
    for x in range(29, 34):
        set_(x, 12, PIPE)
        set_(x, 17, PIPE)
    set_(36, 16, LOCKER)
    set_(30, 15, CRACK)
    set_(32, 18, WALL)
    set_(33, 18, LOCKED)
    set_(34, 18, WALL)

    # 복도D: x[32..34], y[19..20]
    fill(32, 19, 34, 20, FLOOR)

    # 방5: 관측실 x[29..37], y[20..22]
    fill(29, 20, 37, 22, FLOOR)
    set_(33, 20, DOOR)
    set_(30, 21, PORTHOLE); set_(33, 21, PORTHOLE); set_(36, 21, PORTHOLE)

    return m


ROOM_BOUNDS = [
    ('crew', 2, 11, 2, 8),
    ('control', 13, 25, 2, 9),
    ('medbay', 12, 26, 12, 17),
    ('engine', 28, 37, 11, 18),
    ('observation', 29, 37, 20, 22),
]
ROOM_NAMES_KR = {
    'crew': '선원실', 'control': '제어실', 'medbay': '의무실',
    'engine': '기관실', 'observation': '관측실', 'corridor': '통로',
}
ROOM_DEPTHS = {'crew': 1200, 'control': 2400, 'medbay': 3600, 'engine': 4800, 'observation': 6000}


def get_room(px, py):
    x, y = int(math.floor(px)), int(math.floor(py))
    for name, x1, x2, y1, y2 in ROOM_BOUNDS:
        if x1 <= x <= x2 and y1 <= y <= y2:
            return name
    return 'corridor'


# ── 환각 이벤트 (원본과 동일 — 'flood' 이벤트는 "사실은 그냥 바닥"이라는
#    가짜 환각 메시지이며, 실제 벤트 침수 기믹과는 별개로 유지해 아이러니를 살린다) ──
HAL_EVENTS = [
    dict(id='voices', trigger_room='control', sanity_drain=10,
         messages=['...들리나요...', '...뒤를 돌아보지 마세요...', '당신 뒤에 있어요...']),
    dict(id='mirror', trigger_room='medbay', sanity_drain=15,
         messages=['그게 당신인가요?', '움직이지 않았는데—', '당신의 반사가 먼저 움직였어요']),
    dict(id='flood', trigger_room='engine', sanity_drain=20,
         messages=['물이...', '바닥에 물이 차고 있어요', '아니—그냥 바닥이에요. 진짜로.']),
    dict(id='creature', trigger_room='observation', sanity_drain=30,
         messages=['유리 너머에—', '아무것도 없어요. 당연히.', '수심 6,000m에는 아무것도 살지 않아요.']),
]
CRACK_EVENT = dict(id='crack_whisper', sanity_drain=5,
                    messages=['균열이 속삭입니다', '여기서 나가야 해', '...왜 왔나요...'])


class Doors:
    """문 상태 레지스트리. 'closed' -> 'opening' -> 'open' -> 'closing' -> 'closed'."""

    def __init__(self, game_map):
        self.states = {}
        for y in range(MAP_H):
            for x in range(MAP_W):
                if game_map[y][x] == DOOR:
                    self.register(x, y, initially_open=False)

    def register(self, x, y, initially_open=False):
        self.states[(x, y)] = {
            'state': 'open' if initially_open else 'closed',
            'anim': 1.0 if initially_open else 0.0,
            'away_timer': 0.0,
        }
        return self.states[(x, y)]

    def passable(self, x, y):
        d = self.states.get((x, y))
        if d is None:
            return True
        return d['state'] != 'closed'

    def update(self, dt, px, py, on_open=None, on_close=None):
        """dt(ms) 경과, 플레이어 좌표를 받아 모든 문의 상태를 갱신.
        on_open()/on_close() 콜백은 사운드/자막 재생을 위해 호출자가 넘긴다."""
        for (dx, dy), d in self.states.items():
            dist = math.hypot(px - (dx + 0.5), py - (dy + 0.5))
            near = dist < DOOR_OPEN_RADIUS

            if near:
                d['away_timer'] = 0.0
                if d['state'] == 'closed':
                    d['state'] = 'opening'
                    if on_open:
                        on_open(dx, dy)
                elif d['state'] == 'closing':
                    d['state'] = 'opening'
            elif d['state'] == 'open':
                d['away_timer'] += dt
                if d['away_timer'] >= DOOR_CLOSE_DELAY:
                    d['state'] = 'closing'
                    d['away_timer'] = 0.0
                    if on_close:
                        on_close(dx, dy)

            if d['state'] == 'opening':
                d['anim'] = min(1.0, d['anim'] + dt / DOOR_ANIM_MS)
                if d['anim'] >= 1.0:
                    d['state'] = 'open'
            elif d['state'] == 'closing':
                d['anim'] = max(0.0, d['anim'] - dt / DOOR_ANIM_MS)
                if d['anim'] <= 0.0:
                    d['state'] = 'closed'


class FloodVents:
    """바닥 벤트 침수 기믹의 순수 계산 로직."""

    def __init__(self):
        self.vents = {pos: {'triggered': False, 'level': 0.0, 'gurgle_timer': 0.0} for pos in VENT_TILES}
        self.flood_level = 0.0

    def update(self, dt, px, py, on_trigger=None, on_gurgle=None, rng=None):
        import random as _r
        rng = rng or _r
        any_active = False
        for (vx, vy), v in self.vents.items():
            if not v['triggered']:
                dist = math.hypot(px - (vx + 0.5), py - (vy + 0.5))
                if dist < VENT_TRIGGER_RADIUS:
                    v['triggered'] = True
                    v['gurgle_timer'] = rng.uniform(1500, 3000)
                    if on_trigger:
                        on_trigger(vx, vy)
            if v['triggered']:
                any_active = True
                v['level'] = min(100.0, v['level'] + VENT_FILL_RATE_PER_MS * dt)
                v['gurgle_timer'] -= dt
                if v['gurgle_timer'] <= 0:
                    if on_gurgle:
                        on_gurgle(v['level'] / 100.0)
                    v['gurgle_timer'] = rng.uniform(*FLOOD_GURGLE_INTERVAL)

        total = sum(v['level'] for v in self.vents.values() if v['triggered'])
        self.flood_level = min(100.0, total)
        return any_active


def tile_blocks(game_map, doors, tx, ty):
    """주의: LOCKED는 '아직 잠긴 문'을 의미하며 항상 막힌다 — 열쇠로 열리면
    (main 쪽에서) game_map의 해당 칸이 DOOR로 바뀌므로 더 이상 LOCKED로 매치되지 않는다.
    즉 unlocked_doors 세트는 이 함수의 판정에 필요 없다(원본 JS와 동일한 방식)."""
    x, y = int(math.floor(tx)), int(math.floor(ty))
    if x < 0 or x >= MAP_W or y < 0 or y >= MAP_H:
        return True
    t = game_map[y][x]
    if t == WALL:
        return True
    if t in (LOCKER, CABINET, PANEL):
        return True
    if t == LOCKED:
        return True
    if t == DOOR:
        return not doors.passable(x, y)
    return False


def can_move(game_map, doors, px, py, margin=MARGIN):
    m = margin
    pts = [(px - m, py - m), (px + m, py - m), (px - m, py + m), (px + m, py + m),
           (px, py - m), (px, py + m), (px - m, py), (px + m, py)]
    return all(not tile_blocks(game_map, doors, x, y) for x, y in pts)


def sight_blocks(game_map, tx, ty):
    if tx < 0 or tx >= MAP_W or ty < 0 or ty >= MAP_H:
        return True
    t = game_map[ty][tx]
    # 벽과 문(열렸든 잠겼든)은 항상 시야를 가린다. 가구는 같은 방 안에서는 가리지 않는다.
    return t in (WALL, LOCKED, DOOR)


def has_line_of_sight(game_map, x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    dist = math.hypot(dx, dy)
    if dist < 0.001:
        return True
    steps = max(1, math.ceil(dist * 3))
    dest_tx, dest_ty = int(math.floor(x1)), int(math.floor(y1))
    for i in range(1, steps):
        tt = i / steps
        cx, cy = x0 + dx * tt, y0 + dy * tt
        tx, ty = int(math.floor(cx)), int(math.floor(cy))
        if tx == dest_tx and ty == dest_ty:
            continue
        if sight_blocks(game_map, tx, ty):
            return False
    return True


def get_nearby_searchable(game_map, px, py, searched_tiles):
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            tx, ty = int(math.floor(px)) + dx, int(math.floor(py)) + dy
            if tx < 0 or tx >= MAP_W or ty < 0 or ty >= MAP_H:
                continue
            if game_map[ty][tx] not in SEARCHABLE:
                continue
            dist = math.hypot(px - (tx + 0.5), py - (ty + 0.5))
            if dist < 1.4:
                return (tx, ty)
    return None


def get_nearby_locked_door(game_map, px, py):
    """game_map 타일이 아직 LOCKED인 동안에만 매치된다 (열리면 DOOR로 바뀜)."""
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            tx, ty = int(math.floor(px)) + dx, int(math.floor(py)) + dy
            if tx < 0 or tx >= MAP_W or ty < 0 or ty >= MAP_H:
                continue
            if game_map[ty][tx] != LOCKED:
                continue
            dist = math.hypot(px - (tx + 0.5), py - (ty + 0.5))
            if dist < 1.4:
                return (tx, ty)
    return None
