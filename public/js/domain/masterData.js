// 主檔的型別與驗證。純函式。
//
// 前端擋一次、Firestore Rules 再擋一次，這裡是前端這一次。
// 驗證失敗回傳訊息陣列，空陣列代表可以存。

import { ALERT_COLORS, ALERT_FILLS } from './clinicalFlags.js';

/**
 * 空間有三種。**2026-09-08 她重畫過一次**：
 *
 *   治療室  治2 治3 治5 治7 治8        （治7 2026-10-05 回來了，ADR-0124）
 *   點滴室  點滴2 3 5 6 7 8 9 10
 *   VIP室   VIP2 3 5 6 7
 *
 * **都沒有 4 號**，而簡寫裡的數字就是房號（`.2`、`vip2`、`治2`）。
 *
 * `ILIB室` 拿掉了：唯一那一間是 `ILIB4`，它有個 4；而 ILIB 這個課程本來就
 * 排在點滴室與治療室（她給的優先順序是 `.10、治2、治3`）。既有來訪還指著
 * 那一間 —— 刪掉它是資料健檢那一列的事，不是這裡的事。
 */
export const ROOM_TYPES = ['治療室', '點滴室', 'VIP室'];

/**
 * `config/staff` 上的角色。
 *
 * 護理師目前不納入排程（營養點滴不需要指定護理師），所以只有兩種。
 *
 * **醫師和物理治療師是兩種人，不是同一份名單的兩個標籤**（CONTEXT.md）——
 * 復能三器材要的是物理治療師，選錯人是實際傷害。所以要拿某一種角色的名單時
 * 一律走 staffWithRole()，不要直接 filter 整份 staff。見
 * docs/adr/0026-doctors-are-assignable-staff.md
 */
export const THERAPIST_ROLE = '物理治療師';
export const DOCTOR_ROLE = '醫師';
export const STAFF_ROLES = [THERAPIST_ROLE, DOCTOR_ROLE];

/**
 * 某一種角色、還在用的人。
 *
 * 只有這一支可以決定「哪些人進得了那個選單」—— 治療師的選單跑出三位醫師來，
 * 她要點到第三個字才會發現點錯人。
 *
 * @param {object[]} staff config/staff 全部
 * @param {string} role THERAPIST_ROLE 或 DOCTOR_ROLE
 */
export function staffWithRole(staff = [], role) {
  return staff.filter((s) => !s.deletedAt && s.active !== false && s.role === role);
}

/**
 * 醫師的科別（2026-10-05，ADR-0120）。她的原話：
 *
 * > 四、醫師要分科：功能／二返、泌尿科、心臟科、復健科。
 *
 * **科別不是一份新的主檔** —— 醫師身上一格字串陣列（`specialties`），名單＝
 * 這四科＋大家身上已經有的字（`specialtyNames()`）。物理治療師沒有這一格。
 */
export const DEFAULT_SPECIALTIES = Object.freeze(['功能／二返', '泌尿科', '心臟科', '復健科']);

/** 科別那一排丸子：預設四科＋醫師身上已經有的字（照主檔上第一次出現的順序）。 */
export function specialtyNames(staff = []) {
  const out = [...DEFAULT_SPECIALTIES];
  for (const s of staff ?? []) {
    if (!s || s.deletedAt) continue;
    for (const raw of s.specialties ?? []) {
      const name = String(raw ?? '').trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** 課程上那一格（`doctorPick`）的兩個固定答案；其餘的字就是「指定這一科」。 */
export const DOCTOR_NONE = 'none';
export const DOCTOR_ANY = 'any';

/**
 * 這門課要不要醫師、要哪一科：`'none'`／`'any'`／某一科的字。**唯一一支。**
 *
 * - 她在設定選過（`course.doctorPick`）→ 照選的
 * - **沒選過 → 照 ADR-0058**：A 類（門診）一律選得到，其餘看 `requiresDoctor` 旗標。
 *   讀的時候退回，既有資料一筆都不搬
 *
 * ADR-0058 那一條留著的理由沒有變：她的原話是「門診類的可以選醫生，復能類的選
 * 物理治療師」，而以前只看旗標時復健科醫師門診與心臟科評估選不到醫師 ——
 * 把一條已經知道的規則交給她逐課程補勾。
 *
 * 醫師走的是 `requiresEquipment`／`requiresIvProduct` 那條路（課程上一格、時段上
 * 一個 id），不是 `assigns` —— `assigns` 是單選的，而二返同時要診間和醫師。
 * 見 docs/adr/0026、0058、0120。
 */
export function doctorRuleOf(course) {
  const pick = typeof course?.doctorPick === 'string' ? course.doctorPick.trim() : '';
  if (pick) return pick;
  return course?.category === 'A' || Boolean(course?.requiresDoctor) ? DOCTOR_ANY : DOCTOR_NONE;
}

/**
 * 這個課程排班時選不選得到醫師。
 *
 * **選不選得到 ≠ 一定要選。** 沒選也存得下去，`validateVisit()` 給的是
 * warning 不是 error（ADR-0002：app 記錄決定，不做決定）。
 */
export const picksDoctor = (course) => doctorRuleOf(course) !== DOCTOR_NONE;

/**
 * 醫師那一排怎麼排。**壓表、來訪編輯器、拍 Abovee 三個入口共用**（ADR-0120）——
 * 各排一次的話，同一門課在兩個畫面上第一顆丸子不一樣，她不會知道哪個算數。
 *
 * **這是排序不是限制**（同常用診間，`orderedRoomsForCourse()`）：指定了一科，
 * 那一科的醫師排前面（`first`），其餘收在「其他醫師」後面（`others`），照樣選得到 ——
 * 代診是真的會發生的事。
 *
 * - **那一科剛好一位 → `preselect` 是他**（羊膜只有一位復健科醫師）。只有一個正確答案
 *   的時候讓她多點一下沒有換到任何資訊。**呼叫端只在新的一段、還沒選醫師時套**
 * - 那一科兩位以上、「哪一科都可以」：不預選
 * - **那一科一位都沒有 → 退回全部列出來**。她還沒替醫師填科別之前，每一門課都要照樣
 *   選得到人；那時候畫面跟 2026-10-05 之前長得一模一樣
 *
 * 只列得出醫師（`staffWithRole()`）—— 治療師與醫師是兩種人。
 *
 * @returns {{first: object[], others: object[], preselect: string|null}}
 */
export function doctorChoicesFor(course, staff = []) {
  const rule = doctorRuleOf(course);
  if (rule === DOCTOR_NONE) return { first: [], others: [], preselect: null };

  const doctors = staffWithRole(staff ?? [], DOCTOR_ROLE);
  const mine = rule === DOCTOR_ANY
    ? []
    : doctors.filter((d) => (d.specialties ?? []).includes(rule));
  if (!mine.length) return { first: doctors, others: [], preselect: null };

  return {
    first: mine,
    others: doctors.filter((d) => !mine.includes(d)),
    preselect: mine.length === 1 ? mine[0].id : null,
  };
}

/**
 * 這門課**不算次數**嗎（2026-10-05，ADR-0121）。她的原話：
 *
 * > 五、不算次數的課：功醫門診不扣額度，現在排不進去。
 * > 3. 這一輪只勾功醫門診。其他的我之後在設定自己勾「不算次數」就好。
 *
 * 意思是**不用加購就排得進去，排了也不扣任何次數** —— 不是「不准有額度」：
 * 她之後會自己勾別的課（例如營養諮詢），而既有客戶身上有那門課的額度、方案範本裡也有它。
 * 選了那一筆額度排的照舊扣；選「不扣次數」那一顆排的，時段的 `entitlementId` 是 null
 * （同 n返，ADR-0063）。
 *
 * 只認 `true`：存成字串的話 `Boolean('false')` 會判成不算次數，而她明明關掉了。
 */
export const isUncounted = (course) => course?.uncounted === true;

/**
 * 這門課的設定**是暫定的**嗎（2026-10-06）。她的原話：
 *
 * > …希望你幫我把我給你的清單項目的內容都補上去，然後可以標記我還沒決定壓那些阿之類的
 *
 * 種子補的那幾門（回測報告、HA-PRP、PRP、MOTI、運動、HRV）Abovee 上一筆都沒排過，
 * 每一格都是猜的。這一格**只畫一個小標**（設定 → 課程）：提醒她這門課還沒看過。
 *
 * **沒有任何規則讀它** —— 排得進去、扣得到、長得出待辦，跟沒有這一格一模一樣
 *（`tests/provisional-courses.test.js` 掃原始碼）。字是「設定暫定」，不是「待確認」（那是來訪的狀態）。
 * 只認 `true`，同 `isUncounted()`。
 */
export const isProvisional = (course) => course?.provisional === true;

/** 主檔裡不算次數、還在用的課。「這一段可以做什麼」那一排上每一門一顆（`slotOptions.js`）。 */
export function uncountedCourses(courses = []) {
  return (courses ?? []).filter((c) => c && !c.deletedAt && c.active !== false && isUncounted(c));
}

// 課程要指派什麼。復能三器材選治療師，其餘含 ILIB 選診間，心臟科評估都不用。
export const ASSIGNS = ['therapist', 'room', 'none'];

/**
 * 外面那三個系統。課程自己勾動到哪幾個（`course.systems`，ADR-0119）。
 *
 * **只有名單在這裡。** 勾了之後壓表在哪、客人確認之後長哪幾張，推導只在
 * `domain/taskRules.js`（`systemsOf()`、`bookingSystemOf()`、`tasksForCourse()`）。
 * 三個都不勾（`systems: []`）＝這門課不用壓（ADR-0126）；沒有那一格是沒勾過，照類別推。
 * 名單住在這一支是因為主檔的驗證要認得它，而 `taskRules.js` 經 `visits.js` 讀這一支 ——
 * 反過來 import 會繞成一圈。
 */
export const SYSTEMS = Object.freeze(['Abovee', 'Examine', '耀聖']);

/** 壓表可以壓在哪。**照這個順序挑**：勾了 Abovee 就是 Abovee，沒勾才看 Examine。 */
export const BOOKING_SYSTEMS = Object.freeze(['Abovee', 'Examine']);

export const ASSIGN_LABELS = {
  therapist: '選治療師',
  room: '選診間',
  none: '都不用',
};

/**
 * 課程的分類（2026-10-05）。她的原話：
 *
 * > 設定 → 課程 要先分類再項目。
 * > 分類：復能、ILIB、醫師門診、EECP、運動區、營養點滴
 * > 5. 健檢自己一組「健檢」。物理治療師諮詢先放「其他」
 *
 * **分類只管兩件事**：設定 → 課程 那一頁怎麼分組、新增時帶哪一組預設值
 * （`courseDefaultsFor()`）。**沒有任何規則讀它** —— 待辦、次數、指派、加購
 * 一個都不看，所以改分類碰不到任何資料的意思（`tests/course-groups.test.js`
 * 掃原始碼盯著）。
 *
 * **它不是一份新的主檔**：課程身上一格字串（`group`），她打一個新的字就是
 * 新的一組。不開集合、不動 Rules、不動備份。
 *
 * SIS／IN／高能量在她嘴裡是「復能底下的項目」，在 app 裡是**器材**不是課程
 * （ADR-0075：三選一是一筆額度、共用一份次數）—— 所以「先分類再項目」畫出來是
 * 分類 → 課程 → 它的器材或品項（`coursesByGroup()`）。
 */
export const COURSE_GROUPS = ['復能', 'ILIB', '醫師門診', 'EECP', '運動區', '營養點滴', '健檢'];

/** 沒有填分類的課程落在這裡。**存的是空的，不是這兩個字** —— 一種東西一種寫法。 */
export const OTHER_GROUP = '其他';

/** 要存進 `group` 的那個值：去空白；空的與「其他」都是 `null`。 */
export function normalizeGroup(raw) {
  const name = String(raw ?? '').trim();
  return !name || name === OTHER_GROUP ? null : name;
}

/** 這門課在哪一組。沒有那一格、空白都是「其他」（既有資料一筆都不用搬）。 */
export const groupOf = (course) => normalizeGroup(course?.group) ?? OTHER_GROUP;

/**
 * 分類那一排丸子：預設的那幾組 → 她自己打過的（照主檔上第一次出現的順序）→「其他」。
 *
 * 她自己打的排在「其他」前面：那是她特地取的名字，而「其他」是沒有名字的那一堆。
 */
export function courseGroupNames(courses = []) {
  const custom = [];
  for (const c of courses ?? []) {
    if (!c || c.deletedAt) continue;
    const g = groupOf(c);
    if (g !== OTHER_GROUP && !COURSE_GROUPS.includes(g) && !custom.includes(g)) custom.push(g);
  }
  return [...COURSE_GROUPS, ...custom, OTHER_GROUP];
}

/**
 * 設定 → 課程 那一頁的形狀：分類 → 課程 → 它的器材或品項。
 *
 * **照資料畫，不寫死名字**：
 *
 * - 哪一台器材列在哪一門課底下看 `equipment.courseId`（ADR-0075）。**不看
 *   `requiresEquipment`** —— ILIB 這門課不是擇一池，但 ILIB 那一台指著它，
 *   所以那一台出現在「ILIB」那一組，不是復能
 * - 品項列在要選品項的課底下（`requiresIvProduct`）
 *
 * 沒有課程的那幾組不回（清單上一個空的小標題跟壞掉長得一樣）。停用的照樣列 ——
 * 跟其他主檔清單同一條：清單上看得到、標「已停用」。
 *
 * @returns {{group: string, courses: {course: object, equipment: object[],
 *            ivProducts: object[]}[]}[]}
 */
export function coursesByGroup({ courses = [], equipment = [], ivProducts = [] } = {}) {
  const alive = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt);
  const list = alive(courses);
  const products = alive(ivProducts);
  return courseGroupNames(list)
    .map((group) => ({
      group,
      courses: list.filter((c) => groupOf(c) === group).map((course) => ({
        course,
        equipment: alive(equipment).filter((e) => e.courseId === course.id),
        ivProducts: course.requiresIvProduct ? products : [],
      })),
    }))
    .filter((g) => g.courses.length);
}

/**
 * 每一組新增時帶進表單的預設值。**只在建立那一刻抄一次** —— 之後每一格照樣自己改，
 * 改分類也不會回頭重套（她改過的不可以被一顆丸子蓋掉）。
 *
 * 值照現在種子裡同一組的課程寫：她新增一門「醫師門診」時要的就是跟復健科醫師門診
 * 一樣的起點。她自己打的新分類沒有預設（不知道那是什麼）。
 */
const GROUP_DEFAULTS = Object.freeze({
  復能: {
    durationMin: 60, category: 'C', systems: ['Abovee'], assigns: 'therapist', allowedRoomTypes: [],
  },
  ILIB: {
    durationMin: 60, category: 'C', systems: ['Abovee'],
    assigns: 'room', allowedRoomTypes: ['治療室', '點滴室'],
  },
  // 門診要的是醫師不是空間（她 2026-09-08）；三個系統都要（Abovee 壓，確認後 Examine、耀聖）
  醫師門診: {
    durationMin: 30, category: 'A', systems: ['Abovee', 'Examine', '耀聖'],
    assigns: 'none', allowedRoomTypes: [], requiresDoctor: true, doctorPick: DOCTOR_ANY,
  },
  EECP: {
    durationMin: 60, category: 'C', systems: ['Abovee'], assigns: 'room', allowedRoomTypes: ['治療室'],
  },
  運動區: {
    durationMin: 30, category: null, systems: ['Abovee'], assigns: 'none', allowedRoomTypes: [],
  },
  營養點滴: {
    durationMin: 120, category: 'C', systems: ['Abovee'], assigns: 'room', allowedRoomTypes: ['點滴室'],
  },
  // 健檢直接壓在 Examine
  健檢: {
    durationMin: 120, category: 'B', systems: ['Examine'], assigns: 'none', allowedRoomTypes: [],
  },
});

/**
 * 新增一門課、先點了某一組：要蓋到空白表單上的那幾格。
 *
 * 回的是**新的一份**（陣列也是），呼叫端改它不會改到常數。
 *
 * @param {string|null} group 她點的那一顆；「其他」與空的都存成 `null`
 */
export function courseDefaultsFor(group) {
  const stored = normalizeGroup(group);
  return { ...structuredClone(GROUP_DEFAULTS[stored] ?? {}), group: stored };
}

export const MASTER_TYPES = [
  'rooms',
  'staff',
  'equipment',
  'clinicalFlags',
  'partners',
  'ivProducts',
  'products',
  'courses',
  'plans',
];

export const MASTER_LABELS = {
  rooms: '診間',
  partners: '合作機構',
  staff: '治療師與醫師',
  equipment: '器材',
  clinicalFlags: '警示',
  ivProducts: '營養點滴品項',
  products: '營養品',
  courses: '課程',
  plans: '方案範本',
};

/**
 * 警示的名單。**永久限制的第一層**，見 ADR-0074。
 *
 * 它什麼都不擋 —— 它只是要在她壓表的那一刻被看到，那一下她要把這件事抄進
 * Abovee 的註記欄。2026-09-06 之前這一層叫「臨床提醒」，上面還有一層
 * 「醫療禁忌」會硬性擋掉器材；不擋之後兩層合併成這一份。
 *
 * 為什麼是主檔而不是寫死：她手上的筆記裡至少已經有兩個（血管難打、第一針），
 * 而下一個一定還會有。設定頁的第一句話就是「診間與治療師都在這裡自己加，
 * 沒有寫死在程式碼裡」。
 *
 * 為什麼不從器材主檔推出來：器材上那幾個字只回答「選了那一台要不要提醒」，
 * 而這一份要收得下「怕痛」這種跟器材無關的。**器材上有、這一份沒有的字**
 * 由資料健檢列出來，按一下補進來。
 *
 * 擺在 `staffWithRole()` 旁邊是因為兩支問的是同一句話：
 * **從主檔拿出一份可以點的名單。**
 *
 * @param {{name?: string, active?: boolean, deletedAt?: any}[]} rows config/clinicalFlags
 * @returns {string[]} 還在用的那幾個字，維持主檔上的順序
 */
export function clinicalTerms(rows = []) {
  return aliveNames(rows);
}

/**
 * 合作機構的名單（ADR-0076）。跟 `clinicalTerms()` 問的是同一句話：
 * **從主檔拿出一份可以點的名單**，所以它們住在一起、共用同一支身體。
 *
 * 客戶身上存的是**字串不是 id**（同永久限制），所以主檔改名不會搬既有客戶
 * —— 那是刻意的，改名的人要自己回去重選。
 */
export function partnerNames(rows = []) {
  return aliveNames(rows);
}

/** 還在用的那幾筆的名字，維持主檔上的順序。 */
function aliveNames(rows = []) {
  return (rows ?? [])
    .filter((r) => r && !r.deletedAt && r.active !== false)
    .map((r) => String(r.name ?? '').trim())
    .filter(Boolean);
}

/**
 * 排這一段的時候，營養點滴的品項給她哪幾顆可以選。
 *
 * 2026-09-04 她問的：
 *
 * > 我營養點滴如果一開始加購的是 A，但是我排來訪的時候，選營養點滴還能排到
 * > 其他 BCD？這不太對吧。
 *
 * 品項是**購買的時候就定下來的**（`ui/components/buy.js` 把它存在額度身上，
 * 額度的顯示名稱也已經帶著它：「營養點滴・A」）。所以排班的時候預設就是那一款，
 * 其餘的收在「換一款」後面 —— 不是藏起來，是**排在後面**：
 * 「今天 A 剛好用完，先打了 B」是真的會發生的事，硬擋等於那一筆記不進系統
 *（她 2026-09-04 選的，同 ADR-0002）。真的換了會有一句提醒，
 * 在 `domain/visits.js` 的 `assignmentWarnings()`。
 *
 * **買的那一款就算被停用也要出現。** 那一筆額度上寫的就是它，
 * 看不到的話她會以為資料壞了。
 *
 * 額度上沒有品項的（舊資料、匯入進來的、n返 那種沒有額度的）一律全部列出來。
 *
 * 擺在 `clinicalTerms()` 旁邊，理由一樣：**從主檔拿出一份可以點的名單。**
 *
 * @param {{ivProductId?: string|null}|null} entitlement 這一段用的那筆額度
 * @param {{id: string, name?: string, active?: boolean, deletedAt?: any}[]} ivProducts
 * @returns {{boughtId: string|null, bought: object|null,
 *            primary: object[], others: object[]}}
 */
export function ivChoicesFor(entitlement, ivProducts = []) {
  const alive = (ivProducts ?? []).filter((p) => p && !p.deletedAt);
  const active = alive.filter((p) => p.active !== false);
  const boughtId = entitlement?.ivProductId ?? null;
  const bought = boughtId ? (alive.find((p) => p.id === boughtId) ?? null) : null;

  // 買的那一款在主檔裡整個不見了 —— 講不出它叫什麼，就退回全部列出來。
  if (!bought) return { boughtId, bought: null, primary: active, others: [] };

  return {
    boughtId,
    bought,
    primary: [bought],
    others: active.filter((p) => p.id !== bought.id),
  };
}

const isBlank = (v) => v == null || String(v).trim() === '';

/**
 * 別稱與 LINE 名（`domain/naming.js`）。兩個都選填 —— 空的就退回全名。
 *
 * 上限 12 字跟警示同一個理由：**別稱是給窄的地方用的**，
 * 一個比全名還長的別稱等於那一格白填了。
 */
function nameVariants(r) {
  const errors = [];
  for (const [key, label] of [['shortName', '別稱'], ['lineName', 'LINE 名']]) {
    const v = r[key];
    if (v == null || v === '') continue;
    if (typeof v !== 'string') errors.push(`${label}格式錯誤`);
    else if (v.trim().length > 12) errors.push(`${label}最多 12 字 —— 它是給窄的地方用的`);
  }
  return errors;
}

/**
 * 兩個 Abovee 上的寫法是不是同一個：去空白、全形半形一致、英文不分大小寫。
 * 認人（`domain/identify.js` 的 `normalizeName()`）用的就是這一支。
 */
export function normalizeAlias(raw) {
  return String(raw ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
const sameAlias = (a, b) => Boolean(normalizeAlias(a)) && normalizeAlias(a) === normalizeAlias(b);

/** 這一筆主檔記著這個 Abovee 上的寫法嗎（`aboveeNames`，比法同 `normalizeAlias()`）。 */
export const hasAlias = (record, text) => (record?.aboveeNames ?? []).some((a) => sameAlias(a, text));

/**
 * 「Abovee 上的寫法」那一格（`aboveeNames`）。治療師與醫師（issue 12）、課程、器材、
 * 營養點滴品項、診間（2026-10-05，abovee-and-master/07）都有，驗法同一份。
 * 沒有這一格 = 空的，既有資料一筆都不用搬。
 *
 * **同一種主檔裡兩筆不可以同一個寫法**：拍 Abovee 時那個字會直接認成其中一筆，而那一筆是錯的。
 * 跨種不擋（器材 `ILIB` 與課程 `ILIB` 指的是同一件事）—— 撞到時照 `courseFrom()` 的順序
 * 品項 → 器材 → 課程，越具體越先。
 */
function aliasErrors(r, existing = []) {
  const aliases = r.aboveeNames ?? [];
  if (!Array.isArray(aliases)) return ['Abovee 上的寫法格式錯誤'];
  if (aliases.some(isBlank)) return ['Abovee 上的寫法不可空白'];
  const errors = [];
  for (const alias of aliases) {
    const owner = (existing ?? []).find((e) => e.id !== r.id && !e.deletedAt && hasAlias(e, alias));
    if (owner) errors.push(`Abovee 上的寫法「${alias}」已經是「${owner.name}」的了`);
  }
  return errors;
}

/** 同一份清單裡不可以有兩個同名的（已刪除的不算）。 */
function duplicateName(record, existing) {
  const name = String(record.name ?? '').trim();
  return existing.some(
    (e) => e.id !== record.id && !e.deletedAt && String(e.name ?? '').trim() === name,
  );
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

const validators = {
  /**
   * 診間。**2026-09-08 之後沒有床位這一層了**（她選的：「取消任何床位區分」）。
   *
   * 舊資料上那一格還在（只有點滴8 有 A／B），所以這裡**不驗也不擋** ——
   * 擋下來的話她一進設定頁改個名字就存不回去。清掉既有那幾筆是資料健檢
   * 「來訪上還記著床位」那一列的事。
   */
  rooms(r, { existing = [] } = {}) {
    const errors = [...nameVariants(r), ...aliasErrors(r, existing)];
    if (isBlank(r.name)) errors.push('診間名稱不可空白');
    if (!ROOM_TYPES.includes(r.type)) errors.push('請選擇診間類型');
    // 同一個時間裝得下幾個人（ADR-0094）。**沒填就是 1**，所以空白不是錯誤。
    if (r.capacity != null && !(Number.isInteger(Number(r.capacity)) && Number(r.capacity) > 0)) {
      errors.push('「同時幾位」要是大於 0 的整數');
    }
    return errors;
  },

  staff(r, { existing = [] } = {}) {
    const errors = [];
    // 不寫「治療師姓名」—— 這份清單現在也放醫師，而那兩個詞不可以混用。
    if (isBlank(r.name)) errors.push('姓名不可空白');
    if (!STAFF_ROLES.includes(r.role)) errors.push('請選擇角色');

    // Abovee 上的寫法（issue 12）。**兩位不可以同一個寫法**（`aliasErrors()`）
    errors.push(...aliasErrors(r, existing));

    // 科別（ADR-0120）。沒有這一格 = 空的。**只有醫師有** —— 治療師帶著科別的話，
    // 那個字會出現在課程「指定一科」那一排上，而那一排永遠排不到任何人
    const specialties = r.specialties ?? [];
    if (!Array.isArray(specialties)) errors.push('科別格式錯誤');
    else if (specialties.some(isBlank)) errors.push('科別不可空白');
    else if (specialties.some((s) => String(s).trim().length > 12)) errors.push('科別最多 12 字');
    else if (specialties.length && r.role !== DOCTOR_ROLE) {
      errors.push('只有醫師有科別 —— 物理治療師是另一種人');
    }
    return errors;
  },

  equipment(r, { courses = [], existing = [] } = {}) {
    const errors = [...nameVariants(r), ...aliasErrors(r, existing)];
    if (isBlank(r.name)) errors.push('器材名稱不可空白');
    const contra = r.contraindications ?? [];
    if (!Array.isArray(contra)) errors.push('要提醒的狀況格式錯誤');
    else if (contra.some(isBlank)) errors.push('要提醒的狀況不可空白');

    // 用這台的那一段算哪一個課程（ADR-0075）。選填 —— 沒填的走舊的推導
    // （`coursesForEntitlement()` 退回 `requiresEquipment` 的課程），
    // 所以既有資料一筆都不會壞。但**指到一個不存在的課程要擋**：
    // 那一段會推不出課程，而推不出課程的時段存不下去。
    if (r.courseId != null && !courses.some((c) => c.id === r.courseId && !c.deletedAt)) {
      errors.push('指定的課程不存在或已刪除');
    }
    return errors;
  },

  // 警示（ADR-0074）。同名由 validate() 統一擋，這裡不再擋一次 ——
  // 兩份實作會讓她看到兩句在講同一件事的錯誤訊息。
  clinicalFlags(r) {
    const errors = [];
    if (isBlank(r.name)) errors.push('警示名稱不可空白');
    // 這一份的字會原樣畫在壓表卡片牆的一張卡上，而那一排要掃得完。
    else if (String(r.name).trim().length > 12) {
      errors.push('警示名稱最多 12 字。壓表卡片牆上那一排要掃得完，長的那種寫進備註');
    }

    // 顏色與填法選填（沒設定就是茶色空心，也就是這一層合併之前的樣子）。
    // 但**填了就要是名單上的**：認不得的值畫出來會退回預設，
    // 而「存下去了、看起來沒變」正是她分不出來的那種錯。
    if (r.color != null && !ALERT_COLORS.some((c) => c.id === r.color)) {
      errors.push('顏色不在名單上');
    }
    if (r.fill != null && !ALERT_FILLS.some((f) => f.id === r.fill)) {
      errors.push('填法只能是實心或空心');
    }
    return errors;
  },

  /**
   * 合作機構（ADR-0076）。客戶身上打得上的一個標記，例：自然美。
   *
   * **不寫死在程式碼裡**：這個 repo 為字串比對付過帳（`domain/followups.js`
   * 的檔頭）。而且她之後多一家合作的，設定裡加一筆就好。
   */
  partners(r) {
    if (isBlank(r.name)) return ['機構名稱不可空白'];
    // 這一份的字會原樣畫在壓表卡片牆的一張卡上，而那一排要掃得完（同警示）
    return String(r.name).trim().length > 12
      ? ['機構名稱最多 12 字。壓表卡片牆上那一排要掃得完']
      : [];
  },

  /**
   * 營養點滴品項。**2026-09-08 多了一格簡寫**：日曆上那一段印的是品項
   * 不是課程（`domain/naming.js`），而月曆一格放不下「雪顏亮彩」。
   *
   * 跟診間、器材、課程共用 `nameVariants()` —— 上限 12 字同一個理由：
   * 別稱是給窄的地方用的。
   */
  ivProducts(r, { existing = [] } = {}) {
    const errors = [...nameVariants(r), ...aliasErrors(r, existing)];
    if (isBlank(r.name)) errors.push('品項名稱不可空白');
    // 時長是**選填**的（ADR-0098）：空的就跟著課程走（一般 120 分）。
    // 填了就要能用 —— 一個存得下去卻算不出結束時間的數字比空的糟。
    if (r.durationMin != null && r.durationMin !== '' && !positiveInt(r.durationMin)) {
      errors.push('時長必須是大於 0 的整數分鐘');
    }
    return errors;
  },

  products(r) {
    return isBlank(r.name) ? ['商品名稱不可空白'] : [];
  },

  courses(r, { existing = [] } = {}) {
    const errors = [...nameVariants(r), ...aliasErrors(r, existing)];
    if (isBlank(r.name)) errors.push('課程名稱不可空白');
    // 分類（選填，沒填就是「其他」）。上限跟別稱同一個數字：它是清單上的一個小標題
    // 與一顆丸子，不是一段說明。
    if (r.group != null && r.group !== '') {
      if (typeof r.group !== 'string') errors.push('分類格式錯誤');
      else if (r.group.trim().length > 12) errors.push('分類最多 12 字 —— 它是清單上的一個小標題');
    }
    if (![null, 'A', 'B', 'C'].includes(r.category ?? null)) errors.push('任務類別不合法');
    // 壓哪幾個系統（ADR-0119）。**沒有這一格就是沒勾過**，照舊從類別推，所以不擋。
    // **三個都不勾是合法的：這門課不用壓**（ADR-0126，HRV）。擋的只剩「勾了卻沒有地方壓表」——
    // 也就是只勾耀聖：耀聖只收確認之後的登記，沒有壓表卻有確認後的登記講不通。
    if (r.systems != null) {
      if (!Array.isArray(r.systems) || r.systems.some((s) => !SYSTEMS.includes(s))) {
        errors.push('壓表的系統只能是 Abovee、Examine、耀聖');
      } else if (r.systems.length && !r.systems.some((s) => BOOKING_SYSTEMS.includes(s))) {
        errors.push('只勾耀聖存不下去 —— 耀聖是壓表之後才登記的，Abovee 與 Examine 至少要勾一個；這門課不用壓就三個都不勾');
      }
    }
    if (!positiveInt(r.durationMin)) errors.push('時長必須是大於 0 的整數分鐘');

    // 加購時給不給她挑時長（選填）。填了就要能用 ——
    // 一顆按不下去的丸子跟一顆按得下去的長得一模一樣。
    const choices = r.durationChoices ?? [];
    if (!Array.isArray(choices)) errors.push('可選時長格式錯誤');
    else if (choices.length) {
      if (!choices.every(positiveInt)) errors.push('可選時長必須都是大於 0 的整數分鐘');
      else if (new Set(choices).size !== choices.length) errors.push('可選時長不可以重複');
      else if (choices.length > 6) errors.push('可選時長最多六個 —— 再多那一排就要滑了');
      else if (!choices.includes(Number(r.durationMin))) {
        // 預設值不在名單上的話，加購那一排會一顆都沒按著，
        // 而她看到的是一張「還沒選」的表 —— 但她其實什麼都沒動。
        errors.push('可選時長裡要包含上面那個時長');
      }
    }
    // 約的時候選時長（選填，ADR-0122）。規矩跟上面那一格一樣，多一條：兩格只能填一格 ——
    // 一個是買的時候分成兩筆額度，一個是同一筆額度每一段自己挑；兩格都填的話一段來訪
    // 的長度有兩個來源在搶，而她看不出是哪一個贏。
    const booking = r.bookingMinutes ?? [];
    if (!Array.isArray(booking)) errors.push('約的時候選時長格式錯誤');
    else if (booking.length) {
      if (!booking.every(positiveInt)) errors.push('約的時候選時長必須都是大於 0 的整數分鐘');
      else if (new Set(booking).size !== booking.length) errors.push('約的時候選時長不可以重複');
      else if (booking.length > 6) errors.push('約的時候選時長最多六個 —— 再多那一排就要滑了');
      else if (!booking.includes(Number(r.durationMin))) {
        errors.push('約的時候選時長裡要包含上面那個時長 —— 它是預設按好的那一顆');
      }
      if (Array.isArray(choices) && choices.length) {
        errors.push('「可選時長」與「約的時候選時長」只能填一格：'
          + '一個是買的時候分成兩筆額度，一個是同一筆額度每一段自己挑');
      }
    }
    if (!ASSIGNS.includes(r.assigns)) errors.push('請選擇要指派治療師還是診間');

    const types = r.allowedRoomTypes ?? [];
    const ids = r.allowedRoomIds ?? [];
    // 常用診間（`orderedRoomsForCourse()`）。**只是順序不是限制**，所以這裡
    // 不驗那幾個 id 排不排得進去 —— 排不進去的那一間畫不出來就是了。
    const pref = r.preferredRoomIds ?? [];
    if (!Array.isArray(pref)) errors.push('常用診間格式錯誤');
    if (r.assigns === 'room') {
      if (types.length === 0 && ids.length === 0) {
        errors.push('選診間的課程要指定可用的診間類型，或直接指定幾間');
      }
      if (types.some((t) => !ROOM_TYPES.includes(t))) errors.push('診間類型不合法');
    } else if (types.length || ids.length || pref.length) {
      errors.push('不選診間的課程不該設定診間限制');
    }

    // 2026-09-06 拿掉了「要選器材的課程必須同時指派治療師」這一條。
    // 復能四選一裡的 ILIB 要的是診間不是治療師，而指派已經由「這一段選了哪一台
    // 器材」推出來（ADR-0075）—— 這一條會把那件事整個擋掉。
    if (r.requiresEquipment && r.requiresIvProduct) {
      errors.push('一個課程不會同時要選器材又要選點滴品項');
    }

    // 要不要醫師、哪一科（ADR-0120）。**沒有這一格就照舊**（`doctorRuleOf()` 退回 ADR-0058），
    // 所以不擋。填了就要是一個讀得出來的字 —— `'none'`、`'any'` 或某一科
    if (r.doctorPick != null && r.doctorPick !== '') {
      if (typeof r.doctorPick !== 'string') errors.push('「要哪一科的醫師」格式錯誤');
      else if (r.doctorPick.trim().length > 12) errors.push('科別最多 12 字');
    }

    // 來訪當天要不要請客人簽療程單。沒有這個欄位就是要簽（`visits.needsForm()`），
    // 所以這裡只擋型別 —— 存成字串的話 `!== false` 會判成「要簽」，
    // 而她明明關掉了。SPEC 第 7 節規則 9。
    if (r.needsTreatmentForm !== undefined && typeof r.needsTreatmentForm !== 'boolean') {
      errors.push('「要不要簽療程單」只能是是或否');
    }

    // 客人走了之後要不要去補一份文字紀錄（ADR-0066）。**沒有這個欄位就是不用**，
    // 跟療程單相反 —— 療程單是幾乎每一種都要簽，紀錄只有兩三種要。
    // 所以這裡也只擋型別：存成字串的話 `=== true` 會判成「不用寫」，
    // 而她明明勾了。
    if (r.needsRecord !== undefined && typeof r.needsRecord !== 'boolean') {
      errors.push('「做完要不要寫紀錄」只能是是或否');
    }

    // 不算次數（ADR-0121）。沒有這個欄位就是要算。同上面兩格只擋型別 ——
    // `isUncounted()` 只認 `true`，存成字串會安靜地被當成要算
    if (r.uncounted !== undefined && r.uncounted !== null && typeof r.uncounted !== 'boolean') {
      errors.push('「不算次數」只能是是或否');
    }

    // 設定暫定（2026-10-06）。只畫小標、沒有規則讀它；同上只擋型別（`isProvisional()` 只認 `true`）
    if (r.provisional !== undefined && r.provisional !== null && typeof r.provisional !== 'boolean') {
      errors.push('「設定暫定」只能是是或否');
    }

    // 做完之後要再約一次的那個課程（健檢 → 二返）。指到不存在的課程，
    // 額度就配不出來，而配不出來在畫面上跟「這位客戶沒買健檢」長得一模一樣。
    // 見 domain/followups.js 與 ADR-0022。
    const followupId = r.followupCourseId ?? null;
    if (followupId != null) {
      if (followupId === r.id) errors.push('後續課程不可以是它自己');
      else if (!existing.some((c) => c.id === followupId && !c.deletedAt)) {
        errors.push('指定的後續課程不存在或已刪除');
      }
    }

    return errors;
  },

  plans(r, { courses = [], equipment = [] } = {}) {
    const errors = [];
    if (isBlank(r.name)) errors.push('方案名稱不可空白');

    const items = r.items ?? [];
    if (!items.length) errors.push('方案至少要有一個項目');

    const courseIds = new Set(courses.filter((c) => !c.deletedAt).map((c) => c.id));
    const equipIds = new Set(equipment.filter((e) => !e.deletedAt).map((e) => e.id));

    items.forEach((item, i) => {
      const at = `第 ${i + 1} 個項目`;
      if (isBlank(item.label)) errors.push(`${at}：名稱不可空白`);
      if (!positiveInt(item.qty)) errors.push(`${at}：次數必須是大於 0 的整數`);

      if (item.type === 'single') {
        if (isBlank(item.courseId)) errors.push(`${at}：要選一個課程`);
        else if (!courseIds.has(item.courseId)) errors.push(`${at}：指定的課程不存在或已刪除`);
      } else if (item.type === 'pool') {
        const opts = item.optionEquipmentIds ?? [];
        // **一種也算數**（ADR-0075）：單買一台就是「這一池裡只有一台」。
        // 零台仍然擋 —— 那是「選了池卻一台都沒挑」，而那一筆額度排班時
        // 沒有器材可以選。
        if (opts.length < 1) errors.push(`${at}：擇一池至少要挑一種器材`);
        else if (opts.some((id) => !equipIds.has(id))) {
          errors.push(`${at}：指定的器材不存在或已刪除`);
        }
      } else {
        errors.push(`${at}：型態必須是 single 或 pool`);
      }
    });
    return errors;
  },
};

/**
 * @param {string} type MASTER_TYPES 之一
 * @param {object} record
 * @param {{existing?: object[], courses?: object[], equipment?: object[]}} [context]
 * @returns {string[]} 錯誤訊息，空陣列代表通過
 */
/** 一個方案項目的空白起點。新增項目時用。 */
export const BLANK_PLAN_ITEM = Object.freeze({
  type: 'single', label: '', qty: 1, durationMin: null, courseId: null,
});

/**
 * 組出一個乾淨的方案項目。
 *
 * 兩種型態的欄位是不重疊的：擇一池換的是器材不是課程，所以沒有 courseId；
 * single 沒有 optionEquipmentIds。不要為了欄位對齊互相塞 null ——
 * `expandPlan()` 會把缺的補成 null，這裡多塞的反而會存進 Firestore。
 *
 * frequencyRule 是選填，沒有就整個欄位不要出現。
 *
 * @param {object} raw 表單上收到的值
 * @returns {object} 可以直接存進 plan.items 的項目
 */
export function planItem(raw = {}) {
  const type = raw.type === 'pool' ? 'pool' : 'single';

  const item = {
    type,
    label: String(raw.label ?? '').trim(),
    qty: raw.qty ?? null,
    durationMin: raw.durationMin ?? null,
  };

  if (type === 'pool') item.optionEquipmentIds = raw.optionEquipmentIds ?? [];
  else item.courseId = raw.courseId ?? null;

  const freq = String(raw.frequencyRule ?? '').trim();
  if (freq) item.frequencyRule = freq;

  return item;
}

/**
 * 從一張方案範本複製出一張新的。
 *
 * ADR-0003 的立論就是「不做版本、改用複製」—— 複製沒做等於那支 ADR 只實現了一半。
 * 「9 月的方案跟 8 月的只差兩個項目」現在不必從零手打一次。
 *
 * 回傳的是**要填進表單的草稿**，不是要寫進資料庫的東西。按了儲存才算數 ——
 * 直接建立會在清單上長出一筆還沒改名的「（複本）」，而方案範本是拿來展開額度的，
 * 半成品混在裡面很危險。
 *
 * 三件不可以做的事：
 * - **不留任何指回原本那張的欄位**（version / copiedFromId / sourcePlanId）。
 *   使用者口中「5 月的範本」與「8 月的範本」是兩個各自有名字的範本，
 *   不是同一個範本的兩個版本（ADR-0003）。
 * - **items 要深拷貝。** 淺拷貝會讓兩張範本共用同一批項目物件，
 *   改了新的連舊的一起變 —— 而那要等到某位客戶的額度展開錯了才會被發現。
 * - **名字一定要加後綴。** 同名檢查會擋下來（duplicateName()），
 *   不加的話她一按複製就看到「已經有同名的」而不知道為什麼。
 *
 * @param {object} plan 要複製的範本
 * @param {string} [suffix]
 * @returns {object} 表單草稿
 */
export function copyPlan(plan, suffix = '（複本）') {
  return {
    name: `${String(plan?.name ?? '').trim()}${suffix}`,
    membershipMonths: plan?.membershipMonths ?? null,
    note: plan?.note ?? '',
    items: (plan?.items ?? []).map((item) => planItem(structuredClone(item))),
    // 從停用的範本複製一份出來，本意就是要用它
    active: true,
  };
}

export function validate(type, record, context = {}) {
  const fn = validators[type];
  if (!fn) return [`未知的主檔類型：${type}`];

  const errors = fn(record, context);
  if (duplicateName(record, context.existing ?? [])) {
    errors.unshift(`已經有一個叫「${String(record.name).trim()}」的了`);
  }
  return errors;
}

/**
 * 排班時可選的空間。**一間就是一個選項。**
 *
 * 2026-09-08 之前這裡會把有床位的診間攤成好幾個（`點滴8A`、`點滴8B`）。
 * 她那天說「取消任何床位區分」，所以那一層拿掉了 —— 舊資料上的 `beds`
 * 一個字都不影響這裡，不然那兩個選項還是會冒出來。
 *
 * `bed: null` 那一格留著：呼叫端（`roomKey()`、`parseRoomKey()`）與時段上的
 * 欄位都還在，而既有來訪身上那個 `A` 要畫得出來。
 */
export function roomSlots(rooms) {
  return (rooms ?? [])
    .filter((room) => room && !room.deletedAt && room.active !== false)
    .map((room) => ({ roomId: room.id, bed: null, label: room.name }));
}

/**
 * 某個課程用得到哪幾台器材（ADR-0075）。
 *
 * 復能 → 高能量雷射、超磁場、INDIBA；ILIB → ILIB 那一台。
 * **一台都對不上就回全部** —— 舊資料的器材身上沒有 `courseId`，而在那之前
 * 「擇一池」就是所有器材。退回去比回空陣列好：空的擇一池排不出任何一段。
 *
 * 擺在 `roomsForCourse()` 旁邊，理由一樣：**某個課程用得到哪些資源。**
 */
export function equipmentForCourse(courseId, equipment = []) {
  const alive = (equipment ?? []).filter((e) => e && !e.deletedAt && e.active !== false);
  const mine = alive.filter((e) => e.courseId === courseId);
  return mine.length ? mine : alive;
}

/**
 * 某個課程能選哪些診間。allowedRoomIds 有值時蓋過類型規則。
 *
 * **這一支回答的是「能不能」。** 「誰排前面」是另一個問題，在
 * `orderedRoomsForCourse()` —— 兩件事混在一個欄位裡的話，她一放寬限制，
 * 順序就跟著散掉。
 */
export function roomsForCourse(course, rooms) {
  if (course?.assigns !== 'room') return [];
  const alive = rooms.filter((r) => !r.deletedAt && r.active !== false);

  const ids = course.allowedRoomIds ?? [];
  if (ids.length) return alive.filter((r) => ids.includes(r.id));

  const types = course.allowedRoomTypes ?? [];
  return types.length ? alive.filter((r) => types.includes(r.type)) : alive;
}

/**
 * 某個課程的診間，**常用的排前面**。
 *
 * 她 2026-09-08：
 *
 * > 預約 EECP 時 → 下拉選單優先置頂顯示：治5、治8
 * > 預約 ILIB 時 → 優先置頂顯示：.10、治2、治3
 *
 * **這是排序不是限制。** 課程主檔上三個欄位回答三個不同的問題：
 *
 *   `allowedRoomTypes`  這個課程能排在哪一類空間
 *   `allowedRoomIds`    例外：只有這幾間（**硬限制**，例：EECP 只能治5、治7、治8）
 *   `preferredRoomIds`  這幾間排最前面（**只是順序**）
 *
 * 三個都留著是刻意的：她之後在設定裡把 EECP 的硬限制放寬時，順序還在。
 *
 * **推薦裡排不進去的那幾間不出現，也不會因此變成允許** ——
 * 那會讓「常用」變成第二條放寬限制的路，而她不會知道是哪一條在算數。
 * 排不進去的原因有兩種（不在允許範圍、已經被刪掉），兩種的答案一樣。
 *
 * 壓表與來訪編輯器兩個入口共用 —— 各排一次的話，同一個課程在兩個畫面上
 * 第一顆丸子不一樣，她不會知道哪個算數。
 */
export function orderedRoomsForCourse(course, rooms) {
  const allowed = roomsForCourse(course, rooms);
  const wanted = (course?.preferredRoomIds ?? [])
    .filter((id) => allowed.some((r) => r.id === id));
  if (!wanted.length) return allowed;

  const rank = new Map(wanted.map((id, i) => [id, i]));
  // `sort()` 在現代 JS 是穩定的，所以沒被點名的那幾間維持主檔上的順序
  return [...allowed].sort(
    (a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity),
  );
}

/**
 * 排班時那一排診間丸子：**排好序的選項，每一顆說得出自己是不是排得進去。**
 *
 * 壓表與來訪編輯器要的是同一份東西，而它們原本各自拿 `orderedRoomsForCourse()`
 * 組一次 rank Map、各自對 `roomSlots()` 重排 —— 一邊切 primary／rest、
 * 一邊用 `Infinity` 墊底。CLAUDE.md 寫著「排序只寫在 `orderedRoomsForCourse()`」，
 * 而實際上有一半在畫面上。這一支把那一半也收回來。
 *
 * `usual` 是「這個課程排得進去嗎」。**排不進去的不藏起來**（她偶爾真的會排到
 * 別間，ADR-0002），呼叫端拿它決定要收進「其他診間」還是標一句「不常用」。
 *
 * @returns {{roomId:string, bed:null, label:string, usual:boolean}[]}
 */
export function orderedRoomSlots(course, rooms, { keep = null } = {}) {
  const rank = new Map(orderedRoomsForCourse(course, rooms).map((r, i) => [r.id, i]));
  const out = roomSlots(rooms)
    .map((s) => ({ ...s, usual: rank.has(s.roomId) }))
    .sort((a, b) => (rank.get(a.roomId) ?? Infinity) - (rank.get(b.roomId) ?? Infinity));

  // **這一段現在指著的那一間就算停用也列出來**（`keep`，ADR-0127）。點滴8 停用之後，一段還排在
  // 點滴8 的來訪打開時那一排上沒有它 → 一顆都沒按著 → 她只改記一句存一次，診間就安靜地沒了。
  // 刪掉的那一間救不回來（主檔清單裡沒有它的名字）；新增一段不用傳。
  if (keep && !out.some((s) => s.roomId === keep)) {
    const room = (rooms ?? []).find((r) => r && r.id === keep && !r.deletedAt);
    if (room) out.push({ roomId: room.id, bed: null, label: room.name, usual: false, retired: true });
  }
  return out;
}

// ---------- 「沒選床位的那一間」與它拆出來的那幾間（ADR-0127）----------
//
// 點滴8A／8B、VIP7A／7B 是四間各自的診間；點滴8、VIP7 留著當「沒選床位」。兩邊的關係**照名字認**
// （那一間的全名＋A 或 B），不照 id：她自己建的「點滴8A」也算，哪天她把點滴9 也拆開，一樣成立。

const BED_LETTERS = ['A', 'B'];
const roomNameOf = (room) => String(room?.name ?? '').trim();

/** 點滴8＋床 A → 主檔上叫「點滴8A」的那一間（還沒刪的）。沒有就 null。 */
export function bedRoomOf(room, bed, rooms = []) {
  const letter = String(bed ?? '').trim().toUpperCase();
  const base = roomNameOf(room);
  if (!base || !BED_LETTERS.includes(letter)) return null;
  return (rooms ?? []).find((r) => r && !r.deletedAt && roomNameOf(r) === `${base}${letter}`) ?? null;
}

/** `parent` 是不是 `child` 沒選床位的那一間（點滴8 之於點滴8A）。 */
export function isBedlessOf(parent, child) {
  const base = roomNameOf(parent);
  return Boolean(base) && BED_LETTERS.some((letter) => roomNameOf(child) === `${base}${letter}`);
}

/**
 * 這個課程給不給她挑時長 —— 也就是「它有沒有兩種以上的規格」。
 *
 * 名單記在**課程主檔**上（`durationChoices`），不寫死課程名字 ——
 * 這個 repo 為字串比對付過帳（`domain/followups.js` 的檔頭）。
 * 沒填就是不給挑，用課程的預設時長。
 *
 * 兩個地方問同一件事，所以它住在這裡（兩邊都 import 得到）：
 *
 * - 加購那一張表：要不要畫「幾分鐘」那一排（`ui/components/buy.js`）
 * - 月檢視那一格：要不要在器材後面補上分鐘（`domain/naming.js`）
 */
export const durationChoicesOf = (course) =>
  (course?.durationChoices ?? []).filter((n) => Number.isInteger(n) && n > 0);

/**
 * 這門課**約的時候**給不給她挑時長（`bookingMinutes`，2026-10-05，ADR-0122）。
 *
 * 她：「是，約的時候選，預設 30。拍照時照 Abovee 那一格（二返60 就記 60）」。
 *
 * **跟上面那一支是兩件事，不要併成一支：**
 *
 *   durationChoices   買的時候分 —— `復能-三選一(30)` 與 `(60)` 是**兩筆額度**
 *   bookingMinutes    約的時候選 —— **同一筆額度**，每一段自己挑（二返 30 或 60）
 *
 * 二返的額度是跟著健檢自動長出來的（ADR-0022），買的時候沒得選；讓 `durationChoicesOf()`
 * 也認這一格的話，二返的額度會變成 `二返(30)`、加購會多一排丸子。同一門課兩格不能都填
 * （`validate()` 擋）。
 *
 * 選了什麼記在**時段**上（`slot.minutes`），算數的順序只寫在 `visits.js` 的 `slotMinutes()`。
 */
export const bookingMinutesOf = (course) =>
  (Array.isArray(course?.bookingMinutes) ? course.bookingMinutes : [])
    .filter((n) => Number.isInteger(n) && n > 0);
