// =======================================================
// 【設定】カレンダーIDとタイムゾーン
// =======================================================
const CALENDAR_ID = 'cc2520ac972443f5539a342d7ad267c1d4c3b1ed56c855b367b8f683ce16ae47@group.calendar.google.com'; 
const TIME_ZONE = 'Asia/Tokyo';
const SENDER_EMAIL = 'trextacy@gmail.com'; // 通知の送信元（管理者）

// 予約可能枠のイベントタイトル
const SLOT_EVENT_TITLE = "予約可能枠"; 

// ★追加★ 「終日」で枠を作った場合に適用する営業時間（時）
const BUSINESS_START_HOUR = 10; // 朝10時から
const BUSINESS_END_HOUR = 21;   // 夜21時まで

const LOG_SHEET_ID = '16FwDWK5ENfZWia8X9Z5QZS35fD1zRIKFNUgDJR3yJWY'; 
const LOG_SHEET_NAME = '予約ログ';

// =======================================================
// 1. エントリーポイント
// =======================================================
function doGet() {
  return HtmlService.createTemplateFromFile('booking_system').evaluate()
    .setTitle('レッスン予約 | 声家 (coeya)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =======================================================
// 2. 予約情報取得 (getAvailableSlots)
// =======================================================
function getAvailableSlots() {
  try {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0); 
      
      const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      if (!calendar) throw new Error("カレンダーが見つかりません。");

      const allEvents = calendar.getEvents(startOfMonth, endOfNextMonth);
      const flatSlots = []; // 新しいHTMLに合わせて配列で返します
      const bookedEvents = [];
      const slotEvents = [];

      // 1. イベントの振り分け
      allEvents.forEach(event => {
          if (event.getTitle() === SLOT_EVENT_TITLE) {
              slotEvents.push(event);
          } else {
              bookedEvents.push(event);
          }
      });

      // 2. 空き枠の計算
      slotEvents.forEach(slotEvent => {
        let currentSlotTime, endTime;

        // ★修正ポイント: 終日イベントへの対応
        if (slotEvent.isAllDayEvent()) {
            // 終日の場合、その日の「開始設定時間」から「終了設定時間」までを枠とする
            currentSlotTime = new Date(slotEvent.getStartTime());
            currentSlotTime.setHours(BUSINESS_START_HOUR, 0, 0, 0);
            
            endTime = new Date(slotEvent.getStartTime());
            endTime.setHours(BUSINESS_END_HOUR, 0, 0, 0);
        } else {
            // 時間指定イベントの場合、その通りに設定
            currentSlotTime = new Date(slotEvent.getStartTime());
            endTime = new Date(slotEvent.getEndTime());
        }
        
        // 30分単位でスキャンして、60分の空きがあるかチェック（コース時間の最大公約数的な処理）
        // 簡易化のため、ここでは「30分刻み」で「開始時間」を生成します
        while (currentSlotTime.getTime() < endTime.getTime()) {
            
            // 過去の時間はスキップ
            if (currentSlotTime.getTime() < today.getTime()) { 
                currentSlotTime.setMinutes(currentSlotTime.getMinutes() + 30);
                continue;
            }
            
            // この時間が「予約済み」と被っていないかチェック
            // (簡易チェック: 開始時点が予約イベント内にあるか、30分後が予約イベント内にあるか)
            const checkEnd = new Date(currentSlotTime.getTime() + 30 * 60000); 
            
            const isReserved = bookedEvents.some(bookedEvent => {
                const bStart = bookedEvent.getStartTime().getTime();
                const bEnd = bookedEvent.getEndTime().getTime();
                const cStart = currentSlotTime.getTime();
                const cEnd = checkEnd.getTime();
                
                // 重複判定 (Overlap)
                return (cStart < bEnd && cEnd > bStart);
            });
            
            if (!isReserved) {
                // 配列に追加
                flatSlots.push({
                    date: Utilities.formatDate(currentSlotTime, TIME_ZONE, 'yyyy-MM-dd'),
                    startTime: Utilities.formatDate(currentSlotTime, TIME_ZONE, 'HH:mm'),
                    timestamp: currentSlotTime.getTime()
                });
            }
            
            currentSlotTime.setMinutes(currentSlotTime.getMinutes() + 30);
        }
      });
      
      // 重複排除とソート
      const uniqueSlots = [];
      const keys = new Set();
      flatSlots.sort((a,b) => a.timestamp - b.timestamp).forEach(item => {
          const key = item.date + '_' + item.startTime;
          if(!keys.has(key)){
              keys.add(key);
              uniqueSlots.push(item);
          }
      });
      
      return uniqueSlots; // JSON形式で返す {date: '...', startTime: '...'} の配列

  } catch (error) {
      Logger.log("Error: " + error.message);
      throw error;
  }
}

// =======================================================
// 3. 予約作成 (createBooking)
// =======================================================
function createBooking(bookingData) {
  try {
    // データ受け取り
    const { courseName, name, email, notes, date, time, duration } = bookingData;
    
    // 日時作成
    const startDateTimeStr = `${date}T${time}:00+09:00`; 
    const startDateTime = new Date(startDateTimeStr);
    const endTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
    
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    
    // 二重予約チェック
    const conflicts = calendar.getEvents(startDateTime, endTime);
    const isConflict = conflicts.some(e => e.getTitle() !== SLOT_EVENT_TITLE);
    if (isConflict) {
        return { status: 'error', error: "タッチの差で予約が埋まってしまいました。別の日時を選択してください。" };
    }

    // イベント作成
    const eventTitle = `${courseName}: ${name}様`;
    const description = `コース: ${courseName}\n氏名: ${name}\nEmail: ${email}\n備考: ${notes}`;
    
    calendar.createEvent(eventTitle, startDateTime, endTime, {
        description: description,
        guests: email + ',' + SENDER_EMAIL,
        sendInvites: true
    });

    // ログ保存 (エラーが出ても予約は止めない)
    try {
       const ss = SpreadsheetApp.openById(LOG_SHEET_ID);
       const sheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.getSheets()[0];
       sheet.appendRow([new Date(), name, email, courseName, date, time, notes]);
    } catch(e) { Logger.log("Log Error: " + e.message); }

    return { status: 'success' };

  } catch (error) {
      return { status: 'error', error: error.message };
  }
}