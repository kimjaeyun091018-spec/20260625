# 인생네컷 — Web Photo Booth 📸

웹캠으로 4컷을 찍어 한 장의 **포토 스트립**으로 만들어 저장하는 인생네컷 웹앱입니다.
빌드 과정 없이 정적 파일 3개로 동작하고, **GitHub Pages**에 그대로 올리면 바로 쓸 수 있어요.

촬영·합성·저장은 전부 브라우저 안에서만 처리되며, 사진은 어떤 서버로도 전송되지 않습니다.

## 기능

- 웹캠 라이브 미리보기 (셀카 거울 모드)
- 3·2·1 카운트다운 + 플래시와 함께 **4컷 자동 촬영**
- 필터 6종 (원본 / 화사 / 흑백 / 세피아 / 빈티지 / 쿨톤)
- 프레임 색상 6종, 하단 문구 직접 입력, 날짜 자동
- 찍는 동안 오른쪽 스트립이 실시간으로 채워짐
- 완성본 **PNG 저장**
- 카메라가 없으면 **사진 업로드**로 4컷 만들기

## 파일 구성

```
insaeng-4cut/
├─ index.html   # 화면 구조
├─ style.css    # 디자인
├─ script.js    # 카메라 · 촬영 · 합성 · 저장
└─ README.md
```

## 바로 실행 (로컬)

카메라(getUserMedia)는 보안 컨텍스트에서만 동작합니다. `index.html`을 더블클릭해 `file://`로 열면
카메라가 막히니, 간단한 로컬 서버로 여세요.

```bash
# Python 3
python3 -m http.server 8000
# 또는 Node
npx serve .
```

브라우저에서 `http://localhost:8000` 접속 → **카메라 켜기** → **4컷 촬영**.
(`localhost`는 보안 컨텍스트로 취급되어 카메라가 허용됩니다.)

## GitHub Pages에 올리기

1. GitHub에서 새 저장소를 만들고 이 폴더의 파일들을 그대로 올립니다.

   ```bash
   git init
   git add .
   git commit -m "인생네컷 web photo booth"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```

2. 저장소 **Settings → Pages** 로 이동합니다.
3. **Source** 를 `Deploy from a branch`, 브랜치를 `main` / 폴더 `/ (root)` 로 설정하고 저장합니다.
4. 잠시 뒤 `https://<사용자명>.github.io/<저장소명>/` 에서 열립니다.
   GitHub Pages는 HTTPS라서 카메라 권한이 정상적으로 동작합니다.

## 커스터마이즈

- **필터 추가**: `script.js`의 `FILTERS` 배열에 `{ id, label, css }` 추가 (css는 CSS `filter` 문법).
- **프레임 색 추가**: `FRAMES` 배열에 `{ id, color, dark }` 추가 (어두운 색은 `dark: true`).
- **컷 비율/크기**: `CUT_W`, `CUT_H` 상수 수정 (예: 정사각형은 `720 / 720`).
- **컬러·폰트 톤**: `style.css` 상단 `:root` 변수에서 일괄 변경.

## 참고

- 권장 브라우저: 최신 Chrome / Edge / Safari / Firefox.
- 카메라 필터는 `CanvasRenderingContext2D.filter`를 사용합니다. 지원하지 않는 일부 구형 브라우저에서는
  미리보기에만 필터가 적용되고 저장본에는 적용되지 않을 수 있습니다.
- iOS Safari는 `playsinline` 속성 덕분에 인라인 재생이 됩니다.

## License

MIT
