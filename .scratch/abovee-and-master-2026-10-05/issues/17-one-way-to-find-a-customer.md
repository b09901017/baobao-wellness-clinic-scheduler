# 找人只有一種比法：日曆新增與批次取消跟上拍 Abovee

Status: done
來源：08 做完時留下的（「日曆新增的『要幫誰排？』與批次取消還是 `String(name).includes(q)` —— 沒換，問她」）
動工前先讀：`domain/customers.js` 的 `searchCustomers()`、`ui/views/calendar.js` 的 `pickCustomer()`、`ui/views/bulkCancel.js` 的 `searchHtml()`

## 她要的

問她的那一題：

> 日曆「要幫誰排？」 and 批次取消 still use a plain name match that doesn't ignore spaces or
> full-width/half-width characters. I suggest switching both to the same search 拍 Abovee now uses.
> It's a small change; shall I?

她 2026-10-05：

> 好 ! 可以修改

## 為什麼會這樣

08 做拍 Abovee 的「換一位」時新寫了 `searchCustomers()`（比法是 `normalizeAlias()`：去空白、全形半形一致、英文不分大小寫），
療程單的「是誰」跟著用。另外兩個找人的框是更早寫的，各自 `String(c.name).includes(q)` ——
客戶叫「王 小明」（中間有空白）時打「王小明」找不到，打全形的英數字也找不到；同一位客戶在一個框找得到、另一個框找不到。

## 談定的做法

- `domain/customers.js` 多一支 `nameHas(name, query)`：名字裡有沒有她打的那幾個字，比法就是 `searchCustomers()` 那一種
  （那一支改成呼叫它）。一個字都沒打回 `true`
- 日曆新增與批次取消的那一行改呼叫它。**各自「列誰」的條件不動**：
  - 日曆新增：沒打字時照舊列前 40 位、不列停用的
  - 批次取消：沒打字時照舊不列、**停用的照舊找得到**（停用的客戶身上可能還有要取消的來訪 ——
    直接換成 `searchCustomers()` 的話那幾位會找不到）

## 牽連

- 壓表牆上那一格搜尋（`schedule.js` 的 `matchesSearch()`）與客戶清單的搜尋（`customers.js` 的 `matches()`，比名字＋電話＋LINE＋來源）
  是同一種寫法 —— **她只答應了上面兩處**，這兩處列出來問她，不順手改

## 判準

- 客戶叫「王 小明」：日曆新增打「王小明」找得到？批次取消也找得到？
- 打全形的「Ａ」找得到名字裡半形的「A」？
- 批次取消：停用的客戶照舊找得到？沒打字照舊一位都不列？
- 日曆新增：沒打字照舊列出來？

## 做完時留下的

- `domain/customers.js`：`nameHas(name, query)`；`searchCustomers()` 改成呼叫它
- `calendar.js` 的 `pickCustomer()`、`bulkCancel.js` 的 `searchHtml()` 各改一行。「列誰」都沒動：日曆新增沒打字照舊列前 40 位、不列停用的；
  批次取消沒打字不列、停用的照舊找得到（**所以沒有直接換成 `searchCustomers()`**）
- 測試：`tests/abovee-picks.test.js`「找人只有一種比法」（含掃原始碼：那兩支不可以再自己 `includes(q)`）；E2E `22` 加一支（兩個框各打一次）
- `sw.js` v159
- **還有兩處同一種寫法，沒有動（她只答應了這兩處）**：壓表牆上的搜尋（`schedule.js` 的 `matchesSearch()`）、
  客戶清單的搜尋（`customers.js` 的 `matches()`：名字＋電話＋LINE＋來源接成一串比）。問她了

## 2026-10-06 補：剩下那兩處也換了

她：「好」。

- `schedule.js` 的 `matchesSearch()` → `nameHas(row.customerName, view.search)`
- `customers.js` 的 `matches()`：名字、電話、LINE、購買通路**一格一格**問 `nameHas()`。以前是接成一串再 `includes()` ——
  照那樣換的話，空白去掉之後名字的尾巴會跟電話的開頭連在一起（打「明09」找得到王小明）。
  **換掉的代價**：一句話跨兩格（「王小明 顧客會」）以前找得到、現在找不到 —— 沒有人這樣找
- 療程單那一頁上面的搜尋本來就是 `normalizeName()`（同一種比法），沒有動
- 測試：`tests/abovee-picks.test.js` 多兩支（掃原始碼、一格一格比）；E2E `22` 加一支（壓表牆）、`30` 的「電話還找得到人」多三句（客戶清單）
- `sw.js` v162；`CLAUDE.md` 連動表「打字找客戶的框」那一列改成六個框
