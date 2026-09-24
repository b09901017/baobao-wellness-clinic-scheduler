# 「這是哪一次健檢」標狀態，只有已完成按得下去

Status: done
Blocked by: 06
來源：`../spec.md` 第 11 條（第三點 c、Q4）
動工前先讀：`domain/followups.js` 的 `examChoicesFor()`、`domain/nthFollowup.js` 的 `examChoicesForNth()`、
`ui/views/schedule.js` 的 `examField()`／`pickExamIfObvious()`、`ui/views/visitEditor.js` 的健檢那一排、
`ui/components/aboveeConfirm.js` 的「接哪一次健檢」

## 她要的

> 能不能在這是哪一次的健檢那邊 可以小小標註他現在的狀態 例如未確認 已確認 已完成 未到 取消等等，
> 然後如果還沒有排過健檢，也可以有tooltip 說還沒排過健檢

> 4 好 只有已完成按得下去可以，不要讓整個流程亂掉

## 談定的做法

- 列出這一筆健檢額度的**每一次健檢**（每一段），標那一段自己的狀態（`slotStatus()`，用 `STATUS_VIEW` 的短字）
- **只有已完成按得下去**；已被別場二返佔走的照舊按不下去、標「已約」
- `pickExamIfObvious()` 只從按得下去的裡面挑
- 一次健檢都沒排過：那一排標題旁邊 `?`「還沒排過健檢」；排了但沒有一次做完：灰掉的那幾顆自己講
- 三個入口（壓表、來訪編輯器、拍 Abovee）走同一份候選

## 判準

- 已確認、未到、已取消的健檢看得到、按不下去、標著狀態？
- 只有一次已完成而沒被佔 → 照舊自動選好？
- 驗證：存一段二返指向一次不是已完成的健檢 → 擋下來（不讓流程亂掉）？

## 對照 develop（`d00b644`）

- 06 之後 `examChoicesFor()` 只列 `usedAndDone()` 的來訪（問健檢那一段）—— 所以現在「列出來的」就是「按得下去的」，
  這一支要把沒做完的也列回來、標狀態、關掉。
- 驗證（`visits.js` 1530 附近）：**n返** 已經問 `examDoneIn()`；**二返**只問「那一筆裡有沒有那筆健檢額度」，沒問做完了沒 —— 要補。
- 三個入口：壓表 `examField()`／`pickExamIfObvious()`（`schedule.js:1724/1781`）、來訪編輯器 `examField()`（`visitEditor.js:712`）、
  拍 Abovee `aboveeImport.js` 的 `examChoices()` → `aboveeConfirm.js:350/456`。
- 一筆來訪裡有兩段健檢時（她說理論上不會）：那一次的狀態取做完的那一段，沒有就取第一段還活著的。

## 她 2026-09-24 回的（第二批動工前）

問：n返 那一排（同名「這是哪一次健檢的」）現在只列做完的，要不要也跟二返一樣列出每一次、標狀態、只有已完成按得下去？
答：**跟二返一樣**。所以 `examChoicesForNth()` 也列每一次、標狀態、只有已完成的 `pickable`（n返 照舊不會被「已約」鎖住）。

## 做完時留下的

- 狀態只有一支：`followups.js` 的 `examStatusIn()`（做完了＝`examDoneIn()`，跟 `pickable`、存檔驗證同一支；
  否則取還活著的那一段，全部取消才是已取消）。丸子上那一小格只有 `examChoiceNote()`（已約／狀態・幾返）。
- `followups.js` 多 import `visits.js` 的 `slotStatus()`：visits → followups → taskRules → visits 這一圈本來就在，
  兩邊都只在函式裡用，載入時不互相讀。
- `examVisits()`（只有做完的）**沒改**：「＋ n返」那一顆畫不畫、客戶詳情的健檢卡都還靠它。畫面上的閘門改問
  `.some((c) => c.pickable)`，跟它是同一件事。
- 存檔驗證：二返**只擋還開著（待確認／已確認）的段**。已經結案、取消的二返身上的舊連結是歷史 ——
  整筆一起驗的話，她改同一天別段也存不回去。
- 「一次都沒排過」那一排只剩標題＋`?`（`tip('還沒排過健檢')`）；以前那一句「還沒有做完的健檢可以接」拿掉了
  （現在排了沒做完的會自己列出來、標狀態）。`docs/邊界測試清單.md` C2 跟著改。
