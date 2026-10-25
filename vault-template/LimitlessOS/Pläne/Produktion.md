---
type: plan
stimme: thorsten
sprechtempo: 1.0
musik: beat
stories: ja
tagesziel:
  instagram: "3 Reels + 1 Karussell + 4 Stories"
  tiktok: "3 Videos + 1 Fotobeitrag"
  facebook: "3 Reels + 1 Post + 4 Stories (Zweitverwertung, nur wenn verbunden)"
  linkedin: "1 Post Mo/Mi/Fr (Autolist)"
  gmb: "1 Beitrag Di/Do/Sa (Autolist)"
updated: 2026-10-25
---
# Produktion – Tagesplan für Reels und Karussells

> [!info] Diese Notiz steuert die Station **Produktion**. Der Planer legt um 05:30 die Aufgaben für morgen an und füllt um
> 12:00/18:00 nach, bis jeder Tag der nächsten Woche sein Soll hat (je Slot eine Produktion, dazu je Produktion eine Content-Aufgabe).
> Die Produktion baut Video, Stimme, Untertitel, Cover und Story-Bild, das Content-Studio plant ein – Instagram, TikTok, Stories und
> (wenn verbunden) Facebook. Du änderst hier Stimme, Tempo, Musik, Formate, Slots oder `stories` – das System liest die Notiz bei jedem Lauf neu.
> Soll-Mengen pro Tag stehen in [[Strategie]] (`daily_targets`); `tagesziel` hier ist nur die lesbare Kopie.

## Stimme
- `stimme: thorsten` = eingebaute deutsche Stimme (läuft auf jeder CPU).
- Eigene Stimme: WAV nach `Assets/stimmen/<name>.wav` legen und hier `stimme: <name>` setzen (braucht Chatterbox, siehe `docs/anleitung/stimme.md`).
- `sprechtempo` 0.8–1.2. Sprechtext je Reel: 1–3 kurze Sätze, keine Preise (TikTok) und keine Domain im Ton.

## Musik
- `musik: beat` = eigener Beat aus dem Studio (120 BPM). Oder Dateiname aus `stations/produktion/musik/` (nur eigene oder lizenzfreie Spuren).
- Trend-Sounds setzt Julius nur in der App, nie in der Datei.

## Slots (Zeiten je Wochentag, exakt aus der alten Automatik – `stations/produktion/slots.json`)
| Tag | Instagram Reels | Instagram Karussell | TikTok Videos | TikTok Fotos | Facebook Reels | Facebook Post | LinkedIn | Google |
|---|---|---|---|---|---|---|---|---|
| Mo | 12:30 · 16:30 · 19:30 | 07:30 | 12:30 · 16:30 · 20:00 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | 08:15 | – |
| Di | 12:30 · 16:30 · 20:00 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | – | 10:00 |
| Mi | 12:00 · 16:00 · 19:30 | 07:30 | 12:30 · 16:30 · 20:30 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | 08:15 | – |
| Do | 12:30 · 16:30 · 20:00 | 07:30 | 13:00 · 16:30 · 20:00 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | – | 10:00 |
| Fr | 13:00 · 17:00 · 21:00 | 07:30 | 13:00 · 17:00 · 20:30 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | 08:15 | – |
| Sa | 12:00 · 16:30 · 20:30 | 09:30 | 12:00 · 16:00 · 19:30 | 09:30 | 12:00 · 16:00 · 19:30 | 09:30 | – | 10:00 |
| So | 10:00 · 14:00 · 21:00 | 17:30 | 10:00 · 14:00 · 20:00 | 17:00 | 10:30 · 14:30 · 20:30 | 17:00 | – | – |

Regeln aus der alten Automatik: Reels im selben Netz mindestens 3 Stunden auseinander, der Feed-Beitrag mindestens 2,5 Stunden
neben jedem Reel; Reel 3 (Abend) ist das Hero-Reel mit dem stärksten Motiv; Stories 15–45 Minuten nach ihrem Beitrag; nach 22:00
wird nichts mehr eingeplant. Alle Zeiten sind deutsche Ortszeit (Europe/Berlin). Facebook bekommt dieselben Dateien wie Instagram
mit eigenem Text und Produktlink – nur, solange Facebook in [[Marke/Kanäle]] als verbunden steht. LinkedIn und Google bedient die
Metricool-Autolist; das System plant dort nur bei Produkt- und Angebotsnews zusätzlich.

## Formate (Rotation)
Reels im Wechsel: **T01** Vorher/Nachher · **T02** Tippe & entscheide · **T03** Drei Fehler · **T04** Welches Poster bist du ·
**T07** Zoom ins Motiv · **T08** Satz des Tages. Karussell/Fotobeitrag: **R-karussell** (6 Slides). Pro Tag kein Format doppelt,
pro Woche jedes Format höchstens zweimal je Netzwerk. Motive rotieren durch die Themen aus `Marke/Produkte.md`
(Motivation, Racing, Wildlife, Fußball, …) – kein Motiv zweimal in 7 Tagen.

## Regeln, die immer gelten
- Hook in Bild 0 lesbar, kein „!“, keine Marken- oder Personennamen im Bild, Domain nur auf der Endcard.
- Preis nur, wenn der Auftrag es sagt, und nur aus `Marke/Produkte.md` (TikTok: nie ein Preis in der Caption).
- Jeder Post geht durch `gate.js` (Texte, Hashtags, Längen) und `posts.js check` (Dubletten). Fällt eines durch, bleibt es Entwurf.
- Stories (`stories: ja`): zu jedem Reel das Cover, zum Karussell `story.png` (Slide 1 in 9:16), ohne Text, 30 Minuten nach dem
  Beitrag, nie nach 22:00. Der Dubletten-Schutz prüft Stories nur über die Datei (gleiches Bild = Dublette).
- Alle Dateien liegen unter `Assets/content/<task-id>/`. Vorschau der letzten Produktionen zeigt die Welt (Bereich „Produktion“).

## Notizen von Julius
(hier kannst du Motive, Sätze oder Wünsche für die nächsten Tage notieren – der Planer liest sie)
