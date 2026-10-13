import sys, math
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import game_logic as G

def check(name, cond):
    status = 'PASS' if cond else 'FAIL'
    print(f'[{status}] {name}')
    if not cond:
        global failures
        failures += 1

failures = 0

maps, bounds = G.build_floors()
B2 = G.START_FLOOR
m = maps[B2]
doors = G.Doors(m)

# 1. 맵 구성: 층별 잠긴 문 / 일반 문 개수
locked_total = sum(row.count(G.LOCKED) for mp in maps for row in mp)
check('exactly 3 locked doors across all floors', locked_total == 3)
check('4 hidden keys (1 spare)', len(G.KEY_HIDDEN_AT) == 4)
check('doors registry matches DOOR tiles on B2', len(doors.states) == sum(row.count(G.DOOR) for row in m))
check('doors start closed', all(d['state'] == 'closed' for d in doors.states.values()))

# 2. 충돌
check('wall blocks', G.tile_blocks(m, doors, 0, 0) is True)
check('start position is open', G.can_move(m, doors, *G.START_POS) is True)
check('locked door blocks (start room door)', G.tile_blocks(m, doors, 8, 17) is True)
check('locker blocks movement', G.tile_blocks(m, doors, 6, 19) is True)
check('bed does not block movement', G.tile_blocks(m, doors, 6, 21) is False)
check('crack tile does not block movement', G.tile_blocks(m, doors, 24, 14) is False)
check('rubble blocks movement', G.tile_blocks(maps[1], G.Doors(maps[1]), 3, 16) is True)
check('stairs are walkable', G.tile_blocks(maps[1], G.Doors(maps[1]), 3, 15) is False)
check('can_move false into wall', G.can_move(m, doors, 0.5, 0.5) is False)

# 3. 시야
check('wall blocks sight', G.sight_blocks(m, 0, 0) is True)
check('rubble blocks sight', G.sight_blocks(maps[1], 3, 16) is True)
check('locked door blocks sight', G.sight_blocks(m, 8, 17) is True)
check('furniture does not block sight', G.sight_blocks(m, 6, 19) is False)
check('LOS within start cabin', G.has_line_of_sight(m, 8.5, 19.5, 10.5, 20.5) is True)
check('LOS blocked by cabin wall', G.has_line_of_sight(m, 8.5, 19.5, 14.5, 19.5) is False)

# 4. 잠긴 문 해제 시뮬레이션
dk = G.get_nearby_locked_door(m, 8.5, 18.3)
check('locked door found next to start cabin door', dk == (8, 17))
dx, dy = dk
m[dy][dx] = G.DOOR
doors.register(dx, dy, initially_open=True)
check('tile converted to DOOR', m[17][8] == G.DOOR)
check('door now passable', G.tile_blocks(m, doors, 8, 17) is False)
check('no longer matched by get_nearby_locked_door', G.get_nearby_locked_door(m, 8.5, 18.3) is None)

# 5. 문 자동 닫힘 / 재개방
closed_events = []
for _ in range(60):
    doors.update(50, px=40.0, py=3.0, on_close=lambda x, y: closed_events.append((x, y)))
check('door closed after player left', doors.states[(8, 17)]['state'] == 'closed')
check('on_close fired once', closed_events == [(8, 17)])
for _ in range(10):
    doors.update(50, px=8.5, py=17.5)
check('door reopened on approach', doors.states[(8, 17)]['state'] in ('opening', 'open'))

# 6. 침수 벤트 (층 정보 포함)
fv = G.FloodVents()
triggered = []
gurgles = []
fv.update(16, 9.5, 19.5, floor=1, on_trigger=lambda x, y: triggered.append((x, y)))
check('vent does NOT trigger on a different floor', triggered == [])
any_active = fv.update(16, 9.5, 19.5, floor=3, on_trigger=lambda x, y: triggered.append((x, y)),
                       on_gurgle=lambda i: gurgles.append(i))
check('vent triggers on its own floor', triggered == [(9, 19)])
check('any_active true once triggered', any_active is True)
for _ in range(300):
    fv.update(1000, 9.5, 19.5, floor=3, on_gurgle=lambda i: gurgles.append(i))
check('single vent alone does not fully flood (flood needs both vents)', fv.flood_level <= 100.0)
for _ in range(300):
    fv.update(1000, 29.5, 8.5, floor=2)
check('flood level reaches 100 with both vents active', fv.flood_level == 100.0)
check('gurgle callback fired multiple times', len(gurgles) > 10)

# 7. 방 판정 / 환각 이벤트
check('room: start cabin', G.get_room(bounds, B2, 8.5, 19.5) == 'cabin')
check('room: control on B3', G.get_room(bounds, 3, 15, 11) == 'control')
check('room: corridor fallback', G.get_room(bounds, B2, 20.5, 15.5) in ('corridor', 'junction'))
check('room: lab on B2', G.get_room(bounds, 2, 28, 5) == 'lab')
check('room: buoy on 1F', G.get_room(bounds, 0, 42, 15) == 'buoy')
check('same coordinates differ per floor', G.get_room(bounds, 0, 8.5, 19.5) != 'cabin')
evt = next((e for e in G.HAL_EVENTS if e['trigger_room'] == 'engine'), None)
check('engine room has fake-flood hallucination event', evt is not None and evt['id'] == 'flood')

# 8. 조사 가능 대상 / 열쇠
tk = G.get_nearby_searchable(m, 7.5, 19.5, searched_tiles=set())
check('nearby searchable finds start-cabin locker', tk == (6, 19))
check('key hidden at start-cabin locker', (B2, 6, 19) in G.KEY_HIDDEN_AT)
check('every key tile is a searchable tile', all(maps[f][y][x] in G.SEARCHABLE for f, x, y in G.KEY_HIDDEN_AT))
check('every key has lore text', all(k in G.SEARCH_LORE for k in G.KEY_HIDDEN_AT))

# 9. 계단 탐지
st = G.get_nearby_stairs(maps[1], 4.5, 15.5)
check('stairs detected next to S1 on B1', st == (3, 15, 'up'))
check('no stairs detected in open floor', G.get_nearby_stairs(m, 8.5, 19.5) is None)

# 10. 문 통과 판정: 문짝이 실제로 가리는 영역만 막는다 (그림의 열린 틈 = 지나갈 수 있는 틈)
mp1 = maps[1]
d2 = G.Doors(mp1)
door_pos = next((p for p in d2.states if G.door_in_horizontal_wall(mp1, *p)), None)   # 좌우로 뻗은 벽의 문
dpx, dpy = door_pos
check('closed door blocks every point of its tile', all(G.tile_blocks(mp1, d2, dpx + fx, dpy + 0.5) for fx in (0.05, 0.5, 0.95)))
d2.states[door_pos]['anim'] = 0.5
d2.states[door_pos]['state'] = 'opening'
check('half-open: leaf-covered side (left) still blocks', G.tile_blocks(mp1, d2, dpx + 0.25, dpy + 0.5) is True)
check('half-open: open side (right) is passable', G.tile_blocks(mp1, d2, dpx + 0.75, dpy + 0.5) is False)
check('half-open: but body (width 0.6) cannot pass through the middle', not G.can_move(mp1, d2, dpx + 0.5, dpy + 0.5))
d2.states[door_pos]['anim'] = 0.85
check('85% open: player centered in the doorway fits', G.can_move(mp1, d2, dpx + 0.6, dpy + 0.5))
d2.states[door_pos]['anim'] = 1.0; d2.states[door_pos]['state'] = 'open'
check('fully open: any point passable', all(not G.tile_blocks(mp1, d2, dpx + fx, dpy + 0.5) for fx in (0.05, 0.5, 0.95)))
check('fully open: centered body fits', G.can_move(mp1, d2, dpx + 0.5, dpy + 0.5))
# 위아래로 뻗은 벽의 문(통로 좌우): 문짝이 위쪽 벽으로 밀려 들어간다
v_pos = next((p for p in d2.states if not G.door_in_horizontal_wall(mp1, *p)), None)
vx, vy = v_pos
d2.states[v_pos]['anim'] = 0.5; d2.states[v_pos]['state'] = 'opening'
check('vertical-wall door: covered side (top) blocks', G.tile_blocks(mp1, d2, vx + 0.5, vy + 0.25) is True)
check('vertical-wall door: open side (bottom) passable', G.tile_blocks(mp1, d2, vx + 0.5, vy + 0.75) is False)
# 접근하면 충분히 일찍 열려서 걷거나 달려도 문에 부딪혀 멈추지 않는다 (시험용 작은 맵)
def approach_stall_frames(speed):
    m = [[G.WALL] * G.MAP_W for _ in range(G.MAP_H)]
    for y in range(3, 18):
        for x in range(8, 13):
            m[y][x] = G.FLOOR
    for x in range(8, 13):
        m[10][x] = G.WALL
    m[10][10] = G.DOOR
    d = G.Doors(m)
    py, blocked = 15.5, 0
    for _ in range(300):
        d.update(33, px=10.5, py=py)
        nxt = py - speed * 0.033
        if G.can_move(m, d, 10.5, nxt):
            py = nxt
        else:
            blocked += 1
        if py < 8:
            break
    return blocked, py

blocked, end_y = approach_stall_frames(3.6)
check('walking into a door: never stalls and passes through', blocked == 0 and end_y < 8)
blocked, end_y = approach_stall_frames(6.12)
check('running into a door: at most one frame of delay and passes through', blocked <= 1 and end_y < 8)

# 11. 그림과 충돌 위치 일치 (스프라이트가 실제 위치에서 반 칸 어긋나 문 옆 벽을 지나는 것처럼 보이던 버그의 회귀 테스트)
TSZ = G.TS
for (ppx, ppy) in [(10.5, 14.5), (8.5, 19.5), (33.2, 7.9)]:
    cx, cy = G.camera_origin(ppx, ppy, 800, 560)
    ox, oy = G.sprite_origin(ppx, ppy, cx, cy)
    check(f'player ({ppx},{ppy}) is drawn at the exact screen center', abs((ox + TSZ / 2) - 400) < 1e-6 and abs((oy + TSZ / 2) - 280) < 1e-6)
# 문 칸 한가운데에 서 있으면, 스프라이트 상자는 정확히 그 문 타일 위에 겹쳐 그려진다
dtx, dty = 10, 14
cx, cy = G.camera_origin(dtx + 0.5, dty + 0.5, 800, 560)
tile_px = ((dtx - cx) * TSZ, (dty - cy) * TSZ)
sprite_px = G.sprite_origin(dtx + 0.5, dty + 0.5, cx, cy)
check('standing in a tile: sprite box coincides with that tile on screen',
      abs(tile_px[0] - sprite_px[0]) < 1e-6 and abs(tile_px[1] - sprite_px[1]) < 1e-6)
# 한 칸 오른쪽으로 가면 정확히 한 칸(TS px)만큼 타일 격자 위에서 움직인다
cx2, cy2 = G.camera_origin(dtx + 1.5, dty + 0.5, 800, 560)
t_next = ((dtx + 1 - cx2) * TSZ, (dty - cy2) * TSZ)
s_next = G.sprite_origin(dtx + 1.5, dty + 0.5, cx2, cy2)
check('one tile to the right: still aligned with the tile grid',
      abs(t_next[0] - s_next[0]) < 1e-6 and abs(t_next[1] - s_next[1]) < 1e-6)

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
