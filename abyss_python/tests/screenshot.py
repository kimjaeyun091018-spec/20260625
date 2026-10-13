"""
noVNC 없이 게임 화면을 확인하기 위한 스크린샷 스크립트.

실제 디스플레이(X 서버) 없이 SDL의 'dummy' 비디오 드라이버로 pygame을
초기화해서, 타이틀 화면과 플레이 중 화면을 PNG 파일로 저장합니다.
Codespace 터미널에서:

    export SDL_VIDEODRIVER=dummy
    export SDL_AUDIODRIVER=dummy
    python3 tests/screenshot.py

실행 후 생성되는 screenshot_title.png / screenshot_playing.png 를
VS Code 파일 탐색기에서 더블클릭하면 바로 미리보기로 볼 수 있습니다
(이 방식은 noVNC/포트포워딩이 전혀 필요 없습니다).
"""
import os
import sys

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pygame
import random

import abyss_topdown as A

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def save(surface, name):
    path = os.path.join(OUT_DIR, name)
    pygame.image.save(surface, path)
    print(f"[저장됨] {path}")


def render_playing_frame():
    """abyss_topdown.main()의 STATE_PLAYING 분기와 동일한 렌더링을 1프레임 수행."""
    WIN_W, WIN_H = A.WIN_W, A.WIN_H
    TS = A.TS
    GAME = A.GAME

    cam_x, cam_y = A.GL.camera_origin(GAME.player['x'], GAME.player['y'], WIN_W, WIN_H)

    screen = pygame.display.get_surface()
    screen.fill((0, 3, 5))
    world = pygame.Surface((WIN_W, WIN_H))
    world.fill((0, 3, 5))
    A.draw_tiles(world, cam_x, cam_y)
    psx, psy = A.GL.sprite_origin(GAME.player['x'], GAME.player['y'], cam_x, cam_y)
    A.draw_player(world, psx, psy, GAME.time_ms)
    screen.blit(world, (0, 0))
    A.draw_vignette(screen, GAME.sanity)
    A.draw_flood_overlay(screen, GAME.time_ms)
    A.draw_hud(screen)
    return screen


def main():
    pygame.init()
    screen = pygame.display.set_mode((A.WIN_W, A.WIN_H))
    A.screen = screen

    # 1) 타이틀 화면
    A.draw_title_screen(screen)
    save(screen, "screenshot_title.png")

    # 2) 게임 시작 후 몇 초 걸어 다니게 시뮬레이션해서 플레이 화면 캡처
    A.start_game()
    keys_down = {pygame.K_d: True}  # 오른쪽으로 이동

    class FakeKeys(dict):
        def __getitem__(self, k):
            return keys_down.get(k, False)

    pygame.key.get_pressed = lambda: FakeKeys()

    for i in range(90):  # ~1.5초 분량
        A.update(16)

    render_playing_frame()
    save(screen, "screenshot_playing.png")

    print("완료: screenshot_title.png, screenshot_playing.png 생성됨")


if __name__ == "__main__":
    main()
