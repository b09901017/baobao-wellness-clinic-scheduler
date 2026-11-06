package tw.baofu.notes.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity as actionStartIntent
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextDecoration
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tw.baofu.notes.BuildConfig
import tw.baofu.notes.MainActivity
import tw.baofu.notes.R
import tw.baofu.notes.capture.CaptureActivity
import tw.baofu.notes.capture.MenuActivity
import tw.baofu.notes.core.Dates
import tw.baofu.notes.core.Js
import tw.baofu.notes.core.Notes
import tw.baofu.notes.core.WebLinks
import tw.baofu.notes.core.WidgetList
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 桌面小工具本體（07）：D 半透明便利貼（`.scratch/notes-widget/mockups/final-1～3.png`）。
 *
 * - 最外層 `appWidgetBackground()`（root 的 id 是 `@android:id/background`）＋半透明的底、provider 宣告 `widgetStyle`／`widgetSize`
 *   —— 三星 One UI 7+ 替它模糊桌布的條件（spec「查過的事實」；三星沒寫在文件裡，三星段九實機試）
 * - 標題「隨手記」＋數字（一組算 1：`Notes.openCount()`，跟網頁首頁同一支）、右上角灰的麥克風（這一輪不會動）與 ＋
 * - 清單：core 的 [WidgetList.sections]（今天 → 過了 → 沒日期 → 以後的；連在一起的一組一列）；段跟段之間一條很淡的線、不寫標題
 * - 點勾選框＝勾掉（劃線 3 秒後才離開，[WidgetSync.tick]）；**營養品的提醒點勾＝打開網頁問「給了哪幾款」**（`WebLinks.note`）
 * - ＋＝浮在桌面上的輸入卡、點字＝那一筆的選單（08，`capture/`）
 * - 點標題＝打開網頁 app 的隨手記那一頁（裝到主畫面的那一顆會接走它的網址）
 *
 * 規則一條都不在這裡：排序、分組、數字、徽章都問 core。
 */
class NotesWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = WidgetStore.flow(context)
        val dark = WidgetStore.darkFlow(context)
        val uid = WidgetSync.allowedUid(context)
        provideContent {
            val view by store.collectAsState()
            val isDark by dark.collectAsState()
            Content(context, if (uid == null || view?.uid != uid) null else view, signedIn = uid != null, palette = Palette.of(isDark == true))
        }
    }
}

class NotesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NotesWidget()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onUpdate(context: Context, appWidgetManager: android.appwidget.AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        WidgetSync.schedule(context)
        // 剛放上桌面、開機、重裝：手上沒有那一份就讀一次
        if (WidgetStore.current(context)?.loaded != true) {
            val pending = goAsync()
            scope.launch {
                try { WidgetSync.pull(context) } finally { pending.finish() }
            }
        }
    }

    /**
     * 裝了新版（App Distribution 更新、開發時重裝）：程式被換掉時 Glance 那一段跟著沒了，
     * 小工具會停在「讀取中」的轉圈直到下一次更新（HTC 上重裝時撞到）—— 換好就自己畫一次。
     */
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            val pending = goAsync()
            scope.launch {
                try { WidgetSync.push(context) } finally { pending.finish() }
            }
        }
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        WidgetSync.unschedule(context)
    }
}

/** 點一列的勾選框。 */
class TickAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[NOTE_ID] ?: return
        WidgetSync.tick(context.applicationContext, id)
    }

    companion object {
        val NOTE_ID = ActionParameters.Key<String>("noteId")
    }
}

private fun openUrl(url: String) = actionStartIntent(
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
)

private fun c(color: Color) = ColorProvider(color)

@Composable
private fun Content(context: Context, view: WidgetStore.View?, signedIn: Boolean, palette: Palette) {
    val today = Dates.todayIso()
    val (notes, ticking) = view?.let { WidgetSync.shown(it) } ?: (emptyList<Map<String, Any?>>() to emptySet())
    // 劃線中的那幾列（勾掉了、快取裡已經沒有）照原本的樣子放回去，排回原位
    val sections = WidgetList.sections(notes, today)
    val count = Notes.openCount(view?.notes ?: emptyList())

    Column(
        GlanceModifier.fillMaxSize().appWidgetBackground().background(c(palette.glass)).cornerRadius(24.dp)
            .padding(start = 16.dp, end = 12.dp, top = 10.dp, bottom = 6.dp),
    ) {
        Header(context, count.takeIf { view?.loaded == true }, palette)
        when {
            !signedIn -> Message("還沒登入：點這裡打開「隨手記」登入", palette, actionStartActivity<MainActivity>())
            view == null || !view.loaded -> Message("讀取中…", palette, null)
            sections.isEmpty() -> Message("沒有還沒做的事", palette, null)
            else -> LazyColumn(GlanceModifier.defaultWeight().fillMaxWidth()) {
                sections.forEachIndexed { i, section ->
                    if (i > 0) item { Divider(palette) }
                    items(section.rows, itemId = { (it.note["id"] as String).hashCode().toLong() }) { row ->
                        NoteRow(context, row, today, struck = row.members.any { it["id"] in ticking }, palette = palette)
                    }
                }
            }
        }
        if (view?.stale == true) {
            val at = view.syncedAt?.let { " · 顯示的是 ${SimpleDateFormat("H:mm", Locale.TAIWAN).format(Date(it))} 的" } ?: ""
            Text("讀不到最新的（網路？）$at", style = TextStyle(color = c(palette.mute), fontSize = 11.sp), maxLines = 1)
        }
    }
}

@Composable
private fun Header(context: Context, count: Int?, palette: Palette) {
    Row(GlanceModifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            GlanceModifier.defaultWeight().clickable(openUrl("${BuildConfig.WEB_ORIGIN}/#/todo/notes")),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("隨手記", style = TextStyle(color = c(palette.text), fontSize = 19.sp, fontWeight = FontWeight.Bold))
            if (count != null) {
                Spacer(GlanceModifier.width(6.dp))
                Text("$count", style = TextStyle(color = c(palette.mute), fontSize = 15.sp))
            }
        }
        // 麥克風：這一輪畫成灰的放著、點了不會動（她 11/6 看定稿圖 1；語音下一輪）
        Box(GlanceModifier.size(38.dp).background(c(palette.micBg)).cornerRadius(19.dp), contentAlignment = Alignment.Center) {
            Image(ImageProvider(R.drawable.ic_mic), contentDescription = "語音（下一版）", colorFilter = ColorFilter.tint(c(palette.mute)), modifier = GlanceModifier.size(18.dp))
        }
        Spacer(GlanceModifier.width(8.dp))
        Box(
            GlanceModifier.size(42.dp).background(c(palette.accent)).cornerRadius(21.dp).clickable(actionStartActivity<CaptureActivity>()),
            contentAlignment = Alignment.Center,
        ) {
            Image(ImageProvider(R.drawable.ic_plus), contentDescription = "記一筆", colorFilter = ColorFilter.tint(c(palette.onAccent)), modifier = GlanceModifier.size(22.dp))
        }
    }
}

@Composable
private fun Message(text: String, palette: Palette, action: androidx.glance.action.Action?) {
    val m = GlanceModifier.fillMaxWidth().padding(vertical = 12.dp)
    Text(text, style = TextStyle(color = c(palette.dim), fontSize = 14.sp), modifier = if (action != null) m.clickable(action) else m)
}

@Composable
private fun Divider(palette: Palette) {
    Box(GlanceModifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Box(GlanceModifier.fillMaxWidth().height(1.dp).background(c(palette.line))) {}
    }
}

@Composable
private fun NoteRow(context: Context, row: Notes.Row, today: String, struck: Boolean, palette: Palette) {
    val note = row.note
    val id = note["id"] as String
    val product = Js.truthy(note["entitlementId"])
    val tick = if (product) openUrl(WebLinks.note(BuildConfig.WEB_ORIGIN, id))
    else actionRunCallback<TickAction>(actionParametersOf(TickAction.NOTE_ID to id))

    Row(GlanceModifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.size(40.dp).clickable(tick), contentAlignment = Alignment.CenterStart) {
            Image(
                ImageProvider(if (struck) R.drawable.ic_box_checked else R.drawable.ic_box),
                contentDescription = if (struck) "剛勾掉，再點一下拿回來" else "勾掉",
                colorFilter = ColorFilter.tint(c(if (struck) palette.accent else palette.mute)),
                modifier = GlanceModifier.size(22.dp),
            )
        }
        Text(
            Js.str(note["text"]),
            maxLines = 1,
            style = TextStyle(
                color = c(if (struck) palette.mute else palette.text),
                fontSize = 15.sp,
                textDecoration = if (struck) TextDecoration.LineThrough else TextDecoration.None,
            ),
            modifier = GlanceModifier.defaultWeight().padding(end = 6.dp).clickable(rowTap(context, id)),
        )
        Badges(row, today, palette)
    }
}

/** 點字：浮在桌面上的那一筆的選單（08；小工具上沒有長按 —— 長按是手機拿來搬小工具的）。 */
private fun rowTap(context: Context, id: String) = actionStartIntent(MenuActivity.intent(context, id))

/** 一列右邊那幾顆：連在一起的「共 N 天」、掛給誰、日期（過了是逾期的字色、不是紅底 —— 跟網頁 `row()` 同一套意思）。 */
@Composable
private fun Badges(row: Notes.Row, today: String, palette: Palette) {
    val note = row.note
    val linked = Notes.linkedBadge(row)
    val who = Js.trimmed(note["customerName"]).takeIf { it.isNotEmpty() }
    val date = note["date"]?.let { Js.str(it) }?.takeIf { it.isNotEmpty() }
    // 跟網頁 `row()` 同一個順序：客戶、日期、共 N 天。今天的日期不畫（定稿圖 1：今天那幾列最上面，不用再寫一次）
    if (who != null) Pill(who, palette.tea, palette.teaSoft)
    if (date != null && date != today) Pill(Dates.shortDate(date).substringBefore('('), if (date < today) palette.overdue else palette.dim, palette.chip)
    if (linked != null) Pill(linked, palette.accent, palette.accentSoft)
}

@Composable
private fun Pill(text: String, fg: Color, bg: Color) {
    Box(GlanceModifier.padding(start = 4.dp)) {
        Box(GlanceModifier.background(c(bg)).cornerRadius(10.dp).padding(horizontal = 8.dp, vertical = 2.dp)) {
            Text(text, maxLines = 1, style = TextStyle(color = c(fg), fontSize = 12.sp))
        }
    }
}
