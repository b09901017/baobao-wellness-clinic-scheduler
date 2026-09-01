// 「今天做了什麼」。ADR-0062。純函式。
//
// 她的原話：
//
// > 我需要一個能回顧今天操作紀錄的介面（例如：壓了誰的表、在 Abovee/Examine
// > 弄了誰、簽了哪些療程單、記錄了哪些日曆/Todo/來訪）。目的：確認是否有遺漏登記。
//
// **這是稽核紀錄的白話版，不是第二份紀錄。** 素材全部已經在了：
// 每一次寫入都跟著本體資料寫在同一個 batch 裡（SPEC 第 6.2 節），而
// `domain/audit.js` 的 `describeEvent()` 早就會把一則翻成一句話。
// 缺的只有兩件：**一層歸類**與**一個入口**。
//
// 為這一頁多開一個集合去記「她今天做了什麼」是最糟的做法：那會是第二份會
// 對不起來的資料，而且是唯一一份不在稽核裡的 —— 出事那天它是唯一查不回去的
//（同 ADR-0057 對做法 B 的判斷）。
//
// ## 分段照的是她的流程，不是集合名
//
// 跟待辦中心同一條順序（ADR-0043）：她一天就是照那個順序做的，兩頁用不同的
// 順序等於要她在腦子裡翻譯一次。所以這裡不會出現「visits」「notes」這種字，
// 出現的是「壓表」「簽療程單」。
//
// ## 這裡只翻譯與歸類，一件事都不判斷
//
// 跟 `domain/audit.js` 同一條界線。時間怎麼印是畫面的事（那要 Timestamp，
// 而這一層不碰 IO），所以每一列原樣帶著 `at`。

import { describeEvent, describeAction, changedFields, opOf } from './audit.js';

/**
 * 一段。**順序就是她的流程順序**，空的段不畫。
 *
 * `match(event, fields)` 由上到下比，**第一個對上的算數** ——
 * 所以「取消」要排在「壓表」後面（取消也是 `visits.update`），
 * 而「其他」永遠在最後面收尾。
 */
const STAGES = [
  {
    id: 'ask',
    label: '問到時間',
    n: '①',
    match: (e) => ['formInvites', 'formResponses', 'availability'].includes(collectionOf(e)),
  },
  {
    id: 'book',
    label: '壓表',
    n: '②',
    match: (e) => collectionOf(e) === 'visits' && opOf(e) === 'create',
  },
  {
    id: 'confirm',
    label: '跟客人確認',
    n: '③',
    match: (e, f) => collectionOf(e) === 'visits' && opOf(e) === 'update'
      && (statusTo(f) === 'confirmed' || f.some((x) => x.key === 'followupNote')),
  },
  {
    id: 'register',
    label: '登記掛號',
    n: '④',
    // **勾掉才算「做了」。** 取消勾選是把一件事放回去，不是做完它。
    match: (e, f) => collectionOf(e) === 'tasks'
      && f.some((x) => x.key === 'done' && x.after === true),
  },
  {
    id: 'close',
    label: '簽療程單',
    n: '⑤',
    match: (e, f) => collectionOf(e) === 'visits' && ['done', 'no_show'].includes(statusTo(f)),
  },
  {
    id: 'cancel',
    label: '取消與改期',
    n: '⑥',
    match: (e, f) => collectionOf(e) === 'visits'
      && (statusTo(f) === 'cancelled' || opOf(e) === 'softDelete'),
  },
  {
    id: 'calendar',
    label: '日曆與待辦',
    n: '⑦',
    match: (e) => ['events', 'notes'].includes(collectionOf(e)),
  },
  {
    id: 'customer',
    label: '客戶與額度',
    n: '⑧',
    match: (e) => ['customers', 'entitlements'].includes(collectionOf(e)),
  },
  {
    id: 'settings',
    label: '設定',
    n: '⑨',
    // `config/courses.create` 這種。路徑的第一段是 config。
    match: (e) => String(e?.action ?? '').startsWith('config/'),
  },
  {
    id: 'other',
    label: '其他',
    n: '⑩',
    // **什麼都收得下的最後一段。** 一則都不可以被丟掉 —— 她開這一頁是為了
    // 確認沒有漏掉東西，而一個安靜消失的項目正好是最該被看到的那一種。
    match: () => true,
  },
];

/** 頂端那一排摘要數字：哪幾段值得給一個數字。 */
const TILES = [
  { id: 'book', label: '壓了', unit: '筆' },
  { id: 'close', label: '簽了', unit: '張單' },
  { id: 'register', label: '登記', unit: '筆' },
  { id: 'calendar', label: '記了', unit: '件' },
];

/** `'customers/abc/entitlements.create'` → `'entitlements'`。 */
function collectionOf(event) {
  const path = String(event?.action ?? '').split('.')[0];
  return path.split('/').filter(Boolean).pop() ?? '';
}

/** 這一則把狀態改成什麼。沒改狀態回 null。 */
function statusTo(fields) {
  return fields.find((x) => x.key === 'status')?.after ?? null;
}

/**
 * 一模一樣的句子**連著**出現就收成一則，右邊寫「×8」。
 *
 * 她一次壓表會連續存十幾筆，`勾掉 Examine` 出現八次是雜訊。
 *
 * **只收連著的，不是全天去重**：她早上勾了三張 Examine、下午又勾了兩張，
 * 那是兩件事（中間隔著別的動作）。全天去重會把「下午又做了一次」藏起來，
 * 而那正是她要確認的東西。
 */
function collapse(rows) {
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.text === row.text) {
      last.times += 1;
      // 收成一則之後，時間留**最早**那一下 —— 那是她開始做那件事的時間。
      last.at = row.at;
    } else {
      out.push({ ...row, times: 1 });
    }
  }
  return out;
}

/**
 * 今天做了什麼。
 *
 * @param {object[]} events 那一天的稽核，**新的在前**（`listOnDay()` 給的順序）
 * @returns {{groups: object[], tiles: object[], total: number, truncated: boolean}}
 *   groups：只含有東西的那幾段，照流程順序
 *   tiles：頂端那一排數字，只含有值的
 *   total：一共幾則（收合前）
 */
export function reviewOf(events = [], { limit = null } = {}) {
  const buckets = new Map(STAGES.map((s) => [s.id, []]));

  for (const event of events ?? []) {
    const fields = changedFields(event);
    const stage = STAGES.find((s) => s.match(event, fields)) ?? STAGES[STAGES.length - 1];
    buckets.get(stage.id).push({
      at: event.at ?? null,
      // 翻不出一句話就退回「修改來訪」那種 —— 跟 `views/audit.js` 的
      // `rowHtml()` 同一條退路。硬湊一句錯的比退回去糟。
      text: describeEvent(event) ?? describeAction(event.action),
    });
  }

  const groups = STAGES
    .map((s) => ({ stage: s, rows: collapse(buckets.get(s.id)), n: buckets.get(s.id).length }))
    .filter((g) => g.rows.length);

  const tiles = TILES
    .map((t) => ({ ...t, n: buckets.get(t.id).length }))
    .filter((t) => t.n > 0);

  const total = (events ?? []).length;
  return {
    groups,
    tiles,
    total,
    // 撈到上限就講出來 —— 靜靜截斷的話她會以為那幾筆沒發生（SPEC 第 6.9 節）。
    truncated: Boolean(limit) && total >= limit,
  };
}

/**
 * 那一天的抬頭要寫什麼。今天、昨天，再遠就寫日期 ——
 * 她想的是「那是今天還是昨天的事」（同 `views/audit.js` 的 `dayLabel()`）。
 */
export function dayTitle(day, today) {
  if (day === today) return '今天';
  const [, m, d] = String(day ?? '').split('-');
  if (!m || !d) return '？';
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** 一整天什麼都沒做的時候講的那句話。 */
export const NOTHING = '這一天沒有留下任何紀錄。';
