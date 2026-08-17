// 第 1 步只放各頁的骨架，實際內容依 SPEC 第 11 節的順序逐步填。
// 每一頁都標明它在第幾步做，這樣不會有人以為是漏做。

import { register } from './router.js';

function placeholder(title, step, points) {
  return (el) => {
    el.innerHTML = `
      <section class="card">
        <h2 class="card__title">${title}</h2>
        <p class="muted">第 ${step} 步實作。目前是骨架。</p>
        <ul class="muted">${points.map((p) => `<li>${p}</li>`).join('')}</ul>
      </section>
    `;
  };
}

register('/', {
  title: '待辦',
  icon: '✅',
  render: placeholder('待辦中心', 5, [
    '待辦依死線排序，逾期紅、今明黃、其餘灰',
    '今天壓了誰，含複製 LINE 確認訊息',
    '等回覆／需再確認',
    '改時間／取消，需回頭取消舊系統登記',
  ]),
});

register('/customers', {
  title: '客戶',
  icon: '👥',
  render: placeholder('客戶總覽', 3, [
    '可搜尋清單，顯示各額度進度與限制標籤',
    '醫療禁忌永遠跟著名字顯示，不可摺疊',
    '詳情頁有時間軸、額度明細、可用性原文、變更紀錄',
  ]),
});

register('/schedule', {
  title: '壓表',
  icon: '📋',
  render: placeholder('壓表模式', 7, [
    '先選課程，整頁只顯示該課程的資訊',
    '一位一位把客戶狀況攤開：可用日、剩餘次數、喜好、限制原文',
    '不出建議時段 —— 判斷由使用者做，見 ADR-0002',
    '在 Abovee 填完後回來快速記錄',
  ]),
});

register('/calendar', {
  title: '日曆',
  icon: '📅',
  render: placeholder('日曆', 10, ['手機用日／週檢視', 'iPad 橫式才開放月檢視']),
});

register('/settings', {
  title: '設定',
  icon: '⚙️',
  render: placeholder('設定', 2, [
    '診間、床位、治療師、器材、營養點滴品項',
    '課程（類別 A／B／C、時長、選治療師或選診間）',
    '方案範本（可複製、可就地改，沒有版本，見 ADR-0003）',
    '排序權重、匯出備份、已刪除項目還原',
  ]),
});
