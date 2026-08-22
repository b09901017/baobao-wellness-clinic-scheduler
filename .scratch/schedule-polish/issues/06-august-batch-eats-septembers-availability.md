# 壓八月的表，卻吃到九月那一份可用性

Status: done
回報者：使用者，2026-08-22

## 症狀

> 是不是我填了不方便的時間，就算我是填 9 月不方便的時間，我壓 8 月的表
> 他也會出現限制阿？為什麼不是我壓那個月，他只呈現我那個月問的，
> 如果那個月還沒問就不顯示阿

## 根因

`domain/scheduling.js` 的 `rowFor()` 用 `currentCollection(availability, today)`
拿可用性 —— 「今天還算數的那一份」。而 `currentCollection()` 不排除
還沒生效的那一份（`collectionState()` 的 `upcoming`），所以八月底壓八月的表時
拿到的是剛收到的九月那一份。

接著可用日算在「收集的有效期」與「這個月」的交集上：

```
九月那一份 2026-09-01 – 2026-09-30
壓的月份   2026-08-01 – 2026-08-31
交集       空的  →  可用 0 天
```

而排序第一項是「可用天數越少越優先」，**0 天等於滿分**。
於是一位其實只是「八月還沒問」的客戶，帶著假的「可用 0 天」排到第一位。

比較小但更常發生的另一半：九月那一份的「每個禮拜一不行」會被拿去劃掉
八月的每個禮拜一，她照著避開，客戶其實可以。

## 做了什麼

- `domain/availability.js` 新增 `collectionFor(collections, from, to)`：
  涵蓋這段期間的那一份（有交集就算，交集最多的優先，一樣多才比收集日期）
- `rowFor()` 與 `candidatesFor()`（時段反查，期間就是空出來的那一天）改用它
- 沒有涵蓋到那段期間 = `needsAvailability`，畫面上是黃色的「還沒問 8 月的時間」，
  不是紅色的「可用 0 天」
- `currentCollection()` **維持原樣**：待辦中心的「問這輪的時間」（ADR-0028）
  與資料健檢問的是真的「現在」

決定與理由：[ADR-0036](../../../docs/adr/0036-availability-is-picked-by-the-month-being-scheduled.md)

## 驗收

`tests/scheduling.test.js` 的「可用性要挑壓的那個月的那一份」四條、
`tests/availability.test.js` 的「涵蓋某一段期間的那一份」六條、
`tests/backfill.test.js` 一條。全部 `npm test` 綠。
