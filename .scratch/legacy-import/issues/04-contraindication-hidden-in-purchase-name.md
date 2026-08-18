# 永久限制藏在購買名稱裡，匯進來之後器材不會被擋

Status: done
回報者：跑真檔案的 dry-run 時發現，2026-08-18
動工前先讀：`docs/adr/0002-app-records-decisions-it-does-not-make-them.md`、
`public/js/domain/contraindications.js`

## 症狀

真的舊表上有一位客戶的 B2 購買名稱是：

```
0604 顧客會-手有金屬，只能INDIBA(某某她最愛)
```

「體內金屬」是醫療禁忌 —— `ADR-0002` 裡**唯一**會硬性阻擋的東西。
但舊表沒有「永久限制」這個欄位，這句話只是購買名稱的一部分，
匯進來之後 `customer.flags` 是空的。

`domain/contraindications.js` 的阻擋是拿 `flags` 去比對 `equipment.contraindications`。
**flags 是空的 → 超磁場與高能量雷射不會被擋下來。**

同一張表的第 9 列還有一個小的：`x萬健檢` 的 `x` 是還沒決定的金額等級，
匯進去會建出一筆名字叫「x萬健檢」的額度，而報告一句話都沒提 ——
她在客戶詳情頁看到那筆會以為系統壞了。

## 做了什麼

**不自動填 flags。** 「手有金屬」是禁忌，「金屬已取出」不是，兩句話都含有「金屬」——
那是她的判斷（ADR-0002）。而且填錯的兩個方向都不好：漏填會漏擋，多填會擋掉
其實可以用的器材，兩種她都不會知道系統是怎麼決定的。

改成**讓她不可能錯過**：

- `contraindicationHints()` 掃購買名稱、姓名欄、二返註記與所有撿起來的手寫註記。
  要找的字**從主檔的器材推出來**（`equipment[].contraindications`），不寫死 ——
  她之後新增一台有別的禁忌的器材，這裡自動就會找那個字。
- 報告最上面單獨一段 `‼`，列出是哪幾位、哪個禁忌，以及「沒設定的話哪幾台不會被擋」。
- app 的匯入頁多一張 `card danger`，擺在比對報告**上面**（報告裡的 ‼ 會被捲走）。
- 匯入前的確認對話框也列一條。
- `x萬健檢` 加一句提醒，額度照建、名稱照樣原文照抄。

## Comments

`docs/legacy/samples/` 測不到這條路 —— 去識別化正好把禁忌的字眼抹掉了。
守門的是 `tests/legacy-import.test.js` 裡自己編的 fixture，這件事寫進了
`docs/legacy/samples/README.md`，免得之後有人拿樣本的輸出當通過標準。
