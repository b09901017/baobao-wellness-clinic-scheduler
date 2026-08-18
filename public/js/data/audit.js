// 稽核紀錄的讀取。SPEC 第 6.2 節。
//
// 寫入不在這裡 —— 每一則稽核都是 repo.commit() 跟著本體資料寫在同一個 batch 裡，
// 那是它唯一的來源，也是它不會漏的原因。這一支只負責把它們找出來給人看。
//
// audit 是 append-only 而且沒有 deletedAt 欄位（Rules 直接禁止 update 與 delete），
// 所以查詢一律走 repo.listWithDeleted() —— 用 list() 會被 deletedAt == null
// 的條件濾成空的。

import { where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import * as repo from './repo.js';

const PATH = 'audit';

/** Firestore 的 in 查詢一次最多帶這麼多個值。 */
const IN_CHUNK = 10;

/**
 * 最近的變更，全庫。設定頁的稽核檢視用。
 * 需要 (at desc) 單欄索引，Firestore 自動有。
 */
export function listRecent(limit = 100) {
  return repo.listWithDeleted(PATH, { order: ['at', 'desc'], limit });
}

/**
 * 某一筆資料的完整變更歷史。
 * 需要 (targetPath asc, at desc) 複合索引，已列在 firestore.indexes.json。
 *
 * @param {string} targetPath 例：'visits/abc123'
 */
export function listForTarget(targetPath, limit = 50) {
  return repo.listWithDeleted(PATH, {
    wheres: [where('targetPath', '==', targetPath)],
    order: ['at', 'desc'],
    limit,
  });
}

/**
 * 一位客戶相關的變更歷史。客戶詳情頁的「變更紀錄」用（SPEC 第 8.5 節）。
 *
 * 分兩段查是因為稽核只有 targetPath，沒有 customerId：
 *   1. 客戶本身與他的子集合（額度、可用性）路徑都以 customers/{id} 開頭，用範圍查詢一次拿到
 *   2. 來訪是頂層集合，路徑上看不出屬於誰，只能拿 id 分批用 in 查
 *
 * 刻意不回頭替 audit 補 customerId 欄位：既有的稽核補不上，會變成
 * 「新的查得到、舊的查不到」—— 出事時要回溯的往往正是舊的那些。
 *
 * 任務的變更不收在這裡。任務幾乎都是來訪存檔時連帶產生的，收進來會把
 * 她真正想看的「這位客戶的資料被誰改成什麼」淹掉，而任務本身在來訪的歷史裡看得到。
 *
 * @param {string} customerId
 * @param {string[]} [visitIds] 這位客戶的來訪 id，建議只帶最近的數十筆
 */
export async function listForCustomer(customerId, visitIds = []) {
  const prefix = `customers/${customerId}`;

  const [own, ...visitChunks] = await Promise.all([
    // 範圍查詢用 targetPath 自己排序（Firestore 的規定：有範圍條件就要先照它排），
    // 時間排序在下面自己做。
    repo.listWithDeleted(PATH, {
      wheres: [
        where('targetPath', '>=', prefix),
        // \uf8ff 是 Firebase 文件建議的前綴查詢上界：私用區的最後一個字元，
        // 排在所有一般字元後面。
        where('targetPath', '<', `${prefix}\uf8ff`),
      ],
      order: ['targetPath', 'asc'],
    }),
    ...chunk(visitIds, IN_CHUNK).map((ids) =>
      repo.listWithDeleted(PATH, {
        wheres: [where('targetPath', 'in', ids.map((id) => `visits/${id}`))],
        order: ['at', 'desc'],
      }),
    ),
  ]);

  // 範圍查詢是字串前綴，理論上會掃到 id 以這串開頭的另一位客戶。
  // Firestore 自動產生的 id 等長，實務上撞不到，但這裡還是精確濾一次 ——
  // 把別人的變更紀錄畫在這位客戶底下是最不該發生的錯。
  const mine = own.filter(
    (row) => row.targetPath === prefix || String(row.targetPath ?? '').startsWith(`${prefix}/`),
  );

  return [...mine, ...visitChunks.flat()].sort((a, b) => millisOf(b.at) - millisOf(a.at));
}

/** Firestore Timestamp 或字串都可能，排序前一律換成毫秒。 */
export function millisOf(at) {
  if (at?.toMillis) return at.toMillis();
  const ms = new Date(at ?? 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function chunk(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
