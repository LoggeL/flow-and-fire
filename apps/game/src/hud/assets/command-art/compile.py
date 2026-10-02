"""Compile the preserved ImageGen sources into normalized alpha WebP glyphs."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SIZE = 128
OCCUPANCY = 0.78
manifest = json.loads((ROOT / 'generation-v1.json').read_text())
for asset in manifest['assets']:
    source = ROOT / 'source-v1' / f"{asset['id']}.png"
    image = Image.open(source).convert('RGBA')
    # Ignore near-invisible generator edge noise for layout; preserve source bytes.
    bounds = image.getchannel('A').point(lambda alpha: 255 if alpha > 8 else 0).getbbox()
    if bounds is None:
        raise ValueError(f'Empty source: {source}')
    cropped = image.crop(bounds)
    scale = SIZE * OCCUPANCY / max(cropped.size)
    resized = cropped.resize(tuple(round(edge * scale) for edge in cropped.size), Image.Resampling.LANCZOS)
    output = Image.new('RGBA', (SIZE, SIZE))
    output.alpha_composite(resized, ((SIZE - resized.width) // 2, (SIZE - resized.height) // 2))
    target = ROOT / f"{asset['id']}-v1.webp"
    output.save(target, format='WEBP', lossless=True, method=6)
    asset.update({
        'source': str(source.relative_to(ROOT)),
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sourceDimensions': list(image.size),
        'sourceAlphaBounds': list(bounds),
        'compiled': target.name,
        'compiledSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'compiledDimensions': [SIZE, SIZE],
        'compiledBytes': target.stat().st_size,
    })
manifest['compilation'] = {'tool': 'Python Pillow', 'pillowVersion': Image.__version__, 'size': SIZE, 'maxSymbolOccupancy': OCCUPANCY, 'format': 'lossless WebP RGBA', 'resampling': 'Lanczos'}
(ROOT / 'generation-v1.json').write_text(json.dumps(manifest, indent=2) + '\n')
