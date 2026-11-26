#!/bin/bash
set -euo pipefail
export PATH="${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${BUILD_DIR}/fingerprint}"
libraries=()
for arch in ${ARCHS}; do
  case "${PLATFORM_NAME}:${arch}" in
    iphoneos:arm64) target=aarch64-apple-ios ;;
    iphonesimulator:arm64) target=aarch64-apple-ios-sim ;;
    iphonesimulator:x86_64) target=x86_64-apple-ios ;;
    *) echo "Unsupported fingerprint platform: ${PLATFORM_NAME}:${arch}" >&2; exit 1 ;;
  esac
  cargo build --locked --release --lib --target "$target" --manifest-path "${PROJECT_DIR}/../android/song-fingerprint/Cargo.toml"
  libraries+=("${CARGO_TARGET_DIR}/${target}/release/libfreetune_song_fingerprint.a")
done
fingerprint_directory="${FINGERPRINT_OUTPUT_DIR:-${BUILT_PRODUCTS_DIR}/fingerprint}"
mkdir -p "$fingerprint_directory"
fingerprint_output="${fingerprint_directory}/libfreetune_song_fingerprint.a"
fingerprint_temporary=$(mktemp "${fingerprint_directory}/.fingerprint.XXXXXX")
trap 'rm -f "$fingerprint_temporary"' EXIT
xcrun lipo -create "${libraries[@]}" -output "$fingerprint_temporary"
# Cargo still checks every source/dependency and target on every invocation.
# An unchanged archive must not make Xcode relink the entire app on a cache hit.
if ! cmp -s "$fingerprint_temporary" "$fingerprint_output"; then
  mv "$fingerprint_temporary" "$fingerprint_output"
fi
