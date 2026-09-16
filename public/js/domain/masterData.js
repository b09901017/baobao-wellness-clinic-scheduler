// 主檔的型別與驗證。純函式。
//
// 前端擋一次、Firestore Rules 再擋一次，這裡是前端這一次。
// 驗證失敗回傳訊息陣列，空陣列代表可以存。

import { ALERT_COLORS, ALERT_FILLS } from './clinicalFlags.js';

/**
 * 空間有三種。**2026-09-08 她重畫過一次**：
 *
 *   治療室  治2 治3 治5 治8
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
 * 這個課程排班時選不選得到醫師。
 *
 * **A 類（門診）一律選得到** —— 她的原話是「門診類的可以選醫生，復能類的選
 * 物理治療師」。以前這件事只看課程上的 `requiresDoctor` 旗標，而種子資料裡
 * 只有二返打開了它，所以復健科醫師門診與心臟科評估**選不到醫師** ——
 * 兩個都是門診，兩個都真的有醫師。要她回主檔逐課程補勾一次，是把一條
 * 已經知道的規則交給她記得。
 *
 * 旗標留著，當成**非 A 類的例外開關**：之後真的有一個 C 類要記醫師時，
 * 主檔上勾一下就有，不用改程式（同 ADR-0022 的判準）。
 *
 * 醫師走的是 `requiresEquipment` / `requiresIvProduct` 那條路（課程上一個布林、
 * 時段上一個 id），不是 `assigns` —— `assigns` 是單選的，而二返同時要診間和醫師。
 * 治療師與醫師是兩種人，兩個選單各自從 `staffWithRole()` 來。
 * 見 docs/adr/0026 與 docs/adr/0058。
 *
 * **選不選得到 ≠ 一定要選。** 沒選也存得下去，`validateVisit()` 給的是
 * warning 不是 error（ADR-0002：app 記錄決定，不做決定）。
 */
export const picksDoctor = (course) => course?.category === 'A' || Boolean(course?.requiresDoctor);

// 課程要指派什麼。復能三器材選治療師，其餘含 ILIB 選診間，心臟科評估都不用。
export const ASSIGNS = ['therapist', 'room', 'none'];

export const ASSIGN_LABELS = {
  therapist: '選治療師',
  room: '選診間',
  none: '都不用',
};

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
  rooms(r) {
    const errors = [...nameVariants(r)];
    if (isBlank(r.name)) errors.push('診間名稱不可空白');
    if (!ROOM_TYPES.includes(r.type)) errors.push('請選擇診間類型');
    // 同一個時間裝得下幾個人（ADR-0094）。**沒填就是 1**，所以空白不是錯誤。
    if (r.capacity != null && !(Number.isInteger(Number(r.capacity)) && Number(r.capacity) > 0)) {
      errors.push('「同時幾位」要是大於 0 的整數');
    }
    return errors;
  },

  staff(r) {
    const errors = [];
    // 不寫「治療師姓名」—— 這份清單現在也放醫師，而那兩個詞不可以混用。
    if (isBlank(r.name)) errors.push('姓名不可空白');
    if (!STAFF_ROLES.includes(r.role)) errors.push('請選擇角色');
    return errors;
  },

  equipment(r, { courses = [] } = {}) {
    const errors = [...nameVariants(r)];
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
  ivProducts(r) {
    const errors = [...nameVariants(r)];
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
    const errors = [...nameVariants(r)];
    if (isBlank(r.name)) errors.push('課程名稱不可空白');
    if (![null, 'A', 'B', 'C'].includes(r.category ?? null)) errors.push('任務類別不合法');
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
 *   `allowedRoomIds`    例外：只有這幾間（**硬限制**，例：EECP 只能治5、治8）
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
export function orderedRoomSlots(course, rooms) {
  const rank = new Map(orderedRoomsForCourse(course, rooms).map((r, i) => [r.id, i]));
  return roomSlots(rooms)
    .map((s) => ({ ...s, usual: rank.has(s.roomId) }))
    .sort((a, b) => (rank.get(a.roomId) ?? Infinity) - (rank.get(b.roomId) ?? Infinity));
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
