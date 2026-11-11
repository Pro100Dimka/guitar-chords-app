package com.facebook.react.bridge
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.LinkedBlockingQueue
annotation class ReactMethod
open class ReactContextBaseJavaModule(context: ReactApplicationContext) {
    open fun getName(): String = ""
    open fun invalidate() {}
}
class ReactApplicationContext {
    val currentActivity: android.view.Activity? = android.view.Activity()
    val events = LinkedBlockingQueue<WritableMap>()
    private val emitter = object : DeviceEventManagerModule.RCTDeviceEventEmitter {
        override fun emit(name: String, params: WritableMap?) { if (params != null) events.add(params) }
    }
    fun <T> getJSModule(type: Class<T>): T = type.cast(emitter)
}
interface Promise { fun resolve(value: Any) }
interface ReadableArray { fun size(): Int; fun getMap(index: Int): ReadableMap?; fun getDouble(index: Int): Double }
interface ReadableMap {
    fun getString(key: String): String?; fun getInt(key: String): Int
    fun hasKey(key: String): Boolean; fun getDouble(key: String): Double; fun getArray(key: String): ReadableArray?
}
class WritableArray { fun pushDouble(value: Double) {} }
class WritableMap {
    val values = mutableMapOf<String, Any>()
    fun putString(key: String, value: String) { values[key] = value }
    fun putDouble(key: String, value: Double) { values[key] = value }
    fun putInt(key: String, value: Int) { values[key] = value }
    fun putArray(key: String, value: WritableArray) { values[key] = value }
    fun merge(other: WritableMap) { values.putAll(other.values) }
}
object Arguments { fun createMap() = WritableMap(); fun createArray() = WritableArray() }
