// 主檔的型別與驗證。純函式。
//
// 前端擋一次、Firestore Rules 再擋一次，這裡是前端這一次。
// 驗證失敗回傳訊息陣列，空陣列代表可以存。

export const ROOM_TYPES = ['治療室', '點滴室', 'ILIB室'];

// 護理師目前不納入排程（營養點滴不需要指定護理師），
// 但角色欄位保留，之後要加不必改資料結構。
export const STAFF_ROLES = ['物理治療師'];

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
  'ivProducts',
  'products',
  'courses',
  'plans',
];

export const MASTER_LABELS = {
  rooms: '診間',
  staff: '治療師',
  equipment: '器材',
  ivProducts: '營養點滴品項',
  products: '營養品',
  courses: '課程',
  plans: '方案範本',
};

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
    if (isBlank(r.name)) errors.push('治療師姓名不可空白');
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

  ivProducts(r) {
    return isBlank(r.name) ? ['品項名稱不可空白'] : [];
  },

  products(r) {
    return isBlank(r.name) ? ['商品名稱不可空白'] : [];
  },

  courses(r) {
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
