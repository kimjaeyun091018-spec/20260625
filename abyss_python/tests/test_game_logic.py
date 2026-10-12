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

m = G.build_map()
doors = G.Doors(m)

# 1. map sanity: exactly 4 LOCKED tiles, 1 pre-placed DOOR
locked_count = sum(row.count(G.LOCKED) for row in m)
door_count = sum(row.count(G.DOOR) for row in m)
check('exactly 4 locked doors', locked_count == 4)
check('exactly 1 pre-placed open door', door_count == 1)
check('doors registry has 1 entry initially', len(doors.states) == 1)
check('pre-placed door starts closed', doors.states[(33, 20)]['state'] == 'closed')

# 2. collision: wall blocks, floor doesn't
check('wall blocks', G.tile_blocks(m, doors, 0, 0) is True)
check('floor open', G.tile_blocks(m, doors, 6, 5) is False or m[5][6] == G.CRACK)  # crack tile doesn't block movement
check('crack tile does not block movement', G.tile_blocks(m, doors, 6, 5) is False)
check('locked door blocks', G.tile_blocks(m, doors, 11, 5) is True)
check('furniture blocks movement', G.tile_blocks(m, doors, 5, 3) is True)

# 3. can_move AABB
check('can_move true in open floor', G.can_move(m, doors, 6.5, 6.5) is True)
check('can_move false into wall', G.can_move(m, doors, 0.5, 0.5) is False)

# 4. sight blocks: furniture no longer blocks sight, wall/door/locked do
check('furniture does not block sight', G.sight_blocks(m, 5, 3) is False)
check('wall blocks sight', G.sight_blocks(m, 0, 0) is True)
check('locked door blocks sight', G.sight_blocks(m, 11, 5) is True)
check('open door tile itself still sight-blocking type-wise', G.sight_blocks(m, 33, 20) is True)

# 5. line of sight: within room (crew room) no obstruction from furniture
los_room = G.has_line_of_sight(m, 6.5, 6.5, 5.5, 3.5)
check('LOS within room passes through furniture area', los_room is True)
los_wall = G.has_line_of_sight(m, 6.5, 6.5, 15.5, 6.5)  # crosses wall boundary x=11
check('LOS blocked by wall between rooms', los_wall is False)

# 6. door unlock flow simulation
key_count = 1
dk = G.get_nearby_locked_door(m, 10.3, 5.5)
check('locked door found near (10.3,5.5)', dk == (11, 5))
# simulate unlock: convert tile + register door open
dx, dy = dk
m[dy][dx] = G.DOOR
doors.register(dx, dy, initially_open=True)
key_count -= 1
check('key consumed', key_count == 0)
check('tile converted to DOOR', m[5][11] == G.DOOR)
check('door registered as open', doors.states[(11, 5)]['state'] == 'open')
check('door now passable', G.tile_blocks(m, doors, 11, 5) is False)
check('LOS still blocked through open door (horror design)',
      G.has_line_of_sight(m, 6.5, 5.5, 12.5, 5.5) is False)
check('no longer matched by get_nearby_locked_door after conversion',
      G.get_nearby_locked_door(m, 10.3, 5.5) is None)

# 7. door auto-close simulation: move far away, advance time
opened_events = []
closed_events = []
for _ in range(60):
    doors.update(50, px=2.0, py=2.0, on_open=lambda x,y: opened_events.append((x,y)),
                 on_close=lambda x,y: closed_events.append((x,y)))
check('door closed after player moved away + time passed', doors.states[(11,5)]['state'] == 'closed')
check('on_close callback fired exactly once', closed_events == [(11,5)])
check('door blocks movement again once closed', G.tile_blocks(m, doors, 11, 5) is True)

# 8. door re-opens when player approaches again
for _ in range(10):
    doors.update(50, px=11.5, py=5.5, on_open=lambda x,y: opened_events.append((x,y)))
check('door reopened on approach', doors.states[(11,5)]['state'] in ('opening','open'))

# 9. vent flooding simulation
fv = G.FloodVents()
triggered = []
gurgles = []
any_active = fv.update(16, 10.5, 3.5, on_trigger=lambda x,y: triggered.append((x,y)), on_gurgle=lambda i: gurgles.append(i))
check('vent triggers on proximity', triggered == [(10,3)])
check('any_active true once triggered', any_active is True)
for _ in range(200):
    fv.update(1000, 10.5, 3.5, on_gurgle=lambda i: gurgles.append(i))
check('flood level reaches 100 after enough time', fv.flood_level == 100.0)
check('gurgle callback fired multiple times over 200s', len(gurgles) > 10)

# 10. room detection + hallucination event mapping
check('room detection crew', G.get_room(6.5,6.5) == 'crew')
check('room detection control', G.get_room(18,5) == 'control')
check('room detection corridor fallback', G.get_room(12.5,5) == 'corridor')
evt = next((e for e in G.HAL_EVENTS if e['trigger_room']=='engine'), None)
check('engine room has fake-flood hallucination event', evt is not None and evt['id']=='flood')

# 11. searchable + key hidden
tk = G.get_nearby_searchable(m, 5.5, 3.5, searched_tiles=set())
check('nearby searchable finds locker', tk == (5,3))
check('key hidden at locker position', (5,3) in G.KEY_HIDDEN_AT)

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
