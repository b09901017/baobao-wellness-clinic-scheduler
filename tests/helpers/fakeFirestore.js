// 替身：gstatic 的 Firestore SDK 與 `public/js/data/firebase.js`（只有 `getDb`／`getAuthInstance`）。
//
// 給隨手記的情境檔（`tests/fixtures/notes-parity.json` 的 `writes`）用：拿**真的** `data/notes.js` ＋ `data/repo.js` 跑一次，
// 記下 `writeBatch()` 收到的每一筆 —— Android 那一份（`android/core` 的 `NotesWriter`）要寫出一模一樣的東西（ADR-0180）。
// 只做那兩支用得到的：`doc`／`collection`／`getDoc`／`getDocs`（`where ==`）／`writeBatch`／`serverTimestamp`。
// 載入的方法在 `notesParity.js`（`registerHooks()` 把 gstatic 的網址與 repo.js 的 `./firebase.js` 接到這一支）。

/** 寫進去時換成伺服器時間的那個記號。 */
export const SERVER = Object.freeze({ fake: 'serverTimestamp' });

/** Firestore 的 Timestamp：`String()` 跟 SDK 的一樣（`sortNotes()` 拿它比字串）。 */
export class FakeTs {
  constructor(seconds, nanoseconds) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toString() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
}

export const fake = {
  /** 'notes/n1' → 資料（不含 id） */
  store: new Map(),
  /** `writeBatch()` 收到的，照順序：{ op: 'set'|'update', path, data } */
  writes: [],
  uid: 'u-test',
  seq: 0,
  reset({ store = new Map(), uid = 'u-test' } = {}) {
    this.store = store;
    this.writes = [];
    this.uid = uid;
    this.seq = 0;
  },
};

function clone(v) {
  if (v === SERVER || v instanceof FakeTs) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

// ---------- firebase.js ----------

export const getDb = () => ({ fake: 'db' });
export const getAuthInstance = () => ({
  authStateReady: async () => {},
  get currentUser() {
    return { uid: fake.uid };
  },
});

// ---------- firebase-firestore.js ----------

export const collection = (_db, path) => ({ kind: 'collection', path });

export function doc(parent, path, id) {
  if (parent?.kind === 'collection') {
    fake.seq += 1;
    const auto = `gen-${fake.seq}`;
    return { path: `${parent.path}/${auto}`, id: auto };
  }
  return { path: `${path}/${id}`, id };
}

function snapOf(path, id) {
  const data = fake.store.get(path);
  return {
    id,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : clone(data)),
    get: (field) => data?.[field],
    metadata: { fromCache: false },
  };
}

export async function getDoc(ref) {
  return snapOf(ref.path, ref.id);
}

export const where = (field, op, value) => ({ type: 'where', field, op, value });
export const orderBy = (field, dir) => ({ type: 'orderBy', field, dir });
export const limit = (n) => ({ type: 'limit', n });
export const query = (col, ...clauses) => ({ path: col.path, clauses });

export async function getDocs(q) {
  const prefix = `${q.path}/`;
  const docs = [];
  for (const [path, data] of fake.store) {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
    const ok = q.clauses.every((c) => c.type !== 'where'
      || (c.op === '==' && Object.prototype.hasOwnProperty.call(data, c.field) && data[c.field] === c.value));
    if (ok) docs.push(snapOf(path, path.slice(prefix.length)));
  }
  return { docs, metadata: { fromCache: false } };
}

export const getDocsFromCache = getDocs;
export const collectionGroup = () => {
  throw new Error('替身沒有 collectionGroup');
};

export const serverTimestamp = () => SERVER;

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data) {
      ops.push({ op: 'set', path: ref.path, data: clone(data) });
    },
    update(ref, data) {
      ops.push({ op: 'update', path: ref.path, data: clone(data) });
    },
    async commit() {
      for (const o of ops) {
        fake.store.set(o.path, o.op === 'set' ? o.data : { ...fake.store.get(o.path), ...o.data });
        fake.writes.push(o);
      }
    },
  };
}
