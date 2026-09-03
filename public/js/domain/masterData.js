// 主檔的型別與驗證。純函式。
//
// 前端擋一次、Firestore Rules 再擋一次，這裡是前端這一次。
// 驗證失敗回傳訊息陣列，空陣列代表可以存。

export const ROOM_TYPES = ['治療室', '點滴室', 'ILIB室'];

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

// 課程要指派什麼。復能三器材選治療師，其餘含靜脈選診間，心臟科評估都不用。
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
  'ivProducts',
  'products',
  'courses',
  'plans',
];

export const MASTER_LABELS = {
  rooms: '診間',
  staff: '治療師與醫師',
  equipment: '器材',
  clinicalFlags: '臨床提醒',
  ivProducts: '營養點滴品項',
  products: '營養品',
  courses: '課程',
  plans: '方案範本',
};

/**
 * 臨床提醒的名單。**永久限制底下的第二層**，見 ADR-0064。
 *
 * 跟醫療禁忌差在一件事：**它什麼都不擋**。
 * 「體內金屬」會讓超磁場與高能量雷射完全不可選（全站唯一的硬性阻擋，
 * `domain/contraindications.js`）；「血管難打」不會讓任何東西不能選，
 * 它只是要在她壓表的那一刻被看到 —— 那一下她要把這件事抄進 Abovee 的註記欄。
 *
 * 為什麼是主檔而不是寫死：她手上的筆記裡至少已經有兩個（血管難打、第一針），
 * 而下一個一定還會有。設定頁的第一句話就是「診間與治療師都在這裡自己加，
 * 沒有寫死在程式碼裡」。
 *
 * 為什麼不像醫療禁忌那樣從別的主檔推出來：醫療禁忌要跟器材上的字**完全相同**
 * 才擋得住，所以它只能從器材推（`contraindicationTerms()`）。
 * 臨床提醒沒有東西要對得上，所以它自己就是那份名單。
 *
 * 擺在 `staffWithRole()` 旁邊是因為兩支問的是同一句話：
 * **從主檔拿出一份可以點的名單。**
 *
 * @param {{name?: string, active?: boolean, deletedAt?: any}[]} rows config/clinicalFlags
 * @returns {string[]} 還在用的那幾個字，維持主檔上的順序
 */
export function clinicalTerms(rows = []) {
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
  rooms(r) {
    const errors = [];
    if (isBlank(r.name)) errors.push('診間名稱不可空白');
    if (!ROOM_TYPES.includes(r.type)) errors.push('請選擇診間類型');
    const beds = r.beds ?? [];
    if (!Array.isArray(beds)) errors.push('床位格式錯誤');
    else {
      if (beds.some(isBlank)) errors.push('床位名稱不可空白');
      if (new Set(beds).size !== beds.length) errors.push('床位名稱不可重複');
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

  equipment(r) {
    const errors = [];
    if (isBlank(r.name)) errors.push('器材名稱不可空白');
    const contra = r.contraindications ?? [];
    if (!Array.isArray(contra)) errors.push('禁忌格式錯誤');
    else if (contra.some(isBlank)) errors.push('禁忌名稱不可空白');
    return errors;
  },

  // 臨床提醒（ADR-0064）。同名由 validate() 統一擋，這裡不再擋一次 ——
  // 兩份實作會讓她看到兩句在講同一件事的錯誤訊息。
  clinicalFlags(r) {
    if (isBlank(r.name)) return ['提醒名稱不可空白'];
    // 這一份的字會原樣畫在壓表卡片牆的一張卡上，而那一排要掃得完。
    return String(r.name).trim().length > 12
      ? ['提醒名稱最多 12 字。壓表卡片牆上那一排要掃得完，長的那種寫進備註']
      : [];
  },

  ivProducts(r) {
    return isBlank(r.name) ? ['品項名稱不可空白'] : [];
  },

  products(r) {
    return isBlank(r.name) ? ['商品名稱不可空白'] : [];
  },

  courses(r, { existing = [] } = {}) {
    const errors = [];
    if (isBlank(r.name)) errors.push('課程名稱不可空白');
    if (![null, 'A', 'B', 'C'].includes(r.category ?? null)) errors.push('任務類別不合法');
    if (!positiveInt(r.durationMin)) errors.push('時長必須是大於 0 的整數分鐘');
    if (!ASSIGNS.includes(r.assigns)) errors.push('請選擇要指派治療師還是診間');

    const types = r.allowedRoomTypes ?? [];
    const ids = r.allowedRoomIds ?? [];
    if (r.assigns === 'room') {
      if (types.length === 0 && ids.length === 0) {
        errors.push('選診間的課程要指定可用的診間類型，或直接指定幾間');
      }
      if (types.some((t) => !ROOM_TYPES.includes(t))) errors.push('診間類型不合法');
    } else if (types.length || ids.length) {
      errors.push('不選診間的課程不該設定診間限制');
    }

    if (r.assigns !== 'therapist' && r.requiresEquipment) {
      errors.push('要選器材的課程必須同時指派治療師');
    }
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
        if (opts.length < 2) errors.push(`${at}：擇一池至少要有兩種器材可選`);
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
 * 診間 × 床位 攤平成排班時可選的資源。
 * 沒有床位的診間就是它自己一個選項。
 */
export function roomSlots(rooms) {
  const out = [];
  for (const room of rooms) {
    if (room.deletedAt || room.active === false) continue;
    const beds = room.beds ?? [];
    if (!beds.length) {
      out.push({ roomId: room.id, bed: null, label: room.name });
    } else {
      for (const bed of beds) {
        out.push({ roomId: room.id, bed, label: `${room.name}${bed}` });
      }
    }
  }
  return out;
}

/** 某個課程能選哪些診間。allowedRoomIds 有值時蓋過類型規則。 */
export function roomsForCourse(course, rooms) {
  if (course?.assigns !== 'room') return [];
  const alive = rooms.filter((r) => !r.deletedAt && r.active !== false);

  const ids = course.allowedRoomIds ?? [];
  if (ids.length) return alive.filter((r) => ids.includes(r.id));

  const types = course.allowedRoomTypes ?? [];
  return types.length ? alive.filter((r) => types.includes(r.type)) : alive;
}
