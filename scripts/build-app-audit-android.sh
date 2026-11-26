#!/usr/bin/env bash
set -euo pipefail

# Keep the complete release build and lint checks. Retry only transient
# dependency downloads, not compile errors, failed checks or other defects.
log="$RUNNER_TEMP/audit-android-build.log"
for attempt in 1 2 3 4; do
  printf 'Android release build attempt %s/4\n' "$attempt"
  status=0
  ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 \
    --no-daemon --stacktrace > "$log" 2>&1 || status=$?
  if [[ "$status" == 0 ]]; then
    tail -n 50 "$log"
    exit 0
  fi
  tail -n 80 "$log"
  if [[ "$attempt" == 4 ]] || ! grep -Eq 'Received status code (429|500|502|503|504) from server|Read timed out|Connection reset|Temporary failure in name resolution' "$log"; then
    exit "$status"
  fi
  printf 'Transient dependency/network error; retrying build.\n'
  sleep "$((attempt * 30))"
done
