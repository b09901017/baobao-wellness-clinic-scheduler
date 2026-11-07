package tw.baofu.notes.widget

import androidx.compose.ui.graphics.Color

/**
 * 小工具與浮在桌面上的卡片用的顏色：**照網頁 `public/css/tokens.css` 的那一組**（淺色與深色各一份），
 * 她在兩邊看到的綠、茶、逾期紅是同一個顏色。改了 tokens.css 的這幾個要回來改這裡。
 *
 * 小工具的底是半透明的（spec：三星 One UI 7+ 由桌面替它模糊、HTC 是半透明）：alpha 必須在 1–254 之間，
 * 三星才會模糊；值先固定一個在桌布上字看得清楚的（不做滑桿）。
 */
data class Palette(
    val glass: Color,
    val text: Color,
    val dim: Color,
    val mute: Color,
    val line: Color,
    val accent: Color,
    val onAccent: Color,
    val accentSoft: Color,
    val tea: Color,
    val teaSoft: Color,
    val overdue: Color,
    val chip: Color,
    val micBg: Color,
    val card: Color,
    val field: Color,
) {
    companion object {
        /** 半透明的底：0xD9 ≈ 85%（HTC 不模糊，再淡字就看不清楚；三星上照樣是 1–254 會被模糊）。 */
        private const val GLASS_ALPHA = 0xD9

        val Light = Palette(
            glass = Color(0xFAF7F0 or (GLASS_ALPHA shl 24)),
            text = Color(0xFF241F1A),
            dim = Color(0xFF6B6157),
            mute = Color(0xFF9A9086),
            line = Color(0x1F241F1A),
            accent = Color(0xFF2F5D4C),
            onAccent = Color(0xFFFFFFFF),
            accentSoft = Color(0xFFE4EDE8),
            tea = Color(0xFFA4703C),
            teaSoft = Color(0xFFF5E9DC),
            overdue = Color(0xFFA63A2A),
            chip = Color(0xFFF3EFE8),
            micBg = Color(0x14241F1A),
            card = Color(0xFFFAF7F0),
            field = Color(0xFFFFFFFF),
        )

        val Dark = Palette(
            glass = Color(0x2E2921 or (GLASS_ALPHA shl 24)),
            text = Color(0xFFF0EBE3),
            dim = Color(0xFFA79D91),
            mute = Color(0xFF7E7568),
            line = Color(0x24F0EBE3),
            accent = Color(0xFF7FBBA3),
            onAccent = Color(0xFF14231C),
            accentSoft = Color(0xFF1E3229),
            tea = Color(0xFFD8A46A),
            teaSoft = Color(0xFF35291B),
            overdue = Color(0xFFE8877A),
            chip = Color(0xFF3B352C),
            micBg = Color(0x1FF0EBE3),
            card = Color(0xFF232019),
            field = Color(0xFF2E2921),
        )

        fun of(dark: Boolean) = if (dark) Dark else Light
    }
}
