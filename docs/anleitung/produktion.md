# Produktion – so entstehen Reels und Karussells

Die Station **Produktion** baut aus einer Aufgabe ein fertiges Reel: Szene (HTML, Bild für Bild gerendert), Stimme (lokal),
Untertitel, Musik, Cover, Caption – und prüft alles am Qualitäts-Gate. Das **Content-Studio** plant das Ergebnis danach
über den Dubletten-Schutz ein. Der **Planer** legt um 05:30 die Produktions-Aufgaben für morgen an, füllt um 12:00 und
18:00 nach, wenn morgen noch etwas zum Soll fehlt, und plant dann Tag für Tag bis 7 Tage voraus.

## Tagesziel (wie die alte Automatik – Soll steht in `Strategie.md` → `daily_targets`)
| Netzwerk | Menge | Slots (Mo–Fr; Wochenende abweichend, siehe Produktion.md) |
|---|---|---|
| Instagram | 3 Reels + 1 Karussell + 4 Stories | Reels 12:30 · 16:30 · 20:00 / Karussell 07:30 / Stories 30 min danach |
| TikTok | 3 Videos + 1 Fotobeitrag | 12:30 · 16:30 · 20:30 / 07:30 |
| Facebook | 3 Reels + 1 Post + 4 Stories (Zweitverwertung, nur wenn in Metricool verbunden) | 12:00 · 15:30 · 18:30 / 09:00 |
| LinkedIn | 1 Post Mo/Mi/Fr (Metricool-Autolist) | 08:15 |
| Google Unternehmensprofil | 1 Beitrag Mo/Mi/Fr (dieselbe Metricool-Autolist wie LinkedIn) | 11:05 |

Ein Reel-Slot ist **eine** Produktion mit einer Caption je Netz; die Stories gehören zur Content-Aufgabe des Beitrags.
Die Welt zeigt im Kalender je Tag Ist/Soll – rot, wo etwas fehlt. Zeiten und Rotation stehen in
`<Vault>\LimitlessOS\Pläne\Produktion.md` – dort änderst du Stimme, Musik, Formate und `stories`.

## Formate
| Kürzel | Name | Dauer | Szene |
|---|---|---|---|
| T01 | Vorher/Nachher | 10 s | `t01-vorher-nachher` |
| T02 | Tippe & entscheide | 10 s | `t02-tippe-entscheide` |
| T03 | Drei Fehler | 12 s | `t03-drei-fehler` |
| T04 | Welches Poster bist du | 12 s | `t04-welches-poster-bist-du` |
| T07 | Zoom ins Motiv | 10 s | `t07-zoom-ins-motiv` |
| T08 | Satz des Tages | 10 s | `t08-satz-des-tages` |
| R-karussell | Karussell / Fotobeitrag | 6 Slides | `karussell-slide` |

Briefs mit Hook-Ideen, Sprechtext-Vorgaben und Regeln: `stations/produktion/formate/`. Die Szenen liegen in
`stations/produktion/vorlagen/` (HTML + `lib.js` + `base.css`, Schrift Anton/Inter, Farben Royal Noir).

## Werkzeuge (vom Repo-Ordner aus)
```
node supervisor\dist\adapters\stimme.js speak --text-file sprechtext.txt --out stimme.wav
node supervisor\dist\adapters\studio.js beat --bpm 120 --seconds 12 --out beat.wav
node supervisor\dist\adapters\studio.js render-reel --scene t01-vorher-nachher --data @szene.json --out clip.mp4 ^
     --audio stimme.wav --music beat.wav --subs @subs.json --cover cover.jpg --stills 0,3,6,9
node supervisor\dist\adapters\studio.js render-still --scene karussell-slide --data @slide-1.json --out slide-1.png --size 1080x1350
node supervisor\dist\adapters\gate.js tiktok --post post-tiktok.json --product berge-im-morgenlicht="Berge im Morgenlicht"
```
`render-reel` rendert jedes Bild in Chromium (ohne Grafikkarte), mischt Stimme und Musik mit ffmpeg (Musik −14 dB, Ausblenden am Ende),
hält die Datei unter 15 MB und speichert Cover (Bild 0) und Standbilder.

## Qualitäts-Gate
`gate.js` ist die alte Prüfung der Automatik (Python): Preis nur „79,99“ mit Preiszeile, erlaubte Größen, keine Rabatt-/Material-/
Lieferzeit-Wörter, keine Marken- oder Personennamen, Hashtag-Anzahl, Längen, TikTok-Titel, Produktlink je Plattform.
Ausgabe `PASS <id>` oder `SKIP <id>: <Gründe>`; Exit 0/1. Was nicht besteht, bleibt Entwurf und steht in der Aufgabe unter „Offene Fragen“.
Braucht Python 3 (die Stimme-Installation reicht).

## Was du siehst
In der Welt: Bereich **Produktion** mit den letzten Clips (Cover, Standbilder, Stimme-Status) und der Kalender aus
`Pläne/Veröffentlicht.md`. Im Vault: `Assets/content/<task-id>/` mit `clip.mp4`, `cover.jpg`, `stimme.wav`, `subs.json`,
`caption-<netz>.txt`, `post-<netz>.json`, `gate.txt`.

## Was Julius einmal tun muss
1. `tools\stimme\install.ps1` ausführen (Stimme + Python-Umgebung).
2. Optional eigene Musik nach `stations/produktion/musik/` (nur eigene oder lizenzfreie Spuren).
3. Optional eigene Stimme nach `Assets/stimmen/julius.wav` und `stimme: julius` in `Pläne/Produktion.md`.
