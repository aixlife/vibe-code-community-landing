/**
 * PRD: 대표 AI 코칭 사전 신청 자동화 시스템
 * 작성자: AI (Antigravity)
 * 
 * [목적]
 * Google Form (10개 문항) 제출 시 -> Google Sheets 트리거 (onFormSubmit) 작동
 * -> Gemini 2.5 Flash API 호출 -> 판별 결과 JSON 수신 -> 시트에 결과 기록
 * -> 관리자 UI(상단 메뉴)에서 메일 및 문자 수동 발송
 */

// ==========================================
// 설정 환경 변수 (스크립트 속성 메뉴에서 등록 필수)
// ==========================================
const SENDER_EMAIL = "naminsoo@aixlife.co.kr"; // 발신 이메일

/**
 * 1. 메뉴 추가 : 시트 열릴 때 [📩 발송 메뉴] 추가
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('✉️ 로직 & 발송 메뉴')
    .addItem('선택 행 이메일 발송', 'sendEmailForSelectedRow')
    .addItem('선택 행 문자 발송(A유형)', 'sendSmsForSelectedRow')
    .addToUi();
}

/**
 * 2. 트리거 함수 : 폼 제출 시 자동 실행 
 * - 편집 메뉴 > 현재 프로젝트의 트리거 > 함수(onFormSubmitHnalder), 이벤트 소스(시트에서), 이벤트 유형(양식 제출 시) 로 등록해야 합니다.
 */
function onFormSubmitHandler(e) {
  const sheet = SpreadsheetApp.getActiveSheet();
  // e.range 는 접수된 새로운 행.
  const row = e.range.getRow();
  
  // 컬럼 매핑 가정 (PRD의 10개 문항 순서대로라 가정)
  // 1: 타임스탬프
  // 2: 1번 - 성함
  // 3: 2번 - 연락처
  // 4: 3번 - 이메일
  // 5: 4번 - 회사명
  // 6: 5번 - 지금 이걸 어떻게(장문)
  // 7: 6번 - 얼마나 걸리나요?
  // 8: 7번 - 결과물 형태?
  // 9: 8번 - 사용범위(본인/직원)
  // 10: 9번 - 유료구독(유/무)
  // 11: 10번 - 노트북기종
  
  const values = sheet.getRange(row, 2, 1, 10).getValues()[0];
  const name = values[0];
  const q5 = values[4];
  const q6 = values[5];
  const q7 = values[6];
  const q8 = values[7];
  const q9 = values[8]; 
  
  // Gemini 판단 로직
  const aiResultJSON = callGeminiAPI(name, q5, q6, q7, q8, q9);
  
  if(aiResultJSON) {
    try {
      const data = JSON.parse(aiResultJSON);
      
      // 시트에 기록 (12:과업요약, 13:유형, 14:판단이유, 15:이메일제목, 16:이메일본문, 17:문자초안)
      sheet.getRange(row, 12).setValue(data["과업요약"] || "");
      sheet.getRange(row, 13).setValue(data["유형"] || "");
      sheet.getRange(row, 14).setValue(data["판단이유"] || "");
      sheet.getRange(row, 15).setValue(data["이메일제목"] || "");
      sheet.getRange(row, 16).setValue(data["이메일본문"] || "");
      sheet.getRange(row, 17).setValue(data["문자초안"] || "");
    } catch(err) {
      Logger.log("JSON 파싱 에러:" + err.message);
      sheet.getRange(row, 18).setValue("JSON 파싱 에러 발생");
    }
  } else {
    sheet.getRange(row, 18).setValue("Gemini API 호출 실패");
  }
}

/**
 * 3. Gemini 2.5 Flash 호출 함수
 */
function callGeminiAPI(name, q5, q6, q7, q8, q9) {
  const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if(!GEMINI_API_KEY) return null;
  
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const systemPrompt = `
너는 나민수 대표의 AI 코칭 프로그램 신청서를 검토하는 어시스턴트야.
아래 신청서 답변을 보고 유형을 판단하고, 해당 유형의 응답 이메일 초안을 작성해줘.
발신자는 나민수 대표이고, 수신자는 신청자 대표님이야.
말투는 정중하지만 솔직하고 친근하게 써줘.

판단 기준:
- A (참가 확정): 5번이 구체적(동사+순서 포함), 7번 출력 형태 명확, 9번 구독 있음
- B (보완 요청): 방향은 있지만 디테일 부족. 보완 가능한 수준 (질문 1~2개 추가)
- C1 (다음 기수 - 막연): 구체적인 업무 흐름 없음 ("자동화하고 싶어요" 수준)
- C2 (다음 기수 - 구독 없음): 유료 구독 없음
- C3 (다음 기수 - 범위 큼): 2주 완성 불가능한 엄청난 크기 (전사 시스템 연동 등)

이메일 작성 시 반드시 다음 템플릿의 분위기와 메시지를 지켜서 작성:
- A: 참가 확정 안내. 사전 준비 가이드 발송 예정 안내 포함.
- B: 한 가지 더 보완 질문하기 (맞춤 보완 질문 1~2개 포함)
- C1: 2주 안에 무엇을 만들지 파악 힘듦. "매일 반복하는 일 순서대로 적어보세요" 안내.
- C2: 유료 구독 반드시 필요함 안내. 구독 후 재신청 권유.
- C3: 2주 안에 불가능. 범위를 하나로 좁혀달라는 맞춤 제안.

결과는 반드시 마크다운 마크업(\`\`\`json ...) 없이 순수 JSON 객체 포맷만 반환할 것.

출력 형식 (JSON):
{
  "유형": "A/B/C1/C2/C3 중 하나",
  "판단이유": "판단 사유 한 줄",
  "과업요약": "신청자 과업을 한 줄로",
  "이메일제목": "[AI 코칭 1기] ...",
  "이메일본문": "본문 전체 내용 (줄바꿈 \\n 포함)",
  "문자초안": "A 유형만, 80자 이내. 나머지는 빈 문자열"
}
`;

  const userPrompt = `
신청자 이름: ${name}
5번 (업무 과정): ${q5}
6번 (빈도와 시간): ${q6}
7번 (원하는 결과물): ${q7}
8번 (사용 범위): ${q8}
9번 (구독 여부): ${q9}
`;

  // Gemini V1 Beta payload format
  const payload = {
    "system_instruction": {
      "parts": [{ "text": systemPrompt }]
    },
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": userPrompt }]
      }
    ],
    // JSON 모드 강제 적용
    "generationConfig": {
        "responseMimeType": "application/json"
    }
  };
  
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(endpoint, options);
  
  if (response.getResponseCode() === 200) {
    const jsonStr = response.getContentText();
    const resultObj = JSON.parse(jsonStr);
    try {
      const g_text = resultObj.candidates[0].content.parts[0].text;
      return g_text; // JSON string returning from Gemini
    } catch(e) {
      Logger.log("텍스트 추출 파싱 에러");
      return null;
    }
  } else {
    Logger.log("API 오류:" + response.getContentText());
    return null;
  }
}

/**
 * 4. 이메일 발송 액션 버튼 (사용자가 행 선택 후 메뉴 클릭)
 */
function sendEmailForSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  
  // 데이터 배열 가정 (이름: 컬럼 2, 이메일: 컬럼 4, 메일제목: 컬럼 15, 메일본문: 컬럼 16. 발송완료체크: 컬럼 19)
  const name = sheet.getRange(row, 2).getValue();
  const emailTo = sheet.getRange(row, 4).getValue();
  const subject = sheet.getRange(row, 15).getValue();
  const body = sheet.getRange(row, 16).getValue();
  
  if(!emailTo || !subject || !body) {
    SpreadsheetApp.getUi().alert("이메일 주소, 제목, 본문이 모두 있는지 확인하세요.");
    return;
  }
  
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('이메일 발송', `${name}님에게 메일을 정말 발송하시겠습니까?`, ui.ButtonSet.YES_NO);
  
  if(response == ui.Button.YES) {
    MailApp.sendEmail({
      to: emailTo,
      subject: subject,
      body: body,
      name: "나민수" // 발신자 표시 이름
      // *발신 이메일 주소는 스크립트를 실행하는 현재 사용자(naminsoo@aixlife.co.kr)로 자동 고정됩니다.
    });
    
    // 이메일 발송 완료 플래그 기록
    sheet.getRange(row, 19).setValue("완료 (메일)");
    ui.alert('발송 처리 완료');
  }
}

/**
 * 5. 문자 발송 액션 버튼 (A유형)
 * - CoolSMS/Aligo 등 연동 예제용입니다. API_KEY와 발신번호를 넣어야 완성됩니다.
 */
function sendSmsForSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  
  const name = sheet.getRange(row, 2).getValue();
  const phone = sheet.getRange(row, 3).getValue();
  const smsBody = sheet.getRange(row, 17).getValue();
  const type_result = sheet.getRange(row, 13).getValue();
  
  if(type_result !== "A") {
    SpreadsheetApp.getUi().alert("A 유형의 참가자가 아닙니다.");
    return;
  }
  
  if(!phone || !smsBody) {
    SpreadsheetApp.getUi().alert("문자 수신번호 및 문자초안 내용이 비어있습니다.");
    return;
  }
  
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('문자 발송', `${name}님(${phone})에게 문자를 발송하시겠습니까?`, ui.ButtonSet.YES_NO);
  
  if(response == ui.Button.YES) {
    // ---- 여기에 CoolSMS API 연동 로직 추가 ----
    // 예) 
    // const SMS_API_KEY = PropertiesService.getScriptProperties().getProperty("SMS_KEY");
    // const options = { ... }; 
    // UrlFetchApp.fetch("https://api.coolsms.co.kr/messages/v4/send", options);
    
    sheet.getRange(row, 20).setValue("완료 (문자)");
    ui.alert('문자 발송 처리 로직 실행');
  }
}
