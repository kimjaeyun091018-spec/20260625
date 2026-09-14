# Team Vault — 포켓몬 챔피언스 팀 저장소

싱글/더블 배틀용 팀 구성을 만들고 저장하는 정적 웹사이트입니다. 서버 없이
GitHub Pages만으로 동작하고, 종족·특성·기술 데이터는 [PokeAPI](https://pokeapi.co)에서
실시간으로 가져옵니다.

## 로컬에서 미리보기

정적 파일이라 별도 빌드 과정이 없습니다. 다만 `fetch()`로 `data/*.json`을 읽기 때문에
`file://`로 그냥 열면 브라우저가 막을 수 있어요. 아무 로컬 서버로 열어주세요.

```bash
cd poke-champions-site
python3 -m http.server 8000
# http://localhost:8000 접속
```

## GitHub Pages로 배포하기

1. 이 폴더 전체를 새 GitHub 저장소에 푸시합니다.
   ```bash
   git init
   git add .
   git commit -m "Team Vault 초기 배포"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Source**를 `Deploy from a branch`로 두고, 브랜치는 `main`, 폴더는 `/ (root)`를 선택합니다.
4. 잠시 후 `https://<사용자명>.github.io/<저장소명>/`에서 사이트가 열립니다.

## 폴더 구조

```
poke-champions-site/
├── index.html          # 갤러리(팀 목록) 페이지
├── builder.html         # 팀 빌더 페이지
├── css/style.css
├── js/
│   ├── pokeapi.js       # PokeAPI 연동 + 로컬 캐시
│   ├── storage.js       # 내 팀 localStorage 저장/내보내기
│   ├── gallery.js
│   └── builder.js
└── data/
    ├── index.json        # 공개 샘플 팀 파일 목록
    └── teams/*.json       # 공개 샘플 팀 데이터
```

## 저장 방식 (현재: 정적)

- **내 팀**: 빌더에서 "내 브라우저에 저장"을 누르면 `localStorage`에 저장됩니다.
  본인 브라우저에서만 보이고, 다른 사람과 자동으로 공유되지 않습니다.
- **공개 샘플 팀**: 갤러리의 "샘플 팀" 탭은 `data/teams/`에 커밋된 JSON 파일을 읽습니다.
  내 팀을 공개 샘플로 올리려면:
  1. 빌더에서 "JSON으로 내보내기"로 파일을 받습니다.
  2. 받은 파일을 `data/teams/`에 넣습니다.
  3. `data/index.json`의 `teams` 배열에 파일명을 추가합니다.
  4. 커밋 후 푸시하면 GitHub Pages에 반영됩니다.

## 나중에 "누구나 웹에서 저장" 가능하게 확장하려면

지금은 GitHub에 직접 커밋해야 공개 샘플에 올라가는 구조입니다. 나중에 누구나
브라우저에서 바로 저장하게 하려면 아래 중 하나를 붙이면 됩니다 (둘 다 이 정적
프런트엔드 구조를 거의 그대로 유지한 채 추가 가능합니다):

- **Cloudflare Workers + KV / D1**, 또는 **Supabase**: 작은 API 하나를 두고
  `builder.js`의 저장 버튼이 `localStorage` 대신 그 API를 호출하도록 바꿉니다.
- **GitHub API + Personal Access Token 대신 GitHub App/OAuth 흐름**을 이용해
  사용자가 자기 이름으로 `data/teams/`에 커밋하게 만드는 방식 (PokeAPI처럼
  정적 파일 기반 구조를 유지하면서 "진짜 저장"을 지원).

## 데이터 출처 및 저작권

- 포켓몬 종족/특성/기술 데이터: [PokeAPI](https://pokeapi.co) (CC 라이선스, 팬 프로젝트)
- Pokémon, Pokémon Champions 및 관련 상표는 Nintendo / Creatures / GAME FREAK / The Pokémon Company의 자산입니다.
  이 사이트는 비공식 팬 제작 도구입니다.
