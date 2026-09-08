# 同一張表單裡排第二段時，額度要扣掉剛剛暫排的

Status: todo
來源：使用者，2026-09-08（需求 5a）

## 她要的

> 第一個時段排了某課程（例如客戶僅有 1 堂 INDIBA 額度），在同一介面選擇
> 第二個時段時，必須扣除剛剛已暫排的額度，不得讓額度仍顯示為 1 且重複選取。

## 現在

`ui/views/visitEditor.js` 的 `slotCard()`：

```js
const c = counts(e, customerVisits, e.id);   // ← customerVisits 是**存好的**那些
```

草稿上那幾段不在裡面，所以三段都選同一筆額度時，三顆丸子都寫「剩 1」。

**驗證那一側其實已經算對了**：`entitlementWarnings()` 把這一筆算進去
（`[...customerVisits.filter(...), visit]`），所以上面的「提醒」卡片
已經會說「排完這次會超過總次數」。**只有丸子上那個數字沒跟上。**

## 要做的事

丸子上的數字改成**把草稿算進去**：

```js
counts(e, [...customerVisits.filter((v) => v.id !== draft.id), draft], e.id)
```

跟 `entitlementWarnings()` 用**同一份輸入**，兩個地方講的數字才會一樣。

那個 `withThis` 的組法搬進 `domain/entitlements.js` 成一支
`countsWithDraft(entitlement, customerVisits, draft)` —— 兩個呼叫端
（驗證與畫面）走同一支，各組一次的話遲早有一邊忘了濾掉自己。

## 壓表那一頁也要

`ui/views/schedule.js` 的額度丸子（`paintRecord()` 那一帶）同樣的問題。
**兩個入口共用同一支**。

## 邊界：不要擋

**顯示成 `剩 0` 甚至負的，但不擋。** ADR-0074 之後整個 app 沒有硬性阻擋了，
而且「今天先做了、之後再補加購」是真的會發生的事。提醒那一句已經有了。

## 測試

- 草稿裡兩段同一筆「剩 1」的額度 → 第二顆丸子寫「剩 0」
- 改一筆既有來訪時**不會把自己算兩次**（`v.id !== draft.id` 那道）
- 換掉其中一段的額度 → 兩邊的數字同時跟上
- 壓表與來訪編輯器算出來的數字一樣（同一支）
