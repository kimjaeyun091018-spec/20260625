"""
렉이 게임 때문인지 화면 전송(VNC) 때문인지 구분하기 위한 측정 스크립트.
디스플레이 없이(dummy 드라이버) 렌더링 비용만 잰다.

    SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy python3 tests/perf.py

한 프레임에 수 ms(대략 10ms 이하)가 나오면 게임은 충분히 가볍고,
그래도 실제 창에서 끊기면 원인은 VNC 전송 쪽이다.
"""
import os
import sys
import time

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pygame
import abyss_topdown as A

N = 300


def timed(label, fn):
    t0 = time.perf_counter()
    for _ in range(N):
        fn()
    ms = (time.perf_counter() - t0) * 1000 / N
    print(f"{label:<18}{ms:7.2f} ms/frame")
    return ms


def main():
    A.start_game()
    screen = A.screen
    G = A.GAME
    TS = A.TS
    cam = lambda: (G.player['x'] - (A.WIN_W / 2) / TS + 0.5, G.player['y'] - (A.WIN_H / 2) / TS + 0.5)

    def tiles():
        cx, cy = cam()
        A.draw_tiles(screen, cx, cy)

    def player():
        cx, cy = cam()
        A.draw_player(screen, (G.player['x'] - cx) * TS, (G.player['y'] - cy) * TS, G.time_ms)

    G.sanity = 40
    G.flood.flood_level = 30
    total = 0
    total += timed("update", lambda: A.update(33))
    total += timed("draw_tiles", tiles)
    total += timed("draw_player", player)
    total += timed("vignette", lambda: A.draw_vignette(screen, G.sanity))
    total += timed("flood overlay", lambda: A.draw_flood_overlay(screen, G.time_ms))
    total += timed("hud", lambda: A.draw_hud(screen))
    print("-" * 32)
    print(f"{'합계':<18}{total:7.2f} ms/frame  (≈ {1000 / max(total, 0.01):.0f} FPS 상한)")


if __name__ == "__main__":
    main()
