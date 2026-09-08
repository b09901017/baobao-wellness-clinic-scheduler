// 「絕對不能進版控的東西」的最後一道防線。SPEC.md 第 10 節。
//
// 兩種東西，同一個理由：**一旦 commit 過，就算之後刪掉也留在 git 歷史裡。**
//
// 1. **服務帳號金鑰** —— 繞過所有 Security Rules，這個專案唯一的萬能鑰匙。
// 2. **真實客戶姓名** —— 資料含健康資訊，而她的客戶沒有同意過被寫進一個
//    程式碼倉庫裡。2026-08-20 掃出六個檔案裡有七處真名（全部是註解與文件裡
//    的例子），見 .scratch/pii-in-repo/issues/01。
//
// .gitignore 靠檔名比對，換個檔名就漏了。這裡一律看內容。
//
// ## 2026-09-08 又漏了一次，而且形狀不一樣
//
// 她貼了一則訊息示範日曆那一格要怎麼寫，裡面帶著一位真實客戶的名字。
// 那一行被照抄進**五個**檔案 —— 兩處 `domain/naming.js` 的註解、一支測試、
// 一份 issue，以及 **`ui/views/masterList.js` 裡真的會出貨的欄位說明**。
//
// **下面三條檢查一條都沒有紅**：名字沒有黏著數字（第二條的形狀），而第三條
// 需要 `.local/aliases.json`，CI 上沒有那份檔案。
//
// **沒有補第四條形狀檢查是刻意的** —— 這一支自己在下面論證過了：中文姓名
// 沒有可靠的形狀，掃出來的誤判遠多過真名，而紅個兩次就會被關掉。所以真正
// 的防線仍然是那份別名表，而它只在她自己的機器上跑得到。
//
// **實務上的意思：她自己的機器上要跑過一次 `npm test` 才算掃過。**
// 下面那條測試跳過的時候會把這句話印出來。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const ROOT = fromRoot();

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

// 服務帳號 JSON 一定同時有這幾個欄位；PEM 開頭則涵蓋任何貼進來的私鑰。
const MARKERS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"type"\s*:\s*"service_account"/,
  /"private_key_id"\s*:/,
];

test('沒有任何被追蹤的檔案含有私鑰或服務帳號憑證', () => {
  const offenders = [];

  for (const rel of trackedFiles()) {
    const full = ROOT + rel;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // 已刪除但還在索引裡
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;

    const src = readFileSync(full, 'utf8');
    // 這個測試檔自己寫著那些字串，要排除掉，否則永遠是紅的
    if (rel === 'tests/no-secrets.test.js') continue;

    for (const marker of MARKERS) {
      if (marker.test(src)) {
        offenders.push(`${rel}（符合 ${marker}）`);
        break;
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `這些檔案看起來含有金鑰，絕對不能進版控：\n${offenders.join('\n')}`,
  );
});


// ---------- 真實客戶姓名 ----------

/**
 * 洩漏的形狀：**中文字直接黏著 2–4 位數字**。
 *
 * 舊試算表的 A2 就長這樣（`名字3157`，數字是病歷編號），而被 commit 進來的
 * 那幾處正是照抄了真的那一格。
 *
 * **為什麼不掃「像不像人名」**：中文姓名沒有可靠的形狀。實測拿一百多個姓氏
 * 開頭去掃整個 repo，誤判的是「一張卡」「任何東西」「高能量雷射」「顏色」
 * 這種一般詞彙，數量遠多過真名 —— 那種測試紅個兩次就會被關掉，等於沒有。
 *
 * 黏著數字這一個形狀掃出來只有下面這幾種詞，所以它紅的時候幾乎一定是真的。
 */
const GLUED_TO_DIGITS = /([\u4e00-\u9fff]{2,4})(?=[0-9]{2,4})/g;

// 匿名慣例（名字、客戶A）、診間、購買通路，以及文件裡用的假名。
// 要加東西進來之前先確定它不是某個真的人。
const NOT_A_NAME = new Set([
  '名字', '客戶', '點滴', '點滴室', '治療室',
  '顧客會', '導客',
  '王小明', '王小名', '王陳小明',
  // 引用她原話時會黏到月份：「寫 9月壓表 或是10月壓表這樣」。
  // 連接詞不可能是人名，而照抄原話比為了測試改她的字重要。
  '或是', '還是', '大概', '差不多',
  // 她從 LINE 貼過來的那份筆記裡的「提早10分，來檢查房間」。
  // 動詞不可能是人名，而那一段是 domain/lineText.js 的主要測資，
  // 改掉它等於那支測試就不再測她真的會貼的東西了。
  '提早', '提前', '休息',
  // 引用她講復能的原話時，數字緊接在動詞或連接詞後面：
  //「然後是60分鐘」「然後要能選30分鐘或是60分鐘的」「接者選幾分鐘30或60」。
  // 照抄原話比為了測試改她的字重要（同上面那兩條的理由）。
  '然後是', '後要能選', '分鐘或是', '選幾分鐘', '後可以選',
]);

test('沒有任何被追蹤的檔案帶著「姓名黏著病歷編號」的字串', () => {
  const offenders = [];

  for (const rel of trackedFiles()) {
    if (rel === 'tests/no-secrets.test.js') continue; // 白名單寫在這裡

    const full = ROOT + rel;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;

    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(GLUED_TO_DIGITS)) {
        if (!NOT_A_NAME.has(m[1])) offenders.push(`${rel}:${i + 1}　「${m[1]}」後面接著數字`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    '這看起來像舊試算表 A2 的「姓名＋病歷編號」，換成假名（例：王小明3157）：\n'
      + `${offenders.join('\n')}\n`
      + '確定它不是人名的話，加進 no-secrets.test.js 的 NOT_A_NAME。',
  );
});

/**
 * 真的那份名單在 `.local/aliases.json`（gitignore，見 .gitignore 最後一段）。
 *
 * **測試本身一個真名都不能寫** —— 那樣等於為了防止 commit 真名而 commit 一次真名。
 * 所以改成：有那份檔案的機器上才驗得到，沒有就跳過並講清楚為什麼。
 * 上面那條形狀檢查不需要名單，兩條是互補的，不是二選一。
 */
test('別名表裡的真名沒有出現在任何被追蹤的檔案裡', (t) => {
  const aliases = `${ROOT}.local/aliases.json`;
  if (!existsSync(aliases)) {
    // **這是三條裡唯一擋得住 2026-09-08 那種外洩的**（名字沒有黏著數字，
    // 上面那條形狀檢查看不到它）。所以跳過的時候要把話講完整 ——
    // 一句「skipped」會讓人以為掃過了。
    t.skip('.local/aliases.json 不在這台機器上（它刻意不進版控），'
      + '所以「真名有沒有進版控」這一條這次沒有掃。'
      + '2026-09-08 那次外洩就是這條沒跑到 —— 出貨的 UI 文案裡帶著一位真實客戶的名字。'
      + '要驗它：把那份別名表放到 .local/ 底下再跑一次 npm test。');
    return;
  }

  let names;
  try {
    const { nicknames = {} } = JSON.parse(readFileSync(aliases, 'utf8'));
    // 全名與行事曆上的叫法都要擋。只寫一個字的（`陳`、`際`）不掃 ——
    // 單字在中文裡到處都是，掃了只會得到一頁誤判。
    names = [...new Set([...Object.keys(nicknames), ...Object.values(nicknames).flat()])]
      .filter((n) => typeof n === 'string' && n.trim().length >= 2)
      .map((n) => n.trim());
  } catch (err) {
    // 讀不動就講出來，不要靜靜地變成綠燈 —— 那比沒有這條測試更糟。
    assert.fail(`.local/aliases.json 讀不動：${err.message}`);
  }

  const offenders = [];
  for (const rel of trackedFiles()) {
    const full = ROOT + rel;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;

    const src = readFileSync(full, 'utf8');
    // 命中哪一個名字不印出來 —— 這行字會進 CI 的 log
    const hit = names.filter((n) => src.includes(n)).length;
    if (hit) offenders.push(`${rel}（命中 ${hit} 個）`);
  }

  assert.deepEqual(
    offenders,
    [],
    `這些檔案裡有別名表上的真名，換成假名或「客戶A」：\n${offenders.join('\n')}`,
  );
});
