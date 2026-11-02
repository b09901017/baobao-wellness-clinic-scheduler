#!/usr/bin/env node
// 私人資料夾的檢查網：列出還沒寫進目錄 README.md 的檔。只印檔名，不讀內容以外的東西、不印內容。
// 用法：node private-index-check.mjs [私人資料夾，預設 .local]
// 算「寫到了」：README 裡出現它的相對路徑、檔名，或它所在的任一層資料夾（例如 `claude-memory/`）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = process.argv[2] ?? '.local'
const readme = join(root, 'README.md')
if (!existsSync(readme)) {
  console.log(`${readme} 不存在：先照 ripple-check「掃哪些、不掃哪些」寫一份目錄`)
  process.exit(1)
}
const index = readFileSync(readme, 'utf8')

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else yield p
  }
}

const mentioned = (rel) => {
  const parts = rel.split('/')
  if (index.includes(rel) || index.includes(parts.at(-1))) return true
  for (let i = 1; i < parts.length; i++) {
    if (index.includes(parts.slice(0, i).join('/') + '/')) return true
  }
  return false
}

const missing = [...walk(root)]
  .map((p) => relative(root, p).split(sep).join('/'))
  .filter((rel) => rel !== 'README.md' && !mentioned(rel))
if (missing.length === 0) console.log('目錄都寫到了')
else {
  console.log(`目錄還沒寫到的 ${missing.length} 個檔（歸類後補進 ${readme}）：`)
  for (const rel of missing) console.log(`  ${rel}`)
}
