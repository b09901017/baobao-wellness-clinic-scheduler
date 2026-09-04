# 這一輪的測試：她要手動點的每一件，先用 E2E 跑過

Status: done
來源：她上一輪定下來的規矩（`../asks-2026-09-04/spec.md` 第五項）
動工前先讀：`tests-e2e/fixtures/data.js`、`tests-e2e/specs/15-playbook.spec.js`

> 你叫我手動測試的那些其實可以寫 e2e 幫我測吧，你測完我再手動測一次。
> 之後也是如此，能寫 e2e 先測出來的就寫測試。

**每一支動工的當下就把測試補上，不留到最後。**

## 單元（`npm test`，兩秒）

| 檔案 | 盯什麼 | issue |
|---|---|---|
| `tests/line-text.test.js`（新） | 她那整段原文清洗後每一行都對；冪等；全形不動；`(11)` 不動；`*休2` 不動 | 03 |
| `tests/messages.test.js` | 六則的**預設值一字不差**（改動前後的字串比對）；換過模板之後的產出 | 01 |
| `tests/message-templates.test.js`（新） | `fill()` 認不得的佔位符原樣留著；空字串當作沒存過 | 01 |
| `tests/consequences.test.js` | `untickConsequences()` 四種情境；`cancelConsequences()` 印得出正確的系統名 | 05 |
| `tests/calendar.test.js` | `agendaFor()` 的 `hasNote` | 08 |
| `tests/playbook.test.js` | 不動（這一輪沒改 domain 規則） | 02〜04 |
| `tests/save-guards.test.js` | 模板頁的存檔鈕要有 `key` | 01 |
| `tests/number-fields.test.js`、`tests/tokens.test.js`、`tests/shell-cache.test.js` | 照樣綠（這一輪不加數字欄位、不加 token、不加 `public/` 根目錄的檔案） | 全部 |

## 端對端（`npm run test:e2e`）

分兩支新的，加三支既有的補測：

### `tests-e2e/specs/18-memo-paste-and-emoji.spec.js`（新）

| # | 這一支盯的「看起來對、其實不對」 |
|---|---|
| M1 | 貼 60 行進去 → 框裡真的捲得動（`scrollHeight > clientHeight`）**而且存檔鈕在畫面內** |
| M2 | 貼她那段 LINE 原文 → 畫面上有 `🐻` 與 `1️⃣`，**沒有** `(emoji)`、`(加1)` |
| M3 | 貼上全形 `（乾淨度）` → 一個字都沒被改 |
| M4 | 點 emoji 列一顆 → 插在**游標那裡**，不是接在最後，而且焦點還在輸入框 |
| M5 | 存起來 → 重新整理 → emoji 與換行原樣還在（存進去了沒，不是畫面上有沒有） |
| M6 | 帶 emoji 的那一份 → 日曆點開來訪，浮出來的前幾行**顯示得出 emoji 且不破版** |
| M7 | 這一頁還是一個勾選框都沒有（ADR-0067 的守衛，emoji 列是 `<button>`） |

### `tests-e2e/specs/19-untick-and-drawer-todos.spec.js`（新）

| # | 盯什麼 |
|---|---|
| U1 | 勾掉「追蹤健檢報告」→ 長出「約二返」與「寄報告給醫師」（既有行為，當基準） |
| U2 | 拿回「追蹤健檢報告」→ **跳確認框**，而且框裡列得出那兩張 |
| U3 | 按「取消」→ 報告**還是已完成**，那兩張還在 |
| U4 | 按「還是拿回來」→ 報告回到未完成、那兩張真的不見了 |
| U5 | 二返已經約在某一天 → 框裡印得出那個日期，**而且那一筆二返來訪還在日曆上**（這一條是在盯「不可以嚇她」那句話：警示講的必須是真的） |
| U6 | 拿回 Examine → **不跳確認框**（只有會連動的才問） |
| U7 | 日曆點開一筆健檢 → 看得到「追蹤健檢報告」與死線 |
| U8 | 那一塊裡沒有任何 `input[type=checkbox]` |
| U9 | 什麼待辦都沒有的來訪 → 那一塊整個不出現 |
| U10 | 有「記的話」的那一列看得到記事本圖示；沒有的看不到 |
| U11 | 取消一筆健檢 → 確認框印得出「Examine」（不是三個系統並列） |

### 既有的三支要補

| 檔案 | 補什麼 |
|---|---|
| `15-playbook.spec.js` | 卡片高度多了 emoji 列之後，P3（丸子點一顆滑到正中間）還要綠 |
| `11-todo-drawer.spec.js` | 抽屜裡拿回一張鏈上的待辦也會跳確認 |
| `17-settings-fields.spec.js` | 新的模板子頁：改一則 → 重新整理 → 待辦中心那一則跟著變；「回復預設」回得去 |

## 跑法（這台機器的三個坑）

全套 118 支要 **18 分鐘**，而且**跑到一半不可以改 `public/` 底下的檔案**
（Hosting 模擬器是即時供檔的）。所以：

- 開發過程只跑 `npm test`（2 秒）與 `npm run test:rules`（16 秒）
- 單支 E2E：`npx playwright test --project=phone tests-e2e/specs/18-*.spec.js`
- 全套留到開 PR 之前跑一次
- 中斷之後要自己清 port：4400、4500、5000、8080、9099

## 交付時要給她的手動驗收清單

E2E 跑完之後，最後一則回覆要列出她自己再點一次的動線 —— 至少包含她信裡指名
的兩個情境：**LINE 複製貼上**與**反勾選二返警告**。

---

## 動工之後跟計畫不一樣的地方

| 計畫寫的 | 實際做的 | 為什麼 |
|---|---|---|
| `tests-e2e/specs/19-*.spec.js` 有 U1〜U11 | 12 支（多一支 U10b） | 「兩顆圖示同時在」跟「有一顆」是兩件事，而擠掉狀態徽章只有兩顆都在時才看得到 |
| 15-playbook 要補一支 | **一個字都沒改，17 支照樣綠** | emoji 列不影響 `scrollIntoView`，P11「一個勾選框都沒有」也照樣過（emoji 是 `<button>`） |
| 11-todo-drawer 要補「抽屜裡拿回來也會問」 | **沒補** | 那一條走的是同一支 `confirmUntick()`，而 19 的 U2〜U4 已經蓋住了。補一支只是把同一件事再測一次 |
| 02-examine-chain 不用動 | **改了兩支** | J-D3 與 J-D6 都在拿回「追蹤健檢報告」，現在會先跳確認。兩支各多一行 `app.ok()` |
| 沒寫到 | `tests/todo-flow.test.js` 多 10 支 | `todosForVisit()` 是新的 domain 函式（issue 07 的鏡像靠它） |
| 沒寫到 | `tests/no-secrets.test.js` 的 `NOT_A_NAME` 多三個詞 | 她那段筆記裡的「提早10分」被 PII 守衛當成「姓名＋病歷編號」。改測資等於那支測試不再測她真的會貼的東西，所以改的是白名單 |

## 這一輪最後的數字

- 單元：**1553 綠、0 紅**（動工前 1491）
- 新的 E2E：`18-memo-paste-and-emoji`（7 支）、`19-untick-and-drawer-todos`（12 支）、
  `17-settings-fields` 多 5 支（S6〜S10）
- `public/sw.js` 的 `VERSION` 從 v91 到 v94，`SHELL` 多四支
