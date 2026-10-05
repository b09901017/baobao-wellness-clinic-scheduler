// 種子資料。來自 SPEC.md 第 12 節。
//
// 全部都能在設定頁改，這只是初始值。ID 刻意用固定的英文代號而不是隨機字串，
// 這樣重複載入不會長出第二份，方案範本也能穩定指向課程與器材。
//
// SPEC 第 13 節仍列為資料缺口的部分（完整診間清單、各點滴室床位數、
// 完整治療師名單）就照目前已知的填，之後在設定頁補。

import { DEFAULT_FOLLOWUP_DUE_DAYS, DEFAULT_REPORT_DUE_DAYS } from './followups.js';

export const SEED = {
  // 空間。**2026-09-08 她重畫過一次**，三種類型、都沒有 4 號：
  //
  //   治療室  治2 治3 治5 治8
  //   點滴室  點滴2 3 5 6 7 8 9 10        簡寫 .2 …… .10
  //   VIP室   VIP2 3 5 6 7                簡寫 vip2 …… vip7
  //
  // **簡寫裡的數字就是房號**（她指名的）—— 她走到那扇門前面看到的是門上的
  // 號碼，畫面上要是同一個數字。治療室本來就只有兩三個字，所以沒有簡寫
  // （空的就退回全名，同器材的 `SIS`）。
  //
  // 簡寫**是另一格不是改名**：試算表、稽核紀錄、既有來訪讀的都是全名，
  // 而 `.2` 單獨出現在稽核紀錄上沒有人看得懂。哪裡印哪一個只寫在
  // `domain/naming.js` 的 `nameOf()`。
  //
  // **床位那一層拿掉了**（她選的：「取消任何床位區分」）。舊資料上點滴8
  // 還有 A／B，清掉那幾筆是資料健檢「來訪上還記著床位」那一列的事。
  //
  // 2026-08-19 她確認過「治7、治9、治10、點滴2、點滴8、ILIB4 也都還在」，
  // 2026-09-08 這一輪把治7／治9／治10／ILIB4 拿掉了（ILIB4 有個 4）。
  // **既有資料庫不會自己跟上**（`loadSeed()` 只建不覆蓋），那一步由資料健檢
  // 的「診間清單跟建議的不一樣」負責。
  rooms: [
    { id: 'room-t2', name: '治2', type: '治療室' },
    { id: 'room-t3', name: '治3', type: '治療室' },
    { id: 'room-t5', name: '治5', type: '治療室' },
    { id: 'room-t8', name: '治8', type: '治療室' },
    { id: 'room-iv2', name: '點滴2', type: '點滴室', shortName: '.2' },
    { id: 'room-iv3', name: '點滴3', type: '點滴室', shortName: '.3' },
    { id: 'room-iv5', name: '點滴5', type: '點滴室', shortName: '.5' },
    { id: 'room-iv6', name: '點滴6', type: '點滴室', shortName: '.6' },
    { id: 'room-iv7', name: '點滴7', type: '點滴室', shortName: '.7' },
    // **同一個時間裝得下兩位**（ADR-0094）。她的 9 月壓表白紙上有一對夫妻
    // 同時排在 `IL 8A` 與 `IL 8B`，而床位那一層她不要（2026-09-16：
    //「目前的確不需要床位，都寫 .8」）。其餘每一間沒填就是 1。
    { id: 'room-iv8', name: '點滴8', type: '點滴室', shortName: '.8', capacity: 2 },
    { id: 'room-iv9', name: '點滴9', type: '點滴室', shortName: '.9' },
    { id: 'room-iv10', name: '點滴10', type: '點滴室', shortName: '.10' },
    { id: 'room-vip2', name: 'VIP2', type: 'VIP室', shortName: 'vip2' },
    { id: 'room-vip3', name: 'VIP3', type: 'VIP室', shortName: 'vip3' },
    { id: 'room-vip5', name: 'VIP5', type: 'VIP室', shortName: 'vip5' },
    { id: 'room-vip6', name: 'VIP6', type: 'VIP室', shortName: 'vip6' },
    { id: 'room-vip7', name: 'VIP7', type: 'VIP室', shortName: 'vip7' },
  ],

  // 2026-08-19 從她的行事曆與口述補齊。
  //
  // 醫師（夏、許、李）2026-08-20 加進來 —— 約二返時要選醫師，
  // 所以他們現在也會被指派到時段上。這推翻了 SPEC 第 12 節原本那句
  // 「醫師不放進 config/staff」，見 docs/adr/0026-doctors-are-assignable-staff.md。
  // 姓氏就是她講的全部，名字她沒說，不要自己補。
  //
  // **科別（`specialties`，ADR-0120）刻意不填**：她還沒說誰是哪一科，由她自己在
  // 設定 → 治療師與醫師 填。Abovee 上的全名也不寫在這裡（真名不進 repo）。
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

  // 器材。**兩格名字回答兩個不同的問題**（2026-09-08）：
  //
  //   全名   她叫它什麼           SIS、INDIBA、高能量雷射、ILIB
  //   別稱   月曆那一格的縮寫     （空）、IN、（空）、IL
  //
  // 額度的名字讀全名（`復能-INDIBA(60)`），月曆讀別稱（`IN(60)`）——
  // 那正是她 2026-09-08 列的六種與它們的簡寫。夠短的就不必有別稱。
  //
  // **每一台還記著「用這台的那一段算哪一個課程」**（ADR-0075）——
  // 復能四選一是一筆額度、四台器材，而 ILIB 那一台要的是診間、
  // 其餘三台要的是物理治療師。指派是課程說了算，所以課程要由器材推。
  //
  // ILIB 是 2026-09-06 補進來的第四台：在那之前它只是一個課程（靜脈），
  // 而擇一池的選項是器材，所以它進不了四選一。
  //
  // **`aboveeNames` 是 Abovee 課程那一格怎麼寫它**（2026-10-05，abovee-and-master/07）：
  // `SIS 60`、`IN 30`、`高能量60`、`ILIB 60` 拆掉結尾的分鐘之後的那幾個字。拍 Abovee 靠它認，
  // 她在設定頁改得動；寫法跟著那一筆走，改名之後照樣認得。
  equipment: [
    // 別稱 `IN` 是 2026-09-08 補的：月曆一格放不下 `INDIBA(60)` 六個字，
    // 而她列的第三種就是 `復能-INDIBA(30/60) -> IN(30/60)` —— 額度讀全名、
    // 月曆讀別稱，這一台正是那兩格會不一樣的那一台。
    { id: 'eq-indiba', name: 'INDIBA', shortName: 'IN', courseId: 'course-recovery', contraindications: [], aboveeNames: ['IN'] },
    // **全名就是她叫它的名字**（2026-09-08）：她自己講的、寫的、記的都是 SIS，
    // 而額度的名字讀的是全名（`復能-SIS(60)`）。別稱是**月曆上那一格的縮寫**，
    // SIS 本來就夠短，所以它沒有別稱。既有資料庫上這一台還叫「超磁場」——
    // 改名那一步由資料健檢的「器材的名字跟建議的不一樣」負責。
    { id: 'eq-sis', name: 'SIS', courseId: 'course-recovery', contraindications: ['體內金屬'], aboveeNames: ['SIS'] },
    { id: 'eq-laser', name: '高能量雷射', courseId: 'course-recovery', contraindications: ['體內金屬'], aboveeNames: ['高能量'] },
    // 別稱跟它那個課程一樣是 `IL`（她自己記的寫法）。月檢視印的是器材別稱，
    // 所以四選一那一筆排到 ILIB 的那一天，日曆上就是 `IL`。
    // 一般那一種不會印成 `ILIB(IL)` —— `slotName()` 認得出這兩個是同一件事。
    { id: 'eq-ilib', name: 'ILIB', shortName: 'IL', courseId: 'course-iv-laser', contraindications: [], aboveeNames: ['ILIB'] },
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
    // **紅・實心**是這一份裡最醒目的畫法，而她的原話是「血管難打、體內有金屬
    // 可以最明顯」。2026-09-06 加這一層的時候只填了名字與說明，於是它畫出來
    // 跟其餘警示一樣是茶色空心 —— 手冊與 E2E 都寫著它該是紅實心，資料上卻
    // 一直沒有。既有資料庫不會自己跟上（`loadSeed()` 只建不覆蓋），
    // 要的話到 設定 → 警示 改一下就有。
    { id: 'cf-metal', name: '體內金屬', color: 'red', fill: 'solid',
      hint: 'SIS 與高能量雷射要提醒，建議改用 INDIBA' },
    { id: 'cf-veins', name: '血管難打', hint: '點滴與抽血要多留時間，先問慣用手' },
    { id: 'cf-first', name: '第一針', hint: '第一次施打，事前多講一次流程' },
  ],

  // 合作機構（ADR-0076）。客戶身上打得上的一個標記 —— 有這個標記的人，
  // 她壓完表之後要跟對方的專員說一聲。**不生任何待辦**（她 2026-09-06 選的），
  // 標記本身就是提醒。
  partners: [
    { id: 'partner-nb', name: '自然美' },
  ],

  // 營養點滴品項。**`durationMin` 是選填的**（ADR-0098）：填了就是那一針要打
  // 多久，空的就跟著課程走（一般 120 分）。她 2026-09-16：「一般120分，
  // 護心抗老180分」。行事曆上她刻意設過結束時間的 4 筆點滴全部是 120 分
  //（雪顏亮彩 ×3、護肝排毒 ×1），護心抗老一筆都沒有。
  ivProducts: [
    { id: 'iv-heart', name: '護心抗老', durationMin: 180 },
    { id: 'iv-liver', name: '護肝排毒' },
    { id: 'iv-gut', name: '腸道修復' },
    { id: 'iv-sulic', name: '速利清' },
    { id: 'iv-mengjian', name: '猛健樂' },
    { id: 'iv-nac', name: 'NAC 愛咳痰' },
    // Abovee 寫「亮采」（她 2026-10-05：不改名，記住那個寫法）
    { id: 'iv-snow', name: '雪顏亮彩', aboveeNames: ['雪顏亮采'] },
  ],

  products: [
    { id: 'prod-yetaimei', name: '夜態美' },
    { id: 'prod-sushanjing', name: '速膳淨' },
    { id: 'prod-linengkang', name: '粒能康' },
    { id: 'prod-gaba', name: 'GABA' },
  ],

  // 課程。**要指派什麼由她 2026-09-08 那三條規則決定**：
  //
  //   物理治療師  復能（INDIBA／SIS／高能量雷射，多選一選到這三者也算）
  //   治療室      營養點滴、EECP、ILIB
  //   醫師        門診類（A 類一律選得到，見 `picksDoctor()`）
  //   都不用      體適能、身體組成分析、營養諮詢、健檢、門診
  //
  // 2026-09-08 之前健檢、體適能、身體組成、營養諮詢、復健科醫師門診與二返
  // 六個都指派著治療室。既有資料庫不會自己跟上（`loadSeed()` 只建不覆蓋），
  // 那一步由資料健檢的「課程的指派跟建議的不一樣」負責。
  //
  // **`group` 是設定 → 課程 那一頁的分類**（2026-10-05，`masterData.js` 的
  // `COURSE_GROUPS`）。它只管清單怎麼分組，沒有任何規則讀它 —— 底下
  // 「A 類／B 類／C 類」那幾行註解講的是任務類別，跟分類是兩件事。
  //
  // **`systems` 是這門課動到哪幾個系統**（ADR-0119）：勾了 Abovee 就是壓在 Abovee，
  // 其餘勾起來的等客人確認之後長成待辦（推導只在 `taskRules.js` 的 `systemsOf()`）。
  // 每一門填的都跟它的 `category` 推出來的一模一樣（`tests/course-systems.test.js` 釘著），
  // 所以這一格在種子上不改變任何行為 —— 它在這裡是為了設定頁打開就是勾好的。
  // `category` 留著當沒勾過的課程的退路。
  //
  // **`aboveeNames` 是 Abovee 課程那一格怎麼寫它**（abovee-and-master/07）。名字跟 Abovee 一樣的
  // （二返、EECP）也填：她之後改名，拍 Abovee 照樣認得。
  courses: [
    // ---- A 類：三系統＋電話 ----
    {
      id: 'course-rehab', name: '復健科醫師門診', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['復健門診'],
      // 門診要的是**醫師，不是空間**（她 2026-09-08）。A 類一律選得到醫師
      // （`picksDoctor()`），所以這裡什麼都不用指派。
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      // 指定一科是**排序不是限制**（ADR-0120）：那一科的醫師排前面。種子醫師還沒填科別，
      // 在她填之前這一排跟以前長得一模一樣（那一科沒有人 → 全部列出來）。
      doctorPick: '復健科',
      requiresEquipment: false, frequencyRule: null,
      // 她 2026-09-08：「除了二返、營養諮詢之外，復健科門診也要事後寫記錄」。
      // 逐課程不逐類別（ADR-0066）—— 同樣 A 類的心臟科評估就不用。
      needsRecord: true,
    },
    {
      // SPEC 第 7 節規則 3：心臟科評估不佔診間
      id: 'course-cardio', name: '心臟科評估', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['心臟門診'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      doctorPick: '心臟科',
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // 唯一一個開了 requiresDoctor 的種子課程。復健科醫師門診與心臟科評估
      // 其實也有醫師，但她只講了二返 —— 主檔上打開就好，不用改程式（同 ADR-0022）。
      id: 'course-followup', name: '二返', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['二返'],
      // 同復健科醫師門診：要醫師不要空間（她 2026-09-08）。
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, requiresDoctor: true, doctorPick: '功能／二返', frequencyRule: null,
      // **約的時候選 30 或 60**（ADR-0122，她 2026-10-05：「約的時候選，預設 30」）。
      // 二返的額度是跟著健檢自動長出來的，買的時候沒得選，所以不是 `durationChoices`
      // （那是兩筆額度）—— 同一筆額度，每一段自己挑。n返 借這門課，所以三返也選得到。
      bookingMinutes: [30, 60],
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
      id: 'course-checkup', name: '健檢', group: '健檢', category: 'B', systems: ['Examine'], durationMin: 120,
      // 需要空間的只有營養點滴、EECP、ILIB 三個（她 2026-09-08）。
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      followupCourseId: 'course-followup',
    },

    // ---- C 類：只有 Abovee ----
    {
      // 擇一池的那個課程。三種器材都要物理治療師操作，所以指派治療師不指派診間。
      //
      // 「可選時長」是 2026-09-06 加的：她要買得到 `sis(60)x5` 也買得到
      // `indiba(30)x5`，而那兩個是同一個課程的兩種規格，不是兩個課程。
      id: 'course-recovery', name: '復能', group: '復能', category: 'C',
      systems: ['Abovee'], durationMin: 60,
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
      id: 'course-iv-laser', name: 'ILIB', group: 'ILIB', shortName: 'IL', lineName: '靜脈雷射',
      category: 'C', systems: ['Abovee'], durationMin: 60,
      // `ILIB室` 那個類型 2026-09-08 拿掉了（唯一那一間是 ILIB4，它有個 4）。
      // 她給的優先順序是 `.10、治2、治3`，本來就排在點滴室與治療室。
      assigns: 'room', allowedRoomTypes: ['治療室', '點滴室'], allowedRoomIds: [],
      // 她 2026-09-08 給的優先順序：`.10、治2、治3`。**只是順序不是限制** ——
      // 其餘的治療室與點滴室照樣選得到。
      preferredRoomIds: ['room-iv10', 'room-t2', 'room-t3'],
      requiresEquipment: false, frequencyRule: null, durationChoices: [30, 60],
    },
    {
      // SPEC 第 7 節規則 2：EECP 只能在治5、治8。
      // `preferredRoomIds` 跟它**同時填著**是刻意的（2026-09-08）：
      // 限制是硬的、順序是軟的，她之後在設定裡放寬限制時順序還在。
      //
      // **2026-09-16 從 30 分改成 60 分。** 她：「體驗30正式課60」。
      // 2026-09-16 早上那個 30 是暫定值（「這個先保留先當作30分鐘」），
      // 而她當天稍晚給了真正的答案 —— 30 分那一種是底下那一門體驗課。
      id: 'course-eecp', name: 'EECP', group: 'EECP', category: 'C',
      systems: ['Abovee'], durationMin: 60, aboveeNames: ['EECP'],
      assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t8'],
      preferredRoomIds: ['room-t5', 'room-t8'],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // 她 2026-09-16：「體驗30正式課60，也就是預設資料裡面要多一門EECP體驗課，
      // 預設30分鐘，這樣匯入的也可以對應到了」。
      //
      // **名字要跟舊表寫的一字不差**（`EECP體驗`，舊表第 14 列）——
      // `legacyImport.js` 的 `resolveCourse()` 是精確比對，對不上的話那一段
      // 匯不進來。`SPEC.md` 第 4.4 節她自己記的實際紀錄也是這四個字
      //（`14:45–15:15  EECP 體驗`）。
      //
      // 機器就那兩間，所以限制與順序跟正式課一模一樣。
      id: 'course-eecp-trial', name: 'EECP體驗', group: 'EECP', category: 'C',
      // Abovee 寫 `EECP20`（她 2026-10-05：「EECP20 就是 EECP 體驗」）。整格比對、在拆分鐘之前 ——
      // 拆了就是「EECP＋20 分」，認成正式課（`abovee.js` 的 `courseFrom()`）
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['EECP20'],
      assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t8'],
      preferredRoomIds: ['room-t5', 'room-t8'],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      // 每次施打的品項可能不同，所以來訪時要記錄用了哪一個（見 CONTEXT.md 營養點滴品項）
      //
      // 她 2026-09-08 說營養點滴要優先顯示 `.2` 至 `.10` —— **那本來就成立**：
      // `allowedRoomTypes` 是點滴室，所以那八間本來就排在最前面、其餘收在
      // 「其他診間」底下。`preferredRoomIds` 刻意留空：全部都是推薦等於沒有
      // 推薦，而多一份名單就多一個「她之後加一間點滴室卻忘了加進去」的機會。
      // **2026-09-16 從 60 分改成 120 分**（她：「一般120分」）。9/16 早上那個
      // 60 是暫定值（「這個先保留先當作60分鐘，兩小時的先當作排了兩段」），
      // 而「兩小時排兩段」那一句因此也不成立了 —— 一針 120 分就是一段 120 分。
      // 打 180 分的那一款由品項身上那一格說了算（`slotMinutes()`，ADR-0098）。
      id: 'course-iv-drip', name: '營養點滴', group: '營養點滴', category: 'C',
      systems: ['Abovee'], durationMin: 120,
      assigns: 'room', allowedRoomTypes: ['點滴室'], allowedRoomIds: [],
      requiresEquipment: false, requiresIvProduct: true, frequencyRule: null,
    },

    // ---- 不產生任務：這五項不需要掛號，是刻意的不是漏填 ----
    {
      id: 'course-inbody', name: '身體組成分析', group: '運動區', category: null,
      systems: ['Abovee'], durationMin: 20, aboveeNames: ['身體組成'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: '每季一次',
    },
    {
      id: 'course-fitness', name: '體適能檢查分析', group: '運動區', category: null,
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['體適能'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: '每季一次',
    },
    {
      // 沒有 `group` → 落在「其他」。她 2026-10-05：「物理治療師諮詢先放『其他』，
      // Abovee 沒這東西，我們賣出去但自己都還不確定這是什麼」。
      id: 'course-pt-consult', name: '物理治療師諮詢', category: null, systems: ['Abovee'], durationMin: 20,
      assigns: 'therapist', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
    },
    {
      id: 'course-nutrition-consult', name: '營養師諮詢', group: '運動區', category: null,
      systems: ['Abovee'], durationMin: 20, aboveeNames: ['營養諮詢'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
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
        { type: 'pool', label: '復能-三選一(60)', qty: 12, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: 'ILIB(60)', qty: 20, durationMin: 60 },
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
        { type: 'pool', label: '復能-三選一(60)', qty: 20, durationMin: 60,
          optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] },
        { type: 'single', courseId: 'course-iv-laser', label: 'ILIB(60)', qty: 12, durationMin: 60 },
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
