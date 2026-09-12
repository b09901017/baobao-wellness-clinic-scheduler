# 08 說明段落先有自己的 class

Status: todo
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`、`.scratch/quieter-screens/issues/08`

## 她要的

> 第三 : 有關於畫面簡化，能用Tooltip就用Tooltip，像是以下這些
> page__lead，wayrow__hint，drawer__note，note__note，(muted)，muted dim，card__note
> 這些請幫我全域檢查，我看起來大部分都是新手說明，這些不需要，占版面，讓畫面很雜很頭痛，都縮成用Tooltip，哪種形式的都可以

## 為什麼會這樣

`.scratch/quieter-screens/issues/08` 的「前置」那一節早就寫過這件事，而上一輪
只做了元件與最划算的八處，沒有做這一步。

**她點名的那幾個 class 不是同一種東西。** 盤點結果：

| class | 幾處 | 實際上 |
|---|---|---|
| `page__lead` | 15 | 約 10 處是說明，**5 處是資料**（「已壓 3/12 位」、筆數） |
| `card__note` | 21 | 多數可以收，但 `availability.js` 的「它們**仍然生效**」是紅線 |
| `drawer__note` | 4 | 其中一處是 `components/sheet.js` 的通用參數（內容由呼叫端決定） |
| `muted dim` | 14 | **大多不是說明**：額度到期日、「來自方案 X」、「備註：（她自己寫的字）」 |
| `note__note` | 1 | **是隨手記的內文** |
| `wayrow__hint` | 1 | 可以收 |
| `muted` | 258 | 四種混在一起：載入中／空狀態／資料第二行／說明 |

**照 class 批次轉會把「載入中…」變成一顆要點開才知道的問號。**

## 怎麼做

給說明段落一個專屬的 class（例如 `.explain`），先**只做分類、不改行為**：

1. 逐處判斷，只有「讀過一次就夠的說明」掛上去
2. 三種東西**不掛**：她自己寫的字（備註、隨手記內文）、資料的第二行、
   `tests/tip-red-lines.test.js` 的五條紅線
3. 這一支**畫面上一個 px 都不變**（新 class 的樣式跟原本那一個一樣）
4. 寫一支測試：`.explain` 底下不可以出現「載入中」「還沒有」那幾種字

分類完之後 09／10／11 才有得轉，而且轉錯了看得出來。

## 判準

- 掛完之後 `npm run verify` 全綠，而且**畫面上看不出任何差別**
- 每一個掛上去的地方，問得出「這一句藏起來之後，她按下去的結果會不會不一樣？」——
  答案全部是「不會」
- 紅線那五句一個都沒有被掛上
