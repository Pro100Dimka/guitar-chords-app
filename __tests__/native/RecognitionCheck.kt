import com.freetune.RecognitionSession
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
    println("Recognition cancellation passed: waiters resolve only after cleanup; immediate retry is admitted only after finish.")
}
