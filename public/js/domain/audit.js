// 稽核紀錄怎麼讀成人話。純函式。
//
// 稽核存的是機器好寫的形狀（action、targetPath、before、after），
// 但出事時看它的人在問的是「誰、什麼時候、把哪一筆的什麼改成什麼」。
// 那層翻譯是規則不是畫面，所以放這裡，也才測得到。
//
// 只翻譯，不判斷。稽核紀錄是既成事實，這裡不評價它對不對。

const OP_LABELS = {
  create: '新增',
  update: '修改',
  softDelete: '刪除',
};

/** 集合名 → 人話。targetPath 看倒數第二段，action 看點號前面那段路徑的最後一段。 */
const COLLECTION_LABELS = {
  customers: '客戶',
  entitlements: '額度',
  availability: '本輪可用性',
  visits: '來訪',
  tasks: '任務',
  batches: '壓表批次',
  config: '設定',
  rooms: '診間',
  staff: '治療師',
  equipment: '器材',
  ivProducts: '營養點滴品項',
  products: '營養品',
  courses: '課程',
  plans: '方案範本',
};

/**
 * 欄位名 → 人話。用 CONTEXT.md 的詞，不要用它標 _Avoid_ 的同義詞。
 * 沒列到的欄位原樣顯示 —— 猜錯比看到英文欄位名更糟。
 */
const FIELD_LABELS = {
  name: '姓名',
  phone: '電話',
  lineId: 'LINE',
  source: '購買通路',
  priority: '喜好程度',
  flags: '永久限制',
  notes: '特殊狀況',
  active: '啟用',
  deletedAt: '刪除標記',
  purchasedAt: '購買日',
  membershipExpiresAt: '會籍到期日',
  date: '來訪日期',
  status: '狀態',
  slots: '時段',
  cancelReason: '取消原因',
  released: '已釋出遞補',
  label: '顯示名稱',
  totalQty: '總次數',
  doneCount: '已完成次數',
  bookedCount: '已排未上次數',
  durationMin: '時長',
  frequencyRule: '頻率限制',
  expiresAt: '到期日',
  lastReconciledAt: '上次對帳時間',
  optionEquipmentIds: '擇一池器材',
  courseId: '課程',
  role: '角色',
  requiresEquipment: '要選器材',
  requiresIvProduct: '要選點滴品項',
  requiresDoctor: '要選醫師',
  kind: '任務種類',
  dueDate: '死線',
  done: '已完成',
  doneAt: '完成時間',
  rawText: '原文',
  rules: '規則',
  validFrom: '有效期起',
  validTo: '有效期迄',
  collectedAt: '收集日期',
  followupNote: '後續備註',
  queue: '佇列',
  cursor: '停留位置',
};

/** 這些欄位每次寫入都會變，列出來只會把真正的改動淹掉。 */
const NOISE_FIELDS = new Set(['updatedAt', 'createdAt', 'createdBy']);

/**
 * 例：'visits.update' → '修改來訪'。
 *
 * action 的前半是集合路徑而不只是集合名（repo 寫的是 `${path}.${op}`，
 * 子集合的 path 長成 customers/{id}/entitlements），所以取最後一段才對得出名字。
 */
export function describeAction(action) {
  const [path, op] = String(action ?? '').split('.');
  const collection = path.split('/').filter(Boolean).pop();
  const what = COLLECTION_LABELS[collection] ?? collection ?? '資料';
  return `${OP_LABELS[op] ?? op ?? '異動'}${what}`;
}

/** 例：'customers/abc/entitlements/def' → '額度'。 */
export function describeTarget(targetPath) {
  const parts = String(targetPath ?? '').split('/').filter(Boolean);
  // 集合／文件交替，所以集合名一定在倒數第二段
  const collection = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return COLLECTION_LABELS[collection] ?? collection ?? '資料';
}

export function fieldLabel(key) {
  return FIELD_LABELS[key] ?? key;
}

/**
 * 這一則稽核到底改了什麼。
 *
 * after 的形狀跟著操作走：新增是整份內容，修改只有被改的那幾個欄位，
 * 刪除是刪除標記。所以一律以 after 的鍵為準去比 before，
 * 不要反過來列 before 的鍵 —— 那會把「這次沒動到的欄位」全部報成改動。
 *
 * @returns {{key:string, label:string, before:*, after:*}[]}
 */
export function changedFields(event) {
  const after = event?.after;
  if (after == null || typeof after !== 'object') return [];
  const before = event?.before ?? {};

  return Object.keys(after)
    .filter((key) => !NOISE_FIELDS.has(key))
    .filter((key) => !same(before?.[key], after[key]))
    .map((key) => ({
      key,
      label: fieldLabel(key),
      before: before?.[key],
      after: after[key],
    }));
}

/** 顯示用的一行字。物件與陣列不展開 —— 差異表是拿來掃的，不是拿來讀完的。 */
export function formatValue(value) {
  if (value === null || value === undefined) return '（空的）';
  if (value === '') return '（空字串）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.length ? `${value.length} 筆` : '（沒有）';
  if (typeof value === 'object') {
    if (value.toDate || value.seconds != null) return '（時間）';
    return '（一組資料）';
  }
  return String(value);
}

function same(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  // 陣列與物件比內容。稽核裡的值都是從 Firestore 讀回來的純資料，
  // 序列化比對夠用，而且比逐層遞迴好讀。
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
