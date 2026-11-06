package tw.baofu.notes.core

import org.junit.Assert.assertEquals
import org.junit.Test

/** 情境檔 `links` 以外的那一條（網頁沒有回它的函式，只有各頁的 `go('/customers/…')`）。 */
class WebLinksTest {
    @Test
    fun customerPageIsTheHashRouteTheWebUses() {
        assertEquals("https://x.web.app/#/customers/c1", WebLinks.customer("https://x.web.app", "c1"))
    }
}
