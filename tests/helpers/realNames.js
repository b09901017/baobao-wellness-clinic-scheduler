// 真名的名單從哪裡來（`tests/no-secrets.test.js` 用）。**愈完整愈好，四個來源。**
//
// 1. `aliases.json` 的 `nicknames`（鍵與值）—— 只有**有暱稱的那幾位**
//    （2026-09-16 實測：6 位、19 個字串）
// 2. **合併檔裡的客戶名單**（`import-*.json` 的 `customers[]`）—— 同一天的 import 有 28 位、52 個字串
// 3. **病歷號名單**（`chart-numbers.json` 的鍵）
// 4. **Abovee 擷取檔**（`abovee-m5-m10/擷取/abovee-m5-m10.json` 的 `rows[].name`）
//
// 後兩個是 2026-10-08 補的（prelaunch-fixes-2026-10-08/issues/03）：只出現在 Abovee 或病歷號名單上、
// 不在合併檔裡的客戶有 27 位，她們的名字進了版控那條測試照樣綠。
// **只有一部分來源時，綠燈只代表那一部分的人沒進版控** —— 所以回傳值帶著「這次少了哪幾份」，
// 呼叫端要印出來。
//
// 住在 helpers 而不是測試檔裡：這樣才能拿假名造一個資料夾，確認每一個來源真的被讀到
// （`tests/backup-files-ignored.test.js`）。**這一支與它的測試一個真名都不能寫。**

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const CHART_NUMBERS = 'chart-numbers.json';
const ABOVEE = 'abovee-m5-m10/擷取/abovee-m5-m10.json';

/**
 * @param {string} dir 結尾帶斜線。別名表所在的那個資料夾（`.local/references/` 或舊的 `.local/`）
 * @returns {{names: string[], sources: {read: string[], missing: string[]}}}
 *   `aliases.json` 讀不動會丟例外 —— 靜靜地變成綠燈比沒有這條測試更糟。
 */
export function realNames(dir) {
  const names = new Set();
  const read = [];
  const missing = [];
  const add = (n) => {
    if (typeof n === 'string') names.add(n.trim());
  };

  let aliases;
  try {
    aliases = JSON.parse(readFileSync(`${dir}aliases.json`, 'utf8'));
  } catch (err) {
    throw new Error(`${dir}aliases.json 讀不動：${err.message}`);
  }
  const { nicknames = {} } = aliases;
  for (const n of [...Object.keys(nicknames), ...Object.values(nicknames).flat()]) add(n);
  read.push('別名表');

  // 合併檔。沒有就算了 —— 別名表那一份照樣掃得到一部分。
  let merges = 0;
  for (const file of readdirSync(dir)) {
    if (!/^import-.*[.]json$/.test(file)) continue;
    try {
      const { customers = [] } = JSON.parse(readFileSync(`${dir}${file}`, 'utf8'));
      for (const c of customers) {
        for (const key of ['name', 'rawName', 'sheetName']) add(c?.[key]);
      }
      merges += 1;
    } catch {
      // 一份讀不動不要擋住其他份
    }
  }
  if (merges) read.push(`合併檔 ${merges} 份`);
  else missing.push('合併檔（import-*.json）');

  // 後兩份不在（CI、別人的機器）就跳過，但要講得出來少了它
  const optional = (rel, label, pick) => {
    if (!existsSync(`${dir}${rel}`)) {
      missing.push(label);
      return;
    }
    try {
      for (const n of pick(JSON.parse(readFileSync(`${dir}${rel}`, 'utf8')))) add(n);
      read.push(label);
    } catch {
      missing.push(`${label}（讀不動）`);
    }
  };
  optional(CHART_NUMBERS, '病歷號名單', (json) => Object.keys(json ?? {}));
  optional(ABOVEE, 'Abovee 擷取檔', (json) => (json?.rows ?? []).map((r) => r?.name));

  // 一個字的不掃（`陳`、`際`）—— 單字在中文裡到處都是，掃了只會得到一頁誤判。
  return { names: [...names].filter((n) => n.length >= 2), sources: { read, missing } };
}
