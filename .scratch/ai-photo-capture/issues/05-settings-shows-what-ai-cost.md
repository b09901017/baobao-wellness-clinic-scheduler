# 設定 → AI 用量

Status: done
Blocked by: 02
來源：`../spec.md`
動工前先讀：`ui/views/settings.js:81`（「資料」那一區）、`ui/components/tip.js`、
`ui/toast.js` 的 `withSaveState()`、`tests/number-fields.test.js`、`domain/audit.js` 的 `describeParts()`

## 她要的（原話）

> 然後也要給ai預算限制
> 如果可以的話可以在設定那邊看到目前用了多少ai錢

## 為什麼會這樣

02 的 Function 每一次呼叫都記進 `aiUsage/{YYYY-MM}`，但沒有地方看。
上限（`config/ai.monthlyCapUsd`）與暫停（`config/ai.paused`）也沒有地方改。

## 要做什麼

- 設定 →「資料」多一格 **AI 用量**（`#/settings/ai`），副標寫這個月估計多少
- 那一頁：
  - **這個月估計 US$x.xx / 上限 US$y**，一條進度條。80% 起變色
  - 四種單子各花了多少、各幾次
  - 今天幾次 / 每日上限
  - 最近 20 次：時間、哪一種、成功／失敗／被擋（哪一道，用人話）、估計多少。**沒有內容**
  - 上限：數字欄位（`min` 0、`step` 1，跟 domain 驗證講同一句話）；超過程式天花板時存不下去並講出天花板是多少
  - 「暫停 AI」開關：暫停中四個拍照入口都講「AI 暫停中，到設定 → AI 用量打開」
- 「估計」兩個字要看得到，理由收進 `?`：「照 2027 年的價格算，今年底前實際帳單會比這個低；Google 帳單另外還有別的東西」
- 寫入走 `withSaveState()` 帶 `key`；稽核上那一句走 `describeParts()`（「把 AI 每月上限改成 US$10」「暫停 AI」）

## 判準

- 模擬器叫兩次假的辨識 → 這一頁的次數是 2、估計花費跟 `aiUsage` 的合計一樣
- 暫停之後 06 的相機按下快門 → 講的是「AI 暫停中」不是「辨識失敗」
- 上限改成 0 → 下一次呼叫被擋，這一頁最近那一列寫著「超過這個月的上限」
- `tests/save-guards.test.js`、`tests/number-fields.test.js`、`tests/fewer-words.test.js` 綠燈
- **這一頁有沒有任何一個數字，會讓她以為那就是 Google 的帳單金額？**
