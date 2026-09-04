// LINE 回覆模板。domain/messageTemplates.js。
//
// 這一支盯的是三件「看起來對、其實不對」的事：
//
//   1. **預設值變了而沒有人發現。** `tests/messages.test.js` 逐字盯著六則
//      產生的句子，這一支盯的是另一半：佔位符本身有沒有被打錯
//      （`{mounth}` 換不掉，而那一句看起來只是少了月份）
//   2. **她把一則刪光存檔** —— 那不該讓她從此複製到一則空訊息
//   3. **她把 `{name}` 打成 `{Name}`** —— 畫面上要看得到那五個字，
//      而不是安靜地少一個稱呼

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEMPLATES, VAR_LABELS, MAX_TEMPLATE,
  fill, textFor, defaultText, isCustom, validateTemplate, validateAll, toStored,
} from '../public/js/domain/messageTemplates.js';

describe('六則的形狀', () => {
  test('剛好六則，id 不重複', () => {
    assert.equal(TEMPLATES.length, 6);
    assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, 6);
  });

  test('每一則宣告的變數，在它自己的字裡真的出現過', () => {
    // 宣告了卻沒用到的話，設定頁上那顆丸子點下去會插一個永遠不會被換掉的洞
    for (const t of TEMPLATES) {
      for (const v of t.vars) {
        assert.ok(t.text.includes(`{${v}}`), `「${t.label}」宣告了 {${v}} 卻沒有用到`);
      }
    }
  });

  test('每一則字裡的佔位符，都有被宣告 —— 打錯字會在這裡紅', () => {
    for (const t of TEMPLATES) {
      for (const [, key] of t.text.matchAll(/\{(\w+)\}/g)) {
        assert.ok(t.vars.includes(key), `「${t.label}」用了沒有宣告的 {${key}}`);
      }
    }
  });

  test('每一個變數都有一句人話的說明', () => {
    for (const t of TEMPLATES) {
      for (const v of t.vars) assert.ok(VAR_LABELS[v], `{${v}} 沒有說明`);
    }
  });

  test('預設值都在上限裡面', () => {
    for (const t of TEMPLATES) assert.ok(t.text.length <= MAX_TEMPLATE, t.label);
  });
});

describe('把佔位符換掉', () => {
  test('換得掉，同一個出現兩次都換', () => {
    assert.equal(
      fill('{month} 月的課程，{month} 月哪幾天不方便？', { month: 9 }),
      '9 月的課程，9 月哪幾天不方便？',
    );
  });

  test('認不得的原樣留著 —— 她才看得出自己打錯了', () => {
    // 換成空字串的話那句話只是少了稱呼，而她不會知道為什麼
    assert.equal(fill('{Name}您好', { name: '客戶A' }), '{Name}您好');
    assert.equal(fill('{mounth} 月', { month: 9 }), '{mounth} 月');
  });

  test('值是空字串就真的換成空的（那是「沒有課程」的正常情況）', () => {
    assert.equal(fill('有{courses}課程', { courses: '' }), '有課程');
    assert.equal(fill('有{courses}課程', { courses: '營養點滴的' }), '有營養點滴的課程');
  });

  test('null 與空的都收得下', () => {
    assert.equal(fill(null, {}), '');
    assert.equal(fill('沒有洞', {}), '沒有洞');
    assert.equal(fill('{name}', {}), '{name}');
  });
});

describe('她改過的與預設值', () => {
  test('沒存過就給預設值', () => {
    assert.equal(textFor('ask', {}), defaultText('ask'));
    assert.equal(textFor('ask', undefined), defaultText('ask'));
  });

  test('存過就給她的', () => {
    assert.equal(textFor('ask', { ask: '自己的字' }), '自己的字');
  });

  test('存進去的空字串當作沒存過 —— 空訊息是她按了複製才發現的錯', () => {
    assert.equal(textFor('ask', { ask: '' }), defaultText('ask'));
    assert.equal(textFor('ask', { ask: '   ' }), defaultText('ask'));
  });

  test('認不得的 id 回空字串，不要丟例外', () => {
    assert.equal(defaultText('沒有這一則'), '');
    assert.equal(textFor('沒有這一則', {}), '');
  });

  test('「已改過」只在真的不一樣的時候才算', () => {
    assert.equal(isCustom('ask', {}), false);
    assert.equal(isCustom('ask', { ask: defaultText('ask') }), false);
    assert.equal(isCustom('ask', { ask: '  ' }), false);
    assert.equal(isCustom('ask', { ask: '別的字' }), true);
  });
});

describe('存檔前的檢查', () => {
  test('空的存不下去，而且講得出是哪一則', () => {
    const errors = validateTemplate('ask', '   ');
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('問這一輪的時間'));
  });

  test('太長存不下去', () => {
    assert.equal(validateTemplate('ask', 'x'.repeat(MAX_TEMPLATE + 1)).length, 1);
    assert.equal(validateTemplate('ask', 'x'.repeat(MAX_TEMPLATE)).length, 0);
  });

  test('**少了變數不擋** —— 畫面上的限制不可以比 domain 嚴', () => {
    // 她可能真的不想在提醒裡寫日期（自己補）。多擋一條她就存不下去，
    // 而那是這個 repo 踩過三次的同一個坑。
    assert.deepEqual(validateTemplate('reminder', '提醒您明天有課，謝謝。'), []);
    assert.deepEqual(validateTemplate('confirm', '這樣可以嗎？'), []);
  });

  test('整份檢查會把六則的錯都列出來', () => {
    const errors = validateAll({ ask: '', askWithLink: '' });
    // 六則裡有六則是空的（沒給的也算空）
    assert.equal(errors.length, 6);
  });
});

describe('要寫進資料庫的那一份', () => {
  test('跟預設值一樣的不存 —— 之後改預設值時她沒動過的會跟著更新', () => {
    const stored = toStored(Object.fromEntries(TEMPLATES.map((t) => [t.id, t.text])));
    assert.deepEqual(stored, {});
  });

  test('只存改過的那幾則', () => {
    const next = Object.fromEntries(TEMPLATES.map((t) => [t.id, t.text]));
    next.ask = '自己的字';
    assert.deepEqual(toStored(next), { ask: '自己的字' });
  });

  test('空的不存 —— 那等於回到預設', () => {
    assert.deepEqual(toStored({ ask: '   ' }), {});
  });

  test('前後空白去掉再比，多打一個空格不算改過', () => {
    assert.deepEqual(toStored({ ask: `  ${defaultText('ask')}  ` }), {});
  });
});
