#!/usr/bin/env bash
# 啟動 Firebase 模擬器（Auth + Firestore + Functions + Hosting）。
#
# **專案 id 用 `demo-` 開頭是刻意的。** Firebase 看到這個前綴才會進入完全離線
# 模式：任何沒被模擬到的服務會直接報錯，而不是安靜地打到真的專案上。
#
# **這個值不寫死，是算出來的。** 唯一的推導在 `public/js/firebase-config.js`
# 的 `projectIdFor()`，三邊（這裡、E2E fixture、app 自己）呼叫同一支 ——
# 以前三邊各寫一份字串，對不上時 fixture 塞進 A、app 讀 B，每個 E2E 都是
# 「畫面空的」而且沒有任何錯誤訊息。`tests/env.test.js` 會真的跑一次這條路。
#
# 這裡帶 0 ＝ 預設的那一份。**平行跑的時候不必開 N 個模擬器**：Firestore
# 模擬器本來就一顆裝得下多個 projectId，worker 1 以後那幾份是第一次被寫到時
# 自己長出來的。Auth 那側分不了專案（見 fixtures/emulator.js 的
# AUTH_PROJECT_ID），而那不影響隔離 —— 要隔離的是 Firestore。
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT="$(node tests-e2e/project-id.mjs 0)"

# Java 找不到才提示，**不要寫死某一台機器的路徑** —— 那樣換一台電腦或進 CI
# 就壞，而錯誤訊息只會說「找不到 java」，看不出是這一行造成的。
# 裝好 JDK 之後如果這個 shell 還沒吃到新的 PATH，自己 export JAVA_HOME 再跑。
if ! command -v java >/dev/null 2>&1; then
  echo "找不到 java —— Firebase 的 Firestore 模擬器需要 JDK 11 以上。" >&2
  echo "裝好之後如果這個 shell 還沒吃到新的 PATH，先 export JAVA_HOME 再跑一次。" >&2
  exit 1
fi

# 拍照辨識那一支 Function 的套件（ADR-0100）。它有自己的 package.json，
# 根目錄的 `npm ci` 裝不到 —— 少了它模擬器照樣起得來，只是 Functions 那一格
# 會印一長串 import 錯誤，而 E2E 的症狀是「辨識一直失敗」，看不出是這一行。
if [ ! -d functions/node_modules ]; then
  echo "functions/ 的套件還沒裝，先裝一次（npm --prefix functions ci）…" >&2
  npm --prefix functions ci --no-audit --no-fund
fi

exec npx firebase emulators:start \
  --only auth,firestore,functions,hosting \
  --project "$PROJECT"
