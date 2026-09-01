// 雙環境切換的守衛。
//
// 環境是**照網址挑的**（`public/js/firebase-config.js` 的 `envOf()`），
// 因為這個專案刻意沒有 build 步驟。好處是兩個環境跑的是同一份原始碼，
// 代價是「哪個網址算哪個環境」變成一段會被改壞的程式 —— 所以它要有測試。
//
// 這一支盯三件事：
//
//   1. `envOf()` 認得出三種網址，而且**預覽頻道跟著它的專案走**
//   2. 三份 config 的 projectId 沒有互相抄錯
//   3. 模擬器那一份的 projectId 跟 `start-emulators.sh`、E2E fixture 一致 ——
//      對不上的話 app 讀到的是一個空的命名空間，畫面全空但**沒有任何錯誤**，
//      而那種症狀查起來會花掉一個下午

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { envOf, ENV, firebaseConfig, usingEmulator, envBanner } from '../public/js/firebase-config.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const CONFIG_SRC = read('public/js/firebase-config.js');
const EMULATOR_SH = read('tests-e2e/start-emulators.sh');
const E2E_FIXTURE = read('tests-e2e/fixtures/emulator.js');
const FIREBASERC = JSON.parse(read('.firebaserc'));

/** 從 config 原始碼裡把某一個環境的 projectId 挖出來。 */
function projectIdOf(env) {
  const block = new RegExp(`${env}:\\s*\\{[^}]*projectId:\\s*'([^']+)'`, 's');
  const m = block.exec(CONFIG_SRC);
  assert.ok(m, `firebase-config.js 裡找不到 ${env} 的 projectId`);
  return m[1];
}

describe('envOf()：哪個網址算哪個環境', () => {
  test('本機一律是模擬器', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'LOCALHOST']) {
      assert.equal(envOf(host), 'emulator', `${host} 應該是模擬器`);
    }
  });

  test('staging 的正式網址與預覽頻道都算 staging', () => {
    assert.equal(envOf('wellness-clinic-staging.web.app'), 'staging');
    assert.equal(envOf('wellness-clinic-staging.firebaseapp.com'), 'staging');
    // Hosting 的預覽頻道長這樣。它是 staging 專案的一個頻道，就該連 staging。
    assert.equal(envOf('wellness-clinic-staging--pr-12-a1b2c3.web.app'), 'staging');
  });

  test('正式網址與它的預覽頻道都算正式', () => {
    assert.equal(envOf('wellness-clinic-scheduler.web.app'), 'prod');
    assert.equal(envOf('wellness-clinic-scheduler.firebaseapp.com'), 'prod');
    assert.equal(envOf('wellness-clinic-scheduler--pr-9-d4e5f6.web.app'), 'prod');
  });

  test('認不得的網址退回正式 —— 但不可以退回 staging', () => {
    // 自訂網域、或她之後接上去的任何東西。退回正式的理由是不對稱：
    // 把正式認成 staging 會讓她對著一個空資料庫工作（一眼看得出來），
    // 把 staging 認成正式會讓她在真資料上做測試（看不出來）。
    // 所以「不確定」時要落在**看得出來**的那一邊。
    assert.equal(envOf('scheduler.example.com'), 'prod');
    assert.equal(envOf(''), 'prod');
    assert.equal(envOf(undefined), 'prod');
    assert.equal(envOf(null), 'prod');
  });

  test('staging 要先問 —— 兩個 id 不可以互相包含', () => {
    const staging = projectIdOf('staging');
    const prod = projectIdOf('prod');
    assert.ok(!staging.includes(prod), `${staging} 含著 ${prod}，判斷會誤判`);
    assert.ok(!prod.includes(staging), `${prod} 含著 ${staging}，判斷會誤判`);
  });
});

describe('三份 config', () => {
  test('三個環境的 projectId 各不相同', () => {
    const ids = ['prod', 'staging', 'emulator'].map(projectIdOf);
    assert.equal(new Set(ids).size, 3, `有兩個環境指到同一個專案：${ids.join(', ')}`);
  });

  test('刻意不收 measurementId —— 這個 app 不接 Analytics', () => {
    // Console 複製過來的 staging config 帶著它，很容易連著貼進去。
    // **註解不算**：那一段解釋的正是「為什麼把它拿掉」，跟 tokens.test.js
    // 的「深色沒有 @media 複本」是同一個處理方式。
    const code = CONFIG_SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      /measurementId/.test(code),
      false,
      'firebase-config.js 出現 measurementId 了 —— 那會載入 Google 的追蹤程式碼',
    );
  });

  test('.firebaserc 的別名對得上 config 裡的 projectId', () => {
    // `firebase deploy --project staging` 靠的是這份別名表。
    // 對不上的話會部署到錯的專案，而指令看起來完全正常。
    assert.equal(FIREBASERC.projects.prod, projectIdOf('prod'));
    assert.equal(FIREBASERC.projects.staging, projectIdOf('staging'));
    assert.equal(FIREBASERC.projects.default, projectIdOf('prod'),
      'default 要指到正式 —— 不帶 --project 的指令走的是它');
  });
});

describe('模擬器那一份要三邊一致', () => {
  const emulatorId = projectIdOf('emulator');

  test('是 demo- 開頭', () => {
    // Firebase 看到這個前綴才會進入完全離線模式：沒被模擬到的服務會直接報錯，
    // 而不是安靜地打到真的專案上。體檢報告 §2.7 盲區六。
    assert.match(emulatorId, /^demo-/, `模擬器的 projectId 要用 demo- 開頭，現在是 ${emulatorId}`);
  });

  test('start-emulators.sh 的 --project 跟它一樣', () => {
    // 腳本把 id 放在一個變數裡再帶進 --project，所以分兩段問：
    // id 有沒有出現，以及它有沒有真的被當成 --project 傳出去。
    assert.ok(
      EMULATOR_SH.includes(`"${emulatorId}"`) || EMULATOR_SH.includes(`'${emulatorId}'`),
      `start-emulators.sh 裡找不到 ${emulatorId}`,
    );
    assert.match(
      EMULATOR_SH,
      /--project\s+("?\$\{?PROJECT\}?"?|demo-[a-z0-9-]+)/,
      'start-emulators.sh 沒有把那個 id 當成 --project 傳出去',
    );
  });

  test('E2E fixture 的 PROJECT_ID 跟它一樣', () => {
    // 對不上的症狀特別壞：fixture 把資料塞進 A 命名空間，app 讀 B，
    // 畫面全空但沒有任何錯誤訊息。
    assert.ok(
      E2E_FIXTURE.includes(`PROJECT_ID = '${emulatorId}'`),
      `tests-e2e/fixtures/emulator.js 的 PROJECT_ID 跟 ${emulatorId} 對不上`,
    );
  });

  test('start-emulators.sh 沒有寫死某一台機器的 JAVA_HOME', () => {
    // 寫死的路徑換一台電腦或進 CI 就壞，而錯誤訊息只會說「找不到 java」。
    assert.equal(
      /JAVA_HOME="\/c\/|JAVA_HOME="C:/i.test(EMULATOR_SH),
      false,
      'start-emulators.sh 又把某一台機器的 JAVA_HOME 寫死了',
    );
  });
});

describe('在 Node 裡 import 得動', () => {
  test('沒有 location 也不會炸，而且退回正式', () => {
    // 這一支測試本身就是證明 —— import 到這裡沒有丟例外。
    assert.equal(ENV, 'prod');
    assert.equal(usingEmulator(), false);
    assert.equal(firebaseConfig.projectId, projectIdOf('prod'));
  });

  test('正式環境不畫橫幅', () => {
    assert.equal(envBanner(), null, '正式環境要一個元素都不畫');
  });
});
