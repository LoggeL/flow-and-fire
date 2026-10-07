# Cinematic main menu

The menu uses three independently moving images: the distant factory landscape,
the transparent commander, and a transparent foreground rock ledge. Every layer
retains the same 1672 × 941 source frame. Slow camera movement increases towards
the foreground, with separate mist and eight restrained embers.

Three factory light pulses, two rising smoke wisps and a cyan emitter breath use
registered scene coordinates. Their companion planes follow the same crop and
camera movement as the corresponding image. The commander and rock cutouts use
real alpha masks; light and smoke effects stay confined to their own small areas.

The new Flow & Fire logo appears in the main menu and the in-match menu.
The main screen contains only branding, navigation and a small build label.
Language and the persisted background-animation switch live in Settings,
under "Spiel & Sprache" / "Game & language". Reduced motion from the OS or
accessibility settings always stops the scene. Hidden pages pause it; leaving
the main screen removes it entirely. Functional control accents follow the
chosen human army color.

Assets were generated with the built-in `image_gen.imagegen` tool. Sources,
exact prompts, dimensions, alpha checks, WebP encoding and hashes are recorded:

- [Original scene and prompt](generation-v1.json).
- [Final background, commander and foreground assets and prompts](parallax-generation-v1.json).
- [Shared logo asset and prompt](logo-generation-v1.json).

The production image payload totals 910,458 bytes across the three final scene
images and the logo. The original single-image variant is retained as design
provenance and is not imported by the production menu.

Validated application source: `d900618c1780`. [Native receipt](receipt.json)
contains nine menu cases and twelve army-color cases across Chromium, Firefox
and WebKit. All 21 passed without retries or runtime errors, with zero speaker
and blocked audio connections. The game/HUD Node suite passed 538 tests in
64 files; typecheck, full lint and the production build passed.

[Desktop](main-menu-desktop.png) · [Mobile](main-menu-mobile.png) ·
[Short window](main-menu-short.png) · [Animated preview](main-menu-parallax.mp4).
The [recording receipt](video-receipt.json) samples every image and scene effect
before and after twelve seconds of actual browser time, with no audio context.

Local preview: <http://127.0.0.1:5295/?menu=1>.
