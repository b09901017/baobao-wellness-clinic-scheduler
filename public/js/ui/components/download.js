// 把一段文字變成一個下載檔。
//
// 匯出備份與試算表報表都要用，而 Blob → objectURL → 點一下 → 記得 revoke
// 這四步少一步就會漏記憶體或根本沒下載，抄兩份就會有一份寫錯。

import { todayISO } from '../../domain/dates.js';

/**
 * @param {string} filename 含副檔名
 * @param {string} text
 * @param {string} [mime]
 */
export function saveText(filename, text, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 檔名帶上日期，存到雲端硬碟時才排得出先後。 */
export function dated(prefix, extension) {
  // 台灣那一天（`todayISO()`），不是 `toISOString()` 切字 —— 那是 UTC，00:00–08:00 匯出的會寫成前一天
  return `${prefix}-${todayISO()}.${extension}`;
}
