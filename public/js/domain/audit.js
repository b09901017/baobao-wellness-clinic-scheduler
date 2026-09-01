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

import { shortStatus, visitCourseLabel } from './visits.js';
import { isProduct } from './entitlements.js';
import { monthOf, banCount, describeRuleChanges } from './availability.js';
import { shortDate } from './dates.js';

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
 * 只在**組句子**的時候忽略的欄位。
 *
 * 跟 `NOISE_FIELDS` 是兩件事：那一組連欄位表都不列（每次寫入都會變的時間戳），
 * 這一組**照樣要列在展開的差異表裡** —— 出事時「上次對帳是什麼時候」
 * 是有用的，它只是不該擠掉那一句話。
 *
 * 她的原話：「我不懂甚麼叫改了二返（x萬健檢）的已排未上次數、上次對帳時間」。
 * 那一則其實只做了一件事（次數變了），`lastReconciledAt` 是跟著寫進去的，
 * 而它一出現就把那一則從「次數」那一條擠到了「一般的修改」那一條。
 */
const QUIET_IN_SENTENCE = new Set(['lastReconciledAt', 'confirmedAt', 'cancelledAt', 'doneAt']);

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

/**
 * 這一則講的是哪一種東西。
 *
 * 大部分看路徑就夠了，`events` 是例外：**同一個集合裡放著行事備註與休假**
 * （ADR-0045），而那兩個在日曆上是不同的兩類。只看路徑的話，一則休假的
 * 稽核會寫著「行事備註」。
 */
function describeKind(event) {
  const noun = describeTarget(event?.targetPath);
  if (noun !== '行事備註') return noun;
  return merged(event).category === 'leave' ? '休假' : noun;
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
//
// 她的原話（2026-09-01）：
//
// > 目前的「今天做了什麼」與「稽核紀錄」文字太過籠統、機器化，甚至出現如
// > 「勾掉客戶A的客戶A」這種看不懂的疊字。……壓表不要寫新增客戶A的來訪，
// > 要寫新增客戶A.日期.項目。
//
// 三個根因，這一段一次修完：
//
// 1. **疊字** —— 勾隨手記那一條把 `subjectOf()`（第一順位是 `customerName`）
//    當成「勾掉什麼」，而印名字的那一支看到 `customerName` 又印了一次。
//    任務身上有 `kind` 所以躲過去了，隨手記沒有。
// 2. **只講「哪一種東西」** —— 印的是集合的名字（來訪、額度），
//    而素材其實都在：`before` 與 `after` 併起來就有日期與課程名。
// 3. **子集合講不出是誰** —— 額度與本輪可用性身上沒有 `customerName`
//    （只有來訪、任務、隨手記有那個冗餘欄位），但 id 在路徑上。
//
// 所以一句話拆成**兩半**（`describeParts()`）：`who`（誰）與 `text`（做了什麼）。
// 拆開是為了「今天做了什麼」的照人分組 —— 那一格的抬頭已經寫著名字了，
// 每一列再印一次是雜訊。兩邊接起來走同一支 `joinParts()`，
// 所以兩個畫面不可能講得不一樣。

/**
 * 這一筆講的是誰。
 *
 * 冗餘存的名字派上用場的地方：來訪與任務身上都有 `customerName`，
 * 所以不用再去讀一次客戶就講得出是誰的來訪。讀不到名字就回 null，
 * **不要編一個** —— 「某位客戶」比沒有名字更容易被當成真的。
 */
export function subjectOf(event) {
  const d = merged(event);
  return d.customerName || d.name || d.title || d.label || d.text || null;
}

const merged = (event) => ({ ...(event?.before ?? {}), ...(event?.after ?? {}) });

/** 目標路徑的集合名（原始的，不翻譯）。例：`customers/c1/entitlements/e1` → `entitlements`。 */
function targetCollection(targetPath) {
  const parts = String(targetPath ?? '').split('/').filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) ?? '';
}

/**
 * 這一則掛在哪一位客戶身上。
 *
 * 兩條路：身上有冗餘的 `customerId`（來訪、任務、隨手記），或者路徑本身就以
 * `customers/{id}` 開頭（客戶本人、額度、本輪可用性）。兩條都答不出來回 null。
 */
export function customerIdOf(event) {
  const d = merged(event);
  if (d.customerId) return String(d.customerId);
  const parts = String(event?.targetPath ?? '').split('/').filter(Boolean);
  return parts[0] === 'customers' && parts[1] ? parts[1] : null;
}

/**
 * 這一則要印哪一個名字。
 *
 * 順序是「身上有的 → 自己就是那個人 → 靠 id 去問」。
 * `nameOf` 沒傳、或問不到，就**不講名字**，不要編一個。
 */
function whoOf(event, nameOf) {
  const d = merged(event);
  if (d.customerName) return d.customerName;
  if (targetCollection(event?.targetPath) === 'customers' && d.name) return d.name;
  const id = customerIdOf(event);
  return (id && nameOf ? nameOf(id) : null) || null;
}

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

// ---------- 句子裡的零件 ----------
//
// 每一支都只回「講得出來的那一段」，講不出來回 null，由 `bits()` 濾掉。
// 半句話（`・9/14(日)・`、空的引號）比沒有那一段糟得多。

/** 一串零件收成一句，空的丟掉。 */
const bits = (...parts) => parts.filter((x) => x != null && x !== '').join('・');

/** 那一天。全站寫的都是 `9/14(日)`，只有這裡以前印原始的 `2026-09-14`。 */
const when = (iso) => (iso ? shortDate(iso) : null);

/** 引號裡那一句。空字串不要印成一對空引號。 */
const quoted = (text) => {
  const t = String(text ?? '').trim();
  return t ? `「${t}」` : null;
};

/** `'2026-09'` → `'9 月'`。 */
const monthLabel = (month) => {
  const m = Number(String(month ?? '').split('-')[1]);
  return Number.isFinite(m) && m ? `${m} 月` : null;
};

/** 這一筆來訪的那幾項。課程名走 `visitCourseLabel()`，不要在這裡再去重一次。 */
const courses = (d) => ((d.slots ?? []).length ? visitCourseLabel(d) : null);

/** 行事備註的日期範圍。跨天才印兩個 —— 同一天印兩次是多的。 */
function eventRange(d) {
  const from = when(d.startDate);
  if (!from) return null;
  const to = d.endDate && d.endDate !== d.startDate ? when(d.endDate) : null;
  const time = !d.allDay && d.startTime ? d.startTime : null;
  return to ? `${from}–${to}` : bits(from, time);
}

/** 本輪可用性在講哪個月。`monthOf()` 看的是 `validFrom`（ADR-0036）。 */
const availabilityMonth = (d) => {
  const label = monthLabel(monthOf(d));
  return label ? `${label}的本輪可用性` : '本輪可用性';
};

/** 額度的次數怎麼唸。營養品論月，其餘論次（ADR-0057、0059）。 */
function qtyOf(d) {
  const n = Number(d.totalQty);
  if (!Number.isFinite(n)) return null;
  return isProduct(d) ? `${n} 個月` : `${n} 次`;
}

/**
 * 次數在句子裡的短名。
 *
 * 跟 `FIELD_LABELS` 差在少了「次數」兩個字：句子後面已經接著「次」了，
 * 「已排未上次數 1 → 2 次」會疊字。這三個詞就是試算表那張表的欄位標題
 * （`sheets/readonly-report.gs` 的 `['療程項目','應有','已完成','已排未上','剩餘']`）
 * —— 她在兩個地方看到的是同一組字。
 */
const COUNT_LABELS = { totalQty: '應有', doneCount: '已完成', bookedCount: '已排未上' };

/** 次數變化：`已排未上 1 → 2 次`。單位跟著上面那一支走。 */
function countChanges(d, fields) {
  const unit = isProduct(d) ? '個月' : '次';
  return fields
    .map((x) => `${COUNT_LABELS[x.key] ?? fieldLabel(x.key)} ${formatValue(x.before)} → ${formatValue(x.after)} ${unit}`)
    .join('、');
}

// ---------- 規則 ----------

/**
 * 一則稽核的那一句話，拆成兩半。
 *
 * 規則由上到下比，第一個對上的算數。**比不上就回 null**，
 * 由畫面退回欄位表 —— 硬要湊一句話出來，湊錯的那幾則會比欄位表更難查。
 *
 * `lead` 是「印在名字前面」的那個動詞（新增、勾掉、刪掉），
 * `text` 是「印在名字後面」的其餘部分。分開才組得出
 * 「新增 某某・9/14(日)・復能」而不是「某某・新增・9/14(日)・復能」。
 *
 * 每一條都要能回答「她會怎麼跟人講這件事」：她不會說「修改來訪，status
 * 由 confirmed 變更為 done」，她會說「那個人 9/14 那一場變成已完成了」。
 */
const SENTENCES = [
  // ---- 來訪 ----
  {
    when: (e) => coll(e) === 'visits' && opOf(e) === 'create',
    say: (e, f, d) => ({ lead: '新增', text: bits(when(d.date), courses(d)) }),
  },
  {
    when: (e) => coll(e) === 'visits' && opOf(e) === 'softDelete',
    say: (e, f, d) => ({ lead: '刪掉', text: bits(when(d.date), courses(d)) }),
  },
  // 狀態變化是這份紀錄裡最常被回頭查的一種：次數就是跟著它扣的。
  {
    when: (e, f) => coll(e) === 'visits' && f.some((x) => x.key === 'status'),
    say: (e, f, d) => ({
      text: bits(
        when(d.date), courses(d),
        `改成${formatField('status', f.find((x) => x.key === 'status').after)}`,
      ),
    }),
  },
  // 改期。**舊日期要從 `before` 拿** —— `merged()` 給的 `date` 已經是新的了。
  // 這一條排在狀態變化後面：改期同時改狀態的話，狀態才是那一則的主角。
  {
    when: (e, f) => coll(e) === 'visits' && opOf(e) === 'update'
      && f.some((x) => x.key === 'date'),
    say: (e, f, d) => {
      const x = f.find((c) => c.key === 'date');
      return { text: bits(when(x.before), courses(d), `改期到 ${when(x.after)}`) };
    },
  },
  // 「禮拜一再問問」那一句。它不是任務也不是備註（CONTEXT.md），所以自己一條。
  {
    when: (e, f) => coll(e) === 'visits' && f.length > 0
      && f.every((x) => x.key === 'followupNote'),
    say: (e, f, d) => ({
      text: bits(when(d.date), `記了一句${quoted(f[0].after) ?? '（清掉了）'}`),
    }),
  },

  // ---- 任務 ----
  //
  // 任務身上**沒有**來訪日與課程名，也不該有（那會是第二份會對不起來的資料）。
  // 不要拿 `dueDate + 1` 反推來訪日：取消類的任務不是那樣算的
  //（`taskRules.js` 的 `cancelTask()`），反推出來的日期會有一部分是錯的。
  {
    when: (e, f) => coll(e) === 'tasks' && f.some((x) => x.key === 'done'),
    say: (e, f, d) => ({
      lead: f.find((x) => x.key === 'done').after ? '勾掉' : '取消勾選',
      text: d.kind ?? '任務',
    }),
  },

  // ---- 隨手記（＝日曆上的「待辦」那一類，ADR-0044）----
  //
  // 「勾掉某某的某某」就是在這裡生出來的：以前這一條把 `subjectOf()` 當成
  // 「勾掉什麼」，而它的第一順位是 `customerName`。要印的是**那一句話本身**。
  {
    when: (e) => coll(e) === 'notes' && opOf(e) === 'create',
    say: (e, f, d) => ({ lead: '新增待辦', text: bits(when(d.date), quoted(d.text)) }),
  },
  {
    when: (e) => coll(e) === 'notes' && opOf(e) === 'softDelete',
    say: (e, f, d) => ({ lead: '刪掉待辦', text: quoted(d.text) ?? '' }),
  },
  {
    when: (e, f) => coll(e) === 'notes' && f.some((x) => x.key === 'done'),
    say: (e, f, d) => ({
      lead: f.find((x) => x.key === 'done').after ? '勾掉待辦' : '取消勾選待辦',
      text: quoted(d.text) ?? '',
    }),
  },
  {
    when: (e, f) => coll(e) === 'notes' && f.length === 1 && f[0].key === 'date',
    say: (e, f, d) => ({
      text: bits(
        `待辦${quoted(d.text) ?? ''}`,
        f[0].after ? `改到 ${when(f[0].after)}` : '從日曆拿掉',
      ),
    }),
  },

  // ---- 行事備註與休假 ----
  //
  // 同一個集合裡放著兩類（ADR-0045），而它們在日曆上是兩種東西。
  {
    when: (e) => coll(e) === 'events' && opOf(e) === 'create',
    say: (e, f, d) => ({
      lead: `新增${describeKind(e)}`,
      text: bits(quoted(d.title), eventRange(d)),
    }),
  },
  {
    when: (e) => coll(e) === 'events' && opOf(e) === 'softDelete',
    say: (e, f, d) => ({ lead: `刪掉${describeKind(e)}`, text: quoted(d.title) ?? '' }),
  },

  // ---- 本輪可用性 ----
  //
  // 她的原話：「不要寫新增本輪可用性？這是什麼意思？要寫新增誰.什麼」。
  // 名字靠 `nameOf` 解析（這個集合身上沒有），月份看 `validFrom`（ADR-0036）。
  {
    when: (e) => coll(e) === 'availability' && opOf(e) === 'create',
    say: (e, f, d) => ({
      lead: '新增',
      text: bits(
        availabilityMonth(d),
        banCount(d) ? `${banCount(d)} 條不能的時間` : '沒有說哪天不行',
      ),
    }),
  },
  {
    when: (e) => coll(e) === 'availability' && opOf(e) === 'softDelete',
    say: (e, f, d) => ({ lead: '刪掉', text: availabilityMonth(d) }),
  },
  {
    // 改了哪幾條走 `describeRuleChanges()` —— 存檔前講給她聽的是同一支
    //（ADR-0053），兩邊算出不同的差異會讓她以為其中一邊壞了。
    when: (e, f) => coll(e) === 'availability' && f.some((x) => x.key === 'rules'),
    say: (e, f, d) => {
      const x = f.find((c) => c.key === 'rules');
      const diff = describeRuleChanges(x.before ?? [], x.after ?? []);
      return {
        text: bits(
          availabilityMonth(d),
          diff.added.length ? `多了 ${diff.added.join('、')}` : null,
          diff.removed.length ? `少了 ${diff.removed.join('、')}` : null,
        ),
      };
    },
  },

  // ---- 額度與營養品 ----
  {
    when: (e) => coll(e) === 'entitlements' && opOf(e) === 'create',
    say: (e, f, d) => ({
      lead: isProduct(d) ? '新增營養品' : '新增額度',
      text: bits(d.label, qtyOf(d)),
    }),
  },
  {
    when: (e) => coll(e) === 'entitlements' && opOf(e) === 'softDelete',
    say: (e, f, d) => ({
      lead: isProduct(d) ? '刪掉營養品' : '刪掉額度',
      text: d.label ?? '',
    }),
  },
  {
    // 次數只會因為來訪狀態變化而動（SPEC 4.2），所以它旁邊一定有一筆來訪的紀錄。
    // `lastReconciledAt` 已經被 QUIET_IN_SENTENCE 濾掉了，所以對帳寫進來的那一則
    // 也會落在這裡，而不是掉進底下的「一般的修改」。
    when: (e, f) => coll(e) === 'entitlements' && f.length > 0
      && f.every((x) => ['doneCount', 'bookedCount', 'totalQty'].includes(x.key)),
    say: (e, f, d) => ({ text: bits(d.label, countChanges(d, f)) }),
  },
  {
    // 只動到對帳時間：那一則做的事就是「對過了」。
    when: (e, f) => coll(e) === 'entitlements' && opOf(e) === 'update' && f.length === 0,
    say: (e, f, d) => ({ text: bits(d.label, '對帳過了') }),
  },

  // ---- 時間表單 ----
  {
    when: (e) => coll(e) === 'formInvites' && opOf(e) === 'create',
    say: (e, f, d) => ({ lead: '發出時間表單連結', text: monthLabel(d.month) ?? '' }),
  },
  {
    when: (e, f) => coll(e) === 'formResponses' && f.some((x) => x.key === 'takenAt'),
    say: (e, f, d) => ({
      text: monthLabel(d.month) ? `收下他填的 ${monthLabel(d.month)}時間` : '收下他填的時間',
    }),
  },

  // ---- 客戶本人 ----
  {
    when: (e) => coll(e) === 'customers' && opOf(e) === 'create',
    say: () => ({ lead: '新增客戶', text: '' }),
  },
  {
    when: (e) => coll(e) === 'customers' && opOf(e) === 'softDelete',
    say: () => ({ lead: '刪掉客戶', text: '' }),
  },

  // ---- 其餘（設定主檔那些）----
  {
    when: (e) => opOf(e) === 'create',
    say: (e, f, d) => ({ lead: `新增${describeKind(e)}`, text: quoted(selfNameOf(d)) ?? '' }),
  },
  {
    when: (e) => opOf(e) === 'softDelete',
    say: (e, f, d) => ({ lead: `刪掉${describeKind(e)}`, text: quoted(selfNameOf(d)) ?? '' }),
  },
  // 一般的修改：講改了哪幾個欄位，不講改成什麼 —— 那是展開之後的事。
  {
    when: (e, f) => opOf(e) === 'update' && f.length > 0 && f.length <= 3,
    say: (e, f, d) => ({
      lead: '改了',
      text: bits(hasOwnName(e) ? null : selfNameOf(d), f.map((x) => x.label).join('、')),
    }),
  },
  {
    when: (e, f) => opOf(e) === 'update' && f.length > 3,
    say: (e, f, d) => ({
      lead: '改了',
      text: bits(hasOwnName(e) ? null : selfNameOf(d), `${f.length} 個欄位`),
    }),
  },
];

/** `'customers/c1/entitlements.update'` → `'entitlements'`。 */
const coll = (event) =>
  String(event?.action ?? '').split('.')[0].split('/').filter(Boolean).pop() ?? '';

/** `visits.update` → `update`。 */
export const opOf = (event) => String(event?.action ?? '').split('.')[1] ?? '';

/** 這一筆自己叫什麼（不是它掛在誰身上）。設定主檔那些靠它。 */
const selfNameOf = (d) => d.name || d.title || d.label || d.text || null;

/** 名字已經由 `who` 印出來了嗎 —— 印過就不要在 `text` 裡再印一次。 */
const hasOwnName = (event) => targetCollection(event?.targetPath) === 'customers';

/**
 * 兩半接起來。
 *
 * `who` 給 null 就是「照人分組」那一格要的樣子 —— 抬頭已經寫著名字了。
 * 兩個畫面共用這一支，所以它們不可能講得不一樣。
 */
export function joinParts({ who = null, lead = null, text = '' } = {}) {
  const head = [lead, who].filter(Boolean).join(' ');
  if (!head) return text;
  if (!text) return head;
  // 分隔號有三種情況，每一種都是為了讀起來像一句話：
  //   有名字            →「新增 某某・9/14(一)・復能」
  //   沒名字、後面是引號 →「新增課程「復能」」（多一個分隔號只是噪音）
  //   沒名字、其餘       →「新增 9/14(一)・復能」（照人分組那一格就是這一種）
  let sep = '・';
  if (!who) sep = text.startsWith('「') ? '' : ' ';
  return `${head}${sep}${text}`;
}

/**
 * 一則稽核拆成「誰」與「做了什麼」兩半。翻譯不出來回 null。
 *
 * @param {object} event
 * @param {{nameOf?: (customerId: string) => (string|null)}} [ctx]
 *   nameOf：id → 名字。額度與本輪可用性身上沒有名字，只有路徑上有 id。
 *   **沒傳就不講名字**，不要編一個（`subjectOf()` 的檔頭同一條規矩）。
 * @returns {{who: string|null, whoId: string|null, lead: string|null, text: string}|null}
 */
export function describeParts(event, { nameOf = null } = {}) {
  const fields = changedFields(event).filter((x) => !QUIET_IN_SENTENCE.has(x.key));
  const d = merged(event);

  const rule = SENTENCES.find((r) => r.when(event, fields, d));
  if (!rule) return null;

  const { lead = null, text = '' } = rule.say(event, fields, d);
  return {
    who: whoOf(event, nameOf),
    whoId: customerIdOf(event),
    lead,
    text: text ?? '',
  };
}

/**
 * 這一則用一句話講的話是什麼。翻譯不出來回 null。
 *
 * @returns {string|null}
 */
export function describeEvent(event, ctx = {}) {
  const parts = describeParts(event, ctx);
  // 湊出空字串也算「翻不出來」：`''` 不是 nullish，呼叫端的 `?? 退路` 接不住它，
  // 畫面上會出現一列什麼都沒有的稽核。
  return (parts ? joinParts(parts) : null) || null;
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
