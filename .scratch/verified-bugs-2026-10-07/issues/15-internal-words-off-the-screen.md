# 畫面上的內部用語：「SPEC 第 6.4 節」、舊網址、「寫死在程式碼裡」、「ADR-0074」

Status: done
來源：`findings.md` 三的第 4、5、6 列（第 3 列資料健檢那一頁歸 18）
動工前先讀：`public/js/ui/views/visitEditor.js:1395-1400`、`public/js/domain/messageTemplates.js:75/107`（`where` 那一格在哪裡被印出來）、
`public/js/ui/views/settings.js:65/164/173`、`public/js/domain/aiUsage.js:63`、`public/js/ui/views/aiUsage.js:94`、`public/js/ui/views/masterList.js:471`、
`public/js/ui/views/preferences.js`（排序權重頁的公式）、`CONTEXT.md`、`tests/fewer-words.test.js`（`KEEP` 只准往下）、`tests/tip-red-lines.test.js`、
`CLAUDE.md` 連動表「畫面上一段常駐的說明」「UI 文案、新的詞」兩列
Blocked by: —

## 她要的

> 我想修一二三六的所有內容

（她 2026-10-07 的原話只有上面這一句。底下是我方 10/7 驗證時寫的描述，出自 `findings.md`，**不是她的話**：）

- 日曆 → 已完成的段 → 鉛筆：「（SPEC 第 6.4 節）」
- 設定 → LINE 回覆模板：「收件匣 #/todo/inbox」「時段反查 #/todo/backfill」——舊網址；現在是 待辦 → 表單收件匣（`#/todo/forms`）、壓表 → 時段反查（`#/schedule/backfill`）
- 設定首頁、AI 用量、課程編輯、排序權重：「沒有寫死在程式碼裡」「SPEC 第 12 節」「程式裡的天花板」「（不會擋，ADR-0074）」、排序權重頁的公式

## 為什麼會這樣

這幾句是寫給寫程式的人看的話直接上了畫面：文件章節、ADR 編號、路由、「程式碼」。沒有規則在裡面，純文案。

## 要做的

一句一句換成她的話，**意思不變、不加字**（她 2026-09-10：「非常占版面」）：

| 在哪 | 現在 | 改成（方向，動工時對著畫面定稿） |
|---|---|---|
| `visitEditor.js:1399` | 已完成的來訪不能直接改（SPEC 第 6.4 節）。要更正請填理由… | 拿掉括號那一段 |
| `messageTemplates.js:75` | 收件匣 #/todo/inbox | 待辦 → 表單收件匣（照那一頁現在的標題寫；不印網址） |
| `messageTemplates.js:107` | 時段反查 #/todo/backfill | 壓表 → 時段反查 |
| `settings.js:65` | …都在這裡自己加，沒有寫死在程式碼裡。 | 拿掉後半句 |
| `settings.js:164/173` | SPEC 裡已知的…／SPEC 第 12 節列出的… | 「預設的」那一類的字，不提 SPEC |
| `aiUsage.js:63`（domain）、`ui/views/aiUsage.js:94` | 程式裡的天花板 | 「最多只能設到 US$N」那一類的字 |
| `masterList.js:471` | （不會擋，ADR-0074） | （不會擋） |
| `preferences.js` | 排序權重的公式 | 動工時看那一頁：公式換成一句白話，或收進 `tip()` |

**`where` 那一格**：先看它印在哪裡、是不是連結。是純文字就照上面改；它如果被拿去當 `href`，連結要指到現在的路由（`#/todo/forms`、`#/schedule/backfill`），字照上面。

改完 `grep -rn "SPEC 第\|ADR-[0-9]\|寫死\|程式碼\|程式裡" public/js --include=*.js`，把**在字串裡**（不是註解）的再看一輪 —— `findings.md` 列的是 10/7 看到的，不保證是全部。
資料健檢那一頁（`domain/health.js`、`ui/views/health.js`）的留給 18。

## 判準

- 畫面上還找得到「SPEC」「ADR」「程式碼」「#/」這幾個字嗎？（資料健檢那一頁除外，18 做）
- 每一句改完，講的事跟原本一樣嗎？有沒有哪一句變長了？
- `tests/fewer-words.test.js` 的 `KEEP` 有沒有變長？（只准往下）

## 測試

- 單元：一條掃原始碼的（去掉註解之後，`public/js/ui` 與 `domain/messageTemplates.js`、`domain/aiUsage.js` 的字串裡沒有 `SPEC 第`、`ADR-`、`#/todo/inbox`、`#/todo/backfill`）。
  資料健檢那兩支先放在豁免名單裡並註明「18 做完拿掉」。

## 審查之後（2026-10-07，subagent 讀過程式）

- `tests/fewer-words.test.js` 的 **`MOVED`** 釘著這一支要改的兩句原文（`settings.js` 那一句與 `preferences.js` 的公式）—— 改字要一起改那一份，不只 `KEEP`。
- **排序權重的公式已經在 `tip()` 裡**，「或收進 `tip()`」不成立：要做的是把 `?` 裡那一句換成白話。
- 掃描字樣掃 **`SPEC`**，不是 `SPEC 第` —— 後者抓不到「SPEC 裡已知的」。
- 跟 18 都動 `fewer-words.test.js` 的 `MOVED`。

## 做完時留下的

- 七句換掉：設定首頁、載入種子的兩句（「預設的」）、已完成的來訪、器材的「（不會擋）」、AI 用量兩處（「最多只能設到 US$N」）、LINE 模板兩格 `where`（「待辦 → 客戶填好的時間」「壓表 → 時段反查」—— 照那兩頁現在的標題；`where` 是純文字，不是連結）。
- 排序權重的 `?`：公式換成「四個數字是每一項的份量：越大，那一項越能把客戶排到前面。」`fewer-words.test.js` 的 `MOVED` 兩句跟著改。
- `tests/no-dev-words.test.js` 掃 `ui/views`、`ui/components`、`messageTemplates.js`、`aiUsage.js`（去掉註解）。豁免：`dialog.js`（開發時才丟的錯）、`health.js`（**18 做完拿掉**）。
