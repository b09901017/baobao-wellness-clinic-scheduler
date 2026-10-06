// 診間：補治6、VIP1；點滴8A／8B、VIP7A／7B 是四間各自的診間（2026-10-06，issue 05，ADR-0127）。
//
// 她的原話：
//
// > 問題 8：好幫我補進去，並且
// > 點滴室8床A* 點滴室8床B* 休息室7床A*休息室7床B
// > 幫我算不同的診間可以記.8A .8B vip7A vip7B
//
// 再問她既有的「點滴8」「VIP7」怎麼辦，她回：
//
// > 其實可以刪，並且可舊來訪以及abovee辨識可以不選床位，沒選床位就寫.8，VIP7等等不要留空
//
// 所以點滴8 與 VIP7 留在主檔上當**「沒選床位」的那一間**：停用（新排的選不到），
// 但舊來訪照樣印得出 `.8`、拍 Abovee 沒寫床時認得到它 —— 不留空。
//
// **這不是把床位那一層加回來**（ADR-0079 照舊）：那四個本來就是四間，時段上的 `bed` 照舊不寫。
//
// 盯這幾件：
//
//   1. 這一行會不會讓既有來訪上的「點滴8」印不出名字？
//   2. 拍 Abovee 帶著床位的認成那一間；沒寫床的認成點滴8，**不是 null**
//   3. 舊來訪 點滴8＋床 A → 搬到 點滴8A；**8A 還沒建的時候不可以落到「清掉床位」**（A／B 沒了就搬不了家）

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SEED, seedData } from '../public/js/domain/seed.js';
import {
  validate, roomSlots, orderedRoomSlots, bedRoomOf, isBedlessOf,
} from '../public/js/domain/masterData.js';
import { roomFrom } from '../public/js/domain/abovee.js';
import { nameOf, fullNameOf } from '../public/js/domain/naming.js';
import { roomCapacityOf, validateVisit } from '../public/js/domain/visits.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { readAbovee, diffSay } from '../public/js/domain/aboveeImport.js';

const TODAY = '2026-10-06';
const room = (id) => SEED.rooms.find((r) => r.id === id);
const live = (rooms) => rooms.filter((r) => r.active !== false && !r.deletedAt);
const NEW = ['room-t6', 'room-vip1', 'room-iv8a', 'room-iv8b', 'room-vip7a', 'room-vip7b'];
const PARENTS = ['room-iv8', 'room-vip7'];
/** 2026-10-06 之前的診間主檔：沒有那六間，點滴8 與 VIP7 還開著。 */
const oldRooms = () => SEED.rooms.filter((r) => !NEW.includes(r.id)).map(({ active, ...rest }) => rest);
/** 照建議清單都建好、兩間都停用了的那一份（＝種子） */
const newRooms = () => SEED.rooms.map((r) => ({ ...r }));

describe('種子：22 間排得到的，跟 Abovee 的診間清單一樣', () => {
  test('治療室 6、點滴室 9、VIP 室 7', () => {
    const of = (type) => live(SEED.rooms).filter((r) => r.type === type).map((r) => r.name);
    assert.deepEqual(of('治療室'), ['治2', '治3', '治5', '治6', '治7', '治8']);
    assert.deepEqual(of('點滴室'), ['點滴2', '點滴3', '點滴5', '點滴6', '點滴7', '點滴8A', '點滴8B', '點滴9', '點滴10']);
    assert.deepEqual(of('VIP室'), ['VIP1', 'VIP2', 'VIP3', 'VIP5', 'VIP6', 'VIP7A', 'VIP7B']);
    assert.equal(live(SEED.rooms).length, 22);
  });

  test('簡寫：.8A .8B vip7A vip7B vip1；治6 沒有簡寫', () => {
    assert.deepEqual(['room-iv8a', 'room-iv8b', 'room-vip7a', 'room-vip7b', 'room-vip1'].map((id) => room(id).shortName),
      ['.8A', '.8B', 'vip7A', 'vip7B', 'vip1']);
    assert.equal(room('room-t6').shortName, undefined);
    // 月曆那一格印簡寫、設定頁與試算表印全名（`nameOf()`）
    assert.equal(nameOf(room('room-iv8a'), 'short'), '.8A');
    assert.equal(nameOf(room('room-vip7b'), 'short'), 'vip7B');
    assert.equal(fullNameOf(room('room-iv8a')), '點滴8A');
  });

  test('點滴8 與 VIP7 還在種子上，停用 —— 它們是「沒選床位」的那一間', () => {
    for (const id of PARENTS) {
      assert.ok(room(id), id);
      assert.equal(room(id).active, false, id);
    }
    assert.equal(room('room-iv8').shortName, '.8');
    assert.equal(room('room-vip7').shortName, 'vip7');
    assert.equal(SEED.rooms.length, 24);
  });

  test('每一間都存得下去', () => {
    for (const r of SEED.rooms) {
      assert.deepEqual(validate('rooms', r, { existing: SEED.rooms.filter((x) => x.id !== r.id) }), [], r.name);
    }
  });

  test('載入種子：沒寫的就是啟用，寫了停用的照寫的（`seedData()`）', () => {
    assert.equal(seedData(room('room-iv8a')).active, true);
    assert.equal(seedData(room('room-iv8')).active, false);
    assert.ok(!('id' in seedData(room('room-iv8a'))));
    // 載入種子與資料健檢「建起來」都走這一支，不各自寫 `active: true`
    const config = readFileSync(new URL('../public/js/data/config.js', import.meta.url), 'utf8');
    assert.match(config, /seedData\(/);
  });
});

describe('排班時選得到哪幾間', () => {
  test('那一排有 8A 與 8B，沒有點滴8 與 VIP7', () => {
    const labels = roomSlots(SEED.rooms).map((s) => s.label);
    assert.ok(labels.includes('點滴8A') && labels.includes('點滴8B'));
    assert.ok(labels.includes('VIP7A') && labels.includes('VIP7B'));
    assert.ok(!labels.includes('點滴8') && !labels.includes('VIP7'));
    assert.equal(labels.length, 22);
  });

  test('營養點滴（照類型排）：點滴室那九間排前面，8A、8B 在裡面', () => {
    const drip = SEED.courses.find((c) => c.id === 'course-iv-drip');
    const usual = orderedRoomSlots(drip, SEED.rooms).filter((s) => s.usual).map((s) => s.label);
    assert.equal(usual.length, 9);
    assert.ok(usual.includes('點滴8A') && usual.includes('點滴8B'));
  });

  // 停用點滴8 之後，打開一段還排在點滴8 的來訪：那一排要有它，不然一顆都沒按著，
  // 她只改記一句存一次，診間就安靜地沒了（`docs/邊界測試清單.md` C11-7）
  test('這一段現在指著的那一間就算停用也列出來，標得出是停用的', () => {
    const drip = SEED.courses.find((c) => c.id === 'course-iv-drip');
    const without = orderedRoomSlots(drip, SEED.rooms);
    assert.ok(!without.some((s) => s.roomId === 'room-iv8'));

    const kept = orderedRoomSlots(drip, SEED.rooms, { keep: 'room-iv8' });
    const mine = kept.find((s) => s.roomId === 'room-iv8');
    assert.deepEqual([mine.label, mine.retired], ['點滴8', true]);
    assert.equal(kept.length, without.length + 1);
    // 還開著的那一間、認不得的 id、已刪除的：都不多一顆
    assert.equal(orderedRoomSlots(drip, SEED.rooms, { keep: 'room-iv5' }).length, without.length);
    assert.equal(orderedRoomSlots(drip, SEED.rooms, { keep: 'room-gone' }).length, without.length);
    const deleted = SEED.rooms.map((r) => (r.id === 'room-iv8' ? { ...r, deletedAt: 'x' } : r));
    assert.equal(orderedRoomSlots(drip, deleted, { keep: 'room-iv8' }).length, without.length);
  });

  test('兩個入口都把現在那一間傳進去（來訪編輯器、拍 Abovee 的確認層）', () => {
    for (const file of ['ui/views/visitEditor.js', 'ui/components/aboveeConfirm.js']) {
      const src = readFileSync(new URL(`../public/js/${file}`, import.meta.url), 'utf8');
      assert.match(src, /orderedRoomSlots\([^)]*\{ keep: /, file);
    }
  });
});

describe('「沒選床位的那一間」與它拆出來的那幾間（`bedRoomOf()`、`isBedlessOf()`）', () => {
  test('點滴8＋A → 點滴8A；VIP7＋b → VIP7B；沒有那一間回 null', () => {
    assert.equal(bedRoomOf(room('room-iv8'), 'A', SEED.rooms)?.id, 'room-iv8a');
    assert.equal(bedRoomOf(room('room-vip7'), 'b', SEED.rooms)?.id, 'room-vip7b');
    assert.equal(bedRoomOf(room('room-iv5'), 'A', SEED.rooms), null);
    assert.equal(bedRoomOf(room('room-iv8'), 'C', SEED.rooms), null);
    assert.equal(bedRoomOf(room('room-iv8'), 'A', oldRooms()), null, '8A 還沒建');
  });

  test('照名字認：她自己建的「點滴8A」也算（id 不是種子的）', () => {
    const mine = [...oldRooms(), { id: 'her-8a', name: '點滴8A', type: '點滴室' }];
    assert.equal(bedRoomOf(room('room-iv8'), 'A', mine)?.id, 'her-8a');
  });

  test('點滴8 是 點滴8A 沒選床位的那一間；反過來不是；別間不是', () => {
    assert.equal(isBedlessOf(room('room-iv8'), room('room-iv8a')), true);
    assert.equal(isBedlessOf(room('room-iv8a'), room('room-iv8')), false);
    assert.equal(isBedlessOf(room('room-iv8'), room('room-vip7a')), false);
    assert.equal(isBedlessOf(null, room('room-iv8a')), false);
  });
});

describe('撞期：8A 與 8B 各是一間', () => {
  const slot = (roomId, over = {}) => ({
    courseId: 'course-iv-drip', entitlementId: 'e1', startsAt: '10:00', endsAt: '12:00', roomId, bed: null, status: 'confirmed', ...over,
  });
  const other = (roomId) => ({ id: 'v2', customerId: 'c2', customerName: '客戶B', date: '2026-10-10', status: 'confirmed', slots: [slot(roomId)] });
  const mine = (roomId) => ({ id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-10-10', status: 'confirmed', slots: [slot(roomId)] });
  // 撞期那幾句從存檔前的驗證出來（`validateVisit()` 的 warnings），只留講「已經排了／已經有」的
  const ENT = { id: 'e1', customerId: 'c1', type: 'single', label: '營養點滴', courseId: 'course-iv-drip', ivProductId: 'iv-liver', totalQty: 10 };
  const warn = (a, b) => validateVisit({ ...mine(a), slots: [{ ...slot(a), ivProductId: 'iv-liver' }] }, {
    customer: { flags: [] }, entitlements: [ENT], courses: SEED.courses, equipment: SEED.equipment,
    rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, customerVisits: [], sameDayVisits: [other(b)],
  }).warnings.filter((w) => /已經排了|已經有/.test(w));

  test('8A、8B 沒填同時幾位 → 各 1 位', () => {
    assert.equal(roomCapacityOf(room('room-iv8a')), 1);
    assert.equal(roomCapacityOf(room('room-iv8b')), 1);
  });

  test('同一個時間 8A 一位、8B 一位：不跳；8A 兩位：跳', () => {
    assert.deepEqual(warn('room-iv8a', 'room-iv8b'), []);
    assert.equal(warn('room-iv8a', 'room-iv8a').length, 1);
  });
});

// 存檔前那一句「一般排在 …，這次排在別間」問的是**這一間的類型排不排得進這門課**，不是它還開不開著。
// 點滴8 停用之後（它照舊是點滴室），每改一次還排在點滴8 的那一段都多跳一道提醒 —— E2E 53 的 R3 跑出來的
describe('停用的那一間不是「別間」', () => {
  const ENT = { id: 'e1', customerId: 'c1', type: 'single', label: '營養點滴', courseId: 'course-iv-drip', ivProductId: 'iv-liver', totalQty: 10 };
  const EECP = { id: 'e2', customerId: 'c1', type: 'single', label: 'EECP', courseId: 'course-eecp', totalQty: 10 };
  const warn = (slot, rooms = SEED.rooms) => validateVisit({
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-10-10', status: 'pending_confirm',
    slots: [{ startsAt: '10:00', endsAt: '12:00', bed: null, status: 'pending_confirm', ...slot }],
  }, {
    customer: { flags: [] }, entitlements: [ENT, EECP], courses: SEED.courses, equipment: SEED.equipment,
    rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, customerVisits: [], sameDayVisits: [],
  }).warnings.filter((w) => /排在別間/.test(w));
  const drip = (roomId) => ({ courseId: 'course-iv-drip', entitlementId: 'e1', ivProductId: 'iv-liver', roomId });

  test('營養點滴排在停用的點滴8（沒選床位）：不跳「這次排在別間」', () => {
    assert.deepEqual(warn(drip('room-iv8')), []);
  });

  test('營養點滴排在治療室：照舊跳，而且那一句列的是排得到的那幾間（沒有停用的）', () => {
    const [said] = warn(drip('room-t2'));
    assert.match(said, /點滴8A、點滴8B/);
    assert.doesNotMatch(said, /點滴8、|點滴8，/);
  });

  test('EECP（指定那三間）排在停用的 VIP7：照舊跳 —— 它本來就不在那三間裡', () => {
    assert.equal(warn({ courseId: 'course-eecp', entitlementId: 'e2', roomId: 'room-vip7' }).length, 1);
  });

  test('她自己停用的一間點滴室（不是床位那一種）也一樣不算別間', () => {
    const rooms = SEED.rooms.map((r) => (r.id === 'room-iv5' ? { ...r, active: false } : r));
    assert.deepEqual(warn(drip('room-iv5'), rooms), []);
  });

  test('刪掉的那一間照舊算別間（主檔上已經沒有它了）', () => {
    const rooms = SEED.rooms.map((r) => (r.id === 'room-iv5' ? { ...r, deletedAt: 'x' } : r));
    assert.equal(warn(drip('room-iv5'), rooms).length, 1);
  });
});

describe('拍 Abovee 認診間', () => {
  const at = (roomText, resource, rooms = SEED.rooms) => roomFrom(roomText, resource, rooms)?.id ?? null;

  test('帶著床位的認成那一間', () => {
    assert.equal(at('點滴室8床A', ''), 'room-iv8a');
    assert.equal(at('點滴室8床B', 'ILIB5'), 'room-iv8b');
    assert.equal(at(null, '點滴8A'), 'room-iv8a');
    assert.equal(at('休息室7床B', ''), 'room-vip7b');
    assert.equal(at('', '4樓休7A'), 'room-vip7a');
    assert.equal(at('', '4樓休7b'), 'room-vip7b', '小寫的床位也認');
  });

  test('沒寫床的認成「沒選床位」那一間（停用的也認）—— 不留空', () => {
    assert.equal(at('點滴室8', ''), 'room-iv8');
    assert.equal(at('', '點滴8'), 'room-iv8');
    assert.equal(at('休息室7', ''), 'room-vip7');
    assert.equal(at('', '4樓休7'), 'room-vip7');
  });

  test('還沒按資料健檢的資料庫（只有點滴8）：帶床位的照舊認成點滴8，不是 null', () => {
    assert.equal(at('點滴室8床B', '', oldRooms()), 'room-iv8');
    assert.equal(at('', '4樓休7A', oldRooms()), 'room-vip7');
  });

  test('新的兩間：治療室6、休息室1', () => {
    assert.equal(at('治療室6', ''), 'room-t6');
    assert.equal(at('休息室1', ''), 'room-vip1');
    assert.equal(at('', '4樓休1'), 'room-vip1');
  });

  test('別間寫了床位（主檔沒有那一間的 A／B）：照舊拿掉床位認那一間', () => {
    assert.equal(at('點滴室5床A', ''), 'room-iv5');
  });

  test('還開著的排在停用的前面：她把點滴8 重新啟用、又另外停用了 8A', () => {
    const rooms = SEED.rooms.map((r) => {
      if (r.id === 'room-iv8') return { ...r, active: true };
      if (r.id === 'room-iv8a') return { ...r, active: false };
      return r;
    });
    assert.equal(at('點滴室8床A', '', rooms), 'room-iv8', '8A 停用了 → 拿掉床位、認還開著的點滴8');
  });

  test('刪掉的不認：她真的把點滴8 刪了，沒寫床的那一格就是認不得', () => {
    const rooms = SEED.rooms.map((r) => (r.id === 'room-iv8' ? { ...r, deletedAt: 'x' } : r));
    assert.equal(at('點滴室8', '', rooms), null);
    assert.equal(at('點滴室8床A', '', rooms), 'room-iv8a');
  });

  test('她記在主檔上的寫法照舊最優先', () => {
    const rooms = SEED.rooms.map((r) => (r.id === 'room-iv9' ? { ...r, aboveeNames: ['點滴室8床A'] } : r));
    assert.equal(at('點滴室8床A', '', rooms), 'room-iv9');
  });

  test('原本認得的一個都沒變', () => {
    assert.equal(at('治療室5', ''), 'room-t5');
    assert.equal(at('點滴室10', ''), 'room-iv10');
    assert.equal(at('', 'I1點10'), 'room-iv10');
    assert.equal(at('', 'I2治2'), 'room-t2');
    assert.equal(at('休息室3', ''), 'room-vip3');
    assert.equal(at('', '4樓休2'), 'room-vip2');
    assert.equal(at('', 'EECP1'), null);
    assert.equal(at('會議室', ''), null);
  });
});

describe('拍 Abovee：已經記了的那一段，診間「不一樣」嗎', () => {
  const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源'];
  const ILIB = { id: 'w-ilib', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 10 };
  const ctx = (roomId) => ({
    customers: [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }],
    entitlementsBy: { 'c-wang': [ILIB] },
    visitsBy: { 'c-wang': [{
      id: 'v1', customerId: 'c-wang', date: '2026-09-10', status: 'pending_confirm', updatedAt: 't1',
      slots: [{ entitlementId: 'w-ilib', courseId: 'course-iv-laser', startsAt: '14:00', endsAt: '15:00', roomId, bed: null, status: 'pending_confirm' }],
    }] },
    master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
    today: '2026-09-01',
  });
  const read = (roomText, roomId) => {
    const c = ctx(roomId);
    const [item] = readAbovee([{ columns: COLS, rows: [['確認前往', '2026-09-10', '14:00 - 15:15', '王小明', '00001234', 'ILIB 60', roomText, 'ILIB4']] }], c).items;
    return { item, c };
  };

  test('app 上是點滴8（沒選床位）、Abovee 寫床 A → 講得出不一樣，可以改成 8A', () => {
    const { item, c } = read('點滴室8床A', 'room-iv8');
    assert.deepEqual(item.diffs, [{ field: 'roomId', app: 'room-iv8', abovee: 'room-iv8a' }]);
    assert.equal(diffSay(item.diffs[0], c.master), '診間：app 是 點滴8、Abovee 是 點滴8A');
  });

  // 反過來不算不一樣：Abovee 那一格沒寫床只是比較不精確，按「改成 Abovee 的」會把她選好的床弄丟
  test('app 上是 8A、Abovee 沒寫床（認成點滴8）→ 不算不一樣', () => {
    const { item } = read('點滴室8', 'room-iv8a');
    assert.equal(item.kind, 'recorded');
    assert.equal(item.diffs, null);
  });

  test('app 上是 8A、Abovee 寫床 B → 不一樣', () => {
    const { item } = read('點滴室8床B', 'room-iv8a');
    assert.deepEqual(item.diffs, [{ field: 'roomId', app: 'room-iv8a', abovee: 'room-iv8b' }]);
  });
});

describe('資料健檢：診間清單跟建議的不一樣', () => {
  const go = (rooms) => runHealthCheck({
    customers: [], entitlements: [], visits: [], tasks: [], availability: [],
    master: { ...SEED, rooms },
  }, TODAY).checks.find((c) => c.id === 'roomList').findings;

  test('種子那一份（都建好、兩間停用）一列都不報', () => {
    assert.deepEqual(go(newRooms()), []);
  });

  test('10/6 之前的主檔：六間要建、點滴8 與 VIP7 要停用；建的排在停用的前面', () => {
    const rows = go(oldRooms());
    assert.deepEqual(rows.map((f) => [f.fix.mode, f.fix.roomId]), [
      ['add', 'room-t6'], ['add', 'room-iv8a'], ['add', 'room-iv8b'],
      ['add', 'room-vip1'], ['add', 'room-vip7a'], ['add', 'room-vip7b'],
      ['retire', 'room-iv8'], ['retire', 'room-vip7'],
    ]);
    for (const f of rows.filter((x) => x.fix.mode === 'add')) {
      assert.equal(f.fix.data.active, true);
      assert.deepEqual(validate('rooms', f.fix.data, { existing: oldRooms() }), [], f.title);
    }
    assert.equal(rows.find((f) => f.fix.roomId === 'room-iv8a').fix.data.shortName, '.8A');
  });

  test('停用那一列講得出代價：排班選不到、舊來訪照樣印得出來', () => {
    const f = go(oldRooms()).find((x) => x.fix.roomId === 'room-iv8');
    assert.equal(f.fix.kind, 'applyRoom');
    assert.equal(f.title, '點滴8');
    assert.match(f.detail, /點滴8A、點滴8B/);
    assert.match(f.detail, /停用/);
    assert.doesNotMatch(f.detail, /刪/);
  });

  test('她改過名字（拿去當別的用了）、已經停用、已經刪掉：都不報停用', () => {
    const with8 = (change) => oldRooms().map((r) => (r.id === 'room-iv8' ? { ...r, ...change } : r));
    for (const change of [{ name: '點滴室大間' }, { active: false }, { deletedAt: 'x' }]) {
      assert.ok(!go(with8(change)).some((f) => f.fix?.roomId === 'room-iv8'), JSON.stringify(change));
    }
  });

  test('她的主檔上沒有點滴8：不會被「建」一間停用的', () => {
    const rows = go(oldRooms().filter((r) => r.id !== 'room-iv8'));
    assert.ok(!rows.some((f) => f.fix.roomId === 'room-iv8'));
  });

  test('她自己已經建了一間同名的 點滴8A：不再建', () => {
    const rows = go([...oldRooms(), { id: 'her-8a', name: '點滴8A', type: '點滴室' }]);
    assert.ok(!rows.some((f) => f.fix.roomId === 'room-iv8a'));
    assert.ok(rows.some((f) => f.fix.roomId === 'room-iv8b'));
  });

  test('一間種子診間都沒有的主檔不念', () => {
    assert.deepEqual(go([{ id: 'room-mine', name: '我的房間', type: '治療室' }]), []);
  });

  test('畫面與寫入兩側都認得「停用」那一種', () => {
    const data = readFileSync(new URL('../public/js/data/health.js', import.meta.url), 'utf8');
    assert.match(data, /fix\.mode === 'retire'/);
    assert.match(data, /active: false/);
    const ui = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');
    assert.match(ui, /retire: /);
  });
});

describe('資料健檢：來訪上還記著床位', () => {
  const slot = (over = {}) => ({
    entitlementId: 'e1', courseId: 'course-iv-drip', ivProductId: 'iv-liver', startsAt: '10:00', endsAt: '12:00',
    roomId: 'room-iv8', bed: 'A', attended: true, status: 'done', note: '記一句', ...over,
  });
  const visit = (slots, over = {}) => ({
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-09-10', status: 'done', slots, ...over,
  });
  const go = (visits, rooms = newRooms()) => runHealthCheck({
    customers: [{ id: 'c1', name: '客戶A', active: true }], entitlements: [], visits, tasks: [], availability: [],
    master: { ...SEED, rooms },
  }, TODAY).checks.find((c) => c.id === 'slotBeds').findings;

  test('點滴8 床 A、8A 已經在主檔上 → 搬到 點滴8A；除了 roomId 與 bed 一個字都沒變', () => {
    const before = slot();
    const [f] = go([visit([before])]);
    assert.equal(f.fix.kind, 'moveBedToRoom');
    assert.equal(f.fix.visitId, 'v1');
    assert.match(f.detail, /搬到 點滴8A/);
    assert.deepEqual(f.fix.slots, [{ ...before, roomId: 'room-iv8a', bed: null }]);
  });

  test('VIP7 床 b（小寫）→ VIP7B；已完成的那一筆照樣搬', () => {
    const [f] = go([visit([slot({ roomId: 'room-vip7', bed: 'b' })])]);
    assert.equal(f.fix.kind, 'moveBedToRoom');
    assert.equal(f.fix.slots[0].roomId, 'room-vip7b');
    assert.equal(f.fix.slots[0].status, 'done');
  });

  // 落到「清掉」那一條的話，她一按 A／B 就永遠沒了、之後搬不了家
  test('8A 還沒建的時候：那一列沒有按鈕，講先去建，床位記號還在', () => {
    const [f] = go([visit([slot()])], oldRooms());
    assert.equal(f.fix, null);
    assert.match(f.detail, /診間清單/);
    assert.match(f.detail, /點滴8A/);
  });

  test('別間的床位、認不得的字：照舊是清掉', () => {
    const [a] = go([visit([slot({ roomId: 'room-iv5', bed: 'A' })])]);
    assert.equal(a.fix.kind, 'clearBeds');
    assert.deepEqual([a.fix.slots[0].roomId, a.fix.slots[0].bed], ['room-iv5', null]);
    const [b] = go([visit([slot({ bed: 'C' })])]);
    assert.equal(b.fix.kind, 'clearBeds');
    assert.deepEqual([b.fix.slots[0].roomId, b.fix.slots[0].bed], ['room-iv8', null]);
  });

  test('一筆來訪一列：一段搬、一段清，同一顆做完', () => {
    const v = visit([slot(), slot({ roomId: 'room-iv5', bed: 'B', startsAt: '13:00' })]);
    const rows = go([v]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fix.kind, 'moveBedToRoom');
    assert.deepEqual(rows[0].fix.slots.map((s) => [s.roomId, s.bed]), [['room-iv8a', null], ['room-iv5', null]]);
    assert.match(rows[0].detail, /搬到 點滴8A/);
    assert.match(rows[0].detail, /清掉床位 B/);
  });

  test('同一筆裡有一段還搬不了（那一間還沒建）：整筆先不給按，別段也不清', () => {
    const v = visit([slot(), slot({ roomId: 'room-iv5', bed: 'B', startsAt: '13:00' })]);
    const [f] = go([v], oldRooms());
    assert.equal(f.fix, null);
  });

  test('她自己建的那一間 點滴8A（id 不是種子的）也搬得過去', () => {
    const rooms = [...oldRooms(), { id: 'her-8a', name: '點滴8A', type: '點滴室' }];
    const [f] = go([visit([slot()])], rooms);
    assert.equal(f.fix.slots[0].roomId, 'her-8a');
  });

  test('沒記床位、還排在點滴8 的段不念 —— 沒選床位就是 .8', () => {
    assert.deepEqual(go([visit([slot({ bed: null })])]), []);
  });

  test('畫面與寫入兩側都認得「搬到那一間」', () => {
    const data = readFileSync(new URL('../public/js/data/health.js', import.meta.url), 'utf8');
    assert.match(data, /fix\?\.kind === 'moveBedToRoom'/);
    const ui = readFileSync(new URL('../public/js/ui/views/health.js', import.meta.url), 'utf8');
    assert.ok(ui.includes("moveBedToRoom: 'slotBeds'"));
  });
});
