# 四選一預設彈出「診間」：根因是器材主檔的排序

Status: done
來源：使用者，2026-09-08（需求 2 前半）
動工前先讀：`docs/adr/0075`、`domain/visits.js` 的 `coursesForEntitlement()`

## 原話

> 在新增來訪壓表選「三選一」或「四選一」時，無論使用者細選哪一種器材，
> 系統均只強制彈出「診間/治療室」選項，未切換為指派治療師。

## 根因：擇一池的**預設**課程是「器材清單的第一台」，而那是 ILIB

```js
// domain/visits.js  coursesForEntitlement()
const ids = entitlement.optionEquipmentIds ?? [];   // ← 順序決定一切
for (const id of ids) { ... out.push(course); }
```

```js
// ui/views/schedule.js  courseOptions()
const course = coursesForEntitlement(ent, ...)[0] ?? null;   // ← 取第一個當預設
```

而「四選一」那一池的器材順序來自 `ui/components/buy.js` 的
`allIds = equipment.map((x) => x.id)`，也就是**主檔讀回來的順序**。
`data/repo.js` 的 `list()` 沒有 `orderBy`，所以 Firestore 回的是**文件 id 升冪**：

```
eq-ilib  ←  第一台
eq-indiba
eq-laser
eq-sis
```

於是「四選一」的預設課程是 **ILIB**（`assigns: 'room'`）→ 一按下那顆額度丸子，
畫面上出現的是**診間**那一排。她還沒選器材，畫面就已經替她答了一個錯的。

三選一那一池只有復能自己那三台，預設課程是復能（`assigns: 'therapist'`），
所以那一顆**現在是對的** —— 這一支要一併確認她看到的三選一是哪一種資料
（見底下「要跟她確認的一件事」）。

## 同一個地方藏著的第二個洞：池選了、器材沒選，存得下去

```js
// domain/visits.js  visitErrors()
if (!imported && course?.requiresEquipment && !slot.equipmentId) { ... }
```

問的是**課程**。但 `picksEquipment()` 說的是「**擇一池一律要記器材**，
不管推出來的課程是哪一個」。四選一預設成 ILIB（`requiresEquipment: false`）之後，
這一行就放行了 —— 一段扣著四選一、卻沒有器材的來訪存得進資料庫。

那一筆之後：月檢視印不出是哪一台、試算表的「這一天用了哪一台」是空的、
額度的池成員檢查沒有 id 可以比。

## 要改的三處

### 一、`coursesForEntitlement()`：**復能那個課程排第一**

擇一池的「家」是那個 `requiresEquipment` 的課程（`buy.js` 的 `poolCourseOf()`
問的是同一件事）。推出來的課程裡有它就把它排到最前面 —— 預設不再看
主檔的讀取順序。

> 為什麼不是「沒選器材就不給預設」：時段一定要記一個 `courseId`，
> 而沒有課程的時段存不下去（`courseForEquipment()` 的檔頭寫著同一句）。

### 二、`visitErrors()`：改問 `picksEquipment()`

```diff
- if (!imported && course?.requiresEquipment && !slot.equipmentId) {
+ if (!imported && picksEquipment(ent, course) && !slot.equipmentId) {
```

錯誤訊息要講得出是哪一池：「`復能-四選一(60)` 每次都要記錄用了哪一種器材」。

### 三、壓表：**沒選器材時不要畫治療師／診間那一排**

四選一在她挑器材之前，那一段到底要治療師還是治療室是**還沒有答案**的。
現在畫一排出來等於替她答了。改成：擇一池而且還沒選器材時，
那兩排都不畫，位置上留一句「先選上面那一台，才知道要排治療師還是治療室」。

—— `ui/views/schedule.js` 的 `entFields()` 與 `ui/views/visitEditor.js` 的
`slotCard()` **兩個入口都要**，而判斷只能有一份（放進 `domain/visits.js`，
跟 `picksEquipment()` 住在一起）。

## 要跟她確認的一件事

三選一在**現在的程式**上會正確畫出治療師。她說三選一也彈診間，兩種可能：

1. 她講的是同一件事的印象（實際只有四選一錯）
2. 她資料庫裡的器材身上沒有 `courseId`（ADR-0077 第六點講的那種舊資料）

第 2 種的症狀是：加購那一排**根本不會有「三選一」那顆丸子**（`poolChoices()`
在沒有一台器材帶 `courseId` 時只組得出一顆）。所以請她看一眼加購那一排
有沒有「三選一」與「四選一」兩顆 —— 有的話就是第 1 種。

## 測試

- `tests/visits.test.js`
  - 四選一的池 → `coursesForEntitlement()[0]` 是復能，不是 ILIB
  - 器材順序倒過來（ILIB 排最後）答案一樣
  - 一台都沒帶 `courseId` 的舊資料 → 退回舊行為（ADR-0075 的相容性）
  - 擇一池沒選器材 → `validateVisit()` 出 error，訊息帶著額度名字
  - 單買一台 ILIB 的 `single` 額度 → 仍然是診間（不受影響）
- `tests-e2e/`：壓表選四選一 → 先看到器材那一排、沒有治療師也沒有診間；
  點 SIS → 治療師出現；點 ILIB → 診間出現、治療師消失、剛剛選的治療師被清掉
