//! Android JNI bridge over shazamio-core 2.1.0's MIT PCM fingerprint algorithm.
mod algorithm;
mod signature_format;

use jni::objects::{JClass, JShortArray};
use jni::sys::jstring;
use jni::JNIEnv;

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
