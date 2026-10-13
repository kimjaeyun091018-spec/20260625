"""
다층 구조/계단 검증 (pygame 불필요).
  - 모든 층 크기/타일 일관성
  - 계단 쌍이 층 사이에서 정확히 대응되는가
  - 열쇠/잠긴 문 구조에서 '열쇠를 잘못 써서 갇히는' 일이 없는가
  - 비상 부이 발사실까지 도달 가능한가
  - 무너지는 계단을 지난 뒤에도 되돌아올 길이 있는가
"""
import os
import sys
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import game_logic as G

failures = 0


def check(name, cond):
    global failures
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures += 1


maps, bounds = G.build_floors()
check('4 floors', len(maps) == 4)
check('all floors same size', all(len(m) == G.MAP_H and all(len(r) == G.MAP_W for r in m) for m in maps))

# 1. 계단 타일 개수/대응
for sid, s in G.STAIRWELLS.items():
    for i, link in enumerate(s['links']):
        down_t = maps[i][s['down'][1]][s['down'][0]]
        up_t = maps[i + 1][s['up'][1]][s['up'][0]]
        if link == 'blocked':
            check(f'{sid} link{i} blocked -> rubble on both floors', down_t == G.RUBBLE and up_t == G.RUBBLE)
        else:
            check(f'{sid} link{i} {link} -> stairs on both floors', down_t == G.STAIR_DOWN and up_t == G.STAIR_UP)
    # 도착 지점은 걸을 수 있는 칸
    for d in ('up', 'down'):
        for fl in range(4):
            dest = G.stair_destination(sid, d, fl)
            if dest is None:
                continue
            df, li, ax, ay = dest
            doors = G.Doors(maps[df])
            check(f'{sid} {d} from {G.FLOOR_NAMES[fl]} arrives on walkable tile',
                  G.can_move(maps[df], doors, ax, ay))

# 2. 도달성 (열쇠 그리디: 열 수 있는 문이 있고 열쇠가 남으면 연다)
START = (G.START_FLOOR, int(G.START_POS[0]), int(G.START_POS[1]))


def passable(f, x, y, opened):
    t = maps[f][y][x]
    if t in (G.WALL, G.RUBBLE) or t in (G.LOCKER, G.CABINET, G.PANEL):
        return False
    if t == G.LOCKED:
        return (f, x, y) in opened
    return True


def explore(links, opened, start):
    seen = {start}
    q = deque([start])
    mp, _ = G.build_floors(links)
    while q:
        f, x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < G.MAP_W and 0 <= ny < G.MAP_H:
                t = mp[f][ny][nx]
                ok = t not in (G.WALL, G.RUBBLE, G.LOCKER, G.CABINET, G.PANEL) and (t != G.LOCKED or (f, nx, ny) in opened)
                if ok and (f, nx, ny) not in seen:
                    seen.add((f, nx, ny)); q.append((f, nx, ny))
        t = mp[f][y][x]
        if t in G.STAIRS:
            sid, d = G.STAIR_AT[(x, y)]
            dest = G.stair_destination(sid, d, f)
            if dest and links[sid][dest[1]] != 'blocked':
                df, _, ax, ay = dest
                n = (df, int(ax), int(ay))
                if n not in seen:
                    seen.add(n); q.append(n)
    return seen, mp


def adjacent(seen, mp, kind_set):
    found = set()
    for (f, x, y) in seen:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < G.MAP_W and 0 <= ny < G.MAP_H and mp[f][ny][nx] in kind_set:
                    found.add((f, nx, ny))
    return found


links = G.default_links()
all_locked = {(f, x, y) for f in range(4) for y in range(G.MAP_H) for x in range(G.MAP_W) if maps[f][y][x] == G.LOCKED}

# 열쇠를 어떤 순서로 써도 갇히지 않으려면:
#  (a) 열쇠 수 >= 잠긴 문 수
#  (b) 첫 번째 문(시작 객실) 하나만 열면, 나머지 열쇠는 전부 다른 잠긴 문 없이 얻을 수 있어야 함
start_door = (G.START_FLOOR, 8, 17)
check('start room door is locked', start_door in all_locked)
seen0, mp0 = explore(links, set(), START)
check('before opening: only the start-room key is reachable',
      {k for k in adjacent(seen0, mp0, G.SEARCHABLE) if k in G.KEY_HIDDEN_AT} == {(2, 6, 19)})
seen1, mp1 = explore(links, {start_door}, START)
keys_after = {k for k in adjacent(seen1, mp1, G.SEARCHABLE) if k in G.KEY_HIDDEN_AT}
check('after start door: all keys reachable without any other locked door', keys_after == G.KEY_HIDDEN_AT)
check('keys >= locked doors', len(G.KEY_HIDDEN_AT) >= len(all_locked))

# 모든 문을 열었을 때의 전체 도달성
seen, mp = explore(links, all_locked, START)

def room_tiles(name):
    out = []
    for f in range(4):
        for rn, x1, x2, y1, y2 in bounds[f]:
            if rn == name:
                out += [(f, x, y) for x in range(x1, x2 + 1) for y in range(y1, y2 + 1) if maps[f][y][x] == G.FLOOR]
    return out

for rn in ('control', 'buoy', 'lab', 'dining', 'boiler', 'cabin'):
    ts = room_tiles(rn)
    check(f'room "{rn}" has floor tiles and is reachable', bool(ts) and any(t in seen for t in ts))

# 모든 잠긴 문은 목표 달성에 필수여야 한다(선택적인 문에 열쇠를 써서 막히는 일 방지)
def goal_ok(opened):
    sn, _ = explore(links, opened, START)
    return (any(t in sn for t in room_tiles('buoy')) and any(t in sn for t in room_tiles('control')))

for door in sorted(all_locked):
    check(f'locked door {door} is required for the goal', not goal_ok(all_locked - {door}))

# 3. 무너지는 계단: 지난 뒤 (S2 B2<->B3 차단) 도착 지점에서 시작 구역/발사실로 돌아갈 수 있는가
l2 = G.default_links(); l2['S2'][2] = 'blocked'
dest = G.stair_destination('S2', 'down', 2)
arr = (dest[0], int(dest[2]), int(dest[3]))
seen2, _ = explore(l2, all_locked, arr)
check('after collapse: can return to start cabin area', START in seen2)
check('after collapse: buoy room still reachable', any(t in seen2 for t in room_tiles('buoy')))
check('after collapse: control room still reachable', any(t in seen2 for t in room_tiles('control')))

# 4. 시작 상태: 막힌 계단 쪽으로는 못 간다
check('start on walkable tile', G.can_move(maps[START[0]], G.Doors(maps[START[0]]), *G.START_POS))

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
