# Stimme – lokale Sprachausgabe ohne Cloud

Die Stimme spricht die Reel-Texte. Sie läuft komplett auf deinem PC: kein Konto, kein API-Schlüssel, nichts
verlässt den Rechner. Zwei Motoren:

| Motor | Qualität | Braucht | Eigene Stimme |
|---|---|---|---|
| **Chatterbox Multilingual** (Resemble AI, MIT) | sehr natürlich, 23 Sprachen inkl. Deutsch | am besten Nvidia-Grafikkarte, geht auch auf CPU (langsam) | ja, per 10–30 s Referenz-WAV |
| **Piper** (MIT) | klar, leicht synthetisch | nur CPU, schnell | nein (Stimme „thorsten“) |

Das System nimmt Chatterbox, wenn es installiert ist, sonst Piper.

## Einrichten (einmal)
```
powershell -ExecutionPolicy Bypass -File tools\stimme\install.ps1
```
Das Skript legt `tools\stimme\.venv` an, installiert Torch (CUDA, falls `nvidia-smi` eine Karte zeigt), Piper und Chatterbox,
lädt die deutsche Piper-Stimme (ca. 110 MB) und schreibt `supervisor\data\stimme.json`. Optionen: `-CpuOnly`, `-SkipChatterbox`.
Voraussetzung: Python 3.10 oder neuer (`py -3 --version`). Fehlt es: https://www.python.org/downloads/windows/ – Haken bei „Add to PATH“.

## Testen
```
node supervisor\dist\adapters\stimme.js status
node supervisor\dist\adapters\stimme.js speak --text "Dein Zimmer sagt mehr über dich als dein Outfit." --out %TEMP%\probe.wav
```
Der erste Aufruf startet den Server (`tools\stimme\server.py`, Port 4243) und lädt das Modell – auf CPU dauert das ein paar Minuten,
danach spricht er in Sekunden. Neben der WAV entsteht `probe.wav.json` mit den Sätzen und ihren Zeiten (daraus werden die Untertitel).

## Eigene Stimme
1. 10–30 Sekunden ruhig sprechen, ohne Musik und Hall, als WAV speichern.
2. Datei nach `<Vault>\LimitlessOS\Assets\stimmen\julius.wav`.
3. In `Pläne\Produktion.md` oben `stimme: julius` setzen.
Nur mit Chatterbox; Piper kennt nur `thorsten`.

## Was der Text-Vorbereiter macht
`tools\stimme\vorverarbeitung.py` schreibt Zahlen, Preise („79,99 €“ → „neunundsiebzig Euro neunundneunzig“), Abkürzungen (z. B., inkl., § 19 UStG)
und Maße (50×70 cm) aus und entfernt Hashtags, Links und Emojis. Domains werden nicht gesprochen – sie gehören auf die Endcard.

## Einstellungen (.env, alle optional)
- `STIMME_PORT` (Standard 4243), `STIMME_PYTHON` (Pfad zu einem Python, falls nicht die venv), `STIMME_ENGINE` (`auto|chatterbox|piper`).

## Wenn etwas hakt
- `stimme.js status` zeigt `laeuft: false` → Log lesen: `supervisor\data\logs\stimme.log`.
- „Kein Python gefunden“ → `tools\stimme\install.ps1` ausführen.
- Chatterbox lässt sich nicht installieren → `-SkipChatterbox`; Piper reicht für den Betrieb.
- Server stoppen: `node supervisor\dist\adapters\stimme.js stop`.
