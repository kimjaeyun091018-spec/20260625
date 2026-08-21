# 인생네컷 (Insaeng 4-Cut)

브라우저에서 바로 찍는 셀프 인생네컷 부스. 순수 HTML/CSS/JS로만 만들어서
빌드 과정 없이 GitHub Pages에 바로 올릴 수 있어요.

## 기능

- **카메라 권한 게이트**: 처음 접속 시 자동으로 카메라를 켜지 않고, "카메라 켜고 입장하기" 버튼을 눌러야 브라우저의 권한 요청 팝업이 뜹니다.
- **내장 카메라 / 외부 웹캠 선택**: 권한을 허용하면 연결된 카메라 목록을 드롭다운으로 보여주고 바로 전환할 수 있어요.
- **타이머 필수 선택 (3 / 5 / 10초)**: 촬영 버튼을 누르면 선택한 초만큼 카운트다운 후 자동으로 4컷이 순서대로 촬영됩니다(실제 인생네컷 부스와 동일한 흐름).
- **화풍(필터) 선택**: 기본보정 / 아이폰 스타일 / 갤럭시 스타일 / 시네마틱 / 흑백 / 세피아 / 지브리풍(근사) / 지브리풍(AI, 선택) 중 고를 수 있어요.
- **필름 스트립 합성**: 4컷을 프레임 색상과 브랜드 문구를 넣은 세로 필름 스트립 이미지로 합성합니다.
- **저장 / 인쇄**: PNG로 다운로드하거나, 2×6인치(표준 포토 스트립 사이즈)에 맞춰 인쇄할 수 있어요.

## 바로 실행해보기 (로컬)

카메라 권한은 `https://` 또는 `localhost`에서만 동작해요. 파일을 더블클릭해서 여는 `file://` 방식은 카메라 권한이 막힙니다.

```bash
# 이 폴더에서
python3 -m http.server 5500
# 브라우저에서 http://localhost:5500 접속
```

## GitHub에 올리고 웹사이트로 열기 (GitHub Pages)

1. GitHub에서 새 저장소를 만들고, 이 폴더(`index.html`, `style.css`, `script.js`, `README.md`)를 그대로 푸시합니다.

   ```bash
   git init
   git add .
   git commit -m "인생네컷 부스 초기 버전"
   git branch -M main
   git remote add origin https://github.com/<your-id>/<repo-name>.git
   git push -u origin main
   ```

2. GitHub 저장소 → **Settings → Pages** → Source에서 `main` 브랜치, `/ (root)` 폴더를 선택 후 저장.
3. 몇 분 후 `https://<your-id>.github.io/<repo-name>/` 로 접속하면 바로 부스가 열려요.

> GitHub Pages는 기본적으로 `https`로 서비스되기 때문에 카메라 권한 요청이 정상적으로 동작합니다.

## 지브리풍 · AI 화풍 연동 (선택 기능)

캔버스의 `filter` 속성(밝기/채도/블러 등)만으로는 사진을 진짜 지브리 애니메이션 그림체로
바꿀 수 없어요. 그건 이미지 생성/변환 AI 모델(diffusion 계열)의 영역이라, 이 앱은 두 단계로
나눠뒀습니다.

1. **지브리풍 (근사)** — 항상 별도 설정 없이 동작. 채도·대비·블러 조합으로 "그림 같은 느낌"만
   흉내 낸 필터예요. 진짜 AI 변환은 아닙니다.
2. **지브리풍 (AI, 설정 필요)** — 우측 상단 톱니바퀴(⚙) 버튼에서 **AI 엔드포인트**를 등록하면,
   촬영된 사진을 그 엔드포인트로 보내 변환된 이미지를 돌려받습니다.

### 왜 API 키를 앱에 직접 내장하지 않았나요

이 사이트는 정적 페이지라서 서버가 없어요. JS 코드 안에 API 키를 넣으면 누구나 브라우저
개발자 도구로 그 키를 볼 수 있습니다. 그래서:

- **개인용으로만 쓸 거라면**: 설정 모달에 자신의 API 키를 넣고 쓰는 것도 괜찮지만, 그 키는
  이 브라우저의 `localStorage`에만 저장되고 절대 깃허브 저장소나 다른 사람에게 전송되지
  않는다는 점만 알아두세요. 사이트를 다른 사람과 같이 쓴다면 그 사람도 네트워크 탭에서
  키를 볼 수 있으니 공유 계정용 키는 넣지 마세요.
- **여러 사람이 쓰는 배포라면**: 키를 숨길 수 있는 작은 프록시 서버(예: Cloudflare
  Workers, Vercel Edge Function)를 하나 만들어서, 앱은 그 프록시 주소만 호출하도록
  하는 걸 권장해요.

### 엔드포인트 규격

```
POST <your-endpoint>
Content-Type: application/json
Authorization: Bearer <선택, 설정 모달에 키를 넣었을 때만>

{ "image": "data:image/jpeg;base64,...." }
```

응답:

```json
{ "image": "data:image/jpeg;base64,...." }
```

### Cloudflare Worker 프록시 예시 (Replicate 사용)

```js
// worker.js
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { image } = await req.json();

    const create = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.REPLICATE_API_TOKEN}`, // Worker 환경변수에 저장, 절대 클라이언트에 노출 안 됨
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: '<ghibli-style img2img 모델의 version id>',
        input: { image, prompt: 'ghibli anime style' },
      }),
    });
    const prediction = await create.json();

    // 실제로는 polling으로 완료를 기다린 뒤 결과 이미지 URL을 가져와
    // base64로 변환해 돌려주는 로직이 필요합니다 (모델마다 다름).
    // ... polling 생략 ...

    return Response.json({ image: '<변환된 이미지의 data URL>' });
  },
};
```

fal.ai, Stability AI, 또는 자체 호스팅한 스타일 변환 모델도 같은 방식(요청 → base64 이미지,
응답 → base64 이미지)으로 감싸면 그대로 붙일 수 있어요.

## 인쇄 / 폴라로이드 프린터 관련 참고

- **일반/포토 프린터**: OS에 프린터로 등록되어 있으면(USB, Wi-Fi, AirPrint 등)
  "폴라로이드처럼 인쇄" 버튼이 브라우저 인쇄창을 열고, CSS에서 2×6인치 스트립 용지
  크기로 맞춰 인쇄합니다. 감광지/포토 용지를 넣고 인쇄하면 실제 인생네컷 매장과
  비슷한 스트립이 나와요.
- **인스탁스 링크류 블루투스 즉석 프린터**: 이런 기기들은 대부분 자체 앱/SDK를 통해서만
  통신하도록 되어 있어서, 웹 브라우저(getUserMedia나 window.print 같은 표준 API)로는
  직접 제어할 수 없어요. 일부 기기는 WebBluetooth/WebUSB로 실험적인 연동이 가능한
  경우도 있지만, 기기마다 프로토콜이 다르고 공식 지원이 아닌 경우가 많아 안정적인
  범용 구현이 어렵습니다. 특정 프린터 모델이 정해지면, 그 모델의 프로토콜에 맞춰
  WebBluetooth 연동 코드를 별도로 추가하는 방향을 권장해요.

## 폴더 구조

```
insaeng4cut/
├─ index.html
├─ style.css
├─ script.js
└─ README.md
```

## 커스터마이징 힌트

- `script.js`의 `FILTERS` 배열에 항목을 추가/수정하면 화풍 종류를 바꿀 수 있어요.
- `FRAME_COLORS` 배열로 필름 스트립 프레임 색상 프리셋을 바꿀 수 있어요.
- `composeStrip()` 함수의 `CELL_W / CELL_H / FOOTER_H` 값을 바꾸면 스트립 레이아웃(2×2
  그리드 등)으로도 쉽게 바꿀 수 있어요.
