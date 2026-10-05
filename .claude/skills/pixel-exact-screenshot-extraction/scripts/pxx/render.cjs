// 用本機的 Chromium 以指定的字型與縮放把一批字串畫出來，輸出不壓縮的 BGR（給 numpy 比對）。
//   node render.cjs <spec.json> <輸出檔名前綴>     畫一批就結束
//   node render.cjs --serve                         瀏覽器開著不關：stdin 一行一個 {"spec":…,"out":…}，
//                                                   畫完在 stdout 回一行 ok 或 err <訊息>
// --serve 是 synth.py 用的那一種。開一次瀏覽器要一秒多；逐字讀取一格要畫幾十批、每批只有幾十到幾千個磁磚，
// 每批重開一次的話，九成的時間都花在開瀏覽器上。
// Playwright 從環境變數 PXX_NODE_MODULES 指的那個 node_modules 載入（synth.py 會找好再傳進來）。
const path = require('path');
const fs = require('fs');
const nm = process.env.PXX_NODE_MODULES;
const { chromium } = require(path.join(nm, 'playwright'));
// 解 PNG：有 pngjs 就用，沒有就借 Playwright 自己包的那一份（那是內部路徑，升版可能會搬家）
function loadPNG() {
  try { return require(path.join(nm, 'pngjs')).PNG; } catch (e) { /* 往下 */ }
  return require(path.join(nm, 'playwright-core', 'lib', 'utilsBundle')).PNG;
}
const PNG = loadPNG();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function renderOne(browser, spec, outPrefix) {
  // 每一批自己一個 context：deviceScaleFactor 與視窗大小是 context 的設定，而且這樣上一批不會留下任何東西
  const ctx = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dsf });
  try {
    const page = await ctx.newPage();
    // white-space:pre —— 不然連續的空白會被收成一個，字串尾巴的空白會不見
    const html = `<!doctype html><html lang="${spec.lang}"><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${spec.bg};}
      .t{position:absolute;white-space:pre;line-height:1;font-family:${spec.fontFamily};font-size:${spec.fontSizePx}px;color:${spec.color};font-weight:${spec.weight};${spec.extraCss || ''}}
    </style></head><body>${spec.items.map((it) => `<div class="t" style="left:${it.x}px;top:${it.y}px">${esc(it.text)}</div>`).join('')}</body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    // 等兩個畫格再拍：版面排完不等於像素畫完
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const buf = await page.screenshot({ type: 'png', timeout: 45000 });   // 函式庫模式預設沒有逾時，卡住就是永遠
    const png = PNG.sync.read(buf);
    const out = Buffer.alloc(png.width * png.height * 3);
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) { out[j] = png.data[i + 2]; out[j + 1] = png.data[i + 1]; out[j + 2] = png.data[i]; }
    fs.writeFileSync(`${outPrefix}__${png.width}x${png.height}.bgr`, out);
    if (spec.keepPng) fs.writeFileSync(`${outPrefix}.png`, buf);
  } finally {
    await ctx.close();
  }
}

const launch = (args) => chromium.launch({ headless: true, args: args || [] });

async function serve() {
  let browser = null; let browserArgs = null;
  const rl = require('readline').createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    chain = chain.then(async () => {
      try {
        const req = JSON.parse(line);
        const spec = JSON.parse(fs.readFileSync(req.spec, 'utf8'));
        const key = JSON.stringify(spec.args || []);
        if (!browser || key !== browserArgs) {   // 啟動參數是瀏覽器層級的：換了就要重開
          if (browser) await browser.close();
          browser = await launch(spec.args); browserArgs = key;
        }
        await renderOne(browser, spec, req.out);
        process.stdout.write('ok\n');
      } catch (e) {
        process.stdout.write('err ' + String(e && e.message ? e.message : e).replace(/\s+/g, ' ').slice(0, 500) + '\n');
      }
    });
  });
  // 上面那個 Python 行程不見了（stdin 關掉）就收工，不留一個沒人管的瀏覽器
  rl.on('close', () => { chain.then(async () => { if (browser) await browser.close(); process.exit(0); }); });
}

if (process.argv[2] === '--serve') {
  serve();
} else {
  (async () => {
    const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const browser = await launch(spec.args);
    await renderOne(browser, spec, process.argv[3]);
    await browser.close();
  })().catch((e) => { console.error(e); process.exit(1); });
}
