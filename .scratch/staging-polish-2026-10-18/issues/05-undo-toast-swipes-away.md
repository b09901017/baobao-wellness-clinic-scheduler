# 復原那一條：往左或往下滑掉、停 12 秒

Status: done
Blocked by: —
段：一（high，先單獨一支 PR）
動工前先讀：`ui/toast.js` 整支（`show()`、`saved()` 的 `UNDO_MS`、`failed()`、`queued()`、`saving()`）；`public/css/app.css` 的 `.toast`（`--toast-lift`、`body:has(.deck) > .toast`、`.drawer-backdrop` 那幾條）；
`SPEC.md` 6.3（「5–10 秒」）、6.9（失敗要看得見）；CLAUDE.md「貼在畫面底部的東西」「寫入的等待與失敗文案」兩列；
E2E `24-layout-reach`（F1–F6）、`10-offline`、以及讀 `data-undo` 的那十一處（`grep -rn "data-undo" tests-e2e`）；`app.undo()` 之類的 fixture（`tests-e2e/fixtures/app.js`）

## 她要的

> 8. 我在想，最底下會跑出來的那個復原按鈕，能不能左滑或是下滑關掉，不然每次都要等他自己消失，或是其他方式可以提前消失他，如果要滑掉的話好像就可以長一點之類的不知道，比較好滑，比較不會誤按

她 10/18 回「復原那條可以滑掉之後，要不要停久一點」：「好」（12 秒）。

## 為什麼會這樣

`toast.js` 的 `show()` 只有逾時會收（`UNDO_MS = 8000`），沒有任何手勢或關閉鈕。它站在懸浮鈕那一條基準線、跟導覽列搶位置（CLAUDE.md 那一列），
所以 8 秒裡她的下一下常常得繞開它。

## 要做的

- **復原那一條、一般的「已儲存」「已復原」那幾種**：往左或往下拖超過一段距離（或快速一甩）就收掉；沒拖夠放開 → 彈回原位
- **手指一移動就當成在滑**：從「復原」那顆按下去、拖走 → **不觸發復原**（pointerdown 記起點、移動超過幾個像素就取消那一次 click）。這是她說的「比較不會誤按」的那一半
- 拖的時候整條跟著手指走、透明度跟著降（看得出「這樣會收掉」）；`prefers-reduced-motion` 時不做位移動畫，只收
- **不給滑的**：「儲存中…」（`saving()`，正在飛）、「失敗、重試」（`failed()` 有 `onRetry` 的那一種，SPEC 6.9）、「已經存在這台裝置上了」（`queued()`）
- `UNDO_MS` 8000 → 12000；`SPEC.md` 6.3 的「5–10 秒」改成「12 秒，可以滑掉」
- 收掉之後那顆復原就沒了（跟逾時一樣），不留別的入口

## 判準

- 已儲存（可復原）的那一條：模擬往左拖 120px 放開 → `#toast` hidden；拖 20px 放開 → 還在、位置回原處
- 從「復原」那顆起手往下拖走 → 沒有呼叫 `onUndo`（沒有「復原中…」）、那一條收掉
- 點一下「復原」→ 照舊復原（既有十一處 E2E 全綠）
- 「儲存中…」「失敗、重試」那兩種拖了不收
- 12 秒才自己收：**`toast.js` 在 node 裡 import 不起來**（它 import `data/repo.js`，那一支從 gstatic 的網址 import Firebase），E2E 也不能裝假時鐘（`06-time-travel.spec.js` 檔頭講了為什麼）——
  把 `UNDO_MS` 與「哪幾種給滑」的判斷搬到一支純的小模組（toast 讀它），單元測試量那一支；不要在 E2E 裡等 12 秒（CLAUDE.md 禁 `waitForTimeout`）
- 「拖多遠才收、移動幾個像素才算在滑」也放在那支純模組裡給單元測試量；E2E 只量「真的收掉了」「沒觸發復原」
- E2E `24` 的 F1–F6 全綠（位置規則沒動）

## 做完時留下的

- 純的那一支：`public/js/ui/toastSwipe.js`（`UNDO_MS` 12000、`TAP_SLOP_PX` 8、`DISMISS_PX` 72、`FLICK_PX_PER_MS` 0.6、`FLICK_MIN_PX` 32、
  `swipeable(kind)`、`pull()`、`isDrag()`、`release()`、`fadeAt()`）；單元測試 `tests/toast-swipe.test.js`（含 toast.js 那三種真的帶不給滑的 kind、SPEC 6.3 的字）
- `toast.js`：`show()` 多收 `kind`，每一種呼叫都帶（saving／queued／retry 不給滑，其餘給）；手勢用 pointer 事件掛在 `#toast` 上一次（`swipeWired`）。
  手指一動超過 8px 就 `setPointerCapture`、停掉自己收的計時；放開時 `release()` 判收或彈回（彈回就從頭再算一次那一條的時間）。
  拖過之後那一下 click 在捕獲階段吃掉 —— 從「復原」上拖走不會復原
- 位移用 CSS 的 `translate` 不用 `transform`（iPad 那一條靠 `transform: translateX(-50%)` 置中）；減少動態時拖的時候不位移、收掉不滑出去
- **`.toast[data-swipe]` 要 `user-select: none`**：E2E 抓到的 —— 第一次拖會把「已建立」三個字選起來，第二次從選起來的字上拖變成瀏覽器的拖放（`pointercancel`），那一條就收不掉。手指長按也選得起字，不只是測試的事
- 「拖不遠但甩得快」也收，但至少要甩 32px —— 不然手指在「復原」上滑一下就沒了；也讓 Playwright 那種瞬間的 20px 拖不會被當成甩
- SPEC 6.3 改成「停 12 秒，可以往左或往下滑掉」
- E2E `69` 的 P5：往左拖 20px 彈回原處、拖 120px 收掉、從「復原」往下拖走收掉而且兩位客戶都還在、點一下「復原」照舊復原。重跑 4 次全綠。
  `steady()` 改成 x、y 都要停（只看 y 的話量到橫的過場半路）
- E2E `24` 的 F1–F6、`10-offline` 在 verify 裡全綠（位置規則沒動）
