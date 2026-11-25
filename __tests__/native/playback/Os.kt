package android.os

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicLong

interface IBinder
open class Binder : IBinder
object Build { object VERSION { var SDK_INT = 36 } }
object SystemClock {
    val extra = AtomicLong()
    fun elapsedRealtime() = System.nanoTime() / 1_000_000 + extra.get()
}
class Looper {
    companion object {
        private val main = Looper()
        private val thread = ThreadLocal<Looper?>()
        fun getMainLooper() = main
        fun myLooper(): Looper? = thread.get()
        fun onMain(action: () -> Unit) {
            val before = thread.get()
            thread.set(main)
            try { action() } finally { thread.set(before) }
        }
    }
}
class Handler(looper: Looper) {
    fun post(action: Runnable): Boolean { queue.add(action); return true }
    fun postDelayed(action: Runnable, delay: Long): Boolean { delayed.add(action); return true }
    fun removeCallbacks(action: Runnable) { delayed.remove(action) }
    companion object {
        val queue = LinkedBlockingQueue<Runnable>()
        val delayed = mutableListOf<Runnable>()
        fun drain() {
            while (true) {
                val action = queue.poll() ?: break
                Looper.onMain { action.run() }
            }
        }
    }
}
