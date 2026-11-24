import com.freetune.RecordingStoreProbe
import com.freetune.reserveRecordingFile
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import android.media.MediaExtractor

fun checkRecordingFiles(directory: File) {
    val root=File(directory,"recording-file-regressions").apply { mkdirs() }
    val failures=mutableListOf<String>()
    fun runCase(name: String, body: (File, RecordingStoreProbe)->Unit) {
        val folder=File(root,name).apply { mkdirs() }
        val store=RecordingStoreProbe(folder)
        try { body(folder,store) }
        catch(error: Throwable) { failures.add("$name: ${error.message}") }
        finally {
            store.filesWorker.shutdownNow()
            check(store.filesWorker.awaitTermination(5,TimeUnit.SECONDS))
            folder.listFiles()?.forEach { check(it.delete()) }; check(folder.delete())
        }
    }
    fun list(store: RecordingStoreProbe): WritableArray {
        var result: WritableArray?=null
        var failure: Throwable?=null
        val finished=CountDownLatch(1)
        store.listTakes("1",object:Promise {
            override fun resolve(value: Any) { result=value as WritableArray; finished.countDown() }
            override fun reject(code: String,error: Throwable) { failure=error; finished.countDown() }
        })
        check(finished.await(5,TimeUnit.SECONDS)) { "List did not complete" }
        failure?.let { throw it }
        return result ?: error("List did not resolve")
    }
    runCase("reserve-collision") { folder,_ ->
        val existing=File(folder,"song-1-100.m4a").apply { writeText("saved take") }
        val partial=File(folder,"song-1-101.processing.m4a").apply { writeText("recoverable take") }
        val marker=File(folder,"song-1-102.interrupted").apply { createNewFile() }
        val reserved=reserveRecordingFile(folder,"1",100)
        check(reserved.name=="song-1-103.m4a" && reserved.exists())
        check(existing.readText()=="saved take" && partial.readText()=="recoverable take" && marker.exists())
        check(reserved.delete())
        check(existing.readText()=="saved take")
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
        check(rows[0].values["interrupted"] == true) { "Recovered recording lost its interrupted status" }
    }
    runCase("active-take-protected") { folder,store ->
        val final=File(folder,"song-1-12.m4a").apply { createNewFile() }
        val partial=File(folder,"song-1-12.processing.m4a").apply { writeText("capture in progress") }
        store.processing.add(final.absolutePath)
        store.activeRecordingFiles.add(final.absolutePath)
        list(store)
        check(final.exists() && partial.readText()=="capture in progress")
    }
    runCase("recovery-keeps-playback-and-reservation-responsive") { folder,store ->
        File(folder,"song-1-15.processing.m4a").writeText("complete audio")
        val entered=CountDownLatch(1)
        val resume=CountDownLatch(1)
        val finished=CountDownLatch(1)
        var heldPlaybackLock=false
        var heldReservationLock=false
        var failure: Throwable?=null
        MediaExtractor.onOpen={
            heldPlaybackLock=Thread.holdsLock(store)
            heldReservationLock=Thread.holdsLock(store.recordingFilesLock)
            entered.countDown()
            check(resume.await(5,TimeUnit.SECONDS)) { "Recovery did not resume" }
        }
        try {
            store.listTakes("1",object:Promise {
                override fun resolve(value: Any) { finished.countDown() }
                override fun reject(code: String,error: Throwable) { failure=error; finished.countDown() }
            })
            check(entered.await(5,TimeUnit.SECONDS))
            check(finished.count==1L) { "Listing blocked its caller until decoder completion" }
            check(!heldPlaybackLock && !heldReservationLock) { "Recovery decoder held an interactive lock" }
            synchronized(store) { check(finished.count==1L) }
            val reserve=store.javaClass.getDeclaredMethod("reserveActiveRecordingFile",String::class.java).apply { isAccessible=true }
            val fresh=reserve.invoke(store,"1") as File
            check(fresh.exists() && fresh.absolutePath in store.activeRecordingFiles)
            resume.countDown()
            check(finished.await(5,TimeUnit.SECONDS))
            failure?.let { throw it }
            list(store)
            check(fresh.exists()) { "Background listing deleted a reserved take before capture began" }
        } finally { resume.countDown(); MediaExtractor.onOpen=null }
    }
    runCase("delete-file-family") { folder,store ->
        val final=File(folder,"song-1-13.m4a").apply { writeText("complete audio") }
        val partial=File(folder,"song-1-13.processing.m4a").apply { writeText("orphan") }
        val marker=File(folder,"song-1-13.interrupted").apply { createNewFile() }
        store.deleteTake(final.absolutePath,object:Promise { override fun resolve(value: Any) { check(value==true) } })
        check(!final.exists() && !partial.exists() && !marker.exists()) { "Deleting the take left its hidden companion" }
    }
    runCase("orphan-status") { folder,store ->
        val marker=File(folder,"song-1-14.interrupted").apply { createNewFile() }
        list(store)
        check(!marker.exists()) { "Orphan interrupted status survived cleanup" }
    }
    check(root.delete())
    check(failures.isEmpty()) { failures.joinToString("; ") }
    println("Recording file regressions passed: asynchronous scans, unlocked decoding, reserved/active protection, incomplete cleanup, recovery and file-family deletion (codec boundary stubbed).")
}
