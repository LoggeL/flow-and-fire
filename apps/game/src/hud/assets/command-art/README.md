# Command art v1

Six original generated command glyphs for the live game HUD. The style follows the requested Supreme Commander Forged Alliance inspired luminous enamel treatment. These are generated assets, not extracted game artwork.

The built-in `image_gen.imagegen` tool generated each symbol in a separate call with `transparent_background: true`. No API key, fallback CLI, or explicitly selected image model was used. The built-in API does not expose a model identifier. `generation-v1.json` records every exact prompt, original tool output path, source hash, compiled hash, dimensions, and byte size.

`source-v1/*.png` preserves all six unmodified generated RGBA images. `*-v1.webp` contains the deployable 128px lossless RGBA glyphs. `compile.py` crops to visible alpha bounds and centers the source at 78% of the square. The crop ignores alpha values at or below 8 when finding bounds; it does not alter source files. Run `python3 compile.py` with Pillow to reproduce the deployment files.

Move and patrol use cyan, attack and stop use red, and assist and reclaim use gold. Command colors do not change with the player army. Recessed dark sockets, armed highlights, and disabled treatment are CSS. `CommandArt` is decorative; the existing `OrderButton` supplies the accessible label and interaction behavior.
