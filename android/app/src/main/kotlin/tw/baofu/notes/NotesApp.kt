package tw.baofu.notes

import android.app.Application
import android.util.Log
import kotlinx.coroutines.CoroutineExceptionHandler
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
    /** 背景那一段出錯不可以把整支程式帶走（小工具會停在舊的、輸入卡下一次打不開）：記一行，其餘照常。 */
    private val guard = CoroutineExceptionHandler { _, e -> Log.e("AppScope", "背景的一段失敗了", e) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + guard)

    fun launch(block: suspend CoroutineScope.() -> Unit): Job = scope.launch(block = block)
}
