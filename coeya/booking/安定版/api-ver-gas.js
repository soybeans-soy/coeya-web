// =======================================================
// 設定エリア
// =======================================================
const CALENDAR_ID = 'cc2520ac972443f5539a342d7ad267c1d4c3b1ed56c855b367b8f683ce16ae47@group.calendar.google.com'; // ★カレンダーIDをここに
const TIME_ZONE = 'Asia/Tokyo';
const SLOT_EVENT_TITLE = "予約可能枠"; 
const BUSINESS_START_HOUR = 10;
const BUSINESS_END_HOUR = 21;
const SENDER_EMAIL = 'trextacy@gmail.com'; 
const LOG_SHEET_ID = '16FwDWK5ENfZWia8X9Z5QZS35fD1zRIKFNUgDJR3yJWY'; // ★シートIDがあれば
const LOG_SHEET_NAME = '予約ログ';

// =======================================================
// 1. API エントリーポイント
// =======================================================

// GETリクエスト: 空き状況を返す
function doGet(e) {
  // CORS対策（外部からのアクセス許可のためのヘッダー準備等はGASが自動で行いますが、JSONで返す必要があります）
  const action = e.parameter.action;
  
  if (action === 'getSlots') {
    const result = getAvailableSlots();
    return createJsonResponse(result);
  }
  
  return createJsonResponse({ status: 'error', message: 'Invalid action' });
}

// POSTリクエスト: 予約を作成する
function doPost(e) {
  try {
    // 外部から送られてくるデータ(JSON文字列)をパースする
    // CORS Preflight問題を避けるため、送る際は text/plain として送ってもらい、ここでJSONパースします
    const jsonString = e.postData.contents;
    const bookingData = JSON.parse(jsonString);
    
    const result = createBooking(bookingData);
    return createJsonResponse(result);
    
  } catch (error) {
    return createJsonResponse({ status: 'error', error: error.message });
  }
}

// JSONレスポンスを作成するヘルパー関数
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =======================================================
// 2. 予約情報取得 (ロジックは前回と同じ)
// =======================================================
function getAvailableSlots() {
  try {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0); 
      
      const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      if (!calendar) throw new Error("カレンダーが見つかりません。");

      const allEvents = calendar.getEvents(startOfMonth, endOfNextMonth);
      const flatSlots = []; 
      const bookedEvents = [];
      const slotEvents = [];

      allEvents.forEach(event => {
          if (event.getTitle() === SLOT_EVENT_TITLE) {
              slotEvents.push(event);
          } else {
              bookedEvents.push(event);
          }
      });

      slotEvents.forEach(slotEvent => {
        let currentSlotTime, endTime;

        if (slotEvent.isAllDayEvent()) {
            currentSlotTime = new Date(slotEvent.getStartTime());
            currentSlotTime.setHours(BUSINESS_START_HOUR, 0, 0, 0);
            endTime = new Date(slotEvent.getStartTime());
            endTime.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        } else {
            currentSlotTime = new Date(slotEvent.getStartTime());
            endTime = new Date(slotEvent.getEndTime());
        }
        
        while (currentSlotTime.getTime() < endTime.getTime()) {
            if (currentSlotTime.getTime() < today.getTime()) { 
                currentSlotTime.setMinutes(currentSlotTime.getMinutes() + 30);
                continue;
            }
            
            const checkEnd = new Date(currentSlotTime.getTime() + 30 * 60000); 
            const isReserved = bookedEvents.some(bookedEvent => {
                const bStart = bookedEvent.getStartTime().getTime();
                const bEnd = bookedEvent.getEndTime().getTime();
                const cStart = currentSlotTime.getTime();
                const cEnd = checkEnd.getTime();
                return (cStart < bEnd && cEnd > bStart);
            });
            
            if (!isReserved) {
                flatSlots.push({
                    date: Utilities.formatDate(currentSlotTime, TIME_ZONE, 'yyyy-MM-dd'),
                    startTime: Utilities.formatDate(currentSlotTime, TIME_ZONE, 'HH:mm'),
                    timestamp: currentSlotTime.getTime()
                });
            }
            currentSlotTime.setMinutes(currentSlotTime.getMinutes() + 30);
        }
      });
      
      const uniqueSlots = [];
      const keys = new Set();
      flatSlots.sort((a,b) => a.timestamp - b.timestamp).forEach(item => {
          const key = item.date + '_' + item.startTime;
          if(!keys.has(key)){
              keys.add(key);
              uniqueSlots.push(item);
          }
      });
      return uniqueSlots; 

  } catch (error) {
      return { error: error.message }; // 配列ではなくエラーオブジェクトを返す可能性あり
  }
}

// =======================================================
// 3. 予約作成 (createBooking) - メール送信機能付き
// =======================================================
function createBooking(bookingData) {
  try {
    const { courseName, name, email, notes, date, time, duration } = bookingData;
    
    // 日時オブジェクトの作成
    const startDateTimeStr = `${date}T${time}:00+09:00`; 
    const startDateTime = new Date(startDateTimeStr);
    const endTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
    
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    
    // 1. 二重予約チェック
    const conflicts = calendar.getEvents(startDateTime, endTime);
    const isConflict = conflicts.some(e => e.getTitle() !== SLOT_EVENT_TITLE);
    if (isConflict) {
        return { status: 'error', error: "申し訳ありません。タッチの差で予約が埋まってしまいました。別の日時を選択してください。" };
    }

    // 2. カレンダーイベント作成
    const eventTitle = `${courseName}: ${name}様`;
    const description = `コース: ${courseName}\n氏名: ${name}\nEmail: ${email}\n備考: ${notes}`;
    
    calendar.createEvent(eventTitle, startDateTime, endTime, {
        description: description,
        guests: email + ',' + SENDER_EMAIL, // ゲストに追加することで招待状が送られます
        sendInvites: true
    });

    // -------------------------------------------------------
    // 3. 【重要】メール送信処理
    // -------------------------------------------------------
    const formattedDate = Utilities.formatDate(startDateTime, TIME_ZONE, 'yyyy年MM月dd日 (E) HH:mm');

    // A. 予約者（お客様）への確認メール
    const clientMailBody = `
${name} 様

この度は「声家 (coeya)」のレッスンをご予約いただき、誠にありがとうございます。
以下の内容でご予約を承りました。

【予約内容】
コース：${courseName}
日時：${formattedDate} 〜 (${duration}分)
備考：${notes || '特になし'}

当日のご来店を心よりお待ちしております。
`;

    MailApp.sendEmail({
      to: email,
      subject: `【予約確定】レッスン予約ありがとうございます (${formattedDate})`,
      body: clientMailBody
    });

    // B. 管理者（あなた）への通知メール
    const adminMailBody = `
管理画面からの通知です。
新しい予約が入りました。

【詳細情報】
コース：${courseName}
氏名：${name} 様
メール：${email}
日時：${formattedDate}
備考：${notes}
`;

    MailApp.sendEmail({
      to: SENDER_EMAIL,
      subject: `【新規予約通知】${name}様 - ${courseName}`,
      body: adminMailBody
    });

    // 4. スプレッドシートへのログ記録 (もしIDが設定されていれば)
    try {
       const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
       const sheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.getSheets()[0];
       sheet.appendRow([new Date(), name, email, courseName, date, time, notes]);
    } catch(e) { console.log("ログ記録失敗(無視可): " + e.message); }

    return { status: 'success' };

  } catch (error) {
      console.error("createBooking Error: " + error.message);
      return { status: 'error', error: "システムエラーが発生しました: " + error.message };
  }
}