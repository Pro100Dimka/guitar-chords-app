package android.content

import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.os.CancellationSignal
import java.io.FileNotFoundException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue

class ContentResolver {
    companion object {
        val gates = LinkedBlockingQueue<CountDownLatch>()
        val opened = LinkedBlockingQueue<CountDownLatch>()
    }
    fun openAssetFileDescriptor(uri: Uri, mode: String, signal: CancellationSignal): AssetFileDescriptor? {
        val gate = gates.poll() ?: throw FileNotFoundException("fixture")
        opened.add(gate)
        // Deliberately model a remote provider ignoring interruption and cancellation.
        while (gate.count > 0) try { gate.await() } catch (_: InterruptedException) {}
        return AssetFileDescriptor()
    }
}
