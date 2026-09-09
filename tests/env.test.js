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
//   3. 模擬器那一份的 projectId **三邊算的是同一支推導**（`projectIdFor()`）——
//      對不上的話 app 讀到的是一個空的命名空間，畫面全空但**沒有任何錯誤**，
//      而那種症狀查起來會花掉一個下午

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  envOf, ENV, firebaseConfig, usingEmulator, envBanner, projectIdFor,
} from '../public/js/firebase-config.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const CONFIG_SRC = read('public/js/firebase-config.js');
const EMULATOR_SH = read('tests-e2e/start-emulators.sh');
const E2E_FIXTURE = read('tests-e2e/fixtures/emulator.js');
const FIREBASERC = JSON.parse(read('.firebaserc'));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 把註解拿掉再問 —— 註解裡出現的字串不算數（見底下 measurementId 那一條）。 */
const codeOf = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

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
    // 模擬器那一份**不再是寫死的字串**（一個 worker 一個命名空間），
    // 所以它要用同一支推導算出來，不能再從原始碼挖。
    const ids = [projectIdOf('prod'), projectIdOf('staging'), projectIdFor(0)];
    assert.equal(new Set(ids).size, 3, `有兩個環境指到同一個專案：${ids.join(', ')}`);
  });

  test('刻意不收 measurementId —— 這個 app 不接 Analytics', () => {
    // Console 複製過來的 staging config 帶著它，很容易連著貼進去。
    // **註解不算**：那一段解釋的正是「為什麼把它拿掉」，跟 tokens.test.js
    // 的「深色沒有 @media 複本」是同一個處理方式。
    const code = codeOf(CONFIG_SRC);
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

describe('模擬器的命名空間：三邊算的是同一支推導', () => {
  // 以前這裡盯的是「三個字串相等」。那擋得住手滑改錯一邊，但擋不住
  // **一個 worker 一個命名空間** —— 那時候三邊的值本來就不再是同一個字串。
  //
  // 所以改成盯**推導**：三邊都呼叫 `projectIdFor()`，而且同樣的輸入
  // 給同樣的輸出。有這一支在，對不上會直接紅 —— 不用從「畫面空的」
  // 開始猜，而猜著猜著就會加一層「先等兩秒再試」那種補丁。

  test('0 號回 base，而且是 demo- 開頭', () => {
    // Firebase 看到這個前綴才會進入完全離線模式：沒被模擬到的服務會直接報錯，
    // 而不是安靜地打到真的專案上。體檢報告 §2.7 盲區六。
    const base = projectIdFor(0);
    assert.match(base, /^demo-/, `模擬器的 projectId 要用 demo- 開頭，現在是 ${base}`);
  });

  test('每一號 worker 各自一個命名空間，而且都是 demo- 開頭', () => {
    // 撞在一起 = 兩個 worker 共用一份 Firestore = 互相洗掉對方的資料，
    // 而症狀是隨機幾支「畫面空的」，看起來像 flaky。
    const ids = [0, 1, 2, 3, 4, 5, 6, 7].map(projectIdFor);
    assert.equal(new Set(ids).size, ids.length, `有兩號 worker 指到同一個命名空間：${ids.join(', ')}`);
    for (const id of ids) assert.match(id, /^demo-/, `${id} 不是 demo- 開頭`);
  });

  test('認不得的輸入一律退回 base —— 不要猜一個新的命名空間出來', () => {
    // 猜一個出來，就是製造那個沒有任何線索的空白畫面。
    // `''` 與 `undefined` 是真的會發生的：環境變數沒設、shell 沒帶參數。
    const base = projectIdFor(0);
    for (const bad of [undefined, null, '', '  ', 'abc', -1, 1.5, NaN, {}]) {
      assert.equal(projectIdFor(bad), base, `${String(bad)} 應該退回 ${base}`);
    }
  });

  test('字串跟數字給同一個答案', () => {
    // shell 那條路拿到的是 argv（字串），fixture 拿到的是環境變數（也是字串），
    // 而測試裡是數字。三邊算出來的一定要一樣。
    for (const n of [0, 1, 2, 3]) {
      assert.equal(projectIdFor(String(n)), projectIdFor(n), `'${n}' 跟 ${n} 算出不同答案`);
    }
  });

  test('同一個輸入永遠同一個輸出', () => {
    // 純函式。帶時間戳或亂數進去的話，app 跟 fixture 會各自算到不同的命名空間。
    assert.equal(projectIdFor(2), projectIdFor(2));
    assert.equal(projectIdFor(2), 'demo-scheduler-w2');
  });

  test('app 那一份是算出來的，不是寫死的字串', () => {
    const code = codeOf(CONFIG_SRC);
    assert.match(
      code,
      /projectId:\s*projectIdFor\(/,
      'firebase-config.js 的 emulator config 要呼叫 projectIdFor()',
    );
    assert.equal(
      /projectId:\s*'demo-/.test(code),
      false,
      'firebase-config.js 又把模擬器的 projectId 寫死了 —— 那樣 worker 1 以後會去讀 0 號的資料',
    );
  });

  test('E2E fixture 也是 import 同一支算的', () => {
    const code = codeOf(E2E_FIXTURE);
    assert.match(
      code,
      /import \{[^}]*\bprojectIdFor\b[^}]*\} from '\.\.\/\.\.\/public\/js\/firebase-config\.js'/,
      'tests-e2e/fixtures/emulator.js 要 import firebase-config.js 的 projectIdFor()',
    );
    assert.match(code, /PROJECT_ID = projectIdFor\(/, 'PROJECT_ID 要用 projectIdFor() 算');
    assert.equal(
      /'demo-/.test(code),
      false,
      'tests-e2e/fixtures/emulator.js 又寫死了一份 demo- 字串',
    );
  });

  test('start-emulators.sh 的 --project 也是算出來的', () => {
    assert.equal(
      /demo-/.test(EMULATOR_SH.replace(/^#[^\n]*$/gm, '')),
      false,
      'start-emulators.sh 又把命名空間寫死了',
    );
    assert.match(
      EMULATOR_SH,
      /PROJECT="\$\(node tests-e2e\/project-id\.mjs 0\)"/,
      'start-emulators.sh 要從 tests-e2e/project-id.mjs 拿 0 號的命名空間',
    );
    assert.match(
      EMULATOR_SH,
      /--project\s+"\$\{?PROJECT\}?"/,
      'start-emulators.sh 沒有把算出來的值當成 --project 傳出去',
    );
  });

  test('**真的跑一次** shell 那條路：它跟 projectIdFor() 給同一個答案', () => {
    // 這一條才是「三邊算的是同一支」的證明 —— 上面那幾條讀的是原始碼，
    // 讀得到 `projectIdFor(` 不代表它真的接得起來（import 路徑打錯、
    // 檔案被搬走、export 改名都讀不出來）。所以這裡真的執行 shell 用的那條路。
    for (const n of [0, 1, 3]) {
      const out = execFileSync(
        process.execPath,
        ['tests-e2e/project-id.mjs', String(n)],
        { cwd: ROOT, encoding: 'utf8' },
      );
      assert.equal(out, projectIdFor(n), `shell 那條路算 ${n} 號算出 ${out}，跟 projectIdFor() 對不上`);
    }
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
