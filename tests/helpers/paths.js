// 測試要讀專案裡的檔案時，路徑一律從這裡拿。
//
// **不要用 `new URL(..., import.meta.url).pathname`。** 在 Windows 上它是
// `/C:/Users/…`，開頭那條斜線讓 `fs` 把它當成相對路徑接在磁碟機後面，
// 於是變成 `C:\C:\Users\…` —— 26 支測試同時 ENOENT，而在 macOS 與 CI 上
// 一支都不會紅。`fileURLToPath()` 是唯一跨平台正確的轉法。
//
// 只讀一個檔案的話其實連轉都不用轉：`readFileSync()` 本來就收 URL 物件
//（`tests/visits.test.js` 一直是那樣寫的）。這裡要的是**目錄**，
// 因為它還要拿去 `join()`、拿去 `slice()`。

import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = new URL('../../', import.meta.url);

/**
 * 專案裡某個東西的絕對路徑。`rel` 一律用 `/` 寫，結尾要不要斜線由呼叫端決定
 *（目錄留著斜線，`slice(ROOT.length)` 才切得乾淨）。
 */
export const fromRoot = (rel = '') => fileURLToPath(new URL(rel, REPO));

/**
 * 把作業系統的分隔符換成 `/`。
 *
 * 切出來的相對路徑只要參與比對就得走這一支：Windows 上 `data\repo.js`
 * 的 `startsWith('data/')` 是 false，而那種測試**不會紅，只會靜靜地不檢查**。
 */
export const toPosix = (p) => p.split(sep).join('/');
