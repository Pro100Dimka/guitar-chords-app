#!/bin/bash
set -euo pipefail
export PATH="${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${BUILD_DIR}/fingerprint"
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
mkdir -p "${BUILT_PRODUCTS_DIR}/fingerprint"
xcrun lipo -create "${libraries[@]}" -output "${BUILT_PRODUCTS_DIR}/fingerprint/libfreetune_song_fingerprint.a"
