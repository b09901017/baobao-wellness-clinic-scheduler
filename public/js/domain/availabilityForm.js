// 客戶自己填的那份時間。純函式。
//
// 她問時間的流程第一步以前只有一條路：她在 LINE 上問、客戶回一段話、
// 她轉述進 app、解析器去猜。這一支是第二條路 —— **客戶填的東西一出生就是
// 結構化的**，不必猜。設計與取捨見 `.scratch/customer-availability-form/spec.md`。
//
// 這裡有三件事：
//
// 1. **邀請**（一位客戶一個月一條連結）的形狀與有效期
// 2. **客戶勾的東西 → 本輪可用性的規則**（`domain/availability.js` 那四種）
// 3. **客戶勾的東西 → 原文**
//
// 第 3 件有一個不變量，`tests/availability-form.test.js` 盯著它：
// **產生的原文餵回 `parseAvailability()` 要得到同一組規則。**
// 她在收集畫面按「用原文重新解析」時不可以拿到不一樣的東西 ——
// 那會讓她以為系統把客戶的話讀成了別的意思。
//
// 也因為這樣，這裡轉出來的規則**刻意不標 `manual`**：標了會在重新解析時
// 被 `mergeRules()` 再加一次，同一條變成兩份。

import { addDays, daysBetween, isValidDate, lastDayOf, shortDate, weekdayOf } from './dates.js';

/** 客戶勾的半天。null 表示整天。 */
export const PART_OF_DAY = ['am', 'pm'];

const PART_LABELS = { am: '上午', pm: '下午' };
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 連續幾天以上就併成一條範圍。一天一列是客戶回報「太亂」的主因（ADR-0034）。 */
const MERGE_RUN = 2;

/** 自由欄的上限。跟 firestore.rules 的 validNewResponse() 是同一個數字。 */
export const FREE_TEXT_MAX = 500;

// ---------- 邀請 ----------

/**
 * 一位客戶一個月一條連結。
 *
 * 有效期預設就是那個月整月，和收集畫面的 `defaultRange()` 一樣 ——
 * 她問的永遠是「下個月」，收下之後那份收集的有效期也是那個月。
 *
 * @param {{customerId:string, customerName:string, month:string, sentAt:string}} args
 *   month 是 'YYYY-MM'
 * @returns {object|null} 月份不合法就回 null，不要湊一份出來
 */
export function newInvite({ customerId, customerName, month, sentAt }) {
  if (!isMonth(month)) return null;

  const [y, m] = month.split('-').map(Number);
  const validFrom = `${month}-01`;
  const validTo = `${month}-${String(lastDayOf(y, m)).padStart(2, '0')}`;

  return {
    customerId: customerId ?? null,
    customerName: customerName ?? '',
    month,
    validFrom,
    validTo,
    sentAt: isValidDate(sentAt) ? sentAt : null,
  };
}

/**
 * 這條連結還能不能填。
 *
 * 過期的邀請不算「已經發出」—— 客戶填不了了，那一位要回到「該重問了」
 * 那一區去（ADR-0033）。
 *
 * @returns {'open'|'expired'|'used'|'none'}
 */
export function inviteState(invite, today, { submitted = false } = {}) {
  if (!invite || invite.deletedAt) return 'none';
  if (submitted) return 'used';
  if (!isValidDate(invite.validTo) || !isValidDate(today)) return 'none';
  return today > invite.validTo ? 'expired' : 'open';
}

/**
 * 要貼到 LINE 的那條網址。
 *
 * 獨立入口而不是 hash 路由，理由見 ADR-0031 —— 客戶不該為了填三題
 * 而下載一整個排班系統。
 */
export function formLink(origin, token) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  return token ? `${base}/form.html?t=${encodeURIComponent(token)}` : '';
}

/**
 * 「問這輪的時間」那一頁的三區。
 *
 * 前兩區是 ADR-0028 就有的，第三區是表單做出來之後才存在的那一段時間：
 * **連結發出去了、客戶還沒填**。她不該在那時候再問一次。
 *
 * `customersToAsk()` 一個字都不改 —— 它回答的問題沒有變（這一輪的時間
 * 還沒問到誰），連結發出去了確實還沒問到。多出來的軸放在這裡。見 ADR-0033。
 *
 * @param {object} ctx
 * @param {object[]} ctx.rows `domain/scheduling.js` 的 `customersToAsk()` 的結果
 * @param {object[]} ctx.invites 全部邀請
 * @param {string} ctx.today
 * @returns {{never:object[], expired:object[], sent:object[]}}
 */
export function splitByInvite({ rows = [], invites = [], today }) {
  const open = new Map();
  for (const invite of invites) {
    if (inviteState(invite, today) !== 'open') continue;
    // 同一位客戶手上有兩條沒過期的連結時，以晚發的那條為準 ——
    // 她重發就是為了取代舊的（表單不重填，改就是重發一條）。
    const seen = open.get(invite.customerId);
    if (!seen || String(invite.sentAt ?? '') >= String(seen.sentAt ?? '')) {
      open.set(invite.customerId, invite);
    }
  }

  const out = { never: [], expired: [], sent: [] };
  for (const row of rows) {
    const invite = open.get(row.customerId);
    if (invite) out.sent.push({ ...row, invite });
    else if (row.state === 'never') out.never.push(row);
    else out.expired.push(row);
  }
  return out;
}

/**
 * 一位客戶在**某一個月**的問時間走到哪一步了。
 *
 * 她 2026-09-02 的原話：「已發連結（如果對方已回覆填寫完 或是他回覆我確認完
 * 都不要消失 就把狀態呈現在已發連結這邊就好）」。
 *
 * 以前那一列會**整個消失**：客戶填完 → 她收下 → 那個月有了一份可用性 →
 * `customersToAsk()` 直接跳過那一位。事情做完了沒有痕跡，等於她要靠腦袋
 * 記得「這個人我問過了」，而那正是這個 app 要消滅的東西。
 *
 * 三種狀態，判斷只有這一份 —— 畫面不要自己再比一次 `takenAt`：
 *
 * | 回的 | 什麼時候 | 她接下來要做什麼 |
 * |---|---|---|
 * | `waiting` | 連結發出去了，還沒收到回覆 | 等，或者過幾天催一下 |
 * | `filled`  | 客戶填了，她還沒按「收下」 | **去收下**（在「客戶填好的時間」那一頁） |
 * | `settled` | 收下了，或那個月本來就有一份 | 沒事了 |
 *
 * `settled` 刻意也認「那個月有一份收集」而不只認 `takenAt`：她自己在 LINE
 * 問完直接記進「不能的時間」的那幾位，事情一樣是做完的。
 *
 * @param {object} ctx
 * @param {object|null} ctx.invite 那個月的邀請
 * @param {object|null} ctx.response 那條連結的回覆（`formResponses/{token}`）
 * @param {object|null} ctx.collection 那個月的本輪可用性
 * @param {string} [ctx.today] 判斷連結過期了沒
 * @returns {{state:'waiting'|'filled'|'settled', label:string,
 *            tone:''|'soon'|'ok', expired:boolean, at:string|null}}
 */
export function inviteProgress({ invite = null, response = null, collection = null, today } = {}) {
  const expired = Boolean(invite) && inviteState(invite, today) === 'expired';

  if (collection || response?.takenAt) {
    return {
      state: 'settled',
      label: '已確認排定',
      tone: 'ok',
      expired,
      at: collection?.collectedAt ?? response?.takenAt ?? null,
    };
  }

  if (response) {
    // 琥珀色不是裝飾：這一格是**她還有事要做**的那一格，而另外兩格不是。
    return { state: 'filled', label: '已填寫時段', tone: 'soon', expired, at: null };
  }

  return { state: 'waiting', label: '等待回覆', tone: '', expired, at: invite?.sentAt ?? null };
}

/**
 * `#/todo/ask` 那一頁的三塊。**照月份分，不照「現在有沒有效」分。**
 *
 * 跟 `splitByInvite()` 是兩支（那一支首頁那一列還在用，一個字都沒改）。
 * 兩個關鍵差別：
 *
 * 1. **邀請看的是 `month` 欄位，不是過不過期。** 9 月那一批連結在 9/30
 *    全部過期，照舊規則整格會在月底突然清空 —— 而她 10/1 回頭看
 *    「9 月到底問到了誰」時，那正是她要看的東西。過期只是那一列上多一句話。
 * 2. **多一塊 `done`**：沒發過連結、但那個月已經有一份可用性的（她自己在
 *    LINE 問完直接記的）。整個藏掉最乾淨，但「東西不見了而畫面上什麼都沒說」
 *    是這個 app 反覆踩過的錯，所以它收在一個摺疊區裡，只給一個數字。
 *
 * @param {object} ctx
 * @param {object[]} ctx.rows `customersToAskForMonth()` 的結果
 * @param {object[]} ctx.invites 全部邀請
 * @param {object[]} ctx.responses 全部回覆（含已經收下的）
 * @param {string} ctx.month 'YYYY-MM'
 * @param {string} [ctx.today]
 * @returns {{todo:object[], sent:object[], done:object[]}}
 */
export function splitByMonth({ rows = [], invites = [], responses = [], month, today } = {}) {
  const mine = new Map();
  for (const invite of invites) {
    if (!invite || invite.deletedAt || invite.month !== month) continue;
    // 同一位客戶在同一個月有兩條時，以晚發的那條為準 —— 她重發就是為了取代舊的
    //（表單不重填，改就是重發一條）。同 `splitByInvite()`。
    const seen = mine.get(invite.customerId);
    if (!seen || String(invite.sentAt ?? '') >= String(seen.sentAt ?? '')) {
      mine.set(invite.customerId, invite);
    }
  }

  const byToken = new Map((responses ?? []).filter(Boolean).map((r) => [r.token ?? r.id, r]));

  const out = { todo: [], sent: [], done: [] };
  for (const row of rows) {
    const invite = mine.get(row.customerId) ?? null;

    if (invite) {
      out.sent.push({
        ...row,
        invite,
        progress: inviteProgress({
          invite,
          response: byToken.get(invite.id) ?? null,
          collection: row.collection,
          today,
        }),
      });
      continue;
    }

    if (row.collection) out.done.push(row);
    else out.todo.push(row);
  }

  return out;
}

// ---------- 客戶勾的東西 ----------

/**
 * 把客戶勾的東西清乾淨：去掉不合法的、重複的，排好順序。
 *
 * 前端送什麼過來都要先過這一關 —— 客戶那一頁跑在別人的手機上，
 * 而 Rules 擋得掉形狀不對的，擋不掉「同一天送兩次」。
 *
 * `weekdays` 表單已經不問了（每一格都用點的，見 ADR-0034），但形狀留著：
 * 已經送出的那幾份裡有它，而「整個禮拜五不行」現在是從日期**推**出來的。
 */
export function normalizePicks({ weekdays = [], dates = [] } = {}) {
  const byWeekday = new Map();
  for (const pick of weekdays) {
    const weekday = Number(pick?.weekday);
    if (!(weekday >= 0 && weekday <= 6)) continue;
    byWeekday.set(weekday, { weekday, partOfDay: partOf(pick) });
  }

  const byDate = new Map();
  for (const pick of dates) {
    if (!isValidDate(pick?.date)) continue;
    byDate.set(pick.date, { date: pick.date, partOfDay: partOf(pick) });
  }

  return {
    weekdays: [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday),
    dates: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const partOf = (pick) => (PART_OF_DAY.includes(pick?.partOfDay) ? pick.partOfDay : null);

// ---------- 收合 ----------

/**
 * 把一堆點掉的日子收成看得懂的幾句話。**這一支是規則、原文、複述三邊共用的來源**，
 * 所以三邊講的話永遠一樣 —— 客戶按下送出時看到的字，就是她收到的字。
 *
 * 三層，由大到小：
 *
 * 1. **整個月都點掉了** → 一條範圍。不然會變成七條「每個禮拜X不行」
 * 2. **某個星期整個月都點掉了** → 一條「每個禮拜五不行」
 * 3. **剩下的連續日子** → 一條範圍（兩天以上就收）
 *
 * 第 2 層的條件刻意嚴格：**那個月裡的每一個禮拜五都要被點到，而且半天別一致**，
 * 少一個就不收。少的那一天他是真的可以，收成「每個禮拜五」會把它一起擋掉 ——
 * 而「多擋一天」在排班上是看不出來的錯，她只會覺得這個客戶怎麼那麼難排。
 *
 * 回傳的 `spans` 是**照日期排好的一串**，單獨一天就是 `from === to`。
 * 刻意不把「範圍」和「單獨一天」分成兩個陣列：分開的話唸出來會變成
 * 「9/7~9/8、9/1、9/9」—— 客戶自己講的順序是日曆的順序，讀的人也是。
 *
 * @param {{weekdays?:object[], dates?:object[]}} picks
 * @param {{month?:string}} [opts] 'YYYY-MM'。沒給就只做第 3 層
 * @returns {{weekdays:object[], spans:{from:string,to:string,partOfDay:?string}[], whole:boolean}}
 */
export function groupPicks(picks, { month = null } = {}) {
  const { weekdays, dates } = normalizePicks(picks);
  const left = new Map(dates.map((d) => [d.date, d.partOfDay]));
  const out = { weekdays: [...weekdays], spans: [], whole: false };

  if (isMonth(month)) {
    const all = monthDates(month);

    // 1. 整個月，而且都是整天。半天不收 —— exclude_range 沒有 partOfDay 可以放。
    if (all.length && all.every((d) => left.has(d) && left.get(d) === null)) {
      return {
        weekdays: out.weekdays,
        spans: [{ from: all[0], to: all[all.length - 1], partOfDay: null }],
        whole: true,
      };
    }

    // 2. 某個星期整個月都被點掉
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      const days = all.filter((d) => weekdayOf(d) === weekday);
      if (!days.length || !days.every((d) => left.has(d))) continue;
      const part = left.get(days[0]);
      if (!days.every((d) => left.get(d) === part)) continue;

      if (!out.weekdays.some((w) => w.weekday === weekday)) {
        out.weekdays.push({ weekday, partOfDay: part });
      }
      for (const d of days) left.delete(d);
    }
    out.weekdays.sort((a, b) => a.weekday - b.weekday);
  }

  // 3. 剩下的照連續分組。runsOf() 收到的是排好序的，所以 spans 天生照日期排。
  const rest = [...left.entries()]
    .map(([date, partOfDay]) => ({ date, partOfDay }))
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const group of runsOf(rest)) {
    out.spans.push({
      from: group[0].date,
      to: group[group.length - 1].date,
      partOfDay: group[0].partOfDay,
    });
  }

  return out;
}

/**
 * 連續的整天分成一組，兩天以上才算一段。
 * 半天的自己一組，永遠不會被併進範圍 —— 「9/22 整天、9/23 只有下午」併成一條
 * 會把 9/23 的上午一起吃掉，而那是客戶真的有空的半天。
 */
function runsOf(dates) {
  const groups = [];
  for (const pick of dates) {
    const last = groups[groups.length - 1];
    const canJoin = last
      && !pick.partOfDay
      && !last[last.length - 1].partOfDay
      && addDays(last[last.length - 1].date, 1) === pick.date;
    if (canJoin) last.push(pick);
    else groups.push([pick]);
  }
  // 一天的那幾組留著（from === to），不要在這裡拆掉 —— 拆了順序就散了
  return groups.filter((g) => g.length >= MERGE_RUN || g.length === 1);
}

function monthDates(month) {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let day = 1; day <= lastDayOf(y, m); day += 1) {
    out.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  return out;
}

// ---------- 轉成規則 ----------

/** 客戶點的東西 → `domain/availability.js` 認得的規則。收合規則見 `groupPicks()`。 */
export function picksToRules(picks, { month = null } = {}) {
  const g = groupPicks(picks, { month });

  return [
    ...g.weekdays.map((w) => ({
      kind: 'exclude_weekday',
      weekday: w.weekday,
      ...(w.partOfDay ? { partOfDay: w.partOfDay } : {}),
    })),
    ...g.spans.map((s) => (s.from === s.to
      ? { kind: 'exclude_date', date: s.from, ...(s.partOfDay ? { partOfDay: s.partOfDay } : {}) }
      : { kind: 'exclude_range', from: s.from, to: s.to })),
  ];
}

/**
 * 反過來：一組規則 → 日曆上點掉的那些格子。
 *
 * **編輯既有的那一份要用它。** 她自己記的那一份 2026-08-24 之後也改用日曆了
 * （`.scratch/customer-detail-rework/issues/04`），而在那之前存進去的規則
 * 是解析原文來的 —— 打開來要能標回格子上，不然編輯等於重填。
 *
 * **認不得的規則不吞掉。** 手動加的、或超出這個月範圍的都放進 `leftover`，
 * 由呼叫端列出來並講清楚「這幾條改不了但仍然生效」。安靜地少一條規則是這個
 * app 最不能犯的錯（SPEC 第 4.3 節的整個精神）——「她以為系統知道，其實不知道」。
 *
 * `prefer`（他說哪天方便）不是「不能的時間」，所以不會被畫到格子上，
 * 但它照樣進 `leftover` —— 存回去的時候要留著。
 *
 * @param {object[]} rules
 * @param {{month: string}} opts 'YYYY-MM'
 * @returns {{picks: {weekdays: object[], dates: object[]}, leftover: object[]}}
 */
export function rulesToPicks(rules, { month } = {}) {
  const weekdays = [];
  const dates = [];
  const leftover = [];
  const inMonth = (iso) => isValidDate(iso) && iso.slice(0, 7) === month;

  for (const rule of rules ?? []) {
    if (rule?.kind === 'exclude_weekday' && rule.weekday >= 0 && rule.weekday <= 6) {
      weekdays.push({ weekday: rule.weekday, partOfDay: partOf(rule) });
      continue;
    }

    if (rule?.kind === 'exclude_date' && inMonth(rule.date)) {
      dates.push({ date: rule.date, partOfDay: partOf(rule) });
      continue;
    }

    if (rule?.kind === 'exclude_range' && inMonth(rule.from) && inMonth(rule.to)) {
      // 範圍沒有半天（`picksToRules()` 那一側也是），所以一律整天。
      for (let d = rule.from; d <= rule.to; d = addDays(d, 1)) {
        dates.push({ date: d, partOfDay: null });
      }
      continue;
    }

    leftover.push(rule);
  }

  return { picks: normalizePicks({ weekdays, dates }), leftover };
}

// ---------- 轉成原文 ----------

/**
 * 把客戶點的東西寫成一句她看得懂的中文。
 *
 * **這句話要能被 `parseAvailability()` 讀回同一組規則**（見檔頭），
 * 所以日期一律寫成 `9/18` 而不是 `9/18(四)` —— 中間那個括號會讓
 * 「9/22 到 9/24」的範圍比對整條失效。給人看的星期在畫面上補，不在原文裡。
 */
export function picksToText(picks, { month = null } = {}) {
  const g = groupPicks(picks, { month });
  const parts = [];

  for (const w of g.weekdays) {
    parts.push(`每個禮拜${WEEKDAY_NAMES[w.weekday]}${PART_LABELS[w.partOfDay] ?? ''}不行`);
  }
  for (const s of g.spans) {
    parts.push(s.from === s.to
      ? `${md(s.from)} ${PART_LABELS[s.partOfDay] ?? ''}不行`.replace(/\s+/g, ' ').trim()
      : `${md(s.from)} 到 ${md(s.to)} 不行`);
  }

  return parts.join('、');
}

const md = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
};

/**
 * 存進收集的原文。
 *
 * 兩行：第一行是把點選組回去的人話，第二行是客戶自己打的那段**照抄**。
 * SPEC 第 4.3 節的「原文永遠是最終依據」在表單這條路上的等價物就是第二行 ——
 * 點選的部分是結構化的、不會讀錯，真正可能有意外的永遠是客戶自己講的話。
 *
 * 兩邊都空的時候給一句「這個月都可以」：`validateCollection()` 不收空的原文，
 * 而「他說都可以」本身就是一個要記下來的答案。
 */
export function rawTextFrom({ weekdays, dates, freeText } = {}, { month = null } = {}) {
  const picked = picksToText({ weekdays, dates }, { month });
  const free = String(freeText ?? '').trim();

  if (!picked && !free) return '這個月都可以';
  return [picked, free].filter(Boolean).join('\n');
}

/**
 * 一份既有的收集記錄裡，**屬於「她（或客戶）自己打的那段話」**的部分。
 *
 * 打開一份舊的來改時要把它帶回備註欄，不然存回去的時候
 * `rawTextFrom()` 會用新產生的那一段整個蓋掉它 —— **客戶原本說的話就沒了**，
 * 而且沒有任何訊息。那違反 SPEC 第 4.3 節「原文永遠比解析結果大」，
 * 也是 `.scratch/customer-detail-rework/issues/04` 的驗收條件之一
 *（「存回去不會掉東西」）。
 *
 * `rawTextFrom()` 存的是兩行：第一行是點選組回去的人話，第二行起是照抄的。
 * 所以第一行**如果剛好等於**現在這組點選產生的句子，那它就是機器寫的，可以丟；
 * 認不出來（例如 2026-08 以前她自己打的整段原文，根本沒有換行）就
 * **整段留著** —— 寧可讓她看到一段重複的字，也不要安靜地弄丟客戶講過的話。
 *
 * @param {string} rawText 記錄上存的原文
 * @param {{weekdays?:object[], dates?:object[]}} picks 反推回來的那組點選
 * @param {{month?:string}} [opts]
 * @returns {string}
 */
export function freeTextFrom(rawText, picks, { month = null } = {}) {
  const raw = String(rawText ?? '').trim();
  if (!raw) return '';

  // 「這個月都可以」是 rawTextFrom() 在兩邊都空的時候寫的，不是她打的。
  if (raw === '這個月都可以') return '';

  const generated = picksToText(picks, { month }).trim();
  if (!generated) return raw;

  const nl = raw.indexOf('\n');
  const first = (nl === -1 ? raw : raw.slice(0, nl)).trim();
  if (first !== generated) return raw;

  return nl === -1 ? '' : raw.slice(nl + 1).trim();
}

// ---------- 給人看的複述 ----------

/**
 * 客戶那一頁的確認、送出後那一頁、她的收件匣、回覆客戶的訊息，四個地方都用這一份 ——
 * 客戶按下送出時看到的字，要跟她收到的字一模一樣。
 *
 * **整個星期的排在最前面，其餘照日期由早到晚**，連續的和單獨一天混在同一串裡。
 * 把範圍全部提到前面會讓人讀成「9/7~9/8、9/1、9/9」，而客戶自己講的順序、
 * 她排班時看的順序，都是日曆的順序。
 *
 * **不含客戶自己打的那段。** 確認那一頁的自由欄還在編輯中，把它混進複述裡
 * 會變成「他打一個字、上面就多一行」。要含的地方用 `describeResponse()`。
 *
 * @returns {string[]} 一句一列
 */
export function describePicks(picks, { month = null } = {}) {
  const g = groupPicks(picks, { month });
  if (g.whole && isMonth(month)) return [`整個 ${Number(month.slice(5))} 月都不行`];

  const out = g.weekdays.map((w) => (w.partOfDay
    ? `整個禮拜${WEEKDAY_NAMES[w.weekday]}的${PART_LABELS[w.partOfDay]}不行`
    : `整個禮拜${WEEKDAY_NAMES[w.weekday]}不行`));

  for (const s of g.spans) {
    out.push(s.from === s.to
      ? `${shortDate(s.from)} ${partSuffix(s.partOfDay)}`
      : `${shortDate(s.from)} ~ ${shortDate(s.to)} 整天不行`);
  }

  return out.length ? out : ['這個月都可以，沒有不方便的日子'];
}

const partSuffix = (part) => (part ? `只有${PART_LABELS[part]}不行` : '整天不行');

/** 複述加上客戶自己打的那一段。收件匣、送出後那一頁、回覆訊息用這一支。 */
export function describeResponse(response, { month = null } = {}) {
  const lines = describePicks(response ?? {}, { month: month ?? response?.month ?? null });
  const free = String(response?.freeText ?? '').trim();
  return free ? [...lines, free] : lines;
}

// ---------- 收下 ----------

/**
 * 客戶送出的那一份 → 一份本輪可用性。
 *
 * 她按「收下」才會呼叫到這裡（ADR-0032：app 是記錄者，客戶填的不自動生效）。
 *
 * `collectedAt` 用**她收下的那天**，不是客戶送出的那天。這一份收集的意義是
 * 「她手上握有的最新資訊」，而她是今天才握有的；`submittedAt` 留在收件匣那一筆上，
 * 要查「客戶什麼時候填的」看得到。
 */
export function collectionFrom(response, invite, { today } = {}) {
  const month = invite?.month ?? response?.month ?? null;
  const picks = normalizePicks(response ?? {});

  return {
    collectedAt: isValidDate(today) ? today : null,
    validFrom: invite?.validFrom ?? null,
    validTo: invite?.validTo ?? null,
    rawText: rawTextFrom({ ...picks, freeText: response?.freeText }, { month }),
    rules: picksToRules(picks, { month }),
    followupNote: null,
    // 畫面上要看得出這一份是客戶自己填的 —— 他自己講的話比她轉述的可信。
    source: 'form',
    sourceToken: response?.token ?? null,
  };
}

// ---------- 驗證 ----------

/**
 * 客戶送出的那一份對不對。客戶那一頁按送出前擋一次，她收下前再擋一次。
 *
 * 這裡只擋「形狀不對」，不擋「填得少」—— 什麼都沒點是一個合法而且常見的答案
 * （這個月都可以）。
 */
export function validateResponse(response) {
  const errors = [];
  if (!response?.token) errors.push('沒有連結代碼');
  if (!response?.customerId) errors.push('對不到客戶');
  if (!isMonth(response?.month)) errors.push('月份不合法');

  if (String(response?.freeText ?? '').length > FREE_TEXT_MAX) {
    errors.push(`補充的字數超過 ${FREE_TEXT_MAX} 字`);
  }

  for (const pick of response?.weekdays ?? []) {
    if (!(Number(pick?.weekday) >= 0 && Number(pick?.weekday) <= 6)) errors.push('星期不合法');
  }
  for (const pick of response?.dates ?? []) {
    if (!isValidDate(pick?.date)) errors.push('日期不合法');
  }

  return errors;
}

/** 客戶點的日子有沒有落在這條連結問的那個月以外。畫面上不該點得到，但值得擋一次。 */
export function outOfRange(response, invite) {
  if (!invite?.validFrom || !invite?.validTo) return [];
  return (response?.dates ?? [])
    .map((d) => d?.date)
    .filter((d) => isValidDate(d) && (d < invite.validFrom || d > invite.validTo));
}

// ---------- 客戶那一頁要畫的月曆 ----------

/**
 * 一個月的格子，前面補到禮拜一。
 *
 * 補的那幾格是**空的**，不是鄰月的日子 —— 她的日曆補鄰月是因為「留白會讓她
 * 以為那幾天沒事」（SPEC 第 8.6 節），但客戶這一頁問的是**這一個月**，
 * 畫出上個月的日子只會讓他點下去然後發現點不動。
 *
 * @param {string} month 'YYYY-MM'
 * @param {{today?:string}} [when] 有給就把已經過去的日子標成不可點
 * @returns {{date:string|null, day:number|null, weekday:number, past:boolean}[]}
 */
export function monthGrid(month, { today = null } = {}) {
  if (!isMonth(month)) return [];
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ date: null, day: null, weekday: i, past: false });

  for (const date of monthDates(month)) {
    cells.push({
      date,
      day: Number(date.slice(8)),
      weekday: weekdayOf(date),
      past: Boolean(today && isValidDate(today) && daysBetween(today, date) < 0),
    });
  }
  return cells;
}

function isMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
