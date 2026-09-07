# 情境智慧排序：那一課程最常排的幾間浮到最前面

Status: ready（等 04 落地）
來源：使用者，2026-09-08（需求 3 後半）

## 她要的

| 排這個 | 置頂顯示 |
|---|---|
| EECP | 治5、治8 |
| ILIB | `.10`、治2、治3 |
| 營養點滴 | `.2` 至 `.10`（整個點滴室） |

> 設定頁需支援治療室簡寫維護，並在課程設定中能自訂「常用/推薦治療室」，
> 但預設必須完全符合上述規則。

## 「置頂」不是「只有這幾間」

現在課程主檔上有兩個欄位在管這件事，**兩個都是限制**：

```js
allowedRoomTypes: ['點滴室']          // 這一類的都可以
allowedRoomIds: ['room-t5','room-t8'] // 非空時蓋過類型，只有這幾間
```

EECP 現在用的是 `allowedRoomIds` —— **它是硬限制**，治5、治8 以外一間都選不到。
她這一輪說的是「**優先置頂顯示**」，那是排序不是限制。

所以**新增第三個欄位**：

```js
preferredRoomIds: ['room-t5', 'room-t8']   // 排在最前面，其餘照樣選得到
```

三個欄位各自回答一個問題，不互相取代：

| 欄位 | 問題 |
|---|---|
| `allowedRoomTypes` | 這個課程能排在哪一類空間 |
| `allowedRoomIds` | 例外：只有這幾間（**硬限制**） |
| `preferredRoomIds` | 這幾間排最前面（**只是順序**） |

- EECP 的 `allowedRoomIds` 要不要改成 `preferredRoomIds`？
  SPEC 第 7 節規則 2 寫的是「**EECP 只能在 治5、治8**」，那是限制。
  **建議兩個都填**：限制留著（規則沒變），順序那一格也填上 —— 她之後在設定裡
  把限制放寬時，順序還在。

## 排序只寫在一支

`domain/masterData.js` 加一支 `roomsForCourse()` 的兄弟：

```js
/** 這個課程的診間，推薦的排前面。哪幾間是推薦的只寫在這裡。 */
export function orderedRoomsForCourse(course, rooms) { ... }
```

**壓表（`roomField()`）與來訪編輯器（`roomField()`）兩個入口共用**。
各排一次的話，同一個課程在兩個畫面上第一顆丸子不一樣 —— 她不會知道哪個算數。

## 預設值（種子資料）

```js
course-eecp      preferredRoomIds: [治5, 治8]
course-iv-laser  preferredRoomIds: [點滴10, 治2, 治3]      ← ILIB
course-iv-drip   preferredRoomIds: [點滴2…點滴10 全部]      ← 或改成靠 allowedRoomTypes 就夠
```

營養點滴那一列要想一下：它的 `allowedRoomTypes` 已經是 `['點滴室']`，
**全部都是推薦等於沒有推薦**。建議營養點滴不填 `preferredRoomIds`，
靠既有的類型限制就是她要的效果（點滴室以外的本來就不出現）。
—— 這一條要跟她確認一句話就好。

## 設定頁

課程那一頁多一排「常用診間」：從這個課程**選得到的那幾間**裡複選。
選得到的範圍由 `roomsForCourse()` 算 —— 選一間它排不進去的診間當推薦，
那一顆會永遠排在最前面而且永遠選不到。

## 測試

- `tests/master-data.test.js`
  - 推薦的排最前面，順序照 `preferredRoomIds` 寫的
  - 沒填推薦 → 順序跟 `roomsForCourse()` 一模一樣
  - 推薦裡有一間不在允許範圍內 → 不出現（也不當成允許）
  - 推薦裡有一間停用了 → 不出現
- `tests-e2e/17-settings-fields.spec.js`：課程設定那一排存得下去、讀得回來
