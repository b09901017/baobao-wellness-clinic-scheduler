# 合併檔 v3：時長、警示、合作機構，app 收只有一台的擇一池

Status: done
Blocked by: 01
來源：`../spec.md`
動工前先讀：`domain/mergeImport.js` 的 `planForCustomer()`、ADR-0075、ADR-0074、ADR-0076、
`.claude/skills/calendar-sheet-merge/SKILL.md` 的「合併檔」一節

## 現在壞在哪

- **app 擋掉只有一台器材的擇一池**（`planForCustomer()` 寫著「不到兩種就不匯」），跟 ADR-0075「一種也算數」矛盾。
  單買 SIS 的客戶就算 skill 產得出來也匯不進去
- **合併檔沒有時長**：30 分的復能、ILIB 30 匯進去變成 60（擇一池更慘，是 null）
- **合併檔沒有警示與合作機構**，`planForCustomer()` 寫死 `flags: []`

## 做法

- 格式升 `baobao-merge/v3`，`FORMATS` 收 v1、v2、v3（只加欄位不升版，舊版 app 會安靜地吃掉那幾格）
- `entitlements[].durationMin`；沒有就退回課程的時長（v1、v2 照舊）
- `customers[].flags`、`customers[].partners`：字串陣列（ADR-0074、0076 客戶身上存的是字串不是 id）
- 擇一池至少一台才建（零台照舊擋）
- 匯入時自動帶警示推翻了「只提示不自動填」→ ADR-0092

## 判準

- v1、v2 的檔案照樣匯得進去，匯出來的東西跟以前一樣
- 只有 SIS 一台的池建得起來；零台擋掉
- `durationMin: 30` 進得去；沒寫的退回課程
- `flags`、`partners` 原樣寫到客戶身上
- skill 產出的 format 跟 app 的 `FORMAT` 一樣（`tests/calendar-merge.test.js` 盯著）
