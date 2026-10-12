// 合併檔：人員的名字不可以從客戶自己的名字裡認出來（2026-10-06，course-form-and-sheet/04 的牽連）。
//
// `merge.mjs` 讀種子的人員名單（連醫師），拿每一個名字對行事曆那一句做 `includes`。
// 種子補了「林」「宋」「簡」這幾位只有一個姓的醫師之後，拿她的真檔跑出來：**21 段被掛上林醫師** ——
// 每一段都是那個字在客戶自己的名字裡（課程是 EECP、ILIB、復能、健檢，沒有一門要醫師）。
//
// 同一批真檔上，真的寫了醫師的 8 段裡只有 1 段寫成「X醫師」，其餘是光寫一個姓 ——
// 所以不能改成「只認明寫的寫法」。規則是：**先把這位客戶的名字從那一句拿掉，再找人員。**
//
// 第二道：`residualNames()` 把認得的人員名字扣掉之後還剩中文字，才當成「寫的是別人」。
// 種子上一個字的名字自動進那份名單的話，`3.林IL治2` 會被當成沒寫名字 → 別人的療程補到這位客戶身上。
// 所以**一個字的名字要她在別名表的 `doctors` 列了才算**（她原本列的三位照舊）。
//
// 名字一律假名。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  reconcile, importJson, withoutNames, therapistOf,
} from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';
import { SEED } from '../public/js/domain/seed.js';

const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
const TODAY = '2026-10-06';

function sheetTsv(a2, { d = [0, 0, 0, 0, 0, 0, 0], dates, checks = {} }) {
  const cellsOf = (cells = []) => dates.map((_, i) => (cells[i] === true ? 'TRUE' : 'FALSE'));
  const out = [['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', ...dates].join('\t')];
  LABELS.forEach((label, i) => out.push([i ? '' : a2, '', label, d[i], 0, ...cellsOf(checks[label])].join('\t')));
  return out.join('\n');
}

/** events：[日期, 時間, 標題] */
function run(sheets, events, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'merge-staff-'));
  const sheetsDir = join(dir, 'sheets');
  mkdirSync(sheetsDir);
  for (const [name, spec] of Object.entries(sheets)) writeFileSync(join(sheetsDir, `${name}.tsv`), sheetTsv(name, spec));
  const icsPath = join(dir, 'cal.ics');
  const ymd = (date) => date.replace(/-/g, '');
  writeFileSync(icsPath, [
    'BEGIN:VCALENDAR',
    ...events.map(([date, time, title], i) => [
      'BEGIN:VEVENT', `UID:${i}`, `DTSTART;TZID=Asia/Taipei:${ymd(date)}T${time.replace(':', '')}00`,
      `SUMMARY:${title}`, 'END:VEVENT',
    ].join('\r\n')),
    'END:VCALENDAR',
  ].join('\r\n'));
  return importJson(reconcile({ sheetsDir, icsPath, year: 2026, today: TODAY, ...extra }));
}

const ilib = (name) => ({ [name]: { dates: ['9/11'], d: [0, 0, 0, 0, 0, 0, 12], checks: { 'ILIB 60mins': [true] } } });
const clinic = (name) => ({ [name]: { dates: ['9/11'], d: [0, 6, 0, 0, 0, 0, 0], checks: { 復健門診: [true] } } });
const recovery = (name) => ({ [name]: { dates: ['9/11'], d: [0, 0, 0, 0, 0, 12, 0], checks: { '復能(1小時)': [true] } } });
const slotOf = (file) => file.customers[0].visits[0]?.slots[0] ?? null;
const staff = SEED.staff.map((s) => ({ name: s.name, aka: [] }));

describe('種子上有這幾位（這一支的前提）', () => {
  test('一個姓的醫師：林、宋、簡；兩個字的治療師：怡婷', () => {
    for (const name of ['林', '宋', '簡', '夏', '怡婷', '騰崴']) {
      assert.ok(SEED.staff.some((s) => s.name === name), name);
    }
  });
});

describe('客戶自己的名字不是人員', () => {
  test('姓林的客戶做 ILIB：那一段沒有醫師', () => {
    const s = slotOf(run(ilib('林小美'), [['2026-09-11', '15:00', '3.林小美IL治2']]));
    assert.equal(s.startsAt, '15:00', '照舊配得到那一句');
    assert.equal(s.therapistName, null);
  });

  test('只寫了一個姓（`3.林IL治2`）：那個字就是她，不是林醫師', () => {
    const s = slotOf(run(ilib('林小美'), [['2026-09-11', '15:00', '3.林IL治2']]));
    assert.equal(s.startsAt, '15:00');
    assert.equal(s.therapistName, null);
  });

  test('名字裡剛好有一位治療師的名字（陳怡婷做復能）：不掛怡婷', () => {
    const s = slotOf(run(recovery('陳怡婷'), [['2026-09-11', '09:30', '9.30陳怡婷復能']]));
    assert.equal(s.startsAt, '09:30');
    assert.equal(s.therapistName, null);
  });
});

describe('真的寫了人員的照舊認得（她多半只寫一個姓）', () => {
  test('門診那一句後面寫了「夏」', () => {
    const s = slotOf(run(clinic('王小明'), [['2026-09-11', '14:00', '2.王小明復健門診夏']]));
    assert.equal(s.therapistName, '夏');
  });

  test('姓林的客戶、醫師是夏：掛夏不掛林', () => {
    const s = slotOf(run(clinic('林小美'), [['2026-09-11', '14:00', '2.林小美復健門診夏']]));
    assert.equal(s.therapistName, '夏');
  });

  test('姓夏的客戶、醫師也是夏：名字拿掉之後那個字還在', () => {
    const s = slotOf(run(clinic('夏小美'), [['2026-09-11', '14:00', '2.夏小美復健門診夏']]));
    assert.equal(s.therapistName, '夏');
  });

  test('名字裡有治療師的名字、後面又寫了另一位治療師', () => {
    const s = slotOf(run(recovery('陳怡婷'), [['2026-09-11', '09:30', '9.30陳怡婷復能 騰崴']]));
    assert.equal(s.therapistName, '騰崴');
  });

  test('一般的句子一個字都沒變', () => {
    const s = slotOf(run(recovery('王小明'), [['2026-09-11', '09:30', '9.30王小明復能 怡婷']]));
    assert.equal(s.therapistName, '怡婷');
  });
});

describe('withoutNames()', () => {
  test('拿掉的是那一句裡對得上的最長那一段；兩個字以上才拿', () => {
    assert.equal(therapistOf(withoutNames('3.林小美IL治2', ['林小美', '小美']), staff), null);
    assert.equal(therapistOf(withoutNames('2.林小美復健門診夏', ['林小美', '小美']), staff), '夏');
    // 沒給名字就是原本那一句
    assert.equal(therapistOf(withoutNames('3.林小美IL治2', []), staff), '林');
  });

  test('只沾到一個姓配上的：那個字只拿掉一次', () => {
    assert.equal(therapistOf(withoutNames('3.林IL治2', ['林小美'], { surname: '林' }), staff), null);
    assert.equal(therapistOf(withoutNames('2.夏復健門診夏', ['夏小美'], { surname: '夏' }), staff), '夏');
  });
});

describe('沒寫名字的那一句：一個字的姓不可以被當成「認得的雜訊」', () => {
  // 王小明 9/11 勾了 ILIB，行事曆上沒有一句寫他；那天有一句 `3.林IL治2`（一位姓林、不在舊表上的人）
  test('`3.林IL治2` 是別人的療程，不補到王小明身上', () => {
    const s = slotOf(run(ilib('王小明'), [['2026-09-11', '15:00', '3.林IL治2']]));
    assert.equal(s.startsAt, null, '補了就是憑空給他一個沒發生過的時間');
  });

  test('真的沒寫名字的（`3.IL治2`）照舊補得到，標成要她確認', () => {
    const s = slotOf(run(ilib('王小明'), [['2026-09-11', '15:00', '3.IL治2']]));
    assert.equal(s.startsAt, '15:00');
    assert.equal(s.confidence, 'low');
  });

  test('她在別名表的 doctors 列過的那個字照舊算認得的（`3.IL治2夏`）', () => {
    const s = slotOf(run(ilib('王小明'), [['2026-09-11', '15:00', '3.IL治2夏']], { doctors: ['夏'] }));
    assert.equal(s.startsAt, '15:00');
  });

  test('兩個字以上的種子名字照舊自動認得（`9.30復能 怡婷`）', () => {
    const s = slotOf(run(recovery('王小明'), [['2026-09-11', '09:30', '9.30復能 怡婷']]));
    assert.equal(s.startsAt, '09:30');
  });
});
