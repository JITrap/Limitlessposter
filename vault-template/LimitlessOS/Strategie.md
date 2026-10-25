---
type: strategie
reserve_for_julius: 30
week_reset: "Thu 18:00"
daily_post_limit: 3
daily_shop_change_limit: 5
daily_post_limits:
  instagram: 8
  tiktok: 4
  facebook: 8
  linkedin: 1
  gmb: 1
  pinterest: 5
  youtube: 3
daily_targets:
  instagram: "3 Reels + 1 Karussell + 4 Stories"
  tiktok: "3 Videos + 1 Fotobeitrag"
  facebook: "3 Reels + 1 Post + 4 Stories (Zweitverwertung von Instagram; nur wenn in Metricool verbunden)"
  linkedin: "1 Post Mo/Mi/Fr (Autolist)"
  gmb: "1 Beitrag Di/Do/Sa (Autolist)"
max_open_tasks: 40
reserve_wachstum: 6
autopilot:
  planer: 2
  content: 2
  shop-analyst: 1
  studio: 2
  reviewer: 2
  berichter: 2
  produktion: 2
updated: 2026-10-25
---
# Strategie – Limitless Poster

## Ziel
**Reichweite aufbauen → Verkäufe steigern.** Die Marke ist neu: 125 gerahmte Poster im Shop
(Shopify Basic), **0 Bestellungen**, Instagram ~10 und TikTok 6 Follower (Stand 23.10.2026). TikTok-Videos
erreichen schon jetzt ein Vielfaches der Instagram-Bilder. In den nächsten 8 Wochen zählt: täglich ein
Reel, Karussells statt Einzelbilder, Pinterest als Suchkanal anbinden, die Produktseiten verkaufsfertig
machen (12 englische Importe eindeutschen) und vor Weihnachten das Thema „Geschenk für ihn“ besetzen.
Alles, was das System tut, wird daran gemessen – Erfolgsmaß bis Ende November: erste Bestellung.

## Wertleiter
Der Planer arbeitet diese Tabelle von oben nach unten ab. Du kannst Zeilen umsortieren,
ändern oder löschen – das System liest sie bei jedem Planungslauf neu.

| # | Bedingung | Aktion (erzeugte Aufgaben) | Abkühlzeit |
|---|---|---|---|
| 0 | Jeden Tag ab 05:30, um 12:00 und 18:00 (Lückenfüller) und sobald die Warteschlange leer ist | **Tagesproduktion**: je Netzwerk die Soll-Menge aus `daily_targets` – zuerst morgen, dann die weiteren Tage bis 7 Tage voraus (die Welt zeigt je Tag Ist/Soll) – als `produktion`-Aufgaben (Format-Rotation und Slots laut [[Pläne/Produktion]]), dazu je Produktion eine `content`-Aufgabe, die am Slot über den geprüften Metricool-Weg plant (Stories und Facebook-Zweitverwertung inklusive) | täglich |
| 1 | Content-Kalender < 7 Tage voraus | **zuerst Karten aus [[Pläne/Content-Bank]] in Tagesreihenfolge** (Reel pro Tag, Slideshow/Post an ihren Tagen; Captions unverändert); erst wenn die Bank leer ist: je Tag 1 Reel oder Karussell (Mix 60/40), nie Einzelbild; Studio-Aufgabe nur, wenn Material fehlt | – |
| 2 | `Marke/Produkte.md` älter als 3 Tage | shop-analyst: Shop-Snapshot (Bestseller, Lager, neue Produkte) | 3 Tage |
| 3 | Produkte mit Spalte „Sprache“ = EN oder „Titel optimiert?“ leer | shop-analyst: 3 Produkte überarbeiten (zuerst die englischen) | 2 Tage |
| 4 | Pinterest verbunden **und** Top-5-Produkte ohne Pins | pinterest: Pins + Board-Struktur (Phase 2) | 7 Tage |
| 5 | Pinterest **nicht** verbunden | manual: Pinterest-Business-Konto anlegen, in Metricool verbinden, Pinterest-for-Shopify-App installieren | einmalig |
| 6 | Google Merchant Center nicht bestätigt (siehe „Checkliste“) | manual: Google & YouTube-App in Shopify, Merchant Center, Free Listings aktivieren | einmalig |
| 7 | E-Mail-Flows nicht als eingerichtet markiert | email: Entwürfe Willkommen/Warenkorb/Nachkauf (Phase 2), dann manual: in Shopify Email anlegen | einmalig |
| 8 | Letzte Trend-Recherche > 7 Tage | content: 10 Post-Ideen zu Motivation-/Sport-/Setup-Trends → `Ideen/` (cheap) | 7 Tage |
| 9 | `Ideen/` hat < 10 offene Poster-Ideen | content: Ideen-Session (cheap) | 3 Tage |
| 10 | Kennzahlen zeigen ein Format mit > 1,5× Reichweite | Planer passt den Mix im Kalender an (mehr davon) | wöchentlich |
| 11 | 14 Tage Content ohne Bestellung | Karte W33 aus [[Pläne/Wachstum]] (Testbestellung durch den Checkout, Blick in Shopify-Analytics) – keine eigene Karte; planer: Produktseiten-Check-Aufgabe für das Shop-Büro (W03) | 14 Tage |
| 12 | Sonst (Kalender voll, Sprossen 1–11 ruhen) | **Wachstumskatalog** [[Pläne/Wachstum]]: das Paket mit dem höchsten Wert, dessen Abkühlzeit abgelaufen ist (höchstens 3 je Lauf) – so arbeitet die Fabrik immer an der Marke, nicht nur am Content | laut Katalog |

## Dubletten-Schutz (seit 24.10.2026, nach dem doppelten Willkommens-Post)
- Jeder Post, der je rausging oder eingeplant ist, steht in [[Pläne/Veröffentlicht]] (Text-Schlüssel, Medien, Link).
- Veröffentlicht wird **nur** über `node supervisor/dist/adapters/metricool.js schedule` – der Befehl prüft erst die Liste
  (gleicher Text, gleicher Anfang, sehr ähnlicher Text oder gleiche Datei im selben Netzwerk, 120 Tage) und das Tageslimit des
  Netzwerks, dann plant er, dann trägt er den Post ein. Die direkten Metricool-Planungswerkzeuge sind für alle Arbeiter gesperrt.
- Ist die Liste älter als 12 Stunden, arbeitet die Content-Station nur als Entwurf; die Zentrale gleicht alle 6 Stunden mit Metricool ab.
- Dafür nötig: Metricool-API-Key in der `.env` (`METRICOOL_API_KEY`, `METRICOOL_USER_ID`; Metricool → Einstellungen → API). Ohne Key: nur Entwürfe.
- Tageslimits je Netzwerk stehen oben im Frontmatter (`daily_post_limits`), Soll-Mengen unter `daily_targets` – beides darfst du ändern.

## Grenzen
- Posts pro Tag je Netzwerk laut `daily_post_limits` (Instagram 8 = 4 Beiträge + 4 Stories, TikTok 4), höchstens **5 Shop-Änderungen pro Tag**, höchstens **40 offene Aufgaben** (ein voller Produktionstag sind 16); davon bleiben `reserve_wachstum` = 6 Plätze dem Wachstumskatalog, damit er nie verhungert.
- Nach außen (Posts, Shop) nur mit Freigabe, solange die Station auf Autopilot 1 steht.
- Nachts (00–07 Uhr) keine Premium-Aufgaben (Opus) – die sind für Tagesplanung und Wochenstrategie.
- 30 % des Kontingents bleiben für Julius' eigene Arbeit frei (`reserve_for_julius`).

## Fabrik läuft immer
Die Warteschlange darf nie leer sein, solange Budget da ist: Ist keine startbare Aufgabe mehr da, stößt der Aufseher
den Planer sofort an (höchstens alle 30 Minuten), zusätzlich um 05:30 die Tagesproduktion und um 12:00/18:00 den
Lückenfüller, wenn morgen noch Beiträge zum Soll fehlen. Soll je Netz und Tag = `daily_targets` oben; die Welt zeigt im
Kalender je Tag „Ist/Soll“ und rot, wo etwas fehlt. Ist der Kalender voll, arbeitet der Planer den Wachstumskatalog
[[Pläne/Wachstum]] ab (Shop, Reichweite, Daten, Kunde, Marke, Saison). Was gerade passiert, warum niemand arbeitet und
wann der nächste Auslöser kommt, steht in der Welt unter „Fabrik“.

## Autopilot-Stufen
0 = nur Entwürfe · 1 = veröffentlichen/ändern nach deiner Freigabe · 2 = vollautomatisch.
Empfehlung: `content` nach zwei Wochen sauberer Freigaben auf 2 stellen (Frontmatter oben ändern,
der Planer liest es beim nächsten Lauf).

## Checkliste (einmalige Aufgaben – abhaken, wenn erledigt)
- [ ] Claude-Login (claude.ai-Konto) auf dem PC – die Karte „Einmalig anmelden“ hakt sich selbst ab, sobald Claude, Metricool und Shopify verbunden sind
- [ ] Metricool-API-Key + User-ID in der `.env` (Dubletten-Schutz, automatisches Posten)
- [ ] Metricool-MCP angemeldet (`claude` → `/mcp` → metricool)
- [ ] Shopify-MCP angemeldet (`claude` → `/mcp` → shopify)
- [ ] Facebook-Seite in Metricool verbunden (am 19.10. liefen noch Facebook-Posts; am 25.10. fehlt Facebook in den Brand-Einstellungen) – erst dann plant das System die Facebook-Zweitverwertung
- [x] Produktfakten in [[Marke/Produkte]] bestätigt, Fragen in [[Marke/Kern]] beantwortet (23.10.2026)
- [x] Rechtliches entschieden: alle Motive bewerben, Julius trägt das Risiko; nie „offiziell/lizenziert“ behaupten (23.10.2026)
- [ ] Pinterest-Business-Konto + in Metricool verbunden
- [ ] Pinterest-for-Shopify-App installiert (Katalog-Sync)
- [ ] Google & YouTube-App in Shopify, Merchant Center, Free Listings aktiv
- [ ] Shopify Email: Willkommen / Warenkorb / Nachkauf eingerichtet
- [ ] Instagram-Produkt-Tags über Metas Shopify-Kanal
- [x] Content-Bank (41 Karten) übernommen → [[Pläne/Content-Bank]] (23.10.2026)
- [x] Alte Automatik (Wochenplanung, PC-Produktion 06:00, Multi-Plattform-Automatik 06:45, Wochen-Review, Flows-Cockpit) abgeschaltet – Limitless OS plant und postet allein (Julius, 23.10.2026)
- [x] Printify-API-Token in der `.env` (Zentrale) (23.10.2026)
- [ ] (optional) Druckdateien in `Assets/poster/` – sonst nutzt das Studio die Shopify-Bilder

## Was Julius entscheidet
Preise, Rabatte, neue Produkte, Kooperationen, alles mit Geld oder Verträgen, Markenname und
Logo, Antworten auf Kundennachrichten. Das System legt dafür Karten auf deinen Schreibtisch
(`station: manual`), tut es aber nie selbst.

## Notizen von Julius
(Hier landet, was der Planer aus deiner Inbox als strategisch einordnet.)

## Änderungsprotokoll
- 2026-10-22 – Erstfassung aus der Spezifikation.
- 2026-10-23 – System: Ziel und Wertleiter an das echte Sortiment angepasst (125 Produkte, 0 Bestellungen, TikTok vor Instagram); Sprosse 11 „Testbestellung“ ergänzt; Checkliste um Logins und Rechtliches erweitert.
- 2026-10-23 – Julius: Produktfakten bestätigt (14 Tage Widerruf, Druck USA, Versand nur DE), Zielgruppe und Tonfall festgelegt, alle Motive freigegeben; Content-Bank mit 41 Karten als Sprosse 1 übernommen.
- 2026-10-23 – Julius: alte Automatik abgeschaltet (alles läuft über Limitless OS), Content-Bank ohne Einzelfreigabe (Autopilot content = 2, Tageslimit 3 bleibt), Printify-Token eingetragen. System: erste drei Content-Bank-Karten (p01, r01 → 24.10., s01 → 25.10.) als Aufgaben angelegt.
- 2026-10-25 – Julius: „3 Posts pro Tag auf Instagram, nicht 3 insgesamt – die alte Planung übernehmen.“ System: Soll-Mengen wie in der alten Automatik (Instagram 3 Reels + Karussell + 4 Stories, TikTok 3 Videos + Fotobeitrag, Facebook als Zweitverwertung, LinkedIn Mo/Mi/Fr, Google Di/Do/Sa), Limits angehoben (Instagram 8, Facebook 8), 40 offene Aufgaben, Lückenfüller 12:00/18:00, Kalender zeigt Ist/Soll, Wachstumskatalog als Sprosse 12.
- 2026-10-24 – System: Dubletten-Schutz nach dem doppelten Willkommens-Post (p01 und r01 waren am 12.10. schon draußen). Veröffentlichungs-Liste, Metricool-Adapter als einziger Weg zum Planen, Tageslimits je Netzwerk (Instagram 4, TikTok 4), fünf pausierte Entwürfe in Metricool.
