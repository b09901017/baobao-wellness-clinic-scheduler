# 日曆上「已確認」和「已完成」同一個顏色，月檢視根本不分

Status: open
回報者：使用者，2026-08-20
動工前先讀：`SPEC.md` 第 8.6 節、`docs/adr/0015-calendar-is-a-first-class-surface.md`、
`docs/adr/0020-the-calendar-never-changes-pages.md`

## 症狀

她要三種顏色，一種對應流程上的一步：

| | 什麼時候 | 來訪狀態 |
|---|---|---|
| 顏色 A | 壓完表記進來，還沒問客人 | `pending_confirm` |
| 顏色 B | 客人說可以了 | `confirmed` |
| 顏色 C | 客人當天真的來了、簽了就診單 | `done` |

現在只有兩種，而且兩種是在兩個地方各寫一次的：

- **日檢視**（`ui/views/calendar.js` 的 `timerow`）：
  `r.status === 'pending_confirm' ? 'badge--soon' : 'badge--ok'`
- **週檢視**：同一個三元式又寫了一次，
  `background: ${... ? 'var(--soon)' : 'var(--accent)'}`
- **月檢視**：`visitAsBar()` 一律回 `kind: 'kind-visit'` ——
  **完全沒有狀態這回事**，取消以外的每一筆都同一條色條

所以「已確認」「已完成」「未到」在日曆上長得一模一樣。

## 想要的樣子

一個地方決定「這個狀態是什麼顏色」，三種檢視都讀它。建議放
`domain/visits.js`（狀態機本來就在那裡）或另開一支 `domain/visitStatus.js`，
export 一組 `{ status → { label, cls } }`，CSS 那邊一個狀態一個 class。

`no_show` 與 `cancelled` 也要有各自的樣子 —— 現在 `cancelled` 根本不畫
（`isActive()` 濾掉了，這是對的），`no_show` 混在綠色裡是錯的。

## 為什麼不能各寫各的

這一支和 `issues/07`（進度追蹤頁）講的是同一份狀態。使用者原話：

> 前面說的流程，寫程式的時候都要記得同步，這很重要

日曆說「已確認」、進度追蹤頁說「已完成」，她不會知道哪個算數 ——
這正是 `CLAUDE.md` 那張表上「同一位客戶在兩個畫面排名不同」的同一種毛病。
所以顏色與標籤只能有一份，做完在 `CLAUDE.md` 的「容易漏掉的連動」補一列。

## 一起處理

- 月檢視的色條放不下文字，光靠顏色分三種在小格子上不一定看得出來。
  可以考慮讓 `summaryByDate()` 除了現有的 `pending` 之外也回 `confirmed` / `done`，
  月格子上用一個小記號帶出「這天還有 N 筆沒問」。
- 頂端那排篩選（`ui/views/calendar.js` 的 `KINDS`）現在只分「來訪／個人行程／休假」。
  要不要多三顆「只看待確認／已確認／已完成」，做之前先問她 ——
  那一排已經有五顆，`SPEC.md` 第 8.6 節說控制項最多兩列。
