// 種子補六門課，外加「設定暫定」的小標（2026-10-06，issue 03）。
//
// 她的原話：
//
// > 7. 基本上我已經給你完整的課程項目清單了，很少會變，所以希望你幫我把我給你的清單項目的內容都補上去，
// > 然後可以標記我還沒決定壓那些阿之類的…
// > 第五 : 補充一點 HRV也是不算次數的，通常會是我想邀客戶來體驗送的，就會讓他當天做完HRV後然後接著功醫門診聽報告
//
// 她的清單跟種子比少五門（回測報告、HA-PRP、PRP、MOTI、運動），再加 HRV。Abovee 5～10 月那 353 筆裡
// 這五門一筆都沒有，所以每一格設定都只能猜 —— 她同意了那張表，而且要標得出「還沒決定」。
//
// 這一支盯三件事：
//
//   1. 六門課的每一格跟她同意的那張表一樣，而且存得下去
//   2. **「設定暫定」只是一個小標** —— 沒有任何規則讀它（掃原始碼）
//   3. 既有資料庫靠資料健檢補得上，三條護欄照舊

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { SEED } from '../public/js/domain/seed.js';
import {
  isProvisional, isUncounted, validate, groupOf, doctorRuleOf, picksDoctor,
} from '../public/js/domain/masterData.js';
import { systemsOf, bookingSystemOf, tasksForCourse, describeSystems } from '../public/js/domain/taskRules.js';
import { needsForm } from '../public/js/domain/visits.js';
import { slotOptionsFor, uncountedPick } from '../public/js/domain/slotOptions.js';
import { courseFrom } from '../public/js/domain/abovee.js';
import { slotName } from '../public/js/domain/naming.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { fieldLabel } from '../public/js/domain/audit.js';

const byId = (id) => SEED.courses.find((c) => c.id === id);
const NEW = ['course-retest', 'course-ha-prp', 'course-prp', 'course-moti', 'course-exercise', 'course-hrv'];
const master = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts };

describe('六門課：她同意的那張表', () => {
  test('都在種子上，名字跟她的清單一字不差', () => {
    assert.deepEqual(NEW.map((id) => byId(id)?.name), ['回測報告', 'HA-PRP', 'PRP', 'MOTI', '運動', 'HRV']);
  });

  test('分類：回測報告、HA-PRP、PRP、HRV 在醫師門診；MOTI、運動 在運動區', () => {
    assert.deepEqual(NEW.map((id) => groupOf(byId(id))),
      ['醫師門診', '醫師門診', '醫師門診', '運動區', '運動區', '醫師門診']);
  });

  test('壓哪幾個系統：回測報告三個都壓；HA-PRP、PRP、MOTI、運動 只壓 Abovee；HRV 都不用壓', () => {
    assert.deepEqual(systemsOf(byId('course-retest')), ['Abovee', 'Examine', '耀聖']);
    for (const id of ['course-ha-prp', 'course-prp', 'course-moti', 'course-exercise']) {
      assert.deepEqual(systemsOf(byId(id)), ['Abovee'], id);
      assert.deepEqual(tasksForCourse(byId(id)), [], id);
    }
    assert.deepEqual(systemsOf(byId('course-hrv')), []);
    assert.equal(bookingSystemOf(byId('course-hrv')), null);
    assert.equal(describeSystems(byId('course-hrv')), '不用壓');
  });

  test('醫師：回測報告是功能／二返那一科；HA-PRP、PRP 是復健科（照羊膜）；其餘不用', () => {
    assert.equal(doctorRuleOf(byId('course-retest')), '功能／二返');
    assert.equal(doctorRuleOf(byId('course-ha-prp')), '復健科');
    assert.equal(doctorRuleOf(byId('course-prp')), '復健科');
    for (const id of ['course-moti', 'course-exercise', 'course-hrv']) {
      assert.equal(picksDoctor(byId(id)), false, id);
    }
  });

  test('都不用指派診間或治療師；時長都是 30 分', () => {
    for (const id of NEW) {
      assert.equal(byId(id).assigns, 'none', id);
      assert.equal(byId(id).durationMin, 30, id);
    }
  });

  test('只有 HRV 不算次數、不簽療程單；其餘五門要加購才排得進去、要簽', () => {
    for (const id of NEW) {
      const hrv = id === 'course-hrv';
      assert.equal(isUncounted(byId(id)), hrv, id);
      assert.equal(needsForm(byId(id)), !hrv, id);
      assert.ok(!byId(id).needsRecord, `${id} 不寫紀錄`);
    }
  });

  test('每一門都存得下去（拿自己以外的種子課當既有的那幾筆）', () => {
    for (const id of NEW) {
      const row = byId(id);
      assert.deepEqual(validate('courses', row, SEED.courses.filter((c) => c.id !== id)), [], id);
    }
  });

  test('HRV 貼給客人的那一句是「自律神經檢查」，她自己看的還是 HRV', () => {
    const slot = { courseId: 'course-hrv', courseName: 'HRV', startsAt: '10:00', endsAt: '10:30' };
    assert.equal(slotName(slot, master, 'line'), '自律神經檢查');
    assert.match(slotName(slot, master, 'short'), /^HRV/);
  });
});

describe('排得進去嗎', () => {
  const options = (entitlements = []) => slotOptionsFor({ entitlements, ...master });
  const values = (opts) => opts.map((o) => o.entitlementId);

  test('HRV：一位什麼都沒買的客戶那一排就有它', () => {
    assert.ok(values(options()).includes(uncountedPick('course-hrv')));
  });

  test('其餘五門：沒買就沒有那一顆', () => {
    const got = JSON.stringify(options());
    for (const id of NEW.filter((x) => x !== 'course-hrv')) {
      assert.ok(!got.includes(id), `${id} 不可以出現在沒買的人那一排`);
    }
  });
});

describe('拍 Abovee 認得課程那一格', () => {
  const at = (text) => courseFrom(text, master)?.courseId ?? null;

  test('PRP 是 PRP，不是 HA-PRP；HA-PRP 是 HA-PRP', () => {
    assert.equal(at('PRP'), 'course-prp');
    assert.equal(at('HA-PRP'), 'course-ha-prp');
  });

  test('回測報告、MOTI、運動', () => {
    assert.equal(at('回測報告'), 'course-retest');
    assert.equal(at('MOTI'), 'course-moti');
    assert.equal(at('運動'), 'course-exercise');
  });

  test('原本認得的寫法一個都沒被新課名吃掉', () => {
    const SEEN = {
      復健門診: 'course-rehab', 心臟門診: 'course-cardio', 功醫門診: 'course-fm', 羊膜: 'course-amnion',
      體適能: 'course-fitness', 身體組成: 'course-inbody', 營養諮詢: 'course-nutrition-consult',
      二返30: 'course-followup', EECP20: 'course-eecp-trial', EECP60: 'course-eecp',
    };
    for (const [text, id] of Object.entries(SEEN)) assert.equal(at(text), id, text);
  });
});

describe('「設定暫定」只是一個小標', () => {
  test('只認 true', () => {
    assert.equal(isProvisional({ provisional: true }), true);
    for (const v of [false, 'true', 1, null, undefined]) assert.equal(isProvisional({ provisional: v }), false);
    assert.equal(isProvisional(null), false);
  });

  test('新的六門都標著；原本的課一門都沒有', () => {
    for (const c of SEED.courses) assert.equal(isProvisional(c), NEW.includes(c.id), c.name);
  });

  test('驗證：有這一格就要是布林', () => {
    const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };
    assert.deepEqual(validate('courses', { ...ok, provisional: true }), []);
    assert.deepEqual(validate('courses', { ...ok, provisional: false }), []);
    assert.deepEqual(validate('courses', { ...ok }), []);
    assert.ok(validate('courses', { ...ok, provisional: 'true' }).some((e) => e.includes('設定暫定')));
  });

  test('稽核不印英文欄位名', () => {
    assert.equal(fieldLabel('provisional'), '設定暫定');
  });

  // 這一行會不會讓「設定暫定」變成一條規則？排得進去、扣得到、長得出待辦，跟沒有這一格一模一樣。
  test('domain 裡只有 masterData.js 問這一格；畫面只有設定頁', () => {
    const ROOT = new URL('../public/js/', import.meta.url);
    const files = (dir) => readdirSync(new URL(dir, ROOT), { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? files(`${dir}${d.name}/`) : [`${dir}${d.name}`]))
      .filter((f) => f.endsWith('.js'));
    const readers = files('').filter((f) => /\.provisional\b|\bisProvisional\(/.test(
      readFileSync(new URL(f, ROOT), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
    ));
    assert.deepEqual(readers.sort(), ['domain/masterData.js', 'ui/views/masterList.js']);
  });

  test('字是「設定暫定」，不是來訪的狀態「待確認」', () => {
    const src = readFileSync(new URL('../public/js/ui/views/masterList.js', import.meta.url), 'utf8');
    assert.match(src, /設定暫定/);
    assert.match(src, /門的設定是暫定的/);
  });
});

describe('既有資料庫：資料健檢補得上（`loadSeed()` 只建不覆蓋）', () => {
  const TODAY = '2026-10-06';
  const old = SEED.courses.filter((c) => !NEW.includes(c.id));
  const run = (courses) => runHealthCheck({
    customers: [], entitlements: [], visits: [], tasks: [], availability: [],
    master: { ...SEED, courses },
  }, TODAY).checks.find((c) => c.id === 'seedCourse').findings;

  test('少的六門各一列，建出來的那一筆整筆照抄種子（帶著暫定、不算次數、不用壓）', () => {
    const rows = run(old);
    assert.deepEqual(rows.map((f) => f.fix.courseId).sort(), [...NEW].sort());
    for (const f of rows) {
      assert.equal(f.fix.kind, 'addCourse');
      assert.equal(f.fix.data.provisional, true, f.title);
      assert.deepEqual(validate('courses', f.fix.data, old), [], `${f.title} 補上去要存得下去`);
    }
    const hrv = rows.find((f) => f.fix.courseId === 'course-hrv').fix.data;
    assert.equal(hrv.uncounted, true);
    assert.deepEqual(hrv.systems, []);
  });

  test('她自己已經建了一門「PRP」：不再建第二門', () => {
    const rows = run([...old, { id: 'her-own', name: 'PRP', durationMin: 30, assigns: 'none' }]);
    assert.ok(!rows.some((f) => f.fix.courseId === 'course-prp'));
    assert.equal(rows.length, 5);
  });

  test('都有了就一列都不報', () => {
    assert.deepEqual(run(SEED.courses), []);
  });
});
