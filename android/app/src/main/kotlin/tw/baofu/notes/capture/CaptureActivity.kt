package tw.baofu.notes.capture

import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import tw.baofu.notes.AppScope
import tw.baofu.notes.BuildConfig
import tw.baofu.notes.core.Dates
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Js
import tw.baofu.notes.core.Names
import tw.baofu.notes.core.Notes
import tw.baofu.notes.core.WebLinks
import tw.baofu.notes.widget.WidgetSync
import tw.baofu.notes.Backend

/**
 * 小工具的 ＋：**浮在桌面上的輸入卡**（08，定稿圖 2 的 4、5）。
 *
 * - 一打開鍵盤就跳出來、游標在框裡；卡貼在鍵盤上面（[FloatingLayer]）
 * - 輸入框 2 行高起、長到 4 行（[BigField]），字比網頁大一號；最多 200 字（core `Notes.validateNote()` 擋，跟網頁同一句）
 * - 一排：今天／挑日期（系統的日期選擇）／掛給誰（名單＋搜尋）／給營養品（**打開網頁的「記一筆」並展開給營養品**，`WebLinks.newGive`）
 * - 打名字跳出客戶：core 的 `Names.nameSuggestions()`（跟網頁同一套、情境檔盯著）；**注音選字中不跳**（`composition` 還在就不找）；
 *   點一位 → 框裡那一段換成全名、游標接在後面、同時掛給他
 * - 「記下來」→ `Backend.notes.create()`（沒網路也存）→ 卡收掉 → 小工具馬上換（[WidgetSync.localWrite]）
 * - 按返回／點外面／✕：框裡有字時問一句要不要丟掉；點那一句外面＝繼續寫
 * - 打開的那一下跟雲端對一次（她 11/6：按 ＋ 時抓一次最新的）
 */
class CaptureActivity : FloatingActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = applicationContext
        AppScope.launch { WidgetSync.pull(app) }
        setContent { CompositionLocalProvider(LocalPalette provides palette) { Capture() } }
    }

    @Composable
    private fun Capture() {
        val p = LocalPalette.current
        val scope = rememberCoroutineScope()
        val today = remember { Dates.todayIso() }
        var field by remember { mutableStateOf(TextFieldValue("")) }
        var date by remember { mutableStateOf<String?>(null) }
        var who by remember { mutableStateOf<Doc?>(null) }
        var whoOpen by remember { mutableStateOf(false) }
        var query by remember { mutableStateOf("") }
        var customers by remember { mutableStateOf<List<Doc>?>(null) }
        var loadFailed by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        var asking by remember { mutableStateOf<(() -> Unit)?>(null) }
        val focus = remember { FocusRequester() }
        val keyboard = LocalSoftwareKeyboardController.current

        fun loadCustomers() {
            if (customers != null || loadFailed) return
            scope.launch {
                try {
                    customers = Customers.load()
                } catch (e: Exception) {
                    loadFailed = true
                }
            }
        }

        LaunchedEffect(Unit) {
            focus.requestFocus()
            keyboard?.show()
        }

        /** 有字就先問；沒字直接做。 */
        fun leave(then: () -> Unit = {}) {
            if (Js.trim(field.text).isEmpty()) {
                then()
                finish()
            } else {
                asking = { then(); finish() }
            }
        }

        BackHandler { leave() }

        fun save() {
            val data = linkedMapOf<String, Any?>(
                "text" to field.text,
                "date" to date,
                "customerId" to who?.get("id"),
                "customerName" to who?.get("name"),
            )
            val errors = Notes.validateNote(data)
            if (errors.isNotEmpty()) {
                error = errors.first()
                return
            }
            val app = applicationContext
            // 寫進這台手機的快取是馬上的（沒網路也是）；等不等伺服器都不擋她 —— 卡先收掉
            AppScope.launch {
                try {
                    WidgetSync.localWrite(app) { Backend.notes.create(data) }
                } catch (e: Exception) {
                    say(app, "存不進去：${e.message ?: e::class.simpleName}")
                }
            }
            finish()
        }

        FloatingLayer(onOutside = { leave() }) {
            CardHeader("記一筆", onClose = { leave() })
            BigField(
                field,
                onChange = {
                    field = it
                    error = null
                    if (it.text.isNotEmpty()) loadCustomers()
                },
                modifier = Modifier.focusRequester(focus),
            )
            error?.let { Text(it, color = p.overdue, fontSize = 14.sp) }

            // 打名字跳出客戶：注音還在選字（composition 還在）就不找
            val hits = if (field.composition == null && customers != null) {
                Names.nameSuggestions(field.text, field.selection.start, customers, Customers.collator, who?.get("id") as String?)
            } else {
                null
            }
            if (hits != null && hits.matches.isNotEmpty()) {
                ChipRow {
                    hits.matches.forEach { c ->
                        val name = Js.str(c["name"])
                        Chip(name, ChipKind.SUGGEST, small = if (Customers.isOneTime(c)) "一次性" else null) {
                            val text = field.text.substring(0, hits.from) + name + field.text.substring(hits.to)
                            field = TextFieldValue(text, TextRange(hits.from + name.length))
                            who = c
                        }
                    }
                }
            }

            ChipRow {
                if (date == null || date == today) {
                    Chip("今天", if (date == today) ChipKind.ON else ChipKind.PLAIN) { date = if (date == today) null else today }
                } else {
                    Chip(Dates.shortDate(date!!), ChipKind.ON) { date = null }
                }
                Chip("挑日期") { pickDate(this@CaptureActivity, date ?: today) { date = it } }
                if (who != null) {
                    Chip(Js.str(who!!["name"]), ChipKind.ON) { whoOpen = !whoOpen; if (whoOpen) loadCustomers() }
                    Chip("✕ 不掛了") { who = null }
                } else {
                    Chip("掛給誰", if (whoOpen) ChipKind.ON else ChipKind.PLAIN) { whoOpen = !whoOpen; if (whoOpen) loadCustomers() }
                }
                Chip("給營養品") { leave { openWeb(applicationContext, WebLinks.newGive(BuildConfig.WEB_ORIGIN)) } }
            }

            if (whoOpen) {
                if (loadFailed) {
                    Text("讀不到客戶名單。先記下來，之後再掛人也行。", color = p.dim, fontSize = 14.sp)
                } else {
                    CustomerChips(customers, query, { query = it }, who?.get("id") as String?) { c ->
                        who = c
                        whoOpen = false
                        query = ""
                        focus.requestFocus()
                    }
                }
            }

            Spacer(Modifier.height(2.dp))
            PrimaryButton("記下來", enabled = Js.trim(field.text).isNotEmpty()) { save() }
        }

        asking?.let { go ->
            DiscardDialog("剛剛打的字要丟掉嗎？", onDiscard = { asking = null; go() }, onKeep = { asking = null })
        }
    }
}
