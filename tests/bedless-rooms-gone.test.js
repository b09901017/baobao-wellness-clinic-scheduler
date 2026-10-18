// 點滴8、VIP7（沒選床位的那兩間）從種子刪掉（2026-10-18，staging-polish 10，ADR-0155）。
//
// 她的原話：
//
// > 你說「EECP體驗」那一門停用、不刪 … 包含你說的點滴8，vip7還多少，一樣，沒有舊資料的問題，刪掉之後幫我合併檔更新就好
// >
// > 不要在靠資料健檢處理，一開始匯入時就應該是好的，
//
// ADR-0127（10/6）把那兩間留在種子上、停用，當作「沒寫哪一床」的那一間。她現在一律從合併檔重新匯，沒有舊資料要顧，
// 所以兩間刪掉；**只寫點滴8、沒寫哪一床的（拍 Abovee、合併檔）→ 診間留空、講一句請她選**，不猜一間。
//
// 盯這幾件：
//
//   1. 種子上沒有那兩間、也沒有停用的列；排得到的照舊 22 間
//   2. 拍 Abovee「點滴室8」→ 空著＋那一句；「點滴室8床A」「治療室5」照舊
//   3. 合併檔「.8」→ 沒有診間＋報告一句；「.8A」照舊
//   4. 資料健檢（保險）：主檔上還有那兩間 → 沒有任何一段排在它上面就刪掉；有的話不刪
// 名字一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SEED } from '../public/js/domain/seed.js';
import { orderedRoomSlots, roomSlots } from '../public/js/domain/masterData.js';
import { roomFrom, bedMissingIn } from '../public/js/domain/abovee.js';
import { readAbovee, nearSay } from '../public/js/domain/aboveeImport.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { roomCapacityOf } from '../public/js/domain/visits.js';
import { reconcile, importJson, reportText, roomOf } from '../.claude/skills/calendar-sheet-merge/scripts/merge.mjs';

const TODAY = '2026-10-18';
/** 10/6～10/18 那一代的資料庫上那兩間（ADR-0127：停用、沒選床位） */
const PARENTS = [
  { id: 'room-iv8', name: '點滴8', type: '點滴室', shortName: '.8', capacity: 2, active: false },
  { id: 'room-vip7', name: 'VIP7', type: 'VIP室', shortName: 'vip7', active: false },
];
const withParents = (over = {}) => [...SEED.rooms, ...PARENTS.map((r) => ({ ...r, ...over }))];

describe('種子', () => {
  test('沒有點滴8、VIP7；排得到的 22 間；一列停用的都沒有', () => {
    const ids = SEED.rooms.map((r) => r.id);
    assert.ok(!ids.includes('room-iv8') && !ids.includes('room-vip7'));
    assert.equal(SEED.rooms.length, 22);
    assert.deepEqual(SEED.rooms.filter((r) => r.active === false), []);
    assert.equal(roomSlots(SEED.rooms).length, 22);
  });

  test('診間那一排沒有冒出停用的點滴8', () => {
    const drip = SEED.courses.find((c) => c.id === 'course-iv-drip');
    assert.ok(!orderedRoomSlots(drip, SEED.rooms).some((s) => /^點滴8$|^VIP7$/.test(s.label)));
  });

  test('撞期：8A 沒填同時幾位 → 1 位', () => {
    assert.equal(roomCapacityOf(SEED.rooms.find((r) => r.id === 'room-iv8a')), 1);
  });
});

describe('拍 Abovee 認診間', () => {
  const at = (roomText, resource = '') => roomFrom(roomText, resource, SEED.rooms)?.id ?? null;

  test('「點滴室8」「4樓休7」沒寫哪一床 → 空著，不猜一間', () => {
    assert.equal(at('點滴室8'), null);
    assert.equal(at('', '點滴8'), null);
    assert.equal(at('休息室7'), null);
    assert.equal(at('', '4樓休7'), null);
  });

  test('帶著床位的、其他間：照舊', () => {
    assert.equal(at('點滴室8床A'), 'room-iv8a');
    assert.equal(at('', '4樓休7b'), 'room-vip7b');
    assert.equal(at('治療室5'), 'room-t5');
    assert.equal(at('點滴室5'), 'room-iv5');
  });

  test('bedMissingIn：那一間拆成 A／B、照片上沒寫床 → 照片上的原字；其餘 null', () => {
    assert.equal(bedMissingIn('點滴室8', '', SEED.rooms), '點滴室8');
    assert.equal(bedMissingIn('', '4樓休7', SEED.rooms), '4樓休7');
    assert.equal(bedMissingIn('點滴室8床A', '', SEED.rooms), null);
    assert.equal(bedMissingIn('點滴室5', '', SEED.rooms), null);
    assert.equal(bedMissingIn('會議室', '', SEED.rooms), null);
    assert.equal(bedMissingIn('', '', SEED.rooms), null);
  });

  test('她的主檔上還有（或自己又建了）點滴8 → 認得它，不講那一句', () => {
    const rooms = withParents({ active: true });
    assert.equal(roomFrom('點滴室8', '', rooms)?.id, 'room-iv8');
    assert.equal(bedMissingIn('點滴室8', '', rooms), null);
  });

  const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源'];
  const DRIP = { id: 'e-drip', customerId: 'c-wang', type: 'single', label: '營養點滴', courseId: 'course-iv-drip', ivProductId: 'iv-liver', totalQty: 10 };
  const read = (roomText) => readAbovee([{ columns: COLS, rows: [['確認前往', '2026-10-20', '10:00 - 12:00', '王小明', '00001234', '營養點滴', roomText, '']] }], {
    customers: [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }],
    entitlementsBy: { 'c-wang': [DRIP] }, visitsBy: { 'c-wang': [] },
    master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
    today: TODAY,
  }).items[0];

  test('那一列：診間空著、收著也看得到「沒寫哪一床 —— 點開選一間」', () => {
    const item = read('點滴室8');
    assert.equal(item.roomId, null);
    assert.match(nearSay(item), /照片上寫「點滴室8」，沒寫哪一床/);
  });

  test('她選了一間之後那一句不講了；寫了床的那一列從頭到尾不講', () => {
    assert.doesNotMatch(nearSay({ ...read('點滴室8'), roomId: 'room-iv8a' }), /沒寫哪一床/);
    const ok = read('點滴室8床B');
    assert.equal(ok.roomId, 'room-iv8b');
    assert.doesNotMatch(nearSay(ok), /沒寫哪一床/);
  });
});

describe('合併檔', () => {
  const LABELS = ['Inbody', '復健門診', '物理諮詢', '營養諮詢', '體適能分析', '復能(1小時)', 'ILIB 60mins'];
  const sheetTsv = (a2) => [
    ['客戶名稱', '購買名稱', '療程內容', '應有次數', '實際次數', '9/11'].join('\t'),
    ...LABELS.map((label, i) => [i ? '' : a2, '', label, label === 'ILIB 60mins' ? 12 : 0, 0, label === 'ILIB 60mins' ? 'TRUE' : 'FALSE'].join('\t')),
  ].join('\n');
  const run = (title) => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-bedless-'));
    mkdirSync(join(dir, 'sheets'));
    writeFileSync(join(dir, 'sheets', '王小明.tsv'), sheetTsv('王小明'));
    writeFileSync(join(dir, 'cal.ics'), ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=Asia/Taipei:20260911T150000',
      `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'));
    return reconcile({ sheetsDir: join(dir, 'sheets'), icsPath: join(dir, 'cal.ics'), year: 2026, today: TODAY });
  };
  const roomOn = (r) => importJson(r).customers[0].visits[0].slots[0].roomName;

  test('roomOf：.8 → 沒有診間；.8A、點滴8床B → 那一間；.5 照舊', () => {
    assert.equal(roomOf('10.客戶A.8（躺）給35'), null);
    assert.equal(roomOf('10.客戶A IL.8'), null);
    assert.equal(roomOf('10.客戶A.8A給35'), '點滴8A');
    assert.equal(roomOf('10.客戶A點滴8床B'), '點滴8B');
    assert.equal(roomOf('3.30客戶A  .5雪'), '點滴5');
  });

  test('一段寫 IL.8：那一段 roomName 是 null、報告講一句；寫 IL.8A 的報告不講', () => {
    const r = run('3.王小明IL.8');
    assert.equal(roomOn(r), null);
    assert.match(reportText(r), /沒寫哪一床的點滴8　1 段/);
    const a = run('3.王小明IL.8A');
    assert.equal(roomOn(a), '點滴8A');
    assert.doesNotMatch(reportText(a), /沒寫哪一床/);
  });
});

describe('資料健檢（保險）：主檔上還有點滴8、VIP7', () => {
  const visit = (roomId, over = {}) => ({
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-09-10', status: 'done',
    slots: [{ entitlementId: null, courseId: 'course-iv-drip', startsAt: '10:00', endsAt: '12:00', roomId, bed: null, status: 'done' }], ...over,
  });
  const go = (rooms, visits = []) => runHealthCheck({
    customers: [{ id: 'c1', name: '客戶A', active: true }], entitlements: [], visits, tasks: [], availability: [],
    master: { ...SEED, rooms },
  }, TODAY).checks.find((c) => c.id === 'roomList').findings;
  const about = (rows, id) => rows.filter((f) => f.fix?.roomId === id || f.roomId === id);

  test('種子那一份：一列都不報', () => {
    assert.deepEqual(go(SEED.rooms.map((r) => ({ ...r }))), []);
  });

  test('停用著、沒有任何一段排在它上面 → 刪掉（兩間各一列）', () => {
    const rows = go(withParents());
    assert.deepEqual(rows.map((f) => [f.fix.mode, f.fix.roomId]), [['drop', 'room-iv8'], ['drop', 'room-vip7']]);
    assert.match(rows[0].detail, /點滴8A、點滴8B/);
  });

  test('有一段排在點滴8 上（停用著）→ 點滴8 不刪、不報；VIP7 照刪', () => {
    const rows = go(withParents(), [visit('room-iv8')]);
    assert.deepEqual(about(rows, 'room-iv8'), []);
    assert.deepEqual(about(rows, 'room-vip7').map((f) => f.fix.mode), ['drop']);
  });

  test('刪掉的來訪不算排在上面', () => {
    const rows = go(withParents(), [visit('room-iv8', { deletedAt: 'x' })]);
    assert.deepEqual(about(rows, 'room-iv8').map((f) => f.fix.mode), ['drop']);
  });

  test('還開著、有一段排在上面 → 停用（新排的選不到；那幾段照樣印得出來）', () => {
    const rows = go(withParents({ active: true }), [visit('room-iv8')]);
    assert.deepEqual(about(rows, 'room-iv8').map((f) => f.fix.mode), ['retire']);
  });

  test('她改過名字（拿去當別的用了）、已經刪掉：都不報', () => {
    assert.deepEqual(about(go(withParents({ name: '點滴大間' })), 'room-iv8'), []);
    assert.deepEqual(about(go(withParents({ deletedAt: 'x' })), 'room-iv8'), []);
  });
});
