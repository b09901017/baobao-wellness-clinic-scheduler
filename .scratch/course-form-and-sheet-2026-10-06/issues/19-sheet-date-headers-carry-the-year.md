# 試算表：日期欄的抬頭不是今年的帶年份

Status: done
來源：13 做完時查到的、她 2026-10-06 回「試算表日期抬頭加年份：要」
動工前先讀：`issues/13` 最下面「做完時留下的」、ADR-0132、`public/js/domain/sheetReport.js`（`customerReport()` 抬頭那一列、`syncBundle()` 的 `dateLabels` 與 `log[].label`）、
`sheets/readonly-report.gs`（`dateLabels` 照印）、`tests/sheet-script.test.js`、`CLAUDE.md` 連動表「試算表的 `SYNC_FORMAT`」「試算表要讀哪些來訪」兩列
Blocked by: 13（合了）

## 她要的

13 做完時問她：

> 試算表日期欄的抬頭沒有年份（`10/7(三)`）。表跨過一年之後，去年與今年的同一天只差括號裡的星期 ——
> 13 讓表一定會跨過一年（她最早的資料是 2026-05-21，所以 2027 年 5 月底開始）。
> 建議：不是今年的那幾欄前面加年份（`25/10/7(二)`）。

她回：

> 2. 試算表日期抬頭加年份：要

## 為什麼現在沒有

抬頭那一格是 `dates.map(shortDate)`（`M/D(週)`），兩條路（自動推送 `syncBundle()`、手動貼上 `customerReport()`）各寫一次；來訪紀錄那一行的日期也是 `shortDate`。
以前往前往後只看 400 天，一張表最多跨兩個年頭但還沒發生過；13 之後過去的全部都讀，表一定會跨年。

## 做法

- **一支** `dateLabel(date, today)`（`sheetReport.js` 裡）：那一天的年份跟 `today` 一樣 → `shortDate`（`10/7(三)`）；不一樣 → 前面加兩位數的年份（`25/10/7(二)`）
- 抬頭（兩條路）與來訪紀錄那一行都走它 —— 同一天在同一張表上印成兩種樣子，她不會知道哪個算數
- 「今年」是**產生那一刻的今天**：自動推送有 `today`；手動貼上那條路要把 `today` 傳進去
- `.gs` 照印、不升 `SYNC_FORMAT`（字串變長而已）。在假的 Apps Script 環境裡畫一次確認

## 判準

- 今年的欄照舊 `10/7(三)`，一個字都不變（現在每一張表都是這樣 —— **這一支上線那天她的表看起來跟以前一模一樣**）
- 去年的欄 `25/10/7(二)`；明年的（往後 400 天跨過年）`27/1/5(二)`
- 兩條路同一天印同一個字；來訪紀錄那一行跟抬頭同一個字
- `SYNC_FORMAT` 沒動，`.gs` 不用重貼
- **這一行會不會讓兩欄看起來是同一天？**

## 連動

- `SPEC.md` 4.8（試算表）、`docs/常見問題.md`「試算表越來越寬」那一條補一句
- `public/sw.js` 的 VERSION

## 做完時留下的（2026-10-06）

- 一支 `sheetReport.js` 的 `dateLabel(iso, today)`：跟 `today` 同一年 → `shortDate`；不同 → `YY/` 接在前面。沒給 `today` → 照舊（不猜）
- 三個地方走它：`customerReport()` 的抬頭（手動貼上，**多收一個 `today`**，`report.js` 傳 `data.today`）、`syncBundle()` 的 `dateLabels`、來訪紀錄那一行的 `label`
- **`SYNC_FORMAT` 沒動、`.gs` 沒動、她不用重貼**：`.gs` 照印 `dateLabels` 與 `log[].label`，只是字變長。`tests/sheet-script.test.js` 拿假的 Apps Script 環境畫，照舊綠
- 今年的欄一個字都沒變 —— 她現在每一張表都是今年的，**上線那天看起來跟以前一模一樣**（2027 年才看得出差別）
- 二返／三返在健檢底下那一行（`9/20 三返(夏)`）、營養品「給了沒」、待辦那一行照舊只寫月日：那幾格掛在一欄底下，欄的抬頭已經帶年份了
- 測試：新的 `tests/sheet-date-year.test.js` 4 條（改之前 import 就紅）；E2E `09` 的 J-C15 多兩句（500 天前那一欄帶 `25/`、10 天前那一欄照舊）。本機跑 `09`：10 條全過
- `SPEC.md` 4.8、`docs/常見問題.md`「試算表越來越寬」；`sw.js` v180

### 審查之後改的（`/matt-code-review`，2026-10-06）

- **表上其他的日期也帶年份了**（Spec 軸：「同一天在同一張表上印成兩種樣子」那一句我只做了抬頭）。TODO／FINISHED 那兩區不在任何一個日期欄底下，
  FINISHED 又一直累積 —— 上面那一條「欄的抬頭已經帶年份了」的理由不成立。`monthDay(iso, today)` 同一條規則：
  FINISHED／TODO 那一行、健檢底下的二返／三返註記、營養品給了沒（`deliveryCell()` 兩條路）。兩條路都把 `today` 傳進去
- 多兩條測試；`tests/sheet-script.test.js`（假的 Apps Script）照舊綠，`SYNC_FORMAT` 照舊沒動
