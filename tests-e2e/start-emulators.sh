#!/usr/bin/env bash
# 啟動 Firebase 模擬器（Auth + Firestore + Hosting）。
# Java 是 winget 剛裝的，目前的 shell 還沒吃到新的 PATH，所以在這裡補上。
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot"
export PATH="$JAVA_HOME/bin:$PATH"
cd "$(dirname "$0")/.."
exec npx firebase emulators:start \
  --only auth,firestore,hosting \
  --project wellness-clinic-scheduler
