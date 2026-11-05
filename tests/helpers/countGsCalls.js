// 數 `sheets/readonly-report.gs` 一次推送叫 Google 幾次（用 appsScriptStub.js 的替身）。
//
// 三個數字（.scratch/sheet-push-gaps 第二輪）：
// - reads：讀試算表（getSheets、getValue、getMaxRows、getProtections…）
// - writes：寫試算表（setValue、merge、setBackground…；RangeList 的一個動作算一次）
// - writeThenRead：寫完又馬上讀 —— 最慢的那一種：Google 要先把前面排著的寫入全部做完才回答得了
// 另外數 props（文件屬性的讀寫：不是試算表、不會逼 Google 先把寫入做完，但每一次也是一趟）。
//
// `getRange`／`getRangeList` 只是拿一個參考，不打 Google，不算。
// 替身自己用的（at／set／get／addMerge／checkBounds）不是 Apps Script 的 API，不算。

const READ = /^(get|can|is)/;
const NOT_CALLS = new Set(['constructor', 'at', 'set', 'get', 'addMerge', 'checkBounds', 'getRange', 'getRangeList']);
const wrapped = new WeakSet();
let active = null;
let depth = 0;

function note(key, kind) {
  if (!active) return;
  active.byName[key] = (active.byName[key] ?? 0) + 1;
  if (kind === 'props') {
    active.props += 1;
    return;
  }
  if (kind === 'read') {
    active.reads += 1;
    if (active.pending) {
      active.writeThenRead += 1;
      active.pending = false;
    }
    return;
  }
  active.writes += 1;
  active.pending = true;
}

function wrapProto(proto, label) {
  if (wrapped.has(proto)) return;
  wrapped.add(proto);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (NOT_CALLS.has(name)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (typeof d.value !== 'function') continue;
    const orig = d.value;
    proto[name] = function counted(...args) {
      // 替身的 RangeList 是一塊一塊轉叫 Range 的：裡面那幾次不是 Apps Script 的呼叫，不算
      if (depth === 0) note(`${label}.${name}`, READ.test(name) ? 'read' : 'write');
      depth += 1;
      try {
        return orig.apply(this, args);
      } finally {
        depth -= 1;
      }
    };
  }
}

/**
 * 把替身的類別包起來（只包一次），回傳 `count(fn)`：跑 `fn()` 那一段的呼叫次數。
 *
 * @param {ReturnType<import('./appsScriptStub.js').loadAppsScript>} app
 */
export function callCounter(app) {
  const probe = app.ss.insertSheet('__probe');
  wrapProto(Object.getPrototypeOf(app.ss), 'Spreadsheet');
  wrapProto(Object.getPrototypeOf(probe), 'Sheet');
  wrapProto(Object.getPrototypeOf(probe.getRange(1, 1)), 'Range');
  wrapProto(Object.getPrototypeOf(probe.getRangeList(['A1'])), 'RangeList');
  wrapProto(Object.getPrototypeOf(probe.protect()), 'Protection');
  app.ss.deleteSheet(probe);

  const realProps = app.context.PropertiesService.getDocumentProperties;
  app.context.PropertiesService.getDocumentProperties = () => {
    const props = realProps();
    return Object.fromEntries(Object.entries(props).map(([k, fn]) => [k, (...args) => {
      note(`Properties.${k}`, 'props');
      return fn(...args);
    }]));
  };

  return function count(fn) {
    active = { reads: 0, writes: 0, writeThenRead: 0, props: 0, pending: false, byName: {} };
    let result;
    try {
      result = fn();
    } finally {
      const stats = active;
      active = null;
      delete stats.pending;
      stats.result = result;
      // eslint-disable-next-line no-unsafe-finally
      return stats;
    }
  };
}

/** 最多的那幾種（印給人看）。 */
export function topCalls(stats, n = 12) {
  return Object.entries(stats.byName).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k}=${v}`).join(' ');
}
