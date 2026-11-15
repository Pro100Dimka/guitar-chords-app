package android.os

class CancellationSignal {
    @Volatile var isCanceled = false
        private set
    fun cancel() { isCanceled = true }
}
