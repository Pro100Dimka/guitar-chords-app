import com.freetune.RecordingStoreProbe
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import java.io.File

fun checkRecordingFiles(directory: File) {
    val root=File(directory,"recording-file-regressions").apply { mkdirs() }
    val failures=mutableListOf<String>()
    fun runCase(name: String, body: (File, RecordingStoreProbe)->Unit) {
        val folder=File(root,name).apply { mkdirs() }
        try { body(folder,RecordingStoreProbe(folder)) }
        catch(error: Throwable) { failures.add("$name: ${error.message}") }
        finally { folder.listFiles()?.forEach { check(it.delete()) }; check(folder.delete()) }
    }
    fun list(store: RecordingStoreProbe): WritableArray {
        var result: WritableArray?=null
        store.listTakes("1",object:Promise { override fun resolve(value: Any) { result=value as WritableArray } })
        return result ?: error("List did not resolve")
    }
    runCase("invalid-interrupted") { folder,store ->
        val final=File(folder,"song-1-10.m4a").apply { createNewFile() }
        val partial=File(folder,"song-1-10.processing.m4a").apply { writeBytes(ByteArray(1048576)) }
        list(store)
        check(!partial.exists() && !final.exists()) { "Hidden incomplete recording data survived listing after restart" }
    }
    runCase("completed-before-rename") { folder,store ->
        val final=File(folder,"song-1-11.m4a").apply { createNewFile() }
        val partial=File(folder,"song-1-11.processing.m4a").apply { writeText("complete audio") }
        val rows=list(store).maps
        check(rows.size==1 && (rows[0].values["bytes"] as Double)>0) { "Completed interrupted take was not recovered" }
        check(final.readText()=="complete audio" && !partial.exists())
    }
    runCase("active-take-protected") { folder,store ->
        val final=File(folder,"song-1-12.m4a").apply { createNewFile() }
        val partial=File(folder,"song-1-12.processing.m4a").apply { writeText("capture in progress") }
        store.processing.add(final.absolutePath)
        list(store)
        check(final.exists() && partial.readText()=="capture in progress")
    }
    runCase("delete-file-family") { folder,store ->
        val final=File(folder,"song-1-13.m4a").apply { writeText("complete audio") }
        val partial=File(folder,"song-1-13.processing.m4a").apply { writeText("orphan") }
        store.deleteTake(final.absolutePath,object:Promise { override fun resolve(value: Any) { check(value==true) } })
        check(!final.exists() && !partial.exists()) { "Deleting the take left its hidden companion" }
    }
    check(root.delete())
    check(failures.isEmpty()) { failures.joinToString("; ") }
    println("Recording file regressions passed: incomplete cleanup, complete recovery, active protection and file-family deletion (codec boundary stubbed).")
}
