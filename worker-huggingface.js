/**
 * worker-huggingface.js
 * ------------------------------------------------------------
 * 인생네컷 앱의 "AI 화풍" 엔드포인트 규격에 맞춘 Cloudflare Worker 프록시.
 * Gemini(유료 전환 필요)와 달리, Hugging Face의 무료 서버리스 추론 API를
 * 사용해서 카드 등록 없이 쓸 수 있다. Stable Diffusion img2img 방식으로,
 * 원본 사진을 얼마나 남길지(strength)를 직접 조절해 화풍만 바꾼다.
 *
 * 요청  : POST { "image": "data:image/jpeg;base64,....", "style": "ghibli" | "webtoon" }
 * 응답  : { "image": "data:image/jpeg;base64,...." }
 *
 * 배포 방법
 * 1) npm install -g wrangler   (이미 설치했다면 생략)
 * 2) wrangler login
 * 3) 이 파일과 wrangler.toml을 같은 폴더에 두고: wrangler secret put HF_TOKEN
 *    -> https://huggingface.co/settings/tokens 에서 발급받은 토큰(hf_...) 입력
 * 4) wrangler deploy
 *
 * 주의사항
 * - 2025년 말부터 Hugging Face가 옛 주소(api-inference.huggingface.co)를 완전히
 *   폐기하고 router.huggingface.co로 통합했다. 이 파일은 새 주소를 쓴다.
 * - 무료 등급이라 시간당 요청 수 제한이 있고, 사람이 몰리면 응답이
 *   느려지거나 일시적으로 실패할 수 있다. 실패 시 앱은 자동으로
 *   "근사" 필터로 대체하니 서비스 자체가 멈추진 않는다.
 * - 모델이 오랫동안 호출되지 않았다면 첫 요청이 콜드 스타트로
 *   10~30초 걸릴 수 있다 (options.wait_for_model로 대기하도록 처리해둠).
 * - Hugging Face가 모델/엔드포인트 구조를 바꿀 수 있으니, 호출이 계속
 *   실패하면 https://huggingface.co/timbrooks/instruct-pix2pix 모델
 *   페이지에서 현재 API 규격을 다시 확인하자.
 * ------------------------------------------------------------ */

const HF_MODEL = 'runwayml/stable-diffusion-v1-5';

// strength: 원본을 얼마나 남길지(0에 가까울수록 원본 유지, 1에 가까울수록 완전히 새로 그림)
// 얼굴 형태를 어느 정도 유지하면서 화풍만 바꾸려면 0.45~0.6 사이가 무난하다.
// 결과가 너무 원본 그대로면 값을 올리고, 너무 다른 사람처럼 나오면 값을 내려서 조절하자.
const STRENGTH = 0.5;

const PROMPTS = {
  ghibli: 'anime illustration in the style of Studio Ghibli, soft pastel watercolor colors, hand-painted background, gentle warm lighting, detailed face, portrait of a person, masterpiece, high quality',
  webtoon: 'Korean webtoon comic illustration, bold clean black outlines, flat cel-shaded colors, vibrant saturated colors, detailed face, portrait of a person, masterpiece, high quality',
};

export default {
  async fetch(request, env) {
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
    const [, , base64Data] = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) || [];
    if (!base64Data) return json({ error: 'image data URL 형식이 올바르지 않습니다.' }, 400);

    const prompt = PROMPTS[body.style] || PROMPTS.ghibli;

    const hfRes = await fetch(`https://router.huggingface.co/hf-inference/models/${HF_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: base64Data,
        parameters: {
          prompt,
          negative_prompt: 'blurry, low quality, distorted face, deformed, extra limbs, watermark, text',
          strength: STRENGTH,
          guidance_scale: 7.5,
          num_inference_steps: 30,
        },
        options: { wait_for_model: true },
      }),
    });

    if (!hfRes.ok) {
      const errText = await hfRes.text();
      console.log(`HF API 오류: ${hfRes.status} ${errText}`); // wrangler tail로 확인 가능
      return json({ error: `HF API 오류: ${hfRes.status} ${errText}` }, 502);
    }

    // 성공 시 보통 이미지 바이너리를 그대로 응답한다
    const contentType = hfRes.headers.get('content-type') || 'image/jpeg';
    const buf = await hfRes.arrayBuffer();
    const outBase64 = arrayBufferToBase64(buf);
    return json({ image: `data:${contentType};base64,${outBase64}` });
  },
};

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
