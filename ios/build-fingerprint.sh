#!/bin/bash
set -euo pipefail
export PATH="${HOME}/.cargo/bin:${PATH}"
case "${PLATFORM_NAME}" in
  iphoneos) target=aarch64-apple-ios ;;
  iphonesimulator)
    case "${CURRENT_ARCH:-arm64}" in
      x86_64) target=x86_64-apple-ios ;;
      *) target=aarch64-apple-ios-sim ;;
    esac ;;
  *) echo "Unsupported fingerprint platform: ${PLATFORM_NAME}" >&2; exit 1 ;;
esac
export CARGO_TARGET_DIR="${BUILD_DIR}/fingerprint"
cargo build --locked --release --lib --target "$target" --manifest-path "${PROJECT_DIR}/../android/song-fingerprint/Cargo.toml"
mkdir -p "${BUILT_PRODUCTS_DIR}/fingerprint"
cp "${CARGO_TARGET_DIR}/${target}/release/libfreetune_song_fingerprint.a" "${BUILT_PRODUCTS_DIR}/fingerprint/"
