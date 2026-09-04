# 要改一句給客人的話，得改程式

Status: done
來源：她的第一項（`../spec.md`）
動工前先讀：`public/js/domain/messages.js`、`ui/views/preferences.js`（設定子頁的樣板）

## 她要的

> 我需要一個地方可以一次修改所有回復的模板，可以放在設定那邊。

## 全站清冊：現在有幾則、在哪裡、帶哪些變數

全站產生「複製到 LINE 的字」的地方**只有這六則**，全部在
`domain/messages.js`，全部走 `ui/components/message.js` 的 `box()` 畫出來。
（`ui/views/report.js` 的複製鈕貼的是試算表，不是給客人的話，不算。）

| id | 現在的函式 | 觸發點 | 變數 |
|---|---|---|---|
| `ask` | `askAvailabilityMessage()`（沒連結那一支） | 待辦中心「問這輪的時間」、客戶詳情的 LINE 訊息 | `{name}` `{month}` |
| `askWithLink` | `askAvailabilityMessage()`（有連結那一支） | 同上，產生連結之後 | `{name}` `{month}` `{link}` |
| `received` | `availabilityReceivedMessage()` | 收件匣 `#/todo/inbox` | `{name}` `{month}` `{lines}` |
| `confirm` | `confirmMessage()` | 待辦中心「跟客人確認時間」、客戶詳情 | `{name}` `{month}` `{slots}` |
| `reminder` | `reminderMessage()` | 客戶詳情 | `{name}` `{when}` `{time}` `{courses}` |
| `offer` | `offerSlotMessage()` | 時段反查 `#/todo/backfill` | `{name}` `{date}` `{range}` `{course}` |

**這一輪不新增任何一則**（她 2026-09-04 回答：「都不要，先把現有六則改得動就好」）。

### 每一則的預設值就是現在程式碼裡那一句，一個字都不改

用字（含斷行與那個「呦～」）是她自己定的版本。`messages.js` 的註解已經寫了
「不要『順』它 —— 她跟客戶講話就是長這樣」，搬家的時候照抄。

## 為什麼不能只把字串拉成常數

因為六則裡有五則的變數是**有條件的**：

- `confirm` 的 `{slots}` 是「9/3 14:00、9/17 10:00」——
  來訪要先排序、只取每一筆的第一個時段（`firstStart()`：她問客戶的是
  「那天幾點來」，不是把三個療程的時刻表念一遍）
- `reminder` 的 `{when}` 是「明天 9/3」或「9/3」，看今天是不是前一天
- `reminder` 的 `{courses}` 沒有課程名時要**連那個「的」一起消失**
- `received` 的 `{lines}` 是好幾行，每行前面一顆「・」
- `offer` 的 `{range}` 沒有結束時間就只印開始時間

所以拆成兩層：**算變數**留在 `domain/messages.js`（那幾支條件判斷一個都不動），
**排字**交給模板。

## 三支新東西

### 1. `domain/messageTemplates.js`（純函式）

```js
export const TEMPLATES = [
  { id: 'ask', label: '問這一輪的時間', vars: ['name', 'month'], text: '…' },
  …
];
export function fill(text, vars)        // 把 {name} 換掉。認不得的佔位符原樣留著
export function textFor(id, stored)     // 她改過的優先，沒改過就給預設
export function validateTemplate(id, text)  // 只有一條規則，見下面
export function isCustom(id, stored)
export const MAX_TEMPLATE = 600;
```

**`fill()` 認不得的佔位符原樣留著，不換成空字串。** 她把 `{name}` 打成
`{Name}` 的時候，畫面上要看得到 `{Name}` 三個字 —— 換成空的話那句話少了
稱呼而她不會知道為什麼。

**驗證只有一條：不可以是空的。** 不擋「少了某個變數」——
她可能真的不想在提醒裡寫日期（她自己會補）。多擋一條她就存不下去，
而那正是上一輪 issue 02 的同一個坑。

### 2. `data/config.js` 加一個帶行程內快取的讀取

```js
export async function getTemplates()   // { ask: '…', … } 只有她改過的那幾則
export function forgetTemplates()      // 存檔後丟掉
```

存在 `config/app` 這份文件的 `messageTemplates` 欄位底下 —— 跟 `sortWeights`、
`sheetSync` 同一份，所以**自動有稽核紀錄、自動進備份、自動被還原腳本搬回來**，
`firestore.rules` 的 `match /config/{docId=**}` 也已經涵蓋，一行都不用改。

快取抄 `data/playbooks.js` 那一份的形狀（那一支的檔頭寫了為什麼）：
模板是**很少改、要在五個地方被讀到**的參考資料，每次都重讀等於在她的行動網路上
多打幾輪往返。

### 3. `#/settings/templates`（設定子頁）

抄 `ui/views/preferences.js` 的骨架：一張卡、`backlink` 回設定、
`toast.withSaveState()` 存、一顆「回復預設值」。差別是：

- 一則一格 `<textarea>`，上面印 label，底下印**這一則吃哪些變數**
  （一排可以點的丸子，點一下插進游標處 —— 跟 issue 04 的 emoji 列同一顆
  `insertAtCursor()`）
- 改過的那幾則在標題旁邊掛一顆「已改過」的小徽章，並且**逐則**有一顆
  「這一則回復預設」。整頁一顆「全部回復」放在最底下，走 `confirmAction()`
- **不做即時預覽。** 預覽要餵假資料，而假資料裡一定要有一個假名字 ——
  `tests/no-secrets.test.js` 盯著這種東西，而且一個看起來像真人的預覽
  會讓她以為那是某位客戶

設定頁首頁的「規則」那一區多一格 tile：
`tile('#/settings/templates', 'LINE 回覆模板', '六則，改過 N 則')`。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `domain/messages.js` | 六支函式各多一個 `templates` 參數（預設 `{}` → 用預設值）。**條件判斷一行都不動** |
| `ui/views/home.js` | `ctx.settings` 已經在讀了，多傳 `templates` 進兩個訊息框 |
| `ui/views/backfill.js` | 同上（它已經 `config.getSettings()`） |
| `ui/views/customerDetail.js` | 多讀一次模板（有快取，第二次之後不打網路） |
| `ui/views/formInbox.js` | 同上 |
| `ui/views/settings.js` | 多一格 tile |
| `ui/views.js` | `register('/settings/templates', …)` |
| `tests/messages.test.js` | 現有的全部要照樣綠（不傳模板＝預設值），再加一組「改過模板」的 |
| `tests/save-guards.test.js` | 新的存檔鈕要有 `key` |
| `SPEC.md`、`CONTEXT.md` | 「訊息草稿」那一條要說它現在可以改 |

**不用動的**：`firestore.rules`、`firestore.indexes.json`、`data/backup.js`、
`scripts/restore-backup.mjs`、`public/sw.js` 的 `SHELL`（沒有新檔案在 `public/` 的
根目錄，`js/` 底下的模組不在那份清單裡 —— 動工時要照 `tests/shell-cache.test.js` 再確認一次）。

## 驗收

- 單元：`fill()` —— 換掉、認不得的原樣留著、同一個佔位符出現兩次都要換
- 單元：`textFor()` —— 沒存過給預設、存過給她的、存了空字串**當作沒存過**
- 單元：六則的預設值產生的字，跟改動前 `messages.test.js` 的期望**一字不差**
- E2E：改一則 → 重新整理 → 待辦中心那一則跟著變（見 issue 09）
