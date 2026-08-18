// 復原的反向操作。SPEC 第 6.3 節。
//
// 這裡測的是「復原要寫回去什麼」，不是 Firestore 怎麼寫 ——
// 真正的寫入在 data/repo.js，它拿這裡算出來的東西去 commit。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { inverseOps, UNDO_NOTE } from '../public/js/domain/undo.js';

describe('復原的反向操作', () => {
  test('復原一次新增是標記刪除，不是硬刪除', () => {
    const ops = [{ op: 'create', path: 'visits', id: 'v1', data: { date: '2026-09-03' } }];
    const inverse = inverseOps(ops, [null]);

    assert.equal(inverse.length, 1);
    assert.equal(inverse[0].op, 'softDelete');
    assert.equal(inverse[0].path, 'visits');
    assert.equal(inverse[0].id, 'v1');
  });

  test('復原一次修改只還原這次動到的欄位，沒動到的不要碰', () => {
    const ops = [{ op: 'update', path: 'visits', id: 'v1', changes: { status: 'confirmed' } }];
    const before = { status: 'pending_confirm', date: '2026-09-03', customerName: '客戶甲' };

    const [inverse] = inverseOps(ops, [before]);
    assert.deepEqual(inverse.changes, { status: 'pending_confirm' });
  });

  test('本來不存在的欄位還原成 null —— Firestore 寫不進 undefined', () => {
    const ops = [{ op: 'update', path: 'visits', id: 'v1', changes: { cancelReason: '客人改時間' } }];
    const [inverse] = inverseOps(ops, [{ status: 'confirmed' }]);

    assert.deepEqual(inverse.changes, { cancelReason: null });
    assert.ok('cancelReason' in inverse.changes);
  });

  test('復原一次刪除就是把 deletedAt 清掉', () => {
    const ops = [{ op: 'softDelete', path: 'customers', id: 'c1' }];
    const [inverse] = inverseOps(ops, [{ name: '客戶甲', deletedAt: null }]);

    assert.equal(inverse.op, 'update');
    assert.deepEqual(inverse.changes, { deletedAt: null });
  });

  test('一批裡的每一筆都要有反向操作 —— 存來訪會連同額度計數一起寫', () => {
    const ops = [
      { op: 'create', path: 'visits', id: 'v1', data: { date: '2026-09-03' } },
      {
        op: 'update',
        path: 'customers/c1/entitlements',
        id: 'e1',
        changes: { doneCount: 0, bookedCount: 3 },
      },
    ];
    const inverse = inverseOps(ops, [null, { doneCount: 0, bookedCount: 2 }]);

    assert.equal(inverse.length, 2);
    assert.equal(inverse[0].op, 'softDelete');
    assert.deepEqual(inverse[1].changes, { doneCount: 0, bookedCount: 2 });
  });

  test('每一筆都標上記號，之後看稽核才知道是復原造成的', () => {
    const inverse = inverseOps(
      [{ op: 'update', path: 'visits', id: 'v1', changes: { status: 'done' } }],
      [{ status: 'confirmed' }],
    );
    assert.ok(inverse.every((o) => o.note === UNDO_NOTE));
  });

  test('算不出來就整批放棄 —— 半套的復原比沒有復原危險', () => {
    // 修改卻沒有寫入前的內容：還原不了，不能只還原另外那筆
    assert.equal(
      inverseOps(
        [
          { op: 'create', path: 'visits', id: 'v1', data: {} },
          { op: 'update', path: 'visits', id: 'v2', changes: { status: 'done' } },
        ],
        [null, null],
      ),
      null,
    );

    assert.equal(inverseOps([], []), null);
    assert.equal(inverseOps([{ op: 'update', path: 'v', id: 'x', changes: {} }], []), null);
    assert.equal(inverseOps([{ op: 'weird', path: 'v', id: 'x' }], [{}]), null);
  });
});
