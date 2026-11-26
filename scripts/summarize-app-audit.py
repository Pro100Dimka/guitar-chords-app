import json
import os
import pathlib
import sys

sha = os.environ["GITHUB_SHA"]
rounds = {"android": set(), "ios": set()}
errors = []
for path in pathlib.Path(sys.argv[1]).rglob("ledger.jsonl"):
    for line in path.read_text().splitlines():
        row = json.loads(line)
        platform, number = row["platform"], row["round"]
        if row["sha"] != sha or platform not in rounds or not 1 <= number <= 1000:
            errors.append(f"Invalid evidence: {row}")
        elif row["result"] != "passed":
            errors.append(f"Failed pass: {platform} {number}")
        elif number in rounds[platform]:
            errors.append(f"Duplicate pass: {platform} {number}")
        else:
            rounds[platform].add(number)

paired = rounds["android"] & rounds["ios"]
lines = [
    "## Full application audit",
    f"Commit: `{sha}`",
    f"Android: {len(rounds['android'])}/1000",
    f"iOS: {len(rounds['ios'])}/1000",
    f"Complete paired passes: {len(paired)}/1000",
    *errors,
]
report = "\n".join(lines) + "\n"
print(report)
with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
    summary.write(report)
if errors or len(paired) != 1000:
    raise SystemExit("Audit incomplete; do not report completion")
