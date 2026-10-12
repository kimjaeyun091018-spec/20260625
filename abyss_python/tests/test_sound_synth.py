import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import sound_synth as S

failures = 0
def check(name, cond):
    global failures
    status = 'PASS' if cond else 'FAIL'
    print(f'[{status}] {name}')
    if not cond:
        failures += 1

fns = [
    ('glass_crack', lambda: S.glass_crack(0.7)),
    ('door_thud', lambda: S.door_thud()),
    ('key_found', lambda: S.key_found()),
    ('crack_whisper', lambda: S.crack_whisper()),
    ('whisper_burst', lambda: S.whisper_burst(0.5)),
    ('footstep_walk', lambda: S.footstep(False)),
    ('footstep_run', lambda: S.footstep(True)),
    ('door_open', lambda: S.door_open()),
    ('door_close', lambda: S.door_close()),
    ('phantom_footstep_group', lambda: S.phantom_footstep_group(0.6)),
    ('vent_burst', lambda: S.vent_burst()),
    ('flood_gurgle', lambda: S.flood_gurgle(0.5)),
    ('whisper_ambience_loop', lambda: S.whisper_ambience_loop()),
]

for name, fn in fns:
    try:
        arr = fn()
        ok_shape = arr.ndim == 2 and arr.shape[1] == 2
        ok_dtype = arr.dtype == np.int16
        ok_finite = np.all(np.isfinite(arr))
        ok_range = arr.max() <= 32767 and arr.min() >= -32768
        ok_nonzero = np.abs(arr).max() > 0  # not pure silence
        check(f'{name}: shape {arr.shape} is (n,2)', ok_shape)
        check(f'{name}: dtype int16', ok_dtype)
        check(f'{name}: no NaN/inf', ok_finite)
        check(f'{name}: within int16 range', ok_range)
        check(f'{name}: not silent', ok_nonzero)
    except Exception as e:
        check(f'{name}: raised exception: {e}', False)

# Determinism/variation check: two whisper bursts should differ (randomized)
a = S.whisper_burst(0.5)
b = S.whisper_burst(0.5)
check('whisper_burst produces varied output across calls', not np.array_equal(a, b) or a.shape != b.shape)

print()
print('TOTAL FAILURES:', failures)
sys.exit(1 if failures else 0)
