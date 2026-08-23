// 稽核紀錄怎麼讀成人話。純函式。
//
// 稽核存的是機器好寫的形狀（action、targetPath、before、after），
// 但出事時看它的人在問的是「誰、什麼時候、把哪一筆的什麼改成什麼」。
// 那層翻譯是規則不是畫面，所以放這裡，也才測得到。
//
// 只翻譯，不判斷。稽核紀錄是既成事實，這裡不評價它對不對。
//
// **一則稽核先是一句話，展開才是一張差異表**（2026-08-23）。原本每一列都印著
// `customers/AbC123/entitlements/XyZ789` 跟一整排 `（一組資料）`，
// 而她要找的是「我剛剛把客戶A那筆改成什麼了」。翻譯不出那句話的時候才退回
// 欄位表 —— 退回去的時候看起來就是以前那樣，不會少東西。

import { shortStatus } from './visits.js';

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
  events: '行事備註',
  notes: '隨手記',
  formInvites: '時間表單連結',
  formResponses: '客戶填的時間',
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
  date: '日期',
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
  followupAt: '問過的時間',
  queue: '佇列',
  cursor: '停留位置',
  // 行事備註與隨手記
  title: '標題',
  category: '類別',
  startDate: '開始日期',
  endDate: '結束日期',
  allDay: '整天',
  startTime: '開始時間',
  endTime: '結束時間',
  text: '內容',
  note: '這一次記一句',
  marks: '備註',
  attended: '有沒有做',
  customerName: '客戶',
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

// ---------- 一則稽核 → 一句話 ----------

/**
 * 這一筆講的是誰。
 *
 * 冗餘存的名字派上用場的地方：來訪與任務身上都有 `customerName`，
 * 所以不用再去讀一次客戶就講得出「客戶A 的來訪」。讀不到名字就回 null，
 * **不要編一個** —— 「某位客戶」比沒有名字更容易被當成真的。
 */
export function subjectOf(event) {
  const d = merged(event);
  return d.customerName || d.name || d.title || d.label || d.text || null;
}

const merged = (event) => ({ ...(event?.before ?? {}), ...(event?.after ?? {}) });

const VALUE_SAYS = {
  status: (v) => shortStatus(v),
  done: (v) => (v ? '已完成' : '還沒做'),
  active: (v) => (v ? '啟用' : '停用'),
};

/**
 * 一個值怎麼唸。認不得就退回 `formatValue()`。
 *
 * **句子與底下的差異表用同一支**：句子寫「改成已完成」、表格寫
 * `confirmed → done` 的話，那張表看起來就像在講另一件事。
 */
export function formatField(key, value) {
  const f = VALUE_SAYS[key];
  return f ? f(value) : formatValue(value);
}

const say = formatField;

/**
 * 一則稽核的那一句話。
 *
 * 規則由上到下比，第一個對上的算數。**比不上就回 null**，
 * 由畫面退回欄位表 —— 硬要湊一句話出來，湊錯的那幾則會比欄位表更難查。
 *
 * 每一條都要能回答「她會怎麼跟人講這件事」：她不會說「修改來訪，status
 * 由 confirmed 變更為 done」，她會說「客戶A 那筆變成已完成了」。
 */
const SENTENCES = [
  // 狀態變化是這份紀錄裡最常被回頭查的一種：次數就是跟著它扣的。
  {
    when: (e, f) => op(e) === 'update' && f.some((x) => x.key === 'status'),
    text: (e, f) => {
      const x = f.find((c) => c.key === 'status');
      return `${withSubject(e, describeTarget(e.targetPath))}改成${say('status', x.after)}`;
    },
  },
  // 勾任務、勾隨手記
  {
    when: (e, f) => op(e) === 'update' && f.some((x) => x.key === 'done'),
    text: (e, f) => {
      const done = f.find((c) => c.key === 'done').after;
      const what = e.after?.kind || subjectOf(e) || describeTarget(e.targetPath);
      return `${done ? '勾掉' : '取消勾選'}${withSubject(e, '', { override: what })}`;
    },
  },
  // 次數只會因為來訪狀態變化而動（SPEC 4.2），所以它旁邊一定有一筆來訪的紀錄。
  {
    when: (e, f) => op(e) === 'update'
      && f.length > 0 && f.every((x) => x.key === 'doneCount' || x.key === 'bookedCount'),
    text: (e, f) => `${withSubject(e, '額度')}：${
      f.map((x) => `${fieldLabel(x.key)} ${formatValue(x.before)} → ${formatValue(x.after)}`).join('、')}`,
  },
  {
    when: (e) => op(e) === 'create',
    text: (e) => `新增${withSubject(e, describeTarget(e.targetPath))}`,
  },
  {
    when: (e) => op(e) === 'softDelete',
    text: (e) => `刪掉${withSubject(e, describeTarget(e.targetPath))}`,
  },
  // 一般的修改：講改了哪幾個欄位，不講改成什麼 —— 那是展開之後的事。
  {
    when: (e, f) => op(e) === 'update' && f.length > 0 && f.length <= 3,
    text: (e, f) => `改了${withSubject(e, describeTarget(e.targetPath), { possessive: true })}的${
      f.map((x) => x.label).join('、')}`,
  },
  {
    when: (e, f) => op(e) === 'update' && f.length > 3,
    text: (e, f) => `改了${withSubject(e, describeTarget(e.targetPath), { possessive: true })}的 ${f.length} 個欄位`,
  },
];

/** `visits.update` → `update`。 */
export const opOf = (event) => String(event?.action ?? '').split('.')[1] ?? '';

const op = opOf;

/**
 * 這一筆要怎麼稱呼：`客戶A的來訪`、`客戶「客戶A」`、`來訪`。
 *
 * 兩種關係要分開講，混在一起會寫出「新增客戶A的客戶」這種句子：
 *
 * - **這一筆屬於某個人**（`customerName`，來訪與任務身上都有）→ `客戶A的來訪`
 * - **這一筆本身就是那個東西**（`name`／`label`／`text`）→ `客戶「客戶A」`
 *
 * 名字讀不到就只講名詞，**不要編一個** —— 「某位客戶」比沒有名字更容易
 * 被當成真的。
 */
function withSubject(event, noun, { override = null, possessive = false } = {}) {
  const d = merged(event);
  const what = override ?? noun;
  if (d.customerName) return `${d.customerName}的${what}`;
  if (override) return override;
  const self = d.name || d.title || d.label || d.text;
  if (!self) return noun;
  // 後面還要接「的電話」時只講名字：`客戶「客戶A」的電話` 裡的「客戶」是多的，
  // 而那一句本來就短，多兩個字就少兩個字看得到真正改了什麼。
  return possessive ? self : `${noun}「${self}」`;
}

/**
 * 這一則用一句話講的話是什麼。翻譯不出來回 null。
 *
 * @returns {string|null}
 */
export function describeEvent(event) {
  const fields = changedFields(event);
  const rule = SENTENCES.find((r) => r.when(event, fields));
  return rule ? rule.text(event, fields) : null;
}

/**
 * 同一天的收在一起。她找東西是先想「那是今天還是昨天的事」，
 * 而每一列都印一次完整年月日只會把那個問題埋掉。
 *
 * @returns {{day: string, events: object[]}[]} 依原順序（新的在前）分組
 */
export function groupByDay(events, dayOf) {
  const out = [];
  for (const e of events ?? []) {
    const day = dayOf(e);
    const last = out[out.length - 1];
    if (last && last.day === day) last.events.push(e);
    else out.push({ day, events: [e] });
  }
  return out;
}
