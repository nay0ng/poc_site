/**
 * api.js
 * ---------------------------------------------------------------------------
 * 실제 /uploadOCR API 호출, 응답 변환, 다운로드 유틸을 한 곳에 모아둔 파일.
 * 최근 문서와 수동 마스킹 결과는 PoC 화면의 localStorage에 저장한다.
 */

const DIAGNOSTIC_LOG_KEY = "kb_poc_diagnostic_logs";
const DIAGNOSTIC_LOG_LIMIT = 300;

// 화면에서 발생한 API/응답 변환 오류를 브라우저에 보관한다.
// OCR 전문, 개인정보 문자열, 이미지 base64는 로그에 넣지 않는다.
const DiagnosticLog = {
  read() {
    try {
      const saved = JSON.parse(localStorage.getItem(DIAGNOSTIC_LOG_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      console.warn("[diagnostic] 저장된 로그를 읽지 못했습니다.", error);
      return [];
    }
  },

  add(level, event, details) {
    const entry = {
      time: new Date().toISOString(),
      level: level,
      event: event,
      ...details,
    };

    const logs = this.read();
    logs.push(entry);

    try {
      localStorage.setItem(
        DIAGNOSTIC_LOG_KEY,
        JSON.stringify(logs.slice(-DIAGNOSTIC_LOG_LIMIT))
      );
    } catch (error) {
      console.warn("[diagnostic] 로그를 저장하지 못했습니다.", error);
    }

    const consoleMethod = level === "error" ? "error" : level === "warning" ? "warn" : "info";
    console[consoleMethod](`[${event}]`, entry);
    return entry;
  },

};

window.addEventListener("error", function (event) {
  DiagnosticLog.add("error", "JAVASCRIPT_ERROR", {
    message: event.message || "알 수 없는 JavaScript 오류",
    source: event.filename || null,
    line: event.lineno || null,
    column: event.colno || null,
    stack: event.error && event.error.stack ? event.error.stack : null,
  });
});

window.addEventListener("unhandledrejection", function (event) {
  const reason = event.reason;
  DiagnosticLog.add("error", "UNHANDLED_PROMISE_REJECTION", {
    message: reason && reason.message ? reason.message : String(reason || "알 수 없는 비동기 오류"),
    stack: reason && reason.stack ? reason.stack : null,
  });
});

const Api = {
  /**
   * 문서 1건 + 그 문서에 적용할 개인정보 탐지 옵션으로 OCR/개인정보 인식을
   * 즉시 요청한다. 문서마다 다른 옵션을 적용할 수 있도록, 결과 문서 객체에는
   * 이번 인식에 실제로 적용된 옵션 값(appliedSettings)을 함께 저장해둔다.
   */
    async recognizeDocument(file, settings) {
      const doc = await requestOcrDocument(file, settings);

      const history = [
        doc,
        ...(Storage.getJobResults() || []),
      ].slice(0, 10);

      Storage.saveJobResults(history);

      return doc;
    },

  /** 현재 문서를 새 탐지 옵션으로 다시 처리하되 최근 문서 ID는 유지한다. */
  async reprocessDocument(file, settings, documentId) {
    const doc = await requestOcrDocument(file, settings);
    doc.id = documentId;
    return doc;
  },
  async getJobResults() {
    return Storage.getJobResults() || [];
  },

  async getDocument(docId) {
    const results = await this.getJobResults();
    return results.find((d) => d.id === docId) || null;
  },

  async saveManualMask(docId, pageNo, rects) {
    Storage.saveManualMaskForDoc(docId, pageNo, rects);
    return { ok: true };
  },

  async saveSettings(settings) {
    return Storage.saveSettings(settings);
  },

  // OCR 결과 JSON/TXT, 개인정보 검출 내역, 마스킹 이미지 등의 다운로드는
  // 실제 연동 시 서버가 파일(blob) 또는 다운로드 URL을 내려주는 형태가 된다.
  // 지금은 화면 흐름 확인용으로 브라우저에서 JSON을 직접 생성해 다운로드한다.
  downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    triggerDownload(blob, filename);
  },

  downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain" });
    triggerDownload(blob, filename);
  },
};

async function requestOcrDocument(file, settings) {
  if (!file || !file.raw) {
    DiagnosticLog.add("error", "OCR_REQUEST_FILE_MISSING", {
      message: "다시 처리할 원본 파일이 없습니다.",
    });
    throw new Error("다시 처리할 원본 파일이 없습니다.");
  }

  const requestId = "front-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const startedAt = performance.now();
  const policy = buildPolicy(settings);

  DiagnosticLog.add("info", "OCR_REQUEST_STARTED", {
    frontend_request_id: requestId,
    file_name: file.fileName,
    file_extension: file.ext,
    file_size_kb: file.sizeKB,
    selected_categories: policy.detection.selected_categories,
    pattern_strictness: policy.detection.pattern_strictness,
    checksum_validation_enabled: policy.detection.checksum_validation_enabled,
  });

  const form = new FormData();
  form.append("srcFile", file.raw);
  form.append("policy", JSON.stringify(policy));

  let response;
  try {
    response = await fetch("http://172.30.1.18:19816/uploadOCR", {
      method: "POST",
      body: form,
    });
  } catch (error) {
    DiagnosticLog.add("error", "OCR_REQUEST_NETWORK_ERROR", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      elapsed_ms: Math.round(performance.now() - startedAt),
      message: error.message,
      stack: error.stack || null,
    });
    throw error;
  }

  if (!response.ok) {
    const errorMessage = await response.text();
    DiagnosticLog.add("error", "OCR_HTTP_ERROR", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      http_status: response.status,
      elapsed_ms: Math.round(performance.now() - startedAt),
      message: errorMessage.slice(0, 500),
    });
    throw new Error(`인식 요청 실패: ${response.status} ${errorMessage}`);
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    DiagnosticLog.add("error", "OCR_RESPONSE_JSON_ERROR", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      http_status: response.status,
      elapsed_ms: Math.round(performance.now() - startedAt),
      message: error.message,
    });
    throw error;
  }

  if (result.resultCode !== "0000") {
    DiagnosticLog.add("error", "OCR_RESULT_ERROR", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      http_status: response.status,
      result_code: result.resultCode || null,
      message: result.message || "OCR 처리 실패",
      elapsed_ms: Math.round(performance.now() - startedAt),
    });
    throw new Error(result.message || "OCR 처리 실패");
  }

  if (!Array.isArray(result.ocrResults) || result.ocrResults.length === 0) {
    DiagnosticLog.add("error", "OCR_RESULTS_MISSING", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      message: "응답에 ocrResults가 없거나 비어 있습니다.",
    });
    throw new Error("응답에 OCR 페이지 결과가 없습니다.");
  }

  if (!Array.isArray(result.spans)) {
    DiagnosticLog.add("warning", "PII_SPANS_MISSING", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      ocr_page_count: result.ocrResults.length,
      message: "응답에 spans 배열이 없습니다.",
    });
  } else if (result.spans.length !== result.ocrResults.length) {
    DiagnosticLog.add("warning", "PII_PAGE_COUNT_MISMATCH", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      ocr_page_count: result.ocrResults.length,
      span_page_count: result.spans.length,
      message: "OCR 페이지 수와 spans 페이지 수가 다릅니다.",
    });
  }

  if (!Array.isArray(result.maskingImages)) {
    DiagnosticLog.add("warning", "MASKING_IMAGES_MISSING", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      ocr_page_count: result.ocrResults.length,
      message: "응답에 maskingImages 배열이 없습니다.",
    });
  } else if (result.maskingImages.length !== result.ocrResults.length) {
    DiagnosticLog.add("warning", "MASKING_IMAGE_PAGE_COUNT_MISMATCH", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      ocr_page_count: result.ocrResults.length,
      masking_image_count: result.maskingImages.length,
      message: "OCR 페이지 수와 마스킹 이미지 수가 다릅니다.",
    });
  }

  const document = convertResponseToDocument(result, file, settings, requestId);
  const totalSpans = document.pages.reduce(function (sum, page) {
    return sum + (Array.isArray(page.piiSpans) ? page.piiSpans.length : 0);
  }, 0);

  DiagnosticLog.add("info", "OCR_REQUEST_COMPLETED", {
    frontend_request_id: requestId,
    file_name: file.fileName,
    http_status: response.status,
    result_code: result.resultCode,
    page_count: document.pageCount,
    span_count: totalSpans,
    masking_image_count: Array.isArray(result.maskingImages) ? result.maskingImages.filter(Boolean).length : 0,
    elapsed_ms: Math.round(performance.now() - startedAt),
  });

  return document;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildPolicy(settings) {
  const selectedCategories = CORE_PII_TYPES.slice();
  const aegisEntityTypes = [];

  aegisEntityTypes.push("IDCARD");
  aegisEntityTypes.push("DRIVERLICENSENUM");

  if (settings.piiTypes.phone_number) {
    selectedCategories.push("phone_number");
    aegisEntityTypes.push("TELEPHONENUM");
  }

  if (settings.piiTypes.email_address) {
    selectedCategories.push("email_address");
    aegisEntityTypes.push("EMAIL");
  }

  return {
    schema_version: 1,
    detection: {
      execution_mode: "always_both",
      merge_mode: "any",

      selected_categories: selectedCategories,
      pattern_strictness:
        settings.patternStrictness || "ocr_tolerant",

      aegis_scope: "all",
      aegis_entity_types: aegisEntityTypes,

      aegis_threshold_adjustment: 0.0,
      minimum_confidence: 0.0,
      minimum_risk_level: 3,

      checksum_validation_enabled: !!settings.checksum,
      checksum_invalid_action: settings.checksum ? "exclude" : "mask",

      minimum_context_evidence_count: 0,
      missing_context_action: "mask",

      anchor_required_categories: [],
      missing_anchor_action: "exclude",

      review_handling: "mask_all",
      max_adjacent_lines: 3,

      custom_person_field_labels: [],
      custom_address_field_labels: []
    },
    masking: {
      padding: 2
    }
  };
}


function convertResponseToDocument(result, file, settings, requestId) {
  const resultSpans = Array.isArray(result.spans) ? result.spans : [];
  const resultMaskingImages = Array.isArray(result.maskingImages) ? result.maskingImages : [];

  const pages = result.ocrResults.map(function (ocrResult, pageIndex) {
    const ocrResultValid = !!ocrResult && typeof ocrResult === "object";
    const imageInfo = ocrResultValid && ocrResult.imageInfo ? ocrResult.imageInfo : {};
    const imageWidth = Number(imageInfo.width);
    const imageHeight = Number(imageInfo.height);
    const imageSizeValid = imageWidth > 0 && imageHeight > 0;
    const pageSpansAvailable = Array.isArray(resultSpans[pageIndex]);
    const pageSpans = pageSpansAvailable ? resultSpans[pageIndex] : [];
    const maskingImage = resultMaskingImages[pageIndex] || null;

    const piiCounts = emptyPiiCounts();
    const maskRects = [];

    pageSpans.forEach(function (span, spanIndex) {
      const type = PII_TYPE_META[span.category] ? span.category : null;

      if (!type) {
        DiagnosticLog.add("warning", "UNSUPPORTED_PII_CATEGORY", {
          frontend_request_id: requestId,
          file_name: file.fileName,
          page: pageIndex + 1,
          span_index: spanIndex,
          category: span.category || null,
          message: "화면 유형 매핑에 없는 개인정보 category입니다.",
        });
        return;
      }

      if (!span.box || !imageSizeValid) {
        DiagnosticLog.add("warning", "PII_BBOX_MISSING", {
          frontend_request_id: requestId,
          file_name: file.fileName,
          page: pageIndex + 1,
          span_index: spanIndex,
          category: span.category,
          bbox_present: !!span.box,
          image_size_valid: imageSizeValid,
          message: "개인정보 span의 bbox 또는 페이지 크기 정보가 없습니다.",
        });
        return;
      }

      piiCounts[type] += 1;

      maskRects.push({
        id: `auto-${pageIndex}-${spanIndex}`,
        type: type,
        auto: true,
        text: span.text,

        left: span.box.x1 / imageWidth * 100,
        top: span.box.y1 / imageHeight * 100,
        width:
          (span.box.x2 - span.box.x1) /
          imageWidth *
          100,
        height:
          (span.box.y2 - span.box.y1) /
          imageHeight *
          100,
      });
    });

    if (!maskingImage) {
      DiagnosticLog.add("warning", "MASKING_IMAGE_MISSING", {
        frontend_request_id: requestId,
        file_name: file.fileName,
        page: pageIndex + 1,
        span_count: pageSpans.length,
        message: "현재 페이지의 마스킹 이미지가 없습니다.",
      });
    }

    const processTime = ocrResultValid && ocrResult.processTime ? ocrResult.processTime : {};
    const ocrTime = Number(processTime.ocr);

    DiagnosticLog.add("info", "PAGE_RESPONSE_SUMMARY", {
      frontend_request_id: requestId,
      file_name: file.fileName,
      page: pageIndex + 1,
      ocr_status: ocrResultValid ? "성공" : "실패",
      pii_engine_status: pageSpansAvailable ? "실행완료" : "실행오류",
      image_status: maskingImage ? "생성완료" : "생성실패",
      ocr_time_sec: Number.isFinite(ocrTime) ? ocrTime : null,
      pii_time_sec: Number.isFinite(Number(processTime.pii)) ? Number(processTime.pii) : null,
      masking_time_sec: Number.isFinite(Number(processTime.masking)) ? Number(processTime.masking) : null,
      span_count: pageSpans.length,
      masking_image_present: !!maskingImage,
    });

    return {
      // PDF 응답에서 모든 페이지가 page=1로 내려오는 경우가 있으므로
      // 응답 배열의 순서를 화면 페이지 번호로 사용한다.
      pageNo: pageIndex + 1,
      ocrStatus: ocrResultValid ? "성공" : "실패",
      ocrTimeSec: Number.isFinite(ocrTime) ? ocrTime : null,
      piiEngineStatus: pageSpansAvailable ? "실행완료" : "실행오류",
      imageStatus: maskingImage ? "생성완료" : "생성실패",

      piiCounts: piiCounts,
      maskCount: maskRects.length,
      maskRects: maskRects,

      ocrText: ocrResultValid && typeof ocrResult.text === "string" ? ocrResult.text : "",
      ocrResult: ocrResult,
      piiSpans: pageSpans,
      maskingImage: maskingImage,

    };
  });

  const totalPiiCounts = emptyPiiCounts();

  pages.forEach(function (page) {
    Object.keys(totalPiiCounts).forEach(function (type) {
      totalPiiCounts[type] += page.piiCounts[type] || 0;
    });
  });

  const allOcrSuccessful = pages.every(function (page) { return page.ocrStatus === "성공"; });
  const allPiiSuccessful = pages.every(function (page) { return page.piiEngineStatus === "실행완료"; });
  const allImagesSuccessful = pages.every(function (page) { return page.imageStatus === "생성완료"; });
  const allStagesSuccessful = allOcrSuccessful && allPiiSuccessful && allImagesSuccessful;

  return {
    id:
      "u-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 7),

    fileName: file.fileName,
    ext: file.ext,
    sizeKB: file.sizeKB,

    pageCount: pages.length,
    pages: pages,
    piiCounts: totalPiiCounts,

    inputStatus: "정상",
    convertStatus: "성공",
    ocrStatus: allOcrSuccessful ? "성공" : "실패",
    piiEngineStatus: allPiiSuccessful ? "실행완료" : "실행오류",
    imageStatus: allImagesSuccessful ? "생성완료" : "생성실패",
    finalStatus: allStagesSuccessful ? "처리완료" : "부분처리",

    appliedSettings: JSON.parse(
      JSON.stringify(settings)
    ),

    previewDataUrl: file.previewDataUrl || null,
    previewKind: file.previewKind || null,
    previewPages: file.previewPages || null,
    previewFailed: !!file.previewFailed,

    fullText: result.fullText,
  };
}
