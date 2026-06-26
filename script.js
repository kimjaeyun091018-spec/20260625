/* ============================================================
   인생네컷 — Web Photo Booth (vanilla JS)
   - 웹캠 4컷 자동 촬영 + 카운트다운/플래시
   - 필터 / 프레임 색상 / 하단 문구
   - 4컷을 하나의 포토 스트립으로 합성해 PNG 저장
   - 카메라가 없으면 이미지 업로드로 대체
   모든 처리는 브라우저 안에서만 이뤄지고 어디에도 전송되지 않음.
   ============================================================ */

const CUT_W = 720;
const CUT_H = 540;          // 4:3 한 컷
const PAD = 28, GAP = 16, TOP = 28, FOOTER = 96;

const FILTERS = [
  { id: "none",    label: "원본",   css: "none" },
  { id: "bright",  label: "화사",   css: "brightness(1.1) saturate(1.18) contrast(1.04)" },
  { id: "mono",    label: "흑백",   css: "grayscale(1) contrast(1.05)" },
  { id: "sepia",   label: "세피아", css: "sepia(0.55) contrast(1.05)" },
  { id: "vintage", label: "빈티지", css: "sepia(0.32) saturate(1.3) contrast(1.08) brightness(0.96)" },
  { id: "cool",    label: "쿨톤",   css: "saturate(1.12) hue-rotate(-10deg) brightness(1.04)" },
];

const FRAMES = [
  { id: "white",    color: "#ffffff", dark: false },
  { id: "black",    color: "#1a1a1a", dark: true  },
  { id: "coral",    color: "#f15a3b", dark: true  },
  { id: "cream",    color: "#f1e6cf", dark: false },
  { id: "mint",     color: "#a7e3cc", dark: false },
  { id: "lavender", color: "#cdbce8", dark: false },
];

const state = {
  stream: null,
  captures: [],            // HTMLCanvasElement[] (각 컷, CUT_W×CUT_H)
  filter: FILTERS[0],
  frame: FRAMES[0],
  busy: false,
};

const $ = (id) => document.getElementById(id);
const dom = {
  cam: document.querySelector(".cam"),
  video: $("video"),
  countdown: $("countdown"),
  flash: $("flash"),
  rec: $("recBadge"),
  filterChips: $("filterChips"),
  frameSwatches: $("frameSwatches"),
  caption: $("captionInput"),
  startBtn: $("startBtn"),
  shootBtn: $("shootBtn"),
  resetBtn: $("resetBtn"),
  uploadInput: $("uploadInput"),
  saveBtn: $("saveBtn"),
  note: $("resultNote"),
  strip: $("strip"),
  cuts: [...document.querySelectorAll(".cut")],
  stripCaption: $("stripCaption"),
  stripDate: $("stripDate"),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- init ---------- */
function init() {
  // 필터 칩
  FILTERS.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "chip" + (i === 0 ? " is-active" : "");
    b.textContent = f.label;
    b.addEventListener("click", () => selectFilter(f, b));
    dom.filterChips.appendChild(b);
  });

  // 프레임 스와치
  FRAMES.forEach((f, i) => {
    const b = document.createElement("button");
    b.className = "swatch" + (i === 0 ? " is-active" : "");
    b.style.background = f.color;
    b.setAttribute("aria-label", `프레임 ${f.id}`);
    b.addEventListener("click", () => selectFrame(f, b));
    dom.frameSwatches.appendChild(b);
  });

  applyFrame();
  dom.stripDate.textContent = fmtDate();

  dom.caption.addEventListener("input", () => {
    dom.stripCaption.textContent = dom.caption.value || " ";
  });

  dom.startBtn.disabled = false;
  dom.startBtn.addEventListener("click", startCamera);
  dom.shootBtn.addEventListener("click", runShoot);
  dom.resetBtn.addEventListener("click", reset);
  dom.saveBtn.addEventListener("click", saveImage);
  dom.uploadInput.addEventListener("change", handleUpload);
}

/* ---------- filter / frame ---------- */
function selectFilter(f, btn) {
  state.filter = f;
  dom.filterChips.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
  btn.classList.add("is-active");
  dom.video.style.filter = f.css;
}

function selectFrame(f, btn) {
  state.frame = f;
  dom.frameSwatches.querySelectorAll(".swatch").forEach((c) => c.classList.remove("is-active"));
  btn.classList.add("is-active");
  applyFrame();
}

function applyFrame() {
  dom.strip.style.setProperty("--frame", state.frame.color);
  dom.strip.classList.toggle("is-dark", state.frame.dark);
}

/* ---------- camera ---------- */
async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    dom.video.srcObject = state.stream;
    await dom.video.play();

    dom.cam.classList.add("is-on");
    dom.video.style.filter = state.filter.css;
    setRec("READY", false);

    dom.shootBtn.disabled = false;
    dom.resetBtn.disabled = false;
    dom.startBtn.textContent = "카메라 켜짐";
    dom.startBtn.disabled = true;
  } catch (err) {
    note(cameraError(err), true);
  }
}

function cameraError(err) {
  if (location.protocol === "file:")
    return "브라우저 보안 정책상 file:// 에서는 카메라가 막혀요. 사진 업로드를 쓰거나, 로컬 서버/깃허브 페이지에서 열어주세요.";
  if (err && err.name === "NotAllowedError")
    return "카메라 권한이 거부됐어요. 주소창의 권한을 허용으로 바꾸거나 사진을 업로드해 주세요.";
  if (err && err.name === "NotFoundError")
    return "카메라를 찾지 못했어요. 사진 업로드로 만들어 보세요.";
  return "카메라를 열 수 없어요. 사진 업로드로 대신할 수 있어요.";
}

function setRec(text, live) {
  dom.rec.lastChild.textContent = text;
  dom.rec.classList.toggle("is-live", live);
}

/* ---------- shooting ---------- */
async function runShoot() {
  if (state.busy || !state.stream) return;
  state.busy = true;
  reset(true);                       // 이전 컷 비우기 (카메라 유지)
  lockUI(true);
  setRec("REC", true);

  for (let i = 0; i < 4; i++) {
    await countdown(3);
    await flash();
    captureCut(i);
    await sleep(650);
  }

  setRec("READY", false);
  lockUI(false);
  state.busy = false;
  refreshSave();
}

async function countdown(from) {
  for (let n = from; n >= 1; n--) {
    dom.countdown.textContent = n;
    dom.countdown.classList.remove("tick");
    void dom.countdown.offsetWidth;  // reflow → 애니메이션 재시작
    dom.countdown.classList.add("tick");
    await sleep(900);
  }
}

async function flash() {
  dom.flash.classList.remove("go");
  void dom.flash.offsetWidth;
  dom.flash.classList.add("go");
  await sleep(120);
}

function captureCut(index) {
  const v = dom.video;
  const c = makeCutCanvas();
  const ctx = c.getContext("2d");

  // cover-fit 크롭
  const { sx, sy, sw, sh } = coverCrop(v.videoWidth, v.videoHeight, CUT_W / CUT_H);

  if ("filter" in ctx) ctx.filter = state.filter.css;
  ctx.translate(CUT_W, 0);          // 셀카 거울 반전
  ctx.scale(-1, 1);
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, CUT_W, CUT_H);

  state.captures[index] = c;
  fillSlot(index, c);
}

/* ---------- upload fallback ---------- */
async function handleUpload(e) {
  const files = [...e.target.files].slice(0, 4);
  if (!files.length) return;
  reset(true);

  for (let i = 0; i < files.length; i++) {
    const img = await loadImage(files[i]);
    const c = makeCutCanvas();
    const ctx = c.getContext("2d");
    const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, CUT_W / CUT_H);
    if ("filter" in ctx) ctx.filter = state.filter.css;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CUT_W, CUT_H);
    state.captures[i] = c;
    fillSlot(i, c);
  }
  dom.resetBtn.disabled = false;
  refreshSave();
  e.target.value = "";
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- slots / preview ---------- */
function fillSlot(index, canvas) {
  const slot = dom.cuts[index];
  slot.querySelector("img")?.remove();
  const img = new Image();
  img.src = canvas.toDataURL("image/jpeg", 0.92);
  slot.appendChild(img);
  slot.classList.add("is-filled");
}

function clearSlots() {
  dom.cuts.forEach((slot, i) => {
    slot.querySelector("img")?.remove();
    slot.classList.remove("is-filled");
    if (!slot.querySelector(".cut__num")) {
      const n = document.createElement("span");
      n.className = "cut__num";
      n.textContent = i + 1;
      slot.appendChild(n);
    }
  });
}

/* ---------- reset ---------- */
function reset(keepCamera) {
  state.captures = [];
  clearSlots();
  dom.saveBtn.disabled = true;
  note("4컷을 모두 찍으면 저장 버튼이 켜져요.");
  if (!keepCamera) dom.resetBtn.disabled = !state.stream;
}

function refreshSave() {
  const ready = state.captures.filter(Boolean).length === 4;
  dom.saveBtn.disabled = !ready;
  note(ready ? "완성! 이미지 저장을 눌러 받으세요." : "4컷 중 일부만 채워졌어요. 4장이 필요해요.");
}

/* ---------- export ---------- */
async function saveImage() {
  if (state.captures.filter(Boolean).length !== 4) return;
  dom.saveBtn.disabled = true;
  note("이미지를 만드는 중…");

  const canvas = await buildStrip();
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `인생네컷_${fmtFile()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    note("저장됐어요! 다시 찍으려면 ‘다시’를 누르세요.");
    dom.saveBtn.disabled = false;
  }, "image/png");
}

async function buildStrip() {
  await ensureFonts();

  const W = CUT_W + PAD * 2;
  const H = TOP + CUT_H * 4 + GAP * 3 + FOOTER;
  const c = $("exportCanvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");

  // 프레임 배경
  ctx.fillStyle = state.frame.color;
  ctx.fillRect(0, 0, W, H);

  // 4컷
  state.captures.forEach((cut, i) => {
    const y = TOP + i * (CUT_H + GAP);
    ctx.save();
    roundRect(ctx, PAD, y, CUT_W, CUT_H, 6);
    ctx.clip();
    ctx.drawImage(cut, PAD, y, CUT_W, CUT_H);
    ctx.restore();
  });

  // 하단 문구 + 날짜
  const footTop = TOP + CUT_H * 4 + GAP * 3;
  const textColor = state.frame.dark ? "#f6efe1" : "#1c1a18";
  ctx.fillStyle = textColor;

  ctx.textBaseline = "middle";
  ctx.font = '600 38px "Jua", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(dom.caption.value || "인생네컷", PAD + 6, footTop + FOOTER / 2 + 4);

  ctx.font = '700 24px "Space Mono", monospace';
  ctx.textAlign = "right";
  ctx.globalAlpha = state.frame.dark ? 0.8 : 0.6;
  ctx.fillText(fmtDate(), W - PAD - 6, footTop + FOOTER / 2 + 4);
  ctx.globalAlpha = 1;

  return c;
}

async function ensureFonts() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('600 38px "Jua"'),
      document.fonts.load('700 24px "Space Mono"'),
    ]);
    await document.fonts.ready;
  } catch (_) { /* 폰트 로드 실패 시 기본 폰트로 진행 */ }
}

/* ---------- helpers ---------- */
function makeCutCanvas() {
  const c = document.createElement("canvas");
  c.width = CUT_W; c.height = CUT_H;
  return c;
}

function coverCrop(srcW, srcH, targetRatio) {
  const srcRatio = srcW / srcH;
  let sw, sh;
  if (srcRatio > targetRatio) { sh = srcH; sw = srcH * targetRatio; }
  else { sw = srcW; sh = srcW / targetRatio; }
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lockUI(locked) {
  dom.shootBtn.disabled = locked;
  dom.resetBtn.disabled = locked;
  dom.uploadInput.disabled = locked;
}

function note(msg, isError = false) {
  dom.note.textContent = msg;
  dom.note.classList.toggle("is-error", isError);
}

function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDate() {
  const d = new Date();
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}
function fmtFile() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

init();
