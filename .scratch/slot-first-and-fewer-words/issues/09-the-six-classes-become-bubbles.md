# 09 她點名的那幾個 class 收進說明泡泡

Status: done
Blocked by: 08
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`、本目錄的 `08`

## 她要的

見 `08`。這一支是把 08 分好類的那批真的收起來。

## 為什麼會這樣

元件（`ui/components/tip.js`）2026-09-10 就做好了，上一輪只轉了八處
（`.scratch/quieter-screens/issues/09`），其餘談定「按畫面分批跟上」。

## 怎麼做

一頁一頁轉，**一頁一個 commit**。每一處的作法是同一種：那段字從畫面上拿掉，
變成它旁邊（抬頭或那一列的標籤）的一顆 `tip()`。

- **字一個都不要改寫** —— 除非那一句本來就寫錯
- **沒話講就回空字串**（`tip()` 已經是這樣）
- 空狀態（「還沒有 X」）自己留著，只有說明那幾行進去
- 那一顆的觸控區 44px 而且不會蓋到隔壁（`.tip::after` ＋ `position: relative`）

## 判準

- 那幾頁上**只剩一顆小標記**，點了才看得到原本那段字
- 紅線那五句一句都沒有被收進去（`tests/tip-red-lines.test.js` 盯著）
- 淺色與深色都讀得出來
- 一次只有一張泡泡浮著
- 測試：掃原始碼，斷言轉過的那幾段字出現在 `tip()` 的呼叫裡、
  不再出現在 `.page__lead` / `.card__note` / `.drawer__note` 裡
