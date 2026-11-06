package tw.baofu.notes

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.NoteStore
import tw.baofu.notes.core.ServerTimestamp
import tw.baofu.notes.core.Ts
import tw.baofu.notes.core.Write

/**
 * core 的 [NoteStore] 接到 Firestore SDK：值在這裡換（Timestamp ↔ [Ts]、[ServerTimestamp] → `serverTimestamp()`）。
 *
 * **離線**：`commit()` 的寫入一送出就在這台手機的快取裡（連上網路會補傳），但 SDK 的 Task 要等伺服器回來才完成 ——
 * 跟網頁一樣，等 [PENDING_MS] 還沒回來就不等了、記 [pending]（畫面講「存在這台手機上了」，不講失敗）。
 */
class FirestoreNoteStore(private val db: FirebaseFirestore) : NoteStore {
    /** 上一次寫入還沒回到伺服器（離線或很慢）。 */
    @Volatile
    var pending: Boolean = false
        private set

    override suspend fun read(path: String, id: String): Doc? {
        val snap = db.collection(path).document(id).get().await()
        return if (snap.exists()) toCore(snap.data ?: emptyMap<String, Any?>()) else null
    }

    override suspend fun listWhere(path: String, field: String, value: String): List<Doc> =
        db.collection(path).whereEqualTo(field, value).get().await().documents.map { d ->
            linkedMapOf<String, Any?>("id" to d.id) + toCore(d.data ?: emptyMap<String, Any?>())
        }

    override suspend fun listOpen(path: String): List<Doc> =
        db.collection(path)
            .whereEqualTo("deletedAt", null)
            .whereEqualTo("done", false)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .get().await().documents.map(::withId)

    /**
     * 同 [listOpen]，**只讀這台手機的快取**（不等網路）：小工具上自己寫完要馬上換掉清單時用 ——
     * 自己剛寫的那幾筆已經在快取裡（還沒送到伺服器也在），等伺服器的話網路慢就要等好幾秒。
     */
    suspend fun listOpenCached(path: String): List<Doc> =
        db.collection(path)
            .whereEqualTo("deletedAt", null)
            .whereEqualTo("done", false)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .get(Source.CACHE).await().documents.map(::withId)

    /** 單欄位的範圍查詢（自動索引）；**不濾 `deletedAt`、不加 limit**（理由在 core 的 `NotesSync`）。 */
    override suspend fun listUpdatedSince(path: String, since: Ts): List<Doc> =
        db.collection(path)
            .whereGreaterThan("updatedAt", Timestamp(since.seconds, since.nanos))
            .orderBy("updatedAt")
            .get().await().documents.map(::withId)

    private fun withId(d: DocumentSnapshot): Doc =
        linkedMapOf<String, Any?>("id" to d.id) + toCore(d.data ?: emptyMap<String, Any?>())

    override fun newId(path: String): String = db.collection(path).document().id

    override suspend fun commit(writes: List<Write>) {
        val batch = db.batch()
        for (w in writes) {
            val ref = db.document(w.path)
            @Suppress("UNCHECKED_CAST")
            val data = toFirestore(w.data) as Map<String, Any?>
            if (w.kind == Write.Kind.SET) batch.set(ref, data) else batch.update(ref, data)
        }
        val task = batch.commit()
        pending = withTimeoutOrNull(PENDING_MS) { task.await() } == null
    }

    companion object {
        const val PENDING_MS = 4_000L

        /** Firestore 讀回來的 → core 的值。 */
        @Suppress("UNCHECKED_CAST")
        fun toCore(data: Map<String, Any?>): Doc = data.entries.associateTo(LinkedHashMap()) { (k, v) -> k to coreValue(v) }

        private fun coreValue(v: Any?): Any? = when (v) {
            null, is String, is Boolean, is Long, is Double -> v
            is Int -> v.toLong()
            is Timestamp -> Ts(v.seconds, v.nanoseconds)
            is Map<*, *> -> v.entries.associateTo(LinkedHashMap()) { (k, x) -> k.toString() to coreValue(x) }
            is List<*> -> v.map(::coreValue)
            else -> v.toString()
        }

        /** core 的值 → 寫進 Firestore 的。 */
        fun toFirestore(v: Any?): Any? = when (v) {
            ServerTimestamp -> FieldValue.serverTimestamp()
            is Ts -> Timestamp(v.seconds, v.nanos)
            is Int -> v.toLong()
            is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to toFirestore(x) }
            is List<*> -> v.map(::toFirestore)
            else -> v
        }
    }
}
