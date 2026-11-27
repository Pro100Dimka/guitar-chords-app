package org.json
// API stub, not a JSON parser. Explicit fixture objects exercise production mapping.
class JSONObject(private val values: Map<String, Any?> = emptyMap()) {
    constructor(s: String) : this()
    fun getString(k: String) = values[k] as? String ?: "chroma-v1"
    fun getDouble(k: String) = (values[k] as? Number)?.toDouble() ?: 2.0
    fun getInt(k: String) = (values[k] as? Number)?.toInt() ?: 2
    fun getBoolean(k: String) = values[k] as? Boolean ?: false
    fun isNull(k: String) = values[k] == null
    fun getJSONArray(k: String) = values[k] as? JSONArray ?: JSONArray()
}
class JSONArray(private val values: List<JSONObject> = emptyList()) {
    fun length() = values.size
    fun getJSONObject(i: Int) = values[i]
}
