"""
사운드 합성 (절차적 생성, numpy 기반)

원본 HTML 버전은 Web Audio API(OscillatorNode/BiquadFilterNode/GainNode)로
모든 효과음을 실시간 절차적 생성했습니다. 이 모듈은 그 사운드들을 numpy 배열로
"미리" 합성해 두고(게임 시작 시 1회), pygame.sndarray.make_sound()로 변환해
재생하는 방식으로 이식합니다. 외부 음원 파일은 전혀 쓰지 않습니다.

pygame에 의존하지 않으므로 이 파일 자체는 pygame 없이도 테스트할 수 있습니다.
"""
import numpy as np

SR = 44100  # 샘플레이트


def _t(dur):
    n = max(1, int(SR * dur))
    return np.linspace(0, dur, n, endpoint=False), n


def _onepole_lowpass(x, cutoff_hz, sr=SR):
    if cutoff_hz <= 0:
        return x
    rc = 1.0 / (2 * np.pi * cutoff_hz)
    dt = 1.0 / sr
    alpha = dt / (rc + dt)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha * (x[i] - acc)
        y[i] = acc
    return y


def _onepole_highpass(x, cutoff_hz, sr=SR):
    low = _onepole_lowpass(x, cutoff_hz, sr)
    return x - low


def _bandpass(x, center_hz, width_hz, sr=SR):
    lo = _onepole_lowpass(x, center_hz + width_hz / 2, sr)
    return lo - _onepole_lowpass(lo, max(10.0, center_hz - width_hz / 2), sr)


def _exp_decay(n, tau_frac=0.3):
    i = np.arange(n)
    return np.exp(-i / (n * tau_frac))


def _lin_env(n, attack_frac=0.05, release_frac=0.6):
    env = np.ones(n)
    a = max(1, int(n * attack_frac))
    r = max(1, int(n * release_frac))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return env


def _to_stereo_i16(mono, pan=0.0, gain=1.0):
    """mono float array(-1..1 권장) -> stereo int16 array. pan: -1(왼쪽)~1(오른쪽)."""
    mono = np.clip(mono * gain, -1.0, 1.0)
    left_gain = min(1.0, 1.0 - max(0.0, pan))
    right_gain = min(1.0, 1.0 + min(0.0, pan))
    left = mono * left_gain
    right = mono * right_gain
    stereo = np.stack([left, right], axis=1)
    return (stereo * 32767).astype(np.int16)


def _osc(freq_func, dur, wave='sine'):
    t, n = _t(dur)
    freq = freq_func(t) if callable(freq_func) else np.full(n, freq_func)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    if wave == 'sine':
        return np.sin(phase)
    elif wave == 'sawtooth':
        return 2 * (phase / (2 * np.pi) % 1.0) - 1
    else:
        raise ValueError(wave)


def _noise(n):
    return np.random.uniform(-1, 1, n)


# ══════════════════════════════════════════════════════════
# 개별 효과음
# ══════════════════════════════════════════════════════════

def glass_crack(intensity=1.0):
    dur = 0.35 + np.random.rand() * 0.2
    _, n = _t(dur)
    noise = _noise(n) * _exp_decay(n, 0.12)
    hp = _onepole_highpass(noise, 3000)
    crack = _osc(lambda t: 1800 - t * 3000, dur, 'sawtooth') * _exp_decay(n, 0.08) * 0.5
    mix = hp * 0.7 + crack
    return _to_stereo_i16(mix, gain=0.5 * intensity)


def door_thud():
    dur = 0.3
    _, n = _t(dur)
    osc = np.sin(2 * np.pi * 90 * np.linspace(0, dur, n)) * _exp_decay(n, 0.25)
    noise = _onepole_lowpass(_noise(n), 300) * _exp_decay(n, 0.15) * 0.4
    return _to_stereo_i16(osc * 0.6 + noise, gain=0.6)


def key_found():
    dur = 0.5
    _, n = _t(dur)
    freqs = [880, 1320, 1760]
    mix = np.zeros(n)
    for i, f in enumerate(freqs):
        start = int(n * i * 0.12)
        seg = np.zeros(n)
        seg_n = n - start
        seg[start:] = np.sin(2 * np.pi * f * np.linspace(0, seg_n / SR, seg_n)) * _exp_decay(seg_n, 0.3)
        mix += seg * 0.3
    return _to_stereo_i16(mix, gain=0.5)


def crack_whisper():
    dur = 0.8
    _, n = _t(dur)
    noise = _noise(n)
    bp = _bandpass(noise, 600, 400)
    env = _exp_decay(n, 0.4)
    return _to_stereo_i16(bp * env, gain=0.35)


def whisper_burst(intensity=0.5, pan=None):
    dur = 0.4 + np.random.rand() * 0.5
    _, n = _t(dur)
    env = np.sin(np.pi * np.arange(n) / n)
    noise = _noise(n) * env
    bp1 = _bandpass(noise, 700 + np.random.rand() * 400, 200)
    bp2 = _bandpass(bp1, 1800 + np.random.rand() * 800, 300)
    if pan is None:
        pan = -(0.6 + np.random.rand() * 0.4) if np.random.rand() < 0.5 else (0.6 + np.random.rand() * 0.4)
    return _to_stereo_i16(bp2 * 3.0, pan=pan, gain=0.07 + intensity * 0.2)


def footstep(running=False):
    dur = 0.1 if running else 0.14
    _, n = _t(dur)
    noise = _noise(n) * _exp_decay(n, 0.22)
    lp = _onepole_lowpass(noise, (500 if running else 360) + np.random.rand() * 80)
    env = np.ones(n)
    a = max(1, int(n * 0.06))
    env[:a] = np.linspace(0, 1, a)
    return _to_stereo_i16(lp * env, gain=0.22 if running else 0.16)


def door_open():
    dur = 0.9
    _, n = _t(dur)
    slide = _osc(lambda t: 140 * np.exp(-t * 1.4), dur, 'sawtooth')
    slide = _onepole_lowpass(slide, 500) * _lin_env(n, 0.08, 0.5) * 0.4
    hiss_n = int(SR * 0.4)
    hiss = _onepole_highpass(_noise(hiss_n), 2200) * _lin_env(hiss_n, 0.1, 0.6) * 0.3
    hiss_full = np.zeros(n); hiss_full[int(0.05 * SR):int(0.05 * SR) + hiss_n] = hiss[:max(0, n - int(0.05*SR))]
    thunk_n = int(SR * 0.3)
    thunk = np.sin(2 * np.pi * 80 * np.linspace(0, thunk_n / SR, thunk_n)) * _exp_decay(thunk_n, 0.3) * 0.5
    thunk_full = np.zeros(n)
    start = int(0.48 * SR)
    end = min(n, start + thunk_n)
    thunk_full[start:end] = thunk[:end - start]
    mix = slide + hiss_full + thunk_full
    return _to_stereo_i16(mix, gain=0.55)


def door_close():
    dur = 0.65
    _, n = _t(dur)
    slide = _osc(lambda t: 70 * np.exp(t * 1.1), dur, 'sawtooth')
    slide = _onepole_lowpass(slide, 420) * _lin_env(n, 0.1, 0.6) * 0.35
    thunk_n = int(SR * 0.3)
    thunk = np.sin(2 * np.pi * 90 * np.linspace(0, thunk_n / SR, thunk_n)) * _exp_decay(thunk_n, 0.3) * 0.5
    thunk_full = np.zeros(n)
    start = int(0.3 * SR)
    end = min(n, start + thunk_n)
    thunk_full[start:end] = thunk[:end - start]
    click_n = int(SR * 0.15)
    click = _onepole_highpass(_noise(click_n), 1800) * _exp_decay(click_n, 0.2) * 0.25
    click_full = np.zeros(n)
    cstart = int(0.3 * SR); cend = min(n, cstart + click_n)
    click_full[cstart:cend] = click[:cend - cstart]
    mix = slide + thunk_full + click_full
    return _to_stereo_i16(mix, gain=0.5)


def phantom_footstep_group(intensity=0.5):
    """2~4걸음짜리 환청 발소리 한 세트를 하나의 버퍼로 합성."""
    steps = np.random.randint(2, 5)
    step_gap = 0.22 + np.random.rand() * 0.1
    total_dur = steps * step_gap + 0.2
    _, n = _t(total_dur)
    mix = np.zeros(n)
    pan_side = -1 if np.random.rand() < 0.5 else 1
    pan = pan_side * (0.5 + np.random.rand() * 0.4)
    for i in range(steps):
        start_t = i * step_gap
        start = int(start_t * SR)
        step_n = int(SR * 0.18)
        noise = _noise(step_n) * _exp_decay(step_n, 0.25)
        lp = _onepole_lowpass(noise, 420 + np.random.rand() * 120)
        env = np.ones(step_n)
        a = max(1, int(step_n * 0.08))
        env[:a] = np.linspace(0, 1, a)
        seg = lp * env
        end = min(n, start + step_n)
        mix[start:end] += seg[:end - start]
    return _to_stereo_i16(mix, pan=pan, gain=0.2 * intensity)


def vent_burst():
    dur = 1.2
    _, n = _t(dur)
    noise = _noise(n) * np.minimum(1, np.arange(n) / (n * 0.05)) * _exp_decay(n, 0.55)
    bp = _bandpass(noise, 900, 600)
    osc = _osc(lambda t: 220 * np.exp(-t * 1.8), dur, 'sawtooth')
    osc = _onepole_lowpass(osc, 600) * _lin_env(n, 0.08, 0.7) * 0.4
    mix = bp * 1.2 + osc
    return _to_stereo_i16(mix, gain=0.4)


def flood_gurgle(intensity=0.5):
    dur = 0.5 + np.random.rand() * 0.4
    _, n = _t(dur)
    t_idx = np.arange(n)
    noise = _noise(n) * (0.5 + 0.5 * np.sin(t_idx * 0.04)) * _exp_decay(n, 0.6)
    bp = _bandpass(noise, 500 + np.random.rand() * 300, 300)
    return _to_stereo_i16(bp * 2.0, gain=0.08 + intensity * 0.14)


def whisper_ambience_loop():
    """지속되는 저음 웅얼거림 베드 — 루프 재생 후 볼륨을 sanity에 따라 조절한다."""
    dur = 3.0
    _, n = _t(dur)
    noise = _noise(n)
    bp = _bandpass(noise, 320, 200)
    # 루프 경계에서 클릭 노이즈가 나지 않도록 시작/끝을 부드럽게 페이드
    fade = int(SR * 0.05)
    env = np.ones(n)
    env[:fade] = np.linspace(0, 1, fade)
    env[-fade:] = np.linspace(1, 0, fade)
    return _to_stereo_i16(bp * env * 2.5, gain=0.5)
