// 四種單子的抄字格式（ADR-0099）：**這份格式有沒有任何一格，讓 AI 替她決定
// 一段來訪算哪個課程、或一位客戶是誰？**
//
// 格式在 `functions/transcripts/`，domain 那一份在 `public/js/domain/transcripts.js`。
// 兩份是兩個檔案（Function 部署時只帶自己的資料夾），這裡盯著它們一模一樣 ——
// 照 `tests/sheet-script.test.js` 盯 `SYNC_FORMAT` 的做法。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMON_PROPERTIES, KINDS, TRANSCRIPTS, promptFor, sanitize, schemaFor,
} from '../functions/transcripts/index.js';
import { ABOVEE_COLUMNS as FN_ABOVEE_COLUMNS } from '../functions/transcripts/aboveeList.js';
import {
  ABOVEE_COLUMNS, COMMON_FIELDS, TRANSCRIPT_FIELDS, TRANSCRIPT_KINDS,
} from '../public/js/domain/transcripts.js';

/** JSON Schema → domain 那一份的寫法。 */
function shapeOf(schema) {
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, shapeOf(v)]));
    case 'array':
      return [shapeOf(schema.items)];
    default:
      return schema.type;
  }
}

/** 走遍一份 schema 的每一個 key 與 description。 */
function walk(schema, visit, path = []) {
  if (schema.description) visit({ kind: 'description', text: schema.description, path });
  if (schema.type === 'object') {
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      visit({ kind: 'key', text: k, path: [...path, k] });
      walk(v, visit, [...path, k]);
    }
  }
  if (schema.type === 'array') walk(schema.items, visit, [...path, '[]']);
}

describe('兩份格式講同一句話', () => {
  test('四種都有，名字一樣', () => {
    assert.deepEqual([...KINDS].sort(), [...TRANSCRIPT_KINDS].sort());
  });

  for (const kind of TRANSCRIPT_KINDS) {
    test(`${kind}：functions 那一份的欄位跟 domain 那一份一模一樣`, () => {
      const { readable, unreadable, ...own } = shapeOf(schemaFor(kind));
      assert.deepEqual({ readable, unreadable }, COMMON_FIELDS);
      assert.deepEqual(own, TRANSCRIPT_FIELDS[kind]);
    });
  }

  test('Abovee 只抄的那九欄兩邊一樣，而且 schema 的列舉就是它', () => {
    assert.deepEqual([...FN_ABOVEE_COLUMNS], [...ABOVEE_COLUMNS]);
    assert.deepEqual(TRANSCRIPTS.aboveeList.schema.properties.columns.items.enum, [...ABOVEE_COLUMNS]);
  });
});

describe('規矩一：沒有任何 id、狀態、課程、器材的欄位', () => {
  for (const kind of KINDS) {
    test(kind, () => {
      const bad = [];
      walk(schemaFor(kind), ({ kind: k, text, path }) => {
        if (k !== 'key') return;
        // 帶 Text 結尾的是「照片上寫的字」（courseText），那是抄字不是判斷
        if (/Text$/.test(text)) return;
        if (text === 'id' || /Id$/.test(text) || /^(status|course|equipment|room|therapist|customer)$/i.test(text)) {
          bad.push(path.join('.'));
        }
      });
      assert.deepEqual(bad, []);
    });
  }
});

describe('規矩三：格式裡沒有任何一格在要個資', () => {
  const PERSONAL = /身分證|身份證|生日|電話|手機|卡號|末四碼|分期|銀行|發票/;

  for (const kind of KINDS) {
    test(`${kind}：key 與 description 都沒有`, () => {
      const bad = [];
      walk(schemaFor(kind), ({ text, path }) => {
        if (PERSONAL.test(text) || /phone|birth|idNumber|card|bank|invoice/i.test(text)) bad.push(path.join('.') || '(root)');
      });
      assert.deepEqual(bad, []);
    });
  }

  test('提示詞裡講「不要抄」的那幾種，訂購單一種都沒漏', () => {
    const p = promptFor('orderForm');
    for (const w of ['身分證字號', '電話', '生日', '分期', '末四碼', '發票號']) {
      assert.ok(p.includes(w), `訂購單的提示詞沒講不要抄「${w}」`);
    }
    assert.ok(promptFor('aboveeList').includes('電話'));
    assert.ok(promptFor('treatmentSheet').includes('簽名與章上面的名字'));
  });

  test('提示詞裡的例子一律王小明、1234（沒有第二個人名）', () => {
    for (const kind of KINDS) {
      const names = [...promptFor(kind).matchAll(/「([一-鿿]{3})」/g)].map((m) => m[1])
        .filter((n) => /^[王李陳林張黃吳劉蔡楊]/.test(n));
      for (const n of names) assert.equal(n, '王小明', `${kind} 的提示詞有一個不是王小明的名字`);
      for (const m of promptFor(kind).matchAll(/0{2,}\d{3,}/g)) assert.equal(m[0], '00001234');
    }
  });
});

describe('規矩二：數字與日期照寫成字串', () => {
  test('數量、金額、尾款、日期、序號、次數都是 string，不是 number', () => {
    const numbersAsNumber = [];
    for (const kind of KINDS) {
      walk(schemaFor(kind), ({ kind: k, text, path }) => {
        if (k === 'key' && /quantity|unpaid|date|Date|seq|price|Month/i.test(text)) {
          let node = schemaFor(kind);
          for (const p of path) node = p === '[]' ? node.items : node.properties[p];
          if (node.type !== 'string' && node.type !== 'array') numbersAsNumber.push(`${kind}.${path.join('.')}`);
        }
      });
    }
    assert.deepEqual(numbersAsNumber, []);
  });
});

describe('Function 回傳前照格式重組', () => {
  test('多出來的欄位（最上層與列裡面）都丟掉；數字被轉成字串', () => {
    const out = sanitize('orderForm', {
      readable: true,
      unreadable: [],
      customerName: '王小明',
      idNumber: 'A123456789',
      phone: '0912345678',
      packages: [{ printedName: '8萬筋骨強身', quantity: 1, amount: '80000', planId: 'plan-x' }],
      checkupTicked: ['12萬'],
      handwrittenRows: [],
    });
    assert.deepEqual(out, {
      readable: true,
      unreadable: [],
      customerName: '王小明',
      packages: [{ printedName: '8萬筋骨強身', quantity: '1' }],
      checkupTicked: ['12萬'],
      handwrittenRows: [],
    });
  });

  test('Abovee 的欄位名稱不在那九欄裡 → 丟掉（電話那一欄混不進來）', () => {
    const out = sanitize('aboveeList', {
      readable: true, unreadable: [], columns: ['姓名', '電話', '課程'], rows: [['王小明', 'x', 'SIS 60']],
    });
    assert.deepEqual(out.columns, ['姓名', '課程']);
  });

  test('readable 不是 true 就是 false；共同兩格一定在', () => {
    assert.deepEqual(sanitize('planFlyer', { readable: 'yes' }), { readable: false, unreadable: [] });
  });

  test('COMMON_PROPERTIES 就是 readable 與 unreadable 兩格', () => {
    assert.deepEqual(Object.keys(COMMON_PROPERTIES), ['readable', 'unreadable']);
  });
});
