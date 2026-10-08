# 備份檔與金鑰檔放在 repo 最外層不會被擋；真名掃描少 27 位

Status: todo
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
