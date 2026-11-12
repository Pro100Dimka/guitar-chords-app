#!/usr/bin/env python3
"""Fetch the exact, licensed 10-excerpt GuitarSet validation subset.

The archives total about 700 MB. Audio stays outside git in backend/data by
default. Source checksums are from the official Zenodo v1.1.0 record.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile

SOURCE = "https://zenodo.org/records/3371780"
ARCHIVES = {
    "annotation.zip": "b39b78e63d3446f2e54ddb7a54df9b10",
    "audio_mono-mic.zip": "275966d6610ac34999b58426beb119c3",
}
NAMES = [
    f"{player}_{piece}_comp"
    for player in ("00", "04")
    for piece in ("BN1-129-Eb", "Funk1-114-Ab", "Jazz1-130-D", "Rock1-130-A", "SS1-100-C#")
]


def digest(path, algorithm):
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("backend/data/evaluation/guitarset"))
    parser.add_argument("--archives", type=Path, help="Reuse downloaded official archives")
    args = parser.parse_args()
    archives = args.archives or args.output / "archives"
    archives.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, checksum in ARCHIVES.items():
        path = archives / name
        if not path.exists():
            partial = path.with_suffix(".part")
            try:
                print(f"Downloading {name} from {SOURCE}", flush=True)
                urllib.request.urlretrieve(f"{SOURCE}/files/{name}?download=1", partial)
                if digest(partial, "md5") != checksum:
                    raise ValueError(f"Official archive checksum does not match: {name}")
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        if digest(path, "md5") != checksum:
            raise ValueError(f"Official archive checksum does not match: {name}")

    with zipfile.ZipFile(archives / "annotation.zip") as annotations, \
            zipfile.ZipFile(archives / "audio_mono-mic.zip") as audio:
        for name in NAMES:
            # Extract only named flat members, never archive-supplied paths.
            audio_path = args.output / f"{name}_mic.wav"
            audio_path.write_bytes(audio.read(audio_path.name))
            jam = json.loads(annotations.read(f"{name}.jams"))
            performed = next(a for a in jam["annotations"]
                             if a["namespace"] == "chord" and
                             a["annotation_metadata"].get("data_source") ==
                             "Semi-automatic chord transcription with manual verification")
            reference = {
                "name": name, "source": f"GuitarSet v1.1.0 {SOURCE}",
                "license": "CC-BY-4.0", "duration": jam["file_metadata"]["duration"],
                "sha256": digest(audio_path, "sha256"),
                "annotationMetadata": performed["annotation_metadata"],
                "chords": [{"start": item["time"],
                            "end": item["time"] + item["duration"],
                            "label": item["value"]} for item in performed["data"]],
            }
            (args.output / f"{name}.reference.json").write_text(
                json.dumps(reference, indent=2) + "\n")
            print(name, reference["sha256"], flush=True)
    (args.output / "ATTRIBUTION.txt").write_text(
        "GuitarSet v1.1.0 — Qingyang Xi, Rachel M. Bittner, Johan Pauwels, "
        "Xuzhou Ye, Juan Pablo Bello.\n"
        f"Source: {SOURCE}\nLicense: https://creativecommons.org/licenses/by/4.0/\n"
        "Ten original mono microphone excerpts extracted without audio modification.\n"
        "Chord references converted from the supplied performed-annotation JAMS.\n"
        "No additional human verification was performed.\n")


if __name__ == "__main__":
    main()
