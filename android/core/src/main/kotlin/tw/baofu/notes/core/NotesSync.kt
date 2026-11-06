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
 * **只認伺服器的答案**（REVIEW-android R2）：SDK 連不上伺服器時回這台手機的快取、不丟錯，而快取裡比游標新的只有這台手機自己看過的那幾筆 ——
 * 拿它推游標，別台在那之前改的就永遠問不到。讀到快取（[Listing.fromCache]）→ 改過的一筆都不併、游標不動、不算同步成功（[Pulled.fresh]）；
 * 整份讀的那一次照樣先畫快取裡的（第一次就沒網路時不畫「沒有還沒做的事」），游標留空、下一次再整份讀。
 *
 * **讀回來的套在「現在那一份」上，不是讀之前那一份**（[apply]，REVIEW-android R3）：等網路的那段時間裡，小工具上自己記的、勾掉的已經換進清單了，
 * 拿讀之前那一份算的結果整份蓋上去，剛記的那一筆會從小工具上消失。
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
     * 一次跟雲端對回來的：[full] 是整份還沒勾的、不然是 [cursor] 之前那一次之後改過的那幾筆。
     * [fresh]：讀的是伺服器（不是這台手機的快取）—— 只有這種才推游標、才算同步成功。
     */
    data class Pulled(val full: Boolean, val docs: List<Doc>, val cursor: Ts?, val fresh: Boolean)

    /** 手上沒有游標（第一次、上一次一筆都沒有、或上一次讀到的是快取）→ 整份讀還沒勾的；有 → 只問之後改過的。 */
    suspend fun fetch(store: NoteStore, state: State?): Pulled {
        if (state?.cursor == null) {
            val open = store.listOpen(NotesWriter.PATH)
            return Pulled(full = true, docs = open.docs, cursor = if (open.fromCache) null else cursorOf(open.docs, null), fresh = !open.fromCache)
        }
        val changed = store.listUpdatedSince(NotesWriter.PATH, state.cursor)
        return Pulled(
            full = false,
            docs = changed.docs,
            cursor = if (changed.fromCache) state.cursor else cursorOf(changed.docs, state.cursor),
            fresh = !changed.fromCache,
        )
    }

    /**
     * 讀回來的套在**現在那一份**上（呼叫端在那一把鎖裡叫）：
     *
     * - 改過的那幾筆：併進現在的清單（[merge]）、游標取晚的那一個；讀到快取 → 現在那一份原封不動
     * - 整份：換成讀回來的，**現在那一份裡 `updatedAt` 還是 null 的留著**（本機剛記、還沒送到伺服器 —— 讀的那一刻它不在雲端）；
     *   游標是讀回來的那一個（讀到快取就留空，下一次再整份讀）
     */
    fun apply(current: State, pulled: Pulled): State {
        if (pulled.full) {
            val ids = pulled.docs.mapTo(HashSet()) { it.id }
            val unsent = current.notes.filter { it["updatedAt"] == null && it.id !in ids }
            return State(pulled.docs + unsent, if (pulled.fresh) pulled.cursor else null)
        }
        if (!pulled.fresh) return current
        // 現在那一份沒有游標（等網路時被一次讀到快取的整份讀換掉了）：併進去，但游標照樣留空 —— 它不是從伺服器讀的，下一次再整份讀
        return State(merge(current.notes, pulled.docs), current.cursor?.let { later(it, pulled.cursor) })
    }

    /** 跟雲端對一次、套在 [state] 上（手上那一份在等網路時不會變的呼叫端用；小工具走 [fetch] ＋ [apply]）。 */
    suspend fun pull(store: NoteStore, state: State?): State = apply(state ?: State(emptyList(), null), fetch(store, state))
}
