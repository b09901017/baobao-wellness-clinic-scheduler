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
// ## 兩種分組，同一批資料（2026-09-01）
//
// 她的原話：「也許可以以人為群組分類呈現？用客戶姓名作為大標題，底下條列式
// 列出對他做了什麼事」。所以現在有兩種看法，而**流程分段沒有被推翻** ——
// 它變成其中一種：
//
//     照人   →「這個人今天處理完了沒」（壓了表、確認了、掛號了）
//     照流程 →「哪一類整個漏了」（例如整天一張療程單都沒簽）
//
// 兩種都是同一批稽核的排法，不多讀一次也不多寫一筆。
// 「最後一段永遠收得下剩下的、一則都不可以被丟掉」對兩種都成立。
//
// ## 這裡只翻譯與歸類，一件事都不判斷
//
// 跟 `domain/audit.js` 同一條界線。時間怎麼印是畫面的事（那要 Timestamp，
// 而這一層不碰 IO），所以每一列原樣帶著 `at`。
//
// 句子也不在這裡組：`describeParts()` 給「誰」與「做了什麼」兩半，
// 這裡只決定哪一半要印（照人那一格不印名字，抬頭已經寫了）。

import {
  describeParts, joinParts, describeAction, changedFields, opOf,
} from './audit.js';
import { RECORD_TASK_KIND } from './taskRules.js';

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
    //
    // 「寫紀錄」要排掉：它有自己的一段（⑥），而那一段在流程上排在這裡後面。
    // 陣列的順序就是她做事的順序（見上面），所以修的是這一段的條件，
    // 不是把新的一段插到前面來 —— 插到前面的話讀的人要在腦袋裡重排一次。
    match: (e, f) => tickedTask(e, f) && kindOf(e) !== RECORD_TASK_KIND,
  },
  {
    id: 'close',
    label: '簽療程單',
    n: '⑤',
    match: (e, f) => collectionOf(e) === 'visits' && ['done', 'no_show'].includes(statusTo(f)),
  },
  {
    // 客人走了之後去外面那個系統補的那一份（ADR-0066）。
    // 2026-09-04 她說「好啊可以另外開一段給它」—— 在這之前它落進④「登記掛號」，
    // 而段落名在講一件它收不到的事（同「取消與改期」當初漏掉改期的毛病）。
    id: 'record',
    label: '寫紀錄',
    n: '⑥',
    match: (e, f) => tickedTask(e, f) && kindOf(e) === RECORD_TASK_KIND,
  },
  {
    id: 'cancel',
    label: '取消與改期',
    n: '⑦',
    // **改期也算在這一段。** 這一段叫「取消與改期」，而改一筆來訪的日期以前
    // 落進最後的「其他」—— 段落名在講一件它收不到的事，比沒講還糟。
    match: (e, f) => collectionOf(e) === 'visits'
      && (statusTo(f) === 'cancelled'
        || opOf(e) === 'softDelete'
        || (opOf(e) === 'update' && f.some((x) => x.key === 'date'))),
  },
  {
    id: 'calendar',
    label: '日曆與待辦',
    n: '⑧',
    match: (e) => ['events', 'notes'].includes(collectionOf(e)),
  },
  {
    id: 'customer',
    label: '客戶與額度',
    n: '⑨',
    match: (e) => ['customers', 'entitlements'].includes(collectionOf(e)),
  },
  {
    id: 'settings',
    label: '設定',
    n: '⑩',
    // `config/courses.create` 這種。路徑的第一段是 config。
    match: (e) => String(e?.action ?? '').startsWith('config/'),
  },
  {
    id: 'other',
    label: '其他',
    n: '⑪',
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

/**
 * 這一則是不是「把一張任務勾掉了」。**勾掉才算做了** —— 取消勾選是把一件事
 * 放回去，不是做完它。④與⑥兩段共用，兩份寫法遲早有一份會漏掉那個方向。
 */
function tickedTask(event, fields) {
  return collectionOf(event) === 'tasks'
    && fields.some((x) => x.key === 'done' && x.after === true);
}

/**
 * 那一張任務是哪一種。
 *
 * 稽核那一則的 `before` 是**整份舊文件**（`data/repo.js` 的 `commit()` 寫的），
 * 所以問得到。不用多讀一次任務，也不用多寫一個欄位 ——
 * ADR-0062：這一頁不可以為了它多寫任何一筆資料。
 */
function kindOf(event) {
  return event?.before?.kind ?? null;
}

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
 * 沒有掛在任何客戶身上的那一組，抬頭寫這個。
 *
 * **刻意不叫「其他」** —— 那三個字已經是流程分段的最後一段（`STAGES` 的
 * `other`），兩個「其他」在同一塊畫面上會讓人以為是同一件事。
 * 這一組裡的是設定、行事備註、休假這種本來就不屬於某一個人的東西。
 */
export const NOBODY = '沒有掛客戶';

/**
 * 今天做了什麼。
 *
 * **兩種分組，同一批資料。** 兩種看法回答的是兩個不同的問題，而她兩個都會問：
 *
 * | 看法 | 回答 |
 * |---|---|
 * | `people` | 「這個人今天處理完了沒」—— 壓了表、確認了、掛號了 |
 * | `groups` | 「哪一類整個漏了」—— 例如整天一張療程單都沒簽 |
 *
 * 所以 ADR-0062 的流程分段沒有被推翻，它變成兩種看法的其中一種。
 * **一則都不可以被丟掉**這條規矩對兩種分組都成立（見底下的測試）。
 *
 * @param {object[]} events 那一天的稽核，**新的在前**（`listOnDay()` 給的順序）
 * @param {{limit?: number|null, nameOf?: ((id: string) => (string|null))|null}} [o]
 *   nameOf：id → 名字。額度與本輪可用性身上沒有名字，只有路徑上有 id
 *   （`domain/audit.js`）。沒傳的話那幾則會落進「沒有掛客戶」那一組。
 * @returns {{groups: object[], people: object[], tiles: object[],
 *            total: number, truncated: boolean}}
 */
export function reviewOf(events = [], { limit = null, nameOf = null } = {}) {
  const buckets = new Map(STAGES.map((s) => [s.id, []]));
  // Map 的順序就是「第一次碰到」的順序，而事件是新的在前 ——
  // 所以自然就是「最近處理過的人排最上面」，不用另外排一次。
  const byPerson = new Map();

  for (const event of events ?? []) {
    const fields = changedFields(event);
    const stage = STAGES.find((s) => s.match(event, fields)) ?? STAGES[STAGES.length - 1];
    const parts = describeParts(event, { nameOf });
    // 翻不出一句話就退回「修改來訪」那種 —— 跟 `views/audit.js` 的
    // `rowHtml()` 同一條退路。硬湊一句錯的比退回去糟。
    const fallback = describeAction(event.action);

    const at = event.at ?? null;
    // `|| fallback`（不是 `??`）：湊出空字串也要退回去，那一列不可以是空白。
    buckets.get(stage.id).push({ at, text: (parts ? joinParts(parts) : '') || fallback });

    // 照人那一格的那一列**不含名字**：抬頭已經寫著了，再印一次是雜訊。
    const key = parts?.whoId ?? parts?.who ?? null;
    if (!byPerson.has(key)) {
      byPerson.set(key, { who: parts?.who ?? null, whoId: parts?.whoId ?? null, rows: [] });
    }
    byPerson.get(key).rows.push({
      at,
      text: (parts ? joinParts({ ...parts, who: null }) : '') || fallback,
      stage: stage.label,
    });
  }

  const groups = STAGES
    .map((s) => ({ stage: s, rows: collapse(buckets.get(s.id)), n: buckets.get(s.id).length }))
    .filter((g) => g.rows.length);

  const people = [...byPerson.values()]
    .map((p) => ({
      ...p,
      n: p.rows.length,
      // **一個人身上的事是一條線**（壓表 → 確認 → 掛號），照她做的順序讀
      // 才連得起來，所以由早到晚。收合仍然走同一支 `collapse()`（它吃的是
      // 新的在前那個順序，收完再倒過來），照流程那一格維持新的在前 ——
      // 那一格問的是「我剛剛做了什麼」。
      rows: collapse(p.rows).reverse(),
    }))
    // 沒有掛客戶的永遠排最後 —— 那些不是「一個人」。
    .sort((a, b) => Number(a.who == null) - Number(b.who == null));

  const tiles = TILES
    .map((t) => ({ ...t, n: buckets.get(t.id).length }))
    .filter((t) => t.n > 0);

  const total = (events ?? []).length;
  return {
    groups,
    people,
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
