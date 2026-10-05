// 拍 Abovee 代替壓表（2026-10-05，abovee-and-master 的 07–11，ADR-0123）。
//
// 她的原話：
//
// > 拍 Abovee 要能代替壓表。我只想拍一張照，再補充或修正需要的，就記好了。
// > - 現在辨識錯了就錯了：不能改是誰、不能選課程。認不出課程時只叫我去壓表手動記。
// > - 治療師常常沒認出來（Abovee 寫全名）。我要可以像壓表那樣直接選。
// > - 營養點滴在 Abovee 的課程那一格直接寫品項名（腸道修復、護肝排毒…），現在認不得。
// > …別稱(也可以記錄abovee怎麼寫的…這樣之後辨識，就可以對照了!)。之後都還要能改
//
// 翻譯的細節在 `tests/abovee.test.js`、`tests/abovee-import.test.js`；這一支盯只有瀏覽器看得到的那幾件。
// 例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, slot, visit } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

test('N1（07）設定頁四種主檔都有「Abovee 上的寫法」：種子預填看得到、改得動、兩間同一個寫法存不下去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  // 種子預填的（非人名）：課程、器材、品項那一張打開就看得到
  await page.locator('[data-edit="course-eecp-trial"]').click();
  await expect(page.locator('input[name="aboveeNames"]')).toHaveValue('EECP20');
  await page.locator('[data-back]').click();
  await page.locator('[data-child-id="eq-laser"]').click();
  await expect(page.locator('input[name="aboveeNames"]')).toHaveValue('高能量');
  await page.locator('[data-back]').click();
  await page.locator('[data-child-id="iv-snow"]').click();
  await expect(page.locator('input[name="aboveeNames"]')).toHaveValue('雪顏亮采');

  // 診間：填一個、存得下去也讀得回來
  await app.go('/settings/rooms');
  await page.locator('[data-edit="room-vip5"]').click();
  await page.fill('input[name="aboveeNames"]', '4樓休5、休息區5');
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/rooms', 'room-vip5')).aboveeNames).toEqual(['4樓休5', '休息區5']);

  // 另一間填同一個寫法（空白不算不一樣）→ 存不下去、講是誰的
  await page.locator('[data-edit="room-vip6"]').click();
  await page.fill('input[name="aboveeNames"]', '休息區 5');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('「休息區 5」已經是「VIP5」的了');
  expect((await app.readDoc('config/app/rooms', 'room-vip6')).aboveeNames ?? []).toEqual([]);
});

// ---------- 08：確認層每一列都能換人、選要做什麼 ----------

const MONTH = '2026-09';
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };

/** 功醫門診：種子要到 issue 12 才有，這裡照 12 要建的形狀自己放一門 */
const FM = {
  path: 'config/app/courses', id: 'course-fm',
  data: {
    name: '功醫門診', group: '醫師門診', category: 'A', systems: ['Abovee', 'Examine', '耀聖'], durationMin: 30,
    assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [], doctorPick: '功能／二返', requiresDoctor: true,
    requiresEquipment: false, needsTreatmentForm: false, needsRecord: false, uncounted: true,
    aboveeNames: ['功醫門診'], active: true,
  },
};

function picksSeed() {
  return [
    ...masterDocs(), FM,
    customer({ id: 'cust-wang', name: '王小明', marks: chart('1234') }),
    customer({ id: 'cust-lee', name: '李小華', marks: chart('5678') }),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-wang', { id: 'w-pool', ...POOL3 }),
    entitlement('cust-wang', { id: 'w-exam', label: '健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 1 }),
    entitlement('cust-wang', { id: 'w-fu', label: '二返', courseId: 'course-followup', totalQty: 1, followupForEntitlementId: 'w-exam' }),
    entitlement('cust-lee', { id: 'l-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 40 }),
    visit({
      id: 'v-exam', customerId: 'cust-wang', customerName: '王小明', date: '2026-08-20', status: 'done',
      slots: [{ ...slot({ courseId: 'course-checkup', entitlementId: 'w-exam', startsAt: '09:00', endsAt: '11:00' }), status: 'done' }],
    }),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: ['cust-wang', 'cust-lee', 'cust-a'].map((id) => ({ customerId: id, customerName: '', state: 'pending', skippedReason: null })),
      },
    },
  ];
}

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 41）。 */
async function photograph(app, page, name) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi([name]);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto(`${name}.jpg`, { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);
const optValues = (r) => r.locator('[data-abl-opt]').evaluateAll((els) => els.map((el) => el.dataset.ablOpt));

test('N2（08）認不出課程選得到要做什麼、三返60、功醫門診、認錯人換一位；記下去跟壓表同一種形狀', async ({ app, page }) => {
  await app.seed(picksSeed());
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-picks');

  // a0：課程那一格認不出來 → 不再叫她去壓表，「要做什麼」那一排選得到；二返排在健檢後面（她 9/24：並排一指就約錯）
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0')).not.toContainText('到壓表那張卡上手動記');
  const values = await optValues(row(page, 'a0'));
  expect(values.indexOf('w-fu')).toBeGreaterThan(values.indexOf('w-exam'));
  expect(values.indexOf('w-fu')).toBeGreaterThan(values.indexOf('w-pool'));
  expect(values).toContain('__course__:course-fm');
  await row(page, 'a0').locator('[data-abl-opt="w-pool"]').click();
  await row(page, 'a0').locator('[data-abl-eq="eq-sis"]').click();
  await row(page, 'a0').locator('[data-abl-therapist="staff-zn"]').click();
  await expect(row(page, 'a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'a0').locator('.abl-row__problems')).toHaveCount(0);

  // a1：三返60 → ＋n返 按好、三返、60 分；接哪一次健檢不替她選
  await row(page, 'a1').locator('[data-abl-open]').click();
  await expect(row(page, 'a1').locator('[data-abl-opt="__nth__"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a1').locator('[data-abl-nth="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a1').locator('[data-abl-min="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a1').locator('[data-abl-exam][aria-pressed="true"]')).toHaveCount(0);
  await row(page, 'a1').locator('[data-abl-exam="v-exam"]').click();

  // a2：功醫門診、客戶A 身上沒有任何額度 → 「不扣次數」那一顆按好、勾著
  await row(page, 'a2').locator('[data-abl-open]').click();
  const fm = row(page, 'a2').locator('[data-abl-opt="__course__:course-fm"]');
  await expect(fm).toHaveAttribute('aria-pressed', 'true');
  await expect(fm).toContainText('不扣次數');
  await expect(row(page, 'a2').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');

  // a3：認成李小華，其實是王小明 → 換一位、打兩個字、選 → 照新的人重算；她選的人不自動勾
  await row(page, 'a3').locator('[data-abl-open]').click();
  await row(page, 'a3').locator('[data-abl-find]').click();
  await row(page, 'a3').locator('[data-abl-query]').fill('王小');
  await row(page, 'a3').locator('[data-abl-who="cust-wang"]').click();
  await expect(row(page, 'a3').locator('.abl-row__who')).toHaveText('王小明');
  await expect(row(page, 'a3').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');

  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('三返是加約的');
  await expect(app.dialog()).toContainText('功醫門診不算次數');
  await app.ok();
  await app.saved();

  const added = (await app.readAll('visits')).filter((v) => v.id !== 'v-exam');
  const at = (date) => added.find((v) => v.date === date)?.slots ?? [];
  expect(added.map((v) => `${v.customerId} ${v.date}`).sort()).toEqual([
    'cust-a 2026-09-12', 'cust-wang 2026-09-10', 'cust-wang 2026-09-11',
  ]);
  expect(at('2026-09-10').map((s) => [s.entitlementId, s.courseId, s.equipmentId, s.therapistId])).toEqual([
    ['w-pool', 'course-recovery', 'eq-sis', 'staff-zn'],
  ]);
  expect(at('2026-09-11').map((s) => [s.entitlementId, s.courseId, s.followupNth, s.followupForVisitId, s.minutes, s.endsAt])).toEqual([
    [null, 'course-followup', 3, 'v-exam', 60, '11:00'],
  ]);
  expect(at('2026-09-12').map((s) => [s.entitlementId, s.courseId])).toEqual([[null, 'course-fm']]);
  for (const v of added) for (const s of v.slots) expect(s.status).toBe('pending_confirm');
});
