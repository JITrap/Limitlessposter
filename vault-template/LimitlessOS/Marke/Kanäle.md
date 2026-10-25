---
type: marke
metricool_blog_id: "7412016"
metricool_timezone: Europe/Berlin
shop_url: https://limitlessposter.com
shop_myshopify: gexdm4-2q.myshopify.com
updated: 2026-10-25
---
# Kanäle

## Metricool
- Marke: **LimitlessPoster** · `blogId` 7412016 · Zeitzone Europe/Berlin
- Verbunden (Stand 25.10.2026, `getBrandSettings`): Instagram `@limitlessposter`, TikTok `@limitless.poster`,
  LinkedIn (Profil Julius), Google-Unternehmensprofil. **Facebook: nicht verbunden** (siehe Rhythmus unten)
- **Nicht verbunden:** Pinterest – Julius hat ein Pinterest-Konto; es muss noch in Metricool verbunden
  und ggf. in ein Business-Konto umgewandelt werden (Karte liegt auf dem Schreibtisch)
- Plan: ~50 €/Monat. Kennzahlen kommen über den MCP-Server (`.mcp.json` → `metricool`). **Geplant wird nur noch
  über den Adapter** `supervisor/dist/adapters/metricool.js` (Dubletten-Schutz) – dafür müssen `METRICOOL_API_KEY`
  und `METRICOOL_USER_ID` in der `.env` stehen (Metricool → Einstellungen → API). Ohne Key entstehen nur Entwürfe.
- **Autolist aktiv:** „Poster-Evergreen LinkedIn + Google“ (id 546926) postet alle 2–3 Tage um 11:05 Uhr
  auf LinkedIn + Google-Unternehmensprofil (Termine stehen im [[Pläne/Content-Kalender]]). Das System plant
  an diesen Tagen **keine** weiteren LinkedIn/GMB-Posts, Instagram/TikTok schon.

> [!info] Ändert sich etwas (neues Netzwerk, andere Brand-ID), hier eintragen. Das Content-Studio liest diese Notiz vor jedem Post. Fehlt die ID, holt es sie mit `getBrandSettings` und trägt sie nach.

## Kennzahlen-Startpunkt (Metricool, 14.–22.10.2026)
- Instagram: ~10 Follower, mehrere Feed-Posts pro Tag (13.–20.10.), Reichweite bis ~260 Konten/Tag
- TikTok: 6 Follower, Videoaufrufe bis ~2 600/Tag an den besten Tagen
- Shop: 125 Produkte, 0 Bestellungen seit Start
- Lesart: TikTok-Videos bringen schon jetzt deutlich mehr Reichweite pro Post als Instagram-Bilder →
  Reels zuerst, Instagram als Zweitverwertung (Karussells statt Einzelbilder).

## Shop
- https://limitlessposter.com (Shopify Basic, EUR, Deutschland, Kleinunternehmer)
- myshopify-Domain: `gexdm4-2q.myshopify.com` (steht auch in `.env.example`)
- Anbindung: **Shopify-MCP** (`.mcp.json` → `shopify`, Login im Browser) – Schlüssel in der `.env` nur für
  den Datei-Upload (öffentliche Bild-Links für Metricool) nötig.
- Versand weltweit möglich, Fokus und Versandkostenfreiheit: Deutschland.

## Link in Posts
Standard-CTA: „Link im Profil“ / „Link in Bio“ (Instagram/TikTok) · in TikTok-Captions zusätzlich
„👉 limitlessposter.com“ ausgeschrieben · LinkedIn/GMB: voller Shop-Link https://limitlessposter.com.
Kein Linktree – der Profil-Link zeigt direkt auf den Shop (Julius, 23.10.2026).
Bios (aus der Content-Bank): Instagram „LimitlessPoster | Gerahmte Poster“ – „Gerahmte Poster mit Haltung 🖼️ / Für Wände, die motivieren. / 🚚 Kostenloser Versand in Deutschland / ⬇️ Zum Shop“ · TikTok „Gerahmte Poster mit Haltung 🖼️ Kostenloser Versand in Deutschland“.

## Veröffentlichungs-Rhythmus (Standard, seit 25.10.2026 wie in der alten Automatik)
Soll je Tag steht in [[Strategie]] (`daily_targets`), Slots in [[Pläne/Produktion]]:
- Instagram: 3 Reels + 1 Karussell + 4 Stories (je eine 15–45 Minuten nach dem Beitrag)
- TikTok: 3 Videos (dieselben Reels, eigene Caption, kein Preis) + 1 Fotobeitrag (das Karussell in 9:16)
- Facebook: 3 Reels + 1 Post + 4 Stories – dieselben Dateien wie Instagram mit eigenem Text und Produktlink,
  **nur solange Facebook hier als verbunden steht** (Stand 25.10.2026: nicht in den Metricool-Brand-Einstellungen,
  obwohl am 19.10. noch Facebook-Posts rausgingen – Julius prüft die Verbindung in Metricool)
- LinkedIn: Autolist Mo/Mi/Fr; zusätzlich 1×/Woche Gründer-Post, nie am Autolist-Tag
- Google-Unternehmensprofil: Autolist Di/Do/Sa; zusätzlich nur bei Produkt-/Angebotsnews

## Alte Automatik (abgeschaltet am 23.10.2026)
Vor Limitless OS lief eine eigene Kette: Wochenplanung (Cloud, Sa 17:50), Tagesproduktion (PC, 06:00),
Multi-Plattform-Automatik (Cloud, 06:45), Wochen-Review (Cloud, Mo 07:22) und Flows-Cockpit (Cloud, 07:10).
Die Produktion hing seit dem 19.10., deshalb ging seit ~20.10. nichts mehr raus. Julius hat am 23.10.2026
entschieden: **alles läuft über Limitless OS.** Die vier Cloud-Aufgaben sind deaktiviert (nicht gelöscht),
die PC-Aufgabe ebenfalls. Nur die Metricool-Autolist 546926 (LinkedIn + Google) läuft weiter.
Folgen für die Stationen: Niemand sonst postet auf Instagram/TikTok – Dubletten-Prüfung nur gegen den eigenen
[[Pläne/Content-Kalender]] und `getScheduledPosts`. Wer die alte Kette wieder braucht, sagt es Julius; sie
lässt sich mit einem Klick wieder einschalten.
