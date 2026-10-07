# 營養品「＋新增…」：先驗證再建主檔，名字重算

Status: done
來源：`findings.md` 第 3 條（a）（b）（c）
動工前先讀：`public/js/ui/components/buy.js` 的 `commitNewProduct()`（`:830`）、`afterDetail()`、`withItemNames()`、`nameHint()`、`validate()`、
三個呼叫端 `public/js/ui/views/customerDetail.js:1694-1708`、`public/js/ui/components/buySheet.js:72-88`、`public/js/ui/views/customersBulk.js:603-618`、
`public/js/domain/products.js` 的 `productLabel()`／`itemNames()`、`public/js/domain/entitlements.js:756`（`validateEntitlement()`）、
ADR-0057、0059、`tests/buy.test.js`、`CLAUDE.md` 連動表「營養品的名字或金額」「『她賣了什麼給客戶』的那張表」兩列
Blocked by: —

## 她要的

`findings.md` 第 3 條（她 10/7：「我想修一二三六的所有內容」）：

> (a) 加購 → 營養品 → 只按「＋新增…」打一個名字 → 存 →「額度名稱不可空白」（那一格藏在「進階設定」）。
> (b) 勾 GABA ＋ 新增一款 → 存得進去，但額度名字只有「營養品 3,000（GABA）」，提醒隨手記寫「GABA＋新的那款」。
> (c) (a) 失敗那一次，新打的那一款照樣進了 設定 → 營養品 清單。

## 為什麼會這樣

`commitNewProduct()` 是存檔前唯一補名字的地方，三個入口都經過它：

- **(c)** 它先 `createProduct()` 才把草稿交回去給呼叫端驗證 —— 驗證沒過，主檔已經多了一筆。
- **(b)** 它把新的那一款加進 `items`，但 `label: draft.label` 原樣帶回去。那個名字是加進去**之前**算的（`afterDetail()` 在她點丸子／打字時算），所以少一款。
- **(a)** 只打新的一款時 `items` 是空的，`afterDetail()` 算不出名字（`nameHint()` 的 `hasPick` 是 false），`label` 是空的 → 「額度名稱不可空白」。
  客戶詳情那一條還多一層：`{ ...live, ...readEntitlement(form) }` 把表單上那一格空的 label 蓋上去。

## 要做的

修在 `commitNewProduct()` 一處，三個呼叫端跟著換同一種呼叫法：

1. **先組好「加進去之後」的草稿、重算名字、驗證過了才建主檔。** 建之前新的那一款還沒有 id，
   驗證要認得「這一款是這一次要新建的」（`validateEntitlement()` 會查 `items` 的 `productId` 在不在主檔上 —— 動工時看它怎麼查，
   用一份暫時多一筆的 `products` 餵它，不要為了這個在 domain 開一個旁門）。
2. **名字重算**：加了新的一款之後，名字走跟 `afterDetail()` 同一支（`productLabel()`），**不另寫一份**。
   **她在「進階設定」自己打過名字的不可以被蓋掉** —— `afterDetail()` 已經分得出「這個名字是自動的還是她打的」，照它的判斷；
   分不出來時先讀它怎麼分，不要猜。
3. 驗證沒過：**一次 IO 都不發生**，錯誤照舊印出來，她打的字留在那一格。
4. 同名的既有那一款照舊重用（`:838-842`），不建第二筆。

呼叫端怎麼改由這一支的回傳形狀決定（例如回 `{ draft, errors }`），三邊同一種寫法。`tests/buy.test.js` 直接載入 `buy.js`，
所以它照舊不 import `/data`（`createProduct` 與驗證用的主檔都是傳進來的）。

## 判準

- 驗證沒過的那一次，`設定 → 營養品` 會不會多一筆？
- 存進去的額度名字、提醒隨手記那一句、交付面板那幾列，講的是**同一組品項**嗎？（三個東西讀的都是 `items` 與 `label`）
- 她自己打的顯示名稱會不會被重算蓋掉？
- 只打新的一款、不勾任何既有的：三個入口都存得下去嗎？

## 測試

- 單元（`tests/buy.test.js`）：(a)(b)(c) 各一條，`createProduct` 用一個會記次數的假函式 —— (c) 斷言它被叫 0 次。
- E2E：新 spec 或加進既有營養品那一支 —— 客戶詳情加購只打新的一款存得下去、名字帶著它；新增客戶「＋加一項」同樣；
  故意讓驗證不過（例如幾份打 0）之後 設定 → 營養品 沒有多一筆。

## 做完時留下的

- `commitNewProduct(draft, master, createProduct)` 改回 `{ draft, errors }`，順序：補名字 → 新的那一款用一個暫時的 id 站著、
  `retitle()` 重算名字 → `validate()` → 過了才 `createProduct()`、把暫時的 id 換成真的。沒過回原本那一張（她打的字留著）、0 次 IO。
- 三個呼叫端（`customerDetail.js`、`buySheet.js`、`customersBulk.js`）拿它回的 `errors`，不再自己 `buy.validate()`。
  客戶詳情那一條原本只傳 `{ products }`，現在連 `courses`、`equipment` 一起傳（驗證要）。
- `buy.validate()` 多一道：營養品一款都還沒選只講「要選至少一種營養品」（以前先吐「額度名稱不可空白」）。
- 既有 7 條測試改成新的回傳形狀（草稿換成一張存得下去的），新增 6 條；E2E `58-verified-rules` 的 P7
  （(c) 要關掉瀏覽器的 `min="1"` 才問得到 domain 那一道）。
