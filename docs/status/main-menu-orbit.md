# Layered menu camera, 2026-10-02

The menu scene now shares a 24-second camera sweep with a small perspective
Y rotation and roll. Background, commander and foreground countertranslate
at different depths on the same clock. Overscan covers the image edges;
source-registered factory effects follow their matching image transforms.
The navigation and logo remain outside the camera transform.

Six additional atmosphere planes move independently: a masked cloud shadow,
warm sky light, two valley haze ribbons and two staggered factory smoke
billows. They reuse the existing artwork and add localized gradients and
masks. Animation uses CSS transforms and opacity, without a JavaScript frame
loop or animated full-screen filters.

The Settings switch pauses every plane, including the camera. The preference
survives reload. Hidden tabs pause motion, and OS or application reduced
motion disables the animations. Listener cleanup remains intact.

Validated build: `aef587536cf4-d6d717f58`.

- All nine native menu cases passed across Chromium, Firefox and WebKit,
  including desktop, narrow and short layouts, keyboard navigation, real
  motion, pause, reduced motion and transition into a human-versus-AI game.
- The camera's projected corner moved between 3.55 and 3.60 pixels over 700 ms in those
  engines. All six added atmosphere transforms changed independently;
  paused and reduced-motion samples remained stationary.
- 538 focused game/HUD tests, typecheck and lint passed. Browser game tests
  verified the silent audio graph, with no speaker connections.
- A 12-second preview records real frames from the current in-app browser,
  with no audio track and no artificial animation-clock changes.

[Native receipt](../design/main-menu-orbit-2026-10-02/receipt.json),
[screenshot](../design/main-menu-orbit-2026-10-02/main-menu.jpg),
[motion preview](../design/main-menu-orbit-2026-10-02/main-menu-orbit.mp4).

Local menu: <http://127.0.0.1:5295/?menu=1>.
