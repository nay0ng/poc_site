/**
 * 화면에서 사용하는 개인정보 유형 정의.
 *
 * 설정, API 응답, 검출 건수와 마스킹 영역이 같은 category 키를 사용한다.
 * 이 파일에는 예시 문서나 가짜 검출 결과가 없다.
 */
const PII_TYPE_META = {
  resident_registration_number:  { label: "주민등록번호", group: "core" },
  foreigner_registration_number: { label: "외국인등록번호", group: "core" },
  passport_number:                { label: "여권번호", group: "core" },
  driver_license_number:          { label: "운전면허번호", group: "core" },
  phone_number:                   { label: "전화번호", group: "extra" },
  email_address:                  { label: "이메일", group: "extra" },
};

const CORE_PII_TYPES = Object.keys(PII_TYPE_META).filter(function (key) {
  return PII_TYPE_META[key].group === "core";
});

const EXTRA_PII_TYPES = Object.keys(PII_TYPE_META).filter(function (key) {
  return PII_TYPE_META[key].group === "extra";
});

function emptyPiiCounts() {
  return {
    resident_registration_number: 0,
    foreigner_registration_number: 0,
    passport_number: 0,
    driver_license_number: 0,
    phone_number: 0,
    email_address: 0,
  };
}
