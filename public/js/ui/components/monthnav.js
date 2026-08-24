// 段落抬頭右邊那兩顆換月份的箭頭。
//
// 兩個地方用：客戶詳情的「這個月」與可用性的「記一次」。兩邊都是 2026-08-24
// 加的，而第一版是整塊複製過去的 —— 那正是「改一邊忘了另一邊」的形狀。
//
// **它只產生按鈕，不管換月份之後要做什麼。** 那兩邊差很多：客戶詳情只重畫
// 那一塊（ADR-0038），可用性要連著整張表單的暫存值一起重畫。共用的是長相與
// 那個 `data-month-step`，不是行為。

import { icon } from '../icons.js';

/** 抬頭右邊那兩顆。放在 `.section` 裡面。 */
export function monthNav() {
  return `
    <span class="monthnav">
      <button class="monthnav__btn" type="button" data-month-step="-1"
              aria-label="上個月">${icon('left', { size: 16 })}</button>
      <button class="monthnav__btn" type="button" data-month-step="1"
              aria-label="下個月">${icon('right', { size: 16 })}</button>
    </span>`;
}

/**
 * 一次點擊要換到哪個月。
 *
 * @param {EventTarget} target 點到的東西
 * @param {string} month 現在在看哪個月，'YYYY-MM'
 * @param {Function} addMonths `domain/dates.js` 的那一支（這裡是 ui/，不自己算日期）
 * @returns {string|null} 換到的月份；沒點到箭頭就是 null
 */
export function steppedMonth(target, month, addMonths) {
  const step = target?.closest?.('[data-month-step]');
  if (!step) return null;
  return addMonths(`${month}-01`, Number(step.dataset.monthStep)).slice(0, 7);
}
