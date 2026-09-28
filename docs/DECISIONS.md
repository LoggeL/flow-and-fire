# Entscheidungen (autonom getroffen, Nutzer: "ohne Rückfragen")

Stand 2026-09-28. Offene Entscheidungen aus PLAN.md §7:

1. **Reihenfolge:** (a) früher FA-Loop, Balancing nur einmal auf finaler Kampfphysik.
2. **Rust/WASM-Ausweg:** (a) vorab freigegeben, falls SPK1 das Tick-Budget verfehlt.
3. **Mauern:** (a) Minimal-Drag-Linie für Strukturen mit `wall`-Flag in MS8.
4. **Area-Reclaim (E14):** (a) wird mit E8 in MS8 ins MVP gezogen.
5. **GPU-Hardware:** Keine Iris-Xe/UHD-620-Runner verfügbar. Gemessen wird lokal (Apple M5 Pro) plus
   Playwright Chromium/Firefox/WebKit headless. GPU-/FPS-Gates gegen iGPU sind damit nicht belegbar und
   werden als "lokal gemessen" markiert.

Weitere pragmatische Anpassungen:
- **CI:** zunächst lokales Skript `pnpm ci:local` statt Hosted-CI (kein Remote-Repo).
- **Bun (JSC):** Cross-Engine-Determinismus über Node (V8) + Playwright WebKit (JSC) + Firefox (SpiderMonkey).
- **Spikes SPK1–SPK6:** als Benchmarks/Prototypen innerhalb von MS1 statt 7-Wochen-Block.
- **Name:** **Flow & Fire (FAF)** — Initialen als Anlehnung an Forged Alliance Forever. Ordner `flow-and-fire`, Paket-Scope `@faf/*`. (Anfangs-Codename `ironflow`, Umbenennung nach MS1.) Eigene Fraktion, keine FA-Namen/Assets.
- **Speicher:** Mac ohne Swap → max. 2 schwere Build-/Test-Agenten parallel.
