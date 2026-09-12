# 05 「這一天共用」整個拿掉

Status: done
Blocked by: 04
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`

## 她要的

> c 這一項的代辦中的內容不需要再有小Tooltip說明這一張是這天共用的，完全沒必要，全部刪除

## 為什麼會這樣

**那句話沒有寫錯，而且它已經被改過兩次了**：

| 什麼時候 | 長什麼樣 | 為什麼 |
|---|---|---|
| 2026-09-09 | 加上「這一天共用」這個標籤 | 她問到「勾一次為什麼兩邊都掉」，談定要標出來 |
| 2026-09-10 | 收進一顆 `?`（issue 09 第八項） | 她：「根本不用寫吧？單純誤導使用者且占版面」 |
| **2026-09-12** | **整個刪掉** | 這一支 |

事實本身不會改變：任務只掛 `visitId`（`domain/taskRules.js` 的 `tasksForVisit()`
收整筆、逐段跑完之後把 kind 塞進一個 Set 去重），所以同一張 Examine 真的會出現在
那天每一段的卡片上，**在早上那一段勾掉，下午那一段也會跟著掉**。

**這是一個知情的取捨**：畫面上從此不講這件事。要寫進 ADR。

## 怎麼做

- `domain/todoFlow.js`：`SHARED_TODO_LABEL`、`SHARED_TODO_NOTE` 兩個常數拿掉，
  `todosForVisit()` 不再算 `shared`
- `ui/components/taskMirror.js`：那一顆 `tip()` 拿掉
- 檔頭那幾段解釋跟著走（**不要留一段在講一個已經不存在的東西**）
- `tests/tip-red-lines.test.js` 與 `tests/tip.test.js` 掃到那兩個字串的地方要跟著改

## 判準

- 一天兩段、一張 Examine：兩段的卡片上都看得到那張 Examine，
  **而且畫面上一個「共用」都沒有**
- 勾掉的行為一個字都沒有變（本來就沒有勾選框，這一塊只給看）
- 全站搜不到 `SHARED_TODO`
