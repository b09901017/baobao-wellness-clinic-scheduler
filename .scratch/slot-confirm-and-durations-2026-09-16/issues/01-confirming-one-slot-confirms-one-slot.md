# 長按一段說「客戶已確認」，整天都被蓋章

Status: done
來源：`../spec.md`
動工前先讀：`docs/adr/0081`（時段才是原子單位）、`docs/adr/0085`（只改她點的那一段）、
`docs/adr/0089`（整天那幾顆拿掉了）、`domain/visits.js` 的 `applyStatus()`／`visitActions()`

## 她要的（原話）

> 如果在新增同一個人兩段來訪，然後我只長按其中一段，說客戶已確認，會變成整天的
> 都變成已確認，能不能我那個時段說確認就那個時段確認就好，然後如果我想要一次確認
> 整天，我可以去代辦那邊做，然後我這邊確認了某個時段客戶已確認後 待辦那邊的
> 這個時段就可以收掉

後半（「一次確認整天去待辦那邊做」）指的是待辦中心既有的確認動線，**那一條不動**。
抽屜裡那幾列的收掉在 issue 03。

## 為什麼會這樣

`ui/views/calendar.js:1154-1158`：

```js
const next = onlyOne
  ? applyStatus(visit, 'cancelled', { slotIndex, reason })
  : applyStatus(visit, action);          // ← 其餘每一種都沒帶 slotIndex
```

`domain/visits.js` 的 `applyStatus()` **早就收 `slotIndex`**（ADR-0081，:869-888）——
只有「取消這一段」那一條路傳了。`confirmed` 走的是下面那一行，於是
`slots.map((s) => stampSlot(s, to))` 把整天每一段都蓋成已確認。

`visitActions()`（`domain/visits.js:942`）也還是整筆的：那一顆的有無走
`nextStatuses(visit?.status)`，而 `visit.status` 是推導出來的整筆狀態。
同一支檔案裡 `canCancelOne` 已經是逐段的寫法了（`one.status !== 'cancelled'`），
確認那一顆照抄就好。

`visitQuickActions()` 的註解自己承認了這件事：
「剩下那幾顆（確認、改、簽療程單）仍然是整筆的」—— 那一句要跟著改掉。

## 要做什麼

1. `calendar.js:runVisitAction()`：`confirmed` 那一條也帶 `slotIndex`。
   **`close` 那一顆不要動** —— 它不寫狀態，是通到待辦中心那張逐段抽屜（ADR-0025）。
2. `visitActions()`：「客戶說可以」那一顆改成問 `slotStatus(visit, slots[slotIndex])`，
   跟 `canCancelOne` 同一個形狀。**沒帶 `slotIndex` 時維持整筆**（另外三頁的讀取
   卡片沒有長按選單，但 `visitActions()` 是匯出的，退路要在）。
3. toast 那一句從「這一天改成「已確認」」改成講**那一段**（ADR-0087：
   「筆」一個字都不上畫面，而這裡講的本來就只有一段了）。

## 判準

- 兩段的那一天，長按第 0 段說確認 → **只有第 0 段變 confirmed**，第 1 段還是
  `pending_confirm`，整筆由 `settle()` 推成 `pending_confirm`
- 一段的那一天，長按說確認 → 那一段與整筆都是 `confirmed`，`confirmedAt` 有值
- 已經取消掉的那一段不會被「客戶說可以」救回來（`applyStatus()` 逐段那條路走
  `{ ...s, status: to }`，**它沒有 `stampSlot()` 的保護** —— 確認一段已取消的段
  是一個 `TRANSITIONS` 不准的轉移，`visitActions()` 那一顆本來就不該出現）
- 這一行會不會讓一段「她還沒問過客人的時間」被算成談定了？
