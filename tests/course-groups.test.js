// 設定 → 課程：先分類再項目（2026-10-05，issue 02）。
//
// 她的原話：
//
// > 設定 → 課程 要先分類再項目。
// > 分類：復能、ILIB、醫師門診、EECP、運動區、營養點滴
//
// **分類只管兩件事**：清單怎麼分組、新增時帶哪一組預設值。沒有任何規則讀它 ——
// 所以這一支除了盯分組本身，還掃原始碼確認 domain 裡沒有別的地方在問 `course.group`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  COURSE_GROUPS, OTHER_GROUP, groupOf, courseGroupNames, coursesByGroup,
  courseDefaultsFor, validate,
} from '../public/js/domain/masterData.js';
import { SEED } from '../public/js/domain/seed.js';
import { fieldLabel } from '../public/js/domain/audit.js';
import { pick } from '../tests-e2e/related.js';

const course = (id, extra = {}) => ({
  id, name: id, durationMin: 60, category: 'C', assigns: 'none',
  allowedRoomTypes: [], allowedRoomIds: [], ...extra,
});

describe('課程落在哪一組', () => {
  test('預設的順序就是她列的那六組，後面接健檢', () => {
    assert.deepEqual(COURSE_GROUPS,
      ['復能', 'ILIB', '醫師門診', 'EECP', '運動區', '營養點滴', '健檢']);
  });

  test('沒有填的落在「其他」—— 既有資料一筆都不用搬', () => {
    assert.equal(groupOf({ name: '舊課程' }), OTHER_GROUP);
    assert.equal(groupOf({ group: null }), OTHER_GROUP);
    assert.equal(groupOf({ group: '   ' }), OTHER_GROUP);
    assert.equal(groupOf(null), OTHER_GROUP);
    assert.equal(groupOf({ group: ' 復能 ' }), '復能');
  });

  test('她打一個新的字就是新的一組，排在「其他」前面', () => {
    const names = courseGroupNames([
      course('a', { group: '醫美' }),
      course('b', { group: '復能' }),
      course('c'),
      course('d', { group: '醫美' }),
      course('e', { group: '針灸' }),
    ]);
    assert.deepEqual(names, [...COURSE_GROUPS, '醫美', '針灸', OTHER_GROUP]);
  });

  test('已刪除的課程帶著的字不算一組', () => {
    const names = courseGroupNames([course('a', { group: '醫美', deletedAt: 'x' })]);
    assert.deepEqual(names, [...COURSE_GROUPS, OTHER_GROUP]);
  });
});

describe('清單怎麼分組（coursesByGroup）', () => {
  const groups = coursesByGroup(SEED);
  const find = (name) => groups.find((g) => g.group === name);
  const names = (rows) => rows.map((r) => r.name);

  test('種子：每一組都有，照預設的順序，物理治療師諮詢在「其他」', () => {
    assert.deepEqual(groups.map((g) => g.group), [...COURSE_GROUPS, OTHER_GROUP]);
    assert.deepEqual(find(OTHER_GROUP).courses.map((c) => c.course.name), ['物理治療師諮詢']);
    assert.deepEqual(find('健檢').courses.map((c) => c.course.name), ['健檢']);
    assert.deepEqual(find('醫師門診').courses.map((c) => c.course.name),
      ['復健科醫師門診', '心臟科評估', '二返', '功醫門診', 'HRV', '羊膜', '回測報告', 'HA-PRP', 'PRP']);
    assert.deepEqual(find('EECP').courses.map((c) => c.course.name), ['EECP', 'EECP體驗']);
    assert.deepEqual(find('運動區').courses.map((c) => c.course.name),
      ['身體組成分析', '體適能檢查分析', '營養師諮詢', 'MOTI', '運動']);
  });

  test('復能底下是復能這門課＋指到它的三台器材', () => {
    const [row] = find('復能').courses;
    assert.equal(row.course.id, 'course-recovery');
    assert.deepEqual(names(row.equipment).sort(), ['INDIBA', 'SIS', '高能量雷射'].sort());
    assert.deepEqual(row.ivProducts, []);
  });

  test('ILIB 那一台出現在「ILIB」那一組 —— 照 equipment.courseId 畫，不看 requiresEquipment', () => {
    const [row] = find('ILIB').courses;
    assert.equal(row.course.requiresEquipment, false, 'ILIB 這門課不是擇一池');
    assert.deepEqual(names(row.equipment), ['ILIB']);
  });

  test('營養點滴底下是全部品項', () => {
    const [row] = find('營養點滴').courses;
    assert.deepEqual(names(row.ivProducts), names(SEED.ivProducts));
    assert.deepEqual(row.equipment, []);
  });

  test('舊資料：沒有 group 的課程全部落在「其他」，一門都沒少', () => {
    const bare = SEED.courses.map(({ group, ...rest }) => rest);
    const out = coursesByGroup({ ...SEED, courses: bare });
    assert.deepEqual(out.map((g) => g.group), [OTHER_GROUP]);
    assert.equal(out[0].courses.length, SEED.courses.length);
    // 器材與品項照樣掛在它們的課程底下 —— 分組只是外面那一層
    const recovery = out[0].courses.find((c) => c.course.id === 'course-recovery');
    assert.equal(recovery.equipment.length, 3);
  });

  test('沒有課程的那幾組不畫；已刪除的課程、器材、品項都不列', () => {
    const out = coursesByGroup({
      courses: [
        course('a', { group: '復能' }),
        course('gone', { group: 'EECP', deletedAt: 'x' }),
        course('drip', { group: '營養點滴', requiresIvProduct: true }),
      ],
      equipment: [
        { id: 'e1', name: '還在', courseId: 'a' },
        { id: 'e2', name: '刪了', courseId: 'a', deletedAt: 'x' },
        { id: 'e3', name: '沒指到課程', courseId: null },
      ],
      ivProducts: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B', deletedAt: 'x' }],
    });
    assert.deepEqual(out.map((g) => g.group), ['復能', '營養點滴']);
    assert.deepEqual(names(out[0].courses[0].equipment), ['還在']);
    assert.deepEqual(names(out[1].courses[0].ivProducts), ['A']);
  });

  test('停用的照樣列（清單上標「已停用」），跟其他主檔清單一樣', () => {
    const out = coursesByGroup({
      courses: [course('a', { group: '復能', active: false })],
      equipment: [{ id: 'e1', name: '停用的', courseId: 'a', active: false }],
    });
    assert.equal(out[0].courses.length, 1);
    assert.equal(out[0].courses[0].equipment.length, 1);
  });
});

describe('新增時帶哪一組預設值（courseDefaultsFor）', () => {
  test('醫師門診：不用指派、選得到醫師、要簽療程單', () => {
    const d = courseDefaultsFor('醫師門診');
    assert.equal(d.group, '醫師門診');
    assert.equal(d.assigns, 'none');
    assert.equal(d.category, 'A');
    assert.equal(d.requiresDoctor, true);
    assert.notEqual(d.needsTreatmentForm, false);
  });

  test('EECP／ILIB／營養點滴：選診間', () => {
    for (const g of ['EECP', 'ILIB', '營養點滴']) {
      const d = courseDefaultsFor(g);
      assert.equal(d.assigns, 'room', g);
      assert.ok(d.allowedRoomTypes.length, `${g} 要帶著診間類型，不然一打開就存不下去`);
    }
  });

  test('運動區：都不用；健檢：只壓 Examine', () => {
    assert.equal(courseDefaultsFor('運動區').assigns, 'none');
    assert.equal(courseDefaultsFor('健檢').category, 'B');
    assert.equal(courseDefaultsFor('健檢').assigns, 'none');
  });

  test('「其他」與她自己打的新字沒有預設，而「其他」存成空的', () => {
    assert.deepEqual(courseDefaultsFor(OTHER_GROUP), { group: null });
    assert.deepEqual(courseDefaultsFor('醫美'), { group: '醫美' });
    assert.deepEqual(courseDefaultsFor(null), { group: null });
  });

  test('每一組的預設值加上一個名字就存得下去', () => {
    const blank = {
      durationMin: 60, category: 'C', assigns: 'room', allowedRoomTypes: ['治療室'],
      allowedRoomIds: [], preferredRoomIds: [],
    };
    for (const g of [...COURSE_GROUPS, OTHER_GROUP]) {
      const errors = validate('courses', { ...blank, ...courseDefaultsFor(g), name: `新的${g}` });
      assert.deepEqual(errors, [], g);
    }
  });

  test('回的是新的一份，改它不會改到常數', () => {
    const a = courseDefaultsFor('EECP');
    a.allowedRoomTypes.push('VIP室');
    assert.deepEqual(courseDefaultsFor('EECP').allowedRoomTypes, ['治療室']);
  });
});

describe('分類的驗證', () => {
  const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };

  test('空的、沒有這一格都存得下去', () => {
    assert.deepEqual(validate('courses', { ...ok }), []);
    assert.deepEqual(validate('courses', { ...ok, group: null }), []);
    assert.deepEqual(validate('courses', { ...ok, group: '醫美' }), []);
  });

  test('不是字、或太長的擋下來', () => {
    assert.ok(validate('courses', { ...ok, group: 3 }).some((e) => e.includes('分類')));
    assert.ok(validate('courses', { ...ok, group: '一二三四五六七八九十一二三' })
      .some((e) => e.includes('分類')));
  });
});

describe('種子', () => {
  test('每一門種子課程都填了分類（物理治療師諮詢留空 → 其他）', () => {
    for (const c of SEED.courses) {
      if (c.id === 'course-pt-consult') {
        assert.equal(groupOf(c), OTHER_GROUP, '她：物理治療師諮詢先放「其他」');
        continue;
      }
      assert.ok(COURSE_GROUPS.includes(c.group), `${c.name} 的分類是「${c.group}」`);
    }
  });
});

describe('沒有任何規則讀分類', () => {
  // 改分類碰不到任何資料的意思 —— 待辦、次數、指派、加購一個都不看。
  // 這一條掃原始碼：`domain/` 底下只有主檔那一支可以問 `.group`。
  test('domain 裡只有 masterData.js 讀 course.group', () => {
    const dir = new URL('../public/js/domain/', import.meta.url);
    const readers = readdirSync(dir)
      // `health.js`：資料健檢「主檔有幾格還沒跟上」只問那一格是不是從來沒填過、要不要補（issue 12），
      // 不拿分類決定任何事
      .filter((f) => f.endsWith('.js') && !['masterData.js', 'seed.js', 'orderForm.js', 'health.js'].includes(f))
      .filter((f) => /\.group\b|groupOf\(/.test(readFileSync(new URL(f, dir), 'utf8')));
    assert.deepEqual(readers, []);
  });

  test('加購那一排不看分類（順序是照器材推的，她 2026-09-07 指名復能與 ILIB 並排）', () => {
    const src = readFileSync(new URL('../public/js/ui/components/buy.js', import.meta.url), 'utf8');
    assert.ok(!/\.group\b|groupOf\(|coursesByGroup\(/.test(src));
  });
});

describe('稽核上那幾格的名字', () => {
  test('分類、別稱、只能排在這幾間不印英文欄位名', () => {
    assert.equal(fieldLabel('group'), '分類');
    assert.equal(fieldLabel('shortName'), '別稱');
    assert.equal(fieldLabel('allowedRoomIds'), '只能排在這幾間');
  });
});

describe('日常驗收維持只跑相關的幾支', () => {
  test('改 seed.js 不會退回全跑，而且設定與資料健檢那幾支會被挑到', () => {
    const r = pick(['public/js/domain/seed.js']);
    assert.equal(r.all, false, r.why.join('\n'));
    for (const spec of ['03-health-and-counts', '17-settings-fields']) {
      assert.ok(r.specs.includes(spec), `${spec} 讀得到種子`);
    }
  });
});
