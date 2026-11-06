package tw.baofu.notes.capture

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tw.baofu.notes.AppScope
import tw.baofu.notes.Backend
import tw.baofu.notes.BuildConfig
import tw.baofu.notes.NoteTaps
import tw.baofu.notes.core.Dates
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Js
import tw.baofu.notes.core.Notes
import tw.baofu.notes.core.WebLinks
import tw.baofu.notes.widget.WidgetStore
import tw.baofu.notes.widget.WidgetSync
import java.time.LocalDate
import java.time.YearMonth

/**
 * 點小工具上一筆的字：**浮出來的選單**（08，定稿圖 3）。
 *
 * 那幾顆、順序、底下那一行小字**只問 core 的 `Notes.noteActions()`**（網頁長按那一份，她 11/6 重排之後：
 * 勾掉／改日期／掛給誰／改文字／複製到別天；營養品的提醒是勾掉／改日期／看那一包）；「改日期」那張卡的選項問 `Notes.dateChoices()`。
 * 連在一起的：抬頭底下一排日子（代表的那一天標出來），「拆開這一天」在「複製到別天」那張小月曆最上面 —— 跟網頁同一個位置。
 * **打開時照 `linkId` 重讀那一組**（小工具手上那一份可能舊了）；寫入一律走 `Backend.notes`（`NotesWriter`，連在一起的規則與稽核都在裡面）。
 * 跳出來的那幾句（toast）照網頁 `runAction()` 的字。
 */
class MenuActivity : FloatingActivity() {
    private enum class Screen { MENU, DATE, WHO, EDIT, COPY }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra(EXTRA_ID)
        val cached = id?.let { want -> WidgetStore.current(this)?.notes?.firstOrNull { it["id"] == want } }
        if (id == null) {
            finish()
            return
        }
        setContent { CompositionLocalProvider(LocalPalette provides palette) { Menu(id, cached) } }
    }

    /** 寫完：卡收掉、小工具馬上換、講一句。 */
    private fun write(success: () -> String, block: suspend () -> Unit) {
        val app = applicationContext
        AppScope.launch {
            try {
                WidgetSync.localWrite(app) { block() }
                say(app, success())
            } catch (e: Exception) {
                say(app, "存不進去：${e.message ?: e::class.simpleName}")
            }
        }
        finish()
    }

    @Composable
    private fun Menu(id: String, cached: Doc?) {
        val p = LocalPalette.current
        val today = remember { Dates.todayIso() }
        var note by remember { mutableStateOf(cached) }
        var group by remember { mutableStateOf<List<Doc>?>(null) }
        var gone by remember { mutableStateOf(false) }
        var screen by remember { mutableStateOf(Screen.MENU) }

        LaunchedEffect(id) {
            try {
                val fresh = Backend.notes.getOne(id)
                if (fresh == null) {
                    gone = true
                    return@LaunchedEffect
                }
                note = fresh
                // 小工具手上那一份舊了（這一筆已經勾掉了）：順手換一次清單
                if (Js.truthy(fresh["done"]) && cached != null && !Js.truthy(cached["done"])) WidgetSync.afterLocalWrite(applicationContext)
                // 同一組（含已刪除的；`linkedPeers()` 自己濾）。沒有 `linkId` 照它的 id 讀 —— 小月曆要圈出上一次複製出去的那幾天
                group = Backend.notes.listLinked(Js.str(fresh["linkId"] ?: fresh["id"]))
            } catch (e: Exception) {
                group = group ?: emptyList()
            }
        }

        BackHandler { if (screen == Screen.MENU) finish() else screen = Screen.MENU }

        FloatingLayer(onOutside = { finish() }) {
            val n = note
            when {
                gone -> {
                    CardHeader("這一筆剛剛被刪掉了", onClose = { finish() })
                    val app = applicationContext
                    LaunchedEffect(Unit) { WidgetSync.afterLocalWrite(app) }
                }
                n == null -> CardHeader("讀取中…", onClose = { finish() })
                else -> {
                    val peers = Notes.linkedPeers(n, group ?: listOf(n))
                    val reach = Notes.linkedReach(n, peers)
                    when (screen) {
                        Screen.MENU -> MenuCard(n, peers, reach) { action -> onAction(action, n, reach) { screen = it } }
                        Screen.DATE -> DateCard(n, peers.isNotEmpty(), today)
                        Screen.WHO -> WhoCard(n, reach)
                        Screen.EDIT -> EditCard(n, reach)
                        Screen.COPY -> CopyCard(n, peers, group ?: listOf(n), today)
                    }
                }
            }
        }
    }

    private fun onAction(action: String, n: Doc, reach: Notes.Reach?, go: (Screen) -> Unit) {
        val id = Js.str(n["id"])
        val app = applicationContext
        when (action) {
            // 營養品的提醒：打開網頁問「給了哪幾款」（規則只在網頁 `domain/products.js`；三個入口共用 `NoteTaps`）
            "tick" -> if (NoteTaps.asksWhatWasGiven(n)) {
                openWeb(this, NoteTaps.givePage(id))
                finish()
            } else {
                write({ "勾掉了${Notes.linkedWords(reach).toast}" }) { Backend.notes.setDone(id, true) }
            }
            // 已經勾掉的那一筆（劃線那 3 秒裡點了字、或別台勾掉了小工具還沒同步）：拿回來永遠只是拿回來，營養品的提醒也是
            // （網頁 `prepareToggle()` 同一條；REVIEW-android R4）。小工具上還在劃線的話一起停掉
            "untick" -> write({ "拿回來了${Notes.linkedWords(reach).toast}" }) {
                WidgetSync.stopTicking(app, id)
                Backend.notes.setDone(id, false)
            }
            "date" -> go(Screen.DATE)
            "who" -> go(Screen.WHO)
            "edit" -> go(Screen.EDIT)
            "copy" -> go(Screen.COPY)
            "bag" -> {
                val customerId = Js.trimmed(n["customerId"])
                if (customerId.isEmpty()) {
                    say(this, "這一筆沒有掛客戶，找不到是哪一包")
                } else {
                    openWeb(this, WebLinks.customer(BuildConfig.WEB_ORIGIN, customerId))
                }
                finish()
            }
        }
    }

    // ---------- 選單 ----------

    @Composable
    private fun MenuCard(n: Doc, peers: List<Doc>, reach: Notes.Reach?, onPick: (String) -> Unit) {
        val date = n["date"]?.let { Js.str(it) }?.takeIf { it.isNotEmpty() }
        val sub = listOfNotNull(
            if (peers.isNotEmpty()) null else (date?.let(Dates::shortDate) ?: "沒有日期"),
            Js.trimmed(n["customerName"]).takeIf { it.isNotEmpty() },
        ).joinToString("・")
        CardHeader(Js.str(n["text"]), sub, onClose = { finish() })
        if (peers.isNotEmpty()) {
            val days = (listOf(n) + peers).mapNotNull { it["date"]?.let(Js::str)?.takeIf(String::isNotEmpty) }.distinct().sorted()
            ChipRow { days.forEach { d -> DayTag(Dates.shortDate(d), on = d == date) } }
        }
        Column {
            Notes.noteActions(n, reach).forEach { a ->
                ActionRow(a.label, a.note, primary = a.tone == "primary") { onPick(a.id) }
            }
            ActionRow("先不要", null, primary = false, muted = true) { finish() }
        }
    }

    @Composable
    private fun DayTag(label: String, on: Boolean) {
        val p = LocalPalette.current
        Box(
            Modifier.clip(RoundedCornerShape(12.dp)).background(if (on) p.accentSoft else p.chip).padding(horizontal = 10.dp, vertical = 4.dp),
        ) { Text(label, color = if (on) p.accent else p.dim, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal) }
    }

    @Composable
    private fun ActionRow(label: String, note: String?, primary: Boolean, muted: Boolean = false, onClick: () -> Unit) {
        val p = LocalPalette.current
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                color = when { primary -> p.accent; muted -> p.dim; else -> p.text },
                fontSize = 17.sp,
                fontWeight = if (primary) FontWeight.Bold else FontWeight.Normal,
                modifier = Modifier.weight(1f),
            )
            if (!note.isNullOrEmpty()) Text(note, color = p.mute, fontSize = 13.sp)
        }
    }

    // ---------- 改日期 ----------

    @Composable
    private fun DateCard(n: Doc, linked: Boolean, today: String) {
        val p = LocalPalette.current
        val id = Js.str(n["id"])
        val current = n["date"]?.let { Js.str(it) }?.takeIf { it.isNotEmpty() }
        val sub = listOfNotNull(current?.let { "現在是 ${Dates.shortDate(it)}" } ?: "現在沒有日期", if (linked) "只改這一天" else null).joinToString("・")

        fun change(to: String?) {
            if (to == current) return finish()
            val success = when (to) {
                null -> "從日曆拿掉了，隨手記裡還在"
                today -> "改成今天（${Dates.shortDate(today)}）"
                else -> "改成 ${Dates.shortDate(to)}"
            }
            write({ success }) { Backend.notes.update(id, linkedMapOf("date" to to)) }
        }

        CardHeader("改日期", sub, onClose = { finish() })
        Column {
            Notes.dateChoices(n, today).forEach { c ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).clickable {
                        when (c.id) {
                            "today" -> change(today)
                            "undate" -> change(null)
                            "pick" -> pickDate(this@MenuActivity, current ?: today) { change(it) }
                        }
                    }.padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(c.label, color = p.text, fontSize = 17.sp, modifier = Modifier.weight(1f))
                    if (c.id == "today") Text(Dates.shortDate(today), color = p.mute, fontSize = 13.sp)
                    c.note?.let { Text(it, color = p.mute, fontSize = 13.sp) }
                }
            }
        }
    }

    // ---------- 掛給誰 ----------

    @Composable
    private fun WhoCard(n: Doc, reach: Notes.Reach?) {
        val p = LocalPalette.current
        val words = Notes.linkedWords(reach)
        var customers by remember { mutableStateOf<List<Doc>?>(null) }
        var failed by remember { mutableStateOf(false) }
        var query by remember { mutableStateOf("") }
        val currentId = Js.trimmed(n["customerId"]).takeIf { it.isNotEmpty() }
        LaunchedEffect(Unit) {
            try {
                // 網頁 `askCustomer()` 那一份：停用的不列
                customers = Customers.live(Customers.load())
            } catch (e: Exception) {
                failed = true
            }
        }

        fun pick(c: Doc?) {
            val id = Js.str(n["id"])
            write({ "${if (c != null) "掛給${Js.str(c["name"])}了" else "不掛人了"}${words.toast}" }) {
                // 兩個欄位是一組的（`normalizePatch()`）：一起帶
                Backend.notes.update(id, linkedMapOf("customerId" to c?.get("id"), "customerName" to c?.get("name")))
            }
        }

        CardHeader("掛給誰", words.card.takeIf { it.isNotEmpty() }, onClose = { finish() })
        if (failed) {
            Text("讀不到客戶名單。先記下來，之後再掛人也行。", color = p.dim, fontSize = 14.sp)
        } else {
            CustomerChips(customers, query, { query = it }, currentId) { pick(it) }
        }
        ChipRow {
            if (currentId != null) Chip("✕ 不掛人") { pick(null) }
            Chip("先不要") { finish() }
        }
    }

    // ---------- 改文字 ----------

    @Composable
    private fun EditCard(n: Doc, reach: Notes.Reach?) {
        val p = LocalPalette.current
        val words = Notes.linkedWords(reach)
        val original = Js.str(n["text"])
        var field by remember { mutableStateOf(TextFieldValue(original, TextRange(original.length))) }
        var error by remember { mutableStateOf<String?>(null) }
        var asking by remember { mutableStateOf(false) }
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        val changed = field.text != original

        BackHandler { if (changed) asking = true else finish() }

        CardHeader("改文字", words.card.takeIf { it.isNotEmpty() }, onClose = { if (changed) asking = true else finish() })
        BigField(field, { field = it; error = null }, Modifier.focusRequester(focus))
        error?.let { Text(it, color = p.overdue, fontSize = 14.sp) }
        PrimaryButton("存起來", enabled = Js.trim(field.text).isNotEmpty()) {
            if (!changed) return@PrimaryButton finish()
            val errors = Notes.validateNote(n + ("text" to field.text))
            if (errors.isNotEmpty()) {
                error = errors.first()
                return@PrimaryButton
            }
            val id = Js.str(n["id"])
            write({ "改好了${words.toast}" }) { Backend.notes.update(id, linkedMapOf("text" to field.text)) }
        }
        if (asking) DiscardDialog("改的字要丟掉嗎？", onDiscard = { finish() }, onKeep = { asking = false })
    }

    // ---------- 複製到別天 ----------

    @Composable
    private fun CopyCard(n: Doc, peers: List<Doc>, group: List<Doc>, today: String) {
        val p = LocalPalette.current
        val own = n["date"]?.let { Js.str(it) }?.takeIf { it.isNotEmpty() }
        // 圈起來的那幾天照 `copyPlan()` 算（連在一起時會跳過的那幾天），不在畫面上另算一份
        val taken = remember(group) { Notes.copyPlan(n, emptyList(), linked = true, group = group, newLinkId = "(新的一組)").taken.toSet() }
        var cursor by remember { mutableStateOf(YearMonth.from(LocalDate.parse(if (own != null && own >= today) own else today))) }
        var picked by remember { mutableStateOf(setOf<String>()) }
        var linked by remember { mutableStateOf(true) }
        val id = Js.str(n["id"])

        CardHeader("複製到別天", onClose = { finish() })
        if (peers.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.chip).clickable {
                    write({ "拆開了：${own?.let(Dates::shortDate) ?: "這一筆"}以後自己勾" }) { Backend.notes.unlink(id) }
                }.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("拆開這一天${own?.let { "（${Dates.shortDate(it)}）" } ?: ""}", color = p.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                Text("以後這一天自己勾", color = p.mute, fontSize = 13.sp)
            }
        }
        MonthGrid(cursor, today, own, taken, picked, onStep = { cursor = cursor.plusMonths(it.toLong()) }) { d ->
            picked = if (d in picked) picked - d else picked + d
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.accentSoft).clickable { linked = !linked }
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = linked, onCheckedChange = { linked = it }, colors = CheckboxDefaults.colors(checkedColor = p.accent, checkmarkColor = p.onAccent))
            // 已經勾掉的那一筆不拉進來（網頁 `copyDaysHtml()` 同一句，ADR-0179）—— 連在一起的是新的那幾天
            Text(
                if (Js.truthy(n["done"])) "新的那幾天連在一起：勾一天，其他天一起勾（這一筆已經勾了，不算在裡面）" else "連在一起：勾一天，其他天一起勾",
                color = p.text,
                fontSize = 15.sp,
            )
        }
        PrimaryButton("複製到 ${picked.size} 天", enabled = picked.isNotEmpty()) {
            val dates = picked.sorted()
            val asked = linked
            var result: tw.baofu.notes.core.NotesWriter.CopyResult? = null
            write({ result?.let { Notes.copiedSay(it.created, asked, it.together, it.sourceIn) } ?: "複製好了" }) {
                result = Backend.notes.copyTo(n, dates, linked = asked)
            }
        }
    }

    /** 小月曆：週一起算（跟 app 的月曆一樣）；這一筆那一天與同一組已經有的那幾天虛線圈、點不了；今天以前點不了（段一定的、她 11/6 回「照建議」）。 */
    @Composable
    private fun MonthGrid(
        month: YearMonth,
        today: String,
        own: String?,
        taken: Set<String>,
        picked: Set<String>,
        onStep: (Int) -> Unit,
        onTap: (String) -> Unit,
    ) {
        val p = LocalPalette.current
        val thisYear = today.substring(0, 4).toInt()
        Row(verticalAlignment = Alignment.CenterVertically) {
            NavButton("‹") { onStep(-1) }
            Text(
                if (month.year == thisYear) "${month.monthValue}月" else "${month.year}年${month.monthValue}月",
                color = p.text, fontSize = 17.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f),
            )
            NavButton("›") { onStep(1) }
        }
        Row(Modifier.fillMaxWidth()) {
            listOf("一", "二", "三", "四", "五", "六", "日").forEach {
                Text(it, color = p.mute, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            }
        }
        val first = month.atDay(1)
        val start = first.minusDays((first.dayOfWeek.value - 1).toLong()) // 週一
        val last = month.atEndOfMonth()
        var week = start
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            while (!week.isAfter(last)) {
                Row(Modifier.fillMaxWidth()) {
                    for (i in 0 until 7) {
                        val day = week.plusDays(i.toLong())
                        val iso = day.toString()
                        val there = iso == own || iso in taken
                        val disabled = there || iso < today
                        val on = iso in picked
                        val inMonth = day.month == month.month
                        Box(Modifier.weight(1f).aspectRatio(1.15f), contentAlignment = Alignment.Center) {
                            var m = Modifier.size(38.dp).clip(CircleShape)
                            if (on) m = m.background(p.accent)
                            if (there) m = m.border(1.5.dp, p.accent.copy(alpha = 0.6f), CircleShape)
                            if (!disabled) m = m.clickable { onTap(iso) }
                            Box(m, contentAlignment = Alignment.Center) {
                                Text(
                                    "${day.dayOfMonth}",
                                    color = when {
                                        on -> p.onAccent
                                        disabled || !inMonth -> p.mute
                                        else -> p.text
                                    },
                                    fontSize = 15.sp,
                                    fontWeight = if (on || iso == today) FontWeight.Bold else FontWeight.Normal,
                                )
                            }
                        }
                    }
                }
                week = week.plusDays(7)
            }
        }
    }

    @Composable
    private fun NavButton(label: String, onClick: () -> Unit) {
        val p = LocalPalette.current
        Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
            Text(label, color = p.dim, fontSize = 24.sp)
        }
    }

    companion object {
        const val EXTRA_ID = "noteId"

        fun intent(context: Context, id: String): Intent =
            Intent(context, MenuActivity::class.java).putExtra(EXTRA_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }
}
