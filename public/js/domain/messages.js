// 要貼到 LINE 的訊息。純函式。
//
// 她跟客戶之間的每一句話現在都是手打的，而打錯一個日期就是白跑一趟。
// 這一支把那幾種固定的話產生成草稿：問這輪的時間、問壓好的時間可不可以、
// 來訪前提醒、臨時空出一格問誰要補。
//
// 產生的是草稿，不是定稿 —— 她複製到 LINE 之後想怎麼改都可以，
// 所以用字寧可平淡，不要自作聰明加一堆語助詞。
//
// ## 2026-09-04 起，字不在這裡
//
// 六則的**字**搬去 `domain/messageTemplates.js`（預設值）與設定頁的
// 「LINE 回覆模板」（她改過的）。這一支只剩一件事：**算變數**。
//
// 那一刀切在這裡是因為六則裡有五則的變數是**有條件的** ——
// 「一次來訪只講第一段的開始時間」「前一天就說明天」「沒有課程名就整段消失」。
// 那幾個判斷一行都不該讓她在設定頁上重寫一次，也不該搬進模板裡
//（模板只有 `{}` 這一種語法，寫不出條件，硬要寫就是發明第二套樣板語言）。
//
// 每一支都收一個選填的 `templates`：**沒給就用預設值**，所以呼叫端
// 忘記傳的代價是「看到出廠設定的那一句」，不是「看到空白」。

import { shortDate, daysBetween, addMonths } from './dates.js';
import { textFor, fill } from './messageTemplates.js';

/** 這一則現在的字，換上變數。 */
const say = (id, templates, vars) => fill(textFor(id, templates), vars);

/**
 * 一位客戶的壓表結果，問他可不可以。
 *
 * @param {{name:string}} customer
 * @param {{date:string, slots:{startsAt:string}[]}[]} visits 這次要問的來訪
 * @param {{templates?: object}} [o]
 * @returns {string} 可以直接貼進 LINE 的文字
 */
export function confirmMessage(customer, visits, { templates = {} } = {}) {
  const rows = (visits ?? [])
    .filter((v) => v.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((v) => `${shortDate(v.date)} ${firstStart(v)}`.trim());

  if (!rows.length) return '';

  const month = Number(visits.find((v) => v.date).date.split('-')[1]);

  return say('confirm', templates, {
    name: nameOf(customer),
    month,
    slots: rows.join('、'),
  });
}

/**
 * 一次來訪只講第一個時段的開始時間。
 * 她問客戶的是「那天幾點來」，不是把三個療程的時刻表都念一遍 ——
 * 那反而讓客戶看不懂重點。
 */
function firstStart(visit) {
  const starts = (visit.slots ?? [])
    .map((s) => s.startsAt)
    .filter(Boolean)
    .sort();
  return starts[0] ?? '';
}

// ---------- 其餘的訊息 ----------

/**
 * 問這一輪的時間。她每個月都要問一次，這是所有對話的起點。
 *
 * 稱呼一律給「大哥/姐姐」兩個都留，**不要自己判斷性別** —— 猜錯一次比她自己
 * 刪一個字貴得多，而她本來就會在貼進 LINE 之前改（訊息是草稿不是定稿）。
 *
 * 給了連結就換一則（`askWithLink`）：**不要再問「哪幾天方便」**，
 * 那會讓客戶用打字的回你，於是連結白給了。
 *
 * @param {{name:string}} customer
 * @param {{month:string, link?:string, templates?:object}} when month 是 'YYYY-MM'
 */
export function askAvailabilityMessage(customer, { month, link = '', templates = {} } = {}) {
  const m = monthOf(month);
  if (!m) return '';

  return say(link ? 'askWithLink' : 'ask', templates, {
    name: nameOf(customer),
    month: m,
    link,
  });
}

/**
 * 客戶填完表單之後回他的那一句。
 *
 * 這不只是禮貌，它是**最便宜的驗證**：把系統讀到的東西複述回去，
 * 讀錯了客戶會當場說「不是啦我是說⋯⋯」。表單的答案是結構化的，讀錯的機率
 * 比解析自由文字低得多，但不是零 —— 客戶點錯一天，或者自由欄裡藏著
 * 一句「不過月底那週也不行」。見 ADR-0032。
 *
 * @param {{name:string}} customer
 * @param {{month:string, lines:string[], templates?:object}} what lines 是
 *   `domain/availabilityForm.js` 的 `describeResponse()`
 */
export function availabilityReceivedMessage(
  customer, { month, lines = [], templates = {} } = {},
) {
  const m = monthOf(month);
  if (!m) return '';

  return say('received', templates, {
    name: nameOf(customer),
    month: m,
    lines: lines.filter(Boolean).map((line) => `・${line}`).join('\n'),
  });
}

/**
 * 來訪前的提醒。死線是前一天，但她可能提早幾天就先提醒。
 *
 * 刻意講「明天」而不是只給日期 —— 提醒訊息當天看到「9/3」還要自己換算，
 * 而看到「明天」不會弄錯。不是明天就照樣給日期。
 *
 * @param {{name:string}} customer
 * @param {{date:string, slots:{startsAt:string, courseName:string}[]}} visit
 * @param {{today:string, templates?:object}} when
 */
export function reminderMessage(customer, visit, { today, templates = {} } = {}) {
  if (!visit?.date) return '';

  const when = today && daysBetween(today, visit.date) === 1
    ? `明天 ${shortDate(visit.date)}`
    : shortDate(visit.date);
  const courses = courseNames(visit);

  return say('reminder', templates, {
    name: nameOf(customer),
    when,
    time: firstStart(visit),
    // **「的」跟著課程名一起進來或一起消失。** 沒有課程時原本那一句是
    // 「有課程」，而模板裡只有 `{courses}` 一個洞 —— 把「的」留在模板上
    // 會變成「有的課程」。
    courses: courses ? `${courses}的` : '',
  });
}

/**
 * 臨時空出一格，問這位客戶要不要補。SPEC 第 8.4 節的時段反查。
 *
 * 這則訊息的重點是「有沒有空」而不是「這是你的第幾次」——
 * 她問的當下對方在忙，講越少越容易得到回覆。
 *
 * @param {{name:string}} customer
 * @param {{date:string, startsAt:string, endsAt:string, courseName:string}} slot
 * @param {{templates?:object}} [o]
 */
export function offerSlotMessage(customer, slot = {}, { templates = {} } = {}) {
  if (!slot.date || !slot.startsAt) return '';

  return say('offer', templates, {
    name: nameOf(customer),
    date: shortDate(slot.date),
    range: slot.endsAt ? `${slot.startsAt}–${slot.endsAt}` : slot.startsAt,
    // 同 `reminder` 的 `{courses}`：「的」跟著名字一起進來或一起消失
    course: slot.courseName ? `${slot.courseName}的` : '',
  });
}

/**
 * 這位客戶現在用得到哪幾則訊息。客戶詳情頁的「LINE 訊息」用。
 *
 * 用得到才給：沒有待確認的來訪就不該出現「確認訊息」那一則 ——
 * 產生一則空話比不產生更糟，她複製了才發現裡面沒有日期。
 *
 * @param {object} ctx
 * @param {object} ctx.customer
 * @param {object[]} [ctx.visits] 這位客戶的來訪
 * @param {string} ctx.today
 * @param {string} [ctx.month] 要問哪個月，預設下個月
 * @param {string} [ctx.formLink] 這位客戶這個月的表單連結，有就換一種問法
 * @param {object} [ctx.templates] 她改過的模板
 * @returns {{id:string, label:string, text:string}[]}
 */
export function messagesFor({
  customer, visits = [], today, month = null, formLink = '', templates = {},
}) {
  const out = [];
  const alive = visits.filter((v) => !v.deletedAt && v.status !== 'cancelled');

  const ask = askAvailabilityMessage(customer, {
    month: month ?? addMonths(today, 1).slice(0, 7),
    link: formLink,
    templates,
  });
  if (ask) out.push({ id: 'ask', label: formLink ? '問這一輪的時間（附表單）' : '問這一輪的時間', text: ask });

  // 還在等回覆的那幾筆一次問完，跟首頁「今天壓了誰」用的是同一則
  const waiting = alive.filter((v) => v.status === 'pending_confirm' && v.date >= today);
  if (waiting.length) {
    out.push({
      id: 'confirm',
      label: '問壓好的時間可不可以',
      text: confirmMessage(customer, waiting, { templates }),
    });
  }

  const next = alive
    .filter((v) => v.date >= today && (v.status === 'confirmed' || v.status === 'pending_confirm'))
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (next) {
    out.push({
      id: 'reminder',
      label: `提醒 ${shortDate(next.date)} 的來訪`,
      text: reminderMessage(customer, next, { today, templates }),
    });
  }

  return out;
}

/**
 * 開頭的稱呼。沒有名字就整個略過，讓句子從「您好」開始 ——
 * 補一個「您」會變成「您您好」，那看起來像系統壞了。
 */
const nameOf = (customer) => String(customer?.name ?? '').trim();

/** 'YYYY-MM' 或 'YYYY-MM-DD' 都收，回傳月份數字。看不懂就回 null，不要湊一句話出來。 */
function monthOf(value) {
  const m = Number(String(value ?? '').split('-')[1]);
  return m >= 1 && m <= 12 ? m : null;
}

function courseNames(visit) {
  return [...new Set((visit?.slots ?? []).map((s) => s.courseName).filter(Boolean))].join('、');
}
