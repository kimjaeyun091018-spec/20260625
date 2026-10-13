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

# 10. 문 통과 판정: 문짝이 충분히 열리기 전에는 지나갈 수 없다 (그림과 판정 일치)
d2 = G.Doors(maps[1])
door_pos = next(iter(d2.states))
dpx, dpy = door_pos
check('closed door is not passable', d2.passable(dpx, dpy) is False)
d2.update(40, px=dpx + 0.5, py=dpy + 0.5)   # 열리기 시작 (anim 0.125)
check('barely-open door is not passable yet', d2.passable(dpx, dpy) is False)
for _ in range(10):
    d2.update(40, px=dpx + 0.5, py=dpy + 0.5)
check('fully opened door is passable', d2.passable(dpx, dpy) is True)
d3 = G.Doors(maps[1]); d3.update(160, px=dpx + 0.5, py=dpy + 0.5)   # anim 0.5
check('half-open door (anim 0.5) not passable', d3.states[door_pos]['anim'] < G.DOOR_PASS_ANIM and not d3.passable(dpx, dpy))
d3.update(100, px=dpx + 0.5, py=dpy + 0.5)   # anim > 0.7
check('door becomes passable once leaf is open enough', d3.passable(dpx, dpy) is True)

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
