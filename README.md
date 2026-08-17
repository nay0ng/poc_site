# KB증권 OCR·개인정보 마스킹 PoC 프론트엔드

문서 한 건을 선택하면 OCR·개인정보 탐지·마스킹 API를 실행하고 결과를 한 화면에서 확인하는 순수 HTML/CSS/JavaScript 프론트엔드다.

현재 화면은 목업 탐지 결과를 사용하지 않는다. 선택한 파일과 화면 설정으로 policy를 만들고 실제 `POST /uploadOCR` API를 호출한다.

## 주요 기능

- PDF·JPG·JPEG·PNG·TIFF 문서 한 건 선택 및 즉시 처리
- 고유식별정보 4종 탐지
  - 주민등록번호
  - 외국인등록번호
  - 여권번호
  - 운전면허번호
- 전화번호·이메일 선택 탐지
- 체크섬 검증 선택
- 여러 페이지 문서 이동
- OCR 상태·처리시간 표시
- 개인정보 유형별 검출 건수 표시
- 서버 마스킹 이미지 표시
- 수동 마스킹 영역 추가·이동·크기 변경·삭제
- OCR JSON·페이지 TXT·개인정보 검출 JSON·최종 마스킹 결과 다운로드
- API와 응답 변환 단계의 프론트 진단 로그 기록

## 실행 방법

빌드 과정은 없다. 정적 파일 서버로 프로젝트 루트를 실행한다.

```bash
python -m http.server 5500
```

브라우저에서 다음 주소로 접속한다.

```text
http://localhost:5500
```

VS Code Live Server를 사용해도 된다. 프론트 주소와 API 주소의 origin이 다르면 백엔드 또는 Nginx에서 CORS를 허용해야 한다.

## 실제 처리 흐름

```text
파일 선택
→ 브라우저에서 미리보기 준비
→ 화면 옵션으로 policy 생성
→ POST /uploadOCR 요청
→ ocrResults·spans·maskingImages 수신
→ 페이지별 화면 객체로 변환
→ OCR 결과·개인정보 건수·마스킹 이미지 표시
→ 최근 문서와 수동 편집 결과를 localStorage에 저장
```

API 주소는 `window.KB_POC_OCR_API_URL`로 주입할 수 있다. 값을 지정하지 않으면
로컬 OCR 서버(`http://127.0.0.1:19816/uploadOCR`)를 사용한다. 배포 환경에서는
`js/api.js`를 불러오기 전에 다음처럼 환경에 맞는 주소를 설정한다.

```javascript
window.KB_POC_OCR_API_URL = "https://example.invalid/kb_poc/api/uploadOCR";
```

전송하는 multipart/form-data 항목은 다음 두 개다.

| 항목 | 내용 |
|---|---|
| `srcFile` | 사용자가 선택한 원본 파일 |
| `policy` | 화면 옵션으로 생성한 policy JSON 문자열 |

정상 응답은 다음 최상위 항목을 사용한다.

| 항목 | 화면 사용처 |
|---|---|
| `resultCode`, `message` | 전체 API 성공·실패 판정 |
| `ocrResults` | 페이지 OCR 텍스트·이미지 크기·처리시간 |
| `fullText` | OCR JSON 다운로드 |
| `spans` | 개인정보 유형별 건수와 자동 마스킹 영역 |
| `maskingImages` | 페이지별 마스킹 결과 이미지 |

## 화면 상태 판정

페이지 상태는 응답 데이터의 실제 존재 여부로 판정한다.

```text
OCR 상태          ocrResult 객체가 있으면 성공
개인정보 엔진 상태 해당 페이지 spans 배열이 있으면 실행완료
결과 이미지 상태  해당 페이지 maskingImages 값이 있으면 생성완료
```

`spans`가 빈 배열인 것은 오류가 아니라 개인정보 검출 결과가 0건이라는 뜻이다. 배열 자체가 없을 때만 개인정보 엔진 실행오류로 표시한다.

마스킹 이미지가 없으면 `생성실패`로 표시하며 가짜 문서 이미지를 만들어 대신 보여주거나 다운로드하지 않는다.

## 개인정보 유형 정의

`js/pii-types.js`에는 화면에서 사용하는 개인정보 유형과 한글 라벨만 정의한다. 예시 문서나 가짜 검출 결과는 포함하지 않는다.

```text
resident_registration_number   주민등록번호
foreigner_registration_number  외국인등록번호
passport_number                여권번호
driver_license_number          운전면허번호
phone_number                   전화번호
email_address                  이메일
```

백엔드 category를 위의 화면 키로 변환하는 코드는 `js/api.js`의 `convertResponseToDocument()`에 있다.

## 다운로드

백엔드에 별도 다운로드 API가 없기 때문에 현재 다운로드 파일은 받은 API 응답과 화면 편집 결과로 브라우저에서 생성한다.

- OCR JSON: 전체 페이지의 실제 `ocrResult`와 `fullText`
- 현재 페이지 TXT: 현재 페이지의 `ocrResult.text`
- 개인정보 JSON: 페이지별 실제 `spans`
- 1페이지 문서: 자동·수동 마스킹을 반영한 PNG
- 2페이지 이상 문서: 전체 페이지를 묶은 이미지 기반 PDF

다중 페이지 PDF는 원본 PDF 객체를 복사하지 않고 각 페이지의 최종 마스킹
이미지만 새 PDF에 넣는다. 따라서 원본 텍스트·폼·주석·첨부파일은 결과에
포함되지 않으며 텍스트 검색이나 추출로 마스킹 전 내용을 확인할 수 없다.

실제 이미지가 없거나 이미지 로딩에 실패하면 결과 다운로드 전체를 중단하고
오류를 표시한다.

## 프론트 진단 로그

화면에는 별도 로그 버튼을 두지 않는다. 로그는 개발자 도구 Console과 localStorage에 최대 300건 저장한다.

```javascript
JSON.parse(localStorage.getItem("kb_poc_diagnostic_logs"))
```

기록 항목은 다음과 같다.

- 요청 시작·완료·네트워크 오류
- HTTP 상태와 API `resultCode`, `message`
- 파일명·형식·크기와 적용 옵션
- 페이지별 OCR·PII·마스킹 처리시간
- 페이지별 span 수와 마스킹 이미지 존재 여부
- OCR·span·마스킹 이미지 배열 누락 및 페이지 수 불일치
- 지원하지 않는 개인정보 category와 bbox 누락
- JavaScript 오류와 옵션 변경 재처리 결과

OCR 전문, 개인정보 문자열과 이미지 Base64는 진단 로그에 저장하지 않는다.

`frontend_request_id`는 한 번의 프론트 요청에 속한 로그를 묶는 용도다. 현재 백엔드로 전달하지 않으므로 `kb_stock/ocr_logs`의 요청 ID와 자동 연결되지는 않는다.

## 브라우저 저장 범위

다음 항목은 서버가 아니라 브라우저 localStorage에 저장한다.

- 최근 처리 문서 최대 10건
- 다음 요청에 사용할 화면 옵션
- 문서·페이지별 수동 마스킹 영역
- 프론트 진단 로그

원본 `File` 객체는 브라우저 메모리에만 남는다. 화면을 새로고침한 뒤 과거 문서의 옵션을 변경해 재처리하려면 원본 파일을 다시 선택해야 한다.

수동 마스킹 결과도 현재는 백엔드에 영구 저장하지 않는다. PoC 이후 서버 저장이 필요하면 별도의 문서 ID와 수동 마스킹 저장 API가 필요하다.

## 폴더 구조

```text
index.html            단일 PoC 화면

css/
  style.css           화면 스타일

js/
  pii-types.js        개인정보 화면 유형·라벨·빈 건수 생성
  storage.js          localStorage 저장
  api.js              /uploadOCR 호출, policy 생성, 응답 변환, 진단 로그
  common.js           상태 배지·포맷·공통 유틸
  image-pdf.js        마스킹 페이지를 이미지 기반 PDF로 묶는 기능
  main.js             옵션·업로드·뷰어·다운로드·수동 마스킹
  vendor/             PDF·TIFF 미리보기 라이브러리
```

## PoC 점검 항목

최종 시연 전 다음 항목을 실제 API 환경에서 확인한다.

- JPG·PNG 한 페이지 처리
- 여러 페이지 PDF 처리와 페이지 이동
- 개인정보 4종의 유형별 건수와 bbox 위치
- 전화번호·이메일 옵션 변경 후 재처리
- 체크섬 옵션 변경 후 재처리
- OCR JSON·TXT·개인정보 JSON 다운로드
- 단일 페이지 마스킹 PNG 다운로드
- 다중 페이지 이미지 기반 마스킹 PDF 다운로드
- 수동 영역 추가·이동·크기 변경·삭제·실행 취소
- API 오류와 마스킹 이미지 누락 시 오류 상태 표시
