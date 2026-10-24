# Musik für Reels

Hier liegen Musikspuren, die die Produktion unter die Reels legt (MP3 oder WAV, 120 BPM bevorzugt).

## Regeln
- Nur eigene oder lizenzfreie Musik (CC0 / royalty-free mit Nachweis). Lizenz als `<datei>.txt` daneben.
- Keine Chart-Musik, keine Trending-Sounds – die werden nur direkt in Instagram/TikTok gesetzt, nie in die Datei gebrannt.
- Dateinamen klein, ohne Leerzeichen: `warm-120.mp3`, `clean-120.mp3`.
- Die Produktion wählt per `musik:` im Format-Brief oder nimmt die erste Datei alphabetisch.

## Fallback
Liegt hier nichts, erzeugt `node supervisor/dist/adapters/studio.js beat --bpm 120 --seconds 12 --out <wav>`
einen schlichten synthetischen Beat (Kick, Hi-Hat, Bass). Das reicht für Takt und Schnitt;
für den Feed ist eine echte Spur besser.
