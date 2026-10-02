# Varkan armor surface v1

Generated with the built-in Codex image_gen tool on 2026-10-02. The checked-in original is `armor-surface-v1.png`, copied from the generated image output without replacing an existing asset.

This is a neutral grayscale surface sample, not a normal, roughness, metallic or lighting map. The model's existing palette, mask and runtime lighting remain authoritative.

The compile script produces `armor-surface-v1-r8.png` and matching source modules in the render package and model viewer. It reduces the tile to 128 x 128 luminance, normalizes its grain around 128 with bounded contrast, and blends an 8-pixel edge band to match opposing edges. The GPU stores one shared R8 repeat texture with mipmaps (about 22 KiB including the mip chain). The mesh attribute `_SURFACE` is a normalized scalar u8; GPU packing uses byte 17 in the existing 40-byte vertex stride. No new draw, triangle or instance record is added.

Only the Varkan palette sets nonzero weights: base/body/iron 220, dark/soot 110, metal/copper 200, accent/ceramic 90. Team paint, emissive slots and glass have zero weight. Other factions and old GLBs omit the attribute and use zero. The game and model viewer sample it with bind-space triplanar projection so animation follows the material. Generic glTF viewers still show the exported vertex colors; the custom surface map is a FAF shader feature.

Regenerate the deterministic reduced sample and source modules:

```sh
python3 tools/assets-pipeline/scripts/armor-surface.py
pnpm models
pnpm assets
```

The first command needs Pillow. Image generation is deliberately not part of deterministic asset compilation. To create a new source, invoke the built-in image_gen tool with the prompt below, save a new version and update the compile script's source filename.

## Exact generation prompt

```text
Use case: stylized-concept
Asset type: seamless square tileable grayscale albedo surface texture for a small-scale sci-fi RTS armor model.
Primary request: a neutral machined cast gunmetal and matte ceramic armor surface, viewed perfectly straight-on as a flat material sample filling the entire square. Restrained fine grain, sparse shallow precision hairline machining marks, very faint even mottling. Large calm areas; detail must remain subtle after reduction to 256 pixels.
Color palette: neutral light gray only, mean gray around RGB 205, narrow brightness range about 180 to 230. No colored pigment; existing model vertex colors will tint this tile for graphite iron, copper, and ceramic.
Materials/textures: clean industrial cast metal with a powder ceramic finish, tiny pores and fine micro scratches. No panel layout, no bolts, no large damage scars.
Composition: seamless repeating edges, uniform detail scale across the whole sample, no border and no central focal point.
Lighting: completely flat diffuse albedo, no directional light, no highlights, no shadow, no ambient occlusion, no vignette, no perspective.
Constraints: genuinely tileable on both axes; no text, logos, symbols, watermark, objects, panels, seams, large stains, thick scratches, dark cracks, directional gradients, or baked 3D lighting. This is one material texture, not a scene or rendered object.
```

