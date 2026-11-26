//! Worker-owned streaming analyzer. Handles never cross the React Native bridge.
use crate::chords::ChordAnalyzer;
use std::ffi::{c_char, c_void, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};

#[no_mangle]
pub extern "C" fn freetune_chords_new() -> *mut c_void {
    catch_unwind(|| Box::into_raw(Box::new(ChordAnalyzer::new())).cast())
        .unwrap_or(std::ptr::null_mut())
}

/// Caller must own a live handle returned by new, exclusively on one worker.
/// Returns 0 on success, 1 for duration overflow, 2 for invalid state/arguments.
#[no_mangle]
pub unsafe extern "C" fn freetune_chords_push(
    handle: *mut c_void,
    samples: *const i16,
    count: usize,
) -> i32 {
    if handle.is_null() || samples.is_null() || count > 16_384 {
        return 2;
    }
    catch_unwind(AssertUnwindSafe(|| {
        let analyzer = &mut *handle.cast::<ChordAnalyzer>();
        match analyzer.push(std::slice::from_raw_parts(samples, count)) {
            Ok(()) => 0,
            Err("AudioTooLong") => 1,
            Err(_) => 2,
        }
    }))
    .unwrap_or(2)
}

/// Finalizes once; caller still owns handle. Free JSON with fingerprint_free.
#[no_mangle]
pub unsafe extern "C" fn freetune_chords_finish(handle: *mut c_void) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    catch_unwind(AssertUnwindSafe(|| {
        let analyzer = &mut *handle.cast::<ChordAnalyzer>();
        analyzer
            .finish()
            .ok()
            .and_then(|result| CString::new(result.json()).ok())
            .map_or(std::ptr::null_mut(), CString::into_raw)
    }))
    .unwrap_or(std::ptr::null_mut())
}

/// Only after the worker stops using the handle; never concurrently with push.
#[no_mangle]
pub unsafe extern "C" fn freetune_chords_free(handle: *mut c_void) {
    if !handle.is_null() {
        drop(Box::from_raw(handle.cast::<ChordAnalyzer>()));
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::objects::{JObject, JShortArray};
    use jni::sys::{jint, jlong, jstring};
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_com_freetune_OfflineChordAnalyzer_create(
        _env: JNIEnv<'_>,
        _object: JObject<'_>,
    ) -> jlong {
        freetune_chords_new() as jlong
    }

    #[no_mangle]
    pub extern "system" fn Java_com_freetune_OfflineChordAnalyzer_push(
        env: JNIEnv<'_>,
        _object: JObject<'_>,
        handle: jlong,
        input: JShortArray<'_>,
        count: jint,
    ) -> jint {
        if handle == 0 || !(0..=16_384).contains(&count) {
            return 2;
        }
        match env.get_array_length(&input) {
            Ok(length) if length >= count => {}
            _ => return 2,
        }
        let mut samples = vec![0i16; count as usize];
        if env.get_short_array_region(&input, 0, &mut samples).is_err() {
            return 2;
        }
        unsafe { freetune_chords_push(handle as *mut c_void, samples.as_ptr(), samples.len()) }
    }

    #[no_mangle]
    pub extern "system" fn Java_com_freetune_OfflineChordAnalyzer_finish(
        env: JNIEnv<'_>,
        _object: JObject<'_>,
        handle: jlong,
    ) -> jstring {
        unsafe {
            let json = freetune_chords_finish(handle as *mut c_void);
            if json.is_null() {
                return std::ptr::null_mut();
            }
            let owned = CString::from_raw(json);
            match owned
                .to_str()
                .ok()
                .and_then(|text| env.new_string(text).ok())
            {
                Some(value) => value.into_raw(),
                None => std::ptr::null_mut(),
            }
        }
    }

    #[no_mangle]
    pub extern "system" fn Java_com_freetune_OfflineChordAnalyzer_destroy(
        _env: JNIEnv<'_>,
        _object: JObject<'_>,
        handle: jlong,
    ) {
        unsafe {
            freetune_chords_free(handle as *mut c_void);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn c_bridge_streams_and_rejects_invalid_or_finished_input() {
        unsafe {
            assert_eq!(
                freetune_chords_push(std::ptr::null_mut(), std::ptr::null(), 0),
                2
            );
            assert!(freetune_chords_finish(std::ptr::null_mut()).is_null());
            freetune_chords_free(std::ptr::null_mut());
            let handle = freetune_chords_new();
            assert!(!handle.is_null());
            let samples = vec![0i16; 8000];
            assert_eq!(freetune_chords_push(handle, samples.as_ptr(), 16385), 2);
            assert_eq!(
                freetune_chords_push(handle, samples.as_ptr(), samples.len()),
                0
            );
            assert!(freetune_chords_finish(handle).is_null()); // too short; can continue
            assert_eq!(
                freetune_chords_push(handle, samples.as_ptr(), samples.len()),
                0
            );
            let result = freetune_chords_finish(handle);
            assert!(!result.is_null());
            assert!(std::ffi::CStr::from_ptr(result)
                .to_str()
                .unwrap()
                .contains("\"chord\":\"N\""));
            crate::freetune_fingerprint_free(result);
            assert_eq!(
                freetune_chords_push(handle, samples.as_ptr(), samples.len()),
                2
            );
            assert!(freetune_chords_finish(handle).is_null());
            freetune_chords_free(handle);
        }
    }
}
