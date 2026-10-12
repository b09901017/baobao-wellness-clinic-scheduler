// 醫師分科、課程指定要哪一科的醫師（2026-10-05，issue 04，ADR-0120）。
//
// 她的原話：
//
// > 四、醫師要分科：功能／二返、泌尿科、心臟科、復健科。物理治療師是另一種人。
// > 每個課程都要可以自己選：…哪一科的醫師…
// > 羊膜：…選復健科醫師（只有一位）…
//
// 排法（誰排前面、什麼時候先選好）在 `domain/masterData.js` 的 `doctorChoicesFor()`，
// `tests/doctor-specialties.test.js` 盯著。這一支從瀏覽器問接線：設定頁那兩排存不存得下去、
// 壓表與來訪編輯器的醫師那一排真的照它排、而且「其他醫師」點得開。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
/** 這個月裡還沒過的一天（月底那幾天就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

/**
 * 這一支測的是**機制**（設定頁那兩排、醫師那一排怎麼排），所以主檔收回 2026-10-06 之前的樣子：
 * 醫師只有夏、許、李三位、科別都是空的，再由各測試自己蓋上去。種子後來補到 8 位、填了科別
 *（course-form-and-sheet/04）—— 種子那一份的排法在最下面的 D7。
 */
const OLD_DOCTORS = ['staff-dr-xia', 'staff-dr-xu', 'staff-dr-li'];
const baseDocs = () => masterDocs()
  .filter((d) => d.path !== 'config/app/staff' || d.data.role !== '醫師' || OLD_DOCTORS.includes(d.id))
  .map((d) => {
    if (d.path !== 'config/app/staff') return d;
    const { specialties, ...data } = d.data;
    return { ...d, data };
  });

/** 主檔，但某幾筆換掉幾格（`change` 回要蓋上去的欄位）。 */
const masterWith = (change) => baseDocs().map((d) => ({ ...d, data: { ...d.data, ...change(d) } }));

/** 夏醫師是唯一的復健科；許醫師是心臟科；李醫師沒填。 */
const withSpecialties = (d) => {
  if (d.path !== 'config/app/staff') return {};
  if (d.id === 'staff-dr-xia') return { specialties: ['復健科'] };
  if (d.id === 'staff-dr-xu') return { specialties: ['心臟科'] };
  return {};
};

/** 一位買了復健科醫師門診的客戶（那門課的種子指定復健科）。 */
const rehabCustomer = () => [
  customer({ id: 'cust-d', name: '王小明' }),
  entitlement('cust-d', {
    id: 'ent-rehab', label: '復健科醫師門診', type: 'single',
    courseId: 'course-rehab', totalQty: 6, durationMin: 30,
  }),
];

test('D1 設定 → 治療師與醫師：醫師有「科別」那一排，可以勾不只一科、自己打新的；治療師沒有', async ({ app, page }) => {
  await app.seed([...baseDocs()]);
  await app.signIn('/settings/staff');

  await page.locator('[data-edit="staff-dr-xia"]').click();
  const box = page.locator('[data-specialties]');
  await expect(box).toBeVisible();
  await expect(box.locator('[data-chip="specialties"]')).toHaveText(
    ['功能／二返', '泌尿科', '心臟科', '復健科']);

  await box.locator('[data-chip="specialties"]', { hasText: '復健科' }).click();
  await box.locator('[data-chip="specialties"]', { hasText: '心臟科' }).click();
  await page.fill('input[name="specialtyNew"]', '神經內科');
  await page.click('button[type="submit"]');
  await app.saved();

  const xia = await app.readDoc('config/app/staff', 'staff-dr-xia');
  expect([...xia.specialties].sort()).toEqual(['復健科', '心臟科', '神經內科'].sort());
  await expect(page.locator('.card.row').filter({ hasText: '夏' }).first()).toContainText('復健科');

  // 她打的新科別出現在別的醫師那一排上（名單＝預設四科＋大家身上已經有的字）
  await page.locator('[data-edit="staff-dr-xu"]').click();
  await expect(page.locator('[data-chip="specialties"]', { hasText: '神經內科' })).toBeVisible();
  await page.locator('[data-cancel]').click();

  // 物理治療師的編輯表看不到那一排；改成醫師才出現
  await page.locator('[data-edit="staff-tw"]').click();
  await expect(page.locator('[data-specialties]')).toBeHidden();
  await page.selectOption('select[name="role"]', '醫師');
  await expect(page.locator('[data-specialties]')).toBeVisible();
  await page.selectOption('select[name="role"]', '物理治療師');
  await expect(page.locator('[data-specialties]')).toBeHidden();
});

test('D2 設定 → 課程：「來訪時要選醫師」三種答案；舊課程打開照原本的畫好，存一次不變', async ({ app, page }) => {
  // 舊資料：課程上沒有 doctorPick
  await app.seed(baseDocs().map((d) => {
    if (d.path !== 'config/app/courses') return d;
    const { doctorPick, ...data } = d.data;
    return { ...d, data };
  }));
  await app.signIn('/settings/courses');

  const pressed = page.locator('[data-chip="doctorPick"][aria-pressed="true"]');

  // 門診（A 類）沒有那一格 → 「哪一科都可以」（ADR-0058 的退回）
  await page.locator('[data-edit="course-cardio"]').click();
  await expect(pressed).toHaveText('哪一科都可以');
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-cardio')).doctorPick).toBe('any');

  // 復能沒有醫師 → 指派那一排亮「物理治療師」，哪一科那一排藏著（2026-10-06 起四選一，ADR-0130）
  await page.locator('[data-edit="course-recovery"]').click();
  await expect(page.locator('[data-chip="assignKind"][aria-pressed="true"]')).toHaveText('物理治療師');
  await expect(page.locator('[data-when="doctor"]')).toBeHidden();
  await page.locator('[data-cancel]').click();

  // 指定一科
  await page.locator('[data-edit="course-rehab"]').click();
  await page.locator('[data-chip="doctorPick"]', { hasText: '復健科' }).click();
  await page.click('button[type="submit"]');
  await app.saved();
  const rehab = await app.readDoc('config/app/courses', 'course-rehab');
  expect(rehab.doctorPick).toBe('復健科');
  expect(rehab.requiresDoctor, '旗標跟著寫').toBe(true);

  // 門診也關得掉了（以前「這一格開不開都一樣」）：指派那一排按「都不用」
  await page.locator('[data-edit="course-cardio"]').click();
  await page.locator('[data-chip="assignKind"]', { hasText: '都不用' }).click();
  await page.click('button[type="submit"]');
  await app.saved();
  const cardio = await app.readDoc('config/app/courses', 'course-cardio');
  expect(cardio.doctorPick).toBe('none');
  expect(cardio.requiresDoctor).toBe(false);
});

test('D3 壓表：那一科只有一位 → 已經選好他；其他醫師收在後面、點得到、存得下去', async ({ app, page }) => {
  await app.seed([...masterWith(withSpecialties), ...rehabCustomer()]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-d"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  await page.locator('[data-ent="ent-rehab"]').click();
  await app.layer('[data-doctor]');

  // 唯一的復健科醫師已經按下去了
  await expect(page.locator('[data-doctor="staff-dr-xia"]')).toHaveAttribute('aria-pressed', 'true');
  // 另外兩位收在「其他醫師」後面 —— 不是不見，是排在後面
  await expect(page.locator('[data-doctor="staff-dr-xu"]')).toBeHidden();
  await page.locator('[data-chip-more]', { hasText: '其他醫師' }).click();
  await expect(page.locator('[data-doctor="staff-dr-xu"]')).toBeVisible();

  // 代診：改選別科的那一位，照樣存得下去
  await page.locator('[data-doctor="staff-dr-xu"]').click();
  await page.locator('[data-time]').first().click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-d');
  expect(v.slots[0].doctorId, '這是排序不是限制').toBe('staff-dr-xu');
});

test('D4 壓表：那一科有兩位 → 一個都不預選，兩位排在最前面', async ({ app, page }) => {
  await app.seed([
    ...masterWith((d) => (d.path === 'config/app/staff' && ['staff-dr-xia', 'staff-dr-li'].includes(d.id)
      ? { specialties: ['復健科'] } : {})),
    ...rehabCustomer(),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-d"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
  await page.locator('[data-ent="ent-rehab"]').click();
  await app.layer('[data-doctor]');

  await expect(page.locator('[data-doctor][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('[data-doctor="staff-dr-xia"]')).toBeVisible();
  await expect(page.locator('[data-doctor="staff-dr-li"]')).toBeVisible();
  await expect(page.locator('[data-doctor="staff-dr-xu"]')).toBeHidden();
});

test('D5 她還沒替醫師填科別：醫師那一排跟以前一模一樣（全部列出來、不預選、沒有「其他醫師」）', async ({ app, page }) => {
  await app.seed([...baseDocs(), ...rehabCustomer()]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-d"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
  await page.locator('[data-ent="ent-rehab"]').click();
  await app.layer('[data-doctor]');

  await expect(page.locator('[data-doctor]')).toHaveCount(3);
  await expect(page.locator('[data-doctor][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('[data-chip-more]', { hasText: '其他醫師' })).toHaveCount(0);
});

test('D6 來訪編輯器：新的一段也先選好那一位、其他醫師點得開；她改成「還沒定」存下去就是還沒定', async ({ app, page }) => {
  await app.seed([...masterWith(withSpecialties), ...rehabCustomer()]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-d/${PICK_DAY}`);
  await app.layer('[data-chip="s0-doc"]');

  const pressed = page.locator('[data-chip="s0-doc"][aria-pressed="true"]');
  await expect(pressed).toHaveText('夏');
  await expect(page.locator('[data-chip="s0-doc"]', { hasText: '許' })).toBeHidden();
  await page.locator('[data-chip-more]', { hasText: '其他醫師' }).click();
  await expect(page.locator('[data-chip="s0-doc"]', { hasText: '許' })).toBeVisible();

  // 她刻意改成「還沒定」
  await page.locator('[data-chip="s0-doc"]', { hasText: '還沒定' }).click();
  await page.click('button[type="submit"]');
  // 第一道：還沒選醫師那一句；第二道：壓好了嗎
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-d');
  expect(v.slots[0].doctorId, '她說還沒定就是還沒定').toBeNull();
});

// 種子那一份（2026-10-06，course-form-and-sheet/04）：醫師 8 位，科別照 Abovee 上實際排的填。
test('D7 種子的醫師與科別：復健科醫師門診先選好宋、其餘收在「其他醫師」；二返那一排前面是功能／二返那五位、林在後面', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), ...rehabCustomer(),
    entitlement('cust-d', {
      id: 'ent-followup', label: '二返', type: 'single', courseId: 'course-followup', totalQty: 2, durationMin: 30,
    }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-d"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  // 復健科只有宋一位 → 已經按下去；另外七位收在後面
  await page.locator('[data-ent="ent-rehab"]').click();
  await app.layer('[data-doctor]');
  await expect(page.locator('[data-doctor]')).toHaveCount(8);
  await expect(page.locator('[data-doctor="staff-dr-song"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-doctor="staff-dr-xia"]')).toBeHidden();
  await expect(page.locator('[data-doctor="staff-dr-lin"]')).toBeHidden();

  // 二返：功能／二返那五位排前面（原本三位都在）、不預選；林（沒填科別）在「其他醫師」後面，點得到
  await page.locator('[data-ent="ent-followup"]').click();
  await app.layer('[data-doctor="staff-dr-xia"]');
  for (const id of ['staff-dr-xia', 'staff-dr-xu', 'staff-dr-li', 'staff-dr-zhang-ya', 'staff-dr-zhang-zheng']) {
    await expect(page.locator(`[data-doctor="${id}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-doctor][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('[data-doctor="staff-dr-lin"]')).toBeHidden();
  await page.locator('[data-chip-more]', { hasText: '其他醫師' }).click();
  await expect(page.locator('[data-doctor="staff-dr-lin"]')).toBeVisible();
  await expect(page.locator('[data-doctor="staff-dr-song"]')).toBeVisible();
});
