// 一筆一筆存，而且記得存到哪。給「一次存好幾筆來訪」的兩條路：確認抽屜、批次取消。
//
// 一筆一筆存是因為每一筆各自要重算次數與任務，硬塞進同一個 commit 會超過
// Firestore 一批 500 個操作的上限。而 toast 的重試（`toast.withSaveState()`）跑的是
// **同一個閉包**：從第一筆重存的話，第一筆剛剛已經被自己存過、`updatedAt` 換掉了，
// `ifUpdatedAt` 對不上 →「剛剛在別的地方被改過」—— 那句話是假的（改它的就是她自己），
// 而且再也存不進去（prelaunch-audit-2026-09-23/issues/18）。
//
// 拍 Abovee 那一層的 `savedKeys` 是同一個作法。

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<unknown>} save
 * @param {Set<T>} saved 存好的那幾筆。**在閉包外面建一次**，重試時沿用同一個
 */
export async function saveEach(items, save, saved) {
  for (const item of items) {
    if (saved.has(item)) continue;
    await save(item);
    saved.add(item);
  }
}
