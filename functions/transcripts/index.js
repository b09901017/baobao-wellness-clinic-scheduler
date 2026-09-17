// 四種單子的抄字格式（ADR-0099）。**這是 AI 做得到什麼的唯一定義。**
//
// 三條規矩：
//   1. 沒有任何 id 欄位 —— 課程、器材、客戶、診間、治療師、狀態一律是「照片上寫的字」
//   2. 數字與日期照寫成字串（`"8萬"`、`"7/15"`），怎麼讀由 domain 決定
//   3. 永遠不抄：身分證字號、生日、電話、卡號、末四碼、分期、銀行、發票號、
//      章上的人名、簽名的內容（只抄「有沒有簽」）
//
// `public/js/domain/transcripts.js` 是同一份形狀的另一份檔案（Function 部署時只帶
// `functions/` 這個資料夾，所以不能共用一支）。兩邊由 `tests/ai-transcripts.test.js` 對齊。

import { orderForm } from './orderForm.js';
import { planFlyer } from './planFlyer.js';
import { aboveeList } from './aboveeList.js';
import { treatmentSheet } from './treatmentSheet.js';

/** 每一種都有的兩格。 */
export const COMMON_PROPERTIES = Object.freeze({
  readable: {
    type: 'boolean',
    description: '這張照片是不是這一種單子，而且看得清楚。不是的話其他欄位都留空。',
  },
  unreadable: {
    type: 'array',
    items: { type: 'string' },
    description: '哪幾格看不清楚或被擋住，用一句中文寫（例：「第三列的數量被便利貼蓋住」）。',
  },
});

export const TRANSCRIPTS = Object.freeze({ orderForm, planFlyer, aboveeList, treatmentSheet });

export const KINDS = Object.freeze(Object.keys(TRANSCRIPTS));

/** 給模型的 `responseJsonSchema`：那一種自己的欄位 ＋ 共同的兩格。 */
export function schemaFor(kind) {
  const t = TRANSCRIPTS[kind];
  if (!t) throw new Error(`沒有這一種單子：${kind}`);
  return {
    type: 'object',
    properties: { ...COMMON_PROPERTIES, ...t.schema.properties },
    required: ['readable', 'unreadable', ...(t.schema.required ?? [])],
  };
}

/** 給模型的提示詞。 */
export function promptFor(kind) {
  const t = TRANSCRIPTS[kind];
  if (!t) throw new Error(`沒有這一種單子：${kind}`);
  return t.prompt;
}

/**
 * 照格式把模型回來的東西**重新組一份**：格式裡沒有的欄位丟掉、型態不對的轉成對的或丟掉。
 * 模型偶爾不照 `responseJsonSchema` 走 —— 多吐一個 `courseId` 就是這裡擋下來的。
 *
 * @param {object} schema JSON Schema 的子集（object／array／string／boolean／number）
 * @param {unknown} value
 */
export function sanitizeBySchema(schema, value) {
  switch (schema?.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const out = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (value[key] === undefined || value[key] === null) continue;
        const v = sanitizeBySchema(sub, value[key]);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(value)) return [];
      return value.map((v) => sanitizeBySchema(schema.items, v)).filter((v) => v !== undefined);
    }
    case 'string': {
      let s;
      if (typeof value === 'string') s = value;
      else if (typeof value === 'number' && Number.isFinite(value)) s = String(value);
      else return undefined;
      // 列舉以外的字丟掉：Abovee 那九欄以外的欄位名稱不可以混進來
      if (Array.isArray(schema.enum) && !schema.enum.includes(s)) return undefined;
      return s;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    default:
      return undefined;
  }
}

/** 那一種單子的抄字，照格式重組一份。 */
export function sanitize(kind, value) {
  const out = sanitizeBySchema(schemaFor(kind), value);
  if (kind === 'aboveeList') alignAboveeRows(value, out);
  // 共同兩格一定要有：畫面靠 `readable` 決定要不要講「這張看起來不是訂購單」
  return { ...out, readable: out.readable === true, unreadable: out.unreadable ?? [] };
}

/**
 * Abovee 的列是「第幾格」對「第幾欄」（`domain/aboveeImport.js` 的 `tableOf()`）。
 * 上面那一圈丟掉九欄以外的欄位名稱時，**每一列同一個位置的那一格也要丟** ——
 * 只丟名稱的話後面的格子整排往左擠，電話那一格會變成「課程」送到手機上。
 */
function alignAboveeRows(raw, out) {
  if (!Array.isArray(raw?.rows) || !Array.isArray(out.rows)) return;
  const columns = Array.isArray(raw.columns) ? raw.columns : [];
  const kept = columns
    .map((c, i) => (sanitizeBySchema(aboveeList.schema.properties.columns.items, c) === undefined ? -1 : i))
    .filter((i) => i >= 0);
  // 一格壞掉（null、物件）也不可以被濾掉 —— 濾掉一樣是錯位。換成空字串，跟「那一格空白」同一種
  const cell = (v) => sanitizeBySchema({ type: 'string' }, v) ?? '';
  out.rows = raw.rows
    .filter((cells) => Array.isArray(cells))
    .map((cells) => kept.filter((i) => i < cells.length).map((i) => cell(cells[i])));
}
