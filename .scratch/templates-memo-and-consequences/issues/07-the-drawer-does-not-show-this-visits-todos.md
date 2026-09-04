# 點開一筆來訪，看不到這一場的行政進度

Status: todo
來源：她的第三項第 3 點（`../spec.md`）
動工前先讀：issue 06 的表一、ADR-0018（讀取卡片是共用的）、ADR-0020

## 她要的

> 點開日曆抽屜查看某一筆預約的詳情時，直接在詳情區塊列出「該預約所屬的所有
> 待辦項目及其執行狀態」，讓管理師不需要跳轉至待辦中心。

**只給看，不給勾**（她 2026-09-04 選的）。

## 要列哪幾列

一筆來訪身上的「待辦」有兩種來源，兩種都要列，不然那張表在說謊：

| 來源 | 哪幾種 | 怎麼問 |
|---|---|---|
| `tasks` 集合 | Examine、耀聖、寫紀錄、追蹤健檢報告、約二返、寄報告給醫師、取消 X | `data/tasks.js` 的 `listByVisit(visitId)` |
| 從來訪**推導**的 | 跟客人確認時間、簽療程單 | `domain/confirmations.js`、`domain/visits.js` 的 `visitsToClose()` |

漏掉推導的那兩種是最容易犯的錯：她每天做最多次的就是那兩件，而它們**不在
`tasks` 集合裡**（CONTEXT.md 的「待辦」條目就是在講這件事）。

## 長什麼樣

```
客戶A
9/1(一)・已確認
─────────────────────────
14:00  健檢          A診 3床
15:00  營養點滴      B診 1床
─────────────────────────
這一場的待辦
  ✓ 跟客人確認時間
  ✓ Examine
  ○ 簽療程單          今天
  ○ 追蹤健檢報告      9/22
─────────────────────────
🐻 營養點滴（備忘錄的前幾行）
```

- **`✓` / `○` 兩個記號，不用勾選框。** 一放勾選框她就會去點它，而點不動的
  勾選框是這個畫面上最糟的東西。同一個判斷 `tests-e2e/specs/15-playbook.spec.js`
  已經替備忘錄做過一次
- 未完成的右邊印**死線**，逾期用 `.overdue`（`urgency()` 已經有這一組）
- 已完成的整列 dim，記號用 `--ok`
- 一張都沒有的時候**整塊不畫**（`playbookHint` 已經是這個規矩：一個永遠空的
  區塊會讓她以為那裡壞了）
- 順序照 `domain/todoFlow.js` 的 `orderOf()` —— 那個順序就是她做事的順序，
  不要照死線排（`todoFlow.js` 的註解寫過：照死線排會把鏈條的第二站排到
  第一站前面）

## 放在哪一層：**不是 `visitReadHtml()`**

`visitReadHtml()` 是**四個畫面共用**的（日曆、客戶詳情、待辦中心、進度追蹤，
ADR-0018、0056）。動它就等於在另外三頁也長出這一塊，而那三頁問的問題不一樣：

- 客戶詳情已經有一整區任務（含切換「未完成／已完成」）
- 待辦中心本身就是那份清單
- 進度追蹤問的是「這個月做了多少」

所以照著備忘錄那一塊的做法：**接在後面，只在日曆上**。

```js
// calendar.js 的 openDetail()
body: visitReadHtml(visit, data)
  + taskMirrorHtml({ tasks, visit, coursesById, today })   // 新的
  + hintHtml({ playbooks: data.playbooks ?? [], visit }),
```

`ui/components/taskMirror.js`（新）。純畫面，判斷全部從 domain 拿。

## 資料怎麼來：**點開才讀**

日曆一次畫三個月，那幾百筆來訪的任務全部先讀是白費的（`loadGivableBags()`
已經是「點開才讀，而且只讀一次」的規矩）。

`openDetail()` 是同步的，所以分兩步：先把卡片畫出來（**不要為了這一塊讓她多等**），
`listByVisit()` 回來之後再把那一塊塞進去。讀失敗就不畫 —— 它是輔助資訊，
不是這張卡片的主體（`playbooks.list().catch(() => [])` 同一個判斷）。

過場：那一塊淡入（`--motion-fast` + `--ease-out`），不要「啪」一下把底下的
備忘錄推下去。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `ui/components/taskMirror.js` | 新的 |
| `ui/views/calendar.js` | `openDetail()` 接上去 |
| `public/css/app.css` | `.taskmirror`（沿用 `.tasklist` 已經有的樣式，**不加新 token**） |
| `domain/todoFlow.js` | 不改，只是被用到 |
| `tests-e2e/specs/11-todo-drawer.spec.js` 或新的一支 | 見 issue 09 |

`visitReadHtml()` **一個字都不改**。

## 驗收

- E2E：健檢那一筆點開 → 看得到「追蹤健檢報告」與它的死線
- E2E：`pending_confirm` 那一筆 → 看得到「跟客人確認時間」而且是 `○`
- E2E：那一塊裡**一個 `<input type=checkbox>` 都沒有**
- E2E：一筆什麼待辦都沒有的來訪 → **整塊不出現**（不是出現一個空框）
