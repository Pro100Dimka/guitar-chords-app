package android.util
object Log {
    fun e(tag: String, message: String, error: Throwable? = null) { System.err.println("$tag: $message ${error?.message ?: ""}") }
    fun w(tag: String, message: String, error: Throwable? = null) { System.err.println("$tag: $message ${error?.message ?: ""}") }
}

object Base64 {
    const val DEFAULT = 0
    fun decode(value: String, flags: Int): ByteArray = java.util.Base64.getDecoder().decode(value)
}
