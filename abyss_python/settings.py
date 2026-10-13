"""
ABYSS — 설정 저장/불러오기 (pygame에 의존하지 않는 순수 로직)

설정 파일은 JSON이며 기본 위치는 홈 폴더의 `.abyss_settings.json`.
환경변수 ABYSS_SETTINGS 로 경로를 바꿀 수 있다. 파일이 없거나 깨져 있어도 게임은 기본값으로 계속 실행된다.
"""
import json
import os

# 선택지 (값, 표시 이름)
WINDOW_CHOICES = [(0, '800 × 560'), (1, '1000 × 700'), (2, '1200 × 840'), (3, '전체화면')]
WINDOW_SIZES = {0: (800, 560), 1: (1000, 700), 2: (1200, 840)}  # 3(전체화면)은 실행 중 화면 크기를 사용
FPS_CHOICES = [(30, '30 (가벼움)'), (60, '60 (부드러움)')]
BRIGHTNESS_CHOICES = [(0, '어둡게'), (1, '보통'), (2, '밝게'), (3, '아주 밝게')]
BRIGHTNESS_SHADE_SCALE = {0: 1.15, 1: 1.0, 2: 0.7, 3: 0.45}  # 먼 곳을 덮는 어둠의 세기 배율
RUN_CHOICES = [('hold', '누르고 있는 동안'), ('toggle', '한 번 눌러 켜기/끄기')]
VOLUME_MAX = 10

DEFAULTS = {
    'window': 0,
    'fps': 30,
    'brightness': 1,
    'sfx': 8,
    'ambience': 8,
    'run_mode': 'hold',
}


def default_path():
    return os.environ.get('ABYSS_SETTINGS') or os.path.join(os.path.expanduser('~'), '.abyss_settings.json')


def _valid_values(choices):
    return {v for v, _ in choices}


def clamp(data):
    """알 수 없는 키는 버리고, 범위를 벗어났거나 형식이 틀린 값은 기본값으로 되돌린다."""
    out = dict(DEFAULTS)
    if not isinstance(data, dict):
        return out
    if data.get('window') in _valid_values(WINDOW_CHOICES) and not isinstance(data.get('window'), bool):
        out['window'] = data['window']
    if data.get('fps') in _valid_values(FPS_CHOICES) and not isinstance(data.get('fps'), bool):
        out['fps'] = data['fps']
    if data.get('brightness') in _valid_values(BRIGHTNESS_CHOICES) and not isinstance(data.get('brightness'), bool):
        out['brightness'] = data['brightness']
    if data.get('run_mode') in _valid_values(RUN_CHOICES):
        out['run_mode'] = data['run_mode']
    for key in ('sfx', 'ambience'):
        v = data.get(key)
        if isinstance(v, int) and not isinstance(v, bool):
            out[key] = max(0, min(VOLUME_MAX, v))
    return out


class Settings:
    def __init__(self, data=None):
        self.data = clamp(data)

    # 속성처럼 읽고 쓴다 (settings.fps = 60)
    def __getattr__(self, name):
        if name != 'data' and name in DEFAULTS:
            return self.data[name]
        raise AttributeError(name)

    def __setattr__(self, name, value):
        if name in DEFAULTS:
            merged = dict(self.data)
            merged[name] = value
            self.data = clamp(merged)
        else:
            object.__setattr__(self, name, value)

    def reset(self):
        self.data = dict(DEFAULTS)

    @property
    def sfx_volume(self):
        return self.data['sfx'] / VOLUME_MAX

    @property
    def ambience_volume(self):
        return self.data['ambience'] / VOLUME_MAX

    @property
    def shade_scale(self):
        return BRIGHTNESS_SHADE_SCALE[self.data['brightness']]

    @property
    def window_size(self):
        """(w, h) 또는 전체화면이면 None."""
        return WINDOW_SIZES.get(self.data['window'])

    @classmethod
    def load(cls, path=None, env=None):
        """파일에서 읽는다. 없거나 깨졌으면 기본값(환경변수 ABYSS_FPS / ABYSS_W 가 있으면 반영)."""
        env = os.environ if env is None else env
        path = path or default_path()
        try:
            with open(path, encoding='utf-8') as f:
                return cls(json.load(f))
        except (OSError, ValueError):
            pass
        base = dict(DEFAULTS)
        try:
            fps = int(env.get('ABYSS_FPS', ''))
            if fps in _valid_values(FPS_CHOICES):
                base['fps'] = fps
        except ValueError:
            pass
        try:
            w = int(env.get('ABYSS_W', ''))
            base['window'] = min(WINDOW_SIZES, key=lambda k: abs(WINDOW_SIZES[k][0] - w))
        except ValueError:
            pass
        return cls(base)

    def save(self, path=None):
        """저장 실패(읽기 전용 폴더 등)는 게임을 멈추지 않고 False를 돌려준다."""
        path = path or default_path()
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            return True
        except OSError:
            return False
