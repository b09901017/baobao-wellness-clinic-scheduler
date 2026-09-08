# 選 ILIB 沒變成選診間：根因是器材身上沒有 courseId

Status: done
來源：使用者，2026-09-08（需求 4）
動工前先讀：`docs/adr/0075`、`docs/adr/0079`、`data/config.js` 的 `loadSeed()`

## 先講結論：**程式是對的，壞的是她庫上的資料**

她說：

> 我選 IN/SIS/高能量雷射並沒有讓我選治療師，然後好像又可選，但是就固定成
> 只能選治療師，我點 ILIB 的時候也沒有變成選診間？
> 這就是我之前說的，改了壓表但是忘記紀錄來訪還可以從月曆這邊

**但兩個入口早就共用同一支了**（2026-09-08 那一輪做的，ADR-0079）：

| 入口 | 走哪一支 |
|---|---|
| 壓表 `schedule.js:1210, 1910` | `assignsFor()` |
| 來訪編輯器（日曆抽屜也是它）`visitEditor.js:334, 658` | `assignsFor()` |

而且有一支測試盯著「沒有一個畫面自己去比 `course.assigns`」。

## 真正的原因

`assignsFor()` 的答案來自課程，而擇一池的課程是**器材身上的 `courseId`**
推出來的（`courseForEquipment()`）。那個欄位是 **2026-09-06 才加的**
（commit `330dc07`）。

`loadSeed()` 只建不覆蓋 —— `existingIds.has(row.id)` 就整筆跳過，**連欄位都不合併**。
所以她庫上那四台器材身上**沒有 `courseId`**，於是：

1. `courseForEquipment('eq-ilib', ...)` 推不出來 → 維持原來的課程（復能）
2. `coursesForEntitlement()` 一台都推不出課程 → 退回舊行為 → 只有復能
3. 四選一那一池永遠只有復能一個課程 → `assigns` 永遠是 `therapist`

**「固定成只能選治療師、點 ILIB 也不變」一字不差就是這個症狀。**

## 為什麼現有的資料健檢抓不到

- `seedEquipment`（器材主檔少了一台）只在那一列**整個不存在**時才報。
  她的 `eq-ilib` 存在（2026-09-06 之後建的），只是 `eq-sis` 那幾台缺欄位
- `equipmentNames` 只看名字兩格

**沒有任何一列在看 `courseId`。**

## 要做的事

`domain/health.js` 新增一列：

```
id     equipmentCourse
label  器材沒有指到課程
hint   「用這台的那一段算哪一個課程」沒填的話，四選一選到 ILIB 也不會變成
       選診間 —— 畫面上跟做對了長得一模一樣
fix    kind: 'setEquipmentCourse' —— 照種子填回去
```

**只在那一格是空的時候報**（同 `checkSeedDurations()` 那條）：
她自己指到別的課程是一個決定，不可以被一顆按鈕改回去。

**那個課程要真的存在**才報（同 `checkSeedEquipment()` 那道護欄）——
自己從零建主檔、一個種子 id 都沒有的資料庫不會被念一整排。

## 順手：程式那一側的一個小洞

`coursesForEntitlement()` 的退路是「一台都推不出課程就回所有
`requiresEquipment` 的課程」。那條退路在**部分**器材有 `courseId` 時不會觸發，
於是一池裡有的推得出、有的推不出時，推不出的那幾台會**默默算成第一個課程**。

不改行為（那條退路是 ADR-0075 刻意的），但要**加一則註解**講清楚這個邊界，
並在資料健檢那一列的 hint 裡提一句。

## 測試

- 健檢：器材沒有 `courseId` → 報；填了別的課程 → 不報；課程不存在 → 不報
- `assignsFor()` 既有那幾條回歸（已經有了，跑一次）
- E2E：日曆抽屜新增來訪 → 選四選一 → 選 SIS → 出現治療師那一排；
  改選 ILIB → 換成診間那一排。**這一支是她回報的那條路，一定要有**
