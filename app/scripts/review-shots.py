"""Copy the browser tests' screenshots into design/screens/ for review.

    npm run test:e2e          writes test-results/screenshots/*.png
    npm run shots             this script (needs Pillow: pip install pillow)

The copies are lossless WebP: the same pixels at about half the size, so a
round of design review puts less into the repository.
"""

import pathlib
import sys

from PIL import Image

app = pathlib.Path(__file__).resolve().parent.parent
src = app / "test-results" / "screenshots"
dst = app / "design" / "screens"

shots = sorted(src.glob("*.png"))
if not shots:
    sys.exit(f"no screenshots in {src}; run `npm run test:e2e` first")
dst.mkdir(parents=True, exist_ok=True)
for old in [*dst.glob("*.webp"), *dst.glob("*.png")]:
    old.unlink()
before = after = 0
for shot in shots:
    out = dst / (shot.stem + ".webp")
    Image.open(shot).convert("RGB").save(out, "WEBP", lossless=True, method=6)
    before += shot.stat().st_size
    after += out.stat().st_size
print(f"{len(shots)} screenshots -> {dst.relative_to(app)}  ({before / 1e6:.1f} MB -> {after / 1e6:.1f} MB)")
