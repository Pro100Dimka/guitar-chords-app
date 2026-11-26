"""Compile the production Kotlin bridge; exercise resampling and cancellation with API stubs."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile


parser = argparse.ArgumentParser()
parser.add_argument("--kotlin-lib", required=True, type=Path,
                    help="Directory containing the Kotlin compiler and stdlib JARs")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
stdlib = next(path for path in args.kotlin_lib.glob("kotlin-stdlib*.jar")
              if not any(word in path.name for word in ["sources", "javadoc", "jdk"]))
annotations = next(args.kotlin_lib.glob("annotations-*.jar"))
with tempfile.TemporaryDirectory(prefix="freetune-chords-kotlin-") as directory:
    jar = Path(directory) / "checks.jar"
    subprocess.run([
        "java", "-cp", str(args.kotlin_lib / "*"), "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
        "-no-stdlib", "-no-reflect", "-classpath", os.pathsep.join([str(stdlib), str(annotations)]),
        "-d", str(jar),
        *map(str, sorted((root / "__tests__/native/offline").glob("*.kt"))),
        str(root / "android/app/src/main/java/com/freetune/OfflineChordAnalysisModule.kt")
    ], check=True)
    subprocess.run(["java", "-cp", os.pathsep.join([str(jar), str(stdlib)]),
                    "com.freetune.CheckKt"], check=True, timeout=30)
