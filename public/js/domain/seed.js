// 種子資料。來自 SPEC.md 第 12 節。
//
// 全部都能在設定頁改，這只是初始值。ID 刻意用固定的英文代號而不是隨機字串，
// 這樣重複載入不會長出第二份，方案範本也能穩定指向課程與器材。
//
// SPEC 第 13 節當時列的資料缺口（完整診間清單、完整治療師名單）2026-10-06 照 Abovee 的清單補齊了；
// 床位那一層 2026-09-08 拿掉了（ADR-0079、0127）。**正式站從這一份開始**（2026-10-08 她：「正式站從種子開始，我自己重新調」）。

import { DEFAULT_FOLLOWUP_DUE_DAYS, DEFAULT_REPORT_DUE_DAYS } from './followups.js';

/**
 * 種子的一列 → 要寫進主檔的那一份（id 另外給）。
 *
 * **沒寫 `active` 的就是啟用；寫了停用的照寫的**（點滴8、VIP7 是「沒選床位」的那一間，ADR-0127）。
 * 載入種子（`data/config.js` 的 `loadSeed()`）與資料健檢「建起來」的那幾列都走這一支 ——
 * 各自寫一份 `{ ...data, active: true }` 的話，種子上停用的那兩間一載入就又選得到了。
 */
export const seedData = ({ id, ...data }) => ({ active: true, ...data });

export const SEED = {
  // 空間。**2026-09-08 她重畫過一次**，三種類型、都沒有 4 號：
  //
  //   治療室  治2 治3 治5 治7 治8        （治7 2026-10-05 回來了，見下面）
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
  // **2026-10-06：補治6、VIP1；點滴8A／8B、VIP7A／7B 是四間各自的診間**（ADR-0127）。她：
  //「點滴室8床A* 點滴室8床B* 休息室7床A*休息室7床B 幫我算不同的診間可以記.8A .8B vip7A vip7B」。
  // 排得到的一共 22 間，跟 Abovee 的診間清單一樣（治療室 6、點滴室 9、休息室 7）。
  //
  // **這不是把床位那一層加回來**：Abovee 的診間下拉裡本來就沒有單獨的「點滴室8」，只有床 A、床 B ——
  // 那四個本來就是四間。時段上的 `bed` 照舊不寫（ADR-0079），一間照舊一個人（8A、8B 都沒填 `capacity`）。
  //
  // **點滴8 與 VIP7 留在這裡、停用（`active: false`）**：它們是「沒選床位」的那一間。她：
  //「可舊來訪以及abovee辨識可以不選床位，沒選床位就寫.8，VIP7等等不要留空」。所以新排的選不到它
  // （`roomSlots()` 不列停用的），但舊來訪照樣印得出 `.8`、拍 Abovee 那一格沒寫床時認得到它
  // （`abovee.js` 的 `roomByText()`）、舊行事曆只寫 `.8` 的那幾段匯進來也對得到。
  // 她想讓它重新選得到，在 設定 → 診間 把它啟用就好。
  //
  // 2026-08-19 她確認過「治7、治9、治10、點滴2、點滴8、ILIB4 也都還在」，
  // 2026-09-08 這一輪把治7／治9／治10／ILIB4 拿掉了（ILIB4 有個 4）。
  // **2026-10-05 治7 回來了**（ADR-0124，她：「加回去」）：Abovee 上 EECP60 有 10 筆排在
  // 治療室7（6/23～10/29），那兩台機器真的在那一間。治9／治10／ILIB4 照舊不在。
  // **既有資料庫不會自己跟上**（`loadSeed()` 只建不覆蓋），那一步由資料健檢
  // 的「診間清單跟建議的不一樣」負責 —— 9/08 照建議刪掉治7 的那一份，那一列會請她還原。
  rooms: [
    { id: 'room-t2', name: '治2', type: '治療室' },
    { id: 'room-t3', name: '治3', type: '治療室' },
    { id: 'room-t5', name: '治5', type: '治療室' },
    { id: 'room-t6', name: '治6', type: '治療室' },
    { id: 'room-t7', name: '治7', type: '治療室' },
    { id: 'room-t8', name: '治8', type: '治療室' },
    { id: 'room-iv2', name: '點滴2', type: '點滴室', shortName: '.2' },
    { id: 'room-iv3', name: '點滴3', type: '點滴室', shortName: '.3' },
    { id: 'room-iv5', name: '點滴5', type: '點滴室', shortName: '.5' },
    { id: 'room-iv6', name: '點滴6', type: '點滴室', shortName: '.6' },
    { id: 'room-iv7', name: '點滴7', type: '點滴室', shortName: '.7' },
    // **沒選床位的那一間，停用**（2026-10-06，ADR-0127，見上面）。`capacity: 2` 留著（ADR-0094）：
    // 舊來訪裡同一個時間兩位都記在「點滴8」的不算撞 —— 她 2026-09-16 那一句「都寫 .8」的那幾筆。
    { id: 'room-iv8', name: '點滴8', type: '點滴室', shortName: '.8', capacity: 2, active: false },
    { id: 'room-iv8a', name: '點滴8A', type: '點滴室', shortName: '.8A' },
    { id: 'room-iv8b', name: '點滴8B', type: '點滴室', shortName: '.8B' },
    { id: 'room-iv9', name: '點滴9', type: '點滴室', shortName: '.9' },
    { id: 'room-iv10', name: '點滴10', type: '點滴室', shortName: '.10' },
    { id: 'room-vip1', name: 'VIP1', type: 'VIP室', shortName: 'vip1' },
    { id: 'room-vip2', name: 'VIP2', type: 'VIP室', shortName: 'vip2' },
    { id: 'room-vip3', name: 'VIP3', type: 'VIP室', shortName: 'vip3' },
    { id: 'room-vip5', name: 'VIP5', type: 'VIP室', shortName: 'vip5' },
    { id: 'room-vip6', name: 'VIP6', type: 'VIP室', shortName: 'vip6' },
    // 同點滴8：沒選床位的那一間，停用
    { id: 'room-vip7', name: 'VIP7', type: 'VIP室', shortName: 'vip7', active: false },
    { id: 'room-vip7a', name: 'VIP7A', type: 'VIP室', shortName: 'vip7A' },
    { id: 'room-vip7b', name: 'VIP7B', type: 'VIP室', shortName: 'vip7B' },
  ],

  // 2026-08-19 從她的行事曆與口述補齊。
  //
  // 醫師（夏、許、李）2026-08-20 加進來 —— 約二返時要選醫師，
  // 所以他們現在也會被指派到時段上。這推翻了 SPEC 第 12 節原本那句
  // 「醫師不放進 config/staff」，見 docs/adr/0026-doctors-are-assignable-staff.md。
  // 這裡只放她口述的叫法（醫師的姓、治療師的名字）。**全名不進 repo**：2026-10-09 起顯示名是全名、
  // 這裡的名字變成那一位的簡寫，全名跟著合併檔 v6 進來（ADR-0141）—— 不要在這裡補全名。
  //
  // **2026-10-06 補到跟 Abovee 的服務資源清單一樣**（治療師 13 位、醫師 8 位）。她：
  // 「醫師也可以都補上去，也幫我把李夏許的名子補齊全，或是補在abovee的寫法那邊」「同意公開」。
  //
  // **全名照舊不寫在這裡**（真名不進 repo），而且不用寫：拍 Abovee 認人（`abovee.js` 的 `staffFrom()`）
  // 靠的是「治療師的簡寫是全名的結尾、醫師的簡寫是全名的開頭」—— 治療師放不含姓的名字、醫師放姓就認得。
  // 合併檔輸出的照舊是這裡的名字；app 匯入時名字對不到會再比簡寫（`mergeImport.js` 的 `staffByName()`），
  // 所以她把顯示名改成全名之後照樣對得到（10/6 那一句「全名填在 Abovee 上的寫法、顯示名不要改」被 ADR-0141 推翻了）。
  //
  // **兩位張不是「張」**：同名存不下去，而且姓氏規則兩位都符合就誰都不是。用「姓＋名字的第一個字」，
  // 全名各自只對到一位（比只有姓多一個字，她同意）。
  //
  // **科別（`specialties`，ADR-0120）照 Abovee 5～10 月那 353 筆實際排的填**：二返全是夏、許、李；
  // 功醫門診是夏、李與兩位張；復健門診與羊膜全是宋；心臟門診全是簡。**林一筆都沒有，所以不填** ——
  // 她：「無法判斷的就先放入都可以」：沒有科別的醫師每一門要醫師的課都選得到（排在「其他醫師」後面），
  // 四科都勾給他的話復健科與心臟科變成兩位，「那一科剛好一位就先選好」就不成立了。
  //
  // 既有資料庫由資料健檢的「治療師與醫師少了幾位」建起來、「主檔有幾格還沒跟上」補科別。
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
    { id: 'staff-pr', name: '佩茹', role: '物理治療師' },
    { id: 'staff-yr', name: '瑜如', role: '物理治療師' },
    { id: 'staff-yz', name: '郁真', role: '物理治療師' },
    { id: 'staff-yl', name: '依琳', role: '物理治療師' },
    { id: 'staff-dr-xia', name: '夏', role: '醫師', specialties: ['功能／二返'] },
    { id: 'staff-dr-xu', name: '許', role: '醫師', specialties: ['功能／二返'] },
    { id: 'staff-dr-li', name: '李', role: '醫師', specialties: ['功能／二返'] },
    { id: 'staff-dr-song', name: '宋', role: '醫師', specialties: ['復健科'] },
    { id: 'staff-dr-jian', name: '簡', role: '醫師', specialties: ['心臟科'] },
    { id: 'staff-dr-zhang-ya', name: '張雅', role: '醫師', specialties: ['功能／二返'] },
    { id: 'staff-dr-zhang-zheng', name: '張正', role: '醫師', specialties: ['功能／二返'] },
    { id: 'staff-dr-lin', name: '林', role: '醫師' },
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
    // （「一般」那一種名字 2026-09-08 拿掉了，不會再印成 `ILIB(IL)`。）
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
  //
  // **2026-10-05 補到跟 Abovee 一樣**（abovee-and-master/12）：Abovee 的營養點滴那一類有 13 款，
  // 這裡原本 7 款（其中 NAC 愛咳痰 Abovee 沒有，她自己的，留著）→ 補 7 款，一共 14。
  // 名字跟 Abovee 一字不差，所以不用另外填 `aboveeNames`（`courseFrom()` 先比名字）。
  // 既有資料庫由資料健檢的「營養點滴品項少了幾款」補。
  ivProducts: [
    { id: 'iv-heart', name: '護心抗老', durationMin: 180 },
    { id: 'iv-liver', name: '護肝排毒' },
    { id: 'iv-gut', name: '腸道修復' },
    { id: 'iv-sulic', name: '速利清' },
    { id: 'iv-mengjian', name: '猛健樂' },
    { id: 'iv-nac', name: 'NAC 愛咳痰' },
    // Abovee 寫「亮采」（她 2026-10-05：不改名，記住那個寫法）
    { id: 'iv-snow', name: '雪顏亮彩', aboveeNames: ['雪顏亮采'] },
    { id: 'iv-vitality', name: '元氣活力' },
    { id: 'iv-immune', name: '免疫馥活' },
    { id: 'iv-slim', name: '減脂健康' },
    { id: 'iv-guard', name: '營養守護' },
    { id: 'iv-heal', name: '癒原養方' },
    { id: 'iv-sleep', name: '養心舒眠' },
    // 一針，不是兩小時的點滴。她 2026-10-05 說她也還不確定、先給 30 分、要改得動
    // —— 設定 → 營養點滴品項 那一格本來就改得動（ADR-0098）。
    { id: 'iv-shingles', name: '皮蛇疫苗', durationMin: 30 },
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
  //   醫師        門診類（課程自己選哪一科，`doctorPick`，ADR-0120；沒選過的 A 類一律選得到）
  //   都不用      體適能、身體組成分析、營養諮詢、健檢、門診（含功醫門診、羊膜）
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
  // `category` 留著當沒勾過的課程的退路。**唯一的例外是 HRV**：`systems: []` ＝不用壓（ADR-0126），
  // 四種類別沒有一種推得出它。
  //
  // **`aboveeNames` 是 Abovee 課程那一格怎麼寫它**（abovee-and-master/07）。名字跟 Abovee 一樣的
  // （二返、EECP）也填：她之後改名，拍 Abovee 照樣認得。
  courses: [
    // ---- A 類：三系統＋電話 ----
    {
      id: 'course-rehab', name: '復健科醫師門診', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['復健門診'],
      // 門診要的是**醫師，不是空間**（她 2026-09-08）。選不選得到醫師看 `doctorPick`
      // （`picksDoctor()`），所以這裡什麼都不用指派。
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      // 指定一科是**排序不是限制**（ADR-0120）：那一科的醫師排前面。種子上復健科只有一位，
      // 所以新的一段會先幫她選好（`doctorChoicesFor()` 的 `preselect`）。
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
      // 要醫師、哪一科讀 `doctorPick`（ADR-0120）；`requiresDoctor` 存檔時跟著寫，讀的那一側只認 `doctorRuleOf()`。
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
    {
      // **功醫門診**（2026-10-05）。她：「跟二返不同；不算次數、不簽療程單、不寫紀錄；
      // 三個系統都要壓；要選醫師」。行事曆上她寫 HRV 的那幾次就是它（HRV 是自律神經檢查，
      // 後面那一場讓醫師講解報告的門診才是這一段）。
      //
      // **不算次數**（ADR-0121）：排的時候不用額度，客戶身上的數字一格都不會動。
      // 加購那一排不列它；她之後要讓別門課也這樣，自己在設定勾。
      id: 'course-fm', name: '功醫門診', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['功醫門診'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, doctorPick: '功能／二返', frequencyRule: null,
      uncounted: true,
      needsTreatmentForm: false,
    },
    {
      // **HRV**（2026-10-06）。她：「HRV也是不算次數的，通常會是我想邀客戶來體驗送的，
      // 就會讓他當天做完HRV後然後接著功醫門診聽報告」「目前先皆不用壓，不用指派診間或人員」。
      //
      // - **不用壓**（`systems: []`，ADR-0126）：Abovee 上沒有這門課。存檔前不問壓好了嗎、取消不長「取消 Abovee」
      // - **不算次數**（ADR-0121）、不簽療程單（沒有次數可以扣，同功醫門診）、不寫紀錄
      // - `lineName`：她 10/5 自己的說法「HRV＝自律神經檢查」。不填的話貼給客人的那一句印三個字母，
      //   而 ILIB 當初就是為了「客人看不懂」才有這一格
      // - 排在功醫門診**後面**：沒有額度的客戶新增時第一段預設是第一門不算次數的課，照舊是功醫門診
      //
      // 行事曆上她寫 `HRV` 的那幾次在合併檔裡是功醫門診（`merge.mjs` 的 `TOKENS`）—— 那一條這裡不動。
      id: 'course-hrv', name: 'HRV', group: '醫師門診', lineName: '自律神經檢查', category: null,
      systems: [], durationMin: 30,
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      uncounted: true,
      needsTreatmentForm: false,
      provisional: true,
    },
    {
      // **羊膜**（2026-10-05）。她：「加購（有次數，像營養針）；選復健科醫師（只有一位）；
      // 要簽療程單」。有次數所以加購那一排有它。
      //
      // **壓哪幾個系統、要不要寫紀錄跟營養點滴一樣**（她 2026-10-06：「先預設和營養針一樣，
      // 然後是預設選復建科醫師」）：只壓 Abovee、確認後不長 Examine／耀聖、不寫紀錄。
      // 所以類別是 C、不是這一段其他門診的 A —— 分類照舊是醫師門診（那只管設定頁怎麼排），
      // 醫師那一排靠 `doctorPick`，不靠 A 類；`requiresDoctor` 是設定頁存檔時跟著寫的那一格
      // （不是 A 類的課少了它，沒有 `doctorPick` 的退路會說「不用醫師」）。設定 → 課程 改得動。
      id: 'course-amnion', name: '羊膜', group: '醫師門診', category: 'C',
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['羊膜'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, requiresDoctor: true, doctorPick: '復健科', frequencyRule: null,
    },

    // ---- 2026-10-06 補的：她清單上有、種子沒有的那幾門。**每一格都是暫定的** ----
    //
    // 她：「基本上我已經給你完整的課程項目清單了，很少會變，所以希望你幫我把我給你的清單項目的內容
    // 都補上去，然後可以標記我還沒決定壓那些阿之類的」。Abovee 5～10 月那 353 筆裡這幾門一筆都沒有，
    // 所以下面每一格是照同一類的課猜的、她同意過那張表（`.scratch/course-form-and-sheet-2026-10-06/spec.md`）。
    // `provisional: true` 只在 設定 → 課程 畫一個「設定暫定」的小標，**沒有任何規則讀它**（`isProvisional()`）。
    //
    // 都**算次數**（要加購才排得進去）是刻意的：不算次數的課會出現在每一位客戶的「做什麼」那一排，
    // 而她的抱怨正是「好多課程然後都滑不到想要的」。
    {
      // 照同一組的門診：三個系統都壓、功能／二返那一科的醫師
      id: 'course-retest', name: '回測報告', group: '醫師門診', category: 'A',
      systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30, aboveeNames: ['回測報告'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, doctorPick: '功能／二返', frequencyRule: null,
      provisional: true,
    },
    {
      // HA-PRP、PRP 照羊膜那一門抄：只壓 Abovee、復健科醫師、要簽療程單。
      // 不是 A 類又要醫師，所以帶 `requiresDoctor`（理由見羊膜那一段）
      id: 'course-ha-prp', name: 'HA-PRP', group: '醫師門診', category: 'C',
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['HA-PRP'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, requiresDoctor: true, doctorPick: '復健科', frequencyRule: null,
      provisional: true,
    },
    {
      id: 'course-prp', name: 'PRP', group: '醫師門診', category: 'C',
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['PRP'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, requiresDoctor: true, doctorPick: '復健科', frequencyRule: null,
      provisional: true,
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
      // SPEC 第 7 節規則 2：EECP 只能在治5、治7、治8（治7 是 2026-10-05 加回來的，
      // ADR-0124 —— Abovee 上 EECP60 有 10 筆在那一間）。
      // `preferredRoomIds` 跟它**同時填著**是刻意的（2026-09-08）：
      // 限制是硬的、順序是軟的，她之後在設定裡放寬限制時順序還在。
      //
      // **2026-09-16 從 30 分改成 60 分。** 她：「體驗30正式課60」。
      // 2026-09-16 早上那個 30 是暫定值（「這個先保留先當作30分鐘」），
      // 而她當天稍晚給了真正的答案 —— 30 分那一種是底下那一門體驗課。
      id: 'course-eecp', name: 'EECP', group: 'EECP', category: 'C',
      systems: ['Abovee'], durationMin: 60, aboveeNames: ['EECP'],
      assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t7', 'room-t8'],
      preferredRoomIds: ['room-t5', 'room-t7', 'room-t8'],
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
      // 同一批機器，所以限制與順序跟正式課一模一樣。
      //
      // **2026-10-05 從 30 分改成 20 分**：Abovee 上這門課就叫 `EECP20`
      //（她：「EECP20 就是 EECP 體驗」）。9/16 她說的是 30；Abovee 上實際排的是 20，
      // 而她這一輪定的是「時間跟 Abovee 不一樣時以 Abovee 為準」。
      id: 'course-eecp-trial', name: 'EECP體驗', group: 'EECP', category: 'C',
      // Abovee 寫 `EECP20`（她 2026-10-05：「EECP20 就是 EECP 體驗」）。整格比對、在拆分鐘之前 ——
      // 拆了就是「EECP＋20 分」，認成正式課（`abovee.js` 的 `courseFrom()`）
      systems: ['Abovee'], durationMin: 20, aboveeNames: ['EECP20'],
      assigns: 'room', allowedRoomTypes: [], allowedRoomIds: ['room-t5', 'room-t7', 'room-t8'],
      preferredRoomIds: ['room-t5', 'room-t7', 'room-t8'],
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

    // ---- 不產生任務：這六項不需要掛號，是刻意的不是漏填 ----
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
    // 運動區的另外兩門（2026-10-06，暫定，見上面「2026-10-06 補的」那一段）：照同一組，只壓 Abovee、都不用指派
    {
      id: 'course-moti', name: 'MOTI', group: '運動區', category: null,
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['MOTI'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      provisional: true,
    },
    {
      id: 'course-exercise', name: '運動', group: '運動區', category: null,
      systems: ['Abovee'], durationMin: 30, aboveeNames: ['運動'],
      assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
      requiresEquipment: false, frequencyRule: null,
      provisional: true,
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
