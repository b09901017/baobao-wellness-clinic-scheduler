// 種子資料。來自 SPEC.md 第 12 節。
//
// 全部都能在設定頁改，這只是初始值。ID 刻意用固定的英文代號而不是隨機字串，
// 這樣重複載入不會長出第二份，方案範本也能穩定指向課程與器材。
//
// SPEC 第 13 節仍列為資料缺口的部分（完整診間清單、各點滴室床位數、
// 完整治療師名單）就照目前已知的填，之後在設定頁補。

import { DEFAULT_FOLLOWUP_DUE_DAYS, DEFAULT_REPORT_DUE_DAYS } from './followups.js';

export const SEED = {
  rooms: [
    { id: 'room-t2', name: '治2', type: '治療室', beds: [] },
    { id: 'room-t3', name: '治3', type: '治療室', beds: [] },
    { id: 'room-t5', name: '治5', type: '治療室', beds: [] },
    { id: 'room-t7', name: '治7', type: '治療室', beds: [] },
    { id: 'room-t8', name: '治8', type: '治療室', beds: [] },
    { id: 'room-t9', name: '治9', type: '治療室', beds: [] },
    { id: 'room-t10', name: '治10', type: '治療室', beds: [] },
    { id: 'room-iv2', name: '點滴2', type: '點滴室', beds: [] },
    { id: 'room-iv3', name: '點滴3', type: '點滴室', beds: [] },
    { id: 'room-iv5', name: '點滴5', type: '點滴室', beds: [] },
    { id: 'room-iv6', name: '點滴6', type: '點滴室', beds: [] },
    { id: 'room-iv7', name: '點滴7', type: '點滴室', beds: [] },
    // 公司系統畫面上看到「點滴室8 / 床A」分兩行，所以這間確定有床位。
    // 其餘幾間有沒有床位待確認，先留空。
    { id: 'room-iv8', name: '點滴8', type: '點滴室', beds: ['A', 'B'] },
    { id: 'room-iv9', name: '點滴9', type: '點滴室', beds: [] },
    { id: 'room-iv10', name: '點滴10', type: '點滴室', beds: [] },
    { id: 'room-ilib4', name: 'ILIB4', type: 'ILIB室', beds: [] },
  ],

  // 2026-08-19 從她的行事曆與口述補齊。
  //
  // 醫師（夏、許、李）2026-08-20 加進來 —— 約二返時要選醫師，
  // 所以他們現在也會被指派到時段上。這推翻了 SPEC 第 12 節原本那句
  // 「醫師不放進 config/staff」，見 docs/adr/0026-doctors-are-assignable-staff.md。
  // 姓氏就是她講的全部，名字她沒說，不要自己補。
  staff: [
    { id: 'staff-tw', name: '騰崴', role: '物理治療師' },
    { id: 'staff-zn', name: '芝寧', role: '物理治療師' },
    { id: 'staff-lulu', name: 'LuLu', role: '物理治療師' },
    { id: 'staff-xy', name: '欣穎', role: '物理治療師' },
    { id: 'staff-gy', name: '耕宇', role: '物理治療師' },
    { id: 'staff-zx', name: '姿璇', role: '物理治療師' },
    { id: 'staff-yt', name: '怡婷', role: '物理治療師' },
    { id: 'staff-py', name: '珮喩', role: '物理治療師' },
    { id: 'staff-wt', name: '王婷', role: '物理治療師' },
    { id: 'staff-dr-xia', name: '夏', role: '醫師' },
    { id: 'staff-dr-xu', name: '許', role: '醫師' },
    { id: 'staff-dr-li', name: '李', role: '醫師' },
  ],

  // 器材。**每一台記著「用這台的那一段算哪一個課程」**（ADR-0075）——
  // 復能四選一是一筆額度、四台器材，而 ILIB 那一台要的是診間、
  // 其餘三台要的是物理治療師。指派是課程說了算，所以課程要由器材推。
  //
  // ILIB 是 2026-09-06 補進來的第四台：在那之前它只是一個課程（靜脈），
  // 而擇一池的選項是器材，所以它進不了四選一。
  equipment: [
    { id: 'eq-indiba', name: 'INDIBA', courseId: 'course-recovery', contraindications: [] },
    { id: 'eq-sis', name: '超磁場', shortName: 'SIS', courseId: 'course-recovery', contraindications: ['體內金屬'] },
    { id: 'eq-laser', name: '高能量雷射', courseId: 'course-recovery', contraindications: ['體內金屬'] },
    // 別稱跟它那個課程一樣是 `IL`（她自己記的寫法）。月檢視印的是器材別稱，
    // 所以四選一那一筆排到 ILIB 的那一天，日曆上就是 `IL`。
    // 一般那一種不會印成 `ILIB(IL)` —— `slotName()` 認得出這兩個是同一件事。
    { id: 'eq-ilib', name: 'ILIB', shortName: 'IL', courseId: 'course-iv-laser', contraindications: [] },
  ],

  // 警示（ADR-0074）。永久限制的第一層，**什麼都不擋** ——
  // 它只是要在壓表那一刻被看到。
  //
  // 「體內金屬」是 2026-09-06 加進來的：在那之前它自成一層（醫療禁忌），
  // 靠器材主檔推出來，而且會硬性擋掉超磁場與高能量雷射。不擋之後那一層就不存在了，
  // 所以它得在這份名單裡才畫得到客戶身上。**既有資料庫上沒有這一筆** ——
  // 補進去那一步由資料健檢的「器材上登記的提醒詞還不在警示名單裡」那一列負責。
  //
  // 另外兩個是她自己的流程筆記裡就有的（「預約系統註記（第一針或血管難打）」），
  // 其餘由她自己在設定裡加。
  clinicalFlags: [
    { id: 'cf-metal', name: '體內金屬', hint: '超磁場與高能量雷射要提醒，建議改用 INDIBA' },
    { id: 'cf-veins', name: '血管難打', hint: '點滴與抽血要多留時間，先問慣用手' },
    { id: 'cf-first', name: '第一針', hint: '第一次施打，事前多講一次流程' },
  ],

  // 合作機構（ADR-0076）。客戶身上打得上的一個標記 —— 有這個標記的人，
  // 她壓完表之後要跟對方的專員說一聲。**不生任何待辦**（她 2026-09-06 選的），
  // 標記本身就是提醒。
  partners: [
    { id: 'partner-nb', name: '自然美' },
  ],

  ivProducts: [
    { id: 'iv-heart', name: '護心抗老' },
    { id: 'iv-liver', name: '護肝排毒' },
    { id: 'iv-gut', name: '腸道修復' },
    { id: 'iv-sulic', name: '速利清' },
    { id: 'iv-mengjian', name: '猛健樂' },
    { id: 'iv-nac', name: 'NAC 愛咳痰' },
    { id: 'iv-snow', name: '雪顏亮彩' },
  ],

  products: [
    { id: 'prod-yetaimei', name: '夜態美' },
    { id: 'prod-sushanjing', name: '速膳淨' },
    { id: 'prod-linengkang', name: '粒能康' },
    { id: 'prod-gaba', name: 'GABA' },
  ],

  courses: [
    // ---- A 類：三系統＋電話 ----
    {
      id: 'course-rehab', name: '復健科醫師門診', category: 'A', durationMin: 30,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // SPEC 第 7 節規則 3：心臟科評估不佔診間
      id: 'course-cardio', name: '心臟科評估', category: 'A', durationMin: 30,
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // 唯一一個開了 requiresDoctor 的種子課程。復健科醫師門診與心臟科評估
      // 其實也有醫師，但她只講了二返 —— 主檔上打開就好，不用改程式（同 ADR-0022）。
      id: 'course-followup', name: '二返', category: 'A', durationMin: 30,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, requiresDoctor: true, frequencyRule: null,
      // 唯一一個不用簽療程單的課程（2026-08-23 使用者確認）。它是回院聽報告，
      // 沒有療程可以扣 —— 而療程單正是「扣掉那一次」的憑據（CONTEXT.md）。
      // 沒有這個欄位就是要簽，所以其餘課程一個字都不用寫。
      needsTreatmentForm: false,
      // 客人走了之後要去曜聖補一份二返紀錄（ADR-0066）。跟療程單相反：
      // 沒有這個欄位就是不用寫，所以只有真的要寫的那幾個課程有它。
      needsRecord: true,
    },

    // ---- B 類：單系統＋電話 ----
    {
      // 健檢做完要再約一次二返聽報告（SPEC 第 7 節規則 8）。配對記在這裡而不是
      // 寫死在程式碼裡：課程是她自己在主檔建的，id 猜不得。見 ADR-0022。
      id: 'course-checkup', name: '健檢', category: 'B', durationMin: 120,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      followupCourseId: 'course-followup',
    },

    // ---- C 類：只有 Abovee ----
    {
      // 擇一池的那個課程。三種器材都要物理治療師操作，所以指派治療師不指派診間。
      //
      // 「可選時長」是 2026-09-06 加的：她要買得到 `sis(60)x5` 也買得到
      // `indiba(30)x5`，而那兩個是同一個課程的兩種規格，不是兩個課程。
      id: 'course-recovery', name: '復能', category: 'C', durationMin: 60,
      assigns: 'therapist', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: true, frequencyRule: null, durationChoices: [30, 60],
    },
    {
      // 同屬物理賦能課程分類，但不需要治療師操作，所以獨立計次、選診間。
      //
      // 2026-09-06 從「靜脈」正名成「ILIB」—— 她自己、舊試算表（`ILIB 60mins`）
      // 與診間名稱（ILIB4）講的都是這個字。**主檔改名不會搬既有時段上的
      // `courseName` 快照**，那是刻意的（歷史紀錄留著當時寫下去的字）。
      //
      // 三種寫法都在這一列上（2026-09-07，ADR-0077）。她的原話：
      //
      // > 靜脈我希望他一般就叫做 ILIB 然後自己記叫做 IL
      // > 然後 line 草稿是叫做 靜脈雷射
      //
      // 貼給客人的那一句不能寫 `ILIB` —— 客戶看不懂那三個字母。
      id: 'course-iv-laser', name: 'ILIB', shortName: 'IL', lineName: '靜脈雷射',
      category: 'C', durationMin: 60,
      assigns: 'room', allowedRoomTypes: ['ILIB室', '治療室', '點滴室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null, durationChoices: [30, 60],
    },
    {
      // SPEC 第 7 節規則 2：EECP 只能在治5、治8
      id: 'course-eecp', name: 'EECP', category: 'C', durationMin: 30,
      assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t8'],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // 每次施打的品項可能不同，所以來訪時要記錄用了哪一個（見 CONTEXT.md 營養點滴品項）
      id: 'course-iv-drip', name: '營養點滴', category: 'C', durationMin: 60,
      assigns: 'room', allowedRoomTypes: ['點滴室'], allowedRoomIds: [],
      requiresEquipment: false, requiresIvProduct: true, frequencyRule: null,
    },

    // ---- 不產生任務：這五項不需要掛號，是刻意的不是漏填 ----
    {
      id: 'course-inbody', name: '身體組成分析', category: null, durationMin: 20,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: '每季一次',
    },
    {
      id: 'course-fitness', name: '體適能檢查分析', category: null, durationMin: 30,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: '每季一次',
    },
    {
      id: 'course-pt-consult', name: '物理治療師諮詢', category: null, durationMin: 20,
      assigns: 'therapist', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      id: 'course-nutrition-consult', name: '營養師諮詢', category: null, durationMin: 20,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      // 諮詢完要打一份諮詢紀錄（ADR-0066）
      needsRecord: true,
    },
  ],

  plans: [
    {
      id: 'plan-jingu', name: '筋骨強身', membershipMonths: 12,
      note: '總價 288,000，限本人',
      items: [
        { type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 6, durationMin: 30 },
        { type: 'single', courseId: 'course-pt-consult', label: '物理治療師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-nutrition-consult', label: '營養師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-inbody', label: '身體組成分析', qty: 4, durationMin: 20, frequencyRule: '每季一次' },
        { type: 'single', courseId: 'course-fitness', label: '體適能檢查分析', qty: 4, durationMin: 30, frequencyRule: '每季一次' },
        { type: 'pool', label: '復能 - 三選一（60）', qty: 12, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: 'ILIB（60）', qty: 20, durationMin: 60 },
      ],
    },
    {
      // 試算表模板，購買數量 = 1 時的基準。
      // 復能與 ILIB 的次數與筋骨強身相反，這是正常的不是筆誤。
      id: 'plan-8wan', name: '8萬方案', membershipMonths: 12,
      note: '試算表模板，購買數量 1 的基準',
      items: [
        { type: 'single', courseId: 'course-inbody', label: '身體組成分析', qty: 4, durationMin: 20, frequencyRule: '每季一次' },
        { type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 2, durationMin: 30 },
        { type: 'single', courseId: 'course-pt-consult', label: '物理治療師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-nutrition-consult', label: '營養師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-fitness', label: '體適能檢查分析', qty: 4, durationMin: 30, frequencyRule: '每季一次' },
        { type: 'pool', label: '復能 - 三選一（60）', qty: 20, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: 'ILIB（60）', qty: 12, durationMin: 60 },
      ],
    },
  ],
};

/** 設定頁的預設值。權重初始值見 SPEC 第 9 節。 */
export const DEFAULT_SETTINGS = {
  sortWeights: { w1: 1.0, w2: 0.8, w3: 0.6, w4: 0.3 },
  slotGapMin: 15,
  noReplyDays: 3,
  // 健檢做完之後幾天內要去問報告出來了沒（報告通常兩三週）。
  reportDueDays: DEFAULT_REPORT_DUE_DAYS,
  // **拿到報告那天**往後幾天內要把二返約好。從健檢日算的話它一出生就是
  // 逾期紅字，見 ADR-0042。SPEC 第 13 節本來就把這個間隔列在待確認清單裡，
  // 所以它是可調的預設值，不是寫死的規則（ADR-0022）。
  followupDueDays: DEFAULT_FOLLOWUP_DUE_DAYS,
  // 試算表同步。兩個都填了才會開始推（見 data/sheetSync.js）。
  // 密鑰放在這裡而不是寫進前端程式碼：部署出去的 JS 人人看得到，
  // 這份文件則被 firestore.rules 的白名單守著。
  sheetSync: { url: '', token: '' },
  // LINE 回覆模板。**只存她改過的那幾則**，所以預設是空的 ——
  // 沒改過的一律用 `domain/messageTemplates.js` 的 `TEMPLATES`。
  // 這樣之後改預設值時，她沒動過的那幾則會跟著更新。
  messageTemplates: {},
};
