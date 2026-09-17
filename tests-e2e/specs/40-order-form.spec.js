// 拍訂購單 → 新增客戶／加購到既有客戶（issue 09，ADR-0099、0101）。
//
// 她 2026-09-17：「在客戶那頁，長按右下角的那個加號(或是加點下去多新增一個選項是拍顧客會單子)…
// 拍完後，然後可以先辨識出是誰，甚麼時候的顧客會，買了什麼方案，加購什麼，欠尾款多少，
// 然後點擊小鉛筆的icon可以微調」。
//
// 模擬器裡的 Function 不叫 Gemini，回 `fixtures/ai/orderForm-*.json` 的假抄字（王小明、李小華、客戶A）。
// 盯的是整條路：入口 → 相機 → 確認卡 → 既有的寫入。翻譯的細節在 `tests/order-form.test.js`。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';
import { PROJECT_ID, allowUser } from '../fixtures/emulator.js';
import { dayKey } from '../../functions/lib/guard.js';

// Function 記帳用真的時鐘（同 38）
test.use({ today: dayKey(new Date()) });

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' };

/**
 * 把白名單整份拿掉（讓接下來那一次寫入被 Rules 擋），回傳原本有哪幾個 uid 好放回去。
 * uid 是 Auth 模擬器發的，不是寫死的字串，所以照列出來的刪。
 */
async function revokeEveryone() {
  const list = await (await fetch(`${DOCS}/allowedUsers`, { headers: OWNER })).json();
  const ids = (list.documents ?? []).map((d) => d.name.split('/').pop());
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${DOCS}/allowedUsers/${id}`, { method: 'DELETE', headers: OWNER });
    if (!res.ok) throw new Error(`拿不掉白名單 ${res.status}`);
  }
  return ids;
}

/** 客戶 → 右下角 ＋ →（選單「拍訂購單」或長按）→ 相簿選幾張 → 送出 → 確認卡。 */
async function photograph(page, fixtures, { hold = false } = {}) {
  await queueAi(fixtures);
  const files = [];
  for (const [i, name] of fixtures.entries()) {
    // eslint-disable-next-line no-await-in-loop
    files.push(await fakePhoto(`${name}-${i}.jpg`));
  }

  const plus = page.locator('[data-fabtoggle]');
  if (hold) {
    const box = await plus.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // 按住直到相機真的開了，不要按固定的秒數
    await expect(page.locator('.cam')).toBeVisible({ timeout: 5_000 });
    await page.mouse.up();
  } else {
    await plus.click();
    await page.locator('[data-orderform]').click();
    await expect(page.locator('.cam')).toBeVisible();
  }

  await page.locator('[data-cam-album-input]').setInputFiles(files);
  await expect(page.locator('.cam__thumb')).toHaveCount(fixtures.length);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.ocdeck')).toBeVisible();
}

const cardAt = (page, i) => page.locator('.ocdeck .ocard-host').nth(i);

/** 寫進去的東西裡不可以有照片、原字、身分證字號的形狀（ADR-0101）。 */
async function expectNoPhotoLeft(app, customerIds) {
  const docs = [await app.readAll('customers'), await app.readAll('notes'), await app.readAll('audit')];
  for (const id of customerIds) docs.push(await app.readAll(`customers/${id}/entitlements`));
  const dump = JSON.stringify(docs);
  expect(dump).not.toMatch(/blob:|data:image|"seen"/);
  expect(dump).not.toMatch(/[A-Z][12]\d{8}/);
}

test('O1 長按右下角 ＋ 直接開相機；名字點過「名字對」才建得了；筋骨強身七筆＋任選(30) ×10，沒有尾款備註', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers');
  await photograph(page, ['orderForm-jingu'], { hold: true });

  const card = cardAt(page, 0);
  await expect(card.locator('.ocard__name')).toHaveText('王小明');
  await expect(card.locator('.seen', { hasText: '8萬筋骨強身' })).toBeVisible();
  await expect(card.locator('.ocard__main', { hasText: '筋骨強身' })).toContainText('×1');
  await expect(card.locator('.ocard__item', { hasText: '復能-三選一(30)' })).toContainText('10 次');
  await expect(card.locator('.ocard__item', { hasText: '復能-三選一(30)' }).locator('.seen')).toContainText('任選(30) ×10');
  await expect(card.locator('.ocard__none', { hasText: '沒欠' })).toBeVisible();
  // 電話不抄 → 姓名旁那一顆 ⚠（spec「暫定」）
  await expect(card.locator('.tip--warn')).toHaveCount(1);

  const go = card.locator('[data-oc-create]');
  await expect(go).toBeDisabled();
  await expect(card.locator('.ocard__why')).toContainText('名字對');
  await card.locator('[data-oc-nameok]').click();
  await expect(go).toBeEnabled();
  await go.click();
  await app.saved();

  // 只有一位：建好之後整層收起來，回到客戶清單，抬頭是那一次購買
  await expect(page.locator('.ocdeck')).toHaveCount(0);
  await expect(page.locator('#view a.card', { hasText: '王小明' })).toContainText('0827 顧客會 筋骨強身');

  const created = (await app.readAll('customers')).find((c) => c.name === '王小明');
  expect(created).toMatchObject({ source: '顧客會', purchasedAt: '2026-08-27', phone: null, marks: [] });
  const ents = await app.readAll(`customers/${created.id}/entitlements`);
  const fromPlan = ents.filter((e) => e.sourcePlanName === '筋骨強身');
  expect(fromPlan).toHaveLength(7);
  expect(fromPlan.every((e) => e.sourcePlanSets === 1)).toBe(true);
  const pool = ents.find((e) => e.label === '復能-三選一(30)');
  expect(pool).toMatchObject({ type: 'pool', totalQty: 10, durationMin: 30, purchasedAt: '2026-08-27' });
  expect([...pool.optionEquipmentIds].sort()).toEqual(['eq-indiba', 'eq-laser', 'eq-sis']);
  expect(ents).toHaveLength(8);
  await expectNoPhotoLeft(app, [created.id]);
});

test('O2 選單「拍訂購單」三張：便利貼那張掛在前一位、點一下拆開；健檢配二返、尾款紅色、警示與機構按下；一位失敗另一位還在、講得出是誰', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意拿掉白名單讓一位建不起來' });
  await app.seed([...masterDocs()]);
  await app.signIn('/customers');
  await photograph(page, ['orderForm-jingu', 'orderForm-sticky', 'orderForm-checkup']);

  // 三張照片、兩位：沒有名字的那張掛在王小明身上
  await expect(page.locator('.ocdeck .ocard-host')).toHaveCount(2);
  const first = cardAt(page, 0);
  await expect(first.locator('.ocard__thumb')).toHaveCount(2);
  await expect(first.locator('.ocard__attached')).toContainText('沒有名字，算在王小明身上');
  await first.locator('[data-oc-detach]').click();
  await expect(page.locator('.ocdeck .ocard-host')).toHaveCount(3);
  await expect(page.locator('.ocdeck .deck__count')).toContainText('1 / 3');
  await expect(cardAt(page, 1).locator('.ocard__missing', { hasText: '認不出名字' })).toBeVisible();
  await expect(cardAt(page, 1).locator('[data-oc-create]')).toBeDisabled();

  // 李小華：紅卡、警示與機構按下、尾款 3萬、兩套、12萬健檢
  await page.locator('.ocdeck [data-oc-step="1"]').click();
  await page.locator('.ocdeck [data-oc-step="1"]').click();
  await expect(page.locator('.ocdeck .deck__who')).toContainText('李小華');
  const hua = cardAt(page, 2);
  await expect(hua.locator('.ocard__danger')).toContainText('體內金屬');
  await expect(hua.locator('[data-oc-flag="體內金屬"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(hua.locator('[data-oc-partner="自然美"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(hua.locator('.ocard__owed')).toHaveText('3萬');
  await expect(hua.locator('.ocard__main', { hasText: '筋骨強身' })).toContainText('×2');
  await expect(hua.locator('.ocard__item', { hasText: '12萬健檢' })).toContainText('1 次');
  await expect(hua.locator('.ocard__unreadable')).toContainText('被便利貼蓋住');

  // 小鉛筆：08 的表單開在一層裡、事先填好；補一支電話
  await hua.locator('[data-oc-nameok]').click();
  await hua.locator('[data-oc-edit]').click();
  await expect(page.locator('.ocedit [data-cf-form]')).toBeVisible();
  await expect(page.locator('.ocedit input[name="name"]')).toHaveValue('李小華');
  await expect(page.locator('.ocedit .photohead .seen', { hasText: '8萬筋骨強身' })).toBeVisible();
  await page.locator('.ocedit input[name="phone"]').fill('0911222333');
  await page.locator('.ocedit button[type="submit"]').click();
  await expect(page.locator('.ocedit')).toHaveCount(0);
  await expect(hua.locator('.tip--warn')).toHaveCount(0);
  await hua.locator('[data-oc-create]').click();
  await app.saved();
  await expect(hua.locator('.ocard__stamp')).toHaveText('已建立');
  // 建好一位就滑到下一位還沒建的
  await expect(page.locator('.ocdeck .deck__who')).toContainText('王小明');
  await expect(page.locator('.ocdeck .deck__count')).toContainText('建好 1');

  const lee = (await app.readAll('customers')).find((c) => c.name === '李小華');
  expect(lee).toMatchObject({ phone: '0911222333', flags: ['體內金屬'], partners: ['自然美'] });
  expect(lee.marks).toContainEqual({ text: '尾款 3萬', color: 'red' });
  expect(lee.marks).toContainEqual({ text: '手有體內金屬', color: 'grey' });
  const ents = await app.readAll(`customers/${lee.id}/entitlements`);
  expect(ents.filter((e) => e.sourcePlanName === '筋骨強身').every((e) => e.sourcePlanSets === 2)).toBe(true);
  const checkup = ents.find((e) => e.courseId === 'course-checkup');
  expect(checkup).toMatchObject({ tier: '12萬', label: '12萬健檢', totalQty: 1 });
  expect(ents.find((e) => e.followupForEntitlementId === checkup.id), '健檢配到二返（ADR-0022）').toBeTruthy();

  // 王小明那一位建的時候白名單被拿掉了 → 建不起來，李小華還在，卡上講得出是這一位
  const allowed = await revokeEveryone();
  expect(allowed.length).toBeGreaterThan(0);
  const wang = cardAt(page, 0);
  await wang.locator('[data-oc-nameok]').click();
  await wang.locator('[data-oc-create]').click();
  await expect(wang.locator('.ocard__why')).toContainText('沒建立', { timeout: 20_000 });
  await expect(wang.locator('[data-oc-create]')).toHaveText('再試一次');
  expect((await app.readAll('customers')).map((c) => c.name)).toEqual(['李小華']);

  // 白名單回來，再試一次 → 只建一位
  for (const uid of allowed) await allowUser(uid); // eslint-disable-line no-await-in-loop
  await wang.locator('[data-oc-create]').click();
  await app.saved();
  await expect(wang.locator('.ocard__stamp')).toHaveText('已建立');
  expect((await app.readAll('customers')).map((c) => c.name).sort()).toEqual(['李小華', '王小明']);

  // 還剩拆出來那一位：返回鍵先問，留下來就還在（而且沒有多退一格退出 app）
  await expect(page.locator('.ocdeck .deck__count')).toContainText('2 / 3');
  await page.goBack();
  await expect(app.dialog()).toContainText('還有 1 位沒建立');
  await page.locator('.dialog-backdrop [data-choice="stay"]').click();
  await expect(page.locator('.ocdeck')).toBeVisible();

  // × 再問一次，這次留下來
  await page.locator('.ocdeck [data-oc-close]').click();
  await expect(app.dialog()).toContainText('照片與辨識出來的字都不會留著');
  await page.locator('.dialog-backdrop [data-choice="stay"]').click();
  await expect(page.locator('.ocdeck')).toBeVisible();

  // 再按一次 × → 離開 → 收起來、停在客戶清單（沒有多退一格退出 app），建好的兩位在清單上
  await page.locator('.ocdeck [data-oc-close]').click();
  await page.locator('.dialog-backdrop [data-choice="leave"]').click();
  await expect(page.locator('.ocdeck')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/customers$/);
  await app.settled();
  await expect(page.locator('#view a.card', { hasText: '王小明' })).toBeVisible();
  await expect(page.locator('#view a.card', { hasText: '李小華' })).toBeVisible();
  const wangId = (await app.readAll('customers')).find((c) => c.name === '王小明').id;
  await expectNoPhotoLeft(app, [lee.id, wangId]);
});

test('O3 名字跟既有客戶一樣：兩顆都沒預選時按不下去；選「加購到 客戶A」→ 加在那一位身上，備註接在後面', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A', phone: '0900000000', marks: [{ text: '怕冷', color: 'blue' }], notes: '怕冷', partners: [] }),
    entitlement('cust-a', { id: 'ent-a1', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, purchasedAt: '2026-07-23' }),
  ]);
  await app.signIn('/customers');
  await photograph(page, ['orderForm-samename']);

  const card = cardAt(page, 0);
  const choices = card.locator('.ocard__choice');
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(choices.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('[data-oc-nameok]')).toHaveCount(0);
  await expect(card.locator('[data-oc-create]')).toBeDisabled();
  await expect(card.locator('.ocard__why')).toContainText('已經有 1 位「客戶A」');

  await card.locator('[data-oc-who="cust-a"]').click();
  await expect(card.locator('[data-oc-create]')).toHaveText('加購到 客戶A');
  await card.locator('[data-oc-create]').click();
  await app.saved();
  await expect(page.locator('.ocdeck')).toHaveCount(0);

  const all = await app.readAll('customers');
  expect(all, '沒有多一位同名的').toHaveLength(1);
  expect(all[0].marks).toEqual([{ text: '怕冷', color: 'blue' }, { text: '尾款 5000', color: 'red' }]);
  const ents = await app.readAll('customers/cust-a/entitlements');
  expect(ents).toHaveLength(8);
  const added = ents.filter((e) => e.sourcePlanName === '筋骨強身');
  expect(added).toHaveLength(7);
  expect(added.every((e) => e.purchasedAt === '2026-09-03' && e.sourcePlanSets === 1)).toBe(true);
  expect(new Set(added.map((e) => e.purchaseId)).size, '一次加購是一次購買').toBe(1);
});
