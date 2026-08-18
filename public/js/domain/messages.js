// 要貼到 LINE 的訊息。純函式。
//
// 她壓完表之後要一個一個問客戶「這些時間可以嗎」。這段文字現在是手打的，
// 打錯一個日期就是白跑一趟。SPEC 第 8.1 節的「複製確認訊息」。
//
// 產生的是草稿，不是定稿 —— 她複製到 LINE 之後想怎麼改都可以。

import { shortDate } from './dates.js';

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

  const name = customer?.name ?? '您';
  const month = Number(visits.find((v) => v.date).date.split('-')[1]);

  return `${name}您好，${month} 月為您安排了 ${rows.join('、')}，請問可以嗎？`;
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
