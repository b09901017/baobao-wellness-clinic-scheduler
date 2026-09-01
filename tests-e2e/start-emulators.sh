#!/usr/bin/env bash
# 啟動 Firebase 模擬器（Auth + Firestore + Hosting）。
#
# **專案 id 用 `demo-` 開頭是刻意的。** Firebase 看到這個前綴才會進入完全離線
# 模式：任何沒被模擬到的服務會直接報錯，而不是安靜地打到真的專案上。
# 這個值要跟 `public/js/firebase-config.js` 的 emulator config 與
# `tests-e2e/fixtures/emulator.js` 的 PROJECT_ID 一致，`tests/env.test.js` 盯著。
set -euo pipefail

PROJECT="demo-scheduler"

# Java 找不到才提示，**不要寫死某一台機器的路徑** —— 那樣換一台電腦或進 CI
# 就壞，而錯誤訊息只會說「找不到 java」，看不出是這一行造成的。
# 裝好 JDK 之後如果這個 shell 還沒吃到新的 PATH，自己 export JAVA_HOME 再跑。
if ! command -v java >/dev/null 2>&1; then
  echo "找不到 java —— Firebase 的 Firestore 模擬器需要 JDK 11 以上。" >&2
  echo "裝好之後如果這個 shell 還沒吃到新的 PATH，先 export JAVA_HOME 再跑一次。" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
exec npx firebase emulators:start \
  --only auth,firestore,hosting \
  --project "$PROJECT"
