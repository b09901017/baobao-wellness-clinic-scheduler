// 圖示。全部是同一套線條風格的 inline SVG，24 格、線寬 1.7–2。
//
// 為什麼不用 emoji：emoji 在 Android 與 iPad 上長得完全不一樣，而且不吃
// currentColor —— 導覽列選中時它不會跟著變色，只能靠旁邊的字標示，
// 那在低頭快看的情境下看不出來。
//
// 為什麼不用圖示字型或 SVG sprite：多一個要下載的檔案，就多一個訊號差時
// 畫面缺一塊的理由。這裡是純字串，跟著 js 一起進快取。

const PATHS = {
  todo: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8 12.2l2.8 2.8L16.4 9.4"/>',
  book: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9.5 4h5v2.6h-5z"/><path d="M9 12h6M9 16h4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  people:
    '<circle cx="9.5" cy="8" r="3.2"/><path d="M3.5 20c0-3.2 2.7-5.8 6-5.8s6 2.6 6 5.8"/><path d="M16.4 5.4a3.2 3.2 0 010 5.6M20.5 20c0-2.3-.9-4-2.2-5.1"/>',
  gear:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  right: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  left: '<path d="M15 5.5L8.5 12l6.5 6.5"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/>',
  alert: '<path d="M12 3.5l8.5 15.5h-17z"/><path d="M12 9.5v4M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',
  message: '<path d="M4 6.5h16v11H9l-5 3.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.4 2"/>',
  // 資訊卡片右上角那一支。讀取模式與編輯模式的界線就是這顆（ADR-0020）
  pencil: '<path d="M4 20l.9-3.6L15.3 6a2 2 0 012.8 0l1.9 1.9a2 2 0 010 2.8L9.6 21.1 6 22z"/>',
  // 刪掉勾完的隨手記。**它走的是軟刪除**（SPEC 第 6.1 節），
  // 設定頁的「已刪除項目」還原得回來 —— 這顆圖示不代表東西真的消失。
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5l1 13.3h9l1-13.3M10.2 10v6M13.8 10v6"/>',
};

/**
 * 一顆圖示的 SVG 字串。
 *
 * 顏色一律用 currentColor，由外面的 CSS 決定 —— 圖示自己不帶顏色，
 * 導覽列選中、警告變紅那些狀態才不用各準備一份。
 *
 * @param {string} name PATHS 裡的鍵
 * @param {{size?: number, cls?: string, width?: number}} [opts]
 * @returns {string} 認不得的名字回空字串，不要畫一個問號上去
 */
export function icon(name, { size = 20, cls = '', width = 1.8 } = {}) {
  const body = PATHS[name];
  if (!body) return '';
  return (
    `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${width}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
}

export const ICON_NAMES = Object.keys(PATHS);
