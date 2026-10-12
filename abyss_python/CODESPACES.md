# GitHub Codespaces로 실행하기

이 폴더에는 Codespaces에서 바로 pygame 창을 **브라우저로 볼 수 있게**
`.devcontainer` 설정이 들어 있습니다. (가상 디스플레이 + noVNC 화면 공유)

## 1. GitHub에 올리기

1. github.com에서 새 저장소(Repository)를 만듭니다 (Public/Private 아무거나 OK).
2. 이 `abyss_python` 폴더 전체(안의 `.devcontainer` 폴더 포함)를 그 저장소에
   업로드합니다. (웹에서 드래그&드롭으로 업로드해도 되고, `git push`로 올려도 됩니다.
   `.devcontainer`로 시작하는 폴더는 숨김처리되어 안 보일 수 있으니, 파일 탐색기에서
   "숨김 파일 표시"를 켜고 확인해주세요.)

## 2. Codespace 실행

1. 저장소 페이지에서 초록색 **Code** 버튼 → **Codespaces** 탭 →
   **Create codespace on main** 클릭.
2. 처음 빌드에는 1~3분 정도 걸립니다 (pygame/numpy 설치 + 화면 환경 구성).
3. 빌드가 끝나면 아래쪽에 **PORTS** 탭이 보입니다. `6080`번 포트 옆
   지구본(🌐) 아이콘을 눌러 브라우저 새 탭으로 엽니다.
4. 비밀번호를 물으면 `abyss` 입력 → 검은 바탕의 가상 데스크톱 화면이 뜹니다.
   (이 탭을 열어둔 채로 다음 단계를 진행하세요. 게임 창이 여기에 나타납니다.)

## 3. 게임 실행

1. Codespaces 화면의 **터미널**(아래쪽 TERMINAL 탭)에서:

   ```bash
   cd abyss_python   # 저장소 최상위가 아니라면 폴더 이름에 맞게 이동
   export DISPLAY=:1
   python3 abyss_topdown.py
   ```

2. 방금 열어둔 noVNC 브라우저 탭을 보면 게임 창이 떠 있을 것입니다.
   그 탭 안에서 마우스 클릭 → 키보드(WASD/스페이스/E)로 조작하면 됩니다.
   (키 입력이 안 먹으면 먼저 그 탭 안의 게임 창을 한 번 클릭해서 포커스를 주세요.)

3. 종료하려면 터미널에서 `Ctrl + C`.

## 문제가 생기면

- **`ModuleNotFoundError: No module named 'pygame'`** → 터미널에 직접
  `pip install -r requirements.txt` 실행.
- **창이 안 뜨고 멈춰 있음** → `export DISPLAY=:1`을 빠뜻했는지 확인.
  (매 터미널 세션마다 다시 입력해야 합니다.)
- **소리가 안 들림** → 가상 디스플레이 환경엔 오디오 장치가 없어서 정상입니다.
  게임 자체는 무음으로 계속 진행됩니다 (README의 "오디오 장치가 없는 환경" 참고).
- **noVNC 화면이 너무 작음/안 맞음** → noVNC 왼쪽 사이드바 톱니바퀴에서
  해상도 설정을 조절할 수 있습니다.
