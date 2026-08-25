# 用了但沒定義的 CSS class、沒有人用的索引

Status: done
來源：全庫掃描，2026-08-25（`../spec.md`）

## 一、JS 印出來、`app.css` 沒有定義的 class

| class | 在哪 | 現在會怎樣 |
|---|---|---|
| `.addmenu` | `views/calendar.js` 抽屜的「＋」 | 沒事 —— `.addmenu__list` 的絕對定位是靠 `.drawer__tools { position: relative }` 接住的。**那是巧合**：`.addmenu` 哪天被搬出 `.drawer__tools`，選單就會跑到別的地方去 |
| `.tight` | `views/mergeImport.js` 的六張清單 | 名字寫著「緊湊」，實際長成瀏覽器預設的項目符號清單 |
| `.timeline--week` | `views/calendar.js` 週檢視 | 一條規則都沒有，等於沒加這個修飾詞 |
| `.audit` | `views/health.js`、`views/audit.js` | 只是外框，`.audit__row` 有樣式，沒事 |
| `.choices` | `components/form.js` | 只是外框，`.choice` 有樣式，沒事 |
| `.msg-box` | `components/message.js` | 只是外框，`.msg` 有樣式，沒事 |
| `.form` | `views/calendar.js` 的待辦編輯器 | 只是外框，`.form__actions` 有樣式，沒事 |

要做的是二選一，不要放著：**補上樣式**（`.tight` 看起來本來就想做點什麼），
或**把那個 class 拿掉**（`.timeline--week`）。`.addmenu` 建議補一條
`position: relative`，讓它不再靠上層那一條巧合。

## 二、沒有任何查詢用得到的索引

`firestore.indexes.json` 有一支：

```json
{ "collectionGroup": "customers", "fields": [
  { "fieldPath": "deletedAt" }, { "fieldPath": "active" }, { "fieldPath": "name" }] }
```

而 `data/customers.js` 的 `list()` 只有 `where('deletedAt','==',null)`，
**排序刻意在 client 做**（Firestore 排的是 UTF-8 位元組序，中文姓名排出來
不是人看的順序 —— 那支的註解自己寫了）。`active` 也是在畫面上濾的。

`SPEC.md` 第 5.4 節還列著 `customers`: `active` + `name`。

不會壞，只是多一支要維護的索引。要嘛拿掉（含 SPEC 那一行），
要嘛在 SPEC 上寫清楚它留著是為了什麼。

## Comments

**2026-08-25 做掉了**（`.scratch/asks-2026-08-25/issues/12` 那一輪順手）：

- `.timeline--week` 拿掉 —— 它一條規則都沒有，等於沒加這個修飾詞
- `.tight` 補上樣式（縮排收窄、字級小一級、列距一格）
- `.addmenu` 補 `position: relative`，不再靠 `.drawer__tools` 那個巧合
- `customers` 那一支索引**留著**，`SPEC.md` 第 5.4 節寫清楚它是為了多帳號
  那一階段（到那時候客戶清單會大到不能整包拉回來）
- `.audit` / `.choices` / `.msg-box` / `.form` 維持原樣 —— 它們只是外框，
  底下的元素有樣式，拿掉反而讓 HTML 讀不出結構
