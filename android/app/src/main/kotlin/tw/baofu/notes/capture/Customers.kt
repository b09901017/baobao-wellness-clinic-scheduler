package tw.baofu.notes.capture

import android.icu.text.Collator
import android.icu.util.ULocale
import kotlinx.coroutines.tasks.await
import tw.baofu.notes.Backend
import tw.baofu.notes.FirestoreNoteStore
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Js
import tw.baofu.notes.core.Names

/**
 * 「掛給誰」與打名字跳出客戶用的客戶名單（08）。
 *
 * 讀法照網頁 `data/customers.js` 的 `list()`（還活著的、照 zh-TW 排）；**一次性客人也列、標「一次性」**（spec「三」）。
 * 輸入卡用的名單跟網頁記一筆那一排一樣**不濾停用的**（`wireWho()`）；選單的「改掛給誰」跟網頁 `askCustomer()` 一樣濾掉停用的（[live]）。
 * 比名字、病歷號一律問 core 的 [Names]（跟網頁同一套、情境檔盯著）。
 */
object Customers {
    /** 跳出客戶的排序（網頁 `localeCompare(…, 'zh-Hant')`）。 */
    val collator: Comparator<String> = Collator.getInstance(ULocale("zh-Hant")) as Comparator<String>

    private val listOrder: Comparator<String> = Collator.getInstance(ULocale("zh-TW")) as Comparator<String>

    suspend fun load(): List<Doc> =
        Backend.db.collection("customers").whereEqualTo("deletedAt", null).get().await().documents
            .map { linkedMapOf<String, Any?>("id" to it.id) + FirestoreNoteStore.toCore(it.data ?: emptyMap<String, Any?>()) }
            .sortedWith { a, b -> listOrder.compare(Js.str(a["name"] ?: ""), Js.str(b["name"] ?: "")) }

    /** 網頁 `askCustomer()` 那一份：停用的不列。 */
    fun live(customers: List<Doc>): List<Doc> = customers.filter { it["active"] != false }

    /** 搜尋框：名字或病歷號（網頁 `whoMatches()`）。 */
    fun matches(c: Doc, q: String): Boolean = Js.trim(q).isEmpty() || Names.nameHas(c["name"], q) || Names.chartNoHas(c, q)

    /** 一次性客人（網頁 `isOneTime()`：只認 `=== true`）。 */
    fun isOneTime(c: Doc): Boolean = c["oneTime"] == true
}
