"""Prepare the owner's approved recordings; originals are never modified."""
import argparse
import base64
import io
import json
import subprocess
import wave
from pathlib import Path

import numpy as np


def run(args, data=None):
    return subprocess.run(["ffmpeg", "-v", "error", *args], input=data,
                          capture_output=True, check=True).stdout


def encoded(data, rate, path, quality=4.25):
    path.parent.mkdir(parents=True, exist_ok=True)
    run(["-y", "-f", "f32le", "-ar", str(rate), "-ac", str(data.shape[1]), "-i", "pipe:0",
         "-c:a", "libmp3lame", "-q:a", str(quality), "-ar", str(rate), str(path)],
        np.asarray(data, dtype="<f4").tobytes())
    return base64.b64encode(path.read_bytes()).decode()


def pitch(data, target, rate):
    frequencies = []
    for start, end in [(0.1, 0.5), (0.7, 1.1), (1.0, 1.4), (1.3, 1.7)]:
        part = data[int(start * rate):int(end * rate)]
        minimum = int(rate / target / 1.04)
        maximum = int(np.ceil(rate / target / .96))
        scores = np.zeros(maximum + 2)
        for lag in range(minimum - 1, maximum + 2):
            left, right = part[:-lag], part[lag:]
            scores[lag] = np.dot(left, right) / np.sqrt(np.dot(left,left) * np.dot(right,right))
        peak = minimum + np.argmax(scores[minimum:maximum+1])
        left, center, right = scores[peak-1:peak+2]
        delta = .5 * (left-right) / (left-2*center+right)
        frequencies.append(rate / (peak+delta))
    return float(np.sqrt(min(frequencies) * max(frequencies)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("bank", type=Path)
    parser.add_argument("strings", type=Path)
    parser.add_argument("--quality", type=float, default=4.25)
    parser.add_argument("--work-dir", type=Path)
    args = parser.parse_args()
    if not 0 <= args.quality <= 9:
        parser.error("quality must be between 0 and 9")
    root = Path(__file__).resolve().parents[1]
    mobile = args.work_dir or args.bank / "mobile"
    manifest = json.loads((args.bank / "manifest.json").read_text(encoding="utf-8"))
    recordings = {}
    for entry in manifest["files"]:
        raw = run(["-i", str(args.bank / entry["path"]), "-f", "f32le", "pipe:1"])
        data = np.frombuffer(raw, dtype="<f4").reshape(-1, 2)
        recordings.setdefault(entry["chord"], {"down": [], "up": []})[entry["direction"]].append({
            "audio": encoded(data, 48000, mobile / entry["path"].replace(".wav", ".mp3"), args.quality), "level": float(np.sqrt(np.mean(data[:16800] ** 2)))
        })
    raw = run(["-t", "115", "-i", str(args.strings), "-ac", "1", "-ar", "22050", "-f", "f32le", "pipe:1"])
    data = np.frombuffer(raw, dtype="<f4")
    takes = [(40, [.29]), (45, [10.8, 21.29]), (50, [31.8, 42.3]),
             (55, [52.8, 63.28]), (59, [73.81, 84.31]), (64, [94.8, 105.3])]
    samples, references = [], []
    for string, (midi, starts) in enumerate(takes):
        variants = []
        for start in starts:
            part = data[round((start - .025) * 22050):round((start + 7.975) * 22050)].copy()
            part[:44] *= np.linspace(0, 1, 44)
            part[-5512:] *= .5 + .5 * np.cos(np.linspace(0, np.pi, 5512))
            frequency = pitch(part, 440 * 2 ** ((midi - 69) / 12), 22050)
            variants.append((part, frequency))
        soft, medium = variants[0], variants[-1]
        soft = (soft[0] * min(8, .4 / max(abs(soft[0]))), soft[1])
        medium = (medium[0] * min(8, .6 / max(abs(medium[0]))), medium[1])
        samples.append({"string": string, "midi": midi,
                        "softMidi": 69 + 12 * np.log2(soft[1] / 440),
                        "mediumMidi": 69 + 12 * np.log2(medium[1] / 440),
                        "soft": encoded(soft[0][:, None], 22050, mobile / "strings" / f"{string}_soft.mp3", args.quality),
                        "medium": encoded(medium[0][:, None], 22050, mobile / "strings" / f"{string}_medium.mp3", args.quality)})
        part, frequency = soft
        pcm = np.clip(part * min(8, .65 / max(abs(part))), -1, 1)
        references.append({"frequency": frequency, "pcm": base64.b64encode(
            np.rint(pcm * 32767).astype("<i2").tobytes()).decode()})
    impulse = io.BytesIO()
    with wave.open(impulse, "wb") as stream:
        stream.setparams((1, 2, 22050, 1, "NONE", "not compressed"))
        stream.writeframes(b"\x00\x00")
    bank = {"source": "Owner-provided acoustic guitar recordings", "samples": samples,
            "impulse": base64.b64encode(impulse.getvalue()).decode(), "wetGain": 0,
            "recordings": recordings}
    folder = root / "assets/guitar-recordings"
    folder.mkdir(exist_ok=True)
    for chord, recording in bank.pop("recordings").items():
        (folder / (chord.replace("#", "sharp") + ".json")).write_text(
            json.dumps(recording, separators=(",", ":")), encoding="utf-8")
    (root / "assets/guitar-bank.json").write_text(json.dumps(bank, separators=(",", ":")), encoding="utf-8")
    (root / "assets/guitar-samples.json").write_text(json.dumps(references, separators=(",", ":")), encoding="utf-8")
    print(f"Prepared {len(recordings)} chords, 144 strokes and {len(samples)} recorded strings")


if __name__ == "__main__":
    main()
