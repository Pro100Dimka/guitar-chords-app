package android.net
class Uri(private val text: String) {
    override fun toString() = text
    fun buildUpon() = Builder(text)
    class Builder(private var text: String) {
        fun appendQueryParameter(key: String, value: String): Builder {
            text += (if ('?' in text) "&" else "?") + "$key=$value"
            return this
        }
        fun build() = Uri(text)
    }
    companion object { fun parse(text: String) = Uri(text) }
}
