#!/usr/bin/env bash
set -euo pipefail
platform="$1"
first="$2"
count="$3"
output="$4"
mkdir -p "$output"
: > "$output/ledger.jsonl"
for ((round=first; round<first+count; round++)); do
  fret=$((round % 9 + 1))
  frequencies=(432 440 442)
  hz="${frequencies[$((round % 3))]}"
  dir="$output/round-$round"
  mkdir -p "$dir"
  printf 'Starting %s complete journey %s\n' "$platform" "$round"
  status=0
  maestro test --format junit --output "$dir/report.xml" \
    --test-output-dir "$dir/debug" --debug-output "$dir/debug" \
    -e "AUDIT_TITLE=Audit Song $round" \
    -e "AUDIT_TAB=Audit Tab $round" \
    -e "AUDIT_FRET=$fret" -e "AUDIT_HZ=$hz" \
    e2e/full-pass.yaml > "$dir/console.log" 2>&1 || status=$?
  if [[ "$status" == 0 ]]; then
    python3 - "$dir/report.xml" <<'PY' || status=$?
import sys
import xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
cases = list(root.iter("testcase"))
if not cases or any(c.find("failure") is not None or c.find("error") is not None or c.find("skipped") is not None for c in cases):
    raise SystemExit("Missing, failed or skipped E2E test")
PY
  fi
  if [[ "$status" == 0 ]]; then
    printf '{"platform":"%s","round":%s,"sha":"%s","result":"passed"}\n' "$platform" "$round" "$GITHUB_SHA" >> "$output/ledger.jsonl"
    rm -rf "$dir/debug" "$dir/console.log"
    printf 'PASS %s %s\n' "$platform" "$round"
  else
    printf '{"platform":"%s","round":%s,"sha":"%s","result":"failed"}\n' "$platform" "$round" "$GITHUB_SHA" >> "$output/ledger.jsonl"
    tail -n 100 "$dir/console.log" || true
    exit "$status"
  fi
done
