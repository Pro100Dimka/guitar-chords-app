"""Run production playback lifecycle + tile code on the JVM with controlled Android services.

This checks races and ownership, not MediaProjection behavior on a physical phone.
Usage: python android/test-playback-capture.py --kotlin-lib /path/to/kotlin/compiler/jars
"""
import argparse
from pathlib import Path
import os
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--kotlin-lib", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
library = args.kotlin_lib.resolve()
stdlib = next(path for path in library.glob("kotlin-stdlib*.jar")
              if "sources" not in path.name and "jdk" not in path.name)
annotations = next(library.glob("annotations-*.jar"))
source = root / "android/app/src/main/java/com/freetune"
with tempfile.TemporaryDirectory(prefix="freetune-playback-") as directory:
    artifact = Path(directory) / "checks.jar"
    subprocess.run([
        "java", "-cp", str(library / "*"), "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
        "-no-stdlib", "-no-reflect", "-nowarn", "-classpath",
        os.pathsep.join(map(str, [stdlib, annotations])), "-d", str(artifact),
        *map(str, sorted((root / "__tests__/native/playback").glob("*.kt"))),
        str(source / "PlaybackCaptureService.kt"), str(source / "RecognitionTileService.kt")
    ], check=True)
    subprocess.run(["java", "-cp", os.pathsep.join(map(str, [artifact, stdlib])),
                    "com.freetune.CheckKt"], check=True)
