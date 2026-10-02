# ACU module artwork

Three original component illustrations generated with the built-in `image_gen` tool, each in a separate call with `transparent_background: true`. The exact [prompts](prompts.json) and source/compiled [hashes](manifest.json) are checked in. No Supreme Commander pixels are shipped in these assets.

The engineering module depicts a fabrication forearm, the cannon module a weapon forearm, and the armor module a plated back pack. These are module illustrations, not portraits of a selected unit. Neutral steel and copper leave the HUD's faction color visible around the icon. The existing body-slot schematics continue to identify left arm, back and right arm.

The source PNGs are original ImageGen outputs copied into this directory. The game bundles only three compiled 128px lossless WebP files in `apps/game/src/hud/assets/enhancement-art-v1`. Regenerate these without an API call:

```sh
python3 content/ui/enhancement-art-v1/compile.py
```

The compiler requires Pillow and downsamples with premultiplied alpha to retain transparent edges. It does not paint, replace or invent any pixels of the module subject.
