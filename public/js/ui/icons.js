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
  // 攤開的書：備忘錄／SOP。**跟 book 是兩顆不一樣的東西** ——
  // book 是夾板（壓表），這一顆是攤開來讀的（ADR-0067：拿來讀的，不是拿來勾的）。
  manual: '<path d="M12 6.6C10.2 5 8 4.6 5.5 4.6v13c2.5 0 4.7.4 6.5 2 1.8-1.6 4-2 6.5-2v-13c-2.5 0-4.7.4-6.5 2z"/><path d="M12 6.6v13"/>',
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
  // 拍照帶入（issue 06）
  camera: '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10H4z"/><circle cx="12" cy="13.3" r="3.4"/>',
  images: '<rect x="3.5" y="5.5" width="14" height="12" rx="1.5"/><path d="M6.5 3.5h14v12"/><path d="M5.5 15l3.5-3.5 3 3 2-2 3.5 3.5"/>',
  // 看照片時轉 90°（順時針的箭頭繞著一張直的紙）
  turn: '<rect x="4" y="9" width="9" height="11.5" rx="1.5"/><path d="M11 3.5a8.5 8.5 0 018.5 8.5"/><path d="M17 9.5l2.5 2.5 2.5-2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>',
  message: '<path d="M4 6.5h16v11H9l-5 3.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.4l3.4 2"/>',
  // 資訊卡片右上角那一支。讀取模式與編輯模式的界線就是這顆（ADR-0020）
  pencil: '<path d="M4 20l.9-3.6L15.3 6a2 2 0 012.8 0l1.9 1.9a2 2 0 010 2.8L9.6 21.1 6 22z"/>',
  // 刪掉勾完的隨手記。**它走的是軟刪除**（SPEC 第 6.1 節），
  // 設定頁的「已刪除項目」還原得回來 —— 這顆圖示不代表東西真的消失。
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5l1 13.3h9l1-13.3M10.2 10v6M13.8 10v6"/>',
  // 營養品。一個盒子 —— 它是**實體商品**，不是課程（ADR-0057），
  // 所以刻意跟 book／todo 那幾顆長得不一樣。
  box: '<path d="M3.5 7.8L12 3.5l8.5 4.3v8.4L12 20.5 3.5 16.2z"/><path d="M3.5 7.8L12 12m0 0l8.5-4.2M12 12v8.5"/>',
  // 客戶詳情備註那一串（ADR-0156）。電話是話筒；LINE 是圓圓的對話泡泡、尾巴往左下 ——
  // **不是 LINE 的商標**，只是讓人想到它；長備註是摺了一角的便條；grip 是調整順序的把手。
  phone: '<path d="M6.7 3.8h2.6l1.5 3.9-1.9 1.3a10.6 10.6 0 005.2 5.2l1.3-1.9 3.9 1.5v2.6a2 2 0 01-2.2 2A15.6 15.6 0 014.7 6a2 2 0 012-2.2z"/>',
  line: '<path d="M12 4.3c-4.8 0-8.6 3-8.6 6.7 0 3.3 3 6 7 6.6l.1 2.4c0 .5.5.7.9.4 2.7-1.6 5.5-3.6 7.2-5.6 1.3-1.4 2-2.7 2-3.8 0-3.7-3.8-6.7-8.6-6.7z"/><path d="M8.6 11h.01M12 11h.01M15.4 11h.01" stroke-width="2.6"/>',
  note: '<path d="M6 3.5h8.2l4.3 4.3V20.5H6z"/><path d="M14.2 3.5v4.3h4.3"/><path d="M9 12.5h6M9 16h4"/>',
  // 病歷號（ADR-0160）：一張證件、左邊人像、右邊兩行字。她 2026-10-19 從三個裡選的 C
  chartNo: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><circle cx="8.6" cy="10.6" r="1.9"/><path d="M5.8 15.6c.5-1.4 1.6-2.2 2.8-2.2s2.3.8 2.8 2.2"/><path d="M14.2 10.4h3.8M14.2 13.6h2.8"/>',
  grip: '<path d="M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01" stroke-width="2.8"/>',
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
