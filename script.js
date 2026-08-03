'use strict';

/* ======================= 상태 ======================= */
const state = {
  stream: null,
  currentDeviceId: null,
  filterId: 'basic',
  shots: [],              // {raw dataURL, filtered dataURL}
  frameColor: '#fff7ea',
  aiEndpoint: '',
  aiKey: '',
  capturing: false,
};

/* ======================= 필터(화풍) 정의 =======================
   css: 라이브 프리뷰 & 캔버스 캡처 시 그대로 사용하는 CSS filter 문자열
   ai: true면 촬영 후 별도로 AI 변환을 시도(엔드포인트 설정 시)          */
const FILTERS = [
  { id: 'original', label: '원본', css: 'none', gradient: 'linear-gradient(135deg,#555,#999)' },
  { id: 'basic', label: '인생네컷 기본보정', css: 'brightness(1.08) contrast(1.06) saturate(1.12)', gradient: 'linear-gradient(135deg,#ffb6d9,#ffd9a0)' },
  { id: 'iphone', label: '아이폰 스타일', css: 'contrast(1.15) brightness(1.04) saturate(1.08)', gradient: 'linear-gradient(135deg,#dfe6f0,#aab8d1)' },
  { id: 'galaxy', label: '갤럭시 스타일', css: 'saturate(1.35) contrast(1.1) brightness(1.05)', gradient: 'linear-gradient(135deg,#7ee0d0,#3f8cff)' },
  { id: 'cinema', label: '시네마틱', css: 'contrast(1.2) saturate(0.9) sepia(0.15) hue-rotate(-8deg)', gradient: 'linear-gradient(135deg,#ff8a4c,#2c5364)' },
  { id: 'mono', label: '흑백', css: 'grayscale(1) contrast(1.1)', gradient: 'linear-gradient(135deg,#eee,#333)' },
  { id: 'sepia', label: '세피아 필름', css: 'sepia(0.6) contrast(1.05) brightness(1.02)', gradient: 'linear-gradient(135deg,#e8c99b,#7a5230)' },
  { id: 'ghibli-approx', label: '지브리풍 (근사)', css: 'saturate(1.3) contrast(0.94) brightness(1.08) blur(0.4px)', gradient: 'linear-gradient(135deg,#a8e6a1,#6ec6ff)' },
  { id: 'ghibli-ai', label: '지브리풍 (AI, 설정 필요)', css: 'saturate(1.3) contrast(0.94) brightness(1.08) blur(0.4px)', gradient: 'linear-gradient(135deg,#c9a8ff,#6ec6ff)', ai: true },
];

const FRAME_COLORS = ['#fff7ea', '#151220', '#ffd6e8', '#d9f2e6', '#e8d9c2'];

/* ======================= DOM ======================= */
const $ = (sel) => document.querySelector(sel);
const gate = $('#gate'), booth = $('#booth'), result = $('#result');
const askPermissionBtn = $('#askPermissionBtn');
const gateStatus = $('#gateStatus');
const video = $('#video');
const captureCanvas = $('#captureCanvas');
const deviceSelect = $('#deviceSelect');
const filterScroll = $('#filterScroll');
const captureBtn = $('#captureBtn');
const resetShotsBtn = $('#resetShotsBtn');
const flashEl = $('#flash');
const countdownNum = $('#countdownNum');
const shotProgress = $('#shotProgress');
const thumbRail = $('#thumbRail');
const stageHint = $('#stageHint');
const stripCanvas = $('#stripCanvas');
const brandText = $('#brandText');
const frameSwatches = $('#frameSwatches');
const downloadBtn = $('#downloadBtn');
const printBtn = $('#printBtn');
const retakeBtn = $('#retakeBtn');
const settingsBtn = $('#settingsBtn');
const settingsModal = $('#settingsModal');
const aiEndpointInput = $('#aiEndpoint');
const aiKeyInput = $('#aiKey');
const saveSettingsBtn = $('#saveSettingsBtn');
const closeSettingsBtn = $('#closeSettingsBtn');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================= 0. 권한 게이트 ======================= */
askPermissionBtn.addEventListener('click', async () => {
  askPermissionBtn.disabled = true;
  gateStatus.textContent = '카메라 권한을 확인하는 중...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    state.stream = stream;
    video.srcObject = stream;
    await populateDeviceList();
    gate.classList.add('hidden');
    booth.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    askPermissionBtn.disabled = false;
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      gateStatus.textContent = '카메라 권한이 거부됐어요. 브라우저 설정에서 허용 후 다시 시도해주세요.';
    } else if (err.name === 'NotFoundError') {
      gateStatus.textContent = '연결된 카메라(웹캠)를 찾지 못했어요. 카메라를 연결한 뒤 다시 시도해주세요.';
    } else {
      gateStatus.textContent = '카메라를 여는 중 문제가 생겼어요: ' + err.message;
    }
  }
});

async function populateDeviceList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === 'videoinput');
  deviceSelect.innerHTML = '';
  cams.forEach((cam, i) => {
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `카메라 ${i + 1}`;
    deviceSelect.appendChild(opt);
  });
  if (cams.length) state.currentDeviceId = cams[0].deviceId;
}

deviceSelect.addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
    audio: false,
  });
  state.stream = stream;
  state.currentDeviceId = deviceId;
  video.srcObject = stream;
});

/* ======================= 화풍(필터) 선택 ======================= */
function renderFilters() {
  filterScroll.innerHTML = '';
  FILTERS.forEach((f) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (f.id === state.filterId ? ' active' : '');
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', f.id === state.filterId ? 'true' : 'false');
    chip.innerHTML = `<span class="swatch" style="background:${f.gradient}; filter:${f.css === 'none' ? 'none' : f.css}"></span><span>${f.label}</span>`;
    chip.addEventListener('click', () => selectFilter(f.id));
    filterScroll.appendChild(chip);
  });
}

function selectFilter(id) {
  state.filterId = id;
  const f = FILTERS.find((x) => x.id === id);
  video.style.filter = f.css;
  renderFilters();
}

/* ======================= 촬영 시퀀스 (자동 4컷) ======================= */
captureBtn.addEventListener('click', runCaptureSequence);
resetShotsBtn.addEventListener('click', resetShots);

function resetShots() {
  state.shots = [];
  thumbRail.innerHTML = '';
  shotProgress.querySelectorAll('.dot').forEach((d) => d.classList.remove('done', 'active'));
  resetShotsBtn.hidden = true;
  stageHint.textContent = '촬영 버튼을 누르면 4컷이 자동으로 이어서 찍혀요';
}

async function runCaptureSequence() {
  if (state.capturing) return;
  state.capturing = true;
  captureBtn.disabled = true;
  resetShots();
  resetShotsBtn.hidden = false;

  const timerSeconds = Number(document.querySelector('input[name="timer"]:checked').value);
  const filter = FILTERS.find((f) => f.id === state.filterId);

  for (let i = 0; i < 4; i++) {
    markActiveDot(i);
    stageHint.textContent = `${i + 1}번째 컷 준비 중...`;
    await countdownFrom(timerSeconds);
    await takeSingleShot(filter);
    markDoneDot(i);
    if (i < 3) {
      stageHint.textContent = '다음 컷을 준비할게요';
      await sleep(1100);
    }
  }

  stageHint.textContent = '네컷 완성! 결과로 이동할게요';
  await sleep(600);
  composeStrip();
  showResultScreen();

  state.capturing = false;
  captureBtn.disabled = false;
}

function markActiveDot(i) {
  shotProgress.querySelectorAll('.dot').forEach((d, idx) => {
    d.classList.toggle('active', idx === i);
  });
}
function markDoneDot(i) {
  shotProgress.querySelectorAll('.dot')[i].classList.remove('active');
  shotProgress.querySelectorAll('.dot')[i].classList.add('done');
}

async function countdownFrom(seconds) {
  for (let n = seconds; n >= 1; n--) {
    countdownNum.textContent = n;
    countdownNum.classList.remove('show');
    // 리플로우로 애니메이션 재시작
    void countdownNum.offsetWidth;
    countdownNum.classList.add('show');
    await sleep(1000);
  }
}

async function takeSingleShot(filter) {
  flashEl.classList.remove('on');
  void flashEl.offsetWidth;
  flashEl.classList.add('on');

  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 960;
  captureCanvas.width = w;
  captureCanvas.height = h;
  const ctx = captureCanvas.getContext('2d');
  ctx.save();
  ctx.filter = filter.css;
  // 미러링된 미리보기와 동일하게 좌우 반전해서 캡처
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  let dataURL = captureCanvas.toDataURL('image/jpeg', 0.92);

  if (filter.ai && state.aiEndpoint) {
    stageHint.textContent = 'AI 화풍으로 변환하는 중...';
    try {
      const aiResult = await convertWithAI(dataURL);
      if (aiResult) dataURL = aiResult;
    } catch (err) {
      console.warn('AI 변환 실패, 근사 필터로 대체합니다.', err);
    }
  }

  state.shots.push(dataURL);
  const thumb = document.createElement('img');
  thumb.src = dataURL;
  thumb.alt = `촬영 ${state.shots.length}컷`;
  thumbRail.appendChild(thumb);

  await sleep(150);
}

/* ======================= AI 화풍 변환 (선택 기능) =======================
   정적 사이트에서는 API 키를 안전하게 숨길 수 없으므로,
   사용자가 본인 브라우저에만 저장하는 개인 프록시 엔드포인트를 호출한다.
   요청: POST { image: dataURL }
   응답: { image: dataURL } (변환된 이미지)                                */
async function convertWithAI(dataURL) {
  if (!state.aiEndpoint) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (state.aiKey) headers['Authorization'] = `Bearer ${state.aiKey}`;
    const res = await fetch(state.aiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: dataURL }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI 엔드포인트 응답 오류: ${res.status}`);
    const json = await res.json();
    return json.image || null;
  } finally {
    clearTimeout(timeout);
  }
}

/* ======================= 결과: 필름 스트립 합성 ======================= */
function showResultScreen() {
  booth.classList.add('hidden');
  result.classList.remove('hidden');
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function composeStrip() {
  const PAD = 24;
  const CELL_W = 600;
  const CELL_H = 440;
  const GAP = 18;
  const FOOTER_H = 140;
  const w = CELL_W + PAD * 2;
  const h = PAD + (CELL_H + GAP) * 4 + FOOTER_H;

  stripCanvas.width = w;
  stripCanvas.height = h;
  const ctx = stripCanvas.getContext('2d');

  ctx.fillStyle = state.frameColor;
  ctx.fillRect(0, 0, w, h);

  const isDark = isColorDark(state.frameColor);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';

  for (let i = 0; i < 4; i++) {
    const y = PAD + i * (CELL_H + GAP);
    if (!state.shots[i]) continue;
    const img = await loadImage(state.shots[i]);
    drawCover(ctx, img, PAD, y, CELL_W, CELL_H);
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, y, CELL_W, CELL_H);
  }

  // 하단 브랜드 문구 + 날짜
  const footerY = h - FOOTER_H;
  ctx.fillStyle = isDark ? '#fff7ea' : '#151220';
  ctx.textAlign = 'center';
  ctx.font = "600 34px 'Do Hyeon', sans-serif";
  ctx.fillText(brandText.value || 'LIFE 4 CUT', w / 2, footerY + 58);

  ctx.font = "400 20px 'IBM Plex Mono', monospace";
  ctx.globalAlpha = 0.7;
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  ctx.fillText(dateStr, w / 2, footerY + 92);
  ctx.globalAlpha = 1;
}

function drawCover(ctx, img, dx, dy, dw, dh) {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sx, sy, sw, sh;
  if (ir > dr) {
    sh = img.height;
    sw = sh * dr;
    sy = 0;
    sx = (img.width - sw) / 2;
  } else {
    sw = img.width;
    sh = sw / dr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function isColorDark(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/* ======================= 결과 화면 컨트롤 ======================= */
function renderFrameSwatches() {
  frameSwatches.innerHTML = '';
  FRAME_COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch-btn' + (color === state.frameColor ? ' active' : '');
    btn.style.background = color;
    btn.addEventListener('click', () => {
      state.frameColor = color;
      renderFrameSwatches();
      composeStrip();
    });
    frameSwatches.appendChild(btn);
  });
}

brandText.addEventListener('input', () => composeStrip());

downloadBtn.addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `insaeng4cut-${Date.now()}.png`;
  link.href = stripCanvas.toDataURL('image/png');
  link.click();
});

printBtn.addEventListener('click', () => window.print());

retakeBtn.addEventListener('click', () => {
  result.classList.add('hidden');
  booth.classList.remove('hidden');
  resetShots();
});

/* ======================= 설정(AI) 모달 ======================= */
settingsBtn.addEventListener('click', () => {
  aiEndpointInput.value = state.aiEndpoint;
  aiKeyInput.value = state.aiKey;
  settingsModal.classList.remove('hidden');
});
closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
saveSettingsBtn.addEventListener('click', () => {
  state.aiEndpoint = aiEndpointInput.value.trim();
  state.aiKey = aiKeyInput.value.trim();
  localStorage.setItem('insaeng4cut_ai_endpoint', state.aiEndpoint);
  localStorage.setItem('insaeng4cut_ai_key', state.aiKey);
  settingsModal.classList.add('hidden');
});

function loadSettings() {
  state.aiEndpoint = localStorage.getItem('insaeng4cut_ai_endpoint') || '';
  state.aiKey = localStorage.getItem('insaeng4cut_ai_key') || '';
}

/* ======================= 초기화 ======================= */
loadSettings();
renderFilters();
renderFrameSwatches();
