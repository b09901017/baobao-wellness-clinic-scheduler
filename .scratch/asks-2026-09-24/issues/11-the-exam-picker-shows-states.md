# 「這是哪一次健檢」標狀態，只有已完成按得下去

Status: todo
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
