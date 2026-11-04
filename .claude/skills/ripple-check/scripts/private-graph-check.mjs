#!/usr/bin/env node
// 進圖之前的真名檢查網：列出 graphify 會讀的私人檔，每一份過一次專案的名字過濾網，
// 印出被遮掉的那幾行（印的是遮過之後的字，所以不會把真名印出來）。
//
// 用法（在專案根目錄）：node .claude/skills/ripple-check/scripts/private-graph-check.mjs [私人資料夾，預設 .local] [--redact <過濾網.mjs>]
// 過濾網沒給就找 <私人資料夾>/redact.mjs、<私人資料夾>/references/redact.mjs；都沒有就只列檔名，請逐份打開看。
// 過濾網的約定：從 stdin 讀、把名單上的字換掉、印到 stdout（例：寶寶專案的 .local/references/redact.mjs）。
//
// 怎麼看結果：被遮的是 session id、commit、帳號這種假警報就沒事；是人名、病歷號、電話 →
// 那一份不放進圖（從私人資料夾的 .graphifyignore 拿掉），或改寫成不帶真實值的版本。
// 有任何一行被遮，結束碼是 1（讓人一定會看一眼），不代表一定有真名。
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const ri = args.indexOf('--redact')
const redactArg = ri >= 0 ? args.splice(ri, 2)[1] : null
const root = resolve(args[0] ?? '.local')
const redactor = redactArg ?? [join(root, 'redact.mjs'), join(root, 'references', 'redact.mjs')].find(existsSync) ?? null

// graphify 自己的判斷：跟真的建圖時讀的是同一份清單
const pyFile = join('graphify-out', '.graphify_python')
const pythons = [existsSync(pyFile) ? readFileSync(pyFile, 'utf8').trim() : null, 'python3', 'python'].filter(Boolean)
const code = [
  'import json,sys',
  'from pathlib import Path',
  'from graphify.detect import detect',
  "r=detect(Path('.'))",
  "sys.stdout.buffer.write(json.dumps([f for v in r['files'].values() for f in v]).encode('utf-8'))",
].join('\n')
let all = null
for (const py of pythons) {
  try {
    all = JSON.parse(execFileSync(py, ['-I', '-c', code], { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true }))
    break
  } catch {}
}
if (!all) {
  console.log('叫不到 graphify（python -I -c "from graphify.detect import detect"）：先照 ripple-check「第一次在一個專案設定」裝好')
  process.exit(2)
}

const inside = all
  .map((f) => resolve(f))
  .filter((f) => f.startsWith(root + sep))
  .sort()
if (inside.length === 0) {
  console.log(`${relative('.', root)} 裡沒有任何一份會進圖`)
  process.exit(0)
}
console.log(`會進圖的私人檔 ${inside.length} 份${redactor ? '' : '（沒有過濾網：只列檔名，請逐份打開看）'}：`)

let flagged = 0
for (const f of inside) {
  const rel = relative('.', f).split(sep).join('/')
  if (!redactor) {
    console.log(`  ${rel}`)
    continue
  }
  const text = readFileSync(f, 'utf8')
  const masked = execFileSync('node', [redactor], { input: text, encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true })
  const a = text.split('\n')
  const b = masked.split('\n')
  const hits = []
  for (let i = 0; i < b.length; i++) {
    if (a[i] === b[i]) continue
    if (/^\s*originSessionId:/.test(a[i])) continue // 記憶檔的 frontmatter：session id 裡的數字一定被當成號碼遮
    hits.push(`    ${i + 1}: ${b[i].trim().slice(0, 100)}`)
  }
  if (a.length !== b.length) hits.push('    （過濾網改了行數，整份打開看）')
  if (hits.length === 0) console.log(`  ✓ ${rel}`)
  else {
    flagged++
    console.log(`  ⚠ ${rel}（${hits.length} 行被遮）`)
    for (const h of hits.slice(0, 8)) console.log(h)
    if (hits.length > 8) console.log(`    …還有 ${hits.length - 8} 行`)
  }
}
if (redactor) console.log(flagged ? `\n${flagged} 份有被遮的字：逐行看是不是假警報（id、帳號、日期），是真名就把那一份拿出圖` : '\n全部沒有名單上的字')
process.exit(flagged ? 1 : 0)
