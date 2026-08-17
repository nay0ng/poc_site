# KB OCR·PII 마스킹 PoC API 명세서

## 1. 문서의 기준

이 명세는 향후 문서별 저장·조회 API를 구성할 때 사용할 확장 규격이다. 다음 두 구현을 함께 기준으로 작성한다.

- 프론트 화면: `kb_demo-main/index.html`, `js/main.js`
- 실제 OCR·PII 엔진: `kb_stock/main.py`, `engine/processors/KB_FULL_OCR_TORCH.py`, `pii_masking`

현재 상태는 다음과 같다.

- 프론트는 실제 `POST /uploadOCR`에 `srcFile`과 `policy`를 전송한다.
- `/uploadOCR` 응답의 `ocrResults`, `spans`, `maskingImages`를 뷰어에 표시한다.
- 최근 문서, 화면 옵션과 수동 마스킹 결과는 현재 브라우저 `localStorage`에서 관리한다.
- 문서 결과 조회·수동 마스킹 서버 저장을 위한 `/poc` API는 제품화 단계에서 구현해야 한다.
- `/poc` API는 기존 OCR·PII 엔진을 다시 만드는 것이 아니라, 기존 엔진의 입력과 출력 파일을 웹 화면에 연결하는 얇은 API 계층이다.

### 1.1 반드시 구분할 데이터

| 구분 | 기준 | 용도 |
| --- | --- | --- |
| 백엔드 개인정보 유형 | `resident_registration_number` 같은 긴 키 | 정책, 엔진 결과, API, 다운로드 파일 |
| 프론트 표시 이름 | 주민등록번호 같은 한글 라벨 | 화면 출력 |
| 백엔드 좌표 | 원본 이미지 기준 픽셀 `x1`, `y1`, `x2`, `y2` | 결과 저장, 이미지 마스킹, 다운로드 |
| 프론트 편집 좌표 | 이미지 크기에 대한 `%` `top`, `left`, `width`, `height` | 반응형 화면에서 사각형 표시·편집 |

즉, `%` 좌표는 프론트 표시·편집용 표현이지만 개인정보 유형 키는 백엔드 API 값을 그대로 사용한다.

## 2. API 목록

| 기능 | Method | 주소 | 비고 |
| --- | --- | --- | --- |
| 문서 업로드 및 처리 | POST | `/poc/documents` | 문서와 전체 policy 전송 |
| 문서 처리 결과 조회 | GET | `/poc/documents/{document_id}` | 뷰어 데이터 조회 |
| 탐지 옵션 변경 및 재탐지 | PUT | `/poc/documents/{document_id}/detection-options` | 기존 OCR 결과 재사용 |
| OCR JSON 다운로드 | GET | `/poc/documents/{document_id}/ocr.json` | 백엔드 생성 파일 원본 |
| 현재 페이지 TXT 다운로드 | GET | `/poc/documents/{document_id}/pages/{page}/ocr.txt` | 백엔드 생성 텍스트 |
| 개인정보 내역 다운로드 | GET | `/poc/documents/{document_id}/pii.json` | 백엔드 `pii_result.json` 원본 |
| 원본 페이지 이미지 | GET | `/poc/documents/{document_id}/pages/{page}/original-image` | 브라우저 표시용 |
| 마스킹 페이지 이미지 | GET | `/poc/documents/{document_id}/pages/{page}/masked-image` | 자동·수동 반영 결과 |
| 수동 마스킹 결과 저장 | PUT | `/poc/documents/{document_id}/pages/{page}/masks` | 픽셀 좌표로 저장 |

최근 처리 문서 목록은 현재 프론트의 `localStorage`에서만 관리하므로 API 목록에 포함하지 않는다.

### 2.1 Notion API 페이지 속성

| API 페이지 제목 | 카테고리 | 설명 | Method | URL | param | 기타 | 사용자 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 문서 업로드 및 처리 | 문서 처리 | 문서와 탐지 정책을 전송하고 전체 처리를 실행한다. | POST | `/poc/documents` | Body: `file`, `policy` | `multipart/form-data` | 사용자 |
| 문서 처리 결과 조회 | 결과 조회 | 저장된 문서의 화면 표시용 결과를 조회한다. | GET | `/poc/documents/{document_id}` | Path: `document_id` | JSON | 사용자 |
| 탐지 옵션 변경 및 재탐지 | 개인정보 처리 | 변경된 전체 policy로 PII 탐지와 마스킹을 다시 실행한다. | PUT | `/poc/documents/{document_id}/detection-options` | Path: `document_id`; Body: policy | OCR 재실행 없음 | 사용자 |
| OCR JSON 다운로드 | 결과 다운로드 | 엔진이 저장한 OCR JSON을 반환한다. | GET | `/poc/documents/{document_id}/ocr.json` | Path: `document_id` | 파일 | 사용자 |
| 현재 페이지 TXT 다운로드 | 결과 다운로드 | 선택 페이지의 OCR 텍스트를 반환한다. | GET | `/poc/documents/{document_id}/pages/{page}/ocr.txt` | Path: `document_id`, `page` | 파일 | 사용자 |
| 개인정보 내역 다운로드 | 결과 다운로드 | 엔진이 저장한 PII 결과 JSON을 반환한다. | GET | `/poc/documents/{document_id}/pii.json` | Path: `document_id` | 파일 | 사용자 |
| 원본 페이지 이미지 | 이미지 조회 | 선택 페이지의 원본 이미지를 반환한다. | GET | `/poc/documents/{document_id}/pages/{page}/original-image` | Path: `document_id`, `page` | 이미지 | 사용자 |
| 마스킹 페이지 이미지 | 이미지 조회 | 선택 페이지의 최종 마스킹 이미지를 반환한다. | GET | `/poc/documents/{document_id}/pages/{page}/masked-image` | Path: `document_id`, `page` | 이미지 | 사용자 |
| 수동 마스킹 결과 저장 | 수동 마스킹 | 편집 후 최종 마스킹 영역을 픽셀 좌표로 저장한다. | PUT | `/poc/documents/{document_id}/pages/{page}/masks` | Path: `document_id`, `page`; Body: `masks` | JSON | 사용자 |

## 3. 공통 데이터 계약

### 3.1 개인정보 유형 키

API, policy, 엔진 결과와 다운로드 파일은 실제 백엔드가 사용하는 다음 키를 그대로 사용한다.

| API·백엔드 키 | 화면 표시 |
| --- | --- |
| `resident_registration_number` | 주민등록번호 |
| `foreigner_registration_number` | 외국인등록번호 |
| `passport_number` | 여권번호 |
| `driver_license_number` | 운전면허번호 |
| `phone_number` | 전화번호 |
| `email_address` | 이메일 |

프론트의 설정, 검출 건수와 마스킹 영역도 위 백엔드 키를 그대로 사용한다. 따라서 개인정보 유형을 위한 별도의 짧은 키 변환 단계는 없다.

### 3.2 탐지 정책

업로드와 재탐지 요청에는 `poc_policy.json` 전체 내용을 전달한다. 개인정보 유형은 다음 위치에서 선택한다.

```json
{
  "schema_version": 1,
  "detection": {
    "selected_categories": [
      "resident_registration_number",
      "foreigner_registration_number",
      "passport_number",
      "driver_license_number",
      "phone_number",
      "email_address"
    ],
    "checksum_validation_enabled": false
  }
}
```

프론트의 전화번호·이메일·체크섬 토글을 변경할 때는 기존 `poc_policy.json`을 기준으로 다음 값만 바꾼 뒤 전체 JSON을 보낸다.

- 전화번호: `selected_categories`의 `phone_number` 포함 여부
- 이메일: `selected_categories`의 `email_address` 포함 여부
- 체크섬: `checksum_validation_enabled`

### 3.3 백엔드 개인정보 탐지 결과 `PiiDetection`

실제 `kb_stock`의 `pii_result.json`에 저장되는 한 건의 구조다. API에서도 필드명을 바꾸지 않는다.

| key | 설명 | value 타입 | Nullable | 예시 |
| --- | --- | --- | --- | --- |
| `category` | 개인정보 유형 | String | X | `resident_registration_number` |
| `text` | OCR에서 탐지한 문자열 | String | X | `******-*******` |
| `normalized_text` | 탐지용 정규화 문자열 | String | X | `******-*******` |
| `line_ids` | 관련 OCR 줄 ID | Array&lt;Integer&gt; | X | `[9]` |
| `raw_span` | OCR 원문 내 시작·끝 문자 위치 | Array&lt;Integer&gt; | X | `[340, 354]` |
| `token_ids` | 관련 OCR token ID | Array&lt;Integer&gt; | X | `[41]` |
| `boxes` | 관련 OCR token의 픽셀 좌표 | Array&lt;PixelBox&gt; | X | 아래 예시 |
| `ocr_confidence` | OCR 인식 신뢰도 | Number | O | `1.0` |
| `detector_confidence` | 규칙 점수 또는 모델 confidence | Number | X | `1.0` |
| `rule_id` | 탐지 출처와 규칙 | String | X | `ko_pii:RRN` |
| `review_required` | 검수 후보 여부 | Boolean | X | `false` |
| `risk_level` | ko-pii 위험도 | Integer | O | `5` |
| `evidence` | 판정 근거 | Array&lt;String&gt; | X | `["pattern:rrn"]` |

`PixelBox`:

```json
{
  "x1": 648,
  "y1": 282,
  "x2": 774,
  "y2": 300
}
```

한 개인정보가 여러 OCR token에 걸치면 `boxes`에 좌표가 여러 개 들어갈 수 있다.

### 3.4 픽셀 좌표와 화면 `%` 좌표

백엔드의 기준 좌표는 원본 페이지 이미지의 픽셀이다. OCR JSON의 `imageInfo.width`, `imageInfo.height`가 변환 기준이다.

백엔드 픽셀 좌표를 화면에 표시할 때 프론트가 다음과 같이 `%`로 변환한다.

```text
left   = x1 / image_width * 100
top    = y1 / image_height * 100
width  = (x2 - x1) / image_width * 100
height = (y2 - y1) / image_height * 100
```

수동 편집 결과를 서버에 저장할 때는 반대로 픽셀 좌표로 되돌린다.

```text
x1 = round(left / 100 * image_width)
y1 = round(top / 100 * image_height)
x2 = round((left + width) / 100 * image_width)
y2 = round((top + height) / 100 * image_height)
```

이렇게 하면 화면 크기가 달라져도 편집기는 `%`로 안정적으로 표시할 수 있고, 백엔드 저장·마스킹·결과 다운로드는 모두 동일한 픽셀 좌표를 유지한다.

### 3.5 화면용 문서 결과와 엔진 원본 파일

두 데이터는 역할이 다르다.

- `GET /poc/documents/{document_id}`: 여러 엔진 출력 파일을 모아 뷰어가 사용하기 쉽게 만든 화면용 JSON
- `ocr.json`, `ocr.txt`, `pii.json`: 백엔드가 생성한 파일을 내용 변경 없이 다운로드

화면용 JSON에서 개인정보 원문을 숨기더라도 `pii.json` 다운로드 형식을 임의로 `%` 좌표나 짧은 유형 키로 바꾸지 않는다.

### 3.6 오류 응답

공통 오류 body는 최소한 다음 구조를 사용한다.

```json
{
  "message": "존재하지 않는 문서입니다."
}
```

## 4. 문서 업로드 및 처리

### `POST /poc/documents`

문서와 전체 policy를 전송한다. 프론트에는 숫자 진행률 화면이 없으므로 완료될 때까지 스피너만 표시하고, 서버는 처리가 끝난 뒤 5장의 `DocumentResult`를 반환한다.

### Request

`Content-Type: multipart/form-data`

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `file` | 처리할 문서 | Binary File | PDF, JPG, JPEG, PNG | X | `01_10.pdf` |
| `policy` | 적용할 `poc_policy.json` 전체 내용 | JSON String | 직렬화된 JSON | X | `{"schema_version":1,...}` |

**Path parameter**

없음

**Query parameter**

없음

### Response

5장의 `DocumentResult`를 반환한다.

### Status

| status | response content |
| --- | --- |
| 200 | 처리 완료 및 전체 결과 반환 |
| 400 | 요청 또는 policy 형식 오류 |
| 415 | 지원하지 않는 파일 형식 |
| 500 | OCR·PII·이미지 처리 중 오류 |

## 5. 문서 처리 결과 조회

### `GET /poc/documents/{document_id}`

저장된 OCR·PII·마스킹 산출물을 조합해 뷰어에 필요한 결과를 반환한다.

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |

**Query parameter**

없음

### Response: `DocumentResult`

| key | 설명 | value 타입 | Nullable | 프론트 사용 위치 |
| --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String | X | 화면 이동·재조회 |
| `file_name` | 원본 파일명 | String | X | 제목 |
| `file_type` | 파일 확장자 | String | X | 파일 정보 |
| `file_size_bytes` | 파일 크기 | Integer | X | 파일 정보 |
| `page_count` | 전체 페이지 수 | Integer | X | 페이지 이동 |
| `ocr_status` | 문서 OCR 실행 상태 | String | X | OCR 상태 |
| `pii_engine_status` | PII 엔진 실행 상태 | String | X | 엔진 상태 |
| `image_status` | 마스킹 이미지 생성 상태 | String | X | 결과 상태 |
| `error_reason` | 기술적 오류 설명 | String | O | 오류 표시 |
| `applied_policy` | 실제 적용한 전체 policy | Object | X | 옵션 표시·재탐지 |
| `pii_counts` | 유형별 탐지 건수 | Object | X | 검출 요약 |
| `pages` | 페이지별 결과 | Array&lt;PageResult&gt; | X | 뷰어 |

`PageResult`:

| key | 설명 | value 타입 | Nullable | 프론트 사용 위치 |
| --- | --- | --- | --- | --- |
| `page` | 페이지 번호 | Integer | X | 페이지 이동 |
| `width` | 원본 페이지 너비 | Integer | X | 좌표 변환 |
| `height` | 원본 페이지 높이 | Integer | X | 좌표 변환 |
| `ocr_status` | 페이지 OCR 상태 | String | X | OCR 상태 |
| `ocr_time_sec` | OCR 처리시간(초) | Number | O | OCR 처리 결과 |
| `pii_engine_status` | 개인정보 엔진 상태 | String | X | 엔진 상태 |
| `image_status` | 마스킹 이미지 상태 | String | X | 결과 상태 |
| `pii_counts` | 페이지 유형별 탐지 건수 | Object | X | 검출 요약 |
| `detections` | 실제 PII 탐지 결과 | Array&lt;PiiDetection&gt; | X | 내역·자동 영역 구성 |
| `masks` | 현재 이미지에 적용할 최종 픽셀 마스크 | Array&lt;MaskRegion&gt; | X | 자동·수동 편집 |
| `original_image_url` | 원본 이미지 조회 주소 | String | X | 원본 보기 |
| `masked_image_url` | 마스킹 이미지 조회 주소 | String | X | 결과 보기 |
| `error_stage` | 실패 단계 | String | O | 오류 표시 |
| `error_reason` | 실패 사유 | String | O | 오류 표시 |

`MaskRegion`은 마스킹 이미지와 수동 편집을 위한 구조다. 엔진 탐지 원본인 `PiiDetection`과 구분한다.

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `mask_id` | 마스킹 영역 식별자 | String |  | X | `auto-1` |
| `category` | 개인정보 유형 | String | 3.1 키 또는 `manual` | X | `resident_registration_number` |
| `source` | 생성 출처 | String | `automatic`, `manual` | X | `automatic` |
| `bbox` | 원본 이미지 픽셀 좌표 | PixelBox |  | X | `{...}` |

### Example

```json
{
  "document_id": "doc_20260812_a82f71",
  "file_name": "01_10.pdf",
  "file_type": "PDF",
  "file_size_bytes": 2307072,
  "page_count": 1,
  "ocr_status": "success",
  "pii_engine_status": "completed",
  "image_status": "completed",
  "applied_policy": {
    "schema_version": 1,
    "detection": {
      "selected_categories": [
        "resident_registration_number",
        "foreigner_registration_number",
        "passport_number",
        "driver_license_number"
      ],
      "checksum_validation_enabled": false
    }
  },
  "pii_counts": {
    "resident_registration_number": 1,
    "foreigner_registration_number": 0,
    "passport_number": 0,
    "driver_license_number": 0,
    "phone_number": 0,
    "email_address": 0
  },
  "pages": [
    {
      "page": 1,
      "width": 1200,
      "height": 1700,
      "ocr_status": "success",
      "ocr_time_sec": 1.44,
      "pii_engine_status": "completed",
      "image_status": "completed",
      "pii_counts": {
        "resident_registration_number": 1
      },
      "detections": [
        {
          "category": "resident_registration_number",
          "text": "******-*******",
          "normalized_text": "******-*******",
          "line_ids": [9],
          "raw_span": [340, 354],
          "token_ids": [41],
          "boxes": [{"x1": 648, "y1": 282, "x2": 774, "y2": 300}],
          "ocr_confidence": 1.0,
          "detector_confidence": 1.0,
          "rule_id": "ko_pii:RRN",
          "review_required": false,
          "risk_level": 5,
          "evidence": ["pattern:rrn", "checksum:valid"]
        }
      ],
      "masks": [
        {
          "mask_id": "auto-1",
          "category": "resident_registration_number",
          "source": "automatic",
          "bbox": {"x1": 643, "y1": 279, "x2": 779, "y2": 303}
        }
      ],
      "original_image_url": "/poc/documents/doc_20260812_a82f71/pages/1/original-image",
      "masked_image_url": "/poc/documents/doc_20260812_a82f71/pages/1/masked-image"
    }
  ]
}
```

### Status

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 404 | 존재하지 않는 문서 |
| 500 | 결과 구성 중 오류 |

## 6. 탐지 옵션 변경 및 재탐지

### `PUT /poc/documents/{document_id}/detection-options`

변경된 `poc_policy.json` 전체를 전달한다. 서버는 저장된 OCR JSON과 원본 이미지를 재사용해 개인정보 탐지와 마스킹만 다시 실행한다.

### Request

`Content-Type: application/json`

Request body는 `poc_policy.json` 전체 JSON이다.

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 재탐지할 문서 | String |  | X | `doc_20260812_a82f71` |

**Query parameter**

없음

### Response

갱신된 5장의 `DocumentResult` 전체를 반환한다.

### Status

| status | response content |
| --- | --- |
| 200 | 재탐지 및 마스킹 완료 |
| 400 | policy 형식 또는 설정값 오류 |
| 404 | 문서 또는 저장된 OCR 결과 없음 |
| 500 | 재탐지·마스킹 오류 |

## 7. OCR JSON 다운로드

### `GET /poc/documents/{document_id}/ocr.json`

백엔드가 생성한 `ocr_result.json`을 내용 변경 없이 반환한다.

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |

**Query parameter**

없음

### Response

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| Response body | OCR 원본 결과 파일 | Binary | `application/json` | X | `01_10_ocr.json` |

OCR 파일에는 `page`, `text`, `lines`, `imageInfo`, `processTime` 등 현재 엔진이 생성한 필드가 그대로 포함된다.

### Status

| status | response content |
| --- | --- |
| 200 | OCR JSON 반환 |
| 404 | 결과 파일 없음 |
| 500 | 파일 반환 오류 |

## 8. 현재 페이지 TXT 다운로드

### `GET /poc/documents/{document_id}/pages/{page}/ocr.txt`

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |
| `page` | 페이지 번호 | Integer | 1부터 시작 | X | `1` |

**Query parameter**

없음

### Response

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| Response body | 페이지 OCR 텍스트 | Binary | `text/plain; charset=utf-8` | X | `01_10_page_1_ocr.txt` |

### Status

| status | response content |
| --- | --- |
| 200 | OCR TXT 반환 |
| 404 | 문서·페이지 또는 텍스트 없음 |
| 500 | 파일 반환 오류 |

## 9. 개인정보 내역 다운로드

### `GET /poc/documents/{document_id}/pii.json`

백엔드가 생성한 `pii_result.json`을 내용 변경 없이 반환한다. 프론트가 화면에 표시하기 위해 만든 `%` 사각형으로 다시 만들지 않는다.

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |

**Query parameter**

없음

### Response

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| Response body | 페이지별 PII 탐지 배열 | Binary | `application/json` | X | `01_10_pii.json` |

파일 내부의 각 탐지 건은 3.3의 `PiiDetection` 구조를 사용한다. `boxes`는 픽셀 좌표다.

### Example

```json
[
  [
    {
      "category": "resident_registration_number",
      "text": "******-*******",
      "normalized_text": "******-*******",
      "line_ids": [9],
      "raw_span": [340, 354],
      "token_ids": [41],
      "boxes": [
        {"x1": 648, "y1": 282, "x2": 774, "y2": 300}
      ],
      "ocr_confidence": 1.0,
      "detector_confidence": 1.0,
      "rule_id": "ko_pii:RRN",
      "review_required": false,
      "risk_level": 5,
      "evidence": ["pattern:rrn", "checksum:valid"]
    }
  ]
]
```

### Status

| status | response content |
| --- | --- |
| 200 | PII 결과 JSON 반환 |
| 404 | 결과 파일 없음 |
| 500 | 파일 반환 오류 |

## 10. 원본 페이지 이미지

### `GET /poc/documents/{document_id}/pages/{page}/original-image`

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |
| `page` | 페이지 번호 | Integer | 1부터 시작 | X | `1` |

**Query parameter**

없음

### Response

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| Response body | 원본 페이지 이미지 | Binary | `image/png` 또는 `image/jpeg` | X | `01_10_page_1_original.jpg` |

### Status

| status | response content |
| --- | --- |
| 200 | 원본 이미지 반환 |
| 404 | 문서·페이지 또는 이미지 없음 |
| 500 | 이미지 반환 오류 |

## 11. 마스킹 페이지 이미지

### `GET /poc/documents/{document_id}/pages/{page}/masked-image`

### Request

Request body 없음

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |
| `page` | 페이지 번호 | Integer | 1부터 시작 | X | `1` |

**Query parameter**

없음

### Response

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| Response body | 최종 마스킹 이미지 | Binary | `image/jpeg` 또는 `image/png` | X | `01_10_page_1_masked.jpg` |

### Status

| status | response content |
| --- | --- |
| 200 | 마스킹 이미지 반환 |
| 404 | 문서·페이지 또는 이미지 없음 |
| 500 | 이미지 반환 오류 |

## 12. 수동 마스킹 결과 저장

### `PUT /poc/documents/{document_id}/pages/{page}/masks`

현재 편집기는 자동 영역과 수동 영역을 모두 이동·크기 변경·삭제할 수 있다. 따라서 저장 시에는 화면에 최종적으로 남은 전체 영역을 전송하고, 서버가 해당 페이지의 최종 마스크 목록을 교체한 뒤 이미지를 다시 생성한다.

프론트는 `%`로 편집하지만 요청 직전에 3.4 공식으로 픽셀 좌표로 변환한다.

### Request

`Content-Type: application/json`

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `masks` | 편집 후 최종 마스크 목록 | Array&lt;MaskRegion&gt; | 픽셀 좌표 | X | `[...]` |

**Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `document_id` | 문서 식별자 | String |  | X | `doc_20260812_a82f71` |
| `page` | 페이지 번호 | Integer | 1부터 시작 | X | `1` |

**Query parameter**

없음

### Example

```json
{
  "masks": [
    {
      "mask_id": "auto-1",
      "category": "resident_registration_number",
      "source": "automatic",
      "bbox": {"x1": 643, "y1": 279, "x2": 779, "y2": 303}
    },
    {
      "mask_id": "manual-1",
      "category": "manual",
      "source": "manual",
      "bbox": {"x1": 120, "y1": 500, "x2": 360, "y2": 540}
    }
  ]
}
```

### Response

저장 후 갱신된 페이지 결과를 반환한다.

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| `page` | 페이지 번호 | Integer |  | X | `1` |
| `masks` | 저장된 최종 마스크 | Array&lt;MaskRegion&gt; | 픽셀 좌표 | X | `[...]` |
| `masked_image_url` | 갱신된 이미지 주소 | String |  | X | `/poc/documents/.../masked-image` |

### Status

| status | response content |
| --- | --- |
| 200 | 마스크 저장 및 이미지 재생성 완료 |
| 400 | 좌표 또는 요청 형식 오류 |
| 404 | 문서·페이지 또는 원본 이미지 없음 |
| 500 | 저장 또는 이미지 생성 오류 |

## 13. 실제 연동 구현에서 필요한 변환

### 13.1 백엔드 `/poc` 계층

현재 `kb_stock/main.py`의 `/fullOCR`은 `srcDir`, `outputDir` 같은 서버 경로를 받는 배치용 API다. 웹 브라우저가 직접 사용할 수 없으므로 `/poc` 계층에서 다음 작업이 필요하다.

1. 업로드 파일을 문서별 작업 폴더에 저장한다.
2. 기존 OCR·PII processor를 호출한다.
3. `ocr_result.json`, `ocr_result.txt`, `pii_result.json`, 원본·마스킹 이미지를 문서 ID로 관리한다.
4. 이 파일들을 조합해 5장의 `DocumentResult`를 만든다.
5. 다운로드 요청에는 가공하지 않은 생성 파일을 반환한다.

### 13.2 프론트 `js/api.js`

1. `recognizeDocument()`를 `POST /poc/documents` 호출로 교체한다.
2. 응답의 긴 개인정보 키를 화면 라벨과 연결한다.
3. snake_case API 응답을 현재 화면 객체로 변환한다.
4. `detections`와 `masks`의 픽셀 좌표를 `%`로 변환해 `main.js`의 문서 편집 화면에 전달한다.
5. 수동 저장 전 `%` 좌표를 픽셀로 되돌린다.
6. 현재 다운로드 버튼은 실제 `/uploadOCR` 응답으로 OCR JSON·현재 페이지 TXT·개인정보 JSON을 브라우저에서 구성한다. 마스킹 결과는 1페이지 문서는 PNG로, 2페이지 이상 문서는 모든 페이지를 이미지로 평탄화한 단일 PDF로 만든다. 자동·수동 마스킹은 모두 최종 픽셀에 반영하고 원본 PDF의 텍스트 레이어는 복사하지 않는다.
7. 전화번호·이메일·체크섬 토글 변경 시 전체 policy를 재구성해 재탐지 API를 호출한다.

## 14. 결정 사항과 구현 전 확인 사항

### 확정한 사항

- API 개인정보 유형은 실제 백엔드의 긴 키를 사용한다.
- 백엔드와 다운로드 파일의 좌표는 픽셀이다.
- `%` 좌표는 프론트 표시·편집 중에만 사용한다.
- OCR·PII 다운로드는 백엔드 생성 파일을 그대로 반환한다.
- 최근 처리 문서 목록은 현재 프론트에서만 관리한다.
- 숫자 진행률 API는 만들지 않는다.

### 현재 `kb_stock`에서 먼저 보완할 부분

실제 `KB_FULL_OCR_TORCH.py`를 기준으로 확인한 내용이다.

1. `ocr_result.json`, `ocr_result.txt`, `pii_result.json`, `mask_result.jpg` 경로가 페이지마다 동일하다. 다중 페이지 문서는 반복 처리 중 앞 페이지 결과가 덮어써지고 마지막 페이지 파일만 남을 수 있다.
2. 정상 처리한 `ocr_result`를 `output_result`에 추가하는 코드가 없고 예외가 발생한 경우에만 추가한다. 따라서 `/fullOCR` 응답의 `ocrResults`가 정상 페이지를 포함하지 않을 수 있다.
3. `final_spans = [...],` 끝의 쉼표 때문에 list가 아니라 tuple이 만들어지고, JSON에는 배열이 한 단계 더 중첩되어 저장된다.
4. 현재 `/fullOCR`은 브라우저가 업로드한 파일이 아니라 서버의 `srcDir`, `outputDir` 경로를 받는다. `/poc/documents`에서 업로드 저장과 기존 processor 호출을 연결해야 한다.
5. `ocr_result.txt`는 현재 페이지별 처리 중 동일 파일에 덮어쓴다. API의 페이지별 TXT 다운로드를 지원하려면 페이지별 파일을 두거나 문서 결과에서 페이지 텍스트를 분리해 반환해야 한다.

### 구현 전에 결정할 사항

- 다중 페이지 산출물을 문서 단위 JSON 하나로 묶을지, 페이지별 파일로 저장할지
- 결과 보관 폴더와 `document_id` 생성 규칙
- 자동 탐지 원본 `pii_result.json`과 사용자가 편집한 최종 마스크 목록을 별도 파일로 보관할지
- PDF 각 페이지의 원본·마스킹 이미지를 어떤 파일명과 형식으로 저장할지
