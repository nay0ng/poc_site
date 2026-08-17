/**
 * common.js
 * ---------------------------------------------------------------------------
 * 모든 페이지에서 공통으로 쓰는 유틸 함수 모음.
 *  - 상태값 -> 배지(badge) 클래스/라벨 매핑
 *  - 자잘한 포맷 유틸(파일크기, 시간 등), 토스트 알림
 *  - 개인정보 유형/마스킹 영역 관련 공용 로직
 *
 * 화면이 index.html 하나뿐이라 공통 상단바(topbar)도 그 안에 직접
 * 마크업을 써두었다. (예전에는 화면이 여러 개라 여기서 사이드바 네비게이션을
 * 자동으로 그려주거나, 수동 마스킹 편집을 별도 화면(masking.html)으로
 * 분리해뒀지만, 지금은 index.html 하나 안에서 뷰어와 편집을 모두 처리한다.)
 */

// ---- 상태값 -> 배지 매핑 -----------------------------------------------

const STATUS_BADGE_MAP = {
  // 공통 성공/완료 계열
  "정상": "success", "성공": "success", "실행완료": "success", "생성완료": "success", "처리완료": "success", "검수완료": "success",
  // 진행/대기 계열
  "대기": "info", "처리 중": "info", "처리중": "info", "미검수": "info",
  // 경고(부분) 계열
  "부분처리": "warning", "일부 페이지 오류": "warning",
  // 오류 계열
  "실패": "danger", "실행오류": "danger", "생성오류": "danger", "생성실패": "danger", "손상 파일": "danger",
  "입력오류": "danger", "OCR실행오류": "danger", "개인정보엔진실행오류": "danger", "결과이미지생성오류": "danger",
  // 미실행/중립
  "미실행": "neutral",
};

function badgeHtml(statusText) {
  const cls = STATUS_BADGE_MAP[statusText] || "neutral";
  return `<span class="badge badge-${cls}">${statusText}</span>`;
}

// ---- 아이콘 -----------------------------------------------------------
// 이모지 대신 브랜드 마크(마스킹 바 3줄)를 재사용한 SVG와, 로딩 상태를
// 나타내는 CSS 스피너를 쓴다. 두 함수 모두 .empty-icon 안에 넣어 쓴다.

function docMarkIcon(size) {
  const s = size || 30;
  return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" aria-hidden="true" style="color:var(--text-secondary);">
    <rect x="1" y="3" width="18" height="3" fill="currentColor" />
    <rect x="1" y="8.5" width="11" height="3" fill="currentColor" />
    <rect x="1" y="14" width="18" height="3" fill="currentColor" />
  </svg>`;
}

function spinnerIcon() {
  return `<span class="spinner" role="status" aria-label="처리 중"></span>`;
}

// ---- 포맷 유틸 -----------------------------------------------------------

function formatBytes(kb) {
  if (kb >= 1024) return (kb / 1024).toFixed(1) + " MB";
  return kb + " KB";
}

function formatSeconds(sec) {
  if (sec === null || sec === undefined) return "-";
  return sec.toFixed(2) + "초";
}

function formatRelativeTime(ts) {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  return `${Math.round(diffMin / 60)}시간 전`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---- 토스트 알림 -----------------------------------------------------------

let toastTimer = null;
function showToast(message, variant) {
  let el = document.getElementById("global-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = "toast show" + (variant ? ` toast-${variant}` : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 2400);
}

// ---- 개인정보 유형 유틸 -----------------------------------------------------------

function activePiiTypes(settings) {
  return Object.keys(PII_TYPE_META).filter((key) => settings.piiTypes[key]);
}

function piiCountsForActiveTypes(piiCounts, settings) {
  const active = activePiiTypes(settings);
  const out = {};
  active.forEach((k) => (out[k] = piiCounts[k] || 0));
  return out;
}

/**
 * 화면에 표시할 마스킹 영역 목록을 반환한다.
 * 수동 마스킹 편집기에서 저장한 결과(storage)가 있으면 그것을 최종본으로 쓰고,
 * 없으면 자동 마스킹 결과(page.maskRects)를 그 문서에 적용됐던 개인정보 유형
 * 설정(doc.appliedSettings)으로 걸러서 보여준다. 문서마다 적용한 옵션이 다를
 * 수 있으므로, 전역 설정이 아니라 반드시 해당 문서에 저장된 값을 기준으로 한다.
 * (저장본은 자동+수동 영역을 모두 포함한 편집 후 최종 상태라 다시 거를 필요가 없다.)
 */
function getDisplayRectsForPage(doc, page) {
  if (!doc || !page) return [];
  const saved = Storage.getManualMaskForDoc(doc.id, page.pageNo);
  if (saved) return saved;
  const settings = doc.appliedSettings || Storage.getSettings();
  return (page.maskRects || []).filter((r) => !r.auto || settings.piiTypes[r.type]);
}
