# 10：網頁 app 給小工具用的兩條網址（開某一筆、開記一筆並展開給營養品）

Status: done
Blocked by: 02、03（記一筆那一排的接線定了）

## 動工前先讀

- `spec.md`「一」：小工具上**營養品的提醒點勾** → 打開網頁 app 問「給了哪幾款」；輸入卡的**給營養品** → 打開網頁 app 的「記一筆」並展開給營養品
- `public/js/ui/router.js`（`:36-49`：**不讀 query string**；`#/todo/notes` 解成 `/todo/:group`）、`ui/nav.js` 的 `leaveFor()`／`takeFor()`（只活在記憶體裡、一次）
- `home.js` 的 `openQuick()`／`wireQuick()`（泡泡「記一筆」）、`note.js` 的 `prepareToggle()`（勾營養品的提醒先問給了哪幾款）、`give()`
- ADR-0167（打開 app 先用手機裡的：殼先畫、首頁先用快取）、`sw.js` 的 `APP_PAGES`（`/`、`/index.html` 回手機裡的）
- 過目抓到的 C（深連結）

## 為什麼要在網頁這一支做

小工具（06–08）要打開網頁 app 的某一個地方，但現在**沒有任何一條網址指得到某一筆隨手記、也沒有一條打得開記一筆並展開給營養品**。
放到 Android 那一支 PR 才補的話，要再一支網頁 PR、再部署一次 staging 才能在 HTC 上測 —— 所以跟網頁這一半一起出貨。

## 要做的

- 兩條 hash 路由（照現在的路由寫法，不靠 query string），例：
  - `#/todo/notes/note/<id>`：打開隨手記那一頁、那一筆**營養品的提醒**直接跳出「給了哪幾款」（`prepareToggle()` 那一條）；一般的隨手記跳出它的長按選單（或標出那一列）
  - `#/todo/notes/new/give`：打開隨手記那一頁、泡泡「記一筆」打開、給營養品已經展開
  - 名字照路由表現有的慣例定，**寫進「做完時留下的」**（Kotlin 照抄）
- 找不到那一筆（刪了、已經勾了）→ 講一句，不是一片空白
- 冷開機（app 沒開著時從小工具打開）與熱開機都要對；**ADR-0167 的先畫殼**那一段不可以把這兩條吃掉（殼先畫、路由晚一點才接上）
- 裝到主畫面的那一顆（WebAPK）會不會接走這兩條網址：要在 HTC 上試（段二接 HTC 時順便、或 06 裝小工具時）
- E2E：直接 `goto` 兩條網址、看到對的那一層（登記進 `tests-e2e/related.js`）

## 判準

- 打開 `…/note/<營養品的提醒的 id>`，有沒有不經過「給了哪幾款」就把它勾掉的路？（不可以有）
- 打開 `…/new/give`，存下去的那一筆有沒有 `entitlementId`？（跟泡泡選了一包存的一模一樣）
- app 沒開著、從網址冷開機，兩條都到得了嗎？
- 舊的 `#/todo/notes` 照舊嗎？

## 做完時留下的

段二（2026-11-06）。E2E `99-notes-widget-links`（W1–W5，登記進 `related.js`）。sw.js v305。

**兩條網址（Kotlin 照抄，網址前面接站的網址：staging／正式各一個）**：

| 網址 | 做什麼 |
|---|---|
| `#/todo/notes/note/<隨手記的 id>` | 打開隨手記那一頁；**營養品的提醒**（有 `entitlementId`）直接問「給了哪幾款」（走 `tickNote()` → `prepareToggle()`，跟在清單上點它同一條路；按「先不要」什麼都不勾）；一般的跳出它的長按選單（`note.openMenu()`，`complete: true`）。找不到／已刪掉 →「找不到這一筆隨手記，可能已經刪掉了」；已經勾掉 →「這一筆已經勾掉了」 |
| `#/todo/notes/new/give` | 打開隨手記那一頁、右下角那一顆「記一筆」打開、給營養品已經展開（點那一顆 `[data-ng-toggle]`）；存的跟泡泡選了一包一模一樣 |

- 登記在 `ui/views.js`（`/todo/notes/note/:id`、`/todo/notes/new/give`）；比 `/todo/:group` 多兩格，`match()` 照格數比，不會撞
- 畫的是 `home.js` 的 `renderNotesLink(el, { noteId, give })`：讀全部隨手記 → **`history.replaceState` 換回 `#/todo/notes`**（不叫 hashchange；重新整理、按返回回來都不會再跳一次）→ 畫那一頁 → 接著做那一件。讀的那一下換了頁就不做
- `openQuick()` 回那一張抽屜（`sheet.el`）—— 唯一的舊呼叫端不讀回傳值
- 冷開機（`signIn(網址)`，記得上一次登入的那一條：殼先畫、路由晚一點才接上，ADR-0167）與 app 開著時換過去（W3）都量了

**還沒驗的（實機）**：裝到主畫面的那一顆（WebAPK）會不會接走小工具送出的網址、從桌面冷開機時網址的 hash 有沒有帶進來 —— 06 裝小工具時在 HTC 上試（段二接 HTC 時只看鍵盤）。
