// 拿去識別化的樣本跑一次 dry-run，把 domain/legacyImport.js 真的會產出的
// 比對報告印出來。**不寫入任何東西** —— 這支跟 app 裡那顆「開始匯入」的差別
// 就是它連 Firestore 都沒有。
//
// 存在的理由：匯入器是照著 docs/legacy/README.md 寫的，那份文件描述的舊表
// 跟真的舊表有出入。改了解析器之後重跑這支，就知道 21 張表各自讀出了什麼、
// 哪幾格還是讀不懂 —— 在瀏覽器裡貼 21 次是做不到這件事的。
//
// 主檔用 domain/seed.js 的種子資料。她自己的 Firestore 裡可能已經改過名稱，
// 所以這份報告是「用種子主檔會怎樣」，不是「在她的資料庫裡會怎樣」。
//
// 用法：
//   node scripts/legacy-dry-run.mjs docs/legacy/samples [基準年]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSheet, planForSheet, reportText } from '../public/js/domain/legacyImport.js';
import { SEED } from '../public/js/domain/seed.js';

const dir = process.argv[2] ?? 'docs/legacy/samples';
const year = Number(process.argv[3] ?? 2026);

const ctx = {
  courses: SEED.courses,
  equipment: SEED.equipment,
  ivProducts: SEED.ivProducts,
  plans: SEED.plans,
  existingCustomers: [],
  year,
  importedAt: null,
};

const plans = readdirSync(dir)
  .filter((f) => f.endsWith('.tsv') && !f.includes('模板'))
  .sort((a, b) => a.localeCompare(b, 'zh-TW'))
  .map((file) => planForSheet(
    parseSheet(readFileSync(join(dir, file), 'utf8'), { sheetName: file.replace(/\.tsv$/, '') }),
    ctx,
  ));

process.stdout.write(reportText(plans, { year }));
process.stdout.write('\n');
