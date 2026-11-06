package tw.baofu.notes.core

/**
 * 小工具手上那一份「還沒勾的隨手記」怎麼跟雲端對齊（她 11/6「好照建議做」）：
 *
 * - 在小工具上自己寫的：存完馬上更新（那一份由寫入的人自己換，不經過這裡）
 * - 按 ＋ 打開輸入卡時、背景的 WorkManager（最短 15 分鐘、手機睡著時讓系統延後）：叫 [NotesSync.pull]
 * - **只問上次之後改過的**：`updatedAt` 大於游標的那幾筆（**含已刪除、已勾掉的** —— 小工具才知道要拿掉它們）。
 *   沒變的話是一次查詢、回 0 筆，Firestore 算 1 次讀取
 *
 * 游標是**讀回來的那幾筆裡最大的 `updatedAt`**（伺服器時間），不是手機的時鐘 —— 手機的時間不準，拿它比就會漏掉別台剛寫的。
 * 同一個 commit 的那幾筆是同一個伺服器時間、而且一起看得到，所以用「大於」不會漏掉同一批的另一半；**不加 limit**（分頁的話同一個時間會被切在兩頁）。
 * 還沒回到伺服器的那一筆 `updatedAt` 是 null，不拿來推游標。
 *
 * 用的是 Firestore 自動建的單欄位索引（`updatedAt`），Rules 只要 `allowed()` —— 兩邊都不用改（ADR-0180）。
 */
object NotesSync {
    /** 小工具記著的：還沒勾、還活著的那幾筆，與下一次從哪裡問起。 */
    data class State(val notes: List<Doc>, val cursor: Ts?)

    /** 兩個伺服器時間誰比較晚。 */
    fun later(a: Ts?, b: Ts?): Ts? = when {
        a == null -> b
        b == null -> a
        a.seconds != b.seconds -> if (a.seconds > b.seconds) a else b
        else -> if (a.nanos >= b.nanos) a else b
    }

    /** 這幾筆裡最晚的 `updatedAt`（沒有就照舊）。 */
    fun cursorOf(docs: List<Doc>, previous: Ts?): Ts? =
        docs.fold(previous) { acc, d -> later(acc, d["updatedAt"] as? Ts) }

    /**
     * 改過的那幾筆併進手上那一份：同一個 id 換成新的；勾掉的、刪掉的拿掉；拿回來的、新的加進去。
     * 順序不在這裡排（小工具的清單順序另外排，連在一起的照 `Notes.groupLinked()`）。
     */
    fun merge(notes: List<Doc>, changed: List<Doc>): List<Doc> {
        val byId = LinkedHashMap<String?, Doc>()
        for (n in notes) byId[n.id] = n
        for (c in changed) {
            if (Notes.isOpen(c)) byId[c.id] = c else byId.remove(c.id)
        }
        return byId.values.toList()
    }

    /**
     * 跟雲端對一次。手上沒有（第一次、或上一次一筆都沒有所以沒有游標）→ 整份讀還沒勾的；有游標 → 只問之後改過的。
     */
    suspend fun pull(store: NoteStore, state: State?): State {
        if (state?.cursor == null) {
            val open = store.listOpen(NotesWriter.PATH)
            return State(open, cursorOf(open, null))
        }
        val changed = store.listUpdatedSince(NotesWriter.PATH, state.cursor)
        return State(merge(state.notes, changed), cursorOf(changed, state.cursor))
    }
}
