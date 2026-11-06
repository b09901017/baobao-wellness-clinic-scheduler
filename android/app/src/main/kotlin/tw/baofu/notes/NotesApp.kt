package tw.baofu.notes

import android.app.Application

class NotesApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Backend.init(this)
    }
}
