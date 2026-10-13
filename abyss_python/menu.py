"""
ABYSS — 메뉴 내비게이션 로직 (pygame에 의존하지 않는 순수 로직)

화면 그리기/입력 변환은 abyss_topdown.py 가 맡고, 여기서는
"어느 항목이 선택돼 있고, 키를 누르면 무엇이 바뀌는가"만 다룬다.

입력은 추상 키 이름: 'up' 'down' 'left' 'right' 'confirm' 'back'
handle()의 반환값(이벤트):
    ('changed', 설정키)   설정 값이 바뀜 → 호출자가 즉시 적용/저장
    ('reset',)            기본값으로 되돌림 → 전부 다시 적용/저장
    ('resume',)           (일시정지) 게임으로 돌아감
    ('start',)            (타이틀) 게임 시작
    ('title',)            타이틀 화면으로 나감
    ('quit',)             프로그램 종료
    None                  그 외(이동 등)
"""
import settings as ST

ROOT_PAUSE = 'pause'
ROOT_TITLE = 'title'

SCREEN_TITLES = {
    'pause': '일시정지',
    'title': 'ABYSS',
    'settings': '설정',
    'confirm_title': '타이틀로 나갈까요?\n진행 상황은 저장되지 않음',
    'confirm_quit': '게임을 종료할까요?',
}


class Item:
    def __init__(self, label, kind, key=None, options=None, action=None, target=None):
        self.label = label
        self.kind = kind          # 'action' | 'push' | 'back' | 'choice' | 'slider'
        self.key = key
        self.options = options    # choice용 [(값, 표시)]
        self.action = action
        self.target = target


def _screens():
    return {
        'pause': [
            Item('계속하기', 'action', action='resume'),
            Item('설정', 'push', target='settings'),
            Item('타이틀로 나가기', 'push', target='confirm_title'),
        ],
        'title': [
            Item('▶  탑승', 'action', action='start'),
            Item('설정', 'push', target='settings'),
            Item('종료', 'push', target='confirm_quit'),
        ],
        'settings': [
            Item('창 크기', 'choice', key='window', options=ST.WINDOW_CHOICES),
            Item('프레임', 'choice', key='fps', options=ST.FPS_CHOICES),
            Item('밝기', 'choice', key='brightness', options=ST.BRIGHTNESS_CHOICES),
            Item('효과음', 'slider', key='sfx'),
            Item('앰비언스', 'slider', key='ambience'),
            Item('달리기 방식', 'choice', key='run_mode', options=ST.RUN_CHOICES),
            Item('기본값으로', 'action', action='reset'),
            Item('뒤로', 'back'),
        ],
        'confirm_title': [
            Item('아니오', 'back'),
            Item('예', 'action', action='title'),
        ],
        'confirm_quit': [
            Item('아니오', 'back'),
            Item('예', 'action', action='quit'),
        ],
    }


class Menu:
    def __init__(self, settings):
        self.settings = settings
        self.screens = _screens()
        self.stack = []
        self.cursor = {}

    # ── 열기/상태 ──────────────────────────────────────
    def open(self, root):
        self.stack = [root]
        self.cursor = {}

    def push(self, name):
        self.stack.append(name)
        self.cursor.setdefault(name, 0)
        if name.startswith('confirm_'):
            self.cursor[name] = 0   # 확인 창은 항상 '아니오'가 기본

    @property
    def screen(self):
        return self.stack[-1]

    @property
    def title(self):
        return SCREEN_TITLES.get(self.screen, '')

    @property
    def items(self):
        return self.screens[self.screen]

    @property
    def index(self):
        return self.cursor.get(self.screen, 0)

    def select(self, i):
        if 0 <= i < len(self.items):
            self.cursor[self.screen] = i

    @property
    def selected(self):
        return self.items[self.index]

    # ── 표시용 값 ──────────────────────────────────────
    def value_text(self, item):
        if item.kind == 'choice':
            cur = getattr(self.settings, item.key)
            for v, label in item.options:
                if v == cur:
                    return label
            return str(cur)
        if item.kind == 'slider':
            n = getattr(self.settings, item.key)
            return '▮' * n + '▯' * (ST.VOLUME_MAX - n)
        return ''

    # ── 입력 ───────────────────────────────────────────
    def handle(self, key):
        items = self.items
        if key == 'up':
            self.cursor[self.screen] = (self.index - 1) % len(items)
            return None
        if key == 'down':
            self.cursor[self.screen] = (self.index + 1) % len(items)
            return None
        if key == 'back':
            return self._back()
        item = self.selected
        if key in ('left', 'right'):
            return self._adjust(item, -1 if key == 'left' else 1, wrap=False)
        if key == 'confirm':
            if item.kind == 'choice':
                return self._adjust(item, 1, wrap=True)
            if item.kind == 'push':
                self.push(item.target)
                return None
            if item.kind == 'back':
                return self._back()
            if item.kind == 'action':
                return self._action(item.action)
        return None

    def _back(self):
        if len(self.stack) > 1:
            self.stack.pop()
            return None
        # 맨 위 화면에서 '뒤로': 일시정지면 게임으로, 타이틀이면 종료 확인
        if self.stack[0] == ROOT_PAUSE:
            return ('resume',)
        self.push('confirm_quit')
        return None

    def _adjust(self, item, step, wrap):
        if item.kind == 'choice':
            values = [v for v, _ in item.options]
            cur = values.index(getattr(self.settings, item.key))
            nxt = cur + step
            if wrap:
                nxt %= len(values)
            else:
                nxt = max(0, min(len(values) - 1, nxt))
            if nxt == cur:
                return None
            setattr(self.settings, item.key, values[nxt])
            return ('changed', item.key)
        if item.kind == 'slider':
            cur = getattr(self.settings, item.key)
            nxt = max(0, min(ST.VOLUME_MAX, cur + step))
            if nxt == cur:
                return None
            setattr(self.settings, item.key, nxt)
            return ('changed', item.key)
        return None

    def _action(self, name):
        if name == 'reset':
            self.settings.reset()
            return ('reset',)
        if name in ('resume', 'start', 'title', 'quit'):
            return (name,)
        return None
