# 復健科門診也要寫紀錄

Status: todo
來源：使用者，2026-09-08（需求 7）
動工前先讀：`docs/adr/0066`、`docs/課程與待辦對照表.md`

## 她要的

> 除了二返、營養諮詢之外，復健科門診也要事後寫記錄，
> 幫我預設這三個都要寫紀錄

## 現在

`domain/seed.js`：

| 課程 | `needsRecord` |
|---|---|
| 二返 `course-followup` | `true` ✓ |
| 營養師諮詢 `course-nutrition-consult` | `true` ✓ |
| **復健科醫師門診 `course-rehab`** | **沒有這個欄位（＝不用）** |

## 要做的事

### 一、種子

`course-rehab` 補上 `needsRecord: true`。

### 二、資料健檢（她庫上那一筆不會自己跟上）

`loadSeed()` 只建不覆蓋。所以要一列，形狀照抄 `checkCourseAssigns()`：

```
id     courseRecord
label  課程的「做完要不要寫紀錄」跟建議的不一樣
hint   復健科醫師門診做完要去曜聖補一份紀錄 ——
       沒勾的話那一場結案時不會長出「寫紀錄」，而畫面上看不出少了什麼
fix    kind: 'setNeedsRecord'
```

**只在那一格是空的（或明確 `false`）而且還停在舊種子那一代時才報**。
她自己勾掉是一個決定 —— 但這裡有一個判斷不了的邊界：
`undefined`（從來沒設過）與 `false`（她關掉了）在資料上分得出來，
**所以只認 `undefined`**，`false` 一律不報。

### 三、`docs/課程與待辦對照表.md` 要跟著改

CLAUDE.md 寫著：改了 `taskRules.js` 或 `followups.js` 的規則要回去改它，
而確認框上每一句話都是照那張表寫的。這一輪改的是課程主檔不是規則，
但那張表列的是「哪一種課程長出哪些待辦」—— 一樣要改。

## 為什麼不寫死課程名字

`domain/followups.js` 的檔頭寫過這個 repo 為字串比對付過的帳。
`needsRecord` 是課程主檔上一個勾，`recordTasksForVisit()` 讀它 —— 不用改程式。

## 測試

- 復健科門診那一場結案 → 長出一張「寫紀錄」，死線是**來訪那一天**（ADR-0066）
- 健檢認得出還沒勾的那一筆；她自己設成 `false` 的**不報**
- `docs/課程與待辦對照表.md` 與 `taskRules` 對得上（若有既有的比對測試）
