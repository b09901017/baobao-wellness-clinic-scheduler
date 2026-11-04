#!/usr/bin/env node
// E2E 要開幾個 worker、每個 worker 連哪一組模擬器。
//
// **`E2E_WORKERS` 沒設或是 1 ＝ 以前那樣**：一組模擬器（平常的 port）、一個 worker，
// 這支只回 1，其餘的一個字都不做。大於 1 時**一個 worker 一整組模擬器**：
// 第 k 組的 port 是 `emulatorPortsFor(k)`、專案是 `projectIdFor(k)`，Hosting 只開在 0 號組。
//
// 為什麼不是幾個 worker 共用一組：2026-09-09 三個 worker 共用一顆 Firestore 模擬器，193 支紅 10 支，
// 全是搶那一顆 Java 行程（命名空間的隔離是好的，見 `playwright.config.js` 的 `workers` 那一段）。
// 一組一組分開之後 2／3 個 worker 都全過（客廳 e2e-speed skill 的 parallel-emulators.md）。
//
// 三個地方讀它：`playwright.config.js`（幾個 worker）、`fixtures/emulator.js`（這個 worker 連哪一組）、
// `start-emulators.sh`（開幾組、每組的設定檔、等它起好、收掉）。port 與專案的推導仍然只在
// `public/js/firebase-config.js` —— 這支只是把它們排成「第 k 組」。
//
//   node tests-e2e/emulator-groups.mjs workers       → 1（或 E2E_WORKERS 的值，不合法就丟例外）
//   node tests-e2e/emulator-groups.mjs config 1      → 寫第 1 組的設定檔，印它的絕對路徑
//   node tests-e2e/emulator-groups.mjs only 0        → 第 0 組要開哪幾種（逗號分隔）
//   node tests-e2e/emulator-groups.mjs stop          → 停掉所有組的 port 上在聽的行程（平常的 port 不碰）

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MAX_EMULATOR_SLOTS, emulatorPortsFor } from '../public/js/firebase-config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 幾個 worker。沒設、空字串 → 1；1～10 的整數 → 那個數；其餘丟例外
 * （打錯一個字就安靜地退回 1，她會以為開了平行而其實沒有）。
 *
 * @param {string|undefined} raw
 * @returns {number}
 */
export function workersFrom(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EMULATOR_SLOTS) {
    throw new Error(`E2E_WORKERS 要是 1～${MAX_EMULATOR_SLOTS} 的整數，拿到的是 ${String(raw)}`);
  }
  return n;
}

/** 一個 worker 一組模擬器嗎。 */
export const groupedFrom = (raw) => workersFrom(raw) > 1;

/**
 * 這個 worker 連第幾組。一組模擬器時回 `null`（＝平常的 port，`emulatorPortsFor(null)`），
 * 一個 worker 一組時回 `TEST_PARALLEL_INDEX`（0..workers-1，同時在跑的 worker 一人一號）。
 *
 * @param {string|undefined} workersRaw
 * @param {string|undefined} parallelIndex
 * @returns {string|null}
 */
export function portSlotFor(workersRaw, parallelIndex) {
  return groupedFrom(workersRaw) ? String(parallelIndex ?? 0) : null;
}

/** 第 k 組要開哪幾種模擬器。Hosting 是靜態檔，只開在 0 號組、大家共用。 */
export function servicesFor(k) {
  return ['auth', 'firestore', 'functions', ...(Number(k) === 0 ? ['hosting'] : []), 'storage'];
}

/**
 * 第 k 組的 firebase 設定：`firebase.json` 原樣，只換掉 `emulators` 那一段。
 * Hub、logging、Firestore 的 websocket 也要換 —— 不換的話第二組起不來（port 被第一組佔了）。
 *
 * @param {object} base `firebase.json` 的內容
 * @param {number|string} k
 */
export function groupConfig(base, k) {
  const p = emulatorPortsFor(k);
  return {
    ...base,
    emulators: {
      auth: { port: p.auth },
      firestore: { port: p.firestore, websocketPort: p.websocket },
      functions: { port: p.functions },
      ...(servicesFor(k).includes('hosting') ? { hosting: { port: p.hosting } } : {}),
      storage: { port: p.storage },
      hub: { port: p.hub },
      logging: { port: p.logging },
      ui: { enabled: false },
    },
  };
}

/**
 * 寫第 k 組的設定檔。**放在專案根目錄**：`firebase.json` 裡的相對路徑（`public`、`functions`、
 * `firestore.rules`）照設定檔所在的資料夾算。檔名在 `.gitignore` 裡（`/firebase.e2e-group-*.json`）。
 */
export function writeGroupConfig(k) {
  const base = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  const path = `${ROOT}firebase.e2e-group-${Number(k)}.json`;
  writeFileSync(path, `${JSON.stringify(groupConfig(base, k), null, 2)}\n`);
  return path;
}

/** 所有組可能用到的 port（0～9 組、每一種）。平常那一組的 port 一個都不在裡面。 */
export function allGroupPorts() {
  const out = new Set();
  for (let k = 0; k < MAX_EMULATOR_SLOTS; k += 1) {
    for (const port of Object.values(emulatorPortsFor(k))) out.add(port);
  }
  return out;
}

/**
 * 在這幾個 port 上聽的行程。Windows 讀 `netstat -ano`，其餘讀 `ss -ltnp`。
 * @param {Set<number>} ports
 * @returns {number[]}
 */
function listeningPids(ports) {
  const pids = new Set();
  if (process.platform === 'win32') {
    // 不帶 `-p TCP`：那樣只列 IPv4，聽在 `[::1]` 上的漏掉
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/.exec(line);
      if (m && ports.has(Number(m[1]))) pids.add(Number(m[2]));
    }
  } else {
    let out = '';
    try { out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' }); } catch { return []; }
    for (const line of out.split('\n')) {
      const port = /:(\d+)\s/.exec(line);
      if (!port || !ports.has(Number(port[1]))) continue;
      for (const m of line.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    }
  }
  pids.delete(0);
  return [...pids];
}

/** 停掉所有組的 port 上在聽的行程。回停了幾個。 */
export function stopGroups() {
  const pids = listeningPids(allGroupPorts());
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch { /* 已經自己結束了 */ }
  }
  return pids.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'workers') process.stdout.write(String(workersFrom(process.env.E2E_WORKERS)));
  else if (cmd === 'config') process.stdout.write(writeGroupConfig(arg));
  else if (cmd === 'only') process.stdout.write(servicesFor(arg).join(','));
  else if (cmd === 'stop') process.stdout.write(`停了 ${stopGroups()} 個在模擬器組 port 上聽的行程\n`);
  else {
    process.stderr.write('用法：emulator-groups.mjs workers | config <k> | only <k> | stop\n');
    process.exit(2);
  }
}
