"""Convert bundled artwork to WebP without changing dimensions or alpha."""
import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    replacements, report = {}, []
    for folder in [root / "assets/images", root / "assets/notebooks", root / "android/app/src/main/res"]:
        for path in sorted(folder.rglob("*")):
            if path.suffix.lower() not in [".png", ".jpg", ".jpeg"]:
                continue
            if "android" in path.relative_to(root).parts and path.stat().st_size <= 100000:
                continue
            original = path.read_bytes()
            image = Image.open(io.BytesIO(original)).convert("RGBA")
            before = np.asarray(image, dtype=np.float32)
            alpha = before[:, :, 3:4] / 255
            quality = 95 if "guide" in path.parts else 90
            for quality in sorted({quality, 95, 98}):
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=quality, method=6, exact=True)
                after = np.asarray(Image.open(io.BytesIO(output.getvalue())).convert("RGBA"), dtype=np.float32)
                assert np.array_equal(before[:, :, 3], after[:, :, 3])
                error = np.mean(((before[:, :, :3] - after[:, :, :3]) * alpha) ** 2)
                psnr = float(10 * np.log10(255 ** 2 / max(error, 1e-12)))
                if psnr >= 35:
                    break
            if len(output.getvalue()) >= len(original):
                continue
            target = path.with_suffix(".webp")
            assert not target.exists(), str(target)
            target.write_bytes(output.getvalue())
            old, new = path.relative_to(root).as_posix(), target.relative_to(root).as_posix()
            replacements[old] = new
            report.append({"source": old, "path": new, "source_sha256": hashlib.sha256(original).hexdigest(),
                           "before_bytes": len(original), "bytes": target.stat().st_size,
                           "dimensions": list(image.size), "alpha_unchanged": True, "quality": quality, "psnr_db": psnr})
            path.unlink()
    for path in (root / "src").rglob("*"):
        if path.suffix not in [".ts", ".tsx", ".js", ".json"]:
            continue
        content = path.read_text(encoding="utf-8")
        updated = content
        for old, new in replacements.items():
            updated = updated.replace(old, new)
        if content != updated:
            path.write_text(updated, encoding="utf-8")
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"images": len(report), "before_bytes": sum(r["before_bytes"] for r in report),
                      "bytes": sum(r["bytes"] for r in report), "minimum_psnr_db": min((r["psnr_db"] for r in report), default=None)}))


if __name__ == "__main__":
    main()
