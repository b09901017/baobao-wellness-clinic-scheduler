# 唯讀鎖定還是整天的：一段已完成、一段已確認時，已完成那一段照樣編輯得動

Status: todo（**這一輪刻意沒做**，見底下「為什麼先不做」）
來源：做 issue 01 時查到的，不是她報的
動工前先讀：`docs/adr/0097`（確認也是逐段的）、`docs/adr/0085`、
`SPEC.md` 第 6.4 節（已完成是唯讀鎖定區）

## 現在壞在哪

`domain/visits.js:985`（`visitActions()`）與 `ui/views/visitEditor.js:253` 都問

```js
isLocked(visit?.status)        // visits.js
isLocked(draft.status)         // visitEditor.js
```

而 `visit.status` 是**推導出來的整筆狀態**（`visitStatusFrom()`，由「還沒定案」
往「定案」比）。所以一天裡第 0 段已完成、第 1 段還在已確認時，整筆推出來是
**`confirmed`** —— 於是：

- 長按第 0 段（已完成的那一段）→ 照樣給「改這一段」
- 開進去之後 `locked` 是 false → 那一段的時間、器材、診間全部改得動，
  **不用填更正理由**

反過來也錯：一天三段全部做完，整筆 `done` → 就算她只是想改第 2 段身上那一句話，
也得走更正流程。

## 為什麼先不做

兩處要一起改，而 `visitEditor.js` 那一處牽著更正流程（`ctx.unlockReason`）與
稽核紀錄。issue 01 只動「確認」那一顆，把鎖一起翻掉會讓那一支的判準糊掉 ——
而這一條她沒報過，也還沒有人因為它出過事。

## 要做什麼（下一輪）

`isLocked()` 的呼叫端改成問**那一段**：

- `visitActions()`：帶了 `slotIndex` 就問 `slotStatus(visit, one)`
- `visitEditor.js`：`mountEdit()` 帶了 `slotIndex` 時 `locked` 照那一段算；
  沒帶的那條路（整天）已經沒有畫面上的入口了（ADR-0089），但網址還在

## 判準

- 第 0 段 `done`、第 1 段 `confirmed`：長按第 0 段**沒有**「改這一段」，
  長按第 1 段有
- 三段全部 `done`：想改第 2 段要填更正理由（跟現在一樣）
- 更正流程（`unlockReason`）與稽核紀錄上印的東西一個字都沒變
- 這一行會不會讓一段已經結案、次數已經扣掉的來訪被安靜地改掉？
