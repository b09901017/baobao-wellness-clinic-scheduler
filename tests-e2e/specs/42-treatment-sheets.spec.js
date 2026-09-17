// 療程單的存放與搜尋（issue 14，ADR-0101、0105）。
//
// 她 2026-09-17：「我可以在這邊搜尋人名然後看到這個人的診療單…和之前的比如果是新增的話那就替換掉那張照片，
// 如果是不同的，那就新增照片」「療程單被新版取代時真的刪掉，反正有紙本正本」。
//
// 模擬器裡的 Function 不叫 Gemini，回 `fixtures/ai/treatmentSheet-*.json`（王小明、李小華）。
// 年份怎麼補、同一張怎麼判斷在 `tests/treatment-sheets.test.js`；Rules 在 `tests-e2e/rules/`。
// 這一支盯整條路、Storage 裡真的剩幾個檔案、文件真的寫了什麼。

import { test, expect } from '../fixtures/app.js';
import { customer, masterDocs } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';
import { PROJECT_ID, allowUser } from '../fixtures/emulator.js';

const BUCKET = `${PROJECT_ID}.firebasestorage.app`;
const STORAGE = `http://127.0.0.1:9199/v0/b/${BUCKET}/o`;
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' };
const OLD_PHOTO = 'treatmentSheets/cust-wang/s-old/1000.jpg';

const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];

// ---------- Storage 模擬器（owner 繞過 Rules，只給測試看「真的剩幾個檔案」）----------

async function storedUnder(prefix) {
  const res = await fetch(`${STORAGE}?prefix=${encodeURIComponent(prefix)}`, { headers: OWNER });
  if (!res.ok) throw new Error(`列不出 Storage ${res.status}`);
  return ((await res.json()).items ?? []).map((i) => i.name).sort();
}

async function putPhoto(path) {
  const res = await fetch(`${STORAGE}?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { ...OWNER, 'Content-Type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  if (!res.ok) throw new Error(`塞不進 Storage ${res.status}`);
}

async function clearStorage() {
  for (const name of await storedUnder('')) {
    // eslint-disable-next-line no-await-in-loop
    await fetch(`${STORAGE}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: OWNER });
  }
}

/** 把白名單整份拿掉（讓接下來那一次上傳被 Rules 擋），回傳原本的 uid 好放回去（同 40、41）。 */
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

// ---------- 資料 ----------

const EECP_ROWS = ['2026-07-01', '2026-07-03', '2026-07-08', '2026-07-10', '2026-07-15']
  .map((date, i) => ({ seq: String(i + 1), date, signed: true, equipmentIds: [] }));

const sheet = (id, over = {}) => ({
  path: 'customers/cust-wang/treatmentSheets', id,
  data: {
    customerId: 'cust-wang', customerName: '王小明', courseIds: ['course-eecp'], ivProductIds: [],
    courseName: 'EECP', courseText: 'EECP 體外反搏療程單', headerDate: '2026-05-14', rows: EECP_ROWS,
    photoPath: OLD_PHOTO, photoAt: '2026-07-16T02:00:00.000Z', stalePhotoPaths: [], ...over,
  },
});

function seed(extra = []) {
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: chart('1234') }),
    customer({ id: 'cust-lee', name: '李小華' }),
    sheet('s-old'),
    ...extra,
  ];
}

/** 療程單那一頁 → 右下角相機 → 相簿選幾張 → 送出 → 確認層。 */
async function photograph(page, fixtures) {
  await queueAi(fixtures);
  const files = [];
  for (const [i, name] of fixtures.entries()) {
    // eslint-disable-next-line no-await-in-loop
    files.push(await fakePhoto(`${name}-${i}.jpg`, { width: 900, height: 1200 }));
  }
  await page.locator('[data-sheet-camera]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles(files);
  await expect(page.locator('.cam__thumb')).toHaveCount(fixtures.length);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.tsl')).toBeVisible();
}

const card = (page, key) => page.locator(`[data-tsc-card="${key}"]`);

test.beforeEach(async () => {
  await clearStorage();
  await putPhoto(OLD_PHOTO);
});

test('T1 同一張多簽了幾列 → 新版：新照片傳上去、文件 8 列、舊照片檔真的刪掉；另一位是新的一張', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets');
  await expect(page.locator('[data-sheet-person="cust-wang"]')).toContainText('1 張');

  await photograph(page, ['treatmentSheet-eecp8', 'treatmentSheet-ilib']);

  // 王小明那一張：前 5 列一樣 → sameSheet() 說是新版
  const wang = card(page, 'p0');
  await expect(wang.locator('.tsc__who')).toHaveText('王小明');
  await expect(wang.locator('.tsc__tag')).toHaveText('新版');
  await expect(wang.locator('[data-tsc-kind="s-old"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(wang.locator('[data-tsc-kind="s-old"]')).toContainText('多了 3 列');
  await expect(wang.locator('.tsc__warn')).toContainText('舊的那張照片會刪掉');
  await expect(wang).toContainText('8 列・有簽 8 列');
  // 日期旁邊看得到照片上的原字（考試 54/62，要她看）
  await expect(wang.locator('[data-tsc-row="2"] .seen', { hasText: '7/8' })).toBeVisible();

  await wang.locator('[data-tsc-save]').click();
  await app.saved();
  // 存好一張之後這一層會重讀療程單、整層重畫一次；摘要那一行是重畫完才換的 —— 等它，再碰下一張卡
  await expect(page.locator('[data-tsc-sum]')).toContainText('存好 1 張');
  await expect(card(page, 'p0').locator('.tsc__tag')).toContainText('換好了');

  const oldFiles = await storedUnder('treatmentSheets/cust-wang/');
  expect(oldFiles, '新版存好之後那一張只剩一個檔案（舊的真的刪掉）').toHaveLength(1);
  expect(oldFiles[0]).not.toBe(OLD_PHOTO);
  const replaced = await app.readDoc('customers/cust-wang/treatmentSheets', 's-old');
  expect(replaced.rows).toHaveLength(8);
  expect(replaced.rows[5]).toEqual({ seq: '6', date: '2026-07-17', signed: true, equipmentIds: [] });
  expect(replaced.photoPath).toBe(oldFiles[0]);
  expect(replaced.stalePhotoPaths).toEqual([]);

  // 李小華那一張：app 裡沒有 → 新的一張，課程從「經皮靜脈雷射」認成 ILIB
  const lee = card(page, 'p1');
  await expect(lee.locator('.tsc__who')).toHaveText('李小華');
  await expect(lee.locator('.tsc__tag')).toHaveText('新的一張');
  await expect(lee.locator('[data-tsc-course="course-iv-laser"]')).toHaveAttribute('aria-pressed', 'true');
  await lee.locator('[data-tsc-save]').click();
  await app.saved();

  // 全部存好 → 這一層收起來，回到療程單那一頁（重畫過）
  await expect(page.locator('.tsl')).toHaveCount(0);
  await expect(page.locator('[data-sheet-person="cust-lee"]')).toContainText('1 張');
  expect(await storedUnder('treatmentSheets/cust-lee/')).toHaveLength(1);
  const [leeSheet] = await app.readAll('customers/cust-lee/treatmentSheets');
  expect(leeSheet.courseIds).toEqual(['course-iv-laser']);
  expect(leeSheet.rows.map((r) => r.date)).toEqual(['2026-06-05', '2026-06-12', '2026-06-19']);
  expect(JSON.stringify(leeSheet), '照片上的名字與編號不進資料庫').not.toContain('00005678');
});

test('T2 照片傳不上去 → 舊照片還在、文件沒變、講出來；放回白名單再存一次就好', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意拿掉白名單讓上傳失敗' });
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets');
  await photograph(page, ['treatmentSheet-eecp8']);

  const allowed = await revokeEveryone();
  await card(page, 'p0').locator('[data-tsc-save]').click();
  await expect(card(page, 'p0').locator('.tsc__fail')).toContainText('照片傳不上去', { timeout: 20_000 });
  await expect(card(page, 'p0').locator('.tsc__fail')).toContainText('舊的那一張沒有動到');
  expect(await storedUnder('treatmentSheets/cust-wang/')).toEqual([OLD_PHOTO]);
  expect((await app.readDoc('customers/cust-wang/treatmentSheets', 's-old')).rows).toHaveLength(5);

  for (const uid of allowed) await allowUser(uid); // eslint-disable-line no-await-in-loop
  await card(page, 'p0').locator('[data-tsc-save]').click();
  await app.saved();
  await expect(page.locator('.tsl')).toHaveCount(0);
  const files = await storedUnder('treatmentSheets/cust-wang/');
  expect(files).toHaveLength(1);
  expect(files[0]).not.toBe(OLD_PHOTO);
  expect((await app.readDoc('customers/cust-wang/treatmentSheets', 's-old')).rows).toHaveLength(8);
});

test('T3 名字跟編號對不上 → 不挑人，選了才存得了；新的一張不刪任何照片', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets');
  await photograph(page, ['treatmentSheet-renamed']);

  const c = card(page, 'p0');
  await expect(c.locator('.tsc__who')).toHaveText('還不知道是誰');
  // 跟 Abovee 那一層同一種講法（CONTEXT：「客戶編號」是 _Avoid_）
  await expect(c).toContainText('病歷號對上了，名字不一樣');
  await expect(c.locator('[data-tsc-save]')).toBeDisabled();
  await c.locator('[data-tsc-who="cust-wang"]').click();
  await expect(card(page, 'p0').locator('.tsc__who')).toHaveText('王小明');
  // 只有 2 列、既有的有 5 列 → 拿不準 → 新的一張
  await expect(card(page, 'p0').locator('.tsc__tag')).toHaveText('新的一張');
  await card(page, 'p0').locator('[data-tsc-save]').click();
  await app.saved();
  await expect(page.locator('.tsl')).toHaveCount(0);
  expect((await storedUnder('treatmentSheets/cust-wang/')).length).toBe(2);
  expect(await storedUnder('treatmentSheets/cust-wang/s-old/')).toEqual([OLD_PHOTO]);
});

test('T5 同一張連著換兩次（時鐘停著）→ 兩次都換得上去：照片檔名不能只靠時間', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets');

  for (const round of [1, 2]) {
    // eslint-disable-next-line no-await-in-loop
    await photograph(page, ['treatmentSheet-eecp8']);
    // eslint-disable-next-line no-await-in-loop
    await expect(card(page, 'p0').locator('.tsc__tag'), `第 ${round} 次`).toHaveText('新版');
    // eslint-disable-next-line no-await-in-loop
    await card(page, 'p0').locator('[data-tsc-save]').click();
    // eslint-disable-next-line no-await-in-loop
    await app.saved();
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator('.tsl')).toHaveCount(0);
  }
  const files = await storedUnder('treatmentSheets/cust-wang/s-old/');
  expect(files, '換了兩次還是只剩一個檔案').toHaveLength(1);
  expect((await app.readDoc('customers/cust-wang/treatmentSheets', 's-old')).photoPath).toBe(files[0]);
});

test('T4 那一位的頁面：看得到縮圖、點開全螢幕；照片不在的那一張講出來；刪掉一整張照片留著', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意少一個照片檔：瀏覽器會印那一次 404' });
  await app.seed(seed([sheet('s-gone', {
    courseIds: ['course-iv-laser'], courseName: 'ILIB', photoPath: 'treatmentSheets/cust-wang/s-gone/2000.jpg',
    rows: [{ seq: '1', date: '2026-08-01', signed: true, equipmentIds: [] }],
  })]));
  await app.signIn('/settings/treatment-sheets');
  await page.locator('[data-sheet-search]').fill('小明');
  await page.locator('[data-sheet-person="cust-wang"]').click();
  await app.settled();

  const old = page.locator('[data-sheet="s-old"]');
  await expect(old.locator('.tsheet__title')).toHaveText('EECP');
  await expect(old).toContainText('最後簽名 7/15');
  await expect(old.locator('[data-sheet-photo] img')).toBeVisible();
  await old.locator('[data-sheet-photo]').click();
  await expect(page.locator('.seenview')).toBeVisible();
  await page.locator('[data-seenview-close]').click();
  await expect(page.locator('.seenview')).toHaveCount(0);

  const gone = page.locator('[data-sheet="s-gone"]');
  await expect(gone.locator('[data-sheet-photo]')).toContainText('照片不在備份裡');

  await old.locator('[data-sheet-delete="s-old"]').click();
  await app.ok();
  await app.saved();
  await expect(page.locator('[data-sheet="s-old"]')).toHaveCount(0);
  expect((await app.readDoc('customers/cust-wang/treatmentSheets', 's-old')).deletedAt).toBeTruthy();
  expect(await storedUnder('treatmentSheets/cust-wang/s-old/'), '刪一整張的時候照片留著（還原得回來）').toEqual([OLD_PHOTO]);

  await app.go('/settings/trash');
  await expect(page.locator('.card', { hasText: '療程單' })).toContainText('王小明・EECP');
});
