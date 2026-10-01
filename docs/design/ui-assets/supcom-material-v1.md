# SupCom HUD material and build images

The gunmetal fill was generated with the built-in ImageGen tool. The structural frames, text, controls and states are implemented in CSS and Preact. The supplied Supreme Commander screenshots serve as visual references; their pixels are not shipped as UI assets.

Material: `apps/game/src/hud/assets/gunmetal-v1.png` (opaque PNG).
SHA-256: `29dd05c145909d670e1733a6d9efd7350b1cd0d81b18f4b940f0030b922226b5`.

The build-button PNGs are rendered from the game's actual Varkan models, rather than generated depictions of other units. Regenerate them with `pnpm exec tsx tools/model-shots/scripts/hud-icons.ts`. Their source model hashes and render settings are recorded in `apps/game/src/hud/assets/build-icons/manifest.json`. They are build candidates, not selected-unit portraits.

## ImageGen prompt

```text
Use case: stylized-concept
Asset type: seamless square raster material texture used as a subtle tiled fill behind a real coded RTS HUD, not a UI mockup.
Primary request: generate a physically believable dark blue-grey gunmetal surface, inspired by the machined steel interiors of early 2000s Supreme Commander Forged Alliance interface panels. Uniform flat front-facing metal material filling the entire image edge to edge. Very fine brushed grain, sparse tiny abrasion and machining marks, restrained grey-blue specular flecks. Deep charcoal graphite, predominantly #151e22 to #263138. Low contrast so small white UI text remains perfectly legible above it. No layout, no panels, no frame, no objects, no screws, no symbols, no text, no dramatic lighting, no vignette, no gradient across image. Orthographic, evenly illuminated. Seamless repeatable texture without identifiable landmarks. The image will be tiled behind independently constructed CSS chrome bevels. Keep it understated and utilitarian.
```
