/**
 * main.js — 통합 화면(index.html) 로직
 * ---------------------------------------------------------------------------
 * "문서를 선택하면 바로 인식된다"는 단일 문서 흐름이다. 여러 파일을 모아
 * 한 번에 처리하는 배치(batch) 개념은 없다.
 *
 * 좌측 패널
 *  - 탐지 옵션: 바꾸는 즉시 localStorage에 저장한다. 현재 문서의 원본 파일이
 *    이 브라우저 세션에 남아 있으면 새 policy와 함께 서버에 다시 보내고,
 *    반환된 탐지·마스킹 결과로 현재 문서를 교체한다.
 *  - 문서 선택: 파일 하나를 고르면 즉시 Api.recognizeDocument()를 호출한다.
 *  - 최근 인식 문서: 지금까지 인식한 문서 기록(최근 항목이 위). 클릭하면
 *    우측 뷰어가 그 문서로 바뀐다.
 *
 * 우측 뷰어는 선택된 문서 1건의 OCR/개인정보 검출/마스킹 결과를 보여준다.
 */

let selectedDocId = null;
let currentPageNo = 1;
let recognizing = false;
let optionReprocessSequence = 0;
let optionReprocessTimer = null;

// File 객체는 JSON/localStorage에 저장할 수 없으므로 현재 탭의 메모리에만 둔다.
// 새로고침 후 과거 문서의 옵션을 바꾸려면 원본 문서를 다시 선택해야 한다.
const sourceFilesByDocumentId = new Map();
// 뷰어에 마스킹 결과 대신 원본을 보여줄지 여부. 문서를 새로 선택할 때마다
// 기본값(마스킹 결과)으로 되돌아간다 — 명세서 5.4의 "검수가 필요한 경우에만
// 원본 보기 기능을 별도로 제공한다"를 따른 것으로, 상시 노출은 하지 않는다.
let showOriginal = false;
// 지금 선택된(테두리가 빨갛게 표시되고, 드래그로 옮기거나 삭제할 수 있는)
// 마스킹 영역. 문서/페이지가 바뀌면 더 이상 화면에 없는 영역을 가리킬 수
// 있으니 초기화한다.
let selectedRectId = null;

// renderViewer()가 화면 전체를 다시 만들더라도 마스킹 영역 목록이 사용자가
// 보고 있던 위치에서 갑자기 맨 위로 이동하지 않도록 스크롤 위치를 기억한다.
let maskListScrollTop = 0;

function rectLabelOf(r) {
  if (r.auto) return PII_TYPE_META[r.type] ? PII_TYPE_META[r.type].label : r.type;
  return r.label && r.label.trim() ? r.label : "수동 지정";
}

// ---------------------------------------------------------------------------
// 수동 마스킹 편집 — 별도 "편집 모드"나 화면 없이, 뷰어에 문서가 떠 있는
// 동안 항상 바로 할 수 있다. 빈 곳을 드래그하면 새 영역이 생기고, 영역을
// 클릭하면 선택되어 드래그로 옮기거나 모서리로 크기를 바꾸거나 지울 수
// 있다. 옵션 패널의 토글과 같은 방식으로, 바꾸는 즉시 그 문서/페이지에
// 자동 저장된다(따로 누르는 "저장" 버튼이 없다) — pushEditHistory()가
// 실행취소 기록에 남기는 동시에 저장까지 담당한다.
// 좌표는 항상 #docPageView 기준 백분율(%)로 다룬다.
// ---------------------------------------------------------------------------
let editWorkingRects = [];
let editOriginalAutoRects = [];
let editHistory = [];
let editHistoryIndex = -1;
let editUidCounter = 1;
// editWorkingRects가 지금 어떤 문서/페이지 것인지 기억해둔다. 렌더링할
// 문서/페이지가 이거랑 다르면 그때 다시 불러온다(ensureWorkingRectsLoaded).
let editLoadedDocId = null;
let editLoadedPageNo = null;

function cloneRects(arr) {
  return JSON.parse(JSON.stringify(arr));
}
function newEditRectId() {
  return "manual-" + Date.now() + "-" + editUidCounter++;
}
function clampPct(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function findEditRect(id) {
  return editWorkingRects.find((r) => r.id === id);
}

// 렌더링하려는 문서/페이지에 맞는 마스킹 영역이 아직 안 불려와 있으면
// (문서를 새로 선택했거나 페이지를 넘겼으면) 이 문서/페이지에 저장된 수동
// 편집 결과가 있으면 그걸, 없으면 자동 마스킹 결과(적용된 옵션으로 거른
// 것)를 불러온다.
function ensureWorkingRectsLoaded(doc, page) {
  const docId = doc ? doc.id : null;
  const pageNo = page ? page.pageNo : null;
  if (editLoadedDocId === docId && editLoadedPageNo === pageNo) return;
  editLoadedDocId = docId;
  editLoadedPageNo = pageNo;
  selectedRectId = null;

  if (!doc || !page) {
    editWorkingRects = [];
    editOriginalAutoRects = [];
    editHistory = [];
    editHistoryIndex = -1;
    return;
  }
  const settings = doc.appliedSettings || Storage.getSettings();
  editOriginalAutoRects = cloneRects((page.maskRects || []).filter((r) => settings.piiTypes[r.type]));
  const existingSaved = Storage.getManualMaskForDoc(doc.id, page.pageNo);
  editWorkingRects = existingSaved ? cloneRects(existingSaved) : cloneRects(editOriginalAutoRects);
  editHistory = [cloneRects(editWorkingRects)];
  editHistoryIndex = 0;
}

// 실행취소 기록에 지금 상태를 남기는 동시에, 그 문서/페이지에 즉시
// 저장한다(별도 저장 버튼이 없으므로 여기서 한 번에 처리한다).
function pushEditHistory() {
  editHistory = editHistory.slice(0, editHistoryIndex + 1);
  editHistory.push(cloneRects(editWorkingRects));
  editHistoryIndex++;
  if (editLoadedDocId && editLoadedPageNo) {
    Api.saveManualMask(editLoadedDocId, editLoadedPageNo, editWorkingRects);
  }
}

function undoEdit() {
  if (editHistoryIndex <= 0) return;
  editHistoryIndex--;
  editWorkingRects = cloneRects(editHistory[editHistoryIndex]);
  selectedRectId = null;
  if (editLoadedDocId && editLoadedPageNo) Api.saveManualMask(editLoadedDocId, editLoadedPageNo, editWorkingRects);
  renderViewer();
}

function redoEdit() {
  if (editHistoryIndex >= editHistory.length - 1) return;
  editHistoryIndex++;
  editWorkingRects = cloneRects(editHistory[editHistoryIndex]);
  selectedRectId = null;
  if (editLoadedDocId && editLoadedPageNo) Api.saveManualMask(editLoadedDocId, editLoadedPageNo, editWorkingRects);
  renderViewer();
}

function deleteSelectedEditRect() {
  if (!selectedRectId) return;
  editWorkingRects = editWorkingRects.filter((r) => r.id !== selectedRectId);
  selectedRectId = null;
  pushEditHistory();
  renderViewer();
}

function resetEditRects() {
  if (!confirm("현재 페이지의 수동 편집 내용을 자동 마스킹 결과 상태로 되돌릴까요?")) return;
  editWorkingRects = cloneRects(editOriginalAutoRects);
  selectedRectId = null;
  pushEditHistory();
  renderViewer();
}

// 편집 가능한 마스킹 영역들을 #editRectsLayer 안에 실제 DOM으로 그린다.
// (수동 라벨용 <input>, 리사이즈 핸들, 삭제 버튼 등은 드래그/클릭 이벤트가
// 붙어야 해서 HTML 문자열이 아니라 DOM으로 직접 만든다.)
function renderEditableRects() {
  const layer = document.getElementById("editRectsLayer");
  if (!layer) return;
  layer.innerHTML = "";

  // 자동 마스킹은 서버가 내려준 maskingImages에 이미 그려져 있고 수정하지
  // 않는다. 화면 위의 선택·이동·크기 조절 박스는 수동 영역에만 만든다.
  editWorkingRects.filter((r) => !r.auto).forEach((r) => {
    const div = document.createElement("div");
    div.className = "mask-rect editable " + (r.auto ? "auto" : "manual") + (r.id === selectedRectId ? " selected" : "");
    div.dataset.id = r.id;
    div.style.top = r.top + "%";
    div.style.left = r.left + "%";
    div.style.width = r.width + "%";
    div.style.height = r.height + "%";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "rect-type-label rect-label-input";
    input.placeholder = "이름 입력";
    input.maxLength = 30;
    input.value = r.label || "";
    const startValue = input.value;
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("input", () => {
      const live = findEditRect(r.id);
      if (live) live.label = input.value;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      if (input.value !== startValue) pushEditHistory();
    });
    div.appendChild(input);

    div.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (r.id !== selectedRectId) {
        selectedRectId = r.id;
        refreshRectSelection();
        return;
      }
      beginEditDrag(e, r.id, "move", null);
    });

    if (r.id === selectedRectId) {
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "rect-delete-btn";
      delBtn.setAttribute("aria-label", "이 마스킹 영역 삭제");
      delBtn.textContent = "×";
      delBtn.addEventListener("mousedown", (e) => e.stopPropagation());
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteSelectedEditRect();
      });
      div.appendChild(delBtn);

      ["nw", "ne", "sw", "se"].forEach((corner) => {
        const h = document.createElement("div");
        h.className = "resize-handle " + corner;
        h.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          beginEditDrag(e, r.id, "resize", corner);
        });
        div.appendChild(h);
      });
    }

    layer.appendChild(div);
  });

  updateEditToolbarState();
}

// 마스킹 영역 선택은 내용 변경이 아니므로 뷰어 전체를 다시 만들 필요가 없다.
// 이미지 위 영역과 오른쪽 목록의 선택 표시만 갱신하면 목록 스크롤도 유지된다.
function refreshRectSelection() {
  renderEditableRects();
  document.querySelectorAll("#maskList .mask-list-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.getAttribute("data-rect-id") === selectedRectId
    );
  });
  updateEditToolbarState();
}

function focusEditLabelInput(rectId) {
  const input = document.querySelector(`#editRectsLayer .mask-rect[data-id="${rectId}"] .rect-label-input`);
  if (input) {
    input.focus();
    input.select();
  }
}

function updateEditToolbarState() {
  const undoBtn = document.getElementById("btnUndo");
  const redoBtn = document.getElementById("btnRedo");
  const delBtn = document.getElementById("btnDeleteSelected");
  if (undoBtn) undoBtn.disabled = editHistoryIndex <= 0;
  if (redoBtn) redoBtn.disabled = editHistoryIndex >= editHistory.length - 1;
  if (delBtn) delBtn.disabled = !selectedRectId;
}

function beginEditDrag(e, rectId, kind, corner) {
  e.preventDefault();
  const pageEl = document.getElementById("docPageView");
  const stageRect = pageEl.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const start = { ...findEditRect(rectId) };
  const minSize = 1.5;

  function onMove(ev) {
    const dxPct = ((ev.clientX - startX) / stageRect.width) * 100;
    const dyPct = ((ev.clientY - startY) / stageRect.height) * 100;
    const live = findEditRect(rectId);
    if (!live) return;

    if (kind === "move") {
      live.left = clampPct(start.left + dxPct, 0, 100 - start.width);
      live.top = clampPct(start.top + dyPct, 0, 100 - start.height);
    } else {
      let { top, left, width, height } = start;
      if (corner.includes("e")) width = clampPct(start.width + dxPct, minSize, 100 - start.left);
      if (corner.includes("s")) height = clampPct(start.height + dyPct, minSize, 100 - start.top);
      if (corner.includes("w")) {
        const newLeft = clampPct(start.left + dxPct, 0, start.left + start.width - minSize);
        width = start.width + (start.left - newLeft);
        left = newLeft;
      }
      if (corner.includes("n")) {
        const newTop = clampPct(start.top + dyPct, 0, start.top + start.height - minSize);
        height = start.height + (start.top - newTop);
        top = newTop;
      }
      live.top = top;
      live.left = left;
      live.width = width;
      live.height = height;
    }
    renderEditableRects();
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    pushEditHistory();
    updateEditToolbarState();
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function drawTempEditRect(left, top, width, height) {
  const layer = document.getElementById("editRectsLayer");
  let el = document.getElementById("temp-draw-rect");
  if (!el) {
    el = document.createElement("div");
    el.id = "temp-draw-rect";
    el.className = "mask-rect manual";
    el.style.outlineStyle = "dashed";
    layer.appendChild(el);
  }
  el.style.left = left + "%";
  el.style.top = top + "%";
  el.style.width = width + "%";
  el.style.height = height + "%";
}

function pxToPct(clientX, clientY, stageRect) {
  return {
    x: ((clientX - stageRect.left) / stageRect.width) * 100,
    y: ((clientY - stageRect.top) / stageRect.height) * 100,
  };
}

function startDrawNewEditRect(e) {
  e.preventDefault();
  const pageEl = document.getElementById("docPageView");
  const stageRect = pageEl.getBoundingClientRect();
  const startPct = pxToPct(e.clientX, e.clientY, stageRect);

  function onMove(ev) {
    const curPct = pxToPct(ev.clientX, ev.clientY, stageRect);
    const left = Math.min(startPct.x, curPct.x);
    const top = Math.min(startPct.y, curPct.y);
    const width = Math.abs(curPct.x - startPct.x);
    const height = Math.abs(curPct.y - startPct.y);
    drawTempEditRect(clampPct(left, 0, 100), clampPct(top, 0, 100), width, height);
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    const el = document.getElementById("temp-draw-rect");
    let box = null;
    if (el) {
      box = {
        left: parseFloat(el.style.left),
        top: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
      };
      el.remove();
    }
    if (box && box.width > 1.5 && box.height > 1.5) {
      // 의미 있는 크기로 드래그했으면 새 영역을 만든다.
      const rect = {
        id: newEditRectId(),
        type: "manual",
        auto: false,
        label: "",
        top: clampPct(box.top, 0, 100 - box.height),
        left: clampPct(box.left, 0, 100 - box.width),
        width: box.width,
        height: box.height,
      };
      editWorkingRects.push(rect);
      selectedRectId = rect.id;
      pushEditHistory();
      renderViewer();
      focusEditLabelInput(rect.id);
      return;
    }
    // 그냥 클릭만 한 경우(의미 있는 드래그가 없었으면) 선택만 해제한다.
    selectedRectId = null;
    renderEditableRects();
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// Delete/Backspace로 선택된 영역을 지울 수 있게 한다. renderViewer()가 화면을
// 통째로 다시 그리는 구조라, 리스너를 매번 새로 붙이면 중복 등록되므로
// 스크립트 로드 시 한 번만 등록하고 그 안에서 최신 상태(selectedRectId 등)를
// 읽는다.
document.addEventListener("keydown", (e) => {
  if (["Delete", "Backspace"].includes(e.key) && selectedRectId && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    deleteSelectedEditRect();
  }
});

/**
 * 파일을 data URL 문자열로 읽는다. 실제 API 연동 전까지, 방금 업로드한
 * 파일 자체를 뷰어에 보여주기 위해 쓴다(doc.previewDataUrl에 저장).
 * blob URL이 아니라 data URL을 쓰는 이유는, blob URL은 페이지를 이동하면
 * (예: 수동 마스킹 편집기로 갔다 오면) 무효가 되기 때문이다.
 * ▶ 실제 API 연동 시: 이 함수와 previewDataUrl 저장은 통째로 걷어내고,
 *   서버가 내려주는 이미지 URL을 doc.pages[n].imageUrl 같은 필드로 받아
 *   그대로 <img src>에 넣으면 된다.
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// localStorage는 보통 5~10MB밖에 안 되는데, 디코딩한 스캔 문서 이미지는
// 손쉽게 그 이상이 된다. 그래서 페이지 이미지는 (1) 무압축에 가까운 PNG 대신
// JPEG로, (2) 한 변이 MAX_PREVIEW_DIMENSION을 넘으면 비율을 유지해서 줄여
// 저장한다. 화면 미리보기 용도라 해상도를 조금 낮춰도 실사용에 지장이 없다.
const MAX_PREVIEW_DIMENSION = 1600;
const PREVIEW_JPEG_QUALITY = 0.82;

// 이미 그려진 canvas를 필요하면 축소해서 JPEG data URL로 뽑아낸다.
function canvasToScaledJpeg(sourceCanvas) {
  const { width, height } = sourceCanvas;
  const longSide = Math.max(width, height);
  if (longSide <= MAX_PREVIEW_DIMENSION) {
    return sourceCanvas.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
  }
  const scale = MAX_PREVIEW_DIMENSION / longSide;
  const out = document.createElement("canvas");
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);
  out.getContext("2d").drawImage(sourceCanvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", PREVIEW_JPEG_QUALITY);
}

/**
 * TIFF는 브라우저가 <img>/<embed> 어느 것으로도 그리지 못하므로(네이티브
 * 지원 없음), UTIF.js(js/vendor/UTIF.js)로 직접 디코딩해서 페이지마다
 * <canvas>에 그린 뒤 JPEG data URL로 뽑아낸다. 여러 페이지짜리 TIFF는
 * 페이지 수만큼 data URL을 반환한다.
 */
async function decodeTiffPages(arrayBuffer) {
  const ifds = UTIF.decode(arrayBuffer);
  const pages = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(arrayBuffer, ifd, ifds);
    const rgba = UTIF.toRGBA8(ifd);
    const canvas = document.createElement("canvas");
    canvas.width = ifd.width;
    canvas.height = ifd.height;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(ifd.width, ifd.height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    pages.push(canvasToScaledJpeg(canvas));
  }
  return pages;
}

// pdf.js가 PDF 파싱을 별도 워커 스레드에서 하므로, 워커 스크립트 위치를
// 한 번 알려줘야 한다(js/vendor/pdf.worker.min.js).
if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "js/vendor/pdf.worker.min.js";
}

/**
 * PDF도 TIFF와 같은 이유로 직접 페이지마다 <canvas>에 렌더링해서 JPEG data
 * URL로 뽑아낸다 — 그래야 (1) 실제 페이지 수를 정확히 알 수 있고, (2) 각
 * 페이지가 진짜 <img>가 되어 마스킹 영역 오버레이·수동 편집(새 영역 그리기
 * 포함)이 이미지/TIFF와 똑같이 동작한다. pdf.js(js/vendor/pdf.min.js,
 * Mozilla, Apache-2.0)를 쓴다.
 */
async function decodePdfPages(arrayBuffer) {
  const pdf = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 20000, "PDF를 여는 데 실패했습니다(시간 초과)");
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.3 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    // 드물게 렌더링이 멈춰 있을 수 있어 페이지당 시간 제한을 둔다 — 그래야
    // 전체 인식 흐름이 무한정 멈추지 않고, 실패로 처리돼서 안내 화면으로
    // 넘어간다.
    await withTimeout(page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise, 20000, "PDF 페이지 렌더링 시간 초과");
    pages.push(canvasToScaledJpeg(canvas));
  }
  return pages;
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message || "timeout")), ms))]);
}

// ---- 탐지 옵션 (좌측 상단, 상시 노출) ------------------------------------

function renderOptionsInline() {
  const settings = Storage.getSettings();
  const coreLabel = CORE_PII_TYPES.map((k) => PII_TYPE_META[k].label).join(" · ");

  const html = `
    <div class="option-row locked compact">
      <div>
        <div class="option-title" style="font-size:12.5px;">고유식별정보 4종</div>
        <div class="option-desc">${coreLabel} (항상 켜짐)</div>
      </div>
      <div class="checkbox-locked">✓</div>
    </div>
    ${EXTRA_PII_TYPES.map(
      (k) => `
    <div class="option-row compact">
      <div>
        <div class="option-title" style="font-size:12.5px;">${PII_TYPE_META[k].label}</div>
        <div class="option-desc">${k === "phone_number" ? "휴대전화·전화번호 탐지" : "이메일 주소 탐지"}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-extra-type="${k}" ${settings.piiTypes[k] ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>`
    ).join("")}
    <div class="option-row compact">
      <div>
        <div class="option-title" style="font-size:12.5px;">체크섬 검증</div>
        <div class="option-desc">기본값: 사용 안 함</div>
      </div>
      <label class="switch">
        <input type="checkbox" id="checksumToggle" ${settings.checksum ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    </div>
  `;

  document.getElementById("optionsInline").innerHTML = html;

  document.querySelectorAll("[data-extra-type]").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const piiTypes = { ...Storage.getSettings().piiTypes, [e.target.dataset.extraType]: e.target.checked };
      const settings = Storage.saveSettings({ piiTypes });
      scheduleSelectedDocumentReprocess(settings);
    });
  });
  document.getElementById("checksumToggle").addEventListener("change", async (e) => {
    const settings = Storage.saveSettings({ checksum: e.target.checked });
    scheduleSelectedDocumentReprocess(settings);
  });
}

function scheduleSelectedDocumentReprocess(settings) {
  if (optionReprocessTimer !== null) {
    clearTimeout(optionReprocessTimer);
  }
  optionReprocessTimer = setTimeout(() => {
    optionReprocessTimer = null;
    reprocessSelectedDocument(settings);
  }, 250);
}

async function reprocessSelectedDocument(settings) {
  const documentId = selectedDocId;
  if (!documentId) return;

  const sourceFile = sourceFilesByDocumentId.get(documentId);
  if (!sourceFile || !sourceFile.raw) {
    showToast("이 문서는 원본 파일이 남아 있지 않아 다시 선택해야 합니다.", "danger");
    return;
  }

  const requestSequence = ++optionReprocessSequence;
  DiagnosticLog.add("info", "OPTION_REPROCESS_STARTED", {
    document_id: documentId,
    file_name: sourceFile.fileName,
    phone_number_enabled: !!settings.piiTypes.phone_number,
    email_address_enabled: !!settings.piiTypes.email_address,
    checksum_enabled: !!settings.checksum,
    pattern_strictness: settings.patternStrictness || "ocr_tolerant",
  });
  showToast("변경한 옵션으로 개인정보를 다시 탐지하고 있습니다.", "success");

  try {
    const updatedDoc = await Api.reprocessDocument(sourceFile, settings, documentId);
    if (requestSequence !== optionReprocessSequence) return;

    // 수동으로 추가한 영역은 유지하고, 기존 자동 영역만 새 결과로 교체한다.
    updatedDoc.pages.forEach((page) => {
      const savedRects = Storage.getManualMaskForDoc(documentId, page.pageNo);
      if (!savedRects) return;
      const manualRects = savedRects.filter((rect) => !rect.auto);
      Storage.saveManualMaskForDoc(
        documentId,
        page.pageNo,
        [...page.maskRects, ...manualRects]
      );
    });

    const documents = (Storage.getJobResults() || []).map((document) =>
      document.id === documentId ? updatedDoc : document
    );
    Storage.saveJobResults(documents);
    sourceFilesByDocumentId.set(documentId, sourceFile);

    if (!updatedDoc.pages.some((page) => page.pageNo === currentPageNo)) {
      currentPageNo = updatedDoc.pages.length ? updatedDoc.pages[0].pageNo : 1;
    }
    editLoadedDocId = null;
    editLoadedPageNo = null;
    showOriginal = false;
    renderFileList();
    renderViewer();
    DiagnosticLog.add("info", "OPTION_REPROCESS_COMPLETED", {
      document_id: documentId,
      file_name: sourceFile.fileName,
      page_count: updatedDoc.pageCount,
      final_status: updatedDoc.finalStatus,
    });
    showToast("변경한 옵션으로 마스킹 결과를 갱신했습니다.", "success");
  } catch (error) {
    if (requestSequence !== optionReprocessSequence) return;
    console.error("[main] 옵션 변경 재처리 실패", error);
    DiagnosticLog.add("error", "OPTION_REPROCESS_FAILED", {
      document_id: documentId,
      file_name: sourceFile.fileName,
      message: error.message,
      stack: error.stack || null,
    });
    showToast("옵션 변경 결과를 다시 처리하지 못했습니다.", "danger");
  }
}

// ---- 최근 인식 문서 목록 -------------------------------------------------

function appliedOptionsSummary(doc) {
  const settings = doc.appliedSettings || Storage.getSettings();
  const extra = EXTRA_PII_TYPES.filter((k) => settings.piiTypes[k]).map((k) => PII_TYPE_META[k].label);
  return `4종${extra.length ? " + " + extra.join(",") : ""}${settings.checksum ? " · 체크섬" : ""}`;
}

function renderFileList() {
  const docs = Storage.getJobResults() || [];
  const fileList = document.getElementById("fileList");

  fileList.innerHTML =
    docs
      .map((d) => {
        const total = Object.values(piiCountsForActiveTypes(d.piiCounts || {}, d.appliedSettings || Storage.getSettings())).reduce((a, b) => a + b, 0);
        return `
      <li class="file-item ${d.id === selectedDocId ? "active" : ""}" data-doc="${d.id}">
        <div class="file-name">${escapeHtml(d.fileName)}</div>
        <div class="file-meta">
          ${badgeHtml(d.finalStatus)}
          <span>${d.pageCount}p${total > 0 ? " · 검출 " + total + "건" : ""}</span>
        </div>
        <div class="file-meta" style="margin-top:2px;">옵션: ${appliedOptionsSummary(d)}</div>
      </li>`;
      })
      .join("") || `<li class="empty-state" style="padding:20px 10px;"><div class="text-sm">아직 인식한 문서가 없습니다.</div></li>`;

  fileList.querySelectorAll("[data-doc]").forEach((li) => {
    li.addEventListener("click", () => selectDoc(li.dataset.doc));
  });
}

function clearHistory() {
  if ((Storage.getJobResults() || []).length === 0) return;
  if (!confirm("인식 기록을 모두 지울까요?")) return;
  Storage.resetHistory();
  selectedDocId = null;
  renderFileList();
  renderViewerEmpty();
}

// ---- 파일 선택 → 즉시 인식 -------------------------------------------------

function extOf(fileName) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return m ? m[1].toUpperCase() : "-";
}

function previewKindOf(ext) {
  if (ext === "PDF") return "pdf";
  if (ext === "TIFF" || ext === "TIF") return "tiff";
  return "image";
}

async function handleFileSelected(file) {
  if (recognizing) return;
  const ext = extOf(file.name);
  if (!["PDF", "JPG", "JPEG", "PNG", "TIFF", "TIF"].includes(ext)) {
    showToast("지원하지 않는 파일 형식입니다. (PDF, JPG, PNG, TIFF만 가능)", "danger");
    return;
  }

  recognizing = true;
  showRecognizingState(file.name);

  const previewKind = previewKindOf(ext);
  let previewDataUrl = null;
  let previewPages = null;
  let previewFailed = false;

  if (previewKind === "image") {
    // JPG/PNG는 원본 파일 자체가 곧 미리보기라 그대로 data URL로 읽는다.
    previewDataUrl = await readFileAsDataUrl(file).catch(() => null);
  } else if (previewKind === "tiff") {
    // PDF/TIFF는 페이지별로 디코딩한 이미지만 쓰고 원본 파일은 저장하지
    // 않는다 — 원본까지 같이 들고 있으면 localStorage 용량을 너무 많이
    // 잡아먹는다(그래서 예전엔 TIFF 여러 장 올리면 저장 실패가 났다).
    try {
      previewPages = await decodeTiffPages(await file.arrayBuffer());
    } catch (e) {
      console.warn("[main] TIFF 디코딩 실패", e);
      previewFailed = true;
      showToast("TIFF 미리보기 디코딩에 실패했습니다. (인식 결과는 정상 표시됩니다)", "danger");
    }
  } else if (previewKind === "pdf") {
    try {
      previewPages = await decodePdfPages(await file.arrayBuffer());
    } catch (e) {
      console.warn("[main] PDF 디코딩 실패", e);
      previewFailed = true;
      showToast("PDF 페이지 미리보기 디코딩에 실패했습니다. (인식 결과는 정상 표시됩니다)", "danger");
    }
  }

  const fileMeta = {
    raw: file,
    fileName: file.name,
    ext,
    sizeKB: Math.round(file.size / 1024),
    previewDataUrl,
    previewKind,
    previewPages,
    // previewDataUrl 없이도 실제 업로드 파일의 미리보기 디코딩 실패 여부를
    // 화면에서 구분하기 위해 저장한다.
    previewFailed,
  };

  try {
    const settings = Storage.getSettings();
    const doc = await Api.recognizeDocument(fileMeta, settings);
    sourceFilesByDocumentId.set(doc.id, fileMeta);
    selectedDocId = doc.id;
    currentPageNo = doc.pages && doc.pages.length ? doc.pages[0].pageNo : 1;
    renderFileList();
    renderViewer();
    showToast(`${doc.fileName} 인식 완료`, "success");
    if (doc.previewDropped) {
      showToast("저장 공간이 부족해 미리보기 없이 저장했습니다.", "danger");
    }
  } catch (e) {
    showToast("인식 요청에 실패했습니다.", "danger");
    renderViewerEmpty();
  } finally {
    recognizing = false;
  }
}

function showRecognizingState(fileName) {
  document.getElementById("viewerMain").innerHTML = `
    <div class="viewer-empty">
      <div style="text-align:center;">
        <div class="empty-icon">${spinnerIcon()}</div>
        <div>${escapeHtml(fileName)} 인식 중...</div>
      </div>
    </div>`;
}

// ---- 뷰어 --------------------------------------------------------

function findDoc(docId) {
  return (Storage.getJobResults() || []).find((d) => d.id === docId) || null;
}

function currentPageOf(doc) {
  if (!doc || !doc.pages) return null;
  return doc.pages.find((p) => p.pageNo === currentPageNo) || null;
}

function selectDoc(docId) {
  selectedDocId = docId;
  const doc = findDoc(docId);
  currentPageNo = doc && doc.pages && doc.pages.length ? doc.pages[0].pageNo : 1;
  showOriginal = false;
  renderFileList();
  renderViewer();
}

function renderViewerEmpty() {
  document.getElementById("viewerMain").innerHTML = `
    <div class="viewer-empty">
      <div style="text-align:center;">
        <div class="empty-icon">${docMarkIcon(32)}</div>
        <div>왼쪽에서 문서를 선택하면<br />바로 인식·마스킹 결과가 표시됩니다.</div>
      </div>
    </div>`;
}

function renderViewer() {
  const oldMaskList = document.getElementById("maskList");
  if (oldMaskList) {
    maskListScrollTop = oldMaskList.scrollTop;
  }

  const doc = findDoc(selectedDocId);
  if (!doc) {
    renderViewerEmpty();
    return;
  }

  const page = currentPageOf(doc);
  const settings = doc.appliedSettings || Storage.getSettings();
  // 지금 그리려는 문서/페이지에 맞는 마스킹 영역이 아직 안 불려와 있으면
  // (문서를 새로 골랐거나 페이지를 넘겼으면) 여기서 불러온다. 이후로는
  // actualRects(= editWorkingRects)가 마스킹 영역의 유일한 기준이 된다 —
  // 화면에 보여줄 때도, 드래그/추가/삭제할 때도 항상 같은 배열이다.
  ensureWorkingRectsLoaded(doc, page);
  const actualRects = editWorkingRects;

  const errorBanner =
    doc.finalStatus === "처리완료" || doc.finalStatus === "부분처리"
      ? ""
      : `<div class="card card-compact" style="border-color:var(--seal-soft); background:var(--danger-bg);">
           <div class="flex-gap-8">
             <span class="badge badge-danger">${doc.finalStatus}</span>
             <span class="text-sm">${escapeHtml(doc.errorReason || "처리 중 오류가 발생했습니다.")}</span>
           </div>
         </div>`;

  // 페이지 넘김: 문서 뷰어 이미지 양옆에 큰 화살표를 두고, 그 사이 위쪽에
  // 큰 글씨로 "2 / 3" 페이지 번호를 보여준다. 페이지가 없거나 이미 첫/마지막
  // 페이지면 해당 방향 화살표를 비활성화한다(숨기지는 않는다 — 항상 문서
  // 양옆에 자리를 잡고 있어야 눈에 잘 띈다).
  const pageIdx = doc.pages ? doc.pages.findIndex((p) => p.pageNo === currentPageNo) : -1;
  const pageTotal = doc.pages ? doc.pages.length : 0;
  // 마스킹 편집은 즉시 저장되므로(별도 저장 단계가 없으므로) 페이지를
  // 넘겨도 잃어버릴 게 없다 — 그래서 더 이상 페이지 이동을 막지 않는다.
  const prevPageDisabled = pageIdx <= 0;
  const nextPageDisabled = pageTotal === 0 || pageIdx >= pageTotal - 1;
  const pageCounterText = pageTotal > 0 ? `${pageIdx + 1} / ${pageTotal}` : "–";
  const pageOcrAlertHtml = page && page.ocrStatus === "실패" ? '<span class="tab-alert" title="OCR 실패"></span>' : "";

  const pageIndex = doc.pages ? doc.pages.findIndex((p) => p.pageNo === currentPageNo) : -1;
  const uploadedOriginalSrc =
    doc.previewPages && doc.previewPages.length
      ? doc.previewPages[Math.min(Math.max(pageIndex, 0), doc.previewPages.length - 1)]
      : doc.previewKind === "image"
      ? doc.previewDataUrl
      : null;
  const resultImageSrc = page && page.maskingImage ? page.maskingImage : null;

  // 실제 마스킹 이미지나 업로드 원본을 표시할 수 있을 때만 영역 편집을
  // 허용한다. 이미지가 없는 오류 화면 위에 가짜 영역을 만들지는 않는다.
  const canEditHere = !!page && !showOriginal && !!(resultImageSrc || uploadedOriginalSrc);
  const editLayerHtml = canEditHere ? `<div id="editRectsLayer" style="position:absolute; inset:0;"></div>` : "";

  let docPageInner;
  if (!page) {
    docPageInner = `<div class="empty-state"><div class="empty-icon">${docMarkIcon(26)}</div><div>표시할 결과 이미지가 없습니다.</div></div>`;
  } else if (!showOriginal && resultImageSrc) {
    // 기본 화면에서는 서버 응답의 maskingImages를 그대로 표시한다.
    // 페이지별 응답 배열과 doc.pages의 순서가 같으므로 현재 page에 저장된
    // maskingImage를 사용하면 된다.
    docPageInner = `<img src="${resultImageSrc}" alt="${escapeHtml(doc.fileName)} 마스킹 결과" class="doc-preview-img" draggable="false" />` + editLayerHtml;
  } else if (showOriginal && uploadedOriginalSrc) {
    // '원본 보기'에서는 서버 마스킹 이미지가 아니라 사용자가 업로드한
    // JPG/PNG 또는 브라우저에서 페이지별로 변환한 PDF 원본을 표시한다.
    docPageInner = `<img src="${uploadedOriginalSrc}" alt="${escapeHtml(doc.fileName)} 원본" class="doc-preview-img" draggable="false" />`;
  } else if (uploadedOriginalSrc) {
    // maskingImages가 없는 구형 응답에서는 업로드 원본 위에 bbox를 그린다.
    docPageInner = `<img src="${uploadedOriginalSrc}" alt="${escapeHtml(doc.fileName)}" class="doc-preview-img" draggable="false" />` + editLayerHtml;
  } else if (doc.previewFailed && (doc.previewKind === "tiff" || doc.previewKind === "pdf")) {
    // 디코딩에 실패했을 때(지원하지 않는 압축 방식, 손상된 파일, 렌더링
    // 시간 초과 등)의 대체 화면.
    const label = doc.previewKind === "tiff" ? "TIFF" : "PDF";
    docPageInner = `<div class="empty-state"><div class="empty-icon">${docMarkIcon(26)}</div><div>${label} 미리보기를 디코딩하지 못했습니다<br />파일명: ${escapeHtml(doc.fileName)}</div></div>`;
  } else {
    docPageInner = `<div class="empty-state"><div class="empty-icon">${docMarkIcon(26)}</div><div>실제 페이지 이미지를 표시할 수 없습니다.</div></div>`;
  }

  const piiCounts = page ? piiCountsForActiveTypes(page.piiCounts, settings) : piiCountsForActiveTypes(doc.piiCounts, settings);
  const piiRows = Object.keys(PII_TYPE_META)
    .filter((k) => settings.piiTypes[k])
    .map((k) => `<tr><td>${PII_TYPE_META[k].label}</td><td>${piiCounts[k] || 0}건</td></tr>`)
    .join("");

  const autoCount = actualRects.filter((r) => r.auto).length;
  const manualCount = actualRects.filter((r) => !r.auto).length;
  const totalPii = page ? Object.values(piiCounts).reduce((a, b) => a + b, 0) : 0;

  const headerActionsHtml = `<button class="btn btn-outline btn-sm" id="btnToggleOriginal" ${page ? "" : "disabled"}>${showOriginal ? "마스킹 결과 보기" : "원본 보기"}</button>
     <button class="btn btn-outline btn-sm" id="btnDownloadImage">마스킹 결과 다운로드</button>`;

  // 별도 "편집 모드"가 없으므로, 실행취소/다시실행/초기화 도구는 마스킹을
  // 편집할 수 있는 동안(원본 보기가 아닐 때) 항상 뷰어 위에 떠 있다. 영역
  // 추가는 빈 공간을 드래그하면 바로 되므로 따로 켜고 끄는 버튼이 없다.
  const editToolbarHtml = canEditHere
    ? `<div class="editor-toolbar" style="margin-top:10px; padding-top:10px; margin-bottom:0;">
         <div class="flex-gap-8 flex-wrap">
           <button class="btn btn-outline btn-sm" id="btnUndo" ${editHistoryIndex <= 0 ? "disabled" : ""}>↶ 실행 취소</button>
           <button class="btn btn-outline btn-sm" id="btnRedo" ${editHistoryIndex >= editHistory.length - 1 ? "disabled" : ""}>↷ 다시 실행</button>
           <button class="btn btn-danger-outline btn-sm" id="btnDeleteSelected" ${selectedRectId ? "" : "disabled"}>선택 영역 삭제</button>
           <button class="btn btn-ghost btn-sm" id="btnResetEdits">편집 초기화</button>
         </div>
       </div>`
    : "";

  document.getElementById("viewerMain").innerHTML = `
    ${errorBanner}

    <div class="result-grid">
      <div class="card viewer-panel">
        <div class="card-header">
          <div>
            <h3 class="mb-0" style="font-size:15px;">${escapeHtml(doc.fileName)}</h3>
            <div class="text-sm text-secondary" style="margin-top:2px;">${showOriginal ? "원본 문서" : "마스킹 결과"} · ${doc.ext} · ${formatBytes(doc.sizeKB)} · ${doc.finalStatus}</div>
          </div>
          <div class="card-header-actions">
            ${headerActionsHtml}
          </div>
        </div>

        ${editToolbarHtml}

        <div class="viewer-frame">
          <button class="page-nav-arrow" id="btnPrevPage" ${prevPageDisabled ? "disabled" : ""} aria-label="이전 페이지">‹</button>
          <div class="viewer-stage">
            <div class="page-counter">${pageCounterText}${pageOcrAlertHtml}</div>
            <div class="doc-page ${canEditHere ? "doc-page-editing" : ""}" id="docPageView">${docPageInner}</div>
          </div>
          <button class="page-nav-arrow" id="btnNextPage" ${nextPageDisabled ? "disabled" : ""} aria-label="다음 페이지">›</button>
        </div>

        ${
          showOriginal
            ? `<p class="form-help legend-row">원본 이미지입니다. 마스킹 영역은 표시하지 않습니다.</p>`
            : `<div class="flex-gap-12 legend-row" style="font-size:11.5px;">
                <span><span class="legend-dot" style="background:#16120f; outline:1.5px solid var(--accent);"></span>자동 마스킹</span>
                <span><span class="legend-dot" style="background:#16120f; outline:1.5px solid var(--amber);"></span>수동 마스킹</span>
                <span class="text-secondary">빈 곳을 드래그해 영역 추가 · 영역을 클릭해 선택 후 이동·삭제</span>
              </div>`
        }
      </div>

      <div class="info-panel">
        <div class="card">
          <h3>OCR 처리 결과</h3>
          <div class="kv-list">
            <div class="kv-row"><span class="kv-label">OCR 상태</span><span class="kv-value">${badgeHtml(page ? page.ocrStatus : doc.ocrStatus)}</span></div>
            ${page ? `<div class="kv-row"><span class="kv-label">페이지 OCR 처리시간</span><span class="kv-value">${formatSeconds(page.ocrTimeSec)}</span></div>
            <div class="kv-row"><span class="kv-label">개인정보 엔진 상태</span><span class="kv-value">${badgeHtml(page.piiEngineStatus)}</span></div>` : ""}
          </div>
          <hr class="section-divider" />
          <div class="flex-gap-8 flex-wrap">
            <button class="btn btn-outline btn-sm" id="btnDownloadJson">OCR 결과 JSON 다운로드</button>
            <button class="btn btn-outline btn-sm" id="btnDownloadTxt">현재 페이지 TXT 다운로드</button>
          </div>
        </div>

        <div class="card">
          <h3>개인정보 검출 요약</h3>
          <div class="table-wrap">
            <table class="table pii-type-table">
              <thead><tr><th>유형</th><th>검출 건수</th></tr></thead>
              <tbody>${piiRows}</tbody>
            </table>
          </div>
          <p class="form-help">${page ? page.pageNo + "페이지 기준. " : ""}적용된 개인정보 검출 옵션: ${appliedOptionsSummary(doc)}</p>
          <button class="btn btn-outline btn-sm" id="btnDownloadPiiLog">검출 내역 JSON 다운로드</button>
        </div>

        <div class="card">
          <h3>마스킹 결과 통계</h3>
          <div class="kv-list">
            <div class="kv-row"><span class="kv-label">검출 개인정보 건수</span><span class="kv-value">${totalPii}건</span></div>
            <div class="kv-row"><span class="kv-label">자동 마스킹 영역</span><span class="kv-value">${autoCount}개</span></div>
            <div class="kv-row"><span class="kv-label">수동 마스킹 영역</span><span class="kv-value">${manualCount}개</span></div>
            <div class="kv-row"><span class="kv-label">결과 이미지 상태</span><span class="kv-value">${page ? badgeHtml(page.imageStatus) : "-"}</span></div>
          </div>
        </div>

        <div class="card">
          <h3 class="mb-0">마스킹 영역 목록${actualRects.length ? ` (${actualRects.length})` : ""}</h3>
          <p class="form-help mt-0" style="margin-bottom:10px;">수동 영역만 선택하여 이동·크기 변경·삭제할 수 있습니다.</p>
          ${
            actualRects.length === 0
              ? `<p class="text-sm text-secondary mb-0">이 페이지에는 마스킹 영역이 없습니다.</p>`
              : `<ul class="mask-list" id="maskList">${actualRects
                  .map(
                    (r) => `
                <li class="mask-list-item ${r.id === selectedRectId ? "active" : ""}" data-rect-id="${r.id}">
                  <span class="legend-dot" style="background:#16120f; outline:1.5px solid ${r.auto ? "var(--accent)" : "var(--amber)"};"></span>
                  <span class="mask-list-label">${escapeHtml(rectLabelOf(r))}</span>
                  <span class="badge badge-${r.auto ? "info" : "warning"}">${r.auto ? "자동" : "수동"}</span>
                </li>`
                  )
                  .join("")}</ul>`
          }
        </div>
      </div>
    </div>
  `;

  applyDocumentPageRatio();
  bindViewerEvents(doc);

  const newMaskList = document.getElementById("maskList");
  if (newMaskList) {
    newMaskList.scrollTop = maskListScrollTop;
  }

  // 영역들이 드래그/리사이즈/타이핑 이벤트가 붙은 실제 DOM으로 그려져야
  // 하므로, innerHTML을 다 채운 다음 별도로 채워 넣는다.
  if (canEditHere) renderEditableRects();
}

/*
 * 기존 뷰어는 모든 문서를 A4 세로 비율로 고정해 가로 이미지의 좌우가
 * 잘렸다. 현재 표시 중인 원본 또는 마스킹 이미지가 로드되면 실제 픽셀
 * 크기를 읽어 종이 영역의 비율을 맞춘다. 마스킹 좌표는 % 단위이므로
 * 종이 크기가 바뀌어도 같은 위치를 유지한다.
 */
function applyDocumentPageRatio() {
  const pageElement = document.getElementById("docPageView");
  const imageElement = pageElement ? pageElement.querySelector(".doc-preview-img") : null;
  if (!pageElement || !imageElement) return;

  const updateRatio = function () {
    if (!imageElement.naturalWidth || !imageElement.naturalHeight) return;
    pageElement.style.setProperty(
      "--document-page-ratio",
      imageElement.naturalWidth + " / " + imageElement.naturalHeight
    );
  };

  if (imageElement.complete) {
    updateRatio();
  } else {
    imageElement.addEventListener("load", updateRatio, { once: true });
  }
}

function bindViewerEvents(doc) {
  const toggleBtn = document.getElementById("btnToggleOriginal");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showOriginal = !showOriginal;
      renderViewer();
    });
  }

  const undoBtn = document.getElementById("btnUndo");
  if (undoBtn) undoBtn.addEventListener("click", undoEdit);
  const redoBtn = document.getElementById("btnRedo");
  if (redoBtn) redoBtn.addEventListener("click", redoEdit);
  const deleteSelectedBtn = document.getElementById("btnDeleteSelected");
  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener("click", deleteSelectedEditRect);
  const resetEditsBtn = document.getElementById("btnResetEdits");
  if (resetEditsBtn) resetEditsBtn.addEventListener("click", resetEditRects);

  // 빈 곳을 mousedown하면 새 영역을 드래그로 그리기 시작한다(의미 있게
  // 드래그하지 않고 그냥 클릭만 했으면 startDrawNewEditRect 안에서 선택만
  // 해제한다). 원본 보기 중에는 편집 레이어(#editRectsLayer) 자체가 없으니
  // 이 리스너도 필요 없다.
  const docPageView = document.getElementById("docPageView");
  if (docPageView && document.getElementById("editRectsLayer")) {
    docPageView.addEventListener("mousedown", (e) => {
      const isBackground =
        e.target === docPageView ||
        e.target.id === "editRectsLayer" ||
        e.target.classList.contains("doc-preview-img");
      if (!isBackground) return;
      startDrawNewEditRect(e);
    });
  }
  const maskList = document.getElementById("maskList");
  if (maskList) {
    maskList.addEventListener("click", (e) => {
      const item = e.target.closest(".mask-list-item");
      if (!item) return;
      const rectId = item.getAttribute("data-rect-id");
      const rect = findEditRect(rectId);
      if (!rect || rect.auto) return;
      selectedRectId = selectedRectId === rectId ? null : rectId;
      refreshRectSelection();
    });
  }

  const prevPageBtn = document.getElementById("btnPrevPage");
  const nextPageBtn = document.getElementById("btnNextPage");
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      const idx = doc.pages.findIndex((p) => p.pageNo === currentPageNo);
      if (idx > 0) {
        currentPageNo = doc.pages[idx - 1].pageNo;
        renderViewer();
      }
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      const idx = doc.pages.findIndex((p) => p.pageNo === currentPageNo);
      if (idx < doc.pages.length - 1) {
        currentPageNo = doc.pages[idx + 1].pageNo;
        renderViewer();
      }
    });
  }

  document.getElementById("btnDownloadJson").addEventListener("click", () => {
    const ocrResults = (doc.pages || [])
      .map((page) => page.ocrResult)
      .filter((ocrResult) => ocrResult);

    if (ocrResults.length === 0) {
      showToast("다운로드할 실제 OCR 결과가 없습니다.", "danger");
      return;
    }

    Api.downloadJSON(`${doc.fileName}_ocr.json`, {
      fileName: doc.fileName,
      pageCount: ocrResults.length,
      fullText: doc.fullText || "",
      ocrResults,
    });
  });

  document.getElementById("btnDownloadTxt").addEventListener("click", () => {
    const page = currentPageOf(doc);
    if (!page || typeof page.ocrText !== "string") {
      showToast("다운로드할 실제 OCR 텍스트가 없습니다.", "danger");
      return;
    }

    Api.downloadText(
      `${doc.fileName}_p${currentPageNo}_ocr.txt`,
      page.ocrText
    );
  });

  document.getElementById("btnDownloadPiiLog").addEventListener("click", () => {
    const pagesWithPiiResults = (doc.pages || []).filter((page) =>
      Array.isArray(page.piiSpans)
    );

    if (pagesWithPiiResults.length === 0) {
      showToast("다운로드할 실제 개인정보 검출 결과가 없습니다.", "danger");
      return;
    }

    const pages = pagesWithPiiResults.map((page) => ({
      page: page.pageNo,
      spans: page.piiSpans,
    }));
    const detectionCount = pages.reduce(
      (total, page) => total + page.spans.length,
      0
    );

    Api.downloadJSON(`${doc.fileName}_pii.json`, {
      fileName: doc.fileName,
      pageCount: doc.pageCount,
      detectionCount,
      pages,
    });
  });

  const downloadImageBtn = document.getElementById("btnDownloadImage");
  if (downloadImageBtn) downloadImageBtn.addEventListener("click", async () => {
    try {
      const fileBaseName = doc.fileName.replace(/\.[^.]+$/, "");
      showToast("마스킹 결과 파일을 생성하고 있습니다.", "success");

      if (doc.pages.length === 1) {
        const canvas = await buildMaskedPageCanvas(doc, doc.pages[0], 0);
        const pngBlob = await canvasToBlob(canvas, "image/png");
        downloadBlob(`${fileBaseName}_masked.png`, pngBlob);
      } else {
        const pdfPages = [];

        for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
          const page = doc.pages[pageIndex];
          const canvas = await buildMaskedPageCanvas(doc, page, pageIndex);
          const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.95);
          pdfPages.push({
            jpegBytes: new Uint8Array(await jpegBlob.arrayBuffer()),
            width: canvas.width,
            height: canvas.height,
          });

          // 큰 다중 페이지 문서에서 사용이 끝난 canvas 메모리를 바로 줄인다.
          canvas.width = 1;
          canvas.height = 1;
        }

        const pdfBlob = createImageOnlyPdfBlob(pdfPages);
        downloadBlob(`${fileBaseName}_masked.pdf`, pdfBlob);
      }

      DiagnosticLog.add("info", "MASKED_RESULT_DOWNLOAD_COMPLETED", {
        document_id: doc.id,
        file_name: doc.fileName,
        page_count: doc.pages.length,
        output_format: doc.pages.length === 1 ? "png" : "image_pdf",
      });
    } catch (error) {
      DiagnosticLog.add("error", "MASKED_RESULT_DOWNLOAD_FAILED", {
        document_id: doc.id,
        file_name: doc.fileName,
        page_count: doc.pages.length,
        message: error.message || "마스킹 결과 파일을 만들지 못했습니다.",
      });
      showToast(error.message || "마스킹 결과 파일을 만들지 못했습니다.", "danger");
    }
  });
}

/**
 * 한 페이지의 서버 자동 마스킹 이미지와 브라우저 수동 마스킹을 합친다.
 * 반환된 canvas가 다운로드 결과의 최종 픽셀이므로 그 아래에는 원본 PDF의
 * 텍스트 레이어가 남지 않는다.
 */
async function buildMaskedPageCanvas(doc, page, pageIndex) {
  const uploadedOriginalSrc =
    doc.previewPages && doc.previewPages.length
      ? doc.previewPages[Math.min(pageIndex, doc.previewPages.length - 1)]
      : doc.previewKind === "image"
      ? doc.previewDataUrl
      : null;
  const serverMaskedSrc = page.maskingImage || null;
  const imageSrc = serverMaskedSrc || uploadedOriginalSrc;

  if (!imageSrc) {
    throw new Error(`${page.pageNo}페이지의 결과 이미지가 없습니다.`);
  }

  const image = await loadImageEl(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";

  // 서버 결과에는 자동 마스킹이 이미 포함되어 있으므로 수동 영역만 추가한다.
  // 서버 결과 이미지가 없을 때만 업로드 원본 위에 전체 영역을 그린다.
  const rectsToDraw = serverMaskedSrc
    ? getDisplayRectsForPage(doc, page).filter((rect) => !rect.auto)
    : getDisplayRectsForPage(doc, page);

  rectsToDraw.forEach(function (rect) {
    context.fillRect(
      canvas.width * (rect.left / 100),
      canvas.height * (rect.top / 100),
      canvas.width * (rect.width / 100),
      canvas.height * (rect.height / 100)
    );
  });

  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(function (resolve, reject) {
    canvas.toBlob(function (blob) {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("마스킹 이미지를 파일로 변환하지 못했습니다."));
      }
    }, type, quality);
  });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---- 초기화 --------------------------------------------------------

function init() {
  renderOptionsInline();
  renderFileList();

  const requestedDocId = new URLSearchParams(window.location.search).get("doc");
  if (requestedDocId && findDoc(requestedDocId)) {
    selectDoc(requestedDocId);
  } else {
    const docs = Storage.getJobResults() || [];
    if (docs.length > 0) selectDoc(docs[0].id);
    else renderViewerEmpty();
  }

  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length > 0) handleFileSelected(e.target.files[0]);
    fileInput.value = "";
  });

  const addFileRow = document.getElementById("addFileRow");
  ["dragenter", "dragover"].forEach((evt) =>
    addFileRow.addEventListener(evt, (e) => {
      e.preventDefault();
      addFileRow.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    addFileRow.addEventListener(evt, (e) => {
      e.preventDefault();
      addFileRow.classList.remove("dragover");
    })
  );
  addFileRow.addEventListener("drop", (e) => {
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    if (e.dataTransfer.files.length > 1) showToast("한 번에 한 문서만 처리됩니다. 첫 번째 파일만 사용합니다.", "danger");
    handleFileSelected(e.dataTransfer.files[0]);
  });

  document.getElementById("btnClearHistory").addEventListener("click", clearHistory);
}

document.addEventListener("DOMContentLoaded", init);
