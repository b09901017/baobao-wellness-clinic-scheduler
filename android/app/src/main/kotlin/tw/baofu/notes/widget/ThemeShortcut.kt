package tw.baofu.notes.widget

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import tw.baofu.notes.AppScope
import tw.baofu.notes.R

/**
 * 深色／淺色**她自己切換**（她 11/6：「也許可以長按那個app圖示，捷徑圖示，可以切換」）：
 * 長按「隨手記」圖示 → 一個捷徑「小工具改成深色」（現在是深色就是「改成淺色」）。預設淺色。
 *
 * 捷徑是動態的（[refresh]）：字跟著現在的樣子換；兩個版本的套件名不一樣，靜態的 `shortcuts.xml` 要寫死套件名。
 * 程式第一次跑起來（小工具放上桌面、打開 app）就排好。
 */
object ThemeShortcut {
    private const val ID = "widget-theme"
    const val EXTRA_DARK = "dark"

    fun refresh(context: Context) {
        val dark = WidgetStore.isDark(context)
        val intent = Intent(context, ThemeActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .putExtra(EXTRA_DARK, !dark)
        val label = if (dark) "小工具改成淺色" else "小工具改成深色"
        val shortcut = ShortcutInfoCompat.Builder(context, ID)
            .setShortLabel(label)
            .setLongLabel(label)
            .setIcon(IconCompat.createWithResource(context, if (dark) R.drawable.ic_sun else R.drawable.ic_moon))
            .setIntent(intent)
            .build()
        runCatching { ShortcutManagerCompat.setDynamicShortcuts(context, listOf(shortcut)) }
    }
}

/** 捷徑點下去：換樣子、小工具馬上換、捷徑的字換成反過來的那一個。沒有畫面。 */
class ThemeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dark = intent.getBooleanExtra(ThemeShortcut.EXTRA_DARK, !WidgetStore.isDark(this))
        WidgetStore.setDark(this, dark)
        ThemeShortcut.refresh(this)
        Toast.makeText(this, if (dark) "小工具換成深色了" else "小工具換成淺色了", Toast.LENGTH_SHORT).show()
        val app = applicationContext
        AppScope.launch { WidgetSync.push(app) }
        finish()
    }
}
