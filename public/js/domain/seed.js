// 種子資料。來自 SPEC.md 第 12 節。
//
// 全部都能在設定頁改，這只是初始值。ID 刻意用固定的英文代號而不是隨機字串，
// 這樣重複載入不會長出第二份，方案範本也能穩定指向課程與器材。
//
// SPEC 第 13 節仍列為資料缺口的部分（完整診間清單、各點滴室床位數、
// 完整治療師名單）就照目前已知的填，之後在設定頁補。

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

  // 2026-08-19 從她的行事曆與口述補齊。醫師（夏、許、李）刻意不放進來：
  // 他們不會被指派到時段上，只出現在她的速記裡，認得那幾個字是
  // .claude/skills/calendar-sheet-merge 的事，不是主檔的事。
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
  ],

  equipment: [
    { id: 'eq-indiba', name: 'INDIBA', contraindications: [] },
    { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
    { id: 'eq-laser', name: '高能量雷射', contraindications: ['體內金屬'] },
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
      id: 'course-followup', name: '二返', category: 'A', durationMin: 30,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },

    // ---- B 類：單系統＋電話 ----
    {
      id: 'course-checkup', name: '健檢', category: 'B', durationMin: 120,
      assigns: 'room', allowedRoomTypes: ['治療室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },

    // ---- C 類：只有 Abovee ----
    {
      // 擇一池的那個課程。三種器材都要物理治療師操作，所以指派治療師不指派診間。
      id: 'course-recovery', name: '復能', category: 'C', durationMin: 60,
      assigns: 'therapist', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: true, frequencyRule: null,
    },
    {
      // 同屬物理賦能課程分類，但不需要治療師操作，所以獨立計次、選診間
      id: 'course-iv-laser', name: '靜脈', category: 'C', durationMin: 60,
      assigns: 'room', allowedRoomTypes: ['ILIB室', '治療室', '點滴室'], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
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
        { type: 'pool', label: '復能', qty: 12, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: '靜脈', qty: 20, durationMin: 60 },
      ],
    },
    {
      // 試算表模板，購買數量 = 1 時的基準。
      // 賦能與靜脈的次數與筋骨強身相反，這是正常的不是筆誤。
      id: 'plan-8wan', name: '8萬方案', membershipMonths: 12,
      note: '試算表模板，購買數量 1 的基準',
      items: [
        { type: 'single', courseId: 'course-inbody', label: '身體組成分析', qty: 4, durationMin: 20, frequencyRule: '每季一次' },
        { type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 2, durationMin: 30 },
        { type: 'single', courseId: 'course-pt-consult', label: '物理治療師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-nutrition-consult', label: '營養師諮詢', qty: 4, durationMin: 20 },
        { type: 'single', courseId: 'course-fitness', label: '體適能檢查分析', qty: 4, durationMin: 30, frequencyRule: '每季一次' },
        { type: 'pool', label: '復能', qty: 20, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: '靜脈', qty: 12, durationMin: 60 },
      ],
    },
  ],
};

/** 設定頁的預設值。權重初始值見 SPEC 第 9 節。 */
export const DEFAULT_SETTINGS = {
  sortWeights: { w1: 1.0, w2: 0.8, w3: 0.6, w4: 0.3 },
  slotGapMin: 15,
  noReplyDays: 3,
  // 試算表同步。兩個都填了才會開始推（見 data/sheetSync.js）。
  // 密鑰放在這裡而不是寫進前端程式碼：部署出去的 JS 人人看得到，
  // 這份文件則被 firestore.rules 的白名單守著。
  sheetSync: { url: '', token: '' },
};
