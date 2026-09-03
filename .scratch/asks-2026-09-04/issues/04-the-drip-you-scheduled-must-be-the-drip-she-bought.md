# 排來訪時，營養點滴的品項可以選到她沒買的那一款

Status: proposed
來源：她實測回報第四項，2026-09-04（`../spec.md`）
動工前先讀：ADR-0004（次數的算法只有一份）、`domain/visits.js` 的
`validateVisit()` 裡「擇一池」那一段、`ui/components/buy.js` 的 `ivRow()`

## 她看到的

> 我營養點滴如果一開始加購的是 A，但是我排來訪的時候，選營養點滴還能排到
> 其他 BCD？這不太對吧。

不太對。**而且它不只是選單畫錯，是資料真的存得進去。**

## 現在的樣子

購買的時候品項就定下來了，存在額度身上：

```js
// ui/components/buy.js
ivProductId: e.type === 'single' ? (e.ivProductId ?? null) : null,
```

額度的顯示名稱也已經帶著它（`itemisedLabel(course.name, product.name)`），
所以壓表那一頁的額度丸子上寫的就是「營養點滴・A」。

但兩個排班入口都是把**主檔裡全部的品項**列出來：

```js
// ui/views/schedule.js
${all.ivProducts.filter((p) => p.active !== false).map(...)}

// ui/views/visitEditor.js
options: all.ivProducts.map((p) => ({ value: p.id, label: p.name })),
```

而 `domain/visits.js` 只擋「這個品項存不存在」：

```js
if (slot.ivProductId && !ivById[slot.ivProductId]) {
  errors.push(`${at}：指定的品項不存在或已刪除`);
}
```

於是她選了「營養點滴・A」這筆額度、品項卻點成 B，**存得下去**，
次數扣在 A 的額度上、紀錄寫著 B。試算表報表印的是 B，
額度剩幾次算的是 A —— 兩邊從那一刻起對不起來。

## 隔壁已經有正確答案了

同一支檔案處理「擇一池」的方式就是對的：

```js
// 擇一池的次數是共用的，選了池外的器材就會扣到不屬於它的東西上
if (ent?.type === 'pool' && slot.equipmentId
    && !(ent.optionEquipmentIds ?? []).includes(slot.equipmentId)) {
  errors.push(`${at}：這個器材不在「${ent.label}」的擇一池裡`);
}
```

而畫面那一層也照做（`visitEditor.js` 的 `equipmentField()` 只列池子裡的器材）。
**點滴的品項只是漏了同一道。**

## 決定（2026-09-04 她選的：預設 A，要改得先展開）

問她的時候給了三條路：硬擋、預設加展開、只出警告。她選中間那一條，理由跟
ADR-0002 是同一句話 —— **app 記錄她的決定，不替她做決定**。而「今天 A 剛好
用完，先打了 B」是診所真的會發生的事，硬擋等於那一筆永遠記不進系統。

醫療禁忌是全站唯一的硬性阻擋（`domain/contraindications.js` 的檔頭），
這一條不會變成第二個。

### 一、打開就是 A，其他款收在「換一款」後面

- `ui/views/schedule.js` 的 `ivField()`
- `ui/views/visitEditor.js` 的那一排丸子

兩個入口共用同一支：額度身上有 `ivProductId` 就**只畫那一顆、而且已經選好**，
旁邊一顆「換一款」；按下去才長出其餘的品項。收合用
`grid-template-rows: 0fr → 1fr`（跟待辦抽屜同一招），不換頁不重畫整排。

**額度上沒有 ivProductId 的照舊全部列出來** —— 舊資料與匯入進來的來訪都沒有
這個欄位，藏起來等於她連選都選不到。**n返 與沒有額度的時段**也照舊
（`entitlementId` 是 null 就沒有額度可以比）。

### 二、真的換了，那一段要講出來

換成別款之後，那一段旁邊留一句「跟買的不一樣（買的是 A）」。
**是說明不是錯誤**：不擋存檔、不變紅字。她要的是「我知道我在做什麼」，
不是被罵。

`domain/visits.js` 的 `assignmentWarnings()` 已經有這一族的先例
（醫師沒選是 warning 不是 error），這一條放進去。

### 三、只有一個選項就自動選好

`requiresIvProduct` 的課程不選品項存不下去（那條驗證本來就在）。既然預設就是
她買的那一款，讓她多點一下沒有任何意義 —— 打開編輯器就已經選好。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `domain/visits.js` | `assignmentWarnings()` 多一句。**規則只在這裡** |
| `ui/views/schedule.js`、`ui/views/visitEditor.js` | 兩個入口的丸子 + 自動選好 |
| `domain/health.js` | 資料健檢要不要抓既有的錯配？**要** —— 已經存進去的錯配不會自己好，而她看不到 |
| `tests/visits.test.js` | 新提醒的四種情況 |
| `tests-e2e/specs/01-products.spec.js` | 買 A → 壓表只有 A 一顆、而且已經選好 |

### 資料健檢那一列

`domain/health.js` 已經有 `refState()` 在檢查「指到的品項還在不在」。
再加一種：**指到的品項不是那筆額度買的那一款**。分類跟「資料過期」那一族
放在一起，一列講清楚是哪一天、哪一筆、買的是哪一款、排成了哪一款 ——
**不自動改**（同重複可用性那一條的判斷，ADR-0053）。改的時候她要知道
Abovee 上那一筆也要跟著改，那不是 app 做得到的事。

## 驗收

- 單元：額度 A + 時段 B → 一則**提醒**（不是錯誤），話裡有額度的名字與買的那一款
- 單元：額度 A + 時段 A → 什麼都不講
- 單元：額度沒有 ivProductId → 什麼都不講
- 單元：n返（`entitlementId: null`）→ 什麼都不講
- E2E：買一筆「營養點滴・A」→ 壓表那一頁預設就是 A，其餘要按「換一款」才看得到
- E2E：換成 B → 存得下去，那一段旁邊寫著「跟買的不一樣」
- E2E：資料健檢列得出既有的錯配
