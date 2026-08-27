# 二返沒有連到它那一次健檢

Status: 待動工
回報者：使用者，2026-08-27（「二返應該要和他的健檢連結在一起，就是我要知道這個二反是哪個健檢的」）
動工前先讀：`docs/adr/0022-followup-entitlements-are-expanded-in-pairs.md`、
`docs/adr/0042-the-report-comes-before-the-follow-up.md`、`domain/followups.js` 檔頭

## 現在連到哪裡為止

連結只做到**額度**這一層：

```
健檢額度  ←── followupForEntitlementId ──  二返額度
```

`pairsOf()` 靠它一對一配對，兩筆健檢也配得對（不比課程名字，見 `followups.js` 檔頭）。

再往下就斷了。**一筆二返「來訪」不知道自己是哪一次健檢的。**
`visit.slots[]` 上只有 `entitlementId`，而一筆二返額度買了 3 次就會有 3 次二返來訪、
對應 3 次健檢來訪 —— 誰對誰沒有任何欄位記著。

現在有兩個地方在**用猜的**補這一段：

1. `domain/sheetReport.js` 的 `followupNotes()`：把健檢的日期排序、二返的日期排序，
   **照位置配**（`booked[i]`）。第一次健檢配第一次二返。順序一亂就配錯，
   而且錯了畫面上看不出來。
2. `domain/followups.js` 的 `syncFollowupTasks()`：待辦掛在健檢那一筆來訪上
   （`task.visitId`），靠 `owed()` 數「做完幾次健檢 vs 約掉幾次二返」。
   它答得出「還欠幾次」，答不出「這一次是哪一次的」。

## 症狀（她看得到的）

- 試算表健檢底下那一列印 `二返()`，括號永遠是空的
- 「約二返」那張待辦點進去，看不出要約的是哪一次健檢的報告
- 壓表壓二返時，畫面上沒有任何一句話說這是接在哪一次健檢後面

## 想要的樣子

她的原話：

> 就是想要二返和健檢是一對一連結的

一筆二返的時段要記得它是哪一次健檢的。壓表壓二返時畫面上要說出來，
試算表的括號要填得出日期與醫師。

## 作法

**在時段上加一個欄位**：`slot.followupForVisitId`（那一次健檢的來訪 id）。

放在 slot 不放在 visit：一筆來訪可以有好幾段，二返那一段跟同一天別的療程沒有關係。
跟 `entitlementId` 放在一起也講得通 —— 兩個都是「這一段掛在誰身上」。

要動的地方：

| 檔案 | 改什麼 |
|---|---|
| `domain/followups.js` | 新增 `openExamsFor(pair, visits)`：這筆配對底下還沒被二返認領的健檢來訪，日期舊的在前 |
| `domain/visits.js` | `validateVisit()` 認得這個欄位；指到不存在／不是這筆配對的健檢要報錯 |
| `ui/views/schedule.js` | 選到二返那一筆額度時，冒出「這是哪一次健檢的」那一排（只有一個候選就自動選好） |
| `ui/views/visitEditor.js` | 同上，來訪編輯器也要改得到 |
| `domain/sheetReport.js` | `followupNotes()` 改成走 `followupForVisitId`，不要再照位置配 |
| `domain/health.js` | 資料健檢多一條：二返時段指不到健檢 |
| `firestore.rules` | `validVisit()` 的時段欄位白名單要放行 |

**舊資料怎麼辦**：`followupForVisitId` 沒有值的二返時段照舊走「照位置配」那條路。
不補猜、不自動回填 —— 猜錯的話試算表上會出現一個對不起來的日期，
而那比空括號糟。資料健檢會把它們列出來讓她自己補（同 ADR-0009 的判準：排除但說明）。

## 驗收

- 壓表選二返時，畫面上寫著「接在 8/27 的 8萬健檢 後面」
- 那位客戶有兩次健檢時，兩個候選都列得出來，選錯得回頭改
- 試算表印 `8/5 二返(王醫師)`，不再是 `二返()`
- 舊資料（沒有這個欄位的）照舊印得出來，不會變成空白
