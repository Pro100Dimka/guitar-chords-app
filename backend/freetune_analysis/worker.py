"""A killable, isolated process for FFmpeg, Torch and CTranslate2."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import psutil

from .config import Settings
from .pipeline import analyze


def atomic_json(path: Path, payload):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, allow_nan=False)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--language", choices=("auto", "uk", "ru", "en"), required=True)
    parser.add_argument("--supervisor-pid", type=int, default=os.getppid())
    parser.add_argument("--supervisor-created", type=float)
    args = parser.parse_args()
    settings = Settings.from_env()
    os.environ.setdefault("OMP_NUM_THREADS", str(settings.cpu_threads))
    os.environ.setdefault("MKL_NUM_THREADS", str(settings.cpu_threads))
    if settings.device == "cpu":
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    if args.supervisor_created is None:
        try:
            args.supervisor_created = psutil.Process(args.supervisor_pid).create_time()
        except psutil.NoSuchProcess:
            raise SystemExit(130)
    guard = subprocess.Popen([
        sys.executable, "-m", "freetune_analysis.guard", "--parent", str(args.supervisor_pid),
        "--parent-created", str(args.supervisor_created), "--worker", str(os.getpid()),
        "--worker-created", str(psutil.Process().create_time()),
        "--worker-group", str(os.getpgrp() if os.name == "posix" else 0),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != "nt")
    try:
        analyze(args.input, args.directory, args.language, settings,
                lambda value: atomic_json(args.directory / "state.json", value))
    except Exception:
        # Keep the last useful partial result. The supervisor handles unexpected process exits.
        import traceback
        traceback.print_exc()
        raise
    finally:
        guard.terminate()
        try:
            guard.wait(timeout=2)
        except subprocess.TimeoutExpired:
            guard.kill()


if __name__ == "__main__":
    main()
