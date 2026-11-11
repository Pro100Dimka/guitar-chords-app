package android.util
object Log {
    fun e(tag: String, message: String, error: Throwable? = null) { System.err.println("$tag: $message ${error?.message ?: ""}") }
    fun w(tag: String, message: String, error: Throwable? = null) { System.err.println("$tag: $message ${error?.message ?: ""}") }
}
