# rfx-p3: GPU-Partikel

Der konsolidierte Stand enthält `particles/system.ts`, `record.ts`, `shaders.ts` und `vs-mirror.ts`. Der zustandslose Spawn-Ring umfasst 65.536 Records mit 32 Byte Stride; der Vertex-Shader wertet Bewegung, Größe und Farbe aus Layer-Tabelle und Kurven-LUT aus. Neue Records werden in einem oder bei Umlauf zwei Bereichen hochgeladen. Emitter haben feste Handle-Kapazität, Frustum-/Pixel-Culling gilt für Prio 2. Caps stammen aus dem Render-Preset; Prio 0 wird weiter angenommen.

Öffentliche API: `ParticleSystem`, `particleCapForPreset`, Record-/Mirror-Helfer, Partikel-GLSL und Konstanten über `src/particles/index.ts`. GPU-Positionen sind raw Q20.12, Richtung/Skalierung und Zeit werden in den Spawn-Record geschrieben. Partikel verwenden FxBindings, LUT-Unit 12 und Layer-Unit 15.

Unit-Tests prüfen Ring-Umlauf, Upload-Menge, Restore, Emitter, Prioritäten, Histogramm gegen Brute-Force und 10.000 GLSL-Mirror/CPU-Referenzfälle. Der am 29.09.2026 ergänzte `smoke/cases/particles.ts` misst die sichtbare Position eines bewegten Partikels gegen die Referenz mit ±2 Pixeln, vor und nach echtem Context-Loss/Restore in allen drei Engines.

Für MS5/MS7: Event-Position/Seed/Richtung beim Spawn übernehmen, kontinuierliche Owner an Emitter koppeln, Pass nach Units/Shields encodieren und Cap/Dropped/Upload/Draw-Zähler weiterreichen. Die vollständige Leistungsbewertung erfolgt im Haupttask; funktionale Nachweise stehen im P7-Fragment.
