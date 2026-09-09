# CRLF 讓「掃原始碼」的單元測試在 Windows 上假紅

Status: todo
來源：使用者，2026-09-09（跑 PR #84 的驗收時發現 `npm test` 有一支紅）
動工前先讀：`.gitattributes`、`tests/slot-note.test.js`

## 症狀

本機 `npm test` 固定紅一支：

    ✖ 壓表：那一句寫進時段，不寫進整筆   （tests/slot-note.test.js）

**它不是真的壞了，那支測試也沒有寫錯。** 在乾淨的 `origin/develop` 上
detached checkout 跑一樣紅 —— 所以「連 develop 都紅」不代表 develop 壞掉，
兩邊都是同一個換行符造成的。

## 為什麼

`core.autocrlf=true`，而 `.gitattributes` **只有一條 `graphify-out/graph.json`
的規則、沒有 `*.js`**。所以這台機器 checkout 出來的原始碼一律是 CRLF。

那支測試是**掃原始碼**的，而它的樣式裡帶著 `
`。同一份檔案實測：
CRLF 下 `false`、轉成 LF 之後 `true`。

CI 上是 LF，所以**只有本機會紅** —— 這是最糟的形狀：她在自己機器上跑
`npm test`，看到一支紅的、而 CI 是綠的，於是不知道該信哪一個。

## 為什麼值得修

「本機有一支永遠是紅的」會**訓練人忽略紅字**。下一次真的壞掉的時候，
那一支紅的會被當成「喔又是那個」。守衛的價值來自「紅了就是真的有事」。

## 可能的作法（還沒決定，動工前先想清楚）

1. **加 `.gitattributes`**：`* text=auto eol=lf`（或至少 `*.js text eol=lf`）。
   最乾淨，但會讓既有的工作目錄整批重新 checkout —— **要挑一個沒有人開著
   分支改到一半的時候做**，而且要確認 `.sh`／`.gs` 那幾支不受影響。
2. **讓那幾支測試不在意換行**：掃之前先 `.replace(/
/g, '
')`。
   影響面最小，但**每一支掃原始碼的測試都要記得做一次** —— 漏掉一支就
   再來一輪同樣的困惑。要做的話應該收成一支共用的 helper。

先查清楚**有幾支測試在掃原始碼**（`tests/` 裡讀 `readFileSync` 再比對樣式的
那幾支：`env.test.js`、`nav.test.js`、`number-fields.test.js`、`save-guards.test.js`、
`tokens.test.js`、`shell-cache.test.js`、`slot-note.test.js`…），
才知道 2 的成本有多大。

## 順帶：`.sh` 是 CRLF 不會出問題

同一天驗過：Git Bash 解析時會把行尾的 `` 吃掉，
`tests-e2e/start-emulators.sh` 裡 `PROJECT="$(node tests-e2e/project-id.mjs 0)"`
取回來的值是乾淨的 14 bytes、沒有夾帶 CR。所以這支 issue 只關於 JS 測試。
