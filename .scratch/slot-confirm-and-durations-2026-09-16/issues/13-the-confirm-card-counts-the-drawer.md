# 確認抽屜按下去之後，那張卡片與 toast 還在算整天

Status: done
Blocked by: 01, 03, 04
來源：2026-09-16 審查時查到（Spec 軸與人工複查各自重現）。不是她報的，但就落在交給她的手動驗收清單上
動工前先讀：`ui/views/home.js` 的 `applyConfirm()`／`showConfirmed()`、
`domain/visits.js` 的 `describeConfirmed()`、`domain/consequences.js` 的 `confirmConsequences()`、
`docs/adr/0070`（後果說明只能講真的會發生的事）

## 現在壞在哪

issue 03 讓抽屜只列還沒問過的那幾段，但按下去之後那三句話還在讀**整筆**：

一天兩段（上午 A 類、下午 C 類），她在日曆上先確認掉上午那一段（issue 01）——
那一刻上午那一段的 Examine／耀聖就長了（issue 04）。接著到待辦中心：

| 她做的 | 按鈕寫 | 按下去之後（修之前） |
|---|---|---|
| 確認下午那一段 | 確認 1 段 | 卡片「已確認 **2** 段」、列著上午那一段、「待辦會多一張 Examine、一張耀聖」（**一張都不會多**） |
| 把下午那一段退掉 | 退掉這 1 段 | toast「**確認了**，已排進日曆」、卡片「已確認 1 段」列的是上午那一段 |

後一種的 toast 問的是 `writes.some((v) => v.status === 'cancelled')` —— 上午那一段
談定了，整筆停在「已確認」，所以永遠答「確認了」。

## 做了什麼

- `describeConfirmed()` 只算 `slotStatus() === 'pending_confirm'` 的那幾段 —— 跟抽屜是同一份
- `confirmConsequences()` 收**寫入之前**的那幾筆與 `rejected`。「會多哪幾張」走真的那道閘門：
  `applyConfirmation()` 寫進去之後 `confirmedKinds()` 長得出來、寫進去之前還長不出來的那幾種。
  `confirmedKinds()` 因此從 `taskRules.js` 匯出
- toast 問「有沒有哪一天在抽屜上的每一段都被退掉」，不問整筆的狀態

## 判準

- 上面兩種情境：卡片寫「1 段」、不提 Examine；退掉那一種 toast 講「退掉」、不畫「已確認」那張卡
  （`tests-e2e/specs/34` 的 C6、C7，**兩支在修之前的程式上都紅過**）
- 兩段都還沒問過時：行為跟 2026-09-16 一模一樣（既有的 `describeConfirmed` 與
  `confirmConsequences` 測試全綠）
- 這一行會不會讓她以為一張已經長出來的待辦還沒長、或一張不會長的會長？
