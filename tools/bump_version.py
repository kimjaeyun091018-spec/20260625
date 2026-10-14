"""index.html의 버전 번호를 바꿉니다 (새로 올리기 전에 실행).

브라우저와 GitHub Pages는 파일을 몇 분씩 저장(캐시)해 둡니다. 그래서 새 index.html과
예전 main.js가 섞이면 게임이 멈출 수 있어요. 버전 번호가 바뀌면 브라우저가 새 파일을 받습니다.

실행: python tools/bump_version.py
"""
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = ROOT / 'index.html'
version = time.strftime('%Y%m%d%H%M')
text = html.read_text(encoding='utf-8')
text = re.sub(r'\?v=[0-9a-z]+', f'?v={version}', text)
text = re.sub(r"__ASSET_V = '[0-9a-z]+'", f"__ASSET_V = '{version}'", text)
html.write_text(text, encoding='utf-8')
print('version', version)
