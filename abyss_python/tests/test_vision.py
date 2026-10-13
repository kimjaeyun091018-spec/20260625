"""
시야(Vision) 검증 — pygame 불필요.
  - 방 안에서는 그 방만 보인다 (문은 열려 있어도 시선을 막는다)
  - 문 위에 서 있으면 양쪽이 보인다
  - 창문은 시선을 통과시키며, 플레이어 위치/각도에 따라 보이는 범위가 달라진다
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import game_logic as G

failures = 0


def check(name, cond):
    global failures
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures += 1


maps, bounds = G.build_floors()
vis = [G.Vision(m) for m in maps]


def room_floor_tiles(f, name):
    out = set()
    for rn, x1, x2, y1, y2 in bounds[f]:
        if rn == name:
            out |= {(x, y) for x in range(x1, x2 + 1) for y in range(y1, y2 + 1) if maps[f][y][x] != G.WALL}
    return out


# 1. 시작 객실(B2): 방 전체가 보이고 복도/옆방은 안 보인다
B2 = 2
v = vis[B2].visible(8.5, 19.5)
cabin = room_floor_tiles(B2, 'cabin')
check('start cabin: entire room visible', all(t in v for t in cabin))
check('start cabin: nothing of the corridor visible', all((x, 15) not in v and (x, 16) not in v for x in range(3, 47)))
check('start cabin: neighbouring cabin hidden', not any(t in v for t in room_floor_tiles(B2, 'cabin_s2')))
check('start cabin: locked door tile drawn as edge', v.get((8, 17)) == 'edge')

# 2. 복도에서는 방 안이 안 보인다 (일반 문)
v = vis[B2].visible(10.5, 15.5)
check('corridor: sees its own corridor up to the bulkhead door', v.get((12, 15)) == 'own' and v.get((17, 16)) == 'own')
check('corridor: bulkhead door blocks the view of the junction', (21, 15) not in v)
check('corridor: cannot see inside cabins through doors', not any(t in v for t in room_floor_tiles(B2, 'cabin_n1')))

# 3. 문 위에 서면 양쪽이 보인다
v = vis[B2].visible(14.5, 14.5)  # cabin_n2 문 (15,14)? 문 타일 위치 확인 후 계산
door_tiles = [(x, 14) for x in range(3, 47) if maps[B2][14][x] == G.DOOR]
check('B2 has doors in the north wall row', len(door_tiles) >= 3)
dx, dy = door_tiles[0]
v = vis[B2].visible(dx + 0.5, dy + 0.5)
check('standing in a doorway: both corridor and room are visible',
      (dx, 15) in v and (dx, 13) in v)

# 4. 창문: B1 조리실 ↔ 식당
B1 = 1
check('kitchen and dining windows exist', maps[B1][11][41] == G.WINDOW and maps[B1][12][41] == G.WINDOW)
v_dining = vis[B1].visible(45.5, 11.5)
kitchen = room_floor_tiles(B1, 'kitchen')
seen_k = {t for t in kitchen if v_dining.get(t) == 'window'}
check('dining: kitchen tiles visible through the window', len(seen_k) > 0)
check('kitchen tiles seen through the window are marked "window"', all(v_dining[t] == 'window' for t in seen_k))
check('dining: still sees all of the dining room as own',
      all(v_dining.get(t) == 'own' for t in room_floor_tiles(B1, 'dining') if maps[B1][t[1]][t[0]] != G.WALL))

# 각도: 벽 바로 옆(42.5,10.5)에서는 같은 높이의 칸(40,10)이 벽에 가려지고, 창문 높이의 칸은 보인다
v_edge = vis[B1].visible(42.5, 10.5)
check('angle: tile behind wall segment is hidden', (40, 10) not in v_edge or v_edge[(40, 10)] != 'window')
check('angle: tile behind the window opening is visible', v_edge.get((40, 12)) == 'window')
# 시야각이 위치에 따라 달라지는지 (두 위치의 보이는 조리실 타일 집합이 다르다)
v_mid = vis[B1].visible(42.5, 11.5)
set_edge = {t for t in kitchen if v_edge.get(t) == 'window'}
set_mid = {t for t in kitchen if v_mid.get(t) == 'window'}
check('different player positions see different parts of the kitchen', set_edge != set_mid)

# 반대편: 조리실에서 식당이 보인다
v_k = vis[B1].visible(38.5, 11.5)
check('kitchen: dining visible through the window', any(v_k.get(t) == 'window' for t in room_floor_tiles(B1, 'dining')))
check('kitchen: corridor is NOT visible (door blocks)', not any((x, 15) in v_k for x in range(30, 47)))

# 5. 복도 쪽 창: B3 제어실을 문(잠김)이 아니라 창문으로 들여다볼 수 있다
B3 = 3
check('control room windows next to the locked door',
      maps[B3][14][14] == G.WINDOW and maps[B3][14][16] == G.WINDOW and maps[B3][14][15] == G.LOCKED)
v = vis[B3].visible(14.5, 15.5)
control = room_floor_tiles(B3, 'control')
check('corridor: sees part of the control room through the window', any(v.get(t) == 'window' for t in control))
check('corridor: does not see the whole control room (angle limited)', not all(v.get(t) == 'window' for t in control))
v_far = vis[B3].visible(30.5, 15.5)
check('far down the corridor: control room hidden', not any(v_far.get(t) == 'window' for t in control))

# 6. 창문은 이동은 막는다
check('window blocks movement', G.tile_blocks(maps[B1], G.Doors(maps[B1]), 41, 11) is True)
check('window does not block sight', G.sight_blocks(maps[B1], 41, 11) is False)

# 7. 창문 없는 층/방에서는 추가 계산이 없다
v = vis[B2].visible(8.5, 19.5)
check('no windows in view: only own/edge kinds', set(v.values()) <= {'own', 'edge'})

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
