package tw.baofu.notes

import tw.baofu.notes.core.Doc
import tw.baofu.notes.core.Js
import tw.baofu.notes.core.WebLinks

/**
 * 點一筆的勾要怎麼走 —— **三個入口共用**：小工具那一列（`NotesWidget`／`WidgetSync.tick()`）、點字跳出來的選單（`MenuActivity`）、
 * 「隨手記」主畫面那份清單（`MainActivity`）。
 *
 * **營養品的提醒不在 Android 上勾**：打開網頁那一筆、問「給了哪幾款」（網頁 `prepareToggle()` → `recordDelivery()`：
 * 提醒勾掉與額度上的交付紀錄同一個 commit；ADR-0180 決定 3「不抄的」）。在這裡直接 `setDone()` 的話，
 * 提醒勾掉了、交付紀錄一筆都沒有（REVIEW-android R1：主畫面那一列漏了這一條）。
 * `NotesWriter.setDone()` 本身**不擋**：網頁 `data/notes.js` 的 `setDone()` 也不擋，擋在畫面這一層（跟 `prepareToggle()` 同一層）。
 */
object NoteTaps {
    /** 這一筆點勾＝打開網頁問「給了哪幾款」（營養品的提醒：身上掛著那一筆額度）。 */
    fun asksWhatWasGiven(note: Doc?): Boolean = Js.truthy(note?.get("entitlementId"))

    /** 問「給了哪幾款」的那一頁（網頁 `#/todo/notes/note/<id>`）。 */
    fun givePage(id: String): String = WebLinks.note(BuildConfig.WEB_ORIGIN, id)
}
