// 要貼到 LINE 的訊息。純函式。
//
// 她跟客戶之間的每一句話現在都是手打的，而打錯一個日期就是白跑一趟。
// 這一支把那幾種固定的話產生成草稿：問這輪的時間、問壓好的時間可不可以、
// 來訪前提醒、臨時空出一格問誰要補。
//
// 產生的是草稿，不是定稿 —— 她複製到 LINE 之後想怎麼改都可以，
// 所以用字寧可平淡，不要自作聰明加一堆語助詞。

import { shortDate, daysBetween, addMonths } from './dates.js';

/**
 * 一位客戶的壓表結果，問他可不可以。
 *
 * @param {{name:string}} customer
 * @param {{date:string, slots:{startsAt:string}[]}[]} visits 這次要問的來訪
 * @returns {string} 可以直接貼進 LINE 的文字
 */
export function confirmMessage(customer, visits) {
  const rows = (visits ?? [])
    .filter((v) => v.date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((v) => `${shortDate(v.date)} ${firstStart(v)}`.trim());

  if (!rows.length) return '';

  const month = Number(visits.find((v) => v.date).date.split('-')[1]);

  return `${nameOf(customer)}您好，${month} 月為您安排了 ${rows.join('、')}，請問可以嗎？`;
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
 * @param {{name:string}} customer
 * @param {{month:string}} when month 是 'YYYY-MM'
 */
export function askAvailabilityMessage(customer, { month } = {}) {
  const m = monthOf(month);
  if (!m) return '';
  return `${nameOf(customer)}您好，要幫您安排 ${m} 月的課程，`
    + `請問您 ${m} 月哪幾天方便呢？不方便的日子也可以直接跟我說。`;
}

/**
 * 來訪前的提醒。死線是前一天，但她可能提早幾天就先提醒。
 *
 * 刻意講「明天」而不是只給日期 —— 提醒訊息當天看到「9/3」還要自己換算，
 * 而看到「明天」不會弄錯。不是明天就照樣給日期。
 *
 * @param {{name:string}} customer
 * @param {{date:string, slots:{startsAt:string, courseName:string}[]}} visit
 * @param {{today:string}} when
 */
export function reminderMessage(customer, visit, { today } = {}) {
  if (!visit?.date) return '';

  const when = today && daysBetween(today, visit.date) === 1
    ? `明天 ${shortDate(visit.date)}`
    : shortDate(visit.date);
  const start = firstStart(visit);
  const courses = courseNames(visit);

  return `${nameOf(customer)}您好，提醒您${when} ${start} 有`
    + `${courses ? `${courses}的` : ''}課程，再麻煩您準時到院，謝謝。`;
}

/**
 * 臨時空出一格，問這位客戶要不要補。SPEC 第 8.4 節的時段反查。
 *
 * 這則訊息的重點是「有沒有空」而不是「這是你的第幾次」——
 * 她問的當下對方在忙，講越少越容易得到回覆。
 *
 * @param {{name:string}} customer
 * @param {{date:string, startsAt:string, endsAt:string, courseName:string}} slot
 */
export function offerSlotMessage(customer, slot = {}) {
  if (!slot.date || !slot.startsAt) return '';
  const range = slot.endsAt ? `${slot.startsAt}–${slot.endsAt}` : slot.startsAt;
  const what = slot.courseName ? `${slot.courseName}的` : '';

  return `${nameOf(customer)}您好，${shortDate(slot.date)} ${range} 臨時空出一個${what}時段，`
    + `請問您方便過來嗎？`;
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
 * @returns {{id:string, label:string, text:string}[]}
 */
export function messagesFor({ customer, visits = [], today, month = null }) {
  const out = [];
  const alive = visits.filter((v) => !v.deletedAt && v.status !== 'cancelled');

  const ask = askAvailabilityMessage(customer, { month: month ?? addMonths(today, 1).slice(0, 7) });
  if (ask) out.push({ id: 'ask', label: '問這一輪的時間', text: ask });

  // 還在等回覆的那幾筆一次問完，跟首頁「今天壓了誰」用的是同一則
  const waiting = alive.filter((v) => v.status === 'pending_confirm' && v.date >= today);
  if (waiting.length) {
    out.push({ id: 'confirm', label: '問壓好的時間可不可以', text: confirmMessage(customer, waiting) });
  }

  const next = alive
    .filter((v) => v.date >= today && (v.status === 'confirmed' || v.status === 'pending_confirm'))
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (next) {
    out.push({
      id: 'reminder',
      label: `提醒 ${shortDate(next.date)} 的來訪`,
      text: reminderMessage(customer, next, { today }),
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
