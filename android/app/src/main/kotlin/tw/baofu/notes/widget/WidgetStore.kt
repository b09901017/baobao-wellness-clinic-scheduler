package tw.baofu.notes.widget

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.NotesSync
import tw.baofu.notes.core.Ts
import java.io.File

/**
 * 小工具手上那一份（07）：還沒勾的隨手記＋同步的游標（core 的 [NotesSync.State]）、剛勾掉還在劃線的那幾列、上一次有沒有讀到。
 *
 * **存在這台手機上**（`files/widget-state.json`）：開機、程式被系統收掉之後小工具照樣畫得出來，
 * 背景同步只問游標之後改過的。沒有這個檔（第一次、重裝）→ 整份讀一次。**記著是誰的**：換帳號、登出就丟掉。
 * 畫面讀 [flow]（Glance 的那一段在 composition 裡收它，寫完 `updateAll()` 叫醒）。
 */
object WidgetStore {
    /** 勾掉之後劃線留多久才離開（spec：3 秒內再點一下回來）。 */
    const val LINGER_MS = 3_000L

    /** 剛勾掉、還在劃線的那一列：原本的樣子（拿來照原位畫）與到什麼時候。 */
    data class Ticking(val until: Long, val members: List<Doc>)

    data class View(
        val uid: String?,
        val notes: List<Doc> = emptyList(),
        val cursor: Ts? = null,
        val ticking: Map<String, Ticking> = emptyMap(),
        /** 上一次跟雲端對成功的時間（手機的時鐘，只拿來講「顯示的是幾點的」）。 */
        val syncedAt: Long? = null,
        /** 上一次讀不到（網路？），畫面講一句、清單照舊。 */
        val stale: Boolean = false,
        /** 讀過至少一次（沒有的話畫「讀取中」而不是「沒有要做的」）。 */
        val loaded: Boolean = false,
    ) {
        val sync: NotesSync.State get() = NotesSync.State(notes, cursor)
    }

    private const val FILE = "widget-state.json"
    private const val PREFS = "widget"
    private const val DARK = "dark"

    private val state = MutableStateFlow<View?>(null)
    private val darkFlow = MutableStateFlow<Boolean?>(null)

    fun flow(context: Context): StateFlow<View?> {
        if (state.value == null) state.value = read(context)
        return state
    }

    fun current(context: Context): View? = flow(context).value

    @Synchronized
    fun write(context: Context, view: View?) {
        state.value = view
        val file = File(context.filesDir, FILE)
        if (view == null) {
            file.delete()
            return
        }
        val tmp = File(context.filesDir, "$FILE.tmp")
        tmp.writeText(encode(view).toString())
        tmp.renameTo(file)
    }

    /**
     * 讀了再改：勾選的那一下（Glance 的 callback）與背景那幾條（寫完、劃線時間到、同步回來）會同時改同一份，
     * 一律經過這一支（跟 [write] 同一把鎖），不會蓋掉彼此改的那一格。
     */
    @Synchronized
    fun update(context: Context, transform: (View?) -> View?): View? {
        val before = current(context)
        val after = transform(before)
        if (after !== before) write(context, after)
        return after
    }

    // ---------- 深色／淺色（她 11/6：自己切換，長按「隨手記」圖示的捷徑；預設淺色） ----------

    fun darkFlow(context: Context): StateFlow<Boolean?> {
        if (darkFlow.value == null) darkFlow.value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DARK, false)
        return darkFlow
    }

    fun isDark(context: Context): Boolean = darkFlow(context).value == true

    fun setDark(context: Context, dark: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(DARK, dark).apply()
        darkFlow.value = dark
    }

    // ---------- 檔案的形狀（Firestore 的值：null、字串、真假、數字、時間、map、陣列） ----------

    private fun read(context: Context): View? {
        val file = File(context.filesDir, FILE)
        if (!file.exists()) return null
        return runCatching { decode(JSONObject(file.readText())) }.getOrNull()
    }

    private fun encode(v: View): JSONObject = JSONObject().apply {
        put("uid", v.uid ?: JSONObject.NULL)
        put("notes", JSONArray(v.notes.map(::encodeValue)))
        put("cursor", v.cursor?.let(::encodeValue) ?: JSONObject.NULL)
        put("ticking", JSONObject().apply {
            v.ticking.forEach { (id, t) -> put(id, JSONObject().put("until", t.until).put("members", JSONArray(t.members.map(::encodeValue)))) }
        })
        put("syncedAt", v.syncedAt ?: JSONObject.NULL)
        put("stale", v.stale)
        put("loaded", v.loaded)
    }

    @Suppress("UNCHECKED_CAST")
    private fun decode(o: JSONObject): View {
        val ticking = o.optJSONObject("ticking")?.let { t ->
            t.keys().asSequence().associateWith { id ->
                val x = t.getJSONObject(id)
                Ticking(x.getLong("until"), (decodeValue(x.getJSONArray("members")) as List<Any?>).map { it as Doc })
            }
        } ?: emptyMap()
        return View(
            uid = if (o.isNull("uid")) null else o.getString("uid"),
            notes = (decodeValue(o.getJSONArray("notes")) as List<Any?>).map { it as Doc },
            cursor = if (o.isNull("cursor")) null else decodeValue(o.getJSONObject("cursor")) as Ts?,
            ticking = ticking,
            syncedAt = if (o.isNull("syncedAt")) null else o.getLong("syncedAt"),
            stale = o.optBoolean("stale"),
            loaded = o.optBoolean("loaded"),
        )
    }

    private const val TS = "\$ts"

    private fun encodeValue(v: Any?): Any = when (v) {
        null -> JSONObject.NULL
        is Ts -> JSONObject().put(TS, JSONArray().put(v.seconds).put(v.nanos))
        is Map<*, *> -> JSONObject().apply { v.forEach { (k, x) -> put(k.toString(), encodeValue(x)) } }
        is List<*> -> JSONArray(v.map(::encodeValue))
        else -> v
    }

    private fun decodeValue(v: Any?): Any? = when (v) {
        null, JSONObject.NULL -> null
        is JSONObject -> if (v.has(TS) && v.length() == 1) {
            val a = v.getJSONArray(TS)
            Ts(a.getLong(0), a.getInt(1))
        } else {
            v.keys().asSequence().associateWithTo(LinkedHashMap()) { decodeValue(v.get(it)) }
        }
        is JSONArray -> (0 until v.length()).map { decodeValue(v.get(it)) }
        is Int -> v.toLong()
        else -> v
    }
}
