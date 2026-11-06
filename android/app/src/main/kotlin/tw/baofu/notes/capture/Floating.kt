package tw.baofu.notes.capture

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Js
import tw.baofu.notes.widget.Palette
import tw.baofu.notes.widget.WidgetStore
import java.time.LocalDate

/**
 * 浮在桌面上的那一層（08）：輸入卡與點一筆跳出的選單共用。
 *
 * 透明的 activity：**後面桌面調暗**（`FLAG_DIM_BEHIND`），Android 12+ 而且這支手機開著跨視窗模糊就再模糊一點（`blurBehindRadius`）；
 * 不支援的照樣調暗（spec「一」）。卡貼在鍵盤上面：edge-to-edge ＋ `adjustResize` ＋ `imePadding()` ——
 * 全螢幕的網頁 app 踩過鍵盤蓋住的坑（ADR-0181），這一層在 HTC 實機量過。顏色跟著小工具的深色／淺色（[WidgetStore.isDark]）。
 */
abstract class FloatingActivity : ComponentActivity() {
    protected val palette: Palette get() = Palette.of(WidgetStore.isDark(this))

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.setDimAmount(DIM)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && windowManager.isCrossWindowBlurEnabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
            window.attributes = window.attributes.apply { blurBehindRadius = BLUR }
        }
    }

    companion object {
        const val DIM = 0.38f
        const val BLUR = 28
    }
}

val LocalPalette = compositionLocalOf { Palette.Light }

/** 整片是「點外面」，卡片貼在底部、鍵盤上面。 */
@Composable
fun FloatingLayer(onOutside: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.fillMaxSize()
            .clickable(interactionSource = remember0(), indication = null, onClick = onOutside)
            .statusBarsPadding().navigationBarsPadding().imePadding()
            .padding(horizontal = 12.dp, vertical = 10.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth()
                .clip(RoundedCornerShape(26.dp)).background(p.card)
                // 卡片裡點不算點外面
                .clickable(interactionSource = remember0(), indication = null) {}
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
private fun remember0() = androidx.compose.runtime.remember { MutableInteractionSource() }

@Composable
fun CardHeader(title: String, subtitle: String? = null, onClose: () -> Unit) {
    val p = LocalPalette.current
    Row(verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
            Text(title, color = p.text, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, color = p.dim, fontSize = 13.sp)
        }
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable(onClick = onClose),
            contentAlignment = Alignment.Center,
        ) { Text("✕", color = p.mute, fontSize = 20.sp) }
    }
}

enum class ChipKind { PLAIN, ON, SUGGEST }

@Composable
fun Chip(label: String, kind: ChipKind = ChipKind.PLAIN, small: String? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    val (fg, bg, line) = when (kind) {
        ChipKind.ON -> Triple(p.onAccent, p.accent, p.accent)
        ChipKind.SUGGEST -> Triple(p.accent, p.accentSoft, p.accent.copy(alpha = 0.5f))
        ChipKind.PLAIN -> Triple(p.text, p.field, p.line.copy(alpha = 0.35f))
    }
    Row(
        Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(bg)
            .border(BorderStroke(1.dp, line), RoundedCornerShape(20.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = fg, fontSize = 15.sp, maxLines = 1)
        if (small != null) Text(" $small", color = if (kind == ChipKind.ON) fg.copy(alpha = 0.8f) else p.tea, fontSize = 12.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipRow(content: @Composable () -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

@Composable
fun PrimaryButton(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(26.dp))
            .background(if (enabled) p.accent else p.chip)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (enabled) p.onAccent else p.mute, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
}

/** 一格搜尋（名字或病歷號）。 */
@Composable
fun SearchField(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(color = p.text, fontSize = 16.sp),
        cursorBrush = SolidColor(p.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        modifier = modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.field)
                    .border(1.dp, p.line.copy(alpha = 0.35f), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                if (value.isEmpty()) Text("找名字或病歷號", color = p.mute, fontSize = 16.sp)
                inner()
            }
        },
    )
}

/**
 * 客戶的一排丸子＋最上面一格搜尋（網頁 `wireWho()`／`askCustomer()` 那一排的樣子）。一次性客人標「一次性」。
 */
@Composable
fun CustomerChips(customers: List<Doc>?, query: String, onQuery: (String) -> Unit, currentId: String?, onPick: (Doc) -> Unit) {
    val p = LocalPalette.current
    when {
        customers == null -> Text("讀取中…", color = p.dim, fontSize = 14.sp)
        customers.isEmpty() -> Text("還沒有客戶。", color = p.dim, fontSize = 14.sp)
        else -> {
            SearchField(query, onQuery)
            val shown = customers.filter { Customers.matches(it, query) }
            Box(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                if (shown.isEmpty()) {
                    Text("找不到這個名字或病歷號。", color = p.dim, fontSize = 14.sp)
                } else {
                    ChipRow {
                        shown.forEach { c ->
                            Chip(
                                Js.str(c["name"]),
                                kind = if (c["id"] == currentId) ChipKind.ON else ChipKind.PLAIN,
                                small = if (Customers.isOneTime(c)) "一次性" else null,
                            ) { onPick(c) }
                        }
                    }
                }
            }
        }
    }
}

/** 丟掉／繼續寫：**點外面關掉＝繼續寫**（網頁 `chooseAction()` 的意思：手滑關掉不等於不要了）。 */
@Composable
fun DiscardDialog(message: String, onDiscard: () -> Unit, onKeep: () -> Unit) {
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onKeep,
        containerColor = p.card,
        text = { Text(message, color = p.text, fontSize = 16.sp) },
        confirmButton = { TextButton(onClick = onDiscard) { Text("丟掉", color = p.overdue, fontSize = 16.sp) } },
        dismissButton = { TextButton(onClick = onKeep) { Text("繼續寫", color = p.accent, fontSize = 16.sp) } },
    )
}

/** 大一號的輸入框：2 行高起、長到 4 行、再多在框裡捲（她 11/6「2行高就好了，字多了4 行高」）。 */
@Composable
fun BigField(
    value: androidx.compose.ui.text.input.TextFieldValue,
    onChange: (androidx.compose.ui.text.input.TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
) {
    val p = LocalPalette.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        minLines = 2,
        maxLines = 4,
        textStyle = TextStyle(color = p.text, fontSize = 19.sp, lineHeight = 27.sp),
        cursorBrush = SolidColor(p.accent),
        modifier = modifier.fillMaxWidth(),
        decorationBox = { inner ->
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(p.field)
                    .border(1.5.dp, p.text.copy(alpha = 0.55f), RoundedCornerShape(18.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                if (value.text.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, color = p.mute, fontSize = 19.sp)
                inner()
            }
        },
    )
}

/** 系統的日期選擇。 */
fun pickDate(context: Context, initial: String?, onPicked: (String) -> Unit) {
    val d = initial?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: LocalDate.now()
    DatePickerDialog(context, { _, y, m, day -> onPicked(LocalDate.of(y, m + 1, day).toString()) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
}

fun openWeb(context: Context, url: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** 跳一句。寫完的那幾句是在背景（[tw.baofu.notes.AppScope]）講的 —— Toast 只能在主執行緒做，不然整支程式當掉（HTC 上撞到）。 */
fun say(context: Context, text: String) {
    val app = context.applicationContext
    Handler(Looper.getMainLooper()).post { Toast.makeText(app, text, Toast.LENGTH_SHORT).show() }
}
