"""Explicitly download an evaluation corpus; never invoked by the application."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.parse
import urllib.request


def read_url(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("data/evaluation/jamendo"))
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--only-cc-by", action="store_true", help="Download only the two English CC-BY recordings")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    dataset = "jamendolyrics/jamendolyrics"
    meta = json.loads(read_url("https://huggingface.co/api/datasets/" + dataset))
    revision = meta["sha"]
    base = f"https://huggingface.co/datasets/{dataset}/resolve/{revision}/"
    references = [json.loads(line) for line in read_url(base + "metadata.jsonl").decode().splitlines()]
    # Jam-ALT has independently revised text; JamendoLyrics supplies word start/end references.
    alt = [json.loads(line) for line in read_url(
        "https://huggingface.co/datasets/jamendolyrics/jam-alt/resolve/v1.4.0/metadata.jsonl").decode().splitlines()]
    alt_by_name = {row["name"]: row for row in alt}
    rows = [row for row in references if row["language"] == "en" and
            (not args.only_cc_by or row["license_type"].removeprefix("CC ") == "BY")][:args.count]
    print("Downloading licensed evaluation recordings. Their individual CC terms still apply; "
          "do not bundle restricted recordings in the app or public reports.", flush=True)

    def fetch(row):
        name = row["name"]
        if Path(name).name != name:
            raise ValueError("Unsafe dataset filename")
        filename = name + ".mp3"
        local = args.directory / filename
        if not local.exists() or local.stat().st_size < 1024:
            data = read_url(base + "subsets/en/mp3/" + urllib.parse.quote(filename))
            if len(data) < 1024:
                raise ValueError("Dataset download is not audio: " + name)
            local.write_bytes(data)
        reference = {**row, "text": alt_by_name.get(name, row)["text"],
                     "textReference": "Jam-ALT v1.4.0", "wordReference": "JamendoLyrics " + revision}
        ref_name = name + ".reference.json"
        (args.directory / ref_name).write_text(json.dumps(reference, ensure_ascii=False, indent=2), "utf-8")
        print(name, flush=True)
        return {"id": name, "audio": filename, "reference": ref_name, "language": "en",
                "license": row["license_type"], "source": row["url"]}

    with ThreadPoolExecutor(max_workers=4) as executor:
        recordings = list(executor.map(fetch, rows))
    manifest = {"corpus": {"name": "JamendoLyrics + Jam-ALT", "revision": revision,
                            "source": "https://huggingface.co/datasets/" + dataset,
                            "humanReferences": True, "humanChordReferences": False},
                "recordings": recordings}
    (args.directory / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    print(f"Saved {len(recordings)} full English songs to {args.directory / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
