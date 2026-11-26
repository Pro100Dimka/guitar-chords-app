package org.json
class JSONObject(s:String="") {fun getString(k:String)="chroma-v1";fun getDouble(k:String)=2.0;fun isNull(k:String)=true;fun getJSONArray(k:String)=JSONArray()}
class JSONArray {fun length()=0;fun getJSONObject(i:Int)=JSONObject()}
