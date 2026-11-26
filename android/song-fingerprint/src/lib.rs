//! Mobile bridges over shazamio-core 2.1.0's MIT PCM fingerprint algorithm.
mod algorithm;
mod signature_format;
mod chords;
mod chord_notes;
#[cfg(test)]
mod chord_quality_tests;
mod chord_bridge;

#[cfg(target_os = "android")]
use jni::objects::{JClass, JShortArray};
#[cfg(target_os = "android")]
use jni::sys::jstring;
#[cfg(target_os = "android")]
use jni::JNIEnv;

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_freetune_SongFingerprint_fingerprint(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    input: JShortArray<'_>,
) -> jstring {
    let len = match env.get_array_length(&input) {
        Ok(len) if (32_000..=192_000).contains(&len) => len,
        _ => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", "2-12 seconds of 16 kHz PCM required");
            return std::ptr::null_mut();
        }
    };
    let mut samples = vec![0i16; len as usize];
    if env.get_short_array_region(&input, 0, &mut samples).is_err() {
        let _ = env.throw_new("java/lang/IllegalStateException", "Cannot read PCM");
        return std::ptr::null_mut();
    }
    let fingerprint = algorithm::fingerprint_samples(&samples);
    let uri = fingerprint.to_data_uri();
    match env.new_string(uri) {
        Ok(value) => value.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// The caller owns the returned UTF-8 string and releases it with fingerprint_free.
#[no_mangle]
pub unsafe extern "C" fn freetune_fingerprint(samples: *const i16, count: usize) -> *mut std::ffi::c_char {
    if samples.is_null() || !(32_000..=192_000).contains(&count) {
        return std::ptr::null_mut();
    }
    std::panic::catch_unwind(|| {
        let pcm = std::slice::from_raw_parts(samples, count);
        std::ffi::CString::new(algorithm::fingerprint_samples(pcm).to_data_uri())
            .map_or(std::ptr::null_mut(), |uri| uri.into_raw())
    }).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn freetune_fingerprint_free(uri: *mut std::ffi::c_char) {
    if !uri.is_null() { drop(std::ffi::CString::from_raw(uri)); }
}

#[cfg(test)]
mod bridge_tests {
    use super::*;
    #[test]
    fn c_bridge_matches_the_shared_fingerprint() {
        let samples: Vec<i16> = (0..48_000).map(|i| ((i as f64 * 0.17).sin() * 12000.0) as i16).collect();
        unsafe {
            assert!(freetune_fingerprint(std::ptr::null(), 48_000).is_null());
            assert!(freetune_fingerprint(samples.as_ptr(), 1).is_null());
            let uri = freetune_fingerprint(samples.as_ptr(), samples.len());
            assert!(!uri.is_null());
            assert_eq!(std::ffi::CStr::from_ptr(uri).to_str().unwrap(), algorithm::fingerprint_samples(&samples).to_data_uri());
            freetune_fingerprint_free(uri);
        }
    }
}
