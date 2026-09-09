#!/usr/bin/env node
// 把 `projectIdFor()` 印出來給 shell 用。
//
// `start-emulators.sh` 要知道「0 號 worker 的命名空間叫什麼」才開得起模擬器，
// 而 bash 沒辦法 import 一支 ES module。**它不可以自己寫死一份字串** ——
// 三邊各寫一份正是這件事以前的樣子，對不上的時候畫面全空而且沒有任何錯誤。
//
// 所以留這一支當出口：唯一的推導仍然只有 `public/js/firebase-config.js` 的
// `projectIdFor()`。`tests/env.test.js` 會**真的執行這支**，比對它跟直接呼叫
// `projectIdFor()` 給的是同一個答案 —— 那條測試才是「三邊算的是同一支」的證明。
//
//   node tests-e2e/project-id.mjs 0   → demo-scheduler
//   node tests-e2e/project-id.mjs 2   → demo-scheduler-w2

import { projectIdFor } from '../public/js/firebase-config.js';

process.stdout.write(projectIdFor(process.argv[2]));
