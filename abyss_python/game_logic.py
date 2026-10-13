"""
ABYSS — 합체선 (Python port core logic)

이 파일은 pygame에 의존하지 않는 '순수 로직'만 담고 있습니다.
(층별 맵 생성, 계단 연결, 충돌 판정, 시야 차단, 문 상태 머신, 벤트 침수 계산 등)
렌더링/입력/사운드 재생은 abyss_topdown.py 에서 담당합니다.

이렇게 분리한 이유: 로직만 따로 두면 pygame이 설치되어 있지 않은 환경에서도
동작을 유닛 테스트할 수 있습니다.

■ 배경
  여객선과 화물선이 십자 모양으로 충돌해 찌그러진 채 결합한 선체.
  가로로 놓인 여객선(x 3~46)과 세로로 박힌 화물선(x 19~30)이 겹치는 곳이 '합체 구간'.
  층은 1층 / B1 / B2 / B3 네 개이며 모든 층이 같은 50x32 격자를 쓴다.

■ 계단
  계단통(STAIRWELLS) 4개. 각 계단통에는 '위로' 타일과 '아래로' 타일이 나란히 있고,
  층 i와 i+1 사이의 연결 상태(links[i])가 아래 셋 중 하나다.
    normal   : 정상 통행
    blocked  : 찌그러져 막힘(RUBBLE) — 양쪽 층 모두 잔해로 표시
    collapse : 한 번 지나가면 무너져 되돌아갈 수 없음(이후 blocked)
"""
import math

MAP_W, MAP_H = 50, 32
TS = 40  # 타일 픽셀 크기 (렌더링에서 사용)

# ── 타일 종류 ──────────────────────────────────────────
(WALL, FLOOR, DOOR, CONSOLE, BED, PIPE, PORTHOLE, VENT, CRACK, LOCKED,
 LOCKER, CABINET, PANEL, STAIR_UP, STAIR_DOWN, RUBBLE) = range(16)

TILE_NAMES = {
    WALL: 'WALL', FLOOR: 'FLOOR', DOOR: 'DOOR', CONSOLE: 'CONSOLE', BED: 'BED',
    PIPE: 'PIPE', PORTHOLE: 'PORTHOLE', VENT: 'VENT', CRACK: 'CRACK', LOCKED: 'LOCKED',
    LOCKER: 'LOCKER', CABINET: 'CABINET', PANEL: 'PANEL',
    STAIR_UP: 'STAIR_UP', STAIR_DOWN: 'STAIR_DOWN', RUBBLE: 'RUBBLE',
}

SEARCHABLE = {LOCKER, CABINET, PANEL}
STAIRS = {STAIR_UP, STAIR_DOWN}
MARGIN = 0.30

NUM_FLOORS = 4
FLOOR_NAMES = ['1층', 'B1', 'B2', 'B3']
START_FLOOR = 2
START_POS = (8.5, 19.5)  # B2 객실

# 열쇠 / 조사 ─ 좌표는 (floor, x, y)
KEY_HIDDEN_AT = {(2, 6, 19), (1, 38, 11), (3, 7, 11), (2, 29, 4)}

SEARCH_LORE = {
    (2, 6, 19): '객실 사물함 안쪽에서 열쇠를 찾음.\n이름표에는 \'승객 14번\'이라고 적혀 있음.',
    (1, 38, 11): '식당 사물함 바닥에서 열쇠 발견.\n접시 위에는 먹다 만 음식이 그대로 남아 있음.\n예비 열쇠로 쓸 만함.',
    (3, 7, 11): '보일러실 사물함을 뒤짐.\n기름 묻은 열쇠가 공구 밑에 깔려 있었음.',
    (2, 29, 4): '실험실 패널 뒤에서 열쇠 발견.\n손잡이에 말라붙은 손자국이 남아 있음.',
}

SEARCH_EMPTY = [
    '아무것도 없음', '먼지뿐임', '누군가 먼저 뒤진 흔적',
    '오래된 기록이 있으나 읽을 수 없음', '손자국이 남아 있음', '차갑고 텅 비어 있음',
]

# 벤트 (floor, x, y)
VENT_TILES = [(3, 9, 19), (2, 29, 8)]
VENT_TRIGGER_RADIUS = 1.6
VENT_FILL_RATE_PER_MS = 100 / 90000.0  # 벤트 하나당 90초에 100% (맵이 커져서 완화)
FLOOD_GURGLE_INTERVAL = (2200, 4200)

DOOR_OPEN_RADIUS = 1.35
DOOR_CLOSE_DELAY = 1100.0
DOOR_ANIM_MS = 320.0

# ── 계단통 ─────────────────────────────────────────────
# up/down: 계단 타일 좌표(층 공통), arrive: 계단 타일에서 도착 지점까지의 오프셋,
# links[i]: 층 i ↔ 층 i+1 연결 상태
STAIRWELLS = {
    'S1': dict(up=(3, 15), down=(3, 16), floor=[(4, 15), (4, 16)], arrive=(1, 0),
               links=['normal', 'blocked', 'normal']),    # 여객선 선미(왼쪽 끝)
    'S2': dict(up=(34, 13), down=(35, 13), floor=[(34, 14), (35, 14)], arrive=(0, 1),
               links=['blocked', 'normal', 'collapse']),  # 여객선 중앙부 북쪽
    'S3': dict(up=(24, 2), down=(25, 2), floor=[(24, 3), (25, 3)], arrive=(0, 1),
               links=['normal', 'normal', 'blocked']),    # 화물선 북쪽 끝
    'S4': dict(up=(24, 29), down=(25, 29), floor=[(24, 28), (25, 28)], arrive=(0, -1),
               links=['normal', 'blocked', 'normal']),    # 화물선 남쪽 끝
}

STAIR_AT = {}  # (x, y) -> (stairwell id, 'up' | 'down')
for _sid, _s in STAIRWELLS.items():
    STAIR_AT[_s['up']] = (_sid, 'up')
    STAIR_AT[_s['down']] = (_sid, 'down')


def default_links():
    return {sid: list(s['links']) for sid, s in STAIRWELLS.items()}


def stair_destination(sid, direction, floor):
    """계단을 탈 때의 (목적 층, 연결 인덱스, 도착 x, 도착 y). 갈 수 없으면 None."""
    s = STAIRWELLS[sid]
    if direction == 'down':
        if floor >= NUM_FLOORS - 1:
            return None
        link_idx, dest = floor, floor + 1
        src = s['down']
        dst = s['up']       # 아래층에서는 '위로' 타일 옆에 도착
    else:
        if floor <= 0:
            return None
        link_idx, dest = floor - 1, floor - 1
        src = s['up']
        dst = s['down']     # 위층에서는 '아래로' 타일 옆에 도착
    ax, ay = s['arrive']
    return dest, link_idx, dst[0] + ax + 0.5, dst[1] + ay + 0.5


def build_floors(links=None):
    """(maps, room_bounds) — 층별 2차원 맵과 방 영역 목록을 만든다."""
    links = links or default_links()
    maps = [[[WALL] * MAP_W for _ in range(MAP_H)] for _ in range(NUM_FLOORS)]
    bounds = [[] for _ in range(NUM_FLOORS)]

    def fill(f, x1, y1, x2, y2, t):
        for y in range(y1, y2 + 1):
            for x in range(x1, x2 + 1):
                if 0 <= y < MAP_H and 0 <= x < MAP_W:
                    maps[f][y][x] = t

    def set_(f, x, y, t):
        if 0 <= x < MAP_W and 0 <= y < MAP_H:
            maps[f][y][x] = t

    def room(f, name, x1, y1, x2, y2, door=None):
        fill(f, x1, y1, x2, y2, FLOOR)
        bounds[f].append((name, x1, x2, y1, y2))
        if door:
            set_(f, door[0], door[1], DOOR)

    # 방 배치 도우미 — 문 위치는 복도와 맞닿는 벽 한가운데
    def pn(f, name, x1, x2):  # 여객선 북쪽 방 (y 10~13, 문 y=14)
        room(f, name, x1, 10, x2, 13, ((x1 + x2) // 2, 14))

    def ps(f, name, x1, x2):  # 여객선 남쪽 방 (y 18~21, 문 y=17)
        room(f, name, x1, 18, x2, 21, ((x1 + x2) // 2, 17))

    def cw(f, name, y1, y2):  # 화물선 서쪽 방 (x 19~22, 문 x=23)
        room(f, name, 19, y1, 22, y2, (23, (y1 + y2) // 2))

    def ce(f, name, y1, y2):  # 화물선 동쪽 방 (x 27~30, 문 x=26)
        room(f, name, 27, y1, 30, y2, (26, (y1 + y2) // 2))

    def passenger_corridor(f):
        fill(f, 3, 15, 46, 16, FLOOR)

    def cargo_corridor(f):
        fill(f, 24, 2, 25, 29, FLOOR)

    def bulkheads(f, east_door=DOOR):
        for y in range(10, 22):
            set_(f, 18, y, WALL)
            set_(f, 31, y, WALL)
        set_(f, 18, 15, DOOR)
        set_(f, 31, 15, east_door)

    def junction(f):
        fill(f, 19, 10, 30, 21, FLOOR)
        bounds[f].append(('junction', 19, 30, 10, 21))

    def crush(f, rects):
        for x1, y1, x2, y2 in rects:
            fill(f, x1, y1, x2, y2, WALL)

    # ══ 1층 (갑판) ══════════════════════════════════════
    f = 0
    fill(f, 3, 10, 38, 21, FLOOR)            # 여객선 갑판
    fill(f, 19, 2, 30, 29, FLOOR)            # 화물선 갑판
    # 중앙 로비 상자
    fill(f, 10, 13, 14, 18, WALL)
    fill(f, 11, 14, 13, 17, FLOOR)
    set_(f, 12, 18, DOOR)
    set_(f, 11, 14, CABINET)
    bounds[f].append(('lobby', 11, 13, 14, 17))
    # 화물 컨테이너(벽) — 갑판 장애물
    for x1, y1, x2, y2 in [(20, 5, 22, 7), (27, 4, 29, 6), (20, 24, 22, 26), (27, 24, 29, 27),
                           (5, 11, 8, 12), (5, 19, 8, 20), (30, 11, 33, 12)]:
        fill(f, x1, y1, x2, y2, WALL)
    # 충돌 지점(균열)
    set_(f, 22, 11, CRACK); set_(f, 27, 20, CRACK); set_(f, 30, 15, CRACK)
    for x in (31, 32):
        set_(f, x, 15, PIPE)
    # 선수 비상 부이 발사실
    for y in range(10, 22):
        set_(f, 39, y, WALL)
    set_(f, 39, 15, LOCKED)
    room(f, 'buoy', 40, 11, 46, 20)
    for y in range(14, 18):
        set_(f, 45, y, CONSOLE)
    bounds[f].append(('junction', 19, 30, 10, 21))

    # ══ B1 ═════════════════════════════════════════════
    f = 1
    passenger_corridor(f); cargo_corridor(f); junction(f)
    pn(f, 'power', 6, 11); pn(f, 'special', 13, 17); pn(f, 'dining', 37, 46)
    ps(f, 'laundry', 3, 9); ps(f, 'storage', 11, 17)
    ps(f, 'lounge', 32, 39); ps(f, 'restroom', 41, 46)
    cw(f, 'chem', 2, 5); cw(f, 'hold_a', 6, 9); ce(f, 'powder', 2, 5); ce(f, 'hold_b', 6, 9)
    cw(f, 'hold_c', 22, 25); cw(f, 'hold_d', 26, 29); ce(f, 'hold_e', 22, 25); ce(f, 'hold_f', 26, 29)
    bulkheads(f)
    # 가구/수색 대상
    set_(f, 38, 11, LOCKER); set_(f, 40, 11, CABINET)
    set_(f, 7, 11, PANEL); set_(f, 14, 11, BED); set_(f, 15, 11, BED)
    set_(f, 34, 20, BED); set_(f, 35, 20, BED)
    set_(f, 20, 3, CABINET); set_(f, 29, 3, PANEL)
    set_(f, 24, 12, CRACK)

    # ══ B2 ═════════════════════════════════════════════
    f = 2
    passenger_corridor(f); cargo_corridor(f); junction(f)
    pn(f, 'cabin_n1', 6, 11); pn(f, 'cabin_n2', 13, 17); pn(f, 'cabin_n3', 37, 46)
    ps(f, 'cabin', 6, 11); ps(f, 'cabin_s2', 13, 17)
    ps(f, 'cabin_s3', 32, 38); ps(f, 'cabin_s4', 40, 46)
    room(f, 'cctv', 19, 2, 22, 5, (23, 3)); room(f, 'isolation', 19, 6, 22, 9, (23, 7))
    room(f, 'lab', 27, 2, 30, 9, (26, 5))
    room(f, 'drug', 19, 22, 22, 25, (23, 23)); room(f, 'lab_south', 27, 22, 30, 29, (26, 25))
    cw(f, 'storage_c', 26, 29)
    bulkheads(f)
    crush(f, [(19, 10, 22, 12), (26, 10, 30, 13), (19, 18, 21, 21), (26, 18, 30, 20)])
    set_(f, 6, 19, LOCKER)
    set_(f, 6, 21, BED); set_(f, 7, 21, BED); set_(f, 10, 21, BED); set_(f, 11, 21, BED)
    set_(f, 8, 17, LOCKED)                      # 시작 객실 문
    for x in (6, 7, 15, 16, 38, 39):
        set_(f, x, 10, BED)
    set_(f, 13, 18, LOCKER); set_(f, 46, 10, LOCKER)
    set_(f, 29, 4, PANEL); set_(f, 20, 3, CONSOLE); set_(f, 21, 3, CONSOLE)
    set_(f, 20, 23, CABINET); set_(f, 20, 8, PANEL)
    set_(f, 29, 8, VENT)
    set_(f, 24, 14, CRACK); set_(f, 25, 19, CRACK)

    # ══ B3 ═════════════════════════════════════════════
    f = 3
    passenger_corridor(f); cargo_corridor(f); junction(f)
    pn(f, 'boiler', 6, 11); pn(f, 'control', 13, 17); pn(f, 'cabin_n3', 37, 46)
    ps(f, 'pump', 3, 17)
    ps(f, 'engine', 32, 46)
    room(f, 'cargo_engine', 27, 2, 30, 9, (26, 5)); room(f, 'reactor', 19, 2, 22, 9, (23, 5))
    room(f, 'hold_g', 19, 22, 22, 29, (23, 25)); room(f, 'hold_h', 27, 22, 30, 29, (26, 25))
    bulkheads(f)
    crush(f, [(19, 10, 23, 13), (27, 10, 30, 12), (19, 17, 22, 21), (27, 19, 30, 21)])
    set_(f, 7, 11, LOCKER)
    set_(f, 15, 14, LOCKED)                     # 제어실 문
    for x in range(14, 17):
        set_(f, x, 11, CONSOLE)
    set_(f, 14, 12, CONSOLE); set_(f, 16, 12, CONSOLE)
    set_(f, 9, 19, VENT)
    for x in range(34, 45):
        set_(f, x, 19, PIPE)
    set_(f, 24, 12, CRACK); set_(f, 25, 18, CRACK)

    # ── 계단 타일 ───────────────────────────────────────
    for sid, s in STAIRWELLS.items():
        for f in range(NUM_FLOORS):
            for (x, y) in s['floor']:
                if maps[f][y][x] == WALL:
                    set_(f, x, y, FLOOR)
            ux, uy = s['up']
            dx_, dy_ = s['down']
            if f > 0:
                set_(f, ux, uy, RUBBLE if links[sid][f - 1] == 'blocked' else STAIR_UP)
            else:
                set_(f, ux, uy, WALL)
            if f < NUM_FLOORS - 1:
                set_(f, dx_, dy_, RUBBLE if links[sid][f] == 'blocked' else STAIR_DOWN)
            else:
                set_(f, dx_, dy_, WALL)

    return maps, bounds


ROOM_NAMES_KR = {
    'corridor': '통로', 'junction': '합체 구간', 'lobby': '로비', 'buoy': '비상 부이 발사실',
    'power': '배전실', 'special': '특실', 'dining': '식당', 'laundry': '세탁실', 'storage': '창고',
    'lounge': '휴게실', 'restroom': '화장실',
    'chem': '약품 창고', 'powder': '화약고',
    'hold_a': '화물칸', 'hold_b': '화물칸', 'hold_c': '화물칸', 'hold_d': '화물칸',
    'hold_e': '화물칸', 'hold_f': '화물칸', 'hold_g': '화물칸', 'hold_h': '화물칸',
    'cabin': '객실 14호', 'cabin_n1': '객실', 'cabin_n2': '객실', 'cabin_n3': '객실',
    'cabin_s2': '객실', 'cabin_s3': '객실', 'cabin_s4': '객실',
    'cctv': 'CCTV실', 'isolation': '격리실', 'lab': '실험체 보관실', 'drug': '약품실',
    'lab_south': '실험실', 'storage_c': '창고',
    'boiler': '보일러실', 'control': '제어실', 'pump': '배수 펌프실', 'engine': '기관실',
    'cargo_engine': '화물선 기관실', 'reactor': '반응로실',
}


def floor_depth(floor):
    """HUD용 수심: 층이 내려갈수록 조금씩 깊어진다."""
    return 5980 + floor * 6


def get_room(bounds, floor, px, py):
    x, y = int(math.floor(px)), int(math.floor(py))
    for name, x1, x2, y1, y2 in bounds[floor]:
        if x1 <= x <= x2 and y1 <= y <= y2:
            return name
    return 'corridor'


# ── 환각 이벤트 ('flood' 이벤트는 "사실은 그냥 바닥"이라는 가짜 환각) ──
HAL_EVENTS = [
    dict(id='voices', trigger_room='lounge', sanity_drain=10,
         messages=['...여기 있었네...', '...승객 명단에서 이름이 지워짐...', '다들 아래로 내려갔음...']),
    dict(id='mirror', trigger_room='special', sanity_drain=15,
         messages=['거울 속에 누가 서 있음', '움직이지 않았는데—', '거울 속 모습이 먼저 돌아봄']),
    dict(id='flood', trigger_room='engine', sanity_drain=20,
         messages=['물이...', '바닥에 물이 차고 있음', '아니—그냥 바닥임. 진짜로.']),
    dict(id='creature', trigger_room='lab', sanity_drain=30,
         messages=['유리 너머에—', '아무것도 없음. 당연히.', '이 배에 실린 건 화물뿐임.']),
]
CRACK_EVENT = dict(id='crack_whisper', sanity_drain=5,
                    messages=['균열이 속삭임', '여기서 나가야 함', '...왜 왔나...'])


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
        # 키는 (floor, x, y). 침수 수위는 선체 전체 공통이다.
        self.vents = {pos: {'triggered': False, 'level': 0.0, 'gurgle_timer': 0.0} for pos in VENT_TILES}
        self.flood_level = 0.0

    def update(self, dt, px, py, floor=0, on_trigger=None, on_gurgle=None, rng=None):
        import random as _r
        rng = rng or _r
        any_active = False
        for (vf, vx, vy), v in self.vents.items():
            if not v['triggered'] and vf == floor:
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
    if t == LOCKED or t == RUBBLE:
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
    return t in (WALL, LOCKED, DOOR, RUBBLE)


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


def get_nearby_stairs(game_map, px, py):
    """가까운 계단 타일 (tx, ty, 'up'|'down') — 없으면 None."""
    best = None
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            tx, ty = int(math.floor(px)) + dx, int(math.floor(py)) + dy
            if tx < 0 or tx >= MAP_W or ty < 0 or ty >= MAP_H:
                continue
            t = game_map[ty][tx]
            if t not in STAIRS:
                continue
            dist = math.hypot(px - (tx + 0.5), py - (ty + 0.5))
            if dist < 1.5 and (best is None or dist < best[0]):
                best = (dist, tx, ty, 'up' if t == STAIR_UP else 'down')
    return best[1:] if best else None
