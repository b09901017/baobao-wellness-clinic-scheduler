# 來訪編輯器按下去那一刻一律重讀這位客戶的全部來訪

Status: todo
Blocked by: —
動工前先讀：`.scratch/code-health-2026-11-04/issues/01-editor-reuses-stale-visits-on-save.md`（問題、重現步驟、修的方向，**詳細都在那一支，這裡不抄**）；
`public/js/ui/views/visitEditor.js` 的 `refreshCustomerVisits()`、`submit()`、`mergedPayload()`、`cancelOneSlot()`；
`public/js/data/visits.js` 的 `save()`、`countOps()`、`listWhole()`；ADR-0158、ADR-0083；`docs/agents/lessons.md`

## 她要的

「11/4 全庫健檢找到 6 條，都只記錄、還沒修」→ 11/5 選了先修 bug。她 iPad 與手機兩台並用，正是會撞到的情境。

## 為什麼會這樣

`refreshCustomerVisits()`（`visitEditor.js` 約 `:1643`）在「打開時讀的是伺服器那一份、這一位最近一次也是伺服器讀的、現在沒離線」時直接 return，
沿用 `boot()` 那一刻的 `ctx.customerVisits`。`save()` 拿那一份組 `after` 交給 `countOps()` 重算額度，額度那一筆的 update **沒有 `ifUpdatedAt`**；
`ifUpdatedAt` 只擋同一筆來訪。

主控 11/5 查證（CodeGraph `callers save` 9 處＝grep 9 處）：只有 `submit()`、`cancelOneSlot()` 兩條路吃到這個提前 return；
另外 7 個呼叫端（壓表 `addSlot`、日曆 `runVisitAction`、批次取消、確認抽屜 `applyConfirm`、簽療程單 `applyClose`、`relinkAfterSave`、拍 Abovee `writePhotoPlan`）
都在按下去那一刻 `listWhole()`。`isWholeList`／`lastReadWhole` 只有這一處在用。

## 做法

拿掉提前 return：`refreshCustomerVisits()` 每次都 `listWhole()`。改掉 `:1639-1641` 那段註解（「`ifUpdatedAt` 照樣擋」只對這一筆成立）。
代價：確認框晚一拍（一次讀取）—— 跟其他 7 個入口一樣，可以接受。
拿掉之後 `isWholeList`／`lastReadWhole`／`wholeLists` 沒有人用了（過目確認：只有這一處），一起刪。
**`tests/incomplete-read.test.js` 約 `:223`、`:226` 釘著提前 return**（`assert.match` `isWholeList`／`lastReadWhole`）：改成 `doesNotMatch`，並寫明理由（健檢 #1）。
撞期提醒用的 `ctx.sameDayVisits` 也是 boot 那一份：只影響提醒，順手一起重讀（不重讀就寫一句為什麼）。
ADR-0158 原文本來就是「存之前重讀」，不用補 ADR。

## 判準

- 打開編輯器之後，別台替同一位、同一筆額度加了一段 → 這裡存檔，那一筆額度的 `bookedCount` 會不會少算那一段？（不可以）
- 別台在**同一天**加了一筆 → 這裡存檔會不會長出同一天第二筆來訪？（不可以，要併進去 —— `sameDayVisitFor()` 拿到的是重讀的那一份）
- 讀不到／離線 → 照舊講一句、不存、她打的字原封不動。代價跟另外 7 個入口一樣：網路不穩時 `listWhole()` 要等約十秒才退回快取、然後擋下不存

測試：E2E —— 打開編輯器、選額度之後用 fixture 的 `seedDocs` 替同一位、同一筆額度寫一段，再在編輯器存檔，`readDoc` 讀回額度的 `bookedCount`。
新的 spec 要登記 `tests-e2e/related.js`。先紅再綠。

## 做完時留下的
