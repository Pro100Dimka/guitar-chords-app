#!/usr/bin/env python3
"""Render an honest backend-result demonstration, not an Android screen recording.

Requires Python 3.10+, Pillow, ffmpeg and ffprobe. No network or inference is used.
Example (from the repository root):
  python scripts/create_analysis_video.py \
    --audio backend/data/evaluation/cortez-feel.mp3 \
    --result backend/data/evaluation/cortez-api-result.json \
    --output /path/to/FreeTune-Cortez-real-analysis.mp4 \
    --source-url https://www.jamendo.com/track/1481500/feel-stripped \
    --license 'CC BY 3.0' \
    --license-url https://creativecommons.org/licenses/by/3.0/

Only the supplied analysis supplies words and chords. Attribution comes from
audio tags and explicit arguments; human-reference lyrics are never read.
Python renders in one thread; FFmpeg encoders/filters are limited to one thread.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 960, 540
BG, PANEL, BORDER = "#111318", "#1b1e25", "#333640"
GOLD, TEXT, MUTED, DIM = "#e8c67c", "#f4f2ec", "#aeb0ba", "#737986"


def stamp(seconds, decimals=False):
    milliseconds = round(max(0, seconds) * 1000)
    value = f"{milliseconds // 60000}:{milliseconds // 1000 % 60:02d}"
    return f"{value}.{milliseconds % 1000:03d}" if decimals else value


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def active(items, position):
    return next((item for item in items if item["start"] <= position < item["end"]), None)


def validate(result):
    if result.get("version") != 1 or not result.get("model"):
        raise ValueError("Expected an actual version-1 backend analysis result")
    duration = result.get("duration", 0)
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Invalid original recording duration")
    for kind in ("lyrics", "chords"):
        previous = -1.0
        for interval in result[kind]:
            start, end = interval["start"], interval["end"]
            if not all(math.isfinite(value) for value in (start, end)):
                raise ValueError("Non-finite interval")
            if not 0 <= start < end <= duration + 0.1 or start < previous:
                raise ValueError(f"Invalid or unordered {kind} interval")
            previous = start
            for word in interval.get("words", []):
                if not (start - 0.01 <= word["start"] < word["end"] <= end + 0.01):
                    raise ValueError("Word outside its original line interval")


class Renderer:
    def __init__(self, result, artist, title, source_url, license_name, license_url, seconds, font_dir):
        self.result, self.seconds = result, seconds
        self.artist, self.title = artist, title
        self.source_url, self.license_name, self.license_url = source_url, license_name, license_url
        self.fonts = {}
        self.font_dir = font_dir

    def font(self, size, bold=False):
        key = (size, bold)
        if key not in self.fonts:
            self.fonts[key] = ImageFont.truetype(
                str(self.font_dir / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), size
            )
        return self.fonts[key]

    def fit(self, text, size, max_width, bold=False):
        while size > 11 and self.font(size, bold).getlength(text) > max_width:
            size -= 1
        return self.font(size, bold)

    def words(self, draw, line, position, x, y, max_width, max_rows=3):
        words = line.get("words") or [
            {"text": part, "start": line["start"], "end": line["end"],
             "uncertain": line.get("uncertain", False)} for part in line["text"].split()
        ]
        for size in range(27, 14, -1):
            font = self.font(size, True)
            rows, width = 1, 0
            for word in words:
                length = font.getlength(word["text"] + " ")
                if width and width + length > max_width:
                    rows, width = rows + 1, 0
                width += length
            if rows <= max_rows:
                break
        left, top, row_height = x, y, size + 14
        for word in words:
            label = word["text"]
            length = font.getlength(label + " ")
            if left > x and left + length > x + max_width:
                left, top = x, top + row_height
            highlighted = word["start"] <= position < word["end"]
            if highlighted:
                draw.rounded_rectangle((left - 4, top - 3, left + length - 4, top + size + 7),
                                       radius=5, fill=GOLD)
            draw.text((left, top), label, font=font, fill=BG if highlighted else TEXT)
            if word.get("uncertain"):
                for dot in range(round(left), round(left + length - font.getlength(" ")), 5):
                    draw.line((dot, top + size + 8, dot + 1, top + size + 8), fill=GOLD, width=2)
            left += length

    def frame(self, position):
        frame = Image.new("RGB", (WIDTH, HEIGHT), BG)
        draw = ImageDraw.Draw(frame)
        draw.text((32, 22), "FREETUNE  /  АУДИО → ТЕКСТ + АККОРДЫ", font=self.font(13, True), fill=GOLD)
        heading = f"{self.artist} — {self.title}"
        draw.text((30, 48), heading, font=self.fit(heading, 32, 890, True), fill=TEXT)
        draw.text((32, 96), "Реальный результат backend · не экран Android", font=self.font(17), fill=MUTED)

        draw.rounded_rectangle((32, 137, 260, 346), radius=14, fill=PANEL, outline=BORDER)
        draw.rounded_rectangle((278, 137, 928, 346), radius=14, fill=PANEL, outline=BORDER)
        draw.text((50, 154), "АККОРД ЗАПИСИ", font=self.font(12, True), fill=MUTED)
        chord = active(self.result["chords"], position)
        chord_text = chord["label"] if chord else "—"
        draw.text((49, 186), chord_text, font=self.fit(chord_text, 58, 191, True), fill=GOLD)
        if chord:
            interval = f"{stamp(chord['start'], True)} — {stamp(chord['end'], True)}"
            draw.text((50, 269), interval, font=self.font(12), fill=MUTED)
        draw.text((50, 298), "Исходная тональность", font=self.font(13), fill=MUTED)
        if chord and chord.get("uncertain"):
            draw.text((50, 319), "Требует проверки", font=self.font(12), fill=GOLD)

        draw.text((298, 154), "РАСПОЗНАННЫЙ ТЕКСТ", font=self.font(12, True), fill=MUTED)
        line = active(self.result["lyrics"], position)
        if line:
            draw.text((298, 180), f"{stamp(line['start'], True)} — {stamp(line['end'], True)}",
                      font=self.font(12), fill=DIM)
            self.words(draw, line, position, 298, 211, 605)
            if line.get("uncertain"):
                draw.text((298, 322), "Пунктир и … — неуверенное распознавание", font=self.font(12), fill=GOLD)
        else:
            draw.text((298, 211), "На этом участке нет", font=self.font(23), fill=TEXT)
            draw.text((298, 244), "распознанных слов", font=self.font(23), fill=TEXT)
            following = next((item for item in self.result["lyrics"] if item["start"] > position), None)
            caption = (f"Следующая строка: {stamp(following['start'], True)}" if following else
                       "Пропуски анализа требуют проверки по записи")
            draw.text((298, 304), caption, font=self.font(13), fill=MUTED)

        draw.text((32, 363), f"ИНТЕРВАЛЫ АККОРДОВ · ФРАГМЕНТ 0:00–{stamp(self.seconds)}",
                  font=self.font(12, True), fill=MUTED)
        clock = stamp(position, True)
        draw.text((928 - self.font(19, True).getlength(clock), 357), clock, font=self.font(19, True), fill=GOLD)
        rail_left, rail_width, rail_top, rail_height = 32, 896, 393, 29
        draw.rounded_rectangle((rail_left, rail_top, rail_left + rail_width, rail_top + rail_height),
                               radius=5, fill=PANEL)
        for item in self.result["chords"]:
            if item["start"] >= self.seconds:
                break
            left = rail_left + rail_width * item["start"] / self.seconds
            right = rail_left + rail_width * min(item["end"], self.seconds) / self.seconds
            selected = item is chord
            draw.rectangle((left, rail_top, right, rail_top + rail_height), fill=GOLD if selected else "#37352e")
            draw.line((left, rail_top, left, rail_top + rail_height), fill="#77705b", width=1)
            label, font = item["label"], self.font(11, True)
            if font.getlength(label) < right - left - 7:
                draw.text((left + 4, rail_top + 7), label, font=font, fill=BG if selected else MUTED)
        pointer = rail_left + rail_width * position / self.seconds
        draw.line((pointer, rail_top - 6, pointer, rail_top + rail_height + 5), fill=TEXT, width=2)
        for second in range(0, math.ceil(self.seconds) + 1, 15):
            label = stamp(second)
            offset = min(rail_left + rail_width * second / self.seconds,
                         rail_left + rail_width - self.font(11).getlength(label))
            draw.text((offset, 431), label, font=self.font(11), fill=DIM)

        draw.line((32, 457, 928, 457), fill=BORDER)
        draw.text((32, 469), "Автоматическая разметка · ошибки сохранены · исходный темп аудио",
                  font=self.font(13), fill=GOLD)
        credit = f"{self.artist} · {self.title} · {self.license_name} · добавлена визуализация"
        draw.text((32, 491), credit, font=self.fit(credit, 12, 890), fill=MUTED)
        urls = "  /  ".join(url.removeprefix("https://").removeprefix("http://").removeprefix("www.")
                            for url in (self.source_url, self.license_url))
        draw.text((32, 513), urls, font=self.fit(urls, 11, 890), fill=DIM)
        return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--license", required=True)
    parser.add_argument("--license-url", required=True)
    parser.add_argument("--seconds", type=float, default=75)
    parser.add_argument("--fps", type=int, default=8, choices=range(6, 11))
    parser.add_argument("--poster-time", type=float, default=31)
    parser.add_argument("--font-dir", type=Path, default=Path("/usr/share/fonts/truetype/dejavu"))
    args = parser.parse_args()
    os.nice(10)
    state = json.loads(args.result.read_text("utf-8"))
    if state.get("status") and state["status"] != "completed":
        raise ValueError("Wait for the backend job to finish before rendering")
    result = state.get("result", state)
    validate(result)
    audio_hash = sha256(args.audio)
    if state.get("audio_sha256") and state["audio_sha256"] != audio_hash:
        raise ValueError("Audio SHA-256 does not match the actual backend job")
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", str(args.audio)
    ]))["format"]
    tags = probe.get("tags", {})
    seconds = min(args.seconds, result["duration"], float(probe["duration"]))
    if seconds <= 0:
        raise ValueError("Excerpt duration must be positive")
    renderer = Renderer(result, tags.get("artist", "Unknown artist"), tags.get("title", args.audio.stem),
                        args.source_url, args.license, args.license_url, seconds, args.font_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".partial.mp4")
    log = args.output.with_suffix(".ffmpeg.log")
    frame_count = math.ceil(seconds * args.fps)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-filter_threads", "1", "-filter_complex_threads", "1",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(args.fps),
               "-i", "pipe:0", "-threads", "1", "-i", str(args.audio), "-t", str(seconds),
               "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-threads:v", "1",
               "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac",
               "-threads:a", "1", "-b:a", "160k", "-movflags", "+faststart",
               "-metadata", f"title={renderer.artist} — {renderer.title} / FreeTune backend analysis",
               "-metadata", f"comment=Not Android. {args.source_url} | {args.license}: {args.license_url}",
               str(temporary)]
    with log.open("wb") as stderr:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=stderr)
        try:
            for index in range(frame_count):
                process.stdin.write(renderer.frame(index / args.fps).tobytes())
            process.stdin.close()
            if process.wait() != 0:
                raise RuntimeError(f"FFmpeg failed; inspect {log}")
        except BaseException:
            process.kill()
            process.wait()
            temporary.unlink(missing_ok=True)
            raise
    temporary.replace(args.output)
    renderer.frame(min(max(args.poster_time, 0), seconds - 1 / args.fps)).save(args.output.with_suffix(".png"))
    renderer.frame(min(5, seconds / 2)).save(args.output.with_name(args.output.stem + "-intro.png"))
    evidence = {"kind": "Actual backend result visualization, not Android screen recording",
                "audioFile": args.audio.name, "audioSha256": audio_hash, "audioTags": tags,
                "analysisFile": args.result.name, "analysisSha256": sha256(args.result),
                "analysisJobId": state.get("id"), "models": result["model"], "warnings": result.get("warnings", []),
                "sourceUrl": args.source_url, "license": args.license, "licenseUrl": args.license_url,
                "excerptStartSeconds": 0, "excerptEndSeconds": seconds, "originalDuration": result["duration"],
                "audioChanges": "Excerpt from original beginning, AAC encoding; no tempo or pitch change",
                "annotationChanges": "None; words, chords, uncertainty and intervals use the supplied JSON",
                "fps": args.fps, "width": WIDTH, "height": HEIGHT, "frames": frame_count,
                "frameTimingResolutionSeconds": 1 / args.fps,
                "videoSha256": sha256(args.output), "videoBytes": args.output.stat().st_size}
    args.output.with_suffix(".json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
