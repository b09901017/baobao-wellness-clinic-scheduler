package tw.baofu.notes.core

/**
 * 讀寫 Firestore 的那一層要給的。app 那一側是 Firestore SDK（`FirestoreNoteStore`），單元測試是情境檔裡的那一份資料。
 *
 * 文件的值一律換成 core 認得的：`com.google.firebase.Timestamp` ↔ [Ts]，寫入時 [ServerTimestamp] → `FieldValue.serverTimestamp()`。
 */
interface NoteStore {
    /** 一筆文件的資料（**不含 id、含已刪除的**）；不存在回 null。網頁 `getDoc()` 的 `snap.data()`。 */
    suspend fun read(path: String, id: String): Doc?

    /** `where(field, '==', value)`，**含已刪除的**、不排序；每一筆帶 `id`。網頁 `repo.listWithDeleted()`。 */
    suspend fun listWhere(path: String, field: String, value: String): List<Doc>

    /**
     * 還沒勾、還活著的（網頁 `listOpen()`：`deletedAt == null`、`done == false`、`createdAt` 新的在前，同一個複合索引）；每一筆帶 `id`。
     * 小工具第一次同步用（[NotesSync.pull]）。**要講是不是這台手機的快取**（[Listing.fromCache]）：SDK 連不上伺服器時回快取、不丟錯。
     */
    suspend fun listOpen(path: String): Listing

    /**
     * `updatedAt > since`，**含已刪除、已勾掉的**（小工具才知道要拿掉它們）、不加 limit；每一筆帶 `id`。
     * 單欄位的範圍查詢：用 Firestore 自動建的索引，不用補 `firestore.indexes.json`（[NotesSync]）。同樣要講是不是快取。
     */
    suspend fun listUpdatedSince(path: String, since: Ts): Listing

    /** 先拿一個還沒用過的 id（網頁 `doc(collection(db, path)).id`）。 */
    fun newId(path: String): String

    /** 一次原子寫入（網頁 `writeBatch()` → `commit()`）。 */
    suspend fun commit(writes: List<Write>)
}

/**
 * 一次查詢讀回來的，與**是不是這台手機的快取**（Firestore 的 `metadata.isFromCache`）。
 * 同步只認伺服器的答案（[NotesSync]）：快取裡比游標新的只是這台手機自己看過的那幾筆，拿來推游標會跳過別台改的（REVIEW-android R2）。
 */
data class Listing(val docs: List<Doc>, val fromCache: Boolean = false)

/** 一筆要寫的：`SET` 整份蓋上（新增、稽核）、`UPDATE` 只改那幾欄。 */
data class Write(val kind: Kind, val path: String, val data: Doc) {
    enum class Kind { SET, UPDATE }
}

/**
 * 隨手記的寫入：**網頁 `public/js/data/notes.js` ＋ `data/repo.js` 的 `commit()` 照抄**（ADR-0180）。
 *
 * 一個字都要一樣的有三件：存進去的欄位與型別、每一次寫入都帶 `updatedAt`、**同一個 commit 裡每一筆一則稽核**
 * （`audit/<自動 id>`：`at`、`actor`、`action`、`targetPath`、`before`、`after`、`note`）。
 * Rules 只要求稽核的 `actor` 與那四個鍵 —— 沒寫稽核也過得了，所以稽核的形狀放在情境檔的 `writes` 盯著，
 * 網頁那一側的測試拿同一份情境跑真的 `data/notes.js`。
 *
 * **寫的那一刻照 `linkId` 重讀同一組**（ADR-0179）：小工具手上那一份是快取，拿它算「另外那幾天」就漏了。
 *
 * @param actor 登入的 uid（網頁的 `actorId()`）
 * @param now 現在的毫秒數（`doneAt` 用；測試給固定的）
 */
class NotesWriter(
    private val store: NoteStore,
    private val actor: suspend () -> String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed interface Op {
        val path: String
        val id: String?

        data class Create(override val path: String, val data: Doc, override val id: String? = null) : Op
        data class Update(override val path: String, override val id: String, val changes: Doc) : Op
        data class SoftDelete(override val path: String, override val id: String, val reason: String?) : Op
    }

    /** `repo.commit()`：每一筆各自附一則稽核，一次寫進去。回每一筆的 id。 */
    suspend fun commit(ops: List<Op>): List<String> {
        require(ops.size * 2 <= 500) { "一次寫太多筆了，請分批" }
        val ids = ops.map { it.id ?: store.newId(it.path) }
        val befores = ops.mapIndexed { i, o -> if (o is Op.Create) null else store.read(o.path, ids[i]) }
        val uid = actor()
        val writes = mutableListOf<Write>()
        ops.forEachIndexed { i, o ->
            val target = "${o.path}/${ids[i]}"
            if (o !is Op.Create && befores[i] == null) throw IllegalStateException("$target 不存在")
            val action: String
            val after: Doc
            when (o) {
                is Op.Create -> {
                    writes += Write(
                        Write.Kind.SET, target,
                        o.data + linkedMapOf(
                            "deletedAt" to null,
                            "createdBy" to uid,
                            "createdAt" to ServerTimestamp,
                            "updatedAt" to ServerTimestamp,
                        ),
                    )
                    action = "create"
                    after = o.data
                }
                is Op.Update -> {
                    writes += Write(Write.Kind.UPDATE, target, o.changes + ("updatedAt" to ServerTimestamp))
                    action = "update"
                    after = o.changes
                }
                is Op.SoftDelete -> {
                    writes += Write(Write.Kind.UPDATE, target, linkedMapOf("deletedAt" to ServerTimestamp, "updatedAt" to ServerTimestamp))
                    action = "softDelete"
                    after = linkedMapOf("deletedAt" to "server", "reason" to o.reason)
                }
            }
            writes += Write(
                Write.Kind.SET, "audit/${store.newId("audit")}",
                linkedMapOf(
                    "at" to ServerTimestamp,
                    "actor" to uid,
                    "action" to "${o.path}.$action",
                    "targetPath" to target,
                    "before" to if (o is Op.Create) null else befores[i],
                    "after" to after,
                    "note" to null,
                ),
            )
        }
        store.commit(writes)
        return ids
    }

    /** `repo.getOne()`：刪掉的當成沒有。 */
    suspend fun getOne(id: String): Doc? {
        val data = store.read(PATH, id) ?: return null
        if (data.truthy("deletedAt")) return null
        return linkedMapOf<String, Any?>("id" to id) + data
    }

    /** 同一組（同一個 `linkId`），**含已刪除的**。 */
    suspend fun listLinked(linkId: String): List<Doc> = store.listWhere(PATH, "linkId", linkId)

    private suspend fun freshWithPeers(id: String): Pair<Doc?, List<Doc>> {
        val before = getOne(id)
        if (before == null || !before.truthy("linkId")) return before to emptyList()
        return before to Notes.linkedPeers(before, listLinked(Js.str(before["linkId"])))
    }

    private suspend fun writeAll(changes: List<Notes.Change>) {
        commit(changes.map { Op.Update(PATH, it.id, it.changes) })
    }

    /** 新增一筆（呼叫端先過 `Notes.validateNote()`，跟網頁一樣）。回新的 id。 */
    suspend fun create(data: Doc): String =
        commit(listOf(Op.Create(PATH, Notes.normalize(data) + ("doneAt" to null)))).single()

    /** 改一筆（字、日期、掛給誰）。連在一起的照真的變了什麼一起寫。 */
    suspend fun update(id: String, changes: Doc) {
        val patch = Notes.normalizePatch(changes)
        val (before, peers) = freshWithPeers(id)
        if (peers.isEmpty()) {
            commit(listOf(Op.Update(PATH, id, patch)))
            return
        }
        val writes = Notes.linkedChanges(before!!, patch, peers)
        if (writes.isNotEmpty()) writeAll(writes)
    }

    /** 刪掉**這一筆**（連在一起的也只刪這一筆）。 */
    suspend fun remove(id: String, reason: String? = null) {
        commit(listOf(Op.SoftDelete(PATH, id, reason)))
    }

    /** 刪掉清單上的**一列**：一列代表一組時，跟它勾法一樣的整組一起刪。 */
    suspend fun removeRow(note: Doc, reason: String? = null) {
        val noteId = note.id!!
        val (before, peers) = freshWithPeers(noteId)
        val same = peers.filter { it.truthy("done") == (before?.truthy("done") ?: false) }
        if (before == null || same.isEmpty()) return remove(noteId, reason)
        commit((listOf(before) + same).map { Op.SoftDelete(PATH, it.id!!, reason) })
    }

    data class CopyResult(val created: Int, val skipped: List<String>, val linkId: String?, val together: Int, val sourceIn: Boolean)

    /** 複製到別天（預設連在一起）。重讀之後才算要建哪幾天 —— 重按、失敗重按都不多一份。 */
    suspend fun copyTo(note: Doc, dates: List<String>, linked: Boolean = true): CopyResult {
        val fresh = getOne(note.id!!) ?: throw IllegalStateException("這一筆剛剛被刪掉了，沒有東西可以複製")
        val group = listLinked(if (fresh.truthy("linkId")) Js.str(fresh["linkId"]) else fresh.id!!)
        val plan = Notes.copyPlan(fresh, dates, linked = linked, group = group, newLinkId = store.newId(PATH))
        plan.blocked?.let { throw IllegalStateException(it) }
        val ops = buildList {
            plan.link?.let { add(Op.Update(PATH, it.id, it.changes)) }
            plan.creates.forEach { add(Op.Create(PATH, it + ("doneAt" to null))) }
        }
        if (ops.isNotEmpty()) commit(ops)
        return CopyResult(plan.creates.size, plan.skipped, plan.linkId, plan.together, plan.sourceIn)
    }

    /** 拆開這一天。 */
    suspend fun unlink(id: String) {
        commit(listOf(Op.Update(PATH, id, linkedMapOf("linkId" to null))))
    }

    data class DoneResult(val done: Boolean, val doneAt: String?, val reach: Notes.Reach?)

    /** 勾掉／拿回來。連在一起的同一組一起（過去的、還沒到的、不在畫面上的都算）。 */
    suspend fun setDone(id: String, done: Boolean): DoneResult {
        val changes = linkedMapOf<String, Any?>("done" to done, "doneAt" to if (done) Dates.isoInstant(now()) else null)
        val (before, peers) = freshWithPeers(id)
        if (peers.isEmpty()) {
            commit(listOf(Op.Update(PATH, id, changes)))
            return DoneResult(done, changes["doneAt"] as String?, null)
        }
        val writes = Notes.linkedChanges(before!!, changes, peers)
        if (writes.isNotEmpty()) writeAll(writes)
        return DoneResult(done, changes["doneAt"] as String?, Notes.linkedReach(before, peers))
    }

    companion object {
        const val PATH = "notes"
    }
}
