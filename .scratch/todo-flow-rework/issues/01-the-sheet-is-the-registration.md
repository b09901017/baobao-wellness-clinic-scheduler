# 壓表本身就是登記，所以 Abovee 與打電話不該是待辦

Status: done
來源：使用者，2026-08-23
動工前先讀：本資料夾的 `spec.md`、`SPEC.md` 第 4.1、5.5 節、
`CONTEXT.md` 的「壓表」、`docs/adr/0027`

## 原話

> 「壓表分兩種一個是健檢（只需要直接去 examine 登記）一個是除了健檢之外的
> （就是去 Abovee），**所以不會有單獨的 Abovee 這個 todo 類別**」
> 「不再需要打電話這個 todo 了」

## 現況

`domain/taskRules.js`：

```js
export const TASK_KINDS = ['打電話', 'Abovee', 'Examine', '耀聖'];
export const RULES = Object.freeze({
  A: ['打電話', 'Abovee', 'Examine', '耀聖'],
  B: ['打電話', 'Examine'],
  C: ['Abovee'],
});
```

客人一確認，C 類（復能、靜脈、EECP、營養點滴）就長出一張「Abovee」。
但那筆來訪能存在 app 裡的前提**就是她已經在 Abovee 上壓完了**（SPEC 第 4.1 節：
「來訪的起點是『已壓表・待客人確認』，因為使用者是先在 Abovee 壓完表才回 app 記錄」）。
所以那張待辦從出生的那一秒就已經做完了 —— 她要嘛勾一次不存在的工作，
要嘛讓它掛在那裡變紅字。

健檢的 Examine 同理：她壓健檢的方式就是直接去 Examine 登記。

## 要做什麼

### `domain/taskRules.js`

`RULES` 改成講兩件事，不是一串任務：

```js
export const RULES = Object.freeze({
  // 壓表登記在哪個系統 / 客人確認之後還要去哪幾個
  A: Object.freeze({ bookAt: 'Abovee',  onConfirm: Object.freeze(['Examine', '耀聖']) }),
  B: Object.freeze({ bookAt: 'Examine', onConfirm: Object.freeze([]) }),
  C: Object.freeze({ bookAt: 'Abovee',  onConfirm: Object.freeze([]) }),
});
```

- `TASK_KINDS` 變成 `['Examine', '耀聖']`。
- 沒有類別（`null`）的那四種（Inbody、體適能、兩種諮詢）：`bookAt: 'Abovee'`、
  `onConfirm: []` —— 她確認過，那幾種一樣要在 Abovee 佔格子。所以它現在跟 C 類
  **行為完全一樣**，差別只剩她在主檔上怎麼叫它。這件事要寫在註解裡，
  不要讓下一個人以為是漏改。
- 新增 `bookingSystemFor(category)`，回 `'Abovee'` / `'Examine'`。
  「壓表登記」那一列（`issues/02`）與取消任務都讀它，不要在兩個地方各判斷一次。
- `tasksForCategory()` 改讀 `onConfirm`。名字保留 —— 它回答的還是同一個問題。
- `REGISTRATION_KINDS` 維持 `['Abovee', 'Examine', '耀聖']`：它管的是
  「哪幾種已經勾掉的任務要回頭取消」，而歷史資料裡真的有勾掉的 Abovee 任務。

### 取消一律長出來

`syncTasksForVisit()` 的 `gone` 那一段，除了現有的「已完成的登記任務各長一張取消」，
再加上**壓表登記本身**：

- 這筆來訪裡出現過的每一個 `bookAt` 系統各長一張 `取消 {系統}`
- 一筆來訪同時有健檢與復能 → `取消 Examine` 與 `取消 Abovee` 兩張都長
- 已經有同名的未完成取消任務就不要長第二張

死線沿用現有的 `cancelTask()`：今天與來訪日前一天取早的。

### 設定頁的類別說明

`CATEGORY_OPTIONS` 的 label 與 hint 要改成講新的意思，不然設定頁會繼續寫
「A · 三系統＋電話」：

- `A · 門診` — 「Abovee 壓表，確認後還要 Examine、耀聖」（復健科、心臟科、二返）
- `B · 健檢` — 「直接在 Examine 壓，確認後沒有後續登記」
- `C · 療程` — 「Abovee 壓表，確認後沒有後續登記」（復能、靜脈、EECP、營養點滴）
- `不用掛號` — 「Abovee 壓表，確認後沒有後續登記。跟 C 一樣，差別只在你怎麼稱呼它」

`describeCategory()` 跟著改。

## 一起要檢查的

- `SPEC.md` 第 5.5 節那張矩陣（連同底下「C 類沒有打電話」那句提醒 ——
  現在整個「打電話」都沒有了）
- `SPEC.md` 第 8.1 節的分類表
- `domain/seed.js` 的課程不用改（類別 id 沒變）
- `domain/sheetReport.js` 的 TODO / FINISHED 兩塊讀的是任務的 `kind`，
  不列舉種類，應該不用改 —— 要確認
- `tests/tasks.test.js`
- 補一支 ADR：**Abovee 不是待辦，壓表本身就是登記**。它不推翻 ADR-0027
  （登記任務仍然等客人確認），推翻的是 SPEC 第 5.5 節那張矩陣

## 不做

- 不刪 Firestore 裡既有的「打電話」「Abovee」任務，見 `issues/06`
- 不改死線的算法（來訪日前一天，照舊）
- 不合併 C 與「不用掛號」兩個類別 —— 那要改既有課程文件的資料，
  而它們現在的行為一樣，沒有非改不可的理由

## 驗證

- `npm test`
- 新測試：C 類的來訪確認後**不長任何任務**；A 類確認後長 Examine ＋ 耀聖 兩張；
  B 類確認後不長任何任務
- 新測試：C 類的來訪取消 → 長出 `取消 Abovee`；B 類取消 → 長出 `取消 Examine`；
  一筆同時有兩類的 → 兩張都長
- 新測試：已經勾掉的 `Examine` 在取消時照舊長出 `取消 Examine`，而且不會長成兩張

## Comments

**2026-08-23 —— done。** 三件跟原本寫的不太一樣：

- **取消任務多了一道去重。** 原本沒寫：這一支每次存檔都跑，而取消類任務不受
  來訪現況管轄（`auto` 那一段濾掉它們），所以沒有去重的話，存兩次就是兩張
  「取消 Abovee」。已經勾掉的那些也算 —— 收回來過的東西不用再收一次。
- **`cancelTask()` 的簽章改成吃 `kind` 與 `note`**，不再吃一整個 task。
  兩個來源（壓表登記、勾掉的登記任務）產生的說明不一樣：一個是「回去把時段放掉」，
  一個是「回去把登記取消掉」。
- **`bookingSystemFor()` 對認不得的類別回 `Abovee`，而 `tasksForCategory()`
  對認不得的類別回空陣列。** 兩支刻意不一致：猜錯前者的代價是多一句她看得懂的
  提醒，猜錯後者的代價是一批假待辦，而她只會學會忽略它們。

`tests/merge-import.test.js` 那一條「未來的來訪會長出待辦」改了意思：靜脈是 C 類，
現在確認後一件都不長，所以另外加了一條門診的來驗 Examine 與耀聖照樣長得出來。
