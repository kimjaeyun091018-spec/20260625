/**
 * worker-gemini.js
 * ------------------------------------------------------------
 * 인생네컷 앱의 "AI 화풍" 엔드포인트 규격에 맞춘 Cloudflare Worker 프록시.
 * 요청  : POST { "image": "data:image/jpeg;base64,....", "style": "ghibli" | "webtoon" }
 * 응답  : { "image": "data:image/jpeg;base64,...." }
 *
 * 배포 방법
 * 1) npm install -g wrangler
 * 2) wrangler login
 * 3) 이 폴더에서: wrangler init (또는 기존 프로젝트에 이 파일만 추가)
 * 4) 환경변수(Secret) 등록:  wrangler secret put GEMINI_API_KEY
 *    -> Google AI Studio(https://aistudio.google.com/apikey)에서 발급받은 키 입력
 * 5) wrangler deploy
 * 6) 배포된 https://<worker-name>.<subdomain>.workers.dev 주소를
 *    인생네컷 앱의 설정(⚙) 모달 "AI 엔드포인트"에 입력
 *
 * 주의: Gemini 이미지 생성 모델명/엔드포인트는 Google이 자주 갱신합니다(예: 2026년 6월
 *       gemini-2.0-flash 계열 종료). 호출이 계속 실패하면 아래 순서로 확인하세요.
 *       1) `wrangler tail` 실행 후 사이트에서 다시 촬영 → 실제 Gemini 에러 메시지 확인
 *       2) https://ai.google.dev/gemini-api/docs/models 에서 최신 이미지 생성 모델명 확인
 *       3) 아래 MODEL 상수를 그 모델명으로 교체 후 `wrangler deploy`
 * ------------------------------------------------------------ */

const MODEL = 'gemini-3.1-flash-image';

const PROMPTS = {
  ghibli:
    '이 사진을 스튜디오 지브리 애니메이션 화풍의 삽화처럼 다시 그려줘. ' +
    '인물의 얼굴, 포즈, 옷차림, 배경 구도는 최대한 유지하고, 부드러운 색감과 손그림 느낌, ' +
    '따뜻한 조명만 지브리 스타일로 입혀줘.',
  webtoon:
    '이 사진을 한국 웹툰/만화 스타일의 셀 셰이딩(cel-shading) 일러스트로 다시 그려줘. ' +
    '인물의 얼굴, 포즈, 옷차림, 배경 구도는 최대한 유지하고, 뚜렷한 검은 윤곽선, 평면적이고 ' +
    '쨍한 색면 채색, 웹툰 특유의 깔끔한 선화 느낌으로 바꿔줘.',
};

export default {
  async fetch(request, env) {
    // CORS preflight (브라우저에서 직접 호출할 경우 대비)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST 요청만 지원합니다.' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: '요청 본문이 JSON이 아닙니다.' }, 400);
    }

    const dataUrl = body.image;
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      return json({ error: 'image 필드(data URL)가 필요합니다.' }, 400);
    }

    const prompt = PROMPTS[body.style] || PROMPTS.ghibli;

    const [, mimeType, base64Data] = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) || [];
    if (!base64Data) return json({ error: 'image data URL 형식이 올바르지 않습니다.' }, 400);

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.log(`Gemini API 오류: ${geminiRes.status} ${errText}`); // wrangler tail로 확인 가능
      return json({ error: `Gemini API 오류: ${geminiRes.status} ${errText}` }, 502);
    }

    const result = await geminiRes.json();
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData || p.inline_data);
    const inline = imagePart?.inlineData || imagePart?.inline_data;

    if (!inline?.data) {
      return json({ error: 'Gemini 응답에서 이미지를 찾지 못했습니다.' }, 502);
    }

    const outMime = inline.mimeType || inline.mime_type || 'image/png';
    return json({ image: `data:${outMime};base64,${inline.data}` });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*', // 필요하면 본인 github.io 도메인으로 제한하세요
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
