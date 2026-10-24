# Eigene Stimmen

Hier liegen Referenz-Aufnahmen für die Stimme (lokale Sprachausgabe, Motor Chatterbox).

- Eine Datei je Stimme: `julius.wav` → Stimme `julius`.
- 10–30 Sekunden, ruhig gesprochen, ohne Musik, ohne Hall, WAV (mono, 24–48 kHz).
- Nichts davon verlässt den Rechner. Die Datei wird nur beim Sprechen als Vorlage gelesen.
- Welche Stimme die Produktion nimmt, steht in `Pläne/Produktion.md` unter `stimme:`.
- Ohne Chatterbox (nur Piper) wird immer die eingebaute Stimme `thorsten` genutzt.

Prüfen: `node supervisor\dist\adapters\stimme.js voices`
