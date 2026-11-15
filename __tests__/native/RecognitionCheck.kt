import com.freetune.RecognitionSession
import com.freetune.AudioFileRead
import java.util.concurrent.*
import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

fun checkRecognitionCancellation() {
    val session = RecognitionSession()
    val interrupted = AtomicInteger()
    val completed = AtomicInteger()
    val finish = CountDownLatch(1)
    check(session.begin())
    val worker = Thread {
        check(finish.await(2, TimeUnit.SECONDS))
        session.finish()
    }.apply { start() }
    session.cancel({ interrupted.incrementAndGet() }, { completed.incrementAndGet() })
    session.cancel({}, { completed.incrementAndGet() })
    check(interrupted.get() == 1 && session.cancelled.get())
    check(completed.get() == 0 && !session.begin()) { "Cancellation resolved before worker cleanup" }
    finish.countDown()
    worker.join(2000)
    check(completed.get() == 2 && session.begin()) { "Recognition did not become available after cleanup" }
    check(!session.cancelled.get())
    session.finish()
    session.cancel({}, { completed.incrementAndGet() })
    check(completed.get() == 3)
    val executor = ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, SynchronousQueue())
    val cancellationExecutor = Executors.newSingleThreadExecutor()
    try {
        for (phase in listOf("open", "read")) {
            val provider = CountDownLatch(1)
            val opened = CountDownLatch(1)
            val cancelled = CountDownLatch(1)
            val cleaned = CountDownLatch(1)
            val closed = CountDownLatch(1)
            val published = AtomicInteger()
            val read = AudioFileRead(executor, cancellationExecutor) { job ->
                val descriptor = Closeable { closed.countDown() }
                try {
                    if (phase == "read") job.asset.set(descriptor)
                    opened.countDown()
                    // A remote provider may ignore both interruption and cancellation.
                    while (provider.count > 0) try { provider.await() } catch (_: InterruptedException) {}
                    job.asset.set(descriptor)
                    job.ensureActive()
                    published.incrementAndGet()
                    shortArrayOf(1)
                } finally { descriptor.close(); cleaned.countDown() }
            }
            check(session.begin())
            val fileWorker = Thread {
                try { read.await(); error("Cancelled file was returned") }
                catch (error: IllegalStateException) { check(error.message == "Cancelled") }
                finally { session.finish() }
            }.apply { start() }
            try {
                check(opened.await(1, TimeUnit.SECONDS))
                val started = System.nanoTime()
                session.cancel({ read.cancel() }, { cancelled.countDown() })
                read.cancel()
                check(cancelled.await(1, TimeUnit.SECONDS)) { "Cloud $phase prevents cancellation from completing" }
                check(System.nanoTime() - started < 1_000_000_000L)
                check(session.begin()) { "Retry remained blocked by the provider" }
                val retry = AudioFileRead(executor, cancellationExecutor) { shortArrayOf(2) }
                check(retry.await().contentEquals(shortArrayOf(2)))
                session.finish()
                if (phase == "read") check(closed.await(1, TimeUnit.SECONDS))
                provider.countDown()
                check(cleaned.await(1, TimeUnit.SECONDS))
                check(closed.count == 0L && published.get() == 0) { "Cancelled provider leaked a descriptor or returned stale data" }
                fileWorker.join(1000)
                check(!fileWorker.isAlive)
            } finally { provider.countDown(); fileWorker.join(2000) }
        }
        val gate = CountDownLatch(1)
        val entered = CountDownLatch(2)
        val jobs = (1..2).map {
            AudioFileRead(executor, cancellationExecutor) {
                entered.countDown()
                while (gate.count > 0) try { gate.await() } catch (_: InterruptedException) {}
                shortArrayOf()
            }
        }
        val waiters = jobs.map { job -> Thread { runCatching { job.await() } }.apply { start() } }
        try {
            check(entered.await(1, TimeUnit.SECONDS))
            jobs.forEach { it.cancel() }
            var busy = false
            try { AudioFileRead(executor, cancellationExecutor) { shortArrayOf() }.await() }
            catch (error: IllegalStateException) { busy = error.message == "Busy" }
            check(busy) { "Blocked providers created unbounded decode workers" }
        } finally { gate.countDown(); waiters.forEach { it.join(2000) } }
    } finally {
        executor.shutdownNow()
        cancellationExecutor.shutdownNow()
        check(executor.awaitTermination(2, TimeUnit.SECONDS))
        check(cancellationExecutor.awaitTermination(2, TimeUnit.SECONDS))
    }
    println("Recognition cancellation passed: blocked cloud open/read cancel within 1 second, retry works, stale data is rejected, descriptors close, decoder concurrency stays bounded to two; provider/device stubs.")
}
