"""Explicit model download; the server itself always runs in offline mode."""

import argparse
import hashlib
import json
from pathlib import Path

from .config import MODEL_REVISIONS, Settings


def main():
    parser = argparse.ArgumentParser(description="Download MIT-licensed Whisper weights from Hugging Face")
    parser.add_argument("--model", choices=tuple(MODEL_REVISIONS), default="small")
    parser.add_argument("--directory", type=Path)
    args = parser.parse_args()
    target = args.directory or Settings.from_env().data_dir / "models" / f"whisper-{args.model}"
    from huggingface_hub import snapshot_download
    model_id, revision = MODEL_REVISIONS[args.model]
    print(f"Downloading {model_id} @ {revision} into {target}")
    snapshot_download(repo_id=model_id, revision=revision, local_dir=target,
                      allow_patterns=["*.json", "*.txt", "model.bin", "README.md", "LICENSE*"])
    hashes = {}
    for path in target.iterdir():
        if path.is_file():
            with path.open("rb") as handle:
                hashes[path.name] = hashlib.file_digest(handle, "sha256").hexdigest()
    (target / "freetune-model.json").write_text(json.dumps(
        {"id": model_id, "revision": revision, "license": "MIT", "sha256": hashes}, indent=2), "utf-8")
    print("Installed. Runtime never downloads model weights or uploads audio to third parties.")


if __name__ == "__main__":
    main()
