# 01：「送的／體驗／其他」展開後拿掉「別的課當體驗」那一行字

Status: done
Blocked by: —

## 動工前先讀

- `spec.md` 第四件
- `CLAUDE.md` 連動表「額度那一排的順序」「送的／體驗、預設體驗的課、「這一段可以做什麼」那一排」兩列
- `public/js/ui/components/giftFold.js`（全部）

## 她要的

> 第四 : 我覺得送的/體驗/其他點開後，沒必要再區分一個別的課當體驗，能不能把那行字拿掉，很礙眼 不只拍找那邊，所有地方的都要改到

## 為什麼會這樣

- `giftFold.js` 的 `html()` 把收合裡 `other: true` 的那幾顆照分類收成一排，前面一個小標 `<span class="giftfold__lead">別的課當體驗</span>`（約 69 行）；
  CSS 在 `app.css` 的 `.giftfold__lead`（約 1058 行）
- 三個入口都經過這一支：壓表（`schedule.js`）、來訪編輯器（`visitEditor.js`，日曆新增也是它）、拍 Abovee（`aboveeConfirm.js`）
- 設定 → 課程 那顆 `?`：`masterList.js:746`「沒勾的課也能當體驗或送的（在「別的課當體驗」裡）」
- 有提到那幾個字的：`tests/gift-fold.test.js`、`exam-not-mine-option.test.js`、`provisional-courses.test.js`、`slot-options-order.test.js`、`uncounted-courses.test.js`、
  E2E `67-gift-and-trial.spec.js`、`docs/操作手冊.md`、`SPEC.md`、`CONTEXT.md`、ADR-0148 —— **先分清楚是註解、是比畫面上的字、還是詞彙**：
  比畫面上那一行字的測試改成釘「沒有那一行」；註解裡指 `giftOptions()` 的 `other` 那一組照留；ADR 不改。
  **`CONTEXT.md:247` 是例外**：跟 `masterList.js:746` 同一句「（在「別的課當體驗」裡）」，講的是畫面上的位置 → 一起改（過目 M10）

## 要做的

- 拿掉那個 `<span>` 與它的 CSS；分類那一排照舊緊接在預設體驗那一排之後（`row()` 本來就是各自一行）
- `masterList.js` 那一句改成不提那一行字（例：「沒勾的課也能當體驗或送的（「送的／體驗／其他…」展開之後照分類找）」）
- 操作手冊、SPEC 講畫面上「別的課當體驗」那一行的地方改寫
- 動到 `public/`：`sw.js` 的 `VERSION` 升一號（現在 v219）、`npm run shell:snapshot`

## 判準

- 三個入口展開「送的／體驗／其他…」之後，畫面上還有沒有任何一處印出「別的課當體驗」？（單元測試掃 `giftFold.html()` 的輸出；E2E `67` 在一個入口量一次）
- 拿掉那一行之後，分類那一顆（例：「醫師門診 ▾」）會不會跟預設體驗那幾顆擠成同一行、或順序變了？（`tests/gift-fold.test.js` 既有的順序那幾條照舊綠）

## 做完時留下的（段一，2026-11-03）

- 拿掉 `giftFold.js` 那一行 `<span class="giftfold__lead">別的課當體驗</span>` 與 `app.css` 的 `.giftfold__lead`；分類那一排照舊是自己一行（`row()`），順序沒動
- 改了講畫面位置的四處：`masterList.js` 課程那顆 `?`、`CONTEXT.md` 預設體驗那一條、`docs/操作手冊.md` 兩處（壓表第 1 步、設定 → 課程）、`SPEC.md` 分類那一段
- 測試：`tests/gift-fold.test.js` 原本比 `indexOf('別的課當體驗')` 的那一條改成比分類那一排的第一顆；新的一條「展開之後沒有那一行小標」（收著選著／展開三種）；
  E2E `67` 的 G4 多一行 `not.toContainText('別的課當體驗')`（壓表那一個入口量一次）
- **沒動的**：註解裡指 `giftOptions()` 的 `other` 那一組（`slotOptions.js`、`masterData.js`、`schedule.js`、`visitEditor.js`、`aboveeConfirm.js`、`giftFold.js` 的檔頭）、
  CLAUDE.md 連動表兩列（講的是 `other` 那一組）、ADR-0148、測試名字裡的那幾個字（`exam-not-mine-option`、`provisional-courses`、`slot-options-order`、`uncounted-courses`：都是講那一組，不是比畫面上的字）
- `docs/常見問題.md` 沒有提到那幾個字；過目 M10 講的約 1498 行那一條是 05 的事（「收著的列底下為什麼多一兩行字」）
- `sw.js` v219 → v220
