// 來訪的詞彙與規則。純函式。
//
// 第 4 步才會長出狀態機、時段與衝突檢查。現在只有狀態的中文說法，
// 因為客戶詳情頁已經要顯示來訪了，而畫面上不該出現 'pending_confirm'。

/** SPEC 第 4.1 節的狀態機。順序就是它們在流程上的先後。 */
export const VISIT_STATUSES = [
  'draft',
  'pending_confirm',
  'confirmed',
  'done',
  'no_show',
  'cancelled',
];

const LABELS = {
  draft: '草稿',
  pending_confirm: '已壓表，等客戶回覆',
  confirmed: '客戶已確認',
  done: '已完成',
  no_show: '未到',
  cancelled: '已取消',
};

/** 不認得的狀態原樣顯示，不要吞掉 —— 那代表資料有問題，要看得見。 */
export function describeStatus(status) {
  return LABELS[status] ?? String(status ?? '（沒有狀態）');
}
