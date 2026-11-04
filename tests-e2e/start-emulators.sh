#!/usr/bin/env bash
# 啟動 Firebase 模擬器（Auth + Firestore + Functions + Hosting + Storage）。
#
# Storage 是療程單的照片（ADR-0105）。它的 Rules 跨服務讀 Firestore 的白名單，
# 所以兩個要一起開 —— 少了 storage 的話 app 照樣起得來，只是存療程單那一下會
# 一直轉圈（SDK 對連不上的模擬器會重試到逾時），看起來不像這一行造成的。
#
# **專案 id 用 `demo-` 開頭是刻意的。** Firebase 看到這個前綴才會進入完全離線
# 模式：任何沒被模擬到的服務會直接報錯，而不是安靜地打到真的專案上。
#
# **這個值不寫死，是算出來的。** 唯一的推導在 `public/js/firebase-config.js`
# 的 `projectIdFor()`，三邊（這裡、E2E fixture、app 自己）呼叫同一支 ——
# 以前三邊各寫一份字串，對不上時 fixture 塞進 A、app 讀 B，每個 E2E 都是
# 「畫面空的」而且沒有任何錯誤訊息。`tests/env.test.js` 會真的跑一次這條路。
#
# 這裡帶 0 ＝ 預設的那一份。Firestore 模擬器本來就一顆裝得下多個 projectId，
# 但幾個 worker 共用一顆時搶的是那一顆 Java 行程（2026-09-09 三個 worker 紅 10 支），
# 所以**平行跑的時候一個 worker 開一整組**：`E2E_WORKERS=N`，見最後那一段與
# `tests-e2e/emulator-groups.mjs`。沒設就是以前那樣：一組、平常的 port。
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

# **一個 worker 一組模擬器**（`E2E_WORKERS=N`，N 大於 1；跑 E2E 時要帶同一個值）。
# 沒設或是 1 ＝ 底下 exec 那一條，跟以前一個字都不差。
WORKERS="$(node tests-e2e/emulator-groups.mjs workers)"
if [ "$WORKERS" -le 1 ]; then
  exec npx firebase emulators:start \
    --only auth,firestore,functions,hosting,storage \
    --project "$PROJECT"
fi

# 第 k 組：port 是 `emulatorPortsFor(k)`（平常那一組的 port 一個都不用 —— 平常那一組開著也跑得起來）、
# 專案是 `projectIdFor(k)`、Hosting 只開在 0 號組。設定檔寫在專案根目錄（`firebase.json` 裡的相對路徑
# 照它算），**每組從自己的資料夾啟動**（`*-debug.log` 寫在啟動的資料夾，才不會兩組寫同一個檔）。
# **一組起好再開下一組**：同時開兩組會兩組都卡住、一個字都不印（客廳 e2e-speed 的 pitfalls.md）。
# 收掉（Ctrl+C、出錯）一律照那幾組的 port 停 —— 平常那一組的 port 不碰。
stop_groups() {
  node tests-e2e/emulator-groups.mjs stop || true
}
trap stop_groups EXIT
trap 'exit 130' INT TERM

for k in $(seq 0 $((WORKERS - 1))); do
  CONFIG="$(node tests-e2e/emulator-groups.mjs config "$k")"
  ONLY="$(node tests-e2e/emulator-groups.mjs only "$k")"
  GROUP_PROJECT="$(node tests-e2e/project-id.mjs "$k")"
  DIR=".artifacts/emulators/group-$k"
  mkdir -p "$DIR"
  LOG="$DIR/emulators.log"
  echo "開第 $k 組模擬器（$GROUP_PROJECT：$ONLY）…"
  ( cd "$DIR" && exec npx firebase emulators:start --only "$ONLY" --project "$GROUP_PROJECT" --config "$CONFIG" ) \
    > "$LOG" 2>&1 &
  PID=$!
  # 等它講「All emulators ready」。三分鐘還沒好、或行程自己結束了，就把 log 的尾巴印出來停下
  READY=""
  for _ in $(seq 1 180); do
    if grep -q "All emulators ready" "$LOG" 2>/dev/null; then READY=1; break; fi
    if ! kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if [ -z "$READY" ]; then
    echo "第 $k 組模擬器沒起來，log 的最後幾行（$LOG）：" >&2
    tail -n 30 "$LOG" >&2
    exit 1
  fi
done

echo "$WORKERS 組模擬器都起好了。跑 E2E 時帶同一個值：E2E_WORKERS=$WORKERS npm run test:e2e …（Ctrl+C 收掉全部組）"
wait
