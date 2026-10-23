---
type: marke
metricool_blog_id: "7412016"
metricool_timezone: Europe/Berlin
shop_url: https://limitlessposter.com
shop_myshopify: gexdm4-2q.myshopify.com
updated: 2026-10-23
---
# Kanäle

## Metricool
- Marke: **LimitlessPoster** · `blogId` 7412016 · Zeitzone Europe/Berlin
- Verbunden (Stand 23.10.2026): Instagram `@limitlessposter`, TikTok `@limitless.poster`,
  LinkedIn (Profil Julius), Google-Unternehmensprofil
- **Nicht verbunden:** Pinterest (für Poster der wichtigste Suchkanal – Karte liegt auf deinem Schreibtisch)
- Plan: ~50 €/Monat. Der MCP-Server (`.mcp.json` → `metricool`) reicht fürs Planen und für Kennzahlen;
  REST-API-Token in der `.env` sind optional.
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
Standard-CTA: „Link im Profil“ (Instagram/TikTok) · LinkedIn/GMB: voller Shop-Link https://limitlessposter.com
> [!question] Nutzt du einen Linktree o. Ä.? Dann hier eintragen.

## Veröffentlichungs-Rhythmus (Standard)
- TikTok: 1 Reel/Tag (Prozess, Setup, Motivation-Moment), Untertitel immer
- Instagram: 1 Post/Tag – Reel (gleicher Clip, eigene Caption) oder Karussell, Story optional
- LinkedIn: Autolist läuft (alle 2–3 Tage); zusätzlich 1×/Woche Gründer-Post, nie am Autolist-Tag
- Google-Unternehmensprofil: Autolist läuft; zusätzlich nur bei Produkt-/Angebotsnews
