// 客戶改名、刪掉客戶之後，身上掛著他的那幾份（`.scratch/prelaunch-audit-2026-09-23/issues/09`、`08`）。
//
// 來訪、任務、隨手記身上存的是當時的名字；它們讀的時候也不問客戶還在不在。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, note, TODAY, addDays,
} from '../fixtures/data.js';
import { seedDocs } from '../fixtures/emulator.js';

const rehab = (startsAt) => ({
  ...slot({ courseId: 'course-rehab', entitlementId: 'ent-r', startsAt, endsAt: startsAt.replace(':00', ':30'), doctorId: 'staff-dr-xia' }),
  status: 'confirmed',
});

function seedPerson() {
  const past = addDays(TODAY, -7);
  return [
    ...masterDocs(),
    customer({ id: 'cust-n', name: '王小明', phone: '0900000000' }),
    entitlement('cust-n', {
      id: 'ent-r', label: '復健科醫師門診', type: 'single', courseId: 'course-rehab', totalQty: 6, bookedCount: 2, durationMin: 30,
    }),
    visit({ id: 'v-past', customerId: 'cust-n', customerName: '王小明', date: past, status: 'done', slots: [{ ...rehab('10:00'), status: 'done' }] }),
    visit({ id: 'v-today', customerId: 'cust-n', customerName: '王小明', date: TODAY, status: 'confirmed', slots: [rehab('14:00')] }),
    task({ id: 't-open', customerId: 'cust-n', customerName: '王小明', kind: 'Examine', dueDate: addDays(TODAY, -1), visitId: 'v-today' }),
    task({ id: 't-done', customerId: 'cust-n', customerName: '王小明', kind: 'Examine', dueDate: addDays(past, -1), visitId: 'v-past', done: true, doneAt: past }),
    note({ id: 'n-open', text: '問他要不要加購', customerId: 'cust-n', customerName: '王小明' }),
  ];
}

// ---------- 09：改名 ----------

test('D1 改名 → 今天的來訪、還沒做的待辦、隨手記一起換；過去的與做完的留著當時的名字', async ({ app, page }) => {
  await app.seed(seedPerson());
  await app.signIn('/customers/cust-n');

  await page.locator('[data-edit]').click();
  await app.settled();
  await page.locator('input[name="name"]').fill('王大明');
  await page.locator('button[type="submit"]').click();
  await app.saved();

  const nameOf = async (path, id) => (await app.readDoc(path, id)).customerName;
  expect(await nameOf('visits', 'v-today')).toBe('王大明');
  expect(await nameOf('tasks', 't-open')).toBe('王大明');
  expect(await nameOf('notes', 'n-open')).toBe('王大明');
  expect(await nameOf('visits', 'v-past'), '歷史留著當時的名字').toBe('王小明');
  expect(await nameOf('tasks', 't-done'), '做完的留著當時的名字').toBe('王小明');

  await app.go(`/todo/${encodeURIComponent('Examine')}`);
  await expect(page.locator('#view')).toContainText('王大明');
  await expect(page.locator('#view')).not.toContainText('王小明');
});

test('D1b 改名 → 結案昨天還沒結案那一筆 → 待辦與新長的「寫紀錄」還是新名字（issues/16）', async ({ app, page }) => {
  const yesterday = addDays(TODAY, -1);
  await app.seed([
    ...seedPerson(),
    visit({ id: 'v-y', customerId: 'cust-n', customerName: '王小明', date: yesterday, status: 'confirmed', slots: [rehab('10:00')] }),
    task({ id: 't-y', customerId: 'cust-n', customerName: '王小明', kind: 'Examine', dueDate: addDays(yesterday, -1), visitId: 'v-y' }),
  ]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-edit]').click();
  await app.settled();
  await page.locator('input[name="name"]').fill('王大明');
  await page.locator('button[type="submit"]').click();
  await app.saved();
  expect((await app.readDoc('visits', 'v-y')).customerName, '還沒結案的不算歷史').toBe('王大明');

  await app.go('/todo/close');
  await page.locator('[data-open="v-y"]').click();
  await app.tickAll();
  await page.locator('[data-apply]').click();
  await app.saved();

  const tasks = (await app.readAll('tasks')).filter((t) => t.visitId === 'v-y' && !t.deletedAt);
  expect(tasks.map((t) => t.kind).sort()).toEqual(['Examine', '寫紀錄']);
  for (const t of tasks) expect(t.customerName, t.kind).toBe('王大明');
});

test('D2 改成跟另一位一樣的名字 → 同名那一句照樣問', async ({ app, page }) => {
  await app.seed([...seedPerson(), customer({ id: 'cust-other', name: '客戶A', phone: '0911111111' })]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-edit]').click();
  await app.settled();
  await page.locator('input[name="name"]').fill('客戶A');
  await page.locator('button[type="submit"]').click();

  await expect(app.dialog()).toContainText('也叫「客戶A」');
  await app.cancelDialog();
  expect((await app.readDoc('customers', 'cust-n')).name, '按了回去改就什麼都沒寫').toBe('王小明');
});

// ---------- 08：刪客戶之前先擋 ----------

test('D3 還有今天的來訪與沒做的待辦 → 刪不掉，列出來，一鍵帶到批次取消那一位那個月', async ({ app, page }) => {
  await app.seed(seedPerson());
  await app.signIn('/customers/cust-n');

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  const said = await app.dialogText();
  expect(said).toContain('還刪不掉');
  expect(said).toContain('Examine');
  expect(said).toContain('批次取消');
  await app.ok();

  await expect(page).toHaveURL(/#\/schedule\/cancel$/);
  await app.settled();
  await expect(page.locator('#view'), '帶著那一位進來').toContainText('王小明');
  await expect(page.locator('#view'), '那一天那一段列著，勾得到').toContainText('14:00');
  expect((await app.readDoc('customers', 'cust-n')).deletedAt ?? null, '什麼都沒刪').toBeNull();
});

test('D3b 只有一則沒勾、沒日期的隨手記 → 刪不掉，列得出那一則；勾掉之後刪得掉（issues/17）', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-q', name: '客戶A', phone: '0900000000' }),
    note({ id: 'n-q', text: '問他要不要加購', customerId: 'cust-q', customerName: '客戶A' }),
  ]);
  await app.signIn('/customers/cust-q');

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  const said = await app.dialogText();
  expect(said).toContain('還刪不掉');
  expect(said).toContain('隨手記「問他要不要加購」');
  await expect(page.locator('.dialog-backdrop [data-ok]'), '沒有來訪就沒有批次取消可去').toHaveText('知道了');
  await app.ok();
  expect((await app.readDoc('customers', 'cust-q')).deletedAt ?? null).toBeNull();

  await seedDocs([note({ id: 'n-q', text: '問他要不要加購', customerId: 'cust-q', customerName: '客戶A', done: true, doneAt: TODAY })]);
  await app.reload();
  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  await expect(app.dialog()).toContainText('標記刪除');
});

test('D3c 擋著的是上個月沒結案的一筆＋下個月一筆 →「去批次取消」打開下個月（issues/17）', async ({ app, page }) => {
  const nextMonth = '2026-09-10';
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-q', name: '客戶A', phone: '0900000000' }),
    visit({ id: 'v-old', customerId: 'cust-q', customerName: '客戶A', date: addDays(TODAY, -7), status: 'confirmed', slots: [rehab('10:00')] }),
    visit({ id: 'v-next', customerId: 'cust-q', customerName: '客戶A', date: nextMonth, status: 'confirmed', slots: [rehab('16:00')] }),
  ]);
  await app.signIn('/customers/cust-q');

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  await expect(page.locator('.dialog-backdrop [data-ok]')).toHaveText('去批次取消');
  await app.ok();

  await expect(page).toHaveURL(/#\/schedule\/cancel$/);
  await app.settled();
  await expect(page.locator('#view'), '下個月那一段').toContainText('16:00');
  await expect(page.locator('#view'), '不是已經過了的那個月').not.toContainText('10:00');
});

test('D3d 擋著的只有已經過了、還沒結案的 → 按鈕是「知道了」，不換頁（issues/17）', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-q', name: '客戶A', phone: '0900000000' }),
    visit({ id: 'v-old', customerId: 'cust-q', customerName: '客戶A', date: addDays(TODAY, -7), status: 'confirmed', slots: [rehab('10:00')] }),
  ]);
  await app.signIn('/customers/cust-q');

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  expect(await app.dialogText()).toContain('簽療程單');
  await expect(page.locator('.dialog-backdrop [data-ok]')).toHaveText('知道了');
  await app.ok();
  await expect(page).toHaveURL(/#\/customers\/cust-q/);
});

test('D4 身上沒有還掛著的事 → 照舊刪得掉', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-q', name: '客戶A', phone: '0900000000' }),
    visit({
      id: 'v-q', customerId: 'cust-q', customerName: '客戶A', date: addDays(TODAY, -3), status: 'done',
      slots: [{ ...rehab('10:00'), status: 'done' }],
    }),
  ]);
  await app.signIn('/customers/cust-q');

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  await expect(app.dialog()).toContainText('標記刪除');
  await app.ok();
  await app.saved();
  expect((await app.readDoc('customers', 'cust-q')).deletedAt, '刪掉了').toBeTruthy();
  await expect(page, '回到客戶清單').toHaveURL(/#\/customers$/);
});
