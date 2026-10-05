// 設定 → 課程：先分類再項目（2026-10-05，issue 02）。
//
// 她的原話：
//
// > 設定 → 課程 要先分類再項目。
// > 分類：復能、ILIB、醫師門診、EECP、運動區、營養點滴
// > 每個課程都要可以自己選：…診間、…別稱…。之後都還要能改
//
// 分組的規則在 `domain/masterData.js`（`tests/course-groups.test.js` 盯著）。
// 這一支盯的是只有瀏覽器看得到的那幾件：清單真的照那個形狀畫、點器材開的是
// 器材那一張而且**回得來**、新增先選分類帶的預設真的進了表單、
// 「只能排在這幾間」改了之後常用診間那一排**就地**跟著變。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

/** 清單上的小標題，照畫面上的順序。 */
const heads = (page) => page.locator('.grouphead').evaluateAll(
  (els) => els.map((el) => el.dataset.group),
);

/** 某一組底下那幾張課程卡（到下一個小標題為止）。 */
const cardsIn = (page, group) => page.locator('.grouphead').evaluateAll((els, name) => {
  const head = els.find((el) => el.dataset.group === name);
  const out = [];
  for (let n = head?.nextElementSibling; n && !n.classList.contains('grouphead'); n = n.nextElementSibling) {
    if (n.dataset.course) out.push(n.dataset.course);
  }
  return out;
}, group);

test('G1 清單先分類：復能底下是復能＋三台器材、ILIB 底下是那一台、營養點滴底下是品項', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  expect(await heads(page)).toEqual(
    ['復能', 'ILIB', '醫師門診', 'EECP', '運動區', '營養點滴', '健檢', '其他']);
  // 一組裡面的順序照主檔清單原本那個（文件 id），這一支不管它
  expect((await cardsIn(page, '醫師門診')).sort())
    .toEqual(['course-cardio', 'course-followup', 'course-rehab']);
  expect(await cardsIn(page, '健檢')).toEqual(['course-checkup']);
  expect(await cardsIn(page, '其他'), '她：物理治療師諮詢先放「其他」').toEqual(['course-pt-consult']);

  const recovery = page.locator('[data-course="course-recovery"]');
  await expect(recovery.locator('.subrow')).toHaveCount(3);
  await expect(recovery.locator('.subrows')).toContainText('SIS');
  await expect(recovery.locator('.subrows')).toContainText('INDIBA');
  await expect(recovery.locator('.subrows')).toContainText('高能量雷射');

  // ILIB 那一台指著 ILIB 這門課，所以它在這一組（不是復能）—— 照資料畫
  await expect(page.locator('[data-course="course-iv-laser"] [data-child-id="eq-ilib"]')).toBeVisible();

  await expect(page.locator('[data-course="course-iv-drip"] [data-child-type="ivProducts"]'))
    .toHaveCount(7);
  // 沒有器材也沒有品項的課程底下什麼都不掛
  await expect(page.locator('[data-course="course-checkup"] .subrow')).toHaveCount(0);

  // n返 借二返的設定：清單上也講一句
  await expect(page.locator('[data-course="course-followup"]')).toContainText('三返');
});

test('G2 點 SIS 開的是器材那一張，存完回到課程那一頁（不是器材清單）', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-child-id="eq-sis"]').click();
  await expect(page.locator('input[name="name"]')).toHaveValue('SIS');
  await expect(page.locator('input[name="contraindications"]'), '是器材那一張表').toBeVisible();
  await expect(page.locator('[data-back]')).toContainText('課程');

  await page.fill('input[name="shortName"]', 'S');
  await page.click('button[type="submit"]');
  await app.saved();

  await expect(page.locator('.grouphead').first(), '回到課程那一頁').toBeVisible();
  await expect(page.locator('[data-child-id="eq-sis"]')).toContainText('月曆寫「S」');
  expect((await app.readDoc('config/app/equipment', 'eq-sis')).shortName).toBe('S');

  // 品項也一樣：開的是品項那一張，按取消回到課程
  await page.locator('[data-child-id="iv-heart"]').click();
  await expect(page.locator('input[name="durationMin"]')).toHaveValue('180');
  await page.locator('[data-cancel]').click();
  await expect(page.locator('.grouphead').first()).toBeVisible();
});

test('G3 新增先選分類：帶好那一組的預設，她改掉的那一格存下去是她改的', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await expect(page.locator('[data-grouppick]')).toBeHidden();
  await page.locator('[data-new]').click();
  await expect(page.locator('[data-grouppick]')).toBeVisible();
  await page.locator('[data-newgroup="醫師門診"]').click();

  // 那一組的預設：不用指派、30 分、分類那一顆按好了
  await expect(page.locator('select[name="assigns"]')).toHaveValue('none');
  await expect(page.locator('input[name="durationMin"]')).toHaveValue('30');
  await expect(page.locator('[data-chip="group"][aria-pressed="true"]')).toHaveText('醫師門診');
  await expect(page.locator('input[name="requiresDoctor"]')).toBeChecked();
  // 門診三個系統都要（Abovee 壓，確認後 Examine、耀聖）
  await expect(page.locator('input[name="systems"]:checked')).toHaveCount(3);

  await page.fill('input[name="name"]', '泌尿科門診');
  await page.fill('input[name="durationMin"]', '45');
  await page.click('button[type="submit"]');
  await app.saved();

  const made = (await app.readAll('config/app/courses')).find((c) => c.name === '泌尿科門診');
  expect(made.group).toBe('醫師門診');
  expect(made.durationMin, '她改過的那一格').toBe(45);
  expect(made.assigns).toBe('none');
  expect(made.systems).toEqual(['Abovee', 'Examine', '耀聖']);

  const cards = page.locator('.grouphead[data-group="醫師門診"] ~ [data-course]')
    .filter({ hasText: '泌尿科門診' });
  await expect(cards).toHaveCount(1);
});

test('G4 把分類改成一個新的字：清單多一組，排在「其他」前面', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-fitness"]').click();
  await page.fill('input[name="groupNew"]', '檢測');
  await page.click('button[type="submit"]');
  await app.saved();

  expect((await app.readDoc('config/app/courses', 'course-fitness')).group).toBe('檢測');
  const order = await heads(page);
  expect(order.indexOf('檢測'), '她自己打的排在「其他」前面').toBe(order.indexOf('其他') - 1);
  expect(await cardsIn(page, '檢測')).toEqual(['course-fitness']);
  expect((await cardsIn(page, '運動區')).sort()).toEqual(['course-inbody', 'course-nutrition-consult']);

  // 再打開：那一顆新的丸子按著；改回「其他」存成空的
  await page.locator('[data-edit="course-fitness"]').click();
  await expect(page.locator('[data-chip="group"][aria-pressed="true"]')).toHaveText('檢測');
  await page.locator('[data-chip="group"]').filter({ hasText: '其他' }).click();
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-fitness')).group).toBeNull();
  expect((await cardsIn(page, '其他')).sort()).toEqual(['course-fitness', 'course-pt-consult']);
});

test('G5 別稱兩個入口一份資料：課程編輯表改了，名稱怎麼寫看得到；反過來也一樣', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-eecp"]').click();
  await expect(page.locator('input[name="shortName"]')).toHaveValue('');
  await page.fill('input[name="shortName"]', 'EE');
  await page.click('button[type="submit"]');
  await app.saved();

  const before = await app.readDoc('config/app/courses', 'course-iv-laser');
  expect((await app.readDoc('config/app/courses', 'course-eecp')).shortName).toBe('EE');

  await app.go('/settings/naming');
  const row = page.locator('[data-row="courses:course-eecp"]');
  await expect(row.locator('.namerow__read').first()).toContainText('EE');

  // 反過來：名稱怎麼寫那一頁改，課程編輯表看得到
  await row.locator('[data-edit]').click();
  await row.locator('[data-short]').fill('EP');
  await row.locator('[data-save]').click();
  await app.saved();

  await app.go('/settings/courses');
  await page.locator('[data-edit="course-eecp"]').click();
  await expect(page.locator('input[name="shortName"]')).toHaveValue('EP');

  // 課程編輯表不畫 LINE 名，存檔也不碰它：ILIB 的「靜脈雷射」還在
  await page.locator('[data-cancel]').click();
  await page.locator('[data-edit="course-iv-laser"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
  const after = await app.readDoc('config/app/courses', 'course-iv-laser');
  expect(after.lineName).toBe(before.lineName);
  expect(after.shortName).toBe('IL');
});

test('G6 只能排在這幾間改得動，常用診間那一排就地跟著變', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-eecp"]').click();
  const only = (id) => page.locator(`input[name="allowedRoomIds"][value="${id}"]`);
  const usual = (id) => page.locator(`input[name="preferredRoomIds"][value="${id}"]`);

  await expect(only('room-t5')).toBeChecked();
  await expect(only('room-t8')).toBeChecked();
  await expect(only('room-t2'), '候選是全部還在用的診間').not.toBeChecked();
  await expect(page.locator('input[name="preferredRoomIds"]')).toHaveCount(2);

  // 打到一半的名字不可以被洗掉 —— 那一排是就地換的，不是整張表重畫
  await page.fill('input[name="name"]', 'EECP 改到一半');

  await only('room-t8').uncheck();
  await expect(usual('room-t8'), '排不進去的那一間不列').toHaveCount(0);
  await expect(page.locator('input[name="name"]')).toHaveValue('EECP 改到一半');

  // 勾回來：她原本勾著的常用診間還是勾著的
  await only('room-t8').check();
  await expect(usual('room-t8')).toBeChecked();

  // 多開一間治2
  await only('room-t2').check();
  await expect(page.locator('input[name="preferredRoomIds"]')).toHaveCount(3);
  await expect(usual('room-t2')).not.toBeChecked();

  await page.fill('input[name="name"]', 'EECP');
  await page.click('button[type="submit"]');
  await app.saved();

  const course = await app.readDoc('config/app/courses', 'course-eecp');
  expect([...course.allowedRoomIds].sort()).toEqual(['room-t2', 'room-t5', 'room-t8']);
  expect([...course.preferredRoomIds].sort(), '常用診間沒有被順手改掉').toEqual(['room-t5', 'room-t8']);
  await expect(page.locator('[data-course="course-eecp"]')).toContainText('治2');
});

test('G7 舊資料：沒有分類的課程全部落在「其他」，一門都沒少', async ({ app, page }) => {
  const docs = masterDocs().map((d) => {
    if (d.path !== 'config/app/courses') return d;
    const { group, ...data } = d.data;
    return { ...d, data };
  });
  await app.seed(docs);
  await app.signIn('/settings/courses');

  expect(await heads(page)).toEqual(['其他']);
  await expect(page.locator('[data-course]')).toHaveCount(13);
  // 器材與品項照樣掛在它們的課程底下
  await expect(page.locator('[data-course="course-recovery"] .subrow')).toHaveCount(3);

  // 打開一門、什麼都不改就存：不會被塞進某一組
  await page.locator('[data-edit="course-rehab"]').click();
  await expect(page.locator('[data-chip="group"][aria-pressed="true"]')).toHaveText('其他');
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-rehab')).group ?? null).toBeNull();
});

// ---------- 壓哪幾個系統（issue 03，ADR-0119）----------

/** 把種子課程的某幾格換掉／拿掉（`undefined` ＝ 拿掉那一格，模擬 2026-10-05 之前的資料）。 */
const coursesWith = (change) => masterDocs().map((d) => {
  if (d.path !== 'config/app/courses') return d;
  const data = { ...d.data, ...change(d) };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return { ...d, data };
});

test('G8 三個勾：舊課程打開就是照類別勾好的，存一次什麼都不變；只勾耀聖存不下去', async ({ app, page }) => {
  await app.seed(coursesWith(() => ({ systems: undefined })));
  await app.signIn('/settings/courses');

  // 清單那一行灰字講得出壓在哪、確認後還有什麼 —— 沒勾過的照類別推
  await expect(page.locator('[data-course="course-followup"]')).toContainText('Abovee 壓，確認後 Examine、耀聖');
  await expect(page.locator('[data-course="course-checkup"]')).toContainText('Examine 壓');

  const box = (name) => page.locator(`input[name="systems"][value="${name}"]`);

  await page.locator('[data-edit="course-followup"]').click();
  for (const name of ['Abovee', 'Examine', '耀聖']) await expect(box(name)).toBeChecked();
  await page.click('button[type="submit"]');
  await app.saved();
  const followup = await app.readDoc('config/app/courses', 'course-followup');
  expect(followup.systems).toEqual(['Abovee', 'Examine', '耀聖']);
  expect(followup.category, '類別那一格原樣留著').toBe('A');

  // 復能：只勾著 Abovee。換成只勾耀聖 → 存不下去，講為什麼
  await page.locator('[data-edit="course-recovery"]').click();
  await expect(box('Abovee')).toBeChecked();
  await expect(box('Examine')).not.toBeChecked();
  await box('Abovee').uncheck();
  await box('耀聖').check();
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('至少要勾一個');
  expect((await app.readDoc('config/app/courses', 'course-recovery')).systems ?? null).toBeNull();

  // Abovee＋耀聖：存得下去，清單那一行跟著變
  await box('Abovee').check();
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-recovery')).systems).toEqual(['Abovee', '耀聖']);
  await expect(page.locator('[data-course="course-recovery"]')).toContainText('Abovee 壓，確認後 耀聖');

  // 類別是 null 的那一門（不用掛號）原樣帶回去，不會變成字串
  await page.locator('[data-edit="course-inbody"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-inbody')).category).toBeNull();
});

test('G9 一門課只勾 Abovee＋耀聖：客人說可以之後只長一張耀聖', async ({ app, page }) => {
  await app.seed([
    ...coursesWith((d) => (d.id === 'course-recovery' ? { systems: ['Abovee', '耀聖'] } : {})),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 20, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-one', customerId: 'cust-x', customerName: '王小明', date: TODAY, status: 'pending_confirm',
      slots: [{
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: 'pending_confirm',
      }],
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');

  // 長按那一段（`wireLongPress()` 只認主鍵的真滑鼠事件，同 spec 34）
  const row = page.locator('[data-open^="visit:v-one:"]').first();
  await row.scrollIntoViewIfNeeded();
  const at = await row.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  const tasks = (await app.readAll('tasks')).filter((t) => t.visitId === 'v-one' && !t.deletedAt);
  expect(tasks.map((t) => t.kind), '沒勾 Examine，所以不長 Examine').toEqual(['耀聖']);
});
