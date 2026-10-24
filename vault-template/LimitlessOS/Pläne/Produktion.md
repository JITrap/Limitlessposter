---
type: plan
stimme: thorsten
sprechtempo: 1.0
musik: beat
tagesziel:
  instagram: "3 Reels + 1 Karussell"
  tiktok: "3 Videos + 1 Fotobeitrag"
  linkedin: "1 Post Mo/Mi/Fr"
  gmb: "1 Beitrag Di/Do/Sa"
updated: 2026-10-24
---
# Produktion – Tagesplan für Reels und Karussells

> [!info] Diese Notiz steuert die Station **Produktion**. Der Planer legt jeden Abend die Aufgaben für den nächsten Tag an
> (je Netzwerk und Slot eine), die Produktion baut Video, Stimme, Untertitel und Cover, das Content-Studio plant ein.
> Du änderst hier Stimme, Tempo, Musik, Formate oder Slots – das System liest die Notiz bei jedem Lauf neu.

## Stimme
- `stimme: thorsten` = eingebaute deutsche Stimme (läuft auf jeder CPU).
- Eigene Stimme: WAV nach `Assets/stimmen/<name>.wav` legen und hier `stimme: <name>` setzen (braucht Chatterbox, siehe `docs/anleitung/stimme.md`).
- `sprechtempo` 0.8–1.2. Sprechtext je Reel: 1–3 kurze Sätze, keine Preise (TikTok) und keine Domain im Ton.

## Musik
- `musik: beat` = eigener Beat aus dem Studio (120 BPM). Oder Dateiname aus `stations/produktion/musik/` (nur eigene oder lizenzfreie Spuren).
- Trend-Sounds setzt Julius nur in der App, nie in der Datei.

## Slots (Zeiten je Wochentag, aus der alten Automatik übernommen)
| Tag | Instagram Reels | Instagram Karussell | TikTok Videos | TikTok Fotos | LinkedIn | Google |
|---|---|---|---|---|---|---|
| Mo | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | 08:30 | – |
| Di | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | – | 10:00 |
| Mi | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | 08:30 | – |
| Do | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | – | 10:00 |
| Fr | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | 08:30 | – |
| Sa | 11:00 · 15:00 · 19:00 | 09:00 | 11:00 · 15:00 · 19:30 | 09:00 | – | 10:00 |
| So | 11:00 · 15:00 · 19:00 | 09:00 | 11:00 · 15:00 · 19:30 | 09:00 | – | – |

Die genauen Zeiten stehen in `stations/produktion/slots.json`; die Tabelle hier ist die lesbare Fassung.

## Formate (Rotation)
Reels im Wechsel: **T01** Vorher/Nachher · **T02** Tippe & entscheide · **T03** Drei Fehler · **T04** Welches Poster bist du ·
**T07** Zoom ins Motiv · **T08** Satz des Tages. Karussell/Fotobeitrag: **R-karussell** (6 Slides). Pro Tag kein Format doppelt,
pro Woche jedes Format höchstens zweimal je Netzwerk. Motive rotieren durch die Themen aus `Marke/Produkte.md`
(Motivation, Racing, Wildlife, Fußball, …) – kein Motiv zweimal in 7 Tagen.

## Regeln, die immer gelten
- Hook in Bild 0 lesbar, kein „!“, keine Marken- oder Personennamen im Bild, Domain nur auf der Endcard.
- Preis nur, wenn der Auftrag es sagt, und nur aus `Marke/Produkte.md` (TikTok: nie ein Preis in der Caption).
- Jeder Post geht durch `gate.js` (Texte, Hashtags, Längen) und `posts.js check` (Dubletten). Fällt eines durch, bleibt es Entwurf.
- Alle Dateien liegen unter `Assets/content/<task-id>/`. Vorschau der letzten Produktionen zeigt die Welt (Bereich „Produktion“).

## Notizen von Julius
(hier kannst du Motive, Sätze oder Wünsche für die nächsten Tage notieren – der Planer liest sie)
