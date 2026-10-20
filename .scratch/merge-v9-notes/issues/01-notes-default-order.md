# 備註沒排過的預設順序：病歷號 → LINE → 長備註 → 短備註 → 電話

Status: done
動工前先讀：E2E `74-long-notes`、`77-chart-number`（照預設位置拖曳、斷言順序，過目查到的）；`domain/customerNotes.js` 的 `noteItems()`、`chartNoMove()`；ADR-0156（「沒排過」那一句）、ADR-0160；`ui/components/marks.js` 的 `notesPreview()`；`tests/customer-notes.test.js`；CLAUDE.md「備註那一段的順序、長備註」那一列

## 她要的

> 還有一個希望注意的點是，我希望每個人的備註都應該預設是病歷號最前面，然後有line的line第二個，然後電話是在最後面

## 為什麼會這樣

`noteItems()` 沒有 `noteOrder` 時回 `[電話, LINE, 病歷號, …長備註, …短備註]` —— 她 10/18 說「最上面一行電話，長備註，原本的短備註」，
10/19 病歷號變成一格時接在 LINE 後面（ADR-0156、0160）。這一次推翻那一句：寫一支新的 ADR，舊的不改。

排過的（有 `noteOrder`）照她排的，**不動**。不在順序裡的那幾格（排的時候還沒填）：以前電話、LINE、病歷號一起放最前面 ——
照這一次的意思改成病歷號、LINE 放最前面，電話接在最後面。

## 判準

- 一位沒排過、電話＋LINE＋病歷號＋一則長＋兩則短都有的客戶，`noteItems()` 的 `kind` 依序是 `chartNo, line, long, mark, mark, phone`
- 排過順序、排的時候還沒有電話的那一位，後來填了電話 → 電話在**整串的最後**（接在沒排進去的長備註、短備註後面 —— 拍訂購單接在最後的「尾款」變成倒數第二）；還沒排進去的病歷號、LINE 照舊在最前面
- `chartNoMove()` 搬完、沒排過的那一位 → 病歷號在最前面（不寫 `noteOrder`）
- 客戶清單卡片（`notesPreview()` 前四則）照新順序 —— 電話多半看不到了，這是她選的（spec 的副作用那一條）

## 做完時留下的（10/20）

- `noteItems()`：沒排過 `[病歷號, LINE, …長備註, …短備註, 電話]`；排過的，沒排進去的病歷號／LINE 在最前、電話接在整串的最後（tail 的最後一個）
- ADR-0163（推翻 ADR-0156 第二節那兩句、ADR-0160「接在 LINE 後面」）
- 測試：`customer-notes.test.js` 三條（沒排過、排過之後才填電話、`[line, phone]` 解構）、`chart-no-field.test.js` 一條；E2E `74` N1／N6／N7、`77` C1／C5／C7（C7 量並排，改成排過的那一種）
