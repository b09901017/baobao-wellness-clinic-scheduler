// 設定 → 課程 → 編輯：版面重排（2026-10-06，issue 06，ADR-0130）。
//
// 她的原話：
//
// > 有關設定 → 課程→ 編輯 的版面設計 : 請精心設計UIUX
// > 1. 我希望新的分類可以變成加號的丸子放在分類的最後面，不用特別給他一格
// > 2. 別稱要有月曆別稱以及line別稱設定(復能就不用)
// > 5. 排班時要指派的分四種，診間，物理治療師，醫師，都不用
// > 然後我希望選了診間後才會顯示可用診間類型以及只能排在這幾間
// > 選了醫師才顯示來訪時選醫師
// > …這幾個可以先收合到其他設定之類的，平常不用顯示
//
// 那一顆與兩格（`assigns`、`doctorPick`）的對照在 `tests/course-form.test.js`。
// 這一支盯的是只有瀏覽器看得到的：換欄位是換 `hidden` 不是重畫（打到一半的字還在）、
// 收起來的欄位讀得到也存得回去、**收起來的那一格有錯時「儲存」不是沒反應**。

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

const COURSES = 'config/app/courses';

/** 把某幾門種子課程的某幾格換掉。 */
const coursesWith = (changes) => masterDocs().map((d) => {
  if (d.path !== COURSES || !changes[d.id]) return d;
  return { ...d, data: { ...d.data, ...changes[d.id] } };
});

const kind = (page) => page.locator('[data-chip="assignKind"][aria-pressed="true"]');
const when = (page, k) => page.locator(`[data-when="${k}"]`);
const save = async (app, page) => {
  await page.click('button[type="submit"]');
  await app.saved();
};

/**
 * 「什麼都不改就存」之後要一樣的那幾格，照它們的意思比（沒有那一格＝預設值）。
 * `doctorPick` 比的是「要不要醫師、哪一科」（`doctorRuleOf()` 的退路：門診與 `requiresDoctor`）。
 */
const meaning = (c) => ({
  name: c.name,
  group: c.group ?? null,
  shortName: c.shortName ?? null,
  lineName: c.lineName ?? null,
  aboveeNames: c.aboveeNames ?? [],
  durationMin: c.durationMin,
  durationChoices: c.durationChoices ?? [],
  bookingMinutes: c.bookingMinutes ?? [],
  category: c.category ?? null,
  systems: c.systems ?? null,
  assigns: c.assigns,
  doctor: (typeof c.doctorPick === 'string' && c.doctorPick.trim())
    || (c.category === 'A' || c.requiresDoctor ? 'any' : 'none'),
  allowedRoomTypes: c.allowedRoomTypes ?? [],
  allowedRoomIds: c.allowedRoomIds ?? [],
  preferredRoomIds: c.preferredRoomIds ?? [],
  requiresEquipment: !!c.requiresEquipment,
  requiresIvProduct: !!c.requiresIvProduct,
  needsTreatmentForm: c.needsTreatmentForm !== false,
  needsRecord: c.needsRecord === true,
  uncounted: c.uncounted === true,
  provisional: c.provisional === true,
  frequencyRule: c.frequencyRule ?? null,
  followupCourseId: c.followupCourseId ?? null,
});

test('C1 每一門種子課程：打開、什麼都不改就存，每一格的意思都沒變', async ({ app, page }) => {
  const docs = masterDocs();
  await app.seed(docs);
  await app.signIn('/settings/courses');

  for (const d of docs.filter((x) => x.path === COURSES)) {
    await page.locator(`[data-edit="${d.id}"]`).click();
    await expect(page.locator('input[name="name"]')).toHaveValue(d.data.name);
    await save(app, page);
    const after = await app.readDoc(COURSES, d.id);
    expect(meaning(after), d.data.name).toEqual(meaning(d.data));
  }
});

test('C2 指派四選一：選了診間才露出診間那幾格、選了醫師才露出哪一科；換的時候打到一半的字還在', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/courses');

  // 清單那一行跟表單亮著的那一顆講同一件事（以前醫師的課寫「都不用」）
  await expect(page.locator('[data-course="course-rehab"]')).toContainText('選醫師（復健科）');

  await page.locator('[data-edit="course-rehab"]').click();
  await expect(kind(page)).toHaveText('醫師');
  await expect(when(page, 'doctor')).toBeVisible();
  await expect(when(page, 'room')).toBeHidden();
  await expect(page.locator('[data-chip="doctorPick"][aria-pressed="true"]')).toHaveText('復健科');

  await page.fill('input[name="name"]', '復健科醫師門診（改到一半');
  await page.locator('[data-chip="assignKind"]', { hasText: '診間' }).click();
  await expect(when(page, 'room')).toBeVisible();
  await expect(when(page, 'doctor')).toBeHidden();
  await expect(page.locator('input[name="name"]'), '不是整張表重畫').toHaveValue('復健科醫師門診（改到一半');

  // 選了診間卻一種類型都沒勾：照舊擋（看得到那幾格才擋得有道理）
  await page.fill('input[name="name"]', '復健科醫師門診');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('選診間的課程要指定可用的診間類型');
  await page.locator('input[name="allowedRoomTypes"][value="治療室"]').check();
  await save(app, page);
  const rehab = await app.readDoc(COURSES, 'course-rehab');
  expect([rehab.assigns, rehab.doctorPick, rehab.requiresDoctor]).toEqual(['room', 'none', false]);
  expect(rehab.allowedRoomTypes).toEqual(['治療室']);
  await expect(page.locator('[data-course="course-rehab"]')).toContainText('選診間');

  // 反過來：EECP（診間）→ 醫師。哪一科那一排先按好「哪一科都可以」，診間那三格清成空的
  await page.locator('[data-edit="course-eecp"]').click();
  await expect(kind(page)).toHaveText('診間');
  await expect(when(page, 'doctor')).toBeHidden();
  await page.locator('[data-chip="assignKind"]', { hasText: '醫師' }).click();
  await expect(when(page, 'doctor')).toBeVisible();
  await expect(page.locator('[data-chip="doctorPick"][aria-pressed="true"]')).toHaveText('哪一科都可以');
  await save(app, page);
  const eecp = await app.readDoc(COURSES, 'course-eecp');
  expect([eecp.assigns, eecp.doctorPick, eecp.requiresDoctor]).toEqual(['none', 'any', true]);
  expect([eecp.allowedRoomTypes, eecp.allowedRoomIds, eecp.preferredRoomIds]).toEqual([[], [], []]);

  // 都不用：兩格都沒有
  await page.locator('[data-edit="course-cardio"]').click();
  await page.locator('[data-chip="assignKind"]', { hasText: '都不用' }).click();
  await expect(when(page, 'doctor')).toBeHidden();
  await expect(when(page, 'room')).toBeHidden();
  await save(app, page);
  const cardio = await app.readDoc(COURSES, 'course-cardio');
  expect([cardio.assigns, cardio.doctorPick, cardio.requiresDoctor]).toEqual(['none', 'none', false]);
});

test('C3 舊資料上兩個都有（診間＋醫師）：講一句、沒動那一排就照舊存回去；按了才照新選的', async ({ app, page }) => {
  await app.seed(coursesWith({ 'course-eecp': { doctorPick: 'any', requiresDoctor: true } }));
  await app.signIn('/settings/courses');

  await expect(page.locator('[data-course="course-eecp"]')).toContainText('選診間＋醫師');
  await page.locator('[data-edit="course-eecp"]').click();
  await expect(kind(page)).toHaveText('診間');
  await expect(page.locator('[data-both]')).toContainText('之前另外設了要選醫師');

  await page.fill('input[name="name"]', 'EECP 改名');
  await save(app, page);
  let eecp = await app.readDoc(COURSES, 'course-eecp');
  expect([eecp.name, eecp.assigns, eecp.doctorPick, eecp.requiresDoctor]).toEqual(['EECP 改名', 'room', 'any', true]);
  expect(eecp.allowedRoomIds).toEqual(['room-t5', 'room-t7', 'room-t8']);

  // 按了原本亮著的那一顆：照「診間」那一列存（醫師拿掉）
  await page.locator('[data-edit="course-eecp"]').click();
  await page.locator('[data-chip="assignKind"]', { hasText: '診間' }).click();
  await expect(page.locator('[data-both]')).toBeHidden();
  await save(app, page);
  eecp = await app.readDoc(COURSES, 'course-eecp');
  expect([eecp.assigns, eecp.doctorPick, eecp.requiresDoctor]).toEqual(['room', 'none', false]);
});

test('C4 分類最後那一顆「＋」：按了露出輸入框；打了字就是新的一組，沒打字退回原本那一組', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/courses');

  const plus = page.locator('[data-chip="group"][data-chip-value="__new__"]');
  await page.locator('[data-edit="course-fitness"]').click();
  await expect(page.locator('[data-groupnew]')).toBeHidden();
  await expect(page.locator('[data-chip="group"]').last(), '「＋」排在最後面').toHaveAttribute('data-chip-value', '__new__');

  await plus.click();
  await expect(page.locator('input[name="groupNew"]')).toBeVisible();
  await expect(page.locator('input[name="groupNew"]'), '按了就可以直接打字').toBeFocused();
  // 改按別顆：輸入框收起來
  await page.locator('[data-chip="group"]', { hasText: 'EECP' }).click();
  await expect(page.locator('[data-groupnew]')).toBeHidden();

  await plus.click();
  await page.fill('input[name="groupNew"]', '醫美');
  await save(app, page);
  expect((await app.readDoc(COURSES, 'course-fitness')).group).toBe('醫美');
  await expect(page.locator('.grouphead[data-group="醫美"]')).toBeVisible();

  // 按了「＋」卻沒打字：分類沒變（不會把那一顆的內部值存進去）
  await page.locator('[data-edit="course-inbody"]').click();
  await plus.click();
  await save(app, page);
  expect((await app.readDoc(COURSES, 'course-inbody')).group).toBe('運動區');
});

test('C5 月曆別稱與 LINE 別稱並排；復能兩格都不畫，存一次一個字都沒變', async ({ app, page }) => {
  await app.seed(coursesWith({ 'course-recovery': { shortName: 'RE', lineName: '復能課' } }));
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-recovery"]').click();
  await expect(page.locator('input[name="shortName"]')).toHaveCount(0);
  await expect(page.locator('input[name="lineName"]')).toHaveCount(0);
  await expect(page.locator('[data-form]')).toContainText('跟著那天用的器材');
  await save(app, page);
  const recovery = await app.readDoc(COURSES, 'course-recovery');
  expect([recovery.shortName, recovery.lineName]).toEqual(['RE', '復能課']);

  await page.locator('[data-edit="course-iv-laser"]').click();
  await expect(page.locator('input[name="shortName"]')).toHaveValue('IL');
  await expect(page.locator('input[name="lineName"]')).toHaveValue('靜脈雷射');
  await page.fill('input[name="lineName"]', '雷射');
  await save(app, page);
  expect((await app.readDoc(COURSES, 'course-iv-laser')).lineName).toBe('雷射');

  // 跟「設定 → 名稱怎麼寫」是同一格
  await app.go('/settings/naming');
  await expect(page.locator('[data-name="courses:course-iv-laser"]')).toContainText(/LINE\s*雷射/);
});

test('C6 其他設定收著、那一行看得到現在的值；裡面那一格有錯時存檔會自己打開', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/courses');

  const more = page.locator('[data-more]');
  const now = page.locator('[data-more-now]');
  const minutes = page.locator('input[name="durationMin"]');

  await page.locator('[data-edit="course-followup"]').click();
  await expect(more).not.toHaveAttribute('open', '');
  await expect(minutes).toBeHidden();
  await expect(now).toContainText('30 分');
  await expect(now).toContainText('約的時候選 30／60');

  // 瀏覽器擋的那一種（min="1"）：收起來再按儲存 → 打開、那一格是錯的、沒有存下去
  await more.locator('summary').click();
  await minutes.fill('0');
  await more.locator('summary').click();
  await expect(minutes).toBeHidden();
  await page.click('button[type="submit"]');
  await expect(more).toHaveAttribute('open', '');
  expect(await minutes.evaluate((el) => el.checkValidity())).toBe(false);
  expect((await app.readDoc(COURSES, 'course-followup')).durationMin).toBe(30);

  // domain 擋的那一種（清空）：錯誤講時長，那一段也是打開的
  await minutes.fill('');
  await more.locator('summary').click();
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('時長');
  await expect(more).toHaveAttribute('open', '');

  // 改了值，那一行跟著變（收起來就看得到）。二返約的時候選 30／60，所以時長也只能是兩個之一
  await minutes.fill('60');
  await more.locator('summary').click();
  await expect(now).toContainText('60 分');
  await save(app, page);
  expect((await app.readDoc(COURSES, 'course-followup')).durationMin).toBe(60);
});

test('C7 設定暫定：最上面那一條勾「確認過了」，小標就不見了；其餘的課沒有那一條', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-fm"]').click();
  await expect(page.locator('[data-provbar]')).toHaveCount(0);
  await page.locator('[data-cancel]').click();

  await page.locator('[data-edit="course-hrv"]').click();
  await expect(page.locator('[data-provbar]')).toContainText('設定暫定');
  await page.locator('input[name="provisionalDone"]').check();
  await save(app, page);
  expect((await app.readDoc(COURSES, 'course-hrv')).provisional).toBe(false);
  await expect(page.locator('[data-course="course-hrv"] [data-provisional]')).toHaveCount(0);
  await expect(page.locator('[data-provisional-count]')).toContainText('還有 5 門');
});
