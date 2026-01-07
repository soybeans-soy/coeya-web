// =======================================================
// 【設定エリア】ここを変更するだけでコースや講師を増減できます
// =======================================================

// 1. 管理者設定
const ADMIN_EMAIL = 'trextacy@gmail.com'; // 管理者（あなた）のメールアドレス
const TIME_ZONE = 'Asia/Tokyo';

// 2. コース設定 (ID, 表示名, 時間(分))
// ※HTML側ではなく、ここでメニューを管理します
const COURSES = [
  { id: 'trial', name: '【初回限定】体験レッスン', duration: 30 },
  { id: 'vocal-60', name: 'マンツーマンボイトレ', duration: 60 },
  { id: 'opera-60', name: '声楽・オペラ専門レッスン', duration: 60 },
  { id: 'pro-90', name: 'プロ養成コース', duration: 90 }
];

// 3. 講師設定 (ID, 表示名, カレンダーID, 通知先メール, 対応コースID)
// ※対応コースIDが空配列 [] の場合は「全コース対応」になります
// 3. 講師設定 (ID, 表示名, カレンダーID, 通知先メール, 対応コースID)
const INSTRUCTORS = {
  'tanaka': {
    name: 'TREXTACY 講師',
    calendarId: 'a9b8f1bfc03a2f34d07736235bb5a059d0b9569a54c45402037df410d162a759@group.calendar.google.com',
    email: 'trextacy@gmail.com',
    supportedCourses: [] 
  }/*,  // ← ここに /* を入れます
  'sato': {
    name: '佐藤 講師',
    calendarId: 'a9b8f1bfc03a2f34d07736235bb5a059d0b9569a54c45402037df410d162a759@group.calendar.google.com',
    email: 'trextacy@gmail.com',
    supportedCourses: ['trial', 'vocal-60'] 
  }
  */ // ← ここに */ を入れます
};

// 4. カレンダー共通設定
const SLOT_EVENT_TITLE = "予約可能枠"; 
const BUSINESS_START_HOUR = 10;
const BUSINESS_END_HOUR = 21;
const LOG_SHEET_ID = ''; // ログ用シートIDがあれば入力

// =======================================================
// システムロジック (ここから下は変更不要)
// =======================================================

function doGet(e) {
  const action = e.parameter.action;
  
  // 設定データ（コース・講師リスト）を返す
  if (action === 'getConfig') {
    return createJsonResponse({ 
      courses: COURSES, 
      instructors: INSTRUCTORS 
    });
  }
  
  // 指定された講師の空き状況を返す
  if (action === 'getSlots') {
    const instructorId = e.parameter.instructorId;
    if (!instructorId || !INSTRUCTORS[instructorId]) {
      return createJsonResponse({ error: '講師情報が無効です。' });
    }
    const result = getAvailableSlots(instructorId);
    return createJsonResponse(result);
  }
  
  return createJsonResponse({ status: 'error', message: 'Invalid action' });
}

function doPost(e) {
  try {
    const jsonString = e.postData.contents;
    const bookingData = JSON.parse(jsonString);
    const result = createBooking(bookingData);
    return createJsonResponse(result);
  } catch (error) {
    return createJsonResponse({ status: 'error', error: error.message });
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// 空き枠取得
function getAvailableSlots(instructorId) {
  try {
    const instructor = INSTRUCTORS[instructorId];
    const calendar = CalendarApp.getCalendarById(instructor.calendarId);
    
    if (!calendar) return { error: `講師(${instructor.name})のカレンダーが見つかりません。IDを確認してください。` };

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    
    const allEvents = calendar.getEvents(startOfMonth, endOfNextMonth);
    const flatSlots = [];
    const bookedEvents = [];
    const slotEvents = [];

    allEvents.forEach(event => {
      if (event.getTitle() === SLOT_EVENT_TITLE) slotEvents.push(event);
      else bookedEvents.push(event);
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
           return (currentSlotTime.getTime() < bookedEvent.getEndTime().getTime() && checkEnd.getTime() > bookedEvent.getStartTime().getTime());
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
      if(!keys.has(key)){ keys.add(key); uniqueSlots.push(item); }
    });
    
    return uniqueSlots;
  } catch (error) {
    return { error: error.message };
  }
}

// 予約作成
function createBooking(data) {
  try {
    const { instructorId, courseId, name, email, notes, date, time } = data;
    
    const instructor = INSTRUCTORS[instructorId];
    const course = COURSES.find(c => c.id === courseId);
    
    if (!instructor || !course) throw new Error("データ整合性エラー");

    const startDateTime = new Date(`${date}T${time}:00+09:00`);
    const endDateTime = new Date(startDateTime.getTime() + course.duration * 60000);
    
    const calendar = CalendarApp.getCalendarById(instructor.calendarId);
    if (!calendar) throw new Error("カレンダーにアクセスできません");

    const conflicts = calendar.getEvents(startDateTime, endDateTime);
    const isConflict = conflicts.some(e => e.getTitle() !== SLOT_EVENT_TITLE);
    if (isConflict) return { status: 'error', error: "タッチの差で予約が埋まりました。" };

    // カレンダー登録
    const desc = `コース: ${course.name}\n講師: ${instructor.name}\n受講者: ${name}\nEmail: ${email}\n備考: ${notes || 'なし'}`;
    calendar.createEvent(`【予約】${course.name}: ${name}様`, startDateTime, endDateTime, { description: desc });

    // メール送信
    const dateStr = Utilities.formatDate(startDateTime, TIME_ZONE, 'yyyy/MM/dd(E) HH:mm');
    
    // 1. 生徒へ
    MailApp.sendEmail({
      to: email,
      subject: `【予約完了】${course.name}のご案内`,
      body: `${name} 様\n\nご予約ありがとうございます。\n日時: ${dateStr}\nコース: ${course.name}\n講師: ${instructor.name}\n\n当日お待ちしております。`
    });

    // 2. 講師へ
    MailApp.sendEmail({
      to: instructor.email,
      subject: `【新規予約】${dateStr} - ${name}様`,
      body: `お疲れ様です。\n新規予約が入りました。\n\n日時: ${dateStr}\nコース: ${course.name}\n受講者: ${name} 様\n備考: ${notes}`
    });

    // 3. 管理者へ
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: `【管理通知】${instructor.name}クラスに予約`,
      body: `管理者様\n\n予約発生\n講師: ${instructor.name}\n日時: ${dateStr}\n受講者: ${name} 様`
    });
    
    if (LOG_SHEET_ID) {
      try {
        SpreadsheetApp.openById(LOG_SHEET_ID).getSheets()[0].appendRow([new Date(), instructor.name, course.name, date, time, name, email]);
      } catch(e) {}
    }

    return { status: 'success' };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

function testMail() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), "Test", "Test");
}