# 簽療程單的抽屜跳出來兩次

Status: done
來源：使用者，2026-09-01（需求 A.1）
動工前先讀：`public/js/ui/views/home.js` 的 `wireClose()`、
`public/js/ui/components/sheet.js` 的 `wireDrag()`、ADR-0038

## 原話

> 在「簽療程單」Todo 列表那邊，點擊打勾時，抽屜（Drawer）會不正常地跳出兩次

## 根因

`#/todo/close` 那一頁的抽屜是**自己畫的**（要跟著整頁重畫，所以沒走 `openSheet()`），
而 `wireClose()` 每一次被呼叫都在最後做這件事：

```js
const box = el.querySelector('.drawer');
if (box) wireDrag(box, close, { backdrop: ... }).playIn();   // ← 每次都播進場動畫
```

`paintClose()` 會把整頁 `innerHTML` 換掉再叫一次 `wireClose()`，
而點打勾那一下 `paintClose()` **會跑兩次**：

```
[data-open] click
  ├─ drawer = { visitId, missed:new Set() }
  ├─ paintClose(ctx)                    ← 第 1 次：抽屜滑上來
  ├─ await customersData.listEntitlements(...)
  └─ paintClose(ctx)                    ← 第 2 次：抽屜「再」滑上來一次
```

第二次是為了補那一句「會多一張追蹤健檢報告」（`closeConsequences()`），
那個先畫再補的作法本身是對的（同 `loadTaskVisits()`），錯的是**重畫順便重播動畫**。

**同一個 bug 還有第二個症狀**：逐段點「這一段沒做」也走 `paintClose()`，
所以每點一顆時段丸子，整張抽屜都會從螢幕外重新滑上來一次。她一筆來訪有 2–3 段。

`#/todo/confirm` 那一張確認抽屜是同一個寫法（`wireDrawer()` 也無條件
`playIn()`），要一起看：那裡目前只有開啟時畫一次，所以看不出症狀，
但逐筆退回（`[data-reject]`）也會重畫 —— 一樣會重播。

## 要做什麼

在 `views/home.js` 裡讓**進場動畫只在抽屜從無到有的那一次播**。

`drawer` 這個模組層變數已經是「現在開著哪一張」的唯一真相，所以在它身上多記一件事：

```js
// 進場動畫只播一次。抽屜開著的時候 paintClose() 還會跑好幾次
// （補那句後果、逐段勾選），而每一次都重播等於抽屜在她眼前跳。
drawer = { visitId: btn.dataset.open, missed: new Set(), shown: false };
```

`wireClose()`／`wireDrawer()` 裡：

```js
const box = el.querySelector('.drawer');
if (box) {
  const drag = wireDrag(box, close, { backdrop: el.querySelector('[data-backdrop]') });
  if (drawer && !drawer.shown) {
    drawer.shown = true;
    drag.playIn();
  }
}
```

**不要改成「只重畫抽屜內容」**：那要把 `closeDrawerHtml()` 拆成兩半，
而這一頁的重畫成本本來就低（一張抽屜、十幾列）。真正的問題是動畫，不是重畫。

## 連動

- `#/todo/confirm` 的 `wireDrawer()` 同一個修法，`drawer` 那個物件也多一個 `shown`。
  兩張抽屜共用同一個 `drawer` 變數，所以兩邊要一起改，不然換一張的時候
  `shown` 會沿用上一張的值。
- `close()` 把 `drawer` 設成 `null`，所以下一次開啟自然又是 `shown: false`，
  不必自己重設。

## 不做

- 不動 `components/sheet.js`。`openSheet()` 那條路一張面板只 `playIn()` 一次，
  它是對的 —— 錯的是 `views/home.js` 這兩張自己畫的抽屜。
- 不把這兩張抽屜改成走 `openSheet()`。它們要跟著整頁重畫（`paintClose()` 換掉
  `el.innerHTML`），而 `openSheet()` 的面板掛在 `<body>` 上、活得比那一頁久。

## 驗證

- 瀏覽器：`#/todo/close` → 點某一筆的打勾 → **抽屜只滑上來一次**
- 瀏覽器：抽屜開著時逐段點時段丸子 → 徽章在「做了／沒做」之間切換，
  **抽屜不動**，底下那幾句後果跟著變
- 瀏覽器：`#/todo/confirm` → 點打勾 → 逐段點「客人說不行」→ 抽屜一樣不重播
- 瀏覽器：關掉抽屜、換一位客戶再開 → 這一次要播（那是新的一張）
- `npm test` 全綠（這一支動的是 UI，沒有 domain 測試會紅，
  但 `tests/module-names.test.js` 會盯 `shown` 有沒有拼錯）
