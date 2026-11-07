// 給營養品選到已經約好的那一包：改原本那一筆提醒，不長第二筆（.scratch/give-bag-once/issues/01）。
// 她 11/7 在 HTC 上點小工具的「給營養品」看到兩筆一樣的待辦。
// 拿**真的** `data/notes.js` ＋ `repo.js` 跑（Firestore 換成 `helpers/fakeFirestore.js`，同 notes-parity 那一支）。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

import { fromRoot } from './helpers/paths.js';

const FAKE_URL = pathToFileURL(fromRoot('tests/helpers/fakeFirestore.js')).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) return { url: FAKE_URL, shortCircuit: true };
    if (specifier === './firebase.js' && context.parentURL?.endsWith('/public/js/data/repo.js')) {
      return { url: FAKE_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const notes = await import('../public/js/data/notes.js');
const { fake } = await import(FAKE_URL);

const REMINDER = {
  text: '給客戶A營養品：夜態美', date: '2026-11-10', done: false, doneAt: null, deletedAt: null,
  customerId: 'c1', customerName: '客戶A', entitlementId: 'e1',
};
const GIVE = { text: '給客戶A營養品：夜態美＋GABA', customerId: 'c1', customerName: '客戶A', entitlementId: 'e1' };

const live = () => [...fake.store.entries()]
  .filter(([path, n]) => path.startsWith('notes/') && !n.deletedAt)
  .map(([path, n]) => ({ id: path.slice('notes/'.length), ...n }));
const openFor = (eid) => live().filter((n) => n.entitlementId === eid && !n.done);

beforeEach(() => fake.reset());

test('那一包已經有還沒勾的提醒：改那一筆（字換新的、選了日期就改日期），不長第二筆', async () => {
  fake.store.set('notes/r1', { ...REMINDER });
  const out = await notes.createOrMove({ ...GIVE, date: '2026-11-07' });
  assert.deepEqual(openFor('e1').map((n) => n.id), ['r1']);
  assert.equal(fake.store.get('notes/r1').date, '2026-11-07');
  assert.equal(fake.store.get('notes/r1').text, GIVE.text);
  assert.deepEqual({ id: out.id, moved: out.moved }, { id: 'r1', moved: true });
});

test('沒選日期：原本那一筆的日期留著（不是清掉）', async () => {
  fake.store.set('notes/r1', { ...REMINDER });
  await notes.createOrMove({ ...GIVE, date: null });
  assert.equal(fake.store.get('notes/r1').date, '2026-11-10');
  assert.equal(openFor('e1').length, 1);
});

test('寫之前重讀：畫面手上那一份沒有提醒、資料庫裡有，照樣改那一筆', async () => {
  // 打開泡泡之後別處（或上一下）才建的那一筆 —— 呼叫端不帶任何手上的清單，這一支自己讀
  fake.store.set('notes/r1', { ...REMINDER });
  await notes.createOrMove({ ...GIVE, date: '2026-11-07' });
  await notes.createOrMove({ ...GIVE, date: '2026-11-08' });
  assert.equal(openFor('e1').length, 1);
  assert.equal(fake.store.get('notes/r1').date, '2026-11-08');
});

test('那一包的提醒已經勾掉或刪掉了：建新的一筆', async () => {
  fake.store.set('notes/done1', { ...REMINDER, done: true, doneAt: '2026-11-01T00:00:00.000Z' });
  fake.store.set('notes/gone1', { ...REMINDER, deletedAt: { fake: 'ts' } });
  const out = await notes.createOrMove({ ...GIVE, date: '2026-11-07' });
  assert.equal(out.moved, false);
  assert.equal(openFor('e1').length, 1);
  assert.notEqual(openFor('e1')[0].id, 'done1');
  assert.equal(fake.store.get('notes/done1').done, true, '勾掉的那一筆一個字都不動');
});

test('別包的提醒、沒有掛一包的隨手記：照常建，不碰別的', async () => {
  fake.store.set('notes/r2', { ...REMINDER, entitlementId: 'e2' });
  fake.store.set('notes/n1', { text: '給客戶A營養品：夜態美', date: null, done: false, deletedAt: null, customerId: 'c1' });
  await notes.createOrMove({ ...GIVE, date: '2026-11-07' });
  await notes.createOrMove({ text: '給客戶A營養品：夜態美', customerId: 'c1', customerName: '客戶A' });
  assert.equal(openFor('e1').length, 1);
  assert.equal(fake.store.get('notes/r2').date, '2026-11-10');
  assert.equal(live().filter((n) => !n.entitlementId).length, 2, '沒掛一包的照舊多一筆（跟 create 一樣）');
});
