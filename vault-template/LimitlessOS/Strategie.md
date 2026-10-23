---
type: strategie
reserve_for_julius: 30
week_reset: "Thu 18:00"
daily_post_limit: 3
daily_shop_change_limit: 5
max_open_tasks: 15
autopilot:
  planer: 2
  content: 2
  shop-analyst: 1
  studio: 2
  reviewer: 2
  berichter: 2
updated: 2026-10-23
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
| 11 | 14 Tage Content ohne Bestellung | manual: Testbestellung durch den Checkout + Blick in Shopify-Analytics (Sitzungen, Warenkorb); planer: Produktseiten-Check-Aufgabe für das Shop-Büro | 14 Tage |
| 12 | Sonst | berichter: Qualitäts-Check alter Posts; Archiv-Pflege | täglich |

## Grenzen
- Höchstens **3 Posts pro Tag**, höchstens **5 Shop-Änderungen pro Tag**, höchstens **15 offene Aufgaben**.
- Nach außen (Posts, Shop) nur mit Freigabe, solange die Station auf Autopilot 1 steht.
- Nachts (00–07 Uhr) keine Premium-Aufgaben (Opus) – die sind für Tagesplanung und Wochenstrategie.
- 30 % des Kontingents bleiben für Julius' eigene Arbeit frei (`reserve_for_julius`).

## Autopilot-Stufen
0 = nur Entwürfe · 1 = veröffentlichen/ändern nach deiner Freigabe · 2 = vollautomatisch.
Empfehlung: `content` nach zwei Wochen sauberer Freigaben auf 2 stellen (Frontmatter oben ändern,
der Planer liest es beim nächsten Lauf).

## Checkliste (einmalige Aufgaben – abhaken, wenn erledigt)
- [ ] Claude-Login (claude.ai-Konto) auf dem PC
- [ ] Metricool-MCP angemeldet (`claude` → `/mcp` → metricool)
- [ ] Shopify-MCP angemeldet (`claude` → `/mcp` → shopify)
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
