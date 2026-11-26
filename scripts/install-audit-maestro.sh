#!/usr/bin/env bash
set -euo pipefail
root="$HOME/.freetune-audit/maestro-2.12.1"
if ! find "$root" -path '*/bin/maestro' -type f 2>/dev/null | grep -q .; then
  mkdir -p "$root"
  zip="$(mktemp -t freetune-maestro.XXXXXX)"
  trap 'rm -f "$zip"' EXIT
  curl --fail --location --retry 3 \
    https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.12.1/maestro.zip \
    --output "$zip"
  printf '%s  %s\n' 54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7 "$zip" | shasum -a 256 -c -
  unzip -q "$zip" -d "$root"
fi
binary="$(find "$root" -type f -path '*/bin/maestro' -print -quit)"
test -n "$binary"
chmod +x "$binary"
echo "$(dirname "$binary")" >> "$GITHUB_PATH"
"$binary" --version
