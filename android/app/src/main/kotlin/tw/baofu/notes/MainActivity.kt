package tw.baofu.notes

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import kotlinx.coroutines.launch
import tw.baofu.notes.capture.openWeb
import tw.baofu.notes.core.Dates
import tw.baofu.notes.core.Notes
import tw.baofu.notes.widget.NotesWidgetReceiver
import tw.baofu.notes.widget.WidgetSync

/**
 * 打開「隨手記」那一顆：登入、確認讀寫接得上。**這一頁只是骨架**（段五，issue 06）——
 * 桌面小工具（07）與浮在桌面上的輸入卡（08）在段六，樣子照 `.scratch/notes-widget/mockups/` 她點過頭的那一版。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { NotesScreen(this) } }
    }
}

private sealed interface Gate {
    data object SignedOut : Gate
    data object Checking : Gate
    data object Allowed : Gate
}

@Composable
private fun NotesScreen(activity: MainActivity) {
    val scope = rememberCoroutineScope()
    var gate by remember {
        mutableStateOf(
            when {
                Backend.auth.currentUser == null -> Gate.SignedOut
                SignIn.rememberedAllowed(activity) -> Gate.Allowed
                else -> Gate.Checking
            },
        )
    }
    var message by remember { mutableStateOf("") }

    fun show(outcome: SignIn.Outcome) {
        when (outcome) {
            SignIn.Outcome.Allowed -> {
                gate = Gate.Allowed
                message = ""
                // 小工具跟著換成這一位的（整份讀一次）
                val app = activity.applicationContext
                scope.launch { WidgetSync.pull(app, full = true) }
            }
            is SignIn.Outcome.NotAllowed -> {
                gate = Gate.SignedOut
                message = "這個帳號（${outcome.email ?: "沒有 email"}）沒有權限，沒有寫任何東西"
                // 被登出了：小工具跟著換成「還沒登入」
                val app = activity.applicationContext
                scope.launch { WidgetSync.forget(app) }
            }
            SignIn.Outcome.Cancelled -> { gate = Gate.SignedOut; message = "" }
            is SignIn.Outcome.Failed -> { gate = if (Backend.auth.currentUser == null) Gate.SignedOut else Gate.Checking; message = outcome.message }
        }
    }

    if (gate == Gate.Checking) {
        DisposableEffect(Unit) {
            val job = scope.launch { show(SignIn.checkAllowed(activity)) }
            onDispose { job.cancel() }
        }
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(activity.getString(R.string.app_name), style = MaterialTheme.typography.headlineSmall)
        if (Backend.usesEmulator) Text("接的是本機模擬器（demo-scheduler）", style = MaterialTheme.typography.bodySmall)
        if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.error)

        when (gate) {
            Gate.SignedOut -> {
                Button(onClick = { scope.launch { show(SignIn.withGoogle(activity)) } }) { Text("用 Google 登入") }
                if (Backend.usesEmulator) {
                    OutlinedButton(onClick = { scope.launch { show(SignIn.withEmulatorTestAccount(activity)) } }) {
                        Text("用模擬器的測試帳號登入")
                    }
                }
            }
            Gate.Checking -> Text("確認帳號中…")
            Gate.Allowed -> NotesPanel(
                onSignOut = { scope.launch { SignIn.signOut(activity); WidgetSync.forget(activity.applicationContext); gate = Gate.SignedOut } },
                say = { message = it },
            )
        }
    }
}

@Composable
private fun ColumnScope.NotesPanel(onSignOut: () -> Unit, say: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf(emptyList<Notes.Row>()) }

    // 打開 app 也跟雲端對一次（小工具跟著換）
    LaunchedEffect(Unit) { WidgetSync.pull(context.applicationContext) }

    // 還沒勾的（網頁 `listOpen()` 同一個查詢、同一個索引）；本機還沒送出的那幾筆也在裡面（離線照記）
    DisposableEffect(Unit) {
        val reg: ListenerRegistration = Backend.db.collection("notes")
            .whereEqualTo("deletedAt", null)
            .whereEqualTo("done", false)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    say(Say.failed("讀不到隨手記", err))
                    return@addSnapshotListener
                }
                val docs = snap?.documents?.map { linkedMapOf<String, Any?>("id" to it.id) + FirestoreNoteStore.toCore(it.data ?: emptyMap<String, Any?>()) }
                rows = Notes.groupLinked(docs ?: emptyList(), Dates.todayIso())
            }
        onDispose { reg.remove() }
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("記一筆") }, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Button(onClick = {
            val data = mapOf("text" to text)
            val errors = Notes.validateNote(data)
            if (errors.isNotEmpty()) {
                say(errors.first())
                return@Button
            }
            scope.launch {
                try {
                    Backend.notes.create(data)
                    text = ""
                    WidgetSync.afterLocalWrite(context.applicationContext)
                    say(Say.saved("記好了") ?: "記好了")
                } catch (e: Exception) {
                    say(Say.failed("存不進去", e))
                }
            }
        }) { Text("記") }
    }

    LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
        items(rows, key = { it.note["id"] as String }) { row ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = false, onCheckedChange = {
                    // 營養品的提醒：打開網頁問「給了哪幾款」，不在這裡勾（REVIEW-android R1；三個入口共用 `NoteTaps`）
                    if (NoteTaps.asksWhatWasGiven(row.note)) {
                        openWeb(context, NoteTaps.givePage(row.note["id"] as String))
                        return@Checkbox
                    }
                    scope.launch {
                        try {
                            Backend.notes.setDone(row.note["id"] as String, true)
                            WidgetSync.afterLocalWrite(context.applicationContext)
                        } catch (e: Exception) {
                            say(Say.failed("勾不掉", e))
                        }
                    }
                })
                val date = row.note["date"] as String?
                val badge = Notes.linkedBadge(row)
                Text(listOfNotNull(row.note["text"] as String?, date?.let(Dates::shortDate), badge).joinToString("・"))
            }
        }
    }

    // 把小工具放到桌面：系統跳一個框問要不要放（桌面支援的話）；不支援的講怎麼自己放
    OutlinedButton(onClick = {
        val manager = AppWidgetManager.getInstance(context)
        val provider = ComponentName(context, NotesWidgetReceiver::class.java)
        if (manager.isRequestPinAppWidgetSupported) manager.requestPinAppWidget(provider, null, null)
        else say("長按桌面空白的地方 → 小工具 → 找「${context.getString(R.string.app_name)}」")
    }) { Text("把小工具放到桌面") }
    OutlinedButton(onClick = onSignOut) { Text("登出") }
}
