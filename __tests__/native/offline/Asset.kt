package android.content.res

import java.io.Closeable
import java.io.FileDescriptor
import java.util.concurrent.LinkedBlockingQueue

class AssetFileDescriptor : Closeable {
    companion object { val closed = LinkedBlockingQueue<Boolean>() }
    val length = 0L
    val startOffset = 0L
    val fileDescriptor = FileDescriptor()
    override fun close() { closed.add(true) }
}
