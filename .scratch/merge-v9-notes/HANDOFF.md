# 合併檔 v9 那一輪：交接

分支：`claude/merge-v9-notes`（從 `origin/develop` 50b5187 開，還沒推）
全貌與她的原話：`spec.md`（含 subagent 過目的結論）。她 10/20 選了「這個 session 一路做完」，但 10/20 凌晨額度用完、停在 02 中間。

## 進度

| issue | 狀態 |
|---|---|
| 01 備註預設順序 | **done**（1b99807，ADR-0163；unit 全綠，E2E 74、77 改了還沒跑） |
| 02 v9：段的記一句 | **WIP**（773500f）：`FORMAT`＝v9、`FORMATS` 收 v8、`validateFile()` 驗 `note`、`planForCustomer()` 寫 `slot.note`、skill 的 `importJson()` 寫 v9；`tests/merge-v9.test.js` 4 條綠。**還沒做**：寫死 v8 的 8 條舊測試（`npm test` 紅 8：calendar-merge、merge-import:1001、merge-functional-clinic、merge-v8-gift-candidates、merge-staff-roster、merge-chart-numbers）改成 v9；`summarize()`／摘要卡「其中 N 段帶記一句」；`tests-e2e/related.js` 登記 `tests/merge-v9.test.js` 要不要（跑 `tests/e2e-related.test.js` 看） |
| 03 v9：已取消／未到的段＋取消理由 | todo（issue 已照過目改好：勾好的「取消 X」、額度照一般規則、`addExtraVisits()` 重推、匯入頁「全部標成已完成」那幾句） |
| 04 v9：長備註 | todo |
| 05 文件 | todo（含 SPEC 約 1529 行、docs/STAGING.md 約 489 行、CLAUDE.md 兩列） |

做完 01–05：`npm run verify`（會跑 74、77 與匯入相關的 E2E）→ 審查（另一段 xhigh）→ PR 進 develop → 合併。

## 產檔那一側（`.local/references/cutover-2026-10-14/`，有真名，不進 repo）

順序：`run-merge.mjs --today 2026-10-16 --tag 1020` → `make-overrides-1020.mjs`（從 `overrides.1019.json` 產 `overrides.json`，跑兩次一樣）
→ `overlay.mjs --tag 1020`（10/19 版留 `overlay.1019.mjs`；這一次加了 `keepFuture`、`restoreFromBase`、雜事改日期）→ `notes-v9.mjs --tag 1020`（→ `out-1020/import-v9.json`、`notes-report.txt`）。

已經對過的：`out-1020/import-final.json` 跟 `import-2026-10-19.json` 比只差她要的三件（「0909 新顧客會-8+5萬健檢」那一張改成一套、10/20 15:45 ILIB 新約的留著、10/28 15:30 IN 60 先不建）＋妹妹改用自己的分頁（額度一樣）。
她在舊表插列的那幾張（點滴拆肝／腸、補羊膜那一列）都修成跟 10/19 一樣的次數。比對用 scratchpad 的 `final-diff.mjs`（只印課程與日期）。

`notes-v9.mjs` 草稿跑過（記一句 20、已取消 4、未到 1、長備註 10、短備註 197→116），**還要做**：
- 已取消／未到的段要配額度（過目：`validateVisit()` 每一段都要額度，不然她之後編輯那一天存不下去）—— 照 overlay 的 `pickEntitlement()` 配，配不到、課程是預設體驗的寫體驗，都不行的不建、列出來
- `notes-plan.json`（現在是空的）要補的例外：6/30「沒做EECP但簽了療程單…」留在短備註（`keepAsMark`）；「13 14 15 因住院取消」→ 10/13～15 那 6 段的取消理由（`reroute`）；「10/15他忘記+醫美顧客會」→ 10/15 的取消／未到（`reroute`），同一位逗號版的「…9/10取消，9月皆無排課」短備註拿掉；8/27「14:30 SIS、15:45 ILIB 是…的名額」掛在那兩段（`datedNotes` 帶 `start`）；妹妹那一位「…的妹妹」那一則拿掉（舊表自己寫了「…妹妹」）；有名字開頭的那一則長備註換標題
- 規則已經加了、還沒重跑看結果：第 13 列接成一則的拆回去、夫妻共用分頁只掛在勾的那門課的那一位
- 之後：`validate.mjs` 要認 v9（段的 status／note、longNotes）→ app 這一輪合進來之後 `emu-import.mjs` 模擬器整份匯一次 → 更新切換清單（`切換那天-清單-2026-10-17.md` 最上面補 10/20 那一段）

## 中途發現

- Python 在 Windows 寫檔預設 CRLF：改 repo 的檔一律 `open(..., newline='')`（01 那一次轉回 LF 了）
- `.local/references/redact.mjs` 漏遮行事曆上直接寫的叫法 → 加了 `redact-extra.json`（`.local`，有真名）
