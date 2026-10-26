---
type: plan
stimme: thorsten
sprechtempo: 1.0
musik: beat
stories: ja
higgsfield: ja
higgsfield_pro_tag: 2
higgsfield_credits_pro_tag: 60
higgsfield_reserve: 100
higgsfield_ugc_pro_woche: 1
higgsfield_rotation: "Mo/Mi/Fr/So H01 · Di/Sa M01 · Do U01"
tagesziel:
  instagram: "3 Reels + 1 Karussell + 4 Stories"
  tiktok: "3 Videos + 1 Fotobeitrag"
  facebook: "3 Reels + 1 Post + 4 Stories (Zweitverwertung, nur wenn verbunden)"
  linkedin: "1 Post Mo/Mi/Fr (Autolist)"
  gmb: "1 Beitrag Mo/Mi/Fr (Autolist, zusammen mit LinkedIn 11:05)"
updated: 2026-10-26
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
Metricool-Autolist (beide zusammen Mo/Mi/Fr um 11:05, siehe [[Pläne/Content-Kalender]]); die Spalten LinkedIn/Google oben sind
die alten Slots für eigene Beiträge – das System plant dort nur bei Produkt- und Angebotsnews zusätzlich.

## Formate (Rotation)
Reels im Wechsel: **T01** Vorher/Nachher · **T02** Tippe & entscheide · **T03** Drei Fehler · **T04** Welches Poster bist du ·
**T07** Zoom ins Motiv · **T08** Satz des Tages. Mit Higgsfield (nur `higgsfield: ja` und verbundenes Konto) bekommt der Hero-Slot
am Abend eines der KI-Formate nach `higgsfield_rotation`: **H01** Higgsfield-Raum (Kamerafahrt durch den Raum mit dem echten Poster,
≈ 7,5 Credits) · **M01** Motion-Produktfilm (Hyper-Motion: Licht, Makro, Material, 40–60 Credits) · **U01** UGC-Reel (KI-Darsteller
zeigt das Poster, deutsch, ≈ 100 Credits, höchstens einmal je Woche). Karussell/Fotobeitrag: **R-karussell** (6 Slides); mit
**P01** Produktfoto liefert Higgsfield Lifestyle-Bilder fürs Karussell (1–3 Credits je Bild). Pro Tag kein Format doppelt,
pro Woche jedes Format höchstens zweimal je Netzwerk. Motive rotieren durch die Themen aus `Marke/Produkte.md`
(Motivation, Racing, Wildlife, Fußball, …) – kein Motiv zweimal in 7 Tagen.

## Higgsfield (KI-Bild und -Video)
- `higgsfield: ja|nein` schaltet die KI-Formate an oder aus. Bremsen: `higgsfield_pro_tag` (Clips je Tag), `higgsfield_credits_pro_tag`
  (Credits je Tag), `higgsfield_reserve` (darunter wird nichts erzeugt), `higgsfield_ugc_pro_woche` (teure UGC-Reels). Guthaben zeigt
  die Zentrale („Higgsfield-Guthaben“); Richtwerte: Raumclip 7,5 · Motion 40–60 · UGC ≈ 100 · Produktfoto 1–3.
- `higgsfield_rotation` legt fest, welches KI-Format der Hero-Slot an welchem Wochentag bekommt. Modelle: Kling 4.0 (Raum),
  Marketing-Studio-Presets (Motion), Seedance 2.5 (UGC), Nano Banana Pro (Produktfoto); Sora oder Veo nur, wenn du es unter Notizen freigibst.
- Der KI-Anteil ist Raum, Licht, Bewegung oder ein erfundener erwachsener Darsteller – das Poster bleibt exakt das Produktbild.
  Keine echten Personen, keine Texte, Logos oder Marken im Clip. Der Darsteller ist Moderator, nie „Kunde“: keine erfundenen
  Erfahrungen, keine Bewertungen. Jeder KI-Post wird gekennzeichnet (`isAiGenerated`, bei UGC zusätzlich „Darsteller: KI“ in der Caption).
- Anmelden: `claude mcp login higgsfield` im Repo-Ordner (die Karte „Higgsfield anmelden“ hakt sich danach selbst ab).
  Alle Regeln und Werkzeuge: `stations/produktion/higgsfield.md`, Formate `stations/produktion/formate/{H01,M01,U01}.md`.

## Regeln, die immer gelten
- Hook in Bild 0 lesbar, kein „!“, keine Marken- oder Personennamen im Bild, Domain nur auf der Endcard.
- Preis nur, wenn der Auftrag es sagt, und nur aus `Marke/Produkte.md` (TikTok: nie ein Preis in der Caption).
- Jeder Post geht durch `gate.js` (Texte, Hashtags, Längen) und `posts.js check` (Dubletten). Fällt eines durch, bleibt es Entwurf.
- Stories (`stories: ja`): zu jedem Reel das Cover, zum Karussell `story.png` (Slide 1 in 9:16), ohne Text, 30 Minuten nach dem
  Beitrag, nie nach 22:00. Der Dubletten-Schutz prüft Stories nur über die Datei (gleiches Bild = Dublette).
- Alle Dateien liegen unter `Assets/content/<task-id>/`. Vorschau der letzten Produktionen zeigt die Welt (Bereich „Produktion“).

## Notizen von Julius
(hier kannst du Motive, Sätze oder Wünsche für die nächsten Tage notieren – der Planer liest sie)
