# 備份檔與金鑰檔放在 repo 最外層不會被擋；真名掃描少 27 位

Status: done
來源：`f-backup-ignore`、`ops/report.md` 第 4、5 條
動工前先讀：`docs/agents/lessons.md` 第八節、`.gitignore:12-19`、`docs/STAGING.md:388-391`（還原那一節的範例）、
`tests/no-secrets.test.js:192-220`（`realNames()`）、`CLAUDE.md`「上線」那一節講 `.local/` 的那一段
Blocked by: —
重現：`git check-ignore -v 排課系統備份-2026-10-08.json; echo $?`（1＝沒被擋）、`git check-ignore -v staging-sa.json; echo $?`、
`node .local/references/audit-2026-10-08/ops/r-nosecrets-gap.mjs`

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 備份檔放在程式資料夾的最外層不會被擋住，而說明文件正是叫你放那裡
>
> 設定頁匯出的「排課系統備份-日期.json」裡有全部客戶、健康資訊，還有試算表的密鑰。說明文件 `docs/STAGING.md` 還原那一節的指令，寫的就是把它放在程式資料夾的最外層。

## 為什麼會這樣

`.gitignore` 只擋 `/backups/`、`/exports/` 兩個資料夾與幾種金鑰檔名；最外層的備份檔、改過名的金鑰檔（`staging-sa.json`）擋不到。
真名掃描的名單只讀合併檔那一份：只出現在 Abovee 或病歷號名單上的 27 個名字不在裡面（今天一個都沒出現在被追蹤的檔案裡）。
repo 是 public，一次 `git add .` 就收不回來。

## 要做的

- `.gitignore` 多擋兩種檔名：app 匯出的備份檔（`排課系統備份-*.json`，**任何一層**）、`*-sa.json`。
- `docs/STAGING.md` 還原那一節的範例路徑改到 repo 外面（或 `.local/`），不要再示範放最外層。
- `realNames()` 多讀 `.local/references/chart-numbers.json` 的鍵與 Abovee 擷取檔的名字（`abovee-m5-m10/擷取/abovee-m5-m10.json`）。
  檔案不在（CI、別人的機器）照現在的做法跳過，不要讓測試紅。
- `CLAUDE.md` 寫的「`.gitignore` 第 57 行」行號不對（現在第 62 行）—— 改成不寫行號，寫 `/.local/` 那一條。

## 判準

- `git check-ignore -v` 這三個各回 0 嗎：最外層的 `排課系統備份-2026-10-08.json`、`docs/排課系統備份-2026-10-08.json`、`staging-sa.json`？
- 新的規則會不會誤擋 repo 裡本來被追蹤的檔案？（`git ls-files -ci --exclude-standard` 要是空的）
- `r-nosecrets-gap.mjs` 再跑一次，「漏掉的」是 0 嗎？
- 名單檔不在的機器上 `npm test` 還是綠的、而且不是靜悄悄地 skip 掉整支？（9/16 那次就是整支沒在跑）

## 測試

- `tests/` 一條：對那三個檔名跑 `git check-ignore`（真的執行，不是掃 `.gitignore` 的字）。
- `tests/no-secrets.test.js` 自己：名單來源多兩份。

## 交給 20

人員全名的名單（`.local/references/staff-names.json`）也要進 `realNames()` —— 那是 20 建的檔案，20 做的時候加。

## 做完時留下的（10/8）

- `.gitignore` 多兩條：`排課系統備份-*.json`（前面沒有斜線，任何一層都擋）、`*-sa.json`。
  `git ls-files -ci --exclude-standard` 是空的（沒有誤擋被追蹤的檔案）。
- `tests/backup-files-ignored.test.js`：真的跑 `git check-ignore`（六個路徑），加上「沒有誤擋」那一條。
- `realNames()` 搬到 `tests/helpers/realNames.js`，回 `{ names, sources: { read, missing } }`，四個來源：別名表、合併檔、
  **病歷號名單**（`chart-numbers.json` 的鍵）、**Abovee 擷取檔**（`rows[].name`）。後兩份不在的機器照舊綠，
  但 `no-secrets` 那一條會印「這台機器上沒有：…」—— 不是靜悄悄少掃。搬出來是為了能拿假名造資料夾測「每個來源真的被讀到」。
- 她的機器上：掃的名字從 66 個變 93 個；病歷號名單與 Abovee 擷取檔上不在名單裡的從 27 個變 **0**
  （`node .local/references/audit-2026-10-08/ops/r-nosecrets-gap-after.mjs`，只印數字。舊的 `r-nosecrets-gap.mjs` 自己重寫了一份舊讀法，
  所以它永遠印 27 —— 不要拿它驗）。93 個名字沒有一個出現在被追蹤的檔案裡。
- `docs/STAGING.md` 還原那一節：範例路徑改成 `.local/references/排課系統備份-….json`，補一段為什麼。`scripts/restore-backup.mjs` 檔頭同一句。
- `CLAUDE.md`：不寫 `.gitignore` 的行號。

**交給 20**：人員全名的名單（`.local/references/staff-names.json`）加進 `tests/helpers/realNames.js` —— 照 `optional()` 那個寫法加一行，
然後在 `tests/backup-files-ignored.test.js`「四個來源」那一條補一份假的。**人員的顯示名（種子上那些兩個字的）不可以進名單**：
它們本來就在種子與測試裡，一進名單整個 repo 都是命中。

沒做：Abovee 擷取檔上的 `operator`／`manager`／`creator`（人員）沒有進名單，理由同上；那是 20 的名單該管的。
