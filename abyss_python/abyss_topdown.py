#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ABYSS — 심연 (Python / pygame 포트)

원작: abyss_topdown.html (HTML5 Canvas + Web Audio API)
이 파일은 그 게임을 pygame으로 이식한 버전입니다. 로직(맵/충돌/시야/문/침수)은
game_logic.py 에, 효과음 합성은 sound_synth.py 에 있고, 이 파일은 그 둘을 이용해
창을 띄우고 입력을 받아 렌더링/재생을 담당합니다.

실행 방법:
    pip install pygame numpy
    python3 abyss_topdown.py

조작:
    WASD / 방향키  이동
    Space          달리기
    E              조사 / 잠긴 문에 열쇠 사용
    Esc            종료
"""
import os
import sys
import math
import random
import time as _time

import numpy as np
import pygame

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_logic as GL
import sound_synth as SS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSET_DIR = os.path.join(BASE_DIR, 'assets')

TS = GL.TS
MAP_W, MAP_H = GL.MAP_W, GL.MAP_H

# ══════════════════════════════════════════════════════════
# pygame 초기화
# 오디오 장치가 없는 환경(일부 서버/컨테이너 등)에서도 게임 자체는 실행되도록,
# 믹서 초기화 실패를 잡아내고 AUDIO_OK=False면 모든 사운드 재생을 조용히 건너뛴다.
# ══════════════════════════════════════════════════════════
AUDIO_OK = True
try:
    pygame.mixer.pre_init(frequency=SS.SR, size=-16, channels=2, buffer=512)
    pygame.init()
    if not pygame.mixer.get_init():
        AUDIO_OK = False
    else:
        pygame.mixer.set_num_channels(24)
except Exception as e:
    print(f'[경고] 오디오 장치를 초기화하지 못했습니다 — 소리 없이 계속 진행합니다. ({e})')
    AUDIO_OK = False
    try:
        pygame.init()
    except Exception:
        pass

# 가상 화면(VNC)으로 볼 때는 창이 작을수록, 프레임 수가 낮을수록 훨씬 부드럽다.
# 필요하면 환경변수로 조절: ABYSS_W=1000 ABYSS_H=700 ABYSS_FPS=60 python3 abyss_topdown.py
WIN_W = int(os.environ.get('ABYSS_W', 800))
WIN_H = int(os.environ.get('ABYSS_H', 560))
TARGET_FPS = int(os.environ.get('ABYSS_FPS', 30))
screen = pygame.display.set_mode((WIN_W, WIN_H), pygame.RESIZABLE)
pygame.display.set_caption('ABYSS — 심연')
clock = pygame.time.Clock()

FONT_PATH = os.path.join(ASSET_DIR, 'font_kr.ttf')


def load_font(size):
    if os.path.exists(FONT_PATH):
        return pygame.font.Font(FONT_PATH, size)
    return pygame.font.SysFont('malgungothic,applegothic,notosanscjk,sans', size)


FONT_SM = load_font(11)
FONT_MD = load_font(13)
FONT_LG = load_font(16)
FONT_XL = load_font(34)

random.seed()


# ══════════════════════════════════════════════════════════
# 사운드: 미리 합성 후 풀에 저장 (매번 새로 만들지 않아 성능 안정적)
# ══════════════════════════════════════════════════════════
def _mk(arr):
    return pygame.sndarray.make_sound(np.ascontiguousarray(arr))


SOUNDS = {}
WHISPER_AMBIENCE = None
AMBIENCE_CHANNEL = None

if AUDIO_OK:
    try:
        print('사운드 합성 중...')
        SOUNDS = {
            'glass_crack': [_mk(SS.glass_crack(0.7)) for _ in range(3)],
            'door_thud': [_mk(SS.door_thud()) for _ in range(2)],
            'key_found': [_mk(SS.key_found())],
            'crack_whisper': [_mk(SS.crack_whisper())],
            'whisper_burst': [_mk(SS.whisper_burst(0.5)) for _ in range(6)],
            'footstep_walk': [_mk(SS.footstep(False)) for _ in range(6)],
            'footstep_run': [_mk(SS.footstep(True)) for _ in range(6)],
            'door_open': [_mk(SS.door_open())],
            'door_close': [_mk(SS.door_close())],
            'phantom_steps': [_mk(SS.phantom_footstep_group(0.6)) for _ in range(5)],
            'vent_burst': [_mk(SS.vent_burst())],
            'flood_gurgle': [_mk(SS.flood_gurgle(0.5)) for _ in range(5)],
        }
        WHISPER_AMBIENCE = _mk(SS.whisper_ambience_loop())
        AMBIENCE_CHANNEL = pygame.mixer.Channel(0)
        print('완료.')
    except Exception as e:
        print(f'[경고] 사운드 합성/초기화 중 오류가 발생해 소리 없이 계속 진행합니다. ({e})')
        AUDIO_OK = False
        SOUNDS = {}
        WHISPER_AMBIENCE = None
        AMBIENCE_CHANNEL = None


def sfx(name):
    if not AUDIO_OK or name not in SOUNDS:
        return
    random.choice(SOUNDS[name]).play()


def sfx_panned(name, pan):
    if not AUDIO_OK or name not in SOUNDS:
        return
    snd = random.choice(SOUNDS[name])
    ch = snd.play()
    if ch:
        left = min(1.0, 1.0 - max(0.0, pan))
        right = min(1.0, 1.0 + min(0.0, pan))
        ch.set_volume(left, right)


# ══════════════════════════════════════════════════════════
# 스프라이트 로드 + 청록색 다이빙수트 톤으로 보정(원본 HTML의 CSS 필터 효과를 재현)
# ══════════════════════════════════════════════════════════
FRAME_W = FRAME_H = 32
SPRITE_BBOX = (5, 7, 21, 24)  # x, y, w, h — 프레임 안의 실제 캐릭터 영역
IDLE_REST_FRAME = 0
IDLE_BLINK_FRAMES = [0, 1, 2, 3]
WALK_FRAMES = [4, 5, 6, 7, 8, 9, 10, 11]


def load_sprite_sheet():
    path = os.path.join(ASSET_DIR, 'sprite.png')
    raw = pygame.image.load(path).convert_alpha()
    # 다크 그레이스케일 캐릭터 -> 청록색 다이빙수트 톤으로 재채색
    arr = pygame.surfarray.pixels3d(raw).astype(np.float32)  # (w,h,3)
    alpha = pygame.surfarray.pixels_alpha(raw).astype(np.float32)
    lum = arr.mean(axis=2) / 255.0
    r = lum * 40
    g = 110 + lum * 110
    b = 150 + lum * 95
    out = pygame.Surface(raw.get_size(), pygame.SRCALPHA)
    out_arr = pygame.surfarray.pixels3d(out)
    out_arr[:, :, 0] = np.clip(r, 0, 255)
    out_arr[:, :, 1] = np.clip(g, 0, 255)
    out_arr[:, :, 2] = np.clip(b, 0, 255)
    del out_arr
    pygame.surfarray.pixels_alpha(out)[:, :] = alpha.astype(np.uint8)
    return out


SPRITE_SHEET = load_sprite_sheet()
SPRITE_FRAMES = []
bx, by, bw, bh = SPRITE_BBOX
for i in range(12):
    frame = pygame.Surface((bw, bh), pygame.SRCALPHA)
    frame.blit(SPRITE_SHEET, (0, 0), pygame.Rect(i * FRAME_W + bx, by, bw, bh))
    SPRITE_FRAMES.append(frame)


# ══════════════════════════════════════════════════════════
# 게임 상태
# ══════════════════════════════════════════════════════════
class Sprite:
    def __init__(self):
        self.state = 'idle'
        self.frame = IDLE_REST_FRAME
        self.facing_left = False
        self.idle_timer = 0.0
        self.blink_step = 0
        self.walk_idx = 0
        self.frame_timer_ms = 0.0
        self.fps = 16

    def update(self, moving, running, dt):
        frame_dur = 1000.0 / self.fps
        if moving:
            if self.state != 'walking':
                self.state = 'walking'; self.walk_idx = 0; self.frame_timer_ms = 0
            self.idle_timer = 0
            self.frame_timer_ms += dt * (2.0 if running else 1.0)
            while self.frame_timer_ms >= frame_dur:
                self.frame_timer_ms -= frame_dur
                self.walk_idx = (self.walk_idx + 1) % len(WALK_FRAMES)
            self.frame = WALK_FRAMES[self.walk_idx]
            return
        if self.state == 'walking':
            self.state = 'idle'; self.idle_timer = 0; self.frame = IDLE_REST_FRAME
            self.walk_idx = 0; self.frame_timer_ms = 0
            return
        if self.state == 'idle':
            self.idle_timer += dt
            self.frame = IDLE_REST_FRAME
            if self.idle_timer >= 3000:
                self.state = 'blinking'; self.blink_step = 0; self.frame_timer_ms = 0
            return
        if self.state == 'blinking':
            self.frame_timer_ms += dt
            if self.frame_timer_ms >= frame_dur:
                self.frame_timer_ms -= frame_dur
                self.blink_step += 1
                if self.blink_step >= len(IDLE_BLINK_FRAMES):
                    self.state = 'idle'; self.idle_timer = 0; self.frame = IDLE_REST_FRAME
                else:
                    self.frame = IDLE_BLINK_FRAMES[self.blink_step]


class Caption:
    __slots__ = ('text', 'kind', 'born')

    def __init__(self, text, kind, born):
        self.text, self.kind, self.born = text, kind, born


class Game:
    def __init__(self):
        self.reset()

    def reset(self):
        self.links = GL.default_links()          # 계단통 연결 상태(무너지면 갱신)
        self.maps, self.room_bounds = GL.build_floors(self.links)
        self.door_sets = [GL.Doors(m) for m in self.maps]
        self.visions = [GL.Vision(m) for m in self.maps]
        self.floor = GL.START_FLOOR
        self.flood = GL.FloodVents()
        self.sprite = Sprite()

        self.running = True
        self.player = {'x': GL.START_POS[0], 'y': GL.START_POS[1]}
        self.oxygen = 100.0
        self.sanity = 100.0
        self.depth = GL.floor_depth(self.floor)
        self.hallucinating = False
        self.visited_rooms = set()
        self.events_done = set()
        self.key_count = 0
        self.searched_tiles = set()
        self.locked_door_blink = {}
        self.interact_cooldown = 0.0
        self.interact_prompt = None
        self.footstep_timer = 0.0
        self.flicker = 0
        self.cam_shake = 0.0
        self.time_ms = 0.0
        self.captions = []
        self.hal_text = None
        self.hal_text_timer = 0
        self.timers = []  # [(fire_at_ms, callable)]
        self.ending = None
        self.ending_at = None
        self.oxy_accum = 0.0

    @property
    def map(self):
        return self.maps[self.floor]

    @property
    def doors(self):
        return self.door_sets[self.floor]

    @property
    def vision(self):
        return self.visions[self.floor]

    def add_caption(self, text, kind='sound'):
        self.captions.append(Caption(text, kind, self.time_ms))
        self.captions = self.captions[-6:]

    def schedule(self, delay_ms, fn):
        self.timers.append([self.time_ms + delay_ms, fn])

    def tick_timers(self):
        remaining = []
        for fire_at, fn in self.timers:
            if self.time_ms >= fire_at:
                fn()
            else:
                remaining.append([fire_at, fn])
        self.timers = remaining


GAME = Game()


# ══════════════════════════════════════════════════════════
# 환각 트리거
# ══════════════════════════════════════════════════════════
def trigger_hallucination(event_id, messages, sanity_drain):
    if event_id in GAME.events_done:
        return
    GAME.events_done.add(event_id)
    GAME.hallucinating = True
    GAME.sanity = max(0, GAME.sanity - sanity_drain)
    GAME.hal_text = messages[0]
    GAME.hal_text_timer = 150
    GAME.flicker = 14
    sfx('crack_whisper')

    def show_next(idx):
        if idx < len(messages):
            GAME.hal_text = messages[idx]
            GAME.hal_text_timer = 150
            GAME.schedule(1800, lambda: show_next(idx + 1))
        else:
            GAME.hal_text = None

    GAME.schedule(1800, lambda: show_next(1))


def check_room_events():
    room = GL.get_room(GAME.room_bounds, GAME.floor, GAME.player['x'], GAME.player['y'])
    visit_key = (GAME.floor, room)
    if visit_key not in GAME.visited_rooms:
        GAME.visited_rooms.add(visit_key)
        evt = next((e for e in GL.HAL_EVENTS if e['trigger_room'] == room), None)
        if evt:
            GAME.schedule(1500, lambda e=evt: trigger_hallucination(e['id'], e['messages'], e['sanity_drain']))
        name = GL.ROOM_NAMES_KR.get(room)
        if name and room != 'corridor':
            show_msg(f'[ {GL.FLOOR_NAMES[GAME.floor]} · {name} ]', 2000)

    tx, ty = int(GAME.player['x']), int(GAME.player['y'])
    if 0 <= ty < MAP_H and 0 <= tx < MAP_W and GAME.map[ty][tx] == GL.CRACK:
        crack_id = f'crack_{GAME.floor}_{tx}_{ty}'
        if crack_id not in GAME.events_done:
            GAME.events_done.add(crack_id)
            trigger_hallucination(crack_id, GL.CRACK_EVENT['messages'], GL.CRACK_EVENT['sanity_drain'])

    if room == 'dining' and 'dining_air' not in GAME.events_done:
        GAME.events_done.add('dining_air')

        def refill():
            GAME.oxygen = min(100, GAME.oxygen + 20)
            show_msg('비상 산소통 발견 · +20%', 2500)

        GAME.schedule(3000, refill)

    if room == 'control' and 'power_on' not in GAME.events_done:
        GAME.events_done.add('power_on')
        show_msg('비상 전원 복구 · 제어실 가동\n선수 쪽 비상 부이 발사 장치 사용 가능', 4500)
        GAME.add_caption('낮은 모터음과 함께 전등이 들어옴')
        GAME.flicker = 12

    if room == 'buoy':
        if 'power_on' in GAME.events_done:
            if 'escaped' not in GAME.events_done:
                GAME.events_done.add('escaped')
                show_msg('비상 부이 발사 시퀀스 가동 중...', 5000)
                GAME.schedule(5000, lambda: end_game('escape'))
        elif 'buoy_warn' not in GAME.events_done:
            GAME.events_done.add('buoy_warn')
            show_msg('발사 장치 전원 없음 — 제어실에서 비상 전원 복구 필요', 3500)


MSG_TEXT = ''
MSG_UNTIL = 0


def show_msg(text, duration=3000):
    global MSG_TEXT, MSG_UNTIL
    MSG_TEXT = text
    MSG_UNTIL = GAME.time_ms + duration


# ══════════════════════════════════════════════════════════
# 상호작용: 조사 / 잠긴 문
# ══════════════════════════════════════════════════════════
def do_search(tk):
    tk = (GAME.floor, tk[0], tk[1])   # 층 정보를 붙여서 층별로 구분
    if tk in GAME.searched_tiles:
        show_msg('이미 조사함', 1500)
        return
    GAME.searched_tiles.add(tk)
    GAME.flicker = 8
    GAME.cam_shake = 14
    if tk in GL.KEY_HIDDEN_AT:
        GAME.key_count += 1
        lore = GL.SEARCH_LORE.get(tk, '열쇠를 발견함.')
        show_msg(f'{lore}\n\n보유 열쇠: {GAME.key_count}개', 3500)
        sfx('glass_crack')
        GAME.add_caption('유리가 쨍그랑 깨짐')
        GAME.schedule(150, lambda: sfx('key_found'))
    else:
        show_msg(random.choice(GL.SEARCH_EMPTY), 2000)
        GAME.sanity = max(0, GAME.sanity - 2)


def try_unlock(door_key):
    if GAME.key_count <= 0:
        GAME.locked_door_blink[door_key] = 1
        show_msg('열쇠 없음 — 이 구역 어딘가를 조사할 것', 2800)
        GAME.cam_shake = 10
        sfx('door_thud')
        GAME.add_caption('잠긴 철문이 덜컹거림')
    else:
        GAME.key_count -= 1
        GAME.cam_shake = 8
        GAME.flicker = 10
        show_msg('열쇠 사용 · 문이 열림', 2000)
        sfx('door_open')
        GAME.add_caption('녹슨 철문이 삐걱대며 열림')
        dx, dy = door_key
        GAME.map[dy][dx] = GL.DOOR
        GAME.doors.register(dx, dy, initially_open=True)


def check_locked_bump(nx, ny):
    m = GL.MARGIN
    pts = [(nx - m, ny - m), (nx + m, ny - m), (nx - m, ny + m), (nx + m, ny + m),
            (nx, ny - m), (nx, ny + m), (nx - m, ny), (nx + m, ny)]
    for cx, cy in pts:
        tx, ty = int(math.floor(cx)), int(math.floor(cy))
        if tx < 0 or tx >= MAP_W or ty < 0 or ty >= MAP_H:
            continue
        if GAME.map[ty][tx] == GL.RUBBLE:
            dk = ('rubble', tx, ty)
            if not GAME.locked_door_blink.get(dk):
                GAME.locked_door_blink[dk] = 1
                GAME.cam_shake = 4
                show_msg('찌그러진 계단 — 잔해로 막혀 통과 불가', 2200)
            return
        if GAME.map[ty][tx] == GL.LOCKED:
            dk = (tx, ty)
            if not GAME.locked_door_blink.get(dk):
                GAME.locked_door_blink[dk] = 1
                GAME.cam_shake = 6
                sfx('door_thud')
                show_msg('잠겨 있음 — 가까이 가서 [ E ]로 열쇠 사용', 2400)
            return


def try_move(dx, dy):
    p = GAME.player
    nx, ny = p['x'] + dx, p['y'] + dy
    if dx != 0 and dy != 0 and GL.can_move(GAME.map, GAME.doors, nx, ny):
        p['x'], p['y'] = nx, ny
        return
    if dx != 0:
        if GL.can_move(GAME.map, GAME.doors, nx, p['y']):
            p['x'] = nx
        else:
            check_locked_bump(nx, p['y'])
    if dy != 0:
        if GL.can_move(GAME.map, GAME.doors, p['x'], ny):
            p['y'] = ny
        else:
            check_locked_bump(p['x'], ny)


def use_stairs(stair):
    """계단 이용. stair = (tx, ty, 'up'|'down'). 연결 상태에 따라 이동/막힘/붕괴 처리."""
    tx, ty, direction = stair
    sid, _ = GL.STAIR_AT[(tx, ty)]
    dest = GL.stair_destination(sid, direction, GAME.floor)
    if dest is None:
        return
    new_floor, link_idx, ax, ay = dest
    state = GAME.links[sid][link_idx]
    if state == 'blocked':
        show_msg('계단이 찌그러져 막혀 있음', 2000)
        return
    old_floor = GAME.floor
    GAME.floor = new_floor
    GAME.player['x'], GAME.player['y'] = ax, ay
    GAME.depth = GL.floor_depth(new_floor)
    GAME.locked_door_blink.clear()
    GAME.flicker = 6
    sfx('door_thud')
    GAME.add_caption('철제 계단에 발소리가 울림')
    show_msg(f'[ {GL.FLOOR_NAMES[new_floor]} ]', 1800)
    if state == 'collapse':
        # 지나간 직후 무너진다 — 양쪽 층의 계단 타일을 잔해로 바꾼다
        GAME.links[sid][link_idx] = 'blocked'
        s = GL.STAIRWELLS[sid]
        upper, lower = min(old_floor, new_floor), max(old_floor, new_floor)
        GAME.maps[upper][s['down'][1]][s['down'][0]] = GL.RUBBLE
        GAME.maps[lower][s['up'][1]][s['up'][0]] = GL.RUBBLE
        GAME.cam_shake = 20
        GAME.flicker = 14
        GAME.schedule(700, lambda: (sfx('door_thud'),
                                    GAME.add_caption('뒤에서 계단이 무너짐'),
                                    show_msg('계단이 무너짐 — 되돌아갈 수 없음', 3000)))


def get_interact_action():
    if GL.get_nearby_locked_door(GAME.map, GAME.player['x'], GAME.player['y']):
        return 'unlock'
    st = GL.get_nearby_stairs(GAME.map, GAME.player['x'], GAME.player['y'])
    if st:
        return 'stairs_up' if st[2] == 'up' else 'stairs_down'
    if GL.get_nearby_searchable(GAME.map, GAME.player['x'], GAME.player['y'], GAME.searched_tiles):
        return 'search'
    return None


# ══════════════════════════════════════════════════════════
# 엔딩
# ══════════════════════════════════════════════════════════
ENDING_MSGS = {
    'oxygen': ('질식', '산소 잔량 0%.\n호흡이 점점 얕아짐.\n\n마지막까지 송신 버튼을 눌렀으나\n응답 없음.\n\n이 배의 신호는 아무에게도 닿지 않았음.'),
    'insanity': ('광기', '벽 너머에서 누군가 이름을 부름.\n대답한 순간 모든 것이 조용해짐.\n\n수심 5,980m.\n그것을 본 이후 돌아온 사람은 없음.\n\n선원 명단에 한 줄이 늘어남.'),
    'flood': ('침수', '마지막 격벽이 무너짐.\n\n차가운 물이 복도를 따라 밀려들고\n불빛이 하나씩 꺼짐.\n\n수압에 눌린 선체의 비명.\n그리고 정적.'),
    'escape': ('탈출', '비상 부이 발사 성공.\n\n14시간 뒤 구조선 도착.\n담요와 따뜻한 차 한 잔.\n\n생존자 1명.\n그날 이후 바다 근처에는 다시 가지 않음.'),
}


def end_game(cause):
    if GAME.ending:
        return
    GAME.running = False
    GAME.ending = cause
    GAME.ending_at = _time.time()
    if AUDIO_OK:
        AMBIENCE_CHANNEL.stop()


# ══════════════════════════════════════════════════════════
# 메인 루프
# ══════════════════════════════════════════════════════════
def handle_door_open_cb(dx, dy):
    sfx('door_open')
    GAME.add_caption('문이 스르륵 열림')


def handle_door_close_cb(dx, dy):
    sfx('door_close')
    GAME.add_caption('문이 닫힘')


def handle_vent_trigger_cb(vx, vy):
    sfx('vent_burst')
    GAME.add_caption('배관이 터지며 물이 쏟아져 나옴')
    show_msg('바닥 벤트 파열 — 침수 시작', 3000)


def handle_flood_gurgle_cb(intensity):
    sfx('flood_gurgle')
    if random.random() < 0.35:
        GAME.add_caption('콸콸 — 물이 차오르는 소리')


def update(dt):
    GAME.time_ms += dt
    GAME.tick_timers()

    keys = pygame.key.get_pressed()
    running_key = keys[pygame.K_SPACE]
    base_tiles_per_sec = 3.6
    run_mult = 1.7 if running_key else 1.0
    spd = base_tiles_per_sec * run_mult * (dt / 1000.0)

    dx = dy = 0
    if keys[pygame.K_w] or keys[pygame.K_UP]:
        dy = -1
    if keys[pygame.K_s] or keys[pygame.K_DOWN]:
        dy = 1
    if keys[pygame.K_a] or keys[pygame.K_LEFT]:
        dx = -1
    if keys[pygame.K_d] or keys[pygame.K_RIGHT]:
        dx = 1
    if dx != 0 and dy != 0:
        dx *= 0.707; dy *= 0.707

    if dx < 0:
        GAME.sprite.facing_left = True
    elif dx > 0:
        GAME.sprite.facing_left = False

    moving = dx != 0 or dy != 0
    GAME.sprite.update(moving, running_key, dt)

    wdx, wdy = dx, dy
    if GAME.hallucinating and GAME.sanity < 50:
        strength = (50 - GAME.sanity) / 200.0
        wdx += (random.random() - 0.5) * strength
        wdy += (random.random() - 0.5) * strength

    try_move(wdx * spd, wdy * spd)

    if moving:
        GAME.footstep_timer -= dt
        if GAME.footstep_timer <= 0:
            sfx('footstep_run' if running_key else 'footstep_walk')
            GAME.footstep_timer = 230 if running_key else 340
    else:
        GAME.footstep_timer = 0

    if GAME.interact_cooldown > 0:
        GAME.interact_cooldown = max(0, GAME.interact_cooldown - dt)
    if keys[pygame.K_e] and GAME.interact_cooldown == 0:
        dk = GL.get_nearby_locked_door(GAME.map, GAME.player['x'], GAME.player['y'])
        if dk:
            try_unlock(dk)
            GAME.interact_cooldown = 500
        else:
            st = GL.get_nearby_stairs(GAME.map, GAME.player['x'], GAME.player['y'])
            if st:
                use_stairs(st)
                GAME.interact_cooldown = 700
            else:
                tk = GL.get_nearby_searchable(GAME.map, GAME.player['x'], GAME.player['y'], GAME.searched_tiles)
                if tk:
                    do_search(tk)
                    GAME.interact_cooldown = 500
    GAME.interact_prompt = get_interact_action()

    for k in list(GAME.locked_door_blink.keys()):
        GAME.locked_door_blink[k] += dt
        if GAME.locked_door_blink[k] > 1500:
            del GAME.locked_door_blink[k]

    GAME.doors.update(dt, GAME.player['x'], GAME.player['y'],
                       on_open=handle_door_open_cb, on_close=handle_door_close_cb)

    any_flood_active = GAME.flood.update(dt, GAME.player['x'], GAME.player['y'], floor=GAME.floor,
                                          on_trigger=handle_vent_trigger_cb,
                                          on_gurgle=handle_flood_gurgle_cb)
    if any_flood_active and GAME.flood.flood_level > 0:
        GAME.oxygen = max(0, GAME.oxygen - (GAME.flood.flood_level / 100.0) * 0.0005 * dt)

    if GAME.flood.flood_level >= 100 and 'flooded_out' not in GAME.events_done:
        GAME.events_done.add('flooded_out')
        end_game('flood')

    # 산소 소모 (0.5초마다 -0.4, 깊은 수심/환각 중 추가 소모) — 원본 500ms 인터벌을 dt 누적으로 재현
    GAME.oxy_accum += dt
    while GAME.oxy_accum >= 500:
        GAME.oxy_accum -= 500
        GAME.oxygen = max(0, GAME.oxygen - 0.1)   # 넓은 다층 맵에 맞춰 완화(약 8분 분량)
        if GAME.hallucinating:
            GAME.oxygen = max(0, GAME.oxygen - 0.05)
            GAME.sanity = max(0, GAME.sanity - 0.5)

    # 지속 웅얼거림 앰비언스: sanity에 따라 볼륨만 조절(실제 루프 재생은 한 번만 시작)
    intensity = max(0.0, (75 - GAME.sanity) / 75.0)
    if AUDIO_OK:
        if not AMBIENCE_CHANNEL.get_busy() and intensity > 0:
            AMBIENCE_CHANNEL.play(WHISPER_AMBIENCE, loops=-1)
        AMBIENCE_CHANNEL.set_volume(min(0.6, intensity * 0.6))

    # 정신력 낮을 때 확률적 속삭임 버스트 + 환청 발소리
    if GAME.sanity < 85:
        def_ = max(0, (85 - GAME.sanity) / 85.0)
        if random.random() < def_ * 0.004 * (dt / 16.0):
            pan = random.choice([-1, 1]) * (0.6 + random.random() * 0.4)
            sfx_panned('whisper_burst', pan)
            GAME.add_caption(random.choice(['희미한 속삭임이 들림', '누군가 속삭이는 소리', '귓가에 들리는 목소리']), 'halluc')
        if def_ > 0.15 and random.random() < def_ * 0.003 * (dt / 16.0):
            pan = random.choice([-1, 1]) * (0.6 + random.random() * 0.4)
            sfx_panned('phantom_steps', pan)
            GAME.add_caption(random.choice(['누군가의 발소리...', '복도에서 발소리가 들림', '뒤에서 발소리가 울림']), 'halluc')

    if GAME.cam_shake > 0:
        GAME.cam_shake -= 1
    if GAME.flicker > 0:
        GAME.flicker -= 1
    if GAME.hal_text_timer > 0:
        GAME.hal_text_timer -= 1

    check_room_events()

    if GAME.oxygen <= 0:
        end_game('oxygen')
    if GAME.sanity <= 0:
        end_game('insanity')


# ══════════════════════════════════════════════════════════
# 렌더링
# ══════════════════════════════════════════════════════════
TILE_BASE_COLOR = {
    GL.WALL: (10, 16, 22), GL.FLOOR: (14, 26, 36), GL.DOOR: (12, 24, 34),
    GL.CONSOLE: (8, 40, 50), GL.BED: (6, 24, 37), GL.PIPE: (8, 32, 44),
    GL.PORTHOLE: (0, 15, 25), GL.VENT: (4, 15, 24), GL.CRACK: (3, 8, 15),
    GL.LOCKED: (26, 8, 8), GL.LOCKER: (14, 28, 40), GL.CABINET: (14, 28, 40),
    GL.PANEL: (12, 24, 36),
    GL.STAIR_UP: (10, 28, 42), GL.STAIR_DOWN: (10, 28, 42), GL.RUBBLE: (16, 14, 12),
    GL.WINDOW: (8, 30, 44),
}


def get_tile_color(t, x, y, t_ms):
    base = TILE_BASE_COLOR.get(t, (0, 0, 0))
    if t == GL.FLOOR:
        n = (math.sin(x * 5.1 + y * 8.3 + t_ms * 0.001) * 0.5 + 0.5) * 8
        return (int(8 + n), int(20 + n), int(30 + n))
    if t == GL.CONSOLE:
        blink = math.sin(t_ms * 0.003 + x) > 0.5
        return (13, 80, 96) if blink else (4, 21, 32)
    if t == GL.LOCKED:
        pulse = math.sin(t_ms * 0.005) * 0.5 + 0.5
        return (int(20 + pulse * 8), 8, 8)
    return base


_SHADE_CACHE = {}
_VIS_CACHE = {'key': None, 'time': -9999.0, 'data': {}}


def _shade_surface(alpha):
    """타일 어둠 오버레이: 알파를 8단계로 양자화해서 한 번만 만들고 재사용."""
    alpha = min(255, (alpha + 4) // 8 * 8)
    s = _SHADE_CACHE.get(alpha)
    if s is None:
        s = pygame.Surface((TS, TS), pygame.SRCALPHA)
        s.fill((0, 0, 0, alpha))
        _SHADE_CACHE[alpha] = s
    return s


def _visible_tiles(px, py, t_ms):
    """플레이어에게 보이는 타일 {(x,y): 'own'|'edge'|'window'}.
    들어간 방(영역) 전체 + 창문 너머. 창문 시야는 플레이어가 조금 움직이거나 120ms 지나면 갱신."""
    c = _VIS_CACHE
    key = (GAME.floor, round(px * 4), round(py * 4))
    if c['key'] != key or t_ms - c['time'] > 120:
        c['key'], c['time'] = key, t_ms
        c['data'] = GAME.vision.visible(px, py)
    return c['data']


def draw_tiles(surf, cam_x, cam_y):
    start_x = int(math.floor(cam_x)) - 1
    start_y = int(math.floor(cam_y)) - 1
    end_x = start_x + math.ceil(surf.get_width() / TS) + 3
    end_y = start_y + math.ceil(surf.get_height() / TS) + 3
    t_ms = GAME.time_ms
    px, py = GAME.player['x'], GAME.player['y']
    light_r = 5 + (GAME.sanity / 100.0) * 3
    vis = _visible_tiles(px, py, t_ms)
    rect = pygame.draw.rect
    game_map = GAME.map

    for ty in range(max(0, start_y), min(MAP_H, end_y)):
        row = game_map[ty]
        for tx in range(max(0, start_x), min(MAP_W, end_x)):
            kind = vis.get((tx, ty))
            if kind is None:
                continue   # 지금 있는 방/창문 너머가 아니면 그리지 않는다(검은 배경)
            tile = row[tx]
            sx, sy = (tx - cam_x) * TS, (ty - cam_y) * TS
            rect(surf, get_tile_color(tile, tx, ty, t_ms), (sx, sy, TS, TS))
            draw_tile_decor(surf, tx, ty, tile, sx, sy, t_ms)

            # 방 안은 전부 보이되, 멀수록 은은하게 어두워진다(최대 약 60%).
            dist = math.hypot(tx + 0.5 - px, ty + 0.5 - py)   # 타일 중심 기준 거리
            d = min(1.0, max(0.0, (dist - light_r) / (light_r * 1.5)))
            alpha = int((d ** 1.5) * 150)
            if kind == 'window':
                alpha = min(215, 95 + alpha)   # 유리 너머는 한 단계 더 어둡고 흐리게
            if alpha > 0:
                surf.blit(_shade_surface(alpha), (sx, sy))


_CRACK_CACHE = {}
_RUBBLE_CACHE = {}


def _door_in_horizontal_wall(tx, ty):
    return GL.door_in_horizontal_wall(GAME.map, tx, ty)


def _draw_door_panel(surf, tx, ty, sx, sy, closed_len, fill, edge):
    """문짝을 타일 '전체 폭'으로 그린다(옆에 틈이 보이지 않게).
    closed_len: 문짝이 가리고 있는 길이(0=활짝 열림, TS=완전히 닫힘). 문짝은 벽 쪽으로 밀려 들어간다."""
    jamb = (12, 44, 62)
    if _door_in_horizontal_wall(tx, ty):
        if closed_len > 0.5:
            r = (sx, sy, closed_len, TS)
            pygame.draw.rect(surf, fill, r)
            pygame.draw.rect(surf, edge, r, 1)
            pygame.draw.line(surf, edge, (sx + closed_len - 5, sy + 6), (sx + closed_len - 5, sy + TS - 6), 1)
        pygame.draw.rect(surf, jamb, (sx, sy, 3, TS))
        pygame.draw.rect(surf, jamb, (sx + TS - 3, sy, 3, TS))
    else:
        if closed_len > 0.5:
            r = (sx, sy, TS, closed_len)
            pygame.draw.rect(surf, fill, r)
            pygame.draw.rect(surf, edge, r, 1)
            pygame.draw.line(surf, edge, (sx + 6, sy + closed_len - 5), (sx + TS - 6, sy + closed_len - 5), 1)
        pygame.draw.rect(surf, jamb, (sx, sy, TS, 3))
        pygame.draw.rect(surf, jamb, (sx, sy + TS - 3, TS, 3))


def _rubble_surface(tx, ty):
    """찌그러진 계단/잔해 타일: 좌표로 시드를 고정해 한 번만 그리고 재사용."""
    s = _RUBBLE_CACHE.get((tx, ty))
    if s is None:
        rnd = random.Random(tx * 131 + ty * 17)
        s = pygame.Surface((TS, TS))
        s.fill((16, 14, 12))
        for _ in range(9):
            x, y = rnd.randint(1, TS - 14), rnd.randint(1, TS - 12)
            w, h = rnd.randint(6, 16), rnd.randint(4, 12)
            g = 26 + rnd.randint(0, 22)
            pts = [(x, y + h), (x + rnd.randint(1, w // 2), y), (x + w, y + rnd.randint(0, h // 2)), (x + w - 2, y + h)]
            pygame.draw.polygon(s, (g, g - 4, g - 8), pts)
            pygame.draw.polygon(s, (8, 8, 8), pts, 1)
        # 휜 철제 난간
        pygame.draw.line(s, (60, 70, 76), (3, TS - 6), (TS - 8, 6), 2)
        pygame.draw.line(s, (40, 48, 54), (8, TS - 4), (TS - 4, 12), 2)
        _RUBBLE_CACHE[(tx, ty)] = s
    return s
_SEARCHED_SURF = []


def draw_tile_decor(surf, tx, ty, tile, sx, sy, t_ms):
    if tile == GL.BED:
        pygame.draw.rect(surf, (10, 37, 53), (sx + 6, sy + 10, TS - 12, TS - 20), 1)
    elif tile == GL.PIPE:
        pygame.draw.line(surf, (10, 32, 48), (sx, sy + TS / 2), (sx + TS, sy + TS / 2), 4)
    elif tile == GL.PORTHOLE:
        glow = math.sin(t_ms * 0.0015) * 0.15 + 0.1
        pygame.draw.circle(surf, (0, int(glow * 255), int(glow * 180)), (int(sx + TS / 2), int(sy + TS / 2)), int(TS * 0.38))
        pygame.draw.circle(surf, (10, 37, 53), (int(sx + TS / 2), int(sy + TS / 2)), int(TS * 0.42), 2)
        if GAME.sanity < 60:
            eye_a = max(0, (math.sin(t_ms * 0.001) * 0.3 + 0.5) * (1 - GAME.sanity / 60))
            c = (0, 255, 180)
            if eye_a > 0.02:
                s = pygame.Surface((TS, TS), pygame.SRCALPHA)
                pygame.draw.circle(s, (*c, int(eye_a * 255)), (int(TS / 2 - 5), int(TS / 2)), 4)
                pygame.draw.circle(s, (*c, int(eye_a * 255)), (int(TS / 2 + 5), int(TS / 2)), 4)
                surf.blit(s, (sx, sy))
    elif tile == GL.CRACK:
        a = int((0.4 + math.sin(t_ms * 0.003) * 0.2) * 255) // 16 * 16
        s = _CRACK_CACHE.get(a)
        if s is None:
            s = pygame.Surface((TS, TS), pygame.SRCALPHA)
            pygame.draw.lines(s, (13, 50, 70, a), False, [(TS * 0.2, TS * 0.3), (TS * 0.5, TS * 0.5), (TS * 0.4, TS * 0.7), (TS * 0.7, TS * 0.9)], 1)
            _CRACK_CACHE[a] = s
        surf.blit(s, (sx, sy))
    elif tile == GL.VENT:
        pygame.draw.rect(surf, (4, 10, 18), (sx + 4, sy + 4, TS - 8, TS - 8))
        for i in range(4):
            yy = sy + 4 + i * ((TS - 8) / 3)
            pygame.draw.line(surf, (8, 24, 42), (sx + 4, yy), (sx + TS - 4, yy), 1)
        vdat = GAME.flood.vents.get((GAME.floor, tx, ty))
        if vdat and vdat['triggered']:
            for i in range(3):
                phase = (t_ms * 0.006 + i * 2.1) % 1
                jx = sx + TS / 2 + math.sin(t_ms * 0.01 + i * 3) * 6
                jy = sy + TS - phase * TS * 1.3
                r = max(1, int(2.2 - phase * 1.2))
                a = int((1 - phase) * 0.6 * 255)
                s = pygame.Surface((r * 4, r * 4), pygame.SRCALPHA)
                pygame.draw.circle(s, (90, 190, 220, a), (r * 2, r * 2), r)
                surf.blit(s, (jx - r * 2, jy - r * 2))
    elif tile in (GL.STAIR_UP, GL.STAIR_DOWN):
        up = tile == GL.STAIR_UP
        for i in range(5):
            yy = sy + 6 + i * ((TS - 12) / 4)
            pygame.draw.line(surf, (20, 70, 90), (sx + 5, yy), (sx + TS - 5, yy), 2)
        cx, cy = sx + TS / 2, sy + TS / 2
        pts = [(cx, cy - 8), (cx - 8, cy + 4), (cx + 8, cy + 4)] if up else [(cx, cy + 8), (cx - 8, cy - 4), (cx + 8, cy - 4)]
        pygame.draw.polygon(surf, (74, 154, 176), pts, 2)
        sid_dir = GL.STAIR_AT.get((tx, ty))
        if sid_dir:
            link_idx = GAME.floor - 1 if up else GAME.floor
            if GAME.links[sid_dir[0]][link_idx] == 'collapse':
                # 곧 무너질 계단: 금 간 선과 붉은 기운
                pygame.draw.lines(surf, (150, 50, 40), False,
                                  [(sx + 6, sy + 4), (sx + 16, sy + 16), (sx + 11, sy + 24), (sx + 24, sy + TS - 4)], 2)
    elif tile == GL.RUBBLE:
        surf.blit(_rubble_surface(tx, ty), (sx, sy))
    elif tile == GL.DOOR:
        d = GAME.doors.states.get((tx, ty))
        anim = d['anim'] if d else 1.0
        _draw_door_panel(surf, tx, ty, sx, sy, TS * (1 - anim), (10, 32, 48), (13, 58, 80))
    elif tile == GL.LOCKED:
        is_bumped = GAME.locked_door_blink.get((tx, ty))
        col = (220, 60, 60) if is_bumped else (140, 30, 30)
        _draw_door_panel(surf, tx, ty, sx, sy, TS, (30, 6, 6), col)
        lx, ly = sx + TS / 2, sy + TS / 2
        pygame.draw.rect(surf, col, (lx - 6, ly - 2, 12, 10))
        pygame.draw.arc(surf, col, (lx - 5, ly - 10, 10, 10), 0, math.pi, 2)
    elif tile == GL.WINDOW:
        pygame.draw.rect(surf, (12, 44, 62), (sx, sy, TS, TS))
        inner = (sx + 4, sy + 4, TS - 8, TS - 8)
        glow = int(10 + 6 * math.sin(t_ms * 0.002 + tx + ty))
        pygame.draw.rect(surf, (14 + glow // 2, 58 + glow, 78 + glow), inner)
        pygame.draw.rect(surf, (70, 130, 150), inner, 2)
        pygame.draw.line(surf, (110, 170, 190), (sx + 9, sy + TS - 12), (sx + TS - 14, sy + 9), 1)
        pygame.draw.line(surf, (90, 150, 170), (sx + 13, sy + TS - 8), (sx + TS - 10, sy + 14), 1)
    elif tile in (GL.LOCKER, GL.CABINET, GL.PANEL):
        pulse = math.sin(t_ms * 0.002 + tx * 1.3 + ty * 2.1) * 0.5 + 0.5
        searched = (GAME.floor, tx, ty) in GAME.searched_tiles
        col = (int(20 + pulse * 15), int(50 + pulse * 20), int(70 + pulse * 25))
        if not searched:
            if tile == GL.LOCKER:
                pygame.draw.rect(surf, col, (sx + 6, sy + 4, TS - 12, TS - 8), 1)
                pygame.draw.line(surf, col, (sx + TS / 2, sy + 4), (sx + TS / 2, sy + TS - 4), 1)
            elif tile == GL.CABINET:
                pygame.draw.rect(surf, col, (sx + 4, sy + 8, TS - 8, TS - 16), 1)
                pygame.draw.line(surf, col, (sx + 4, sy + TS / 2), (sx + TS - 4, sy + TS / 2), 1)
            else:
                pygame.draw.rect(surf, col, (sx + 4, sy + 6, TS - 8, TS - 12), 1)
                pygame.draw.lines(surf, (80, 20, 20), False, [(sx + 10, sy + 8), (sx + 20, sy + 18), (sx + 15, sy + 28)], 1)
        else:
            pygame.draw.rect(surf, (10, 30, 40), (sx + 5, sy + 4, TS - 10, TS - 8), 1)
            if not _SEARCHED_SURF:
                _s = pygame.Surface((TS - 12, (TS - 12) // 2), pygame.SRCALPHA)
                _s.fill((4, 12, 18, 180))
                _SEARCHED_SURF.append(_s)
            surf.blit(_SEARCHED_SURF[0], (sx + 6, sy + 5))


_PLAYER_CACHE = {}


def _player_body(facing_left):
    key = ('body', facing_left)
    body = _PLAYER_CACHE.get(key)
    if body is None:
        cx = TS / 2
        top, bottom = TS * 0.18, TS * 0.92
        w = TS * 0.5
        body = pygame.Surface((TS, TS), pygame.SRCALPHA)
        pts = [(w * 0.25, bottom), (w * 0.25, top + TS * 0.14), (w * 0.75, top + TS * 0.14), (w * 0.75, bottom)]
        pygame.draw.polygon(body, (8, 36, 46, 235), pts)
        pygame.draw.polygon(body, (143, 240, 255, 255), pts, 2)
        eye_y = top + TS * 0.3
        eye_dx = -TS * 0.06 if facing_left else TS * 0.06
        pygame.draw.circle(body, (234, 252, 255), (int(TS / 2 - TS * 0.1 + eye_dx), int(eye_y)), 3)
        pygame.draw.circle(body, (234, 252, 255), (int(TS / 2 + TS * 0.1 + eye_dx), int(eye_y)), 3)
        _PLAYER_CACHE[key] = body
    return body


def _player_sprite(frame, facing_left):
    key = ('spr', frame, facing_left)
    img = _PLAYER_CACHE.get(key)
    if img is None:
        scale = (TS * 0.98) / bh
        dw, dh = int(bw * scale), int(bh * scale)
        img = pygame.transform.scale(SPRITE_FRAMES[frame], (dw, dh))
        if facing_left:
            img = pygame.transform.flip(img, True, False)
        _PLAYER_CACHE[key] = img
    return img


def _player_halo(hallu, alpha):
    alpha = alpha // 4 * 4
    key = ('halo', hallu, alpha)
    s = _PLAYER_CACHE.get(key)
    if s is None:
        color = (0, 255, 180) if hallu else (70, 190, 220)
        r = int(TS * (0.6 if hallu else 0.48))
        s = pygame.Surface((r * 3, r * 3), pygame.SRCALPHA)
        pygame.draw.circle(s, (*color, alpha), (r * 3 // 2, r * 3 // 2), r)
        _PLAYER_CACHE[key] = s
    return s


def draw_player(surf, sx, sy, t_ms):
    hallu = bool(GAME.hallucinating)
    halo_base = 0.16 if hallu else 0.10
    halo_pulse = 0.05 + math.sin(t_ms * 0.004) * 0.03
    halo = _player_halo(hallu, int((halo_base + halo_pulse) * 0.6 * 255))
    surf.blit(halo, (sx + TS / 2 - halo.get_width() / 2, sy + TS / 2 - halo.get_height() / 2))

    facing_left = bool(GAME.sprite.facing_left)
    surf.blit(_player_body(facing_left), (sx, sy))

    # 스프라이트 디테일 (있으면 덧그림)
    img = _player_sprite(GAME.sprite.frame, facing_left)
    dw, dh = img.get_size()
    surf.blit(img, (sx + (TS - dw) / 2, sy + TS - dh - 1))


_FLOOD_BUF = {}


def draw_flood_overlay(surf, t_ms):
    if GAME.flood.flood_level <= 0:
        return
    fl = GAME.flood.flood_level / 100.0
    w, h = surf.get_size()
    water_h = h * 0.38 * fl
    water_top = h - water_h
    wave_amp = 4 + fl * 5
    # 물이 차지하는 아래쪽 띠 영역만 그린다(전체 화면 크기 서피스를 매 프레임 만들지 않음)
    top_y = max(0, int(water_top - wave_amp - 2))
    band_h = h - top_y
    buf = _FLOOD_BUF.get('buf')
    if buf is None or buf.get_width() != w or buf.get_height() < band_h:
        buf = pygame.Surface((w, h), pygame.SRCALPHA)
        _FLOOD_BUF['buf'] = buf
    band = buf.subsurface((0, 0, w, band_h))
    band.fill((0, 0, 0, 0))
    pts = []
    xx = 0
    while xx <= w:
        pts.append((xx, water_top + math.sin(t_ms * 0.002 + xx * 0.04) * wave_amp - top_y))
        xx += 20
    pts += [(w, band_h), (0, band_h)]
    pygame.draw.polygon(band, (10, 60, 80, int((0.45 + fl * 0.25) * 255)), pts)
    surf.blit(band, (0, top_y))


_VIGNETTE_CACHE = {}


def draw_vignette(surf, sanity):
    strength = max(0, (100 - sanity) / 100.0) * 0.85
    if strength <= 0:
        return
    w, h = surf.get_size()
    q = int(strength * 40)  # 강도를 구간별로 양자화해서 캐시
    if q <= 0:
        return
    key = (w, h, q)
    s = _VIGNETTE_CACHE.get(key)
    if s is None:
        if len(_VIGNETTE_CACHE) > 48:
            _VIGNETTE_CACHE.clear()
        s = pygame.Surface((w, h), pygame.SRCALPHA)
        st = q / 40.0
        cx, cy = w / 2, h / 2
        max_r = math.hypot(w, h) * 0.55
        steps = 10
        for i in range(steps, 0, -1):
            frac = i / steps
            a = int(st * frac * 70)
            pygame.draw.circle(s, (0, 0, 10, a), (int(cx), int(cy)), int(max_r * frac), width=int(max_r / steps) + 2)
        _VIGNETTE_CACHE[key] = s
    surf.blit(s, (0, 0))


def draw_hud(surf):
    w, h = surf.get_size()

    def bar(x, y, bw_, bh_, frac, col):
        pygame.draw.rect(surf, (10, 26, 32), (x, y, bw_, bh_), border_radius=2)
        if frac > 0:
            pygame.draw.rect(surf, col, (x, y, bw_ * frac, bh_), border_radius=2)

    bar(16, 14, 120, 5, GAME.oxygen / 100, (13, 122, 156) if GAME.oxygen >= 30 else (204, 68, 68))
    surf.blit(FONT_SM.render('산소', True, (26, 64, 80)), (16, 2))

    bar(w - 136, 14, 120, 5, GAME.sanity / 100, (58, 128, 96) if GAME.sanity >= 30 else (204, 34, 68))
    txt = FONT_SM.render('정신력', True, (26, 64, 80))
    surf.blit(txt, (w - 16 - txt.get_width(), 2))

    center_x = w / 2
    depth_txt = FONT_SM.render(f'수심 {GAME.depth:,}m  ·  {GL.FLOOR_NAMES[GAME.floor]}', True, (74, 154, 176))
    surf.blit(depth_txt, (center_x - depth_txt.get_width() / 2, 4))
    key_txt = FONT_MD.render(('× ' + str(GAME.key_count)) if GAME.key_count else '—', True,
                              (204, 170, 0) if GAME.key_count else (26, 58, 0))
    label_txt = FONT_SM.render('열쇠', True, (26, 64, 80))
    kx = center_x - (label_txt.get_width() + key_txt.get_width() + 6) / 2
    surf.blit(label_txt, (kx, 24))
    surf.blit(key_txt, (kx + label_txt.get_width() + 6, 22))

    fl = GAME.flood.flood_level
    fl_col = (26, 48, 56) if fl <= 0 else ((204, 68, 34) if fl > 60 else ((199, 154, 58) if fl > 25 else (29, 106, 128)))
    fl_label = FONT_SM.render(f'침수 {int(fl)}%' if fl > 0 else '침수 —', True, fl_col)
    surf.blit(fl_label, (center_x - fl_label.get_width() / 2, 44))
    bar(center_x - 35, 58, 70, 4, fl / 100, fl_col)

    if MSG_TEXT and GAME.time_ms < MSG_UNTIL:
        lines = MSG_TEXT.split('\n')
        total_h = len(lines) * 18
        y0 = h - 100 - total_h
        for i, line in enumerate(lines):
            t = FONT_MD.render(line, True, (90, 175, 204))
            surf.blit(t, (center_x - t.get_width() / 2, y0 + i * 18))

    draw_captions(surf, h)

    hint = FONT_SM.render('WASD / 방향키 · 이동  |  Space · 달리기  |  E · 조사 / 열쇠 / 계단', True, (10, 37, 53))
    surf.blit(hint, (center_x - hint.get_width() / 2, h - 22))

    if GAME.interact_prompt:
        label = {'unlock': '[ E ]  열쇠 사용', 'stairs_up': '[ E ]  계단 올라가기',
                 'stairs_down': '[ E ]  계단 내려가기'}.get(GAME.interact_prompt, '[ E ]  조사')
        pw, ph = 230, 28
        px, py = center_x - pw / 2, h * 0.62
        col = (204, 122, 90) if GAME.interact_prompt == 'unlock' else (74, 154, 176)
        border = (140, 40, 40) if GAME.interact_prompt == 'unlock' else (13, 100, 130)
        s = pygame.Surface((pw, ph), pygame.SRCALPHA)
        s.fill((0, 8, 14, 220))
        pygame.draw.rect(s, border, (0, 0, pw, ph), 1)
        surf.blit(s, (px, py))
        t = FONT_MD.render(label, True, col)
        surf.blit(t, (center_x - t.get_width() / 2, py + 6))


def draw_captions(surf, h):
    now = GAME.time_ms
    y = h - 70
    kept = []
    for cap in GAME.captions:
        age = now - cap.born
        if age > 2600:
            continue
        kept.append(cap)
    GAME.captions = kept
    for cap in reversed(GAME.captions[-5:]):
        age = now - cap.born
        alpha = 255
        if age < 300:
            alpha = int(255 * (age / 300))
        elif age > 2200:
            alpha = int(255 * max(0, (2600 - age) / 400))
        col = (156, 201, 168) if cap.kind == 'halluc' else (127, 184, 204)
        icon_col = (47, 174, 124) if cap.kind == 'halluc' else (58, 122, 144)
        txt = FONT_SM.render(cap.text, True, col)
        box_w = txt.get_width() + 30
        s = pygame.Surface((box_w, 20), pygame.SRCALPHA)
        s.fill((4, 10, 14, min(180, alpha)))
        s.blit(FONT_SM.render('♩', True, (*icon_col, alpha)), (6, 3))
        s.blit(txt, (22, 3))
        surf.blit(s, (14, y))
        y -= 24


def draw_ending(surf):
    w, h = surf.get_size()
    s = pygame.Surface((w, h), pygame.SRCALPHA)
    s.fill((0, 0, 0, 242))
    surf.blit(s, (0, 0))
    title, body = ENDING_MSGS.get(GAME.ending, ('종료', ''))
    col = (13, 122, 156) if GAME.ending == 'escape' else (204, 34, 68)
    t = FONT_XL.render(title, True, col)
    surf.blit(t, (w / 2 - t.get_width() / 2, h / 2 - 90))
    for i, line in enumerate(body.split('\n')):
        bt = FONT_MD.render(line, True, (26, 64, 80))
        surf.blit(bt, (w / 2 - bt.get_width() / 2, h / 2 - 20 + i * 24))
    if _time.time() - GAME.ending_at > 1.5:
        rt = FONT_SM.render('[ 스페이스 또는 클릭으로 재시작 ]', True, (10, 37, 53))
        surf.blit(rt, (w / 2 - rt.get_width() / 2, h / 2 + 140))


def draw_title_screen(surf):
    w, h = surf.get_size()
    surf.fill((0, 5, 8))
    t = FONT_XL.render('ABYSS', True, (13, 122, 156))
    surf.blit(t, (w / 2 - t.get_width() / 2, h / 2 - 120))
    sub = FONT_SM.render('수심 5,980m · 가라앉은 여객선', True, (10, 48, 64))
    surf.blit(sub, (w / 2 - sub.get_width() / 2, h / 2 - 60))
    btn_rect = pygame.Rect(w / 2 - 110, h / 2, 220, 48)
    mouse = pygame.mouse.get_pos()
    hover = btn_rect.collidepoint(mouse)
    pygame.draw.rect(surf, (13, 122, 156) if hover else (13, 74, 92), btn_rect, 1)
    bt = FONT_MD.render('▶  탑승', True, (90, 175, 204))
    surf.blit(bt, (btn_rect.centerx - bt.get_width() / 2, btn_rect.centery - bt.get_height() / 2))
    return btn_rect


# ══════════════════════════════════════════════════════════
# 상태 머신: TITLE / PLAYING / ENDED
# ══════════════════════════════════════════════════════════
STATE_TITLE, STATE_PLAYING, STATE_ENDED = 'title', 'playing', 'ended'
app_state = STATE_TITLE


def start_game():
    global app_state
    GAME.reset()
    show_msg('B2 · 객실 14호 · WASD 이동  /  E 조사\n주변을 살펴 열쇠를 찾을 것', 4500)
    app_state = STATE_PLAYING


_FLICKER = {'s': None}


def main():
    global app_state, WIN_W, WIN_H, screen
    while True:
        dt = clock.tick(TARGET_FPS)
        dt = min(dt, 50)

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit(); sys.exit(0)
            elif event.type == pygame.VIDEORESIZE:
                WIN_W, WIN_H = event.w, event.h
                screen = pygame.display.set_mode((WIN_W, WIN_H), pygame.RESIZABLE)
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    pygame.quit(); sys.exit(0)
                if app_state == STATE_ENDED and event.key == pygame.K_SPACE:
                    start_game()
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if app_state == STATE_TITLE:
                    btn_rect = pygame.Rect(WIN_W / 2 - 110, WIN_H / 2, 220, 48)
                    if btn_rect.collidepoint(event.pos):
                        start_game()
                elif app_state == STATE_ENDED:
                    start_game()

        if app_state == STATE_TITLE:
            draw_title_screen(screen)
        elif app_state == STATE_PLAYING:
            update(dt)
            cam_x, cam_y = GL.camera_origin(GAME.player['x'], GAME.player['y'], WIN_W, WIN_H)
            shake_x = shake_y = 0
            if GAME.cam_shake > 0:
                shake_x = (random.random() - 0.5) * 6 * (GAME.cam_shake / 60)
                shake_y = (random.random() - 0.5) * 4 * (GAME.cam_shake / 60)

            screen.fill((0, 3, 5))
            world = screen
            cam_x_shook = cam_x - shake_x / TS
            cam_y_shook = cam_y - shake_y / TS
            draw_tiles(world, cam_x_shook, cam_y_shook)
            # 플레이어도 타일과 같은(흔들린) 카메라 기준으로 그려야
            # 화면 전체가 함께 흔들리는 '카메라 쉐이크'가 된다(JS판의 ctx.translate와 동일 효과)
            psx, psy = GL.sprite_origin(GAME.player['x'], GAME.player['y'], cam_x_shook, cam_y_shook)
            draw_player(world, psx, psy, GAME.time_ms)

            draw_vignette(screen, GAME.sanity)
            draw_flood_overlay(screen, GAME.time_ms)

            if GAME.flicker > 0:
                a = int((0.3 + random.random() * 0.5) * 255)
                if _FLICKER['s'] is None or _FLICKER['s'].get_size() != (WIN_W, WIN_H):
                    _FLICKER['s'] = pygame.Surface((WIN_W, WIN_H))
                    _FLICKER['s'].fill((0, 0, 0))
                _FLICKER['s'].set_alpha(a)
                screen.blit(_FLICKER['s'], (0, 0))

            if GAME.hal_text and GAME.hal_text_timer > 0:
                t = FONT_LG.render(GAME.hal_text, True, (0, 220, 180))
                screen.blit(t, (WIN_W / 2 - t.get_width() / 2, WIN_H * 0.3))

            draw_hud(screen)

            if not GAME.running:
                app_state = STATE_ENDED
        elif app_state == STATE_ENDED:
            draw_ending(screen)

        pygame.display.flip()


if __name__ == '__main__':
    main()
