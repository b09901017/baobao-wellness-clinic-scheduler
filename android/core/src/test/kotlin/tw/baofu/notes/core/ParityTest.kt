package tw.baofu.notes.core

import com.ibm.icu.text.Collator
import com.ibm.icu.util.ULocale
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 隨手記的共用情境檔（`tests/fixtures/notes-parity.json`，ADR-0180）：Kotlin 這一份照不照網頁算出來的答案。
 *
 * 答案是網頁真的那幾支算的（`node scripts/notes-parity.mjs --write`）—— 這裡紅了就是 Kotlin 跟網頁不一樣，改 Kotlin，不改檔案。
 * 網頁那一側的 `tests/notes-parity.test.js` 會掃這一支：情境檔的每一段在這裡都要有一個 `"段名" ->` 分支。
 */
class ParityTest {
    private val file: Map<String, Any?> by lazy {
        val path = System.getProperty("notes.parity") ?: error("沒有 notes.parity（從 ./gradlew :core:test 跑）")
        @Suppress("UNCHECKED_CAST")
        fromJson(Json.parseToJsonElement(File(path).readText())) as Map<String, Any?>
    }

    private val zhHant: Comparator<String> = run {
        val c = Collator.getInstance(ULocale.forLanguageTag("zh-Hant"))
        Comparator { a, b -> c.compare(a, b) }
    }

    @Test
    fun everySectionMatchesTheWeb() {
        @Suppress("UNCHECKED_CAST")
        val sections = file["sections"] as Map<String, List<Map<String, Any?>>>
        val failures = mutableListOf<String>()
        var count = 0
        for ((section, cases) in sections) {
            for (c in cases) {
                count += 1
                @Suppress("UNCHECKED_CAST")
                val input = c["in"] as Map<String, Any?>
                val want = c["out"]
                assertTrue("$section「${c["name"]}」還沒有答案", c.containsKey("out"))
                val got = try {
                    run(section, input)
                } catch (e: Throwable) {
                    "丟錯：${e::class.simpleName} ${e.message}"
                }
                if (canonical(got) != canonical(want)) {
                    failures += "$section「${c["name"]}」\n    網頁：${canonical(want)}\n  Kotlin：${canonical(got)}"
                }
            }
        }
        assertEquals("跟網頁不一樣的有 ${failures.size} 題（共 $count 題）：\n" + failures.joinToString("\n"), 0, failures.size)
    }

    // ---------- 每一段 ----------

    @Suppress("UNCHECKED_CAST")
    private fun run(section: String, a: Map<String, Any?>): Any? = when (section) {
        "normalize" -> Notes.normalize(a["note"] as Doc?)
        "normalizePatch" -> Notes.normalizePatch(a["changes"] as Doc?)
        "validateNote" -> Notes.validateNote(a["note"] as Doc?)
        "dates" -> mapOf(
            "valid" to Dates.isValidDate(a["iso"]),
            "short" to if (Dates.isValidDate(a["iso"])) Dates.shortDate(a["iso"] as String) else null,
        )
        "doneAt" -> Dates.isoInstant(a["ms"] as Long)
        "sortNotes" -> Notes.sortNotes(docs(a["notes"])).map { it["id"] }
        "openCount" -> Notes.openCount(docs(a["notes"]))
        "groupLinked" -> Notes.groupLinked(docs(a["notes"]), a["today"] as String?).map { row ->
            mapOf(
                "note" to row.note["id"],
                "members" to row.members.map { it["id"] },
                "days" to row.days,
                "badge" to Notes.linkedBadge(row),
            )
        }
        "linkedPeers" -> Notes.linkedPeers(a["note"] as Doc?, docs(a["notes"])).map { it["id"] }
        "linkedChanges" -> Notes.linkedChanges(a["before"] as Doc, a["patch"] as Doc?, docs(a["peers"])).map(::changeOut)
        "copyPlan" -> Notes.copyPlan(
            a["note"] as Doc,
            a["dates"] as List<String>?,
            linked = a["linked"] as Boolean? ?: true,
            group = docs(a["group"]),
            newLinkId = a["newLinkId"] as String?,
        ).let { p ->
            mapOf(
                "blocked" to p.blocked,
                "linkId" to p.linkId,
                "link" to p.link?.let(::changeOut),
                "creates" to p.creates,
                "skipped" to p.skipped,
                "taken" to p.taken,
                "together" to p.together,
                "sourceIn" to p.sourceIn,
            )
        }
        "copiedSay" -> Notes.copiedSay(
            (a["created"] as Long).toInt(), a["linked"] as Boolean, (a["together"] as Long).toInt(), a["sourceIn"] as Boolean,
        )
        "linkedReach" -> Notes.linkedReach(a["note"] as Doc?, docs(a["peers"]))?.let(::reachOut)
        "noteActions" -> Notes.noteActions(a["note"] as Doc?, reachIn(a["reach"])).map { act ->
            listOfNotNull(
                "id" to act.id, "label" to act.label,
                act.note?.let { "note" to it }, act.icon?.let { "icon" to it }, act.tone?.let { "tone" to it },
            ).toMap()
        }
        "dateChoices" -> Notes.dateChoices(a["note"] as Doc?, a["today"] as String, a["onCalendar"] as Boolean? ?: false).map { ch ->
            listOfNotNull("id" to ch.id, "label" to ch.label, ch.note?.let { "note" to it }).toMap()
        }
        "normalizeAlias" -> Names.normalizeAlias(a["raw"])
        "normalizeChartNo" -> Names.normalizeChartNo(a["raw"])
        "chartNosOf" -> Names.chartNosOf(a["customer"] as Doc?)
        "nameHas" -> Names.nameHas(a["name"], a["query"])
        "chartNoHas" -> Names.chartNoHas(a["customer"] as Doc?, a["query"])
        "nameSuggestions" -> {
            val text = a["text"] as String
            val got = Names.nameSuggestions(
                text, (a["caret"] as Long?)?.toInt() ?: text.length, docs(a["people"]), zhHant, currentId = a["currentId"] as String?,
            )
            mapOf("from" to got.from, "to" to got.to, "ids" to got.matches.map { it["id"] })
        }
        "links" -> mapOf(
            "note" to WebLinks.note(a["origin"] as String, a["id"] as String),
            "newGive" to WebLinks.newGive(a["origin"] as String),
        )
        "writes" -> runWrites(a)
        else -> error("ParityTest 不認得這一段：$section")
    }

    @Suppress("UNCHECKED_CAST")
    private fun docs(v: Any?): List<Doc> = (v as List<Doc>?) ?: emptyList()

    private fun changeOut(c: Notes.Change) = mapOf("id" to c.id, "changes" to c.changes)

    private fun reachOut(r: Notes.Reach) =
        mapOf("days" to r.days, "notes" to r.notes, "count" to r.count, "unit" to r.unit, "label" to r.label)

    @Suppress("UNCHECKED_CAST")
    private fun reachIn(v: Any?): Notes.Reach? = (v as Map<String, Any?>?)?.let {
        Notes.Reach(
            (it["days"] as Long).toInt(), (it["notes"] as Long).toInt(), (it["count"] as Long).toInt(),
            it["unit"] as String, it["label"] as String,
        )
    }

    // ---------- writes：拿情境裡的那一份資料當 Firestore ----------

    private class FakeStore(initial: Map<String, Doc>) : NoteStore {
        val docs = LinkedHashMap(initial)
        val writes = mutableListOf<Write>()
        private var seq = 0

        override suspend fun read(path: String, id: String): Doc? = docs["$path/$id"]

        override suspend fun listWhere(path: String, field: String, value: String): List<Doc> =
            docs.filter { (p, d) ->
                p.startsWith("$path/") && !p.removePrefix("$path/").contains('/') && d.containsKey(field) && d[field] == value
            }.map { (p, d) -> linkedMapOf<String, Any?>("id" to p.removePrefix("$path/")) + d }

        override suspend fun listOpen(path: String): Listing = error("寫入的情境用不到")

        override suspend fun listUpdatedSince(path: String, since: Ts): Listing = error("寫入的情境用不到")

        override fun newId(path: String): String {
            seq += 1
            return "gen-$seq"
        }

        override suspend fun commit(writes: List<Write>) {
            this.writes += writes
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun runWrites(a: Map<String, Any?>): Any? {
        val initial = LinkedHashMap<String, Doc>()
        (a["store"] as Map<String, Map<String, Doc>>?)?.forEach { (col, ds) -> ds.forEach { (id, d) -> initial["$col/$id"] = d } }
        val store = FakeStore(initial)
        val writer = NotesWriter(store, actor = { a["uid"] as String }, now = { a["now"] as Long? ?: 0L })
        val args = a["args"] as List<Any?>
        var error: String? = null
        val result: Any? = try {
            runBlocking {
                when (a["call"]) {
                    "create" -> writer.create(args[0] as Doc)
                    "update" -> writer.update(args[0] as String, args[1] as Doc).let { null }
                    "setDone" -> writer.setDone(args[0] as String, args[1] as Boolean).let {
                        mapOf("done" to it.done, "doneAt" to it.doneAt, "reach" to it.reach?.let(::reachOut))
                    }
                    "remove" -> writer.remove(args[0] as String, args.getOrNull(1) as String?).let { null }
                    "removeRow" -> writer.removeRow(args[0] as Doc, args.getOrNull(1) as String?).let { null }
                    "copyTo" -> writer.copyTo(args[0] as Doc, args[1] as List<String>, args.getOrNull(2) as Boolean? ?: true).let {
                        mapOf("created" to it.created, "skipped" to it.skipped, "linkId" to it.linkId, "together" to it.together, "sourceIn" to it.sourceIn)
                    }
                    "unlink" -> writer.unlink(args[0] as String).let { null }
                    else -> error("不認得的呼叫：${a["call"]}")
                }
            }
        } catch (e: IllegalStateException) {
            error = e.message
            null
        }
        val out = linkedMapOf<String, Any?>(
            "writes" to store.writes.map { w ->
                mapOf("op" to (if (w.kind == Write.Kind.SET) "set" else "update"), "path" to w.path, "data" to w.data)
            },
        )
        if (error != null) out["error"] = error else if (result != null) out["result"] = result
        return renameIds(plain(out))
    }

    /** 自動產生的 id（`gen-N`）照出現的順序換成 `$1`、`$2`…（排過鍵、深度優先 —— 網頁那一側同一套）。 */
    private fun renameIds(v: Any?): Any? {
        val seen = LinkedHashMap<String, String>()
        Regex("gen-\\d+").findAll(canonical(v)).forEach { m -> seen.getOrPut(m.value) { "\$${seen.size + 1}" } }
        fun swap(x: Any?): Any? = when (x) {
            is String -> Regex("gen-\\d+").replace(x) { seen.getValue(it.value) }
            is List<*> -> x.map(::swap)
            is Map<*, *> -> x.entries.associate { (k, y) -> k to swap(y) }
            else -> x
        }
        return swap(v)
    }

    // ---------- 值的轉換 ----------

    private fun fromJson(e: JsonElement): Any? = when (e) {
        is JsonNull -> null
        is JsonPrimitive -> when {
            e.isString -> e.content
            e.booleanOrNull != null -> e.booleanOrNull
            e.longOrNull != null -> e.longOrNull
            else -> e.content.toDouble()
        }
        is JsonArray -> e.map(::fromJson)
        is JsonObject -> {
            val ts = e["\$ts"]
            if (ts is JsonArray && e.size == 1) {
                Ts((ts[0] as JsonPrimitive).content.toLong(), (ts[1] as JsonPrimitive).content.toInt())
            } else {
                e.entries.associateTo(LinkedHashMap()) { (k, v) -> k to fromJson(v) }
            }
        }
    }

    /** Kotlin 算出來的 → 檔案的寫法（Int → Long、Ts → `$ts`、伺服器時間 → `$server`）。 */
    private fun plain(v: Any?): Any? = when (v) {
        null, is String, is Boolean, is Long, is Double -> v
        is Int -> v.toLong()
        is Ts -> mapOf("\$ts" to listOf(v.seconds, v.nanos.toLong()))
        ServerTimestamp -> "\$server"
        is List<*> -> v.map(::plain)
        is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to plain(x) }
        else -> error("不認得的值：${v::class}")
    }

    /** 排過鍵的 JSON（網頁那一側的 `canonicalJson()` 同一套）。 */
    private fun canonical(v: Any?): String = when (val p = plain(v)) {
        null -> "null"
        is String -> JsonPrimitive(p).toString()
        is Boolean, is Long -> p.toString()
        is Double -> p.toString()
        is List<*> -> p.joinToString(",", "[", "]") { canonical(it) }
        is Map<*, *> -> p.keys.map { it.toString() }.sorted().joinToString(",", "{", "}") { k ->
            "${JsonPrimitive(k)}:${canonical(p[k])}"
        }
        else -> error("不認得的值")
    }
}
