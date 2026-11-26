package com.facebook.react.bridge
annotation class ReactMethod
open class ReactContextBaseJavaModule(context: ReactApplicationContext) { open fun getName():String=""; open fun invalidate() {} }
class ReactApplicationContext { val contentResolver=android.content.ContentResolver() }
interface Promise { fun resolve(value:Any?); fun reject(code:String,message:String?,cause:Throwable?=null) }
class WritableMap { val values=mutableMapOf<String,Any?>(); fun putString(k:String,v:String){values[k]=v};fun putDouble(k:String,v:Double){values[k]=v};fun putNull(k:String){values[k]=null};fun putArray(k:String,v:WritableArray){values[k]=v} }
class WritableArray {val values=mutableListOf<WritableMap>(); fun pushMap(v:WritableMap){values.add(v)} }
object Arguments {fun createMap()=WritableMap();fun createArray()=WritableArray()}
