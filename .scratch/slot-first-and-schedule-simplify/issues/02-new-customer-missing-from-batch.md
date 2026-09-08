# 新增的客人在當月壓表看不到 —— 凍結的是順序，不是名單

Status: todo
來源：使用者，2026-09-08（需求一 b）
動工前先讀：`docs/adr/0001` 的 Consequences、`ui/views/schedule.js` 的 `rowsOf()`

## 她要的

> 九月進去我想知道為什麼我這時候新增客人了 我不能同樣在9月壓表看到他？
> 我覺得這部的邏輯也怪怪的 可以解釋一下並且修正嗎

## 根因：兩層疊在一起

**第一層（bug）。** `rowsOf()`（`schedule.js:389`）把牆上的人限死在
batch 建立那一刻的名單：

```js
const ids = new Set((batch.queue ?? []).map((q) => q.customerId));
customers: data.queueInput.customers.filter((c) => ids.has(c.id)),
return (batch.queue ?? []).map((q) => …)
```

九月那一批是 9/1 開的，9/8 新增的客人**永遠**進不去 —— 不是排在後面，是不存在。

而 ADR-0001 的 Consequences 只授權凍結**順序**：

> 狀態隨時推導保持正確，**順序**凍結是為了讓她換裝置回來時不會發現順序跳掉。

**把「凍結順序」寫成「凍結名單」超出了那份授權。**

**第二層（不是 bug，但畫面要講）。** `buildCustomerQueue()`（`scheduling.js:202`）
`if (totalRemaining <= 0 && !includeUsedUp) continue;` —— 身上沒有剩餘次數的
客戶本來就不上牆。新客人只建了人、還沒買方案就算修好第一層也不會出現。

## 決定

**一、既有的照凍結順序排（一個字都不動），新符合資格的接在最後面。**

`rowsOf()` 改成：既有 `batch.queue` 的順序 + 現在符合資格但不在 queue 裡的那幾位。
新來的那幾位標一顆「新加入」丸子 —— 不標的話她會以為順序算錯了。

**二、順手寫回 `batch.queue`。** 不寫回的話 `progressOf()` 的分母跟牆上的人數
對不起來（「已壓 5 / 23」但牆上 25 位）。寫回走 `batchesData.saveProgress()`
那一支，**只有真的多出人時才寫**（每次進來都寫一次等於每次開都產生一筆稽核）。

**三、規則寫在 domain，不寫在畫面。** `domain/scheduling.js` 多一支
`mergeIntoQueue(batch, rows)`：回 `{ queue, added }`。畫面只問「有沒有多」。

## 為什麼不是別的做法

**每次進來重算整個佇列。** 那會推翻 ADR-0001 的 Consequences —— 她昨天壓到一半，
今天打開順序整個跳掉。

**只在畫面上補，不寫回 batch。** 分母與牆上人數對不起來，而那個數字她會看。

## 測試

- `mergeIntoQueue()`：既有順序一個字都沒動，新的接在最後面
- 沒有新的人時回的 `added` 是空的（呼叫端不會寫入）
- 已經在 queue 裡、但現在次數用完的那一位**留著**（`includeUsedUp: true` 那條路）
- 新增一位有額度的客戶 → 出現在牆上最後面、帶「新加入」
- 新增一位**沒有**額度的客戶 → 不出現（第二層，是對的）
- E2E：開一批 → 新增客戶 → 回壓表 → 看得到
