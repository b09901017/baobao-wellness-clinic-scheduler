# 待辦的「確認」「簽療程單」兩張抽屜：按返回是收抽屜，不是離開頁面

Status: todo
來源：`findings.md` 第 13 條
動工前先讀：`public/js/ui/nav.js`（檔頭整段、`pushLayer()` `:196`）、`public/js/ui/views/home.js` 的 `drawer`（`:94`）、`mountDrawerGesture()`（`:2096`）、
`wireConfirm()`（`:2947-2980`）、`wireClose()`（`:3480-3522`）、每一個 `drawer = null` 的地方（`grep -n "drawer = null"`，8 處）、
`public/js/ui/components/sheet.js` 與 `card.js` 怎麼接 `pushLayer()`（`onHash` 那一段：換頁時收掉但不 pop）、`tests/nav.test.js`、
`CLAUDE.md` 連動表「存起來的 `pushLayer()` handle」那一列（三個坑都在裡面）
Blocked by: —

## 她要的

> 我想修一二三六的所有內容

（她 2026-10-07 的原話只有上面這一句。底下是我方 10/7 驗證時寫的描述，出自 `findings.md`，**不是她的話**：）

- 待辦的「確認」「簽療程單」抽屜按返回直接離開頁面

## 為什麼會這樣

全站的抽屜、卡片、確認框開起來時都 `pushLayer()`，所以返回鍵先收最上面那一層。
這兩張是**自己畫的**（它們要跟著整頁重畫，沒走 `openSheet()`），只接了拖曳手勢（`mountDrawerGesture()`），沒有那一層。
「依客戶」那張走 `openSheet()`，本來就有 —— 不用動。

## 要做的

這兩張開著的時候各佔一層：

- **開的那一下推一層**，handle 記在 `drawer` 物件上（跟 `shown` 同一個理由：那個物件就是「現在開著哪一張」的唯一真相）。
  `paintConfirm()`／`paintClose()` 在抽屜開著時會跑好幾次 —— **每重畫一次推一層就是這一條最容易寫出來的 bug**，要認得「這一張已經推過了」。
- **她自己關掉**（×、點背景、往下拖、送出之後）：`pop()`。**每一個 `drawer = null` 都是一條關掉的路**，8 處逐一看 ——
  漏一處的症狀是下一次按返回被吃掉一次（什麼都沒發生）。收成一支 `closeDrawer()` 讓八處都經過它。
- **按返回**：`onPop` 收抽屜、重畫，不 `pop()`（那一層已經被 nav 拿掉了）。
- **換頁**（`render()`／`renderGroup()` 把 `drawer` 設成 null）：nav 換頁時自己會清 stack，這裡不用 pop —— 但 handle 要跟著丟掉。
  問「那一層還在嗎」一律 `.active`，不問 handle 是不是 null。
- `onPop` 裡**不問任何一句**（「還沒送出，確定要關嗎」那種）—— 換頁會先來一下 popstate，問了那一道會留在下一頁上。

## 判準

- 抽屜開著按返回：抽屜收掉、還在同一頁嗎？
- 抽屜裡按幾下 ✓／✗（重畫好幾次）之後按返回：一次就收掉嗎？（不是要按好幾次）
- 抽屜用 × 關掉之後按返回：是正常回上一頁嗎？（沒有被吃掉一次）
- 送出之後（抽屜自己收掉）按返回：同上。
- 抽屜開著時點底部導覽列換頁：新的那一頁按返回正常嗎？

## 測試

- E2E（這一條只有瀏覽器測得出來）：新 spec —— 上面五條各一個 `test`，兩張抽屜都走。返回用 `page.goBack()`。
- `tests/nav.test.js` 那條掃「存著 handle 的畫面一律問 `.active`」的原始碼掃描：這一頁多存了一個 handle，照它的規矩登記。

## 審查之後（2026-10-07，subagent 讀過程式）

- **handle 的存法**：`tests/nav.test.js` 那條原始碼掃描只認 `名字 = pushLayer(`。寫成物件屬性（`drawer.layer = pushLayer(…)`）會整個躲過掃描 ——
  所以存成**模組層的一個變數**（跟 `drawer` 並排），開哪一張抽屜就記在 `drawer`、那一層記在它旁邊。原本寫的「記在 `drawer` 物件上」作廢。
- **文件**：`CLAUDE.md` 連動表那一列與 `tests/nav.test.js` 都寫「三個畫面存著 handle」，做完是四個（多了待辦那一頁）—— 兩邊一起改。
- 跟 10 都動 `home.js` 的 `applyConfirm()`。
