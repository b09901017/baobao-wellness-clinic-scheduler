// 治療師與醫師補齊、科別（2026-10-06，issue 04）。
//
// 她的原話：
//
// > …以及醫師也可以都補上去，也幫我把李夏許的名子補齊全，或是補在abovee的寫法那邊
// > 問題 3：如果無法判斷的就先放入都可以
// > 問題 4：同意公開
//
// 她 10/5 給的 Abovee 服務資源清單：醫師 8 位、治療師 13 位，種子少治療師 4 位、醫師 5 位。
// **全名不進 repo**：`staffFrom()` 認人靠「治療師的名字是全名的結尾、醫師的姓是全名的開頭」，
// 所以種子照既有那 12 位的寫法放就認得 —— 這一支的例子一律是假名。
// **新的那九位的「全名」一律寫成 `某＋名字`／`姓＋某`**：隨手編一個看起來像樣的全名，
// 編到的可能就是真的那一位（寫這一支的時候就編中了兩個，是她機器上的全名掃描抓到的）。
//
// 盯三件事：
//
//   1. 這一行會不會讓兩位不同的人被認成同一位，或讓本來認得的人變成認不得？
//   2. 那一科剛好一位就先選好（宋、簡），二返那一排前面是功能／二返那一科
//   3. 既有資料庫靠資料健檢補得上，而且**只按建新醫師那一顆時不可以更糟**

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SEED } from '../public/js/domain/seed.js';
import {
  validate, doctorChoicesFor, staffWithRole, DOCTOR_ROLE, THERAPIST_ROLE,
} from '../public/js/domain/masterData.js';
import { staffFrom } from '../public/js/domain/abovee.js';
import { runHealthCheck, CHECKS } from '../public/js/domain/health.js';

const TODAY = '2026-10-06';
const byId = (id) => SEED.staff.find((s) => s.id === id);
const course = (id) => SEED.courses.find((c) => c.id === id);
const names = (rows) => rows.map((s) => s.name);

const OLD_IDS = ['staff-tw', 'staff-zn', 'staff-lulu', 'staff-xy', 'staff-gy', 'staff-zx', 'staff-yt', 'staff-py', 'staff-wt',
  'staff-dr-xia', 'staff-dr-xu', 'staff-dr-li'];
const NEW_THERAPISTS = ['staff-pr', 'staff-yr', 'staff-yz', 'staff-yl'];
const NEW_DOCTORS = ['staff-dr-song', 'staff-dr-jian', 'staff-dr-zhang-ya', 'staff-dr-zhang-zheng', 'staff-dr-lin'];

describe('種子：13 位治療師、8 位醫師', () => {
  test('人數與名字', () => {
    assert.equal(staffWithRole(SEED.staff, THERAPIST_ROLE).length, 13);
    assert.equal(staffWithRole(SEED.staff, DOCTOR_ROLE).length, 8);
    assert.deepEqual(NEW_THERAPISTS.map((id) => byId(id)?.name), ['佩茹', '瑜如', '郁真', '依琳']);
    assert.deepEqual(NEW_DOCTORS.map((id) => byId(id)?.name), ['宋', '簡', '張雅', '張正', '林']);
    assert.equal(new Set(SEED.staff.map((s) => s.id)).size, SEED.staff.length, 'id 不重複');
    assert.equal(new Set(names(SEED.staff)).size, SEED.staff.length, '名字不重複');
  });

  test('原本那 12 位的 id 與名字一個字都沒變', () => {
    assert.deepEqual(names(OLD_IDS.map(byId)),
      ['騰崴', '芝寧', 'LuLu', '欣穎', '耕宇', '姿璇', '怡婷', '珮喩', '王婷', '夏', '許', '李']);
  });

  test('科別：夏、許、李、兩位張是功能／二返；宋復健科；簡心臟科；林不填', () => {
    for (const id of ['staff-dr-xia', 'staff-dr-xu', 'staff-dr-li', 'staff-dr-zhang-ya', 'staff-dr-zhang-zheng']) {
      assert.deepEqual(byId(id).specialties, ['功能／二返'], id);
    }
    assert.deepEqual(byId('staff-dr-song').specialties, ['復健科']);
    assert.deepEqual(byId('staff-dr-jian').specialties, ['心臟科']);
    assert.ok(!(byId('staff-dr-lin').specialties ?? []).length, '判斷不了的那一位先不填');
    for (const s of staffWithRole(SEED.staff, THERAPIST_ROLE)) {
      assert.ok(!('specialties' in s), `${s.name} 是治療師，沒有科別`);
    }
  });

  test('每一位都存得下去', () => {
    for (const s of SEED.staff) {
      assert.deepEqual(validate('staff', s, SEED.staff.filter((x) => x.id !== s.id)), [], s.name);
    }
  });
});

describe('拍 Abovee 認人（假名）', () => {
  const at = (text, role = null) => staffFrom(text, SEED.staff, { role })?.id ?? null;

  test('新醫師的全名 → 那一位（醫師的姓是全名的開頭）', () => {
    assert.equal(at('宋大同', DOCTOR_ROLE), 'staff-dr-song');
    assert.equal(at('簡小明', DOCTOR_ROLE), 'staff-dr-jian');
    assert.equal(at('林大華', DOCTOR_ROLE), 'staff-dr-lin');
  });

  test('兩位張各自只對到自己；第三種張誰都不是', () => {
    assert.equal(at('張雅某', DOCTOR_ROLE), 'staff-dr-zhang-ya');
    assert.equal(at('張正某', DOCTOR_ROLE), 'staff-dr-zhang-zheng');
    assert.equal(at('張小明', DOCTOR_ROLE), null, '主檔上沒有這一位，不猜');
  });

  test('新治療師的全名 → 那一位（治療師的名字是全名的結尾）', () => {
    assert.equal(at('某佩茹', THERAPIST_ROLE), 'staff-pr');
    assert.equal(at('某瑜如', THERAPIST_ROLE), 'staff-yr');
    assert.equal(at('某郁真', THERAPIST_ROLE), 'staff-yz');
    assert.equal(at('某依琳', THERAPIST_ROLE), 'staff-yl');
  });

  test('一位姓張的治療師在復能那一列照舊認成治療師', () => {
    assert.equal(at('張怡婷', THERAPIST_ROLE), 'staff-yt');
    // 不知道這一列要哪一種人時也只有治療師那一條符合 —— 兩位張的顯示名是兩個字，「張」一個字對不到
    assert.equal(at('張怡婷'), 'staff-yt');
  });

  test('姓跟某位醫師一樣的治療師：知道這一列要治療師就認得；不知道時兩條都符合 → 不猜', () => {
    assert.equal(at('林依琳', THERAPIST_ROLE), 'staff-yl');
    assert.equal(at('林依琳'), null);
  });

  test('原本認得的照舊：夏、許、李的全名，既有治療師的全名', () => {
    assert.equal(at('夏大同', DOCTOR_ROLE), 'staff-dr-xia');
    assert.equal(at('許小明', DOCTOR_ROLE), 'staff-dr-xu');
    assert.equal(at('李大華', DOCTOR_ROLE), 'staff-dr-li');
    assert.equal(at('陳騰崴', THERAPIST_ROLE), 'staff-tw');
  });
});

describe('醫師那一排', () => {
  const pick = (courseId) => doctorChoicesFor(course(courseId), SEED.staff);

  test('復健科那幾門先選好宋（那一科剛好一位）', () => {
    for (const id of ['course-rehab', 'course-amnion', 'course-prp', 'course-ha-prp']) {
      assert.equal(pick(id).preselect, 'staff-dr-song', id);
    }
  });

  test('心臟科評估先選好簡', () => {
    assert.equal(pick('course-cardio').preselect, 'staff-dr-jian');
  });

  test('二返：前五位是功能／二返那一科，原本那三位排最前面；不預選', () => {
    const got = pick('course-followup');
    assert.deepEqual(names(got.first), ['夏', '許', '李', '張雅', '張正']);
    assert.equal(got.preselect, null);
  });

  test('林：每一門要醫師的課都選得到，排在「其他醫師」後面', () => {
    for (const id of ['course-rehab', 'course-cardio', 'course-followup', 'course-fm', 'course-amnion', 'course-retest']) {
      assert.ok(names(pick(id).others).includes('林'), id);
    }
  });
});

describe('既有資料庫：資料健檢「治療師與醫師少了幾位」', () => {
  const old = () => SEED.staff.filter((s) => OLD_IDS.includes(s.id)).map(({ specialties, ...rest }) => rest);
  const check = (staff, id = 'seedStaff') => runHealthCheck({
    customers: [], entitlements: [], visits: [], tasks: [], availability: [],
    master: { ...SEED, staff },
  }, TODAY).checks.find((c) => c.id === id).findings;
  const fixOf = (rows, staffId) => rows.find((f) => f.fix?.staffId === staffId)?.fix ?? null;

  test('資料健檢多一項（31 項）', () => {
    assert.equal(CHECKS.length, 31);
    assert.ok(CHECKS.some((c) => c.id === 'seedStaff'));
  });

  test('少的九位各一列，建出來的每一筆都存得下去', () => {
    const rows = check(old());
    assert.deepEqual(rows.map((f) => f.fix.staffId).sort(), [...NEW_THERAPISTS, ...NEW_DOCTORS].sort());
    for (const f of rows) {
      assert.equal(f.fix.kind, 'addStaff');
      assert.equal(f.fix.data.active, true);
      assert.ok(!('id' in f.fix.data));
      assert.deepEqual(validate('staff', f.fix.data, old()), [], f.title);
    }
    assert.deepEqual(fixOf(rows, 'staff-dr-song').data.specialties, ['復健科']);
    assert.deepEqual(fixOf(rows, 'staff-dr-jian').data.specialties, ['心臟科']);
    assert.ok(!(fixOf(rows, 'staff-dr-lin').data.specialties ?? []).length);
    assert.ok(!('specialties' in fixOf(rows, 'staff-pr').data));
  });

  // 她只按了「建新醫師」、沒按補科別：二返那一排最前面還是原本那三位。
  // 既有三位還沒有科別時就建兩位帶著功能／二返的張，那一科只剩新的兩位，
  // `doctorChoicesFor()` 會把原本三位收進「其他醫師」—— 最前面變成兩位從來不看二返的人。
  test('建兩位張的那一顆同時把夏、許、李空著的科別補上（一個 commit），講得出來', () => {
    const rows = check(old());
    for (const id of ['staff-dr-zhang-ya', 'staff-dr-zhang-zheng']) {
      const fix = fixOf(rows, id);
      assert.deepEqual(fix.data.specialties, ['功能／二返']);
      assert.deepEqual(fix.also.map((a) => a.id).sort(), ['staff-dr-li', 'staff-dr-xia', 'staff-dr-xu']);
      for (const a of fix.also) assert.deepEqual(a.changes, { specialties: ['功能／二返'] });
    }
    const said = rows.find((f) => f.fix.staffId === 'staff-dr-zhang-ya').detail;
    assert.match(said, /夏、許、李/);
    assert.match(said, /功能／二返/);
    assert.ok(!fixOf(rows, 'staff-dr-song').also?.length, '宋那一科沒有別人要一起補');

    // 只按「建 張雅」那一顆之後：二返那一排最前面有原本那三位
    const fix = fixOf(rows, 'staff-dr-zhang-ya');
    const after = [
      ...old().map((s) => ({ ...s, ...(fix.also.find((a) => a.id === s.id)?.changes ?? {}) })),
      { id: fix.staffId, ...fix.data },
    ];
    assert.deepEqual(names(doctorChoicesFor(course('course-followup'), after).first).sort(),
      ['夏', '許', '李', '張雅'].sort());
  });

  test('夏、許、李已經有科別：建兩位張的那一顆不動他們', () => {
    const mine = old().map((s) => (s.role === DOCTOR_ROLE ? { ...s, specialties: ['功能／二返'] } : s));
    assert.ok(!fixOf(check(mine), 'staff-dr-zhang-ya').also?.length);
  });

  test('她自己填過別的科別的那一位不動（只補空的）', () => {
    const mine = old().map((s) => (s.id === 'staff-dr-xia' ? { ...s, specialties: ['泌尿科'] } : s));
    assert.deepEqual(fixOf(check(mine), 'staff-dr-zhang-ya').also.map((a) => a.id).sort(), ['staff-dr-li', 'staff-dr-xu']);
  });

  test('她已經用全名建了某位醫師：不再建一位只有姓的', () => {
    const rows = check([...old(), { id: 'her-1', name: '宋大同', role: DOCTOR_ROLE }]);
    assert.equal(fixOf(rows, 'staff-dr-song'), null);
    assert.ok(!rows.some((f) => f.title === '宋'));
  });

  test('她已經用全名建了某位治療師：不再建一位只有名字的', () => {
    const rows = check([...old(), { id: 'her-2', name: '某佩茹', role: THERAPIST_ROLE }]);
    assert.equal(fixOf(rows, 'staff-pr'), null);
  });

  test('同一個字、另一種人不算同一位：她有一位姓宋的治療師，宋醫師照建', () => {
    const rows = check([...old(), { id: 'her-3', name: '宋小芳', role: THERAPIST_ROLE }]);
    assert.ok(fixOf(rows, 'staff-dr-song'));
  });

  // 反方向：建了「張雅」「張正」之後，她那一位「張」的 startsWith 會同時符合兩位的全名 →
  // `staffFrom()` 回 null，本來認得的變成認不得
  test('她已經有一位只寫姓的張醫師：不建張雅、張正，列出來請她看（沒有按鈕）', () => {
    const rows = check([...old(), { id: 'her-4', name: '張', role: DOCTOR_ROLE }]);
    assert.equal(fixOf(rows, 'staff-dr-zhang-ya'), null);
    assert.equal(fixOf(rows, 'staff-dr-zhang-zheng'), null);
    const listed = rows.filter((f) => !f.fix);
    assert.deepEqual(listed.map((f) => f.title).sort(), ['張正', '張雅'].sort());
    assert.match(listed[0].detail, /「張」/);
    assert.equal(listed[0].link, '#/settings/staff');
  });

  test('一個種子 id 都沒有的主檔一列都不報', () => {
    assert.deepEqual(check([{ id: 's-1', name: '治療師甲', role: THERAPIST_ROLE }]), []);
  });

  test('都有了就一列都不報', () => {
    assert.deepEqual(check(SEED.staff), []);
  });

  describe('補科別（「主檔有幾格還沒跟上」）', () => {
    const blanks = (staff) => check(staff, 'seedBlanks').filter((f) => f.fix.type === 'staff');

    test('九位都在、科別空著：有科別的七位各一列，只寫那一格', () => {
      const bare = SEED.staff.map(({ specialties, ...rest }) => rest);
      const rows = blanks(bare);
      assert.deepEqual(rows.map((f) => f.fix.id).sort(),
        ['staff-dr-jian', 'staff-dr-li', 'staff-dr-song', 'staff-dr-xia', 'staff-dr-xu', 'staff-dr-zhang-ya', 'staff-dr-zhang-zheng'].sort());
      const xia = rows.find((f) => f.fix.id === 'staff-dr-xia').fix;
      assert.equal(xia.kind, 'setMasterFields');
      assert.deepEqual(xia.changes, { specialties: ['功能／二返'] });
      assert.equal(xia.what, '科別');
    });

    test('她填過別的就不動；她改成治療師的那一位也不補（補了存不下去）', () => {
      const mine = SEED.staff.map(({ specialties, ...rest }) => {
        if (rest.id === 'staff-dr-xia') return { ...rest, specialties: ['泌尿科'] };
        if (rest.id === 'staff-dr-xu') return { ...rest, role: THERAPIST_ROLE };
        return rest;
      });
      const ids = blanks(mine).map((f) => f.fix.id);
      assert.ok(!ids.includes('staff-dr-xia'));
      assert.ok(!ids.includes('staff-dr-xu'));
      assert.ok(ids.includes('staff-dr-li'));
    });

    test('種子都填好的那一份不報', () => {
      assert.deepEqual(blanks(SEED.staff), []);
    });
  });
});
