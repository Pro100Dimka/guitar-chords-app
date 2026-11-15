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
    val releasedResults = CountDownLatch(2)
    val returnWorkers = CountDownLatch(1)
    val submitted = CountDownLatch(1)
    val submissions = AtomicInteger()
    val scheduling = object : ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(2)) {
        override fun execute(task: Runnable) {
            val number = submissions.incrementAndGet()
            try { super.execute(task) } finally { if (number == 3) submitted.countDown() }
        }
        override fun afterExecute(task: Runnable, error: Throwable?) {
            releasedResults.countDown()
            returnWorkers.await()
        }
    }
    try {
        repeat(2) { check(AudioFileRead(scheduling, Executor { it.run() }) { shortArrayOf(7) }.await()[0] == 7.toShort()) }
        check(releasedResults.await(2, TimeUnit.SECONDS))
        val next = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val accepted = Thread {
            try { check(AudioFileRead(scheduling, Executor { it.run() }) { shortArrayOf(8) }.await()[0] == 8.toShort()) }
            catch (error: Throwable) { next.set(error) }
        }.apply { start() }
        // Both completed results are visible while their workers are still returning.
        check(submitted.await(2, TimeUnit.SECONDS))
        returnWorkers.countDown()
        accepted.join(2000)
        check(!accepted.isAlive && next.get() == null) { "Completed reads caused false Busy: ${next.get()}" }
    } finally { returnWorkers.countDown(); scheduling.shutdownNow(); check(scheduling.awaitTermination(2, TimeUnit.SECONDS)) }
    val providerBlocked = CountDownLatch(1)
    val providerRunning = CountDownLatch(1)
    val providerExited = CountDownLatch(1)
    val admission = CountDownLatch(1)
    val resumeAdmission = CountDownLatch(1)
    val admissions = AtomicInteger()
    val admissionPool = object : ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(2)) {
        override fun execute(task: Runnable) {
            if (admissions.incrementAndGet() == 2) { admission.countDown(); resumeAdmission.await() }
            super.execute(task)
        }
    }
    admissionPool.execute { try { providerRunning.countDown(); providerBlocked.await() } finally { providerExited.countDown() } }
    val pendingRead = AudioFileRead(admissionPool, Executor { it.run() }) { error("Cancelled admission executed") }
    val pendingWaiter = Thread { runCatching { pendingRead.await() } }.apply { start() }
    try {
        check(providerRunning.await(2, TimeUnit.SECONDS) && admission.await(2, TimeUnit.SECONDS))
        pendingRead.cancel()
        resumeAdmission.countDown()
        pendingWaiter.join(2000)
        check(!pendingWaiter.isAlive && admissionPool.queue.isEmpty()) { "Cancellation before enqueue left a pending task" }
    } finally {
        resumeAdmission.countDown(); providerBlocked.countDown(); pendingRead.cancel(); pendingWaiter.join(2000)
        check(providerExited.await(2, TimeUnit.SECONDS))
        admissionPool.shutdownNow(); check(admissionPool.awaitTermination(2, TimeUnit.SECONDS))
    }
    val finishedTasks = LinkedBlockingQueue<Boolean>()
    val submittedTasks = LinkedBlockingQueue<Runnable>()
    val executor = object : ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(2)) {
        override fun execute(task: Runnable) { super.execute(task); submittedTasks.add(task) }
        override fun afterExecute(task: Runnable, error: Throwable?) { finishedTasks.add(true) }
    }
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
                repeat(2) { check(finishedTasks.poll(2, TimeUnit.SECONDS) == true) }
            } finally { provider.countDown(); fileWorker.join(2000) }
        }
        val readGate = CountDownLatch(1)
        val readClosed = CountDownLatch(1)
        val timedSource = AudioFileRead(executor, cancellationExecutor, readTimeoutMs = 50) { job ->
            try {
                while (readGate.count > 0) try { readGate.await() } catch (_: InterruptedException) {}
                job.ensureActive()
                shortArrayOf(5)
            } finally { readClosed.countDown() }
        }
        try {
            var timeout: Throwable? = null
            try { timedSource.await() } catch (error: Throwable) { timeout = error }
            check(timeout?.message == "FileReadTimeout") { "Blocked source did not report its deadline" }
        } finally { timedSource.cancel(); readGate.countDown(); check(readClosed.await(2, TimeUnit.SECONDS)) }
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
            submittedTasks.clear()
            val invoked = AtomicInteger()
            val queued = AudioFileRead(executor, cancellationExecutor) { invoked.incrementAndGet(); shortArrayOf() }
            val queuedResult = java.util.concurrent.atomic.AtomicReference<Throwable?>()
            val queuedWaiter = Thread { try { queued.await() } catch (error: Throwable) { queuedResult.set(error) } }.apply { start() }
            try {
                check(submittedTasks.poll(2, TimeUnit.SECONDS) != null)
                check(executor.poolSize == 2 && executor.queue.size == 1 && invoked.get() == 0) { "Blocked providers created extra workers" }
                queued.cancel()
                queuedWaiter.join(2000)
                check(!queuedWaiter.isAlive && queuedResult.get()?.message == "Cancelled")
                check(executor.queue.isEmpty()) { "Cancelled pending read still occupies the bounded queue" }
            } finally { queued.cancel(); queuedWaiter.join(2000) }
            val timedRead = AudioFileRead(executor, cancellationExecutor, startTimeoutMs = 50) { invoked.incrementAndGet(); shortArrayOf(9) }
            val timedResult = java.util.concurrent.atomic.AtomicReference<Throwable?>()
            val timedWaiter = Thread { try { timedRead.await() } catch (error: Throwable) { timedResult.set(error) } }.apply { start() }
            try {
                timedWaiter.join(2000)
                check(!timedWaiter.isAlive && timedResult.get()?.message == "Busy") { "Two abandoned providers leave the next file waiting indefinitely" }
                check(invoked.get() == 0 && executor.queue.isEmpty())
            } finally { timedRead.cancel(); timedWaiter.join(2000) }


        } finally { gate.countDown(); waiters.forEach { it.join(2000) } }
    } finally {
        executor.shutdownNow()
        cancellationExecutor.shutdownNow()
        check(executor.awaitTermination(2, TimeUnit.SECONDS))
        check(cancellationExecutor.awaitTermination(2, TimeUnit.SECONDS))
    }
    println("Recognition cancellation passed: blocked cloud open/read cancel within 1 second, retry works, stale data is rejected, descriptors close, decoder concurrency stays bounded to two, queued reads fail Busy and blocked sources report FileReadTimeout; provider/device stubs.")
}
