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
import { masterDocs } from '../fixtures/data.js';

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
