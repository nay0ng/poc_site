/**
 * storage.js
 * ---------------------------------------------------------------------------
 * 브라우저 localStorage를 이용한 아주 단순한 상태 저장소.
 * 백엔드가 없는 프론트 스캐폴드 단계에서 "화면 간 데이터 전달"을 흉내내기 위한
 * 용도이며, 실제 서버 연동 시에는 이 파일 대신 서버 API 응답을 사용하면 된다.
 *
 * 저장 키
 *  - kb_poc_settings   : 개인정보 유형 / 체크섬 옵션 값. 새 문서를 업로드할 때
 *                        사용하고, 현재 문서의 원본 File이 메모리에 남아 있으면
 *                        토글 변경 시 새 policy로 다시 처리한다.
 *  - kb_poc_jobResults : 지금까지 인식한 문서 목록(최근 항목이 앞쪽), 문서마다
 *                        appliedSettings 필드에 그 당시 적용된 옵션 스냅샷이 있다.
 */

const STORAGE_KEYS = {
  SETTINGS: "kb_poc_settings",
  JOB_RESULTS: "kb_poc_jobResults",
  MANUAL_MASKS: "kb_poc_manualMasks",
};

// OCR 응답에는 페이지 이미지와 상세 OCR JSON이 함께 들어와 브라우저의
// localStorage 용량을 쉽게 넘을 수 있다. 현재 실행 중인 화면에서는 결과를
// 계속 볼 수 있도록 전체 결과를 메모리에도 보관한다.
let memoryJobResults = null;

const DEFAULT_SETTINGS = {
  // 고유식별정보 4종은 항상 활성화(잠금)이며 사용자가 끌 수 없다.
  piiTypes: {
    resident_registration_number: true,
    foreigner_registration_number: true,
    passport_number: true,
    driver_license_number: true,
    phone_number: false,
    email_address: false,
  },
  checksum: false,
  updatedAt: null,
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[storage] failed to parse", key, e);
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Storage = {
  getSettings() {
    const saved = loadJSON(STORAGE_KEYS.SETTINGS, {});
    const savedPiiTypes = saved.piiTypes || {};
    const piiTypes = {};

    Object.keys(DEFAULT_SETTINGS.piiTypes).forEach(function (key) {
      piiTypes[key] = key in savedPiiTypes
        ? !!savedPiiTypes[key]
        : DEFAULT_SETTINGS.piiTypes[key];
    });

    return { ...DEFAULT_SETTINGS, ...saved, piiTypes };
  },
  saveSettings(settings) {
    const merged = { ...this.getSettings(), ...settings, updatedAt: new Date().toISOString() };
    saveJSON(STORAGE_KEYS.SETTINGS, merged);
    return merged;
  },

  getJobResults() {
    if (memoryJobResults !== null) {
      return memoryJobResults;
    }
    return loadJSON(STORAGE_KEYS.JOB_RESULTS, null);
  },
  saveJobResults(list) {
    memoryJobResults = list;
    try {
      saveJSON(STORAGE_KEYS.JOB_RESULTS, list);
    } catch (error) {
      // 큰 PDF는 저장 용량을 초과할 수 있다. 이 경우에도 OCR 요청 자체는
      // 성공한 것이므로 오류로 처리하지 않고 현재 탭의 메모리에서 유지한다.
      console.warn("[storage] 문서 결과가 커서 현재 탭의 메모리에만 보관합니다.", error);
    }
  },

  getManualMasks() {
    return loadJSON(STORAGE_KEYS.MANUAL_MASKS, {});
  },
  saveManualMaskForDoc(docId, pageNo, rects) {
    const all = this.getManualMasks();
    all[`${docId}#${pageNo}`] = rects;
    saveJSON(STORAGE_KEYS.MANUAL_MASKS, all);
  },
  getManualMaskForDoc(docId, pageNo) {
    const all = this.getManualMasks();
    return all[`${docId}#${pageNo}`] || null;
  },

  clearAll() {
    memoryJobResults = null;
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
  },

  /** 인식 기록과 수동 마스킹 편집 내용을 지운다. (탐지 옵션 값은 유지) */
  resetHistory() {
    memoryJobResults = null;
    localStorage.removeItem(STORAGE_KEYS.JOB_RESULTS);
    localStorage.removeItem(STORAGE_KEYS.MANUAL_MASKS);
  },
};
