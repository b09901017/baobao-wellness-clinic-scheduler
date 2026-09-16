# 主檔跟不上種子：既有資料庫不會拿到 EECP 體驗課與新的時長

Status: todo
Blocked by: 06, 07
來源：`../spec.md`
動工前先讀：`data/config.js` 的 `loadSeed()`、`domain/health.js` 的
`checkSeedEquipment()`／`checkCourseRecord()`／`checkCourseAssigns()`（照抄那個形狀）

## 為什麼要做

`loadSeed()` **只建不覆蓋**（`existingIds.has(row.id)` 就跳過）。所以 06、07
改完之後，staging 與正式上既有的主檔：

| 改了什麼 | 既有資料庫會怎樣 |
|---|---|
| 新增 `course-eecp-trial` | **再跑一次「載入預設資料」就會建起來**（id 是新的）✅ |
| `course-eecp` 30 → 60 | **不會變**，她的還是 30 ❌ |
| `course-iv-drip` 60 → 120 | **不會變**，她的還是 60 ❌ |
| `iv-heart` 加 `durationMin: 180` | **不會變**，那一格還是空的 ❌ |

三個 ❌ 的症狀都一樣：**改好了、上線了、畫面上看起來什麼都沒發生**，
而她要到某天排了一段點滴、發現只佔一小時才知道。

這個 repo 已經有三支同樣形狀的檢查（器材少一台、課程沒勾寫紀錄、課程的指派
跟建議的不一樣），所以答案照抄它們，不要另發明一種。

## 要做什麼

`domain/health.js` 加兩列（`CHECKS`、`RUNNERS`、`ui/views/health.js` 的
`FIX_COPY` 三個地方都要有，檔頭那段規矩寫著）：

1. **「課程的時長跟建議的不一樣」** —— 比 `SEED.courses` 的 `durationMin` 與她的。
   `fix` 一顆按鈕改成建議值。`link: '#/settings/courses'`（issue 05 之後只剩
   `#/settings/*` 的 link 留得下來）
2. **「點滴品項的時長跟建議的不一樣」** —— 比 `SEED.ivProducts` 的 `durationMin`。
   **只在她那一格是空的時候報**（照 `checkSeedDurations()` 那條：她自己填了
   180 以外的值是一個決定，不可以被一顆按鈕改回去）。`link: '#/settings/ivProducts'`

⚠️ 第 1 列**不能**照第 2 列那樣「只在空的時候報」—— `durationMin` 是必填的，
沒有空的狀態。所以它比的是值，而她真的可能自己改過。**`detail` 要把兩個數字
都印出來**（「現在是 30 分，建議 60 分」），讓她自己決定按不按。

## 判準

- 一個 `course-eecp` 還是 30 分的資料庫：健檢列得出來，按下去變 60
- 一個 `iv-heart` 已經填了 240 的資料庫：**不報**（她自己的決定）
- 一個 `iv-heart` 那一格空的資料庫：報，按下去變 180
- 按過一次之後再跑一次健檢：那一列消失
- 每一個新的 check id 在 `RUNNERS` 與 `FIX_COPY` 都有一列（`tests/health.test.js` 盯著）
- 這一行會不會讓她自己填的一個時長被一顆按鈕改掉？
