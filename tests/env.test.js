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
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  envOf, ENV, firebaseConfig, usingEmulator, envBanner, projectIdFor, authDomainFor,
  emulatorPortsFor, emulatorPorts, MAX_EMULATOR_SLOTS,
} from '../public/js/firebase-config.js';
import {
  groupConfig, portSlotFor, servicesFor, workersFrom,
} from '../tests-e2e/emulator-groups.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const CONFIG_SRC = read('public/js/firebase-config.js');
const EMULATOR_SH = read('tests-e2e/start-emulators.sh');
const E2E_FIXTURE = read('tests-e2e/fixtures/emulator.js');
const FIREBASERC = JSON.parse(read('.firebaserc'));
const FIREBASE_JSON = JSON.parse(read('firebase.json'));
const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 把註解拿掉再問 —— 註解裡出現的字串不算數（見底下 measurementId 那一條）。 */
const codeOf = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 拿掉註解**整行**（`//`、`/*`、` *` 開頭的）。找寫死的 port 不能用 `codeOf()`：它把 `//` 之後當註解，
 * `'http://127.0.0.1:5000'` 會連著被吃掉，於是最常見的那種寫法永遠掃不到。
 */
const withoutCommentLines = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');

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
    // **預設是 staging，不是正式**（2026-10-08，prelaunch-fixes-2026-10-08/issues/04）。
    // 以前這一條釘著相反的事（「不帶 --project 的指令走的是它，所以要指到正式」）——
    // 而那正是問題：拍照的 Function 不歸 CI 部署，從本機部署時漏打一次 `--project` 就直接上正式。
    // 現在漏打的下場是上 staging。要上正式的每一條指令自己帶著 `--project prod`
    // （`tests/deploy-config.test.js` 盯著 repo 裡沒有任何一條靠預設值）。
    assert.equal(FIREBASERC.projects.default, projectIdOf('staging'),
      'default 要指到 staging —— 漏打 --project 的指令不可以落在正式站上');
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

describe('模擬器的 port：一個 worker 一組時三邊算的也是同一支（emulatorPortsFor）', () => {
  // 跟 projectIdFor() 同一個理由：app、E2E fixture、start-emulators.sh（經 emulator-groups.mjs
  // 寫每一組的設定檔）三邊一定要算出同一組 port。對不上的症狀是登入按鈕等不到、或畫面全空，
  // 看不出是哪一行。

  const SERVICES = ['auth', 'firestore', 'functions', 'hosting', 'storage'];

  test('組號沒給 ＝ 平常那一組，跟 firebase.json 寫的一樣', () => {
    // 手動開 app、E2E_WORKERS 沒設的 E2E 走的都是這條 —— 預設的行為一個 port 都不能變
    for (const none of [undefined, null, '', '  ']) {
      const p = emulatorPortsFor(none);
      for (const s of SERVICES) {
        assert.equal(p[s], FIREBASE_JSON.emulators[s].port, `${s} 的平常 port 跟 firebase.json 對不上`);
      }
    }
    assert.deepEqual(emulatorPorts, emulatorPortsFor(undefined), 'node 裡沒有 __E2E_PORT_SLOT，應該是平常那一組');
  });

  test('每一組的每一個 port 都不撞：組內、組間、跟平常那一組都不撞', () => {
    const normal = new Set(Object.values(emulatorPortsFor(undefined)));
    const seen = new Map();
    for (let k = 0; k < MAX_EMULATOR_SLOTS; k += 1) {
      for (const [name, port] of Object.entries(emulatorPortsFor(k))) {
        assert.ok(!normal.has(port), `第 ${k} 組的 ${name}（${port}）撞到平常那一組 —— 平常的模擬器開著就跑不起來`);
        assert.ok(!seen.has(port), `第 ${k} 組的 ${name}（${port}）跟 ${seen.get(port)} 撞在一起`);
        seen.set(port, `第 ${k} 組的 ${name}`);
      }
    }
  });

  test('認不得的組號丟例外 —— 不猜一組出來', () => {
    for (const bad of [-1, 1.5, MAX_EMULATOR_SLOTS, 'abc', NaN, {}]) {
      assert.throws(() => emulatorPortsFor(bad), /組號/, `${String(bad)} 應該丟例外`);
    }
  });

  test('字串跟數字給同一個答案', () => {
    for (const k of [0, 1, 3]) assert.deepEqual(emulatorPortsFor(String(k)), emulatorPortsFor(k));
  });

  test('E2E_WORKERS：沒設是 1，打錯一個字就丟例外', () => {
    for (const none of [undefined, null, '', ' ']) assert.equal(workersFrom(none), 1);
    assert.equal(workersFrom('1'), 1);
    assert.equal(workersFrom('3'), 3);
    for (const bad of ['0', '-2', '2.5', 'two', String(MAX_EMULATOR_SLOTS + 1)]) {
      assert.throws(() => workersFrom(bad), /E2E_WORKERS/, `${bad} 應該丟例外`);
    }
  });

  test('只有 E2E_WORKERS 大於 1 才分組；分組時組號就是 TEST_PARALLEL_INDEX', () => {
    assert.equal(portSlotFor(undefined, '0'), null, '沒設 E2E_WORKERS 時一律平常那一組');
    assert.equal(portSlotFor('1', '0'), null);
    assert.equal(portSlotFor('2', '1'), '1');
    assert.equal(portSlotFor('2', undefined), '0');
  });

  test('第 k 組的設定檔：port 照 emulatorPortsFor(k)、Hosting 只在 0 號組、其餘照抄 firebase.json', () => {
    for (const k of [0, 1, 2]) {
      const cfg = groupConfig(FIREBASE_JSON, k);
      const p = emulatorPortsFor(k);
      assert.equal(cfg.emulators.auth.port, p.auth);
      assert.equal(cfg.emulators.firestore.port, p.firestore);
      assert.equal(cfg.emulators.firestore.websocketPort, p.websocket);
      assert.equal(cfg.emulators.functions.port, p.functions);
      assert.equal(cfg.emulators.storage.port, p.storage);
      assert.equal(cfg.emulators.hub.port, p.hub);
      assert.equal(cfg.emulators.logging.port, p.logging);
      assert.equal(cfg.emulators.ui.enabled, false);
      assert.equal(Boolean(cfg.emulators.hosting), k === 0, `第 ${k} 組的 Hosting 開關不對`);
      assert.equal(servicesFor(k).includes('hosting'), k === 0);
      for (const key of Object.keys(FIREBASE_JSON).filter((x) => x !== 'emulators')) {
        assert.deepEqual(cfg[key], FIREBASE_JSON[key], `第 ${k} 組的 ${key} 沒有照抄 firebase.json`);
      }
    }
  });

  test('**真的跑一次** shell 那條路：workers 與 only 跟直接呼叫給同一個答案', () => {
    const run = (args, env = {}) => execFileSync(
      process.execPath,
      ['tests-e2e/emulator-groups.mjs', ...args],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, E2E_WORKERS: '', ...env } },
    );
    assert.equal(run(['workers']), '1', 'E2E_WORKERS 沒設時 shell 那條路要回 1（走以前那一條 exec）');
    assert.equal(run(['workers'], { E2E_WORKERS: '3' }), '3');
    assert.equal(run(['only', '0']), servicesFor(0).join(','));
    assert.equal(run(['only', '1']), servicesFor(1).join(','));
  });

  test('app 那三支連模擬器的地方讀 emulatorPorts，不寫死 port', () => {
    for (const rel of ['public/js/data/firebase.js', 'public/js/data/ai.js', 'public/js/data/treatmentSheets.js']) {
      const code = withoutCommentLines(read(rel));
      assert.equal(/127\.0\.0\.1'?,?\s*:?\s*(9099|8080|5001|9199|5000)\b/.test(code), false, `${rel} 又寫死了模擬器的 port`);
      assert.match(code, /emulatorPorts\./, `${rel} 要讀 firebase-config.js 的 emulatorPorts`);
    }
  });

  test('E2E 的 fixture 與 spec 沒有寫死模擬器的 port（除了 Rules 測試，它有自己的一組）', () => {
    const dirs = ['tests-e2e/fixtures', 'tests-e2e/fixtures/ai', 'tests-e2e/specs'];
    const files = dirs.flatMap((d) => readdirSync(new URL(`../${d}`, import.meta.url))
      .filter((f) => f.endsWith('.js'))
      .map((f) => `${d}/${f}`));
    // 兩種寫法都算：字串裡的 `127.0.0.1:5000`、regex 字面值裡的 `127\.0\.0\.1:5000`（81 的 P4 漏過一次）
    const hardcoded = /127\\?\.0\\?\.0\\?\.1:(9099|8080|5001|9199|5000)\b/;
    const hits = files.filter((rel) => hardcoded.test(withoutCommentLines(read(rel))));
    assert.deepEqual(hits, [], `這幾支寫死了模擬器的 port，一個 worker 一組時會連到平常那一組：${hits.join(', ')}`);
    assert.match(codeOf(E2E_FIXTURE), /PORTS = emulatorPortsFor\(/, 'fixture 的 PORTS 要用 emulatorPortsFor() 算');
  });

  test('start-emulators.sh：沒設 E2E_WORKERS 走以前那一條，分組時照 emulator-groups.mjs 一組一組開', () => {
    assert.match(EMULATOR_SH, /WORKERS="\$\(node tests-e2e\/emulator-groups\.mjs workers\)"/);
    assert.match(EMULATOR_SH, /node tests-e2e\/emulator-groups\.mjs config "\$k"/);
    assert.match(EMULATOR_SH, /node tests-e2e\/project-id\.mjs "\$k"/, '每一組的 --project 要是 projectIdFor(k)');
    assert.match(EMULATOR_SH, /All emulators ready/, '要等一組起好再開下一組');
    assert.match(EMULATOR_SH, /emulator-groups\.mjs stop/, '收掉時要照那幾組的 port 停');
  });
});

describe('authDomainFor()：登入走哪一個網域（ADR-0168）', () => {
  test('開在自己的網址上就用同一個網址 —— iPad 主畫面那一顆才登得進去', () => {
    assert.equal(authDomainFor('prod', 'wellness-clinic-scheduler.web.app'), 'wellness-clinic-scheduler.web.app');
    assert.equal(authDomainFor('staging', 'wellness-clinic-staging.web.app'), 'wellness-clinic-staging.web.app');
    assert.equal(authDomainFor('staging', 'Wellness-Clinic-Staging.web.app'), 'wellness-clinic-staging.web.app');
    assert.equal(
      authDomainFor('prod', 'wellness-clinic-scheduler.firebaseapp.com'),
      'wellness-clinic-scheduler.firebaseapp.com',
    );
  });

  test('預覽頻道與認不得的網址退回 firebaseapp.com（重新導向 URI 登記不完）', () => {
    assert.equal(
      authDomainFor('prod', 'wellness-clinic-scheduler--pr-12-a1b2c3.web.app'),
      'wellness-clinic-scheduler.firebaseapp.com',
    );
    assert.equal(authDomainFor('prod', ''), 'wellness-clinic-scheduler.firebaseapp.com');
    assert.equal(authDomainFor('prod', 'example.com'), 'wellness-clinic-scheduler.firebaseapp.com');
  });

  test('不會拿另一個專案的網址當自己的', () => {
    assert.equal(
      authDomainFor('prod', 'wellness-clinic-staging.web.app'),
      'wellness-clinic-scheduler.firebaseapp.com',
    );
  });

  test('模擬器照舊', () => {
    assert.equal(authDomainFor('emulator', '127.0.0.1'), 'localhost');
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
