// 讀不完整時，會動到次數或健檢那一串待辦的存檔先不存（ADR-0158，before-golive-2026-10-19/01）。
//
// 她：「沒網路的時候存檔，會收掉健檢那條鏈的待辦，而且剩幾次會少算。 好 修」。
// Firestore 開著本機快取：離線（或網路不穩到 SDK 判定離線）時 `getDocs()` 不會失敗，回的是快取裡
// 剛好有的那幾筆。`save()` 拿那一份當「這位客人的全部」去重算次數、收待辦 —— 少算、收錯。
//
// 這一支量三件事：
// 1. 擋不擋的那一支（純的）
// 2. 寫入失敗那一句與「已經存在這台裝置上了」什麼時候講（純的，`ui/saveFailure.js`）
// 3. 原始碼：每一條會動到次數或健檢鏈的寫入，commit 之前都問過那一支
//
// 瀏覽器裡真的斷線那一段在 E2E `76`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IncompleteReadError, incompleteReadSay, readsIncomplete, readSource,
} from '../public/js/domain/incompleteRead.js';
import { failureOf, slowSayNow } from '../public/js/ui/saveFailure.js';
import { notRelinkedSay } from '../public/js/domain/consequences.js';
import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

/** 一支函式的身體（從 `function 名字(` 到第一個頂格的 `}`）。找不到就丟，測試才不會安靜地過。 */
function bodyOf(src, name) {
  const start = src.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `找不到 function ${name}`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `function ${name} 沒有結尾`);
  return src.slice(start, end);
}

describe('擋不擋（readsIncomplete）', () => {
  test('每一份都是伺服器來的、也沒有離線 → 不擋', () => {
    assert.equal(readsIncomplete({ offline: false, sources: ['server', 'server'] }), false);
  });

  test('有一份是快取來的 → 擋（`navigator.onLine` 還是 true 也一樣：網路不穩時 SDK 自己退回快取）', () => {
    assert.equal(readsIncomplete({ offline: false, sources: ['server', 'cache'] }), true);
    assert.equal(readsIncomplete({ offline: false, sources: ['cache'] }), true);
  });

  test('確定離線 → 擋，不管讀回來的是什麼', () => {
    assert.equal(readsIncomplete({ offline: true, sources: ['server'] }), true);
    assert.equal(readsIncomplete({ offline: true, sources: [] }), true);
  });

  test('這一台還沒讀過這位客人的全部來訪（不知道）→ 擋：不知道就不是「全部」', () => {
    assert.equal(readsIncomplete({ offline: false, sources: [null] }), true);
    assert.equal(readsIncomplete({ offline: false, sources: [undefined] }), true);
  });

  test('沒有任何一份要問、也沒有離線 → 不擋', () => {
    assert.equal(readsIncomplete({}), false);
  });

  test('一次讀回來的 metadata → 來源（`readSource()`）', () => {
    assert.equal(readSource(true), 'cache');
    assert.equal(readSource(false), 'server');
  });
});

describe('那一句（IncompleteReadError）', () => {
  test('講得出是誰、先不存、連上再按一次；不說「已經存在這台裝置上了」', () => {
    const err = new IncompleteReadError('客戶A');
    assert.equal(err.name, 'IncompleteReadError');
    assert.match(err.message, /客戶A/);
    assert.match(err.message, /先不存/);
    assert.match(err.message, /連上之後再按一次/);
    assert.doesNotMatch(err.message, /這台裝置/);
    assert.equal(err.message, incompleteReadSay('客戶A'));
  });

  test('沒有名字時不印 undefined', () => {
    assert.doesNotMatch(incompleteReadSay(undefined), /undefined|null/);
    assert.doesNotMatch(new IncompleteReadError().message, /undefined|null/);
  });

  test('可以自己給一句（資料健檢那種不是一位客人的）', () => {
    assert.equal(new IncompleteReadError('', '換一句').message, '換一句');
  });

  test('另約健檢順便接二返：存完重讀沒讀成 → 講網路不穩，不講「別的地方改過」', () => {
    const s = notRelinkedSay({ date: '2026-10-24', name: '二返' }, [], { unread: true });
    assert.match(s, /^健檢記好了/);
    assert.match(s, /網路不穩/);
    assert.doesNotMatch(s, /別的地方改過/);
  });
});

describe('寫入失敗那一句（failureOf）', () => {
  test('讀不完整：照講那一句、不給重試（重試跑同一個閉包，手上那一份還是快取來的）', () => {
    const f = failureOf(new IncompleteReadError('客戶A'));
    assert.equal(f.retry, false);
    assert.equal(f.text, incompleteReadSay('客戶A'));
  });

  test('別的地方剛改過：不給重試（照舊）', () => {
    const err = Object.assign(new Error('剛剛在別的地方被改過，重新整理再改一次'), { name: 'StaleWriteError' });
    const f = failureOf(err);
    assert.equal(f.retry, false);
    assert.match(f.text, /^儲存失敗：剛剛在別的地方被改過/);
  });

  test('其餘的失敗：「儲存失敗：…」＋重試（照舊）', () => {
    const f = failureOf(new Error('permission-denied'));
    assert.equal(f.retry, true);
    assert.equal(f.text, '儲存失敗：permission-denied');
  });
});

describe('「已經存在這台裝置上了」什麼時候講（slowSayNow）', () => {
  test('還沒送出任何一次寫入（還在讀）→ 不講：東西還不在這台裝置上', () => {
    assert.equal(slowSayNow({ sentAtStart: 3, sentNow: 3 }), false);
  });

  test('送出去了、還沒回來 → 講（照舊）', () => {
    assert.equal(slowSayNow({ sentAtStart: 3, sentNow: 4 }), true);
  });

  test('呼叫端自己給了一句（傳照片）→ 照舊時間到就講', () => {
    assert.equal(slowSayNow({ slow: '照片還在傳', sentAtStart: 3, sentNow: 3 }), true);
  });
});

describe('原始碼：commit 之前都問過（data 層）', () => {
  const visits = read('public/js/data/visits.js');

  for (const name of ['save', 'remove', 'restore']) {
    test(`visits.${name}()：讀完、commit 之前問 guardWhole()；一進來也先問一次（確定離線就不讀了）`, () => {
      const body = bodyOf(visits, name);
      const commitAt = body.indexOf('await repo.commit(');
      const guards = [...body.matchAll(/guardWhole\(/g)].map((m) => m.index);
      assert.ok(commitAt > 0, `${name} 裡沒有 repo.commit(`);
      assert.ok(guards.length >= 2, `${name} 要問兩次 guardWhole()（一進來、commit 之前）`);
      assert.ok(guards[0] < body.indexOf('await '), `${name} 第一次 guardWhole() 要在第一個 await 之前`);
      assert.ok(guards.at(-1) < commitAt, `${name} 最後一次 guardWhole() 要在 repo.commit( 之前`);
    });
  }

  test('listByCustomer() 記下這一次是不是快取來的（寫入那幾支問的就是它）', () => {
    const body = bodyOf(visits, 'readCustomer');
    assert.match(body, /visitsRead\.set\(/);
    assert.match(bodyOf(visits, 'listByCustomer'), /readCustomer\(/);
  });

  test('健檢鏈：勾一張鏈上的待辦（chainPlans）讀不完整就丟，預覽與寫入都是', () => {
    assert.match(bodyOf(visits, 'chainPlans'), /incompleteFor\(/);
    assert.match(bodyOf(visits, 'followupOpsAfterTaskChange'), /IncompleteReadError/);
    assert.match(bodyOf(visits, 'previewTaskChange'), /IncompleteReadError/);
  });

  test('拍 Abovee 存完收掉中途長出來的（dropChainLeftovers）：讀不完整就一張都不收', () => {
    const body = bodyOf(visits, 'dropChainLeftovers');
    const check = body.search(/incompleteFor\(/);
    assert.ok(check > 0 && check < body.indexOf('repo.commit('), '要在 repo.commit( 之前問');
  });

  test('確認框讀的那兩份（chainInputs）：讀到快取的就當讀不到（少講幾句，不講錯的）', () => {
    assert.match(bodyOf(visits, 'chainInputs'), /readsIncomplete\(|incompleteFor\(/);
  });

  test('資料健檢的「重算次數」：快照是快取來的就不寫', () => {
    const health = read('public/js/data/health.js');
    assert.match(bodyOf(health, 'loadSnapshot'), /cacheReads\(\)/);
    const apply = bodyOf(health, 'applyFixes');
    const check = apply.search(/IncompleteReadError/);
    assert.ok(check > 0 && check < apply.indexOf('repo.commit('), 'applyFixes 要在 repo.commit( 之前擋 recount');
  });

  // 段四審查：設定 → 課程 存檔以前只問 `isOffline()` —— 網路不穩、SDK 退回快取時 `onLine` 還是 true，
  // 照快取裡剛好有的那幾筆算待辦，而課程本身寫在最後一個 commit：「這門課變了沒」從此是否，少算的那幾天再也補不回來
  test('課程改了「壓在哪」／「寫紀錄」重算待辦（courseTaskPlan）：讀到快取就丟，試算與寫入都是', () => {
    const body = bodyOf(visits, 'courseTaskPlan');
    assert.match(body, /incompleteFor\(|readsIncomplete\(/);
    assert.match(body, /IncompleteReadError/);
    assert.match(bodyOf(visits, 'saveCourseWithTasks'), /courseTaskPlan\(/);
  });

  test('repo 記得「讀回來的是不是快取」與「送出了幾次寫入」', () => {
    const repo = read('public/js/data/repo.js');
    assert.match(repo, /metadata\.fromCache/);
    const commit = bodyOf(repo, 'commit');
    assert.ok(commit.indexOf('sent += 1') < commit.indexOf('await batch.commit()'), '送出之前就要記');
  });
});

describe('原始碼：畫面那一側', () => {
  test('toast 用那兩支純的（不要在 toast.js 裡再判一次）', () => {
    const toast = read('public/js/ui/toast.js');
    assert.match(toast, /failureOf\(/);
    assert.match(toast, /slowSayNow\(/);
    assert.doesNotMatch(toast, /err\?\.name === 'StaleWriteError'/);
  });

  test('拍 Abovee 讀「那幾位的全部」：快取來的那一位也算讀不到（以前只問 isOffline()）', () => {
    const src = read('public/js/ui/components/aboveeConfirm.js');
    assert.match(bodyOf(src, 'loadHistory'), /listWhole\(/);
  });

  // 段四審查：簽療程單抽屜那幾句健檢鏈（`chainAfterClose()`）以前讀 `listByCustomer()` —— 讀到快取照講，
  // 而真的存的那一下拿伺服器那一份寫：講的跟發生的不一樣（ADR-0070）。讀到快取就少講那幾句
  test('簽療程單抽屜那幾句健檢鏈：讀到快取就當讀不到（listWhole／chainInputs）', () => {
    const src = read('public/js/ui/views/home.js');
    const body = bodyOf(src, 'openCloseDrawer');
    assert.match(body, /listWhole\(/);
    assert.match(body, /chainInputs\(/);
    assert.doesNotMatch(body, /listByCustomer\(/);
  });

  test('客戶詳情的「修正」次數：按下去時重讀全部（不拿打開那一刻的那一份）', () => {
    const src = read('public/js/ui/views/customerDetail.js');
    assert.match(bodyOf(src, 'fixCounts'), /listWhole\(/);
  });

  test('來訪編輯器：存與取消一段之前重讀全部（打開時讀一次就沿用的話，快取來的那一份永遠存不進去）', () => {
    const src = read('public/js/ui/views/visitEditor.js');
    assert.match(bodyOf(src, 'refreshCustomerVisits'), /listWhole\(/);
    // 打開時讀到的就是伺服器那一份（同一個陣列）才不重讀 —— 確認框不晚一拍
    assert.match(bodyOf(src, 'refreshCustomerVisits'), /isWholeList\(ctx\.customerVisits\)/);
    // 段四審查：而且這一位最近一次讀到的也是伺服器的 —— `save()` 問的是那一格（`visitsRead`），
    // 只看陣列的話，同一位被別處從快取讀過一次之後，按幾次都存不進去（兩份真相）
    assert.match(bodyOf(src, 'refreshCustomerVisits'), /lastReadWhole\(ctx\.customer\.id\)/);
    for (const name of ['submit', 'cancelOneSlot']) {
      const body = bodyOf(src, name);
      const at = body.indexOf('refreshCustomerVisits(');
      assert.ok(at > 0, `${name} 要先重讀`);
      assert.ok(at < body.indexOf('visitsData.save('), `${name} 重讀要在存之前`);
    }
  });
});
