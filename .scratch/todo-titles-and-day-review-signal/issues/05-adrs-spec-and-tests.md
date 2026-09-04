# ADR、SPEC 與測試

Status: done
來源：spec.md（CLAUDE.md 的連動表）
動工前先讀：`docs/agents/domain.md`、`CLAUDE.md` 的「容易漏掉的連動」

## 兩支 ADR

一支一個決定，寫理由不寫作法（`docs/agents/domain.md`）。

### ADR-0071 「今天做了什麼」只留有份量的那幾則

推翻 ADR-0062 的「一則都不可以被丟掉」**那一句**，不是那一支。要寫進去的：

- 原本那條規矩在防的是「**安靜地**消失」，不是「不列出來」。
  新的規矩是「濾掉的要數出來、要點得開」，`total` 永遠算得回去。
- **份量掛在段上**，不是第二套分類法 —— 段已經回答了「這是流程的哪一步」。
- **稽核紀錄一個字都不改**（她指名的），所以閘門寫在 `domain/dayReview.js`，
  不寫進兩頁共用的 `domain/audit.js`。
- 為什麼「已排未上 0→1」不算她做的事：那是**來訪的副作用**，
  而那筆來訪就在上面幾列。
- 為什麼營養品交付要留（要進試算表，正是這一頁在抓的那種漏）。

### ADR-0072 待辦中心的一列只有標題

推翻 ADR-0033 的**一半**（「一個數字後面配一句話」那一句）。要寫進去的：

- 說明文字沒有消失，它**搬到她真的要操作的那一頁**（`GROUPS[].lead`）。
  總覽回答「有幾件、哪一段」，那一頁回答「這件事怎麼做」。
- 十三句同時在畫面上等於零句：她掃的時候每一行字都是一次停頓。
- ADR-0033 要解釋的事沒有變，變的是解釋它的地方（`#/todo/ask` 的三個分區
  是那句話的完整版，而且就在一次點擊處）。

## SPEC.md 第 8.1 節

三個地方要改：

1. 「底下是分類清單，**每一列一句話說明**」→ 每一列只有標題與數字，
   說明在點進去那一頁的第一行。
2. 那張七段的表：**表格本身留著**（它是規格，不是畫面文案），
   但要加一句「表格裡的說明不再印在總覽上」。
3. 「看今天做了什麼」那一段：「最後一段永遠收得下剩下的 —— 一則都不可以被
   丟掉」改寫成新的規矩，並補上「勾掉一張任務要講得出誰的哪一天的哪一項」。

## 測試

### 改寫（不是刪掉）

`tests/day-review.test.js` 的 `describe('一則都不可以被丟掉')` →
`describe('一則都不可以安靜地消失')`：

- `shown + hidden === total`（照流程那一格）
- `shown + hidden === total`（照人那一格）
- 對不上的（`batches.update`）落進 `hidden`，不是落進「其他」

### 新增

`tests/day-review.test.js`：

- ⑨ 客戶與額度：`customers.create` 留、`entitlements.create` 留、
  `softDelete` 兩種都留、`deliveries` 留、改 `flags`／`notes` 留；
  次數變化濾掉、「對帳過了」濾掉、改電話濾掉
- ⑩ 設定：`config/courses.create` 濾掉（她決定的）
- ⑪ 其他：`playbooks.create` / `playbooks.update` 濾掉
- 一個人身上的事全部被濾掉 → 那個人整組不出現
- `tiles` 數的是留下來的
- `hiddenRows` 照樣會收合連著一樣的句子（她一天對帳二十筆，那一攤開來
  不能是二十列一模一樣的字）

`tests/audit.test.js`：

- 傳 `visitOf` → 「勾掉 客戶A・9/14(日)・復能・Examine」
- 沒傳 `visitOf` → 退回「勾掉 客戶A・Examine」
- `visitOf` 回 null（來訪被刪了）→ 一樣退回去，不是印出半句話
- 「拿回來」取代「取消勾選」

`tests/todo-flow.test.js`：不動（那一支測的是分段，不是文案）。

### 一定要跑的

`npm test` 全部。特別是：
`tests/tasks.test.js`、`tests/todo-flow.test.js`、`tests/audit.test.js`、
`tests/day-review.test.js`、`tests/no-secrets.test.js`（例子一律寫客戶A／王小明）。

## 其他連動

- `README.md` 的開發狀態表：這一輪不新增步驟，確認一次要不要打勾。
- `public/sw.js` 的 `SHELL`：**沒有新檔案**（改的都是既有的），不必動。
- `docs/常見問題.md`：如果有一條在講「今天做了什麼為什麼有這麼多列」，
  要改；沒有的話**補一條**「為什麼今天做了什麼裡看不到額度的變化」。
- `docs/操作手冊.md` 第 190–191 行的 Examine／耀聖步驟**不動**
  （它現在是那組字唯一在文件裡的家，更重要了）。


## Comments

**2026-09-04 —— done。**

- ADR-0071、ADR-0072 補上，**舊的 0033 與 0062 一個字都沒改**。
- SPEC 第 8.1 節三處都改了。
- `CONTEXT.md` **不用改**：這一輪沒有長出新的詞，而「拿回來」那一條本來就在，
  是程式碼去對齊它（`domain/audit.js` 那兩處）。
- `docs/常見問題.md` 多一節「今天做了什麼」，兩條：「怎麼看不到額度的變化了」
  與「勾掉的 Examine 現在怎麼變成好幾列了」。
- `docs/操作手冊.md` 沒動（Examine／耀聖的步驟現在更重要了）。
- `public/sw.js` 沒動：沒有新檔案。
- `README.md` 開發狀態表補一列 19。

**測試**：`npm test` 1581 綠。`tests/day-review.test.js` 從 40 條長到 54 條，
`tests/audit.test.js` 從 43 到 47。E2E 跑了 00、08、11、12、19 五支共 40 個，
全綠（含新的 S5）。
