"""설정/메뉴 로직 검증 (pygame 불필요)."""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import settings as ST
import menu as M

failures = 0


def check(name, cond):
    global failures
    print(f"[{'PASS' if cond else 'FAIL'}] {name}")
    if not cond:
        failures += 1


# ── 설정: 기본값/범위/저장 ──────────────────────────
s = ST.Settings()
check('defaults', s.window == 0 and s.fps == 30 and s.brightness == 1 and s.sfx == 8 and s.run_mode == 'hold')
s.sfx = 99
check('volume clamps to max', s.sfx == ST.VOLUME_MAX)
s.sfx = -5
check('negative volume clamps to 0', s.sfx == 0)
s.fps = 45
check('invalid fps falls back to default', s.fps == 30)
s.run_mode = 'sprint'
check('invalid run_mode falls back to default', s.run_mode == 'hold')
s.window = True
check('bool is not accepted as a window choice', s.window == 0)
check('sfx_volume 0..1', ST.Settings({'sfx': 5}).sfx_volume == 0.5)
check('shade scale follows brightness', ST.Settings({'brightness': 3}).shade_scale < ST.Settings({'brightness': 0}).shade_scale)
check('window_size for presets', ST.Settings({'window': 1}).window_size == (1000, 700))
check('fullscreen has no fixed size', ST.Settings({'window': 3}).window_size is None)
check('junk data → defaults', ST.Settings('not a dict').data == ST.DEFAULTS)
check('unknown keys dropped', 'hax' not in ST.Settings({'hax': 1, 'fps': 60}).data and ST.Settings({'hax': 1, 'fps': 60}).fps == 60)

with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, 'sub.json')
    a = ST.Settings({'window': 2, 'fps': 60, 'brightness': 2, 'sfx': 3, 'ambience': 0, 'run_mode': 'toggle'})
    check('save succeeds', a.save(path) is True)
    b = ST.Settings.load(path, env={})
    check('round trip keeps every value', b.data == a.data)
    with open(path, 'w') as f:
        f.write('{ broken json')
    check('corrupted file → defaults (no crash)', ST.Settings.load(path, env={}).data == ST.DEFAULTS)
    check('missing file → defaults', ST.Settings.load(os.path.join(d, 'nope.json'), env={}).data == ST.DEFAULTS)
    check('env ABYSS_FPS used when no file', ST.Settings.load(os.path.join(d, 'nope.json'), env={'ABYSS_FPS': '60'}).fps == 60)
    check('env ABYSS_W picks nearest window', ST.Settings.load(os.path.join(d, 'nope.json'), env={'ABYSS_W': '1000'}).window == 1)
    check('env ignored when a settings file exists', (a.save(path), ST.Settings.load(path, env={'ABYSS_FPS': '30'}).fps)[1] == 60)
check('unwritable path → save returns False, no exception', ST.Settings().save('/proc/nonexistent/x.json') is False)

# ── 메뉴 ─────────────────────────────────────────
s = ST.Settings()
m = M.Menu(s)
m.open('pause')
check('pause opens on "계속하기"', m.selected.action == 'resume' and m.index == 0)
check('resume event on confirm', m.handle('confirm') == ('resume',))
check('Esc at pause root resumes', m.handle('back') == ('resume',))
m.handle('down')
check('down moves selection', m.selected.label == '설정')
m.handle('up'); m.handle('up')
check('up wraps to last item', m.selected.label == '타이틀로 나가기')
m.handle('down')
check('down wraps to first', m.index == 0)

# 설정 화면
m.open('pause'); m.handle('down'); m.handle('confirm')
check('enters settings', m.screen == 'settings')
check('first settings item is window size', m.selected.key == 'window')
ev = m.handle('right')
check('right changes window', ev == ('changed', 'window') and s.window == 1)
check('right at the end does not wrap', (m.handle('right'), m.handle('right'), m.handle('right'))[-1] is None and s.window == 3)
check('confirm on a choice cycles forward with wrap', m.handle('confirm') == ('changed', 'window') and s.window == 0)
m.handle('left')
check('left at first choice stays (no change event)', m.handle('left') is None and s.window == 0)
m.handle('down'); m.handle('confirm')
check('fps toggles with confirm', s.fps == 60)
m.handle('down'); m.handle('right')
check('brightness steps', s.brightness == 2)
m.handle('down')
check('on sfx slider', m.selected.key == 'sfx')
for _ in range(5):
    m.handle('right')
check('slider capped at max', s.sfx == ST.VOLUME_MAX)
m.handle('left')
check('slider decrement', s.sfx == ST.VOLUME_MAX - 1)
check('slider value text length is 10', len(m.value_text(m.selected)) == ST.VOLUME_MAX)
m.handle('down'); m.handle('down')
check('on run mode', m.selected.key == 'run_mode')
m.handle('confirm')
check('run mode toggles', s.run_mode == 'toggle')
m.handle('down')
check('on reset', m.selected.action == 'reset')
check('reset restores defaults and reports', m.handle('confirm') == ('reset',) and s.data == ST.DEFAULTS)
m.handle('down')
check('on back', m.selected.kind == 'back')
m.handle('confirm')
check('back returns to pause menu', m.screen == 'pause')
check('Esc inside settings goes back (not resume)', (m.handle('confirm'), m.handle('back'))[1] is None and m.screen == 'pause')

# 타이틀로 나가기 확인
m.open('pause'); m.handle('up'); m.handle('confirm')
check('confirm screen opens on "아니오"', m.screen == 'confirm_title' and m.selected.label == '아니오')
check('"아니오" goes back without event', m.handle('confirm') is None and m.screen == 'pause')
m.open('pause'); m.handle('up'); m.handle('confirm'); m.handle('down')
check('"예" → title event', m.handle('confirm') == ('title',))

# 타이틀
m.open('title')
check('title: start on first item', m.handle('confirm') == ('start',))
m.open('title'); m.handle('down'); m.handle('confirm')
check('title: settings reachable', m.screen == 'settings')
m.handle('back')
check('title: back from settings returns to title', m.screen == 'title')
m.open('title')
check('Esc at title opens quit confirmation', m.handle('back') is None and m.screen == 'confirm_quit')
check('quit confirm defaults to "아니오"', m.selected.label == '아니오')
m.handle('down')
check('quit confirmed', m.handle('confirm') == ('quit',))
m.open('title'); m.handle('up'); m.handle('confirm')
check('"종료" item opens confirmation', m.screen == 'confirm_quit')
# 마우스 선택
m.open('pause'); m.select(2)
check('mouse select sets cursor', m.selected.label == '타이틀로 나가기')
m.select(99)
check('out-of-range select ignored', m.index == 2)

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
