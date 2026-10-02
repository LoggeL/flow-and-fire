"""Compile alpha-preserving ACU module icons from the checked-in ImageGen sources."""
from hashlib import sha256
import json
from pathlib import Path
from PIL import Image

source = Path(__file__).resolve().parent
destination = source.parents[2] / "apps/game/src/hud/assets/enhancement-art-v1"
destination.mkdir(parents=True, exist_ok=True)
rows = []
for name in ("engineering", "cannon", "armor"):
    original = source / f"{name}-source.png"
    with Image.open(original) as image:
        rgba = image.convert("RGBA")
        assert rgba.getchannel("A").getextrema() == (0, 255), name
        # Premultiplied-alpha resampling avoids dark fringes on the faction-tinted socket.
        icon = rgba.convert("RGBa").resize((128, 128), Image.Resampling.LANCZOS).convert("RGBA")
        output = destination / f"{name}-v1.webp"
        icon.save(output, format="WEBP", lossless=True, method=6, exact=True)
    rows.append({"id": name, "source": original.name, "sourceSha256": sha256(original.read_bytes()).hexdigest(),
                 "asset": output.name, "assetSha256": sha256(output.read_bytes()).hexdigest(), "size": [128, 128]})
(source / "manifest.json").write_text(json.dumps({"mode": "built-in image_gen", "transparent_background": True, "assets": rows}, indent=2) + "\n")
print(json.dumps(rows, indent=2))
