package tw.baofu.notes

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tw.baofu.notes.widget.ThemeShortcut

class NotesApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Backend.init(this)
        ThemeShortcut.refresh(this)
    }
}

/**
 * 卡片收掉之後還要做完的事（存檔、換小工具的清單）：不跟著畫面一起取消。
 */
object AppScope {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun launch(block: suspend CoroutineScope.() -> Unit): Job = scope.launch(block = block)
}
