---
type: task
id: 20261023-020600-shop-12-englische-produkte-eindeutschen
title: "Shop: 12 englische Printify-Produkte – deutsche Titel und Beschreibungen"
status: todo
station: shop-analyst
priority: 2
tier: standard
due: 2026-10-28
created: 2026-10-23T02:00:00
updated: 2026-10-23T02:00:00
started:
completed:
attempts: 0
max_attempts: 3
cost_usd: 0
tokens_in: 0
tokens_out: 0
model_used:
outputs: []
needs_approval: true
origin: system
parent: 
published_at:
tags: [task]
---
## Auftrag
Die 12 Produkte vom 19.10.2026 (Vendor Printify) haben englische Titel und englische Beschreibungen.
Schreibe für jedes einen deutschen Titel (Muster der übrigen 113 Produkte: „Motiv – Stil-Poster“, ≤ 70 Zeichen,
**ohne Namen von Personen, Vereinen, Marken, Figuren** – siehe [[Marke/Kern#Tabus]]) und eine deutsche
Beschreibung im HTML-Aufbau der bestehenden Produkte (Einleitungssatz mit Stimmung → „Qualität & Details“-Liste →
„Versand & Garantie“ → GPSR-Block unverändert übernehmen; Produktfakten nur aus [[Marke/Produkte#Feste Produktfakten]]).

Produkte (GID · aktueller Titel):
- `gid://shopify/Product/10978555527501` Glamorous High Heel Legs Vertical Framed Poster
- `gid://shopify/Product/10978533146957` High Heel Fashion Shoe Collage Vertical Framed Poster
- `gid://shopify/Product/10978525315405` Vintage Porsche Garage Framed Poster
- `gid://shopify/Product/10978521448781` Vintage Black and White Jazz Lounge Framed Poster
- `gid://shopify/Product/10978516861261` Pink Star Portrait Vertical Framed Poster
- `gid://shopify/Product/10978513387853` Black and White Pop Culture Trio Horizontal Framed Poster
- `gid://shopify/Product/10978503033165` Black and White Vintage Camera Photography Framed Poster
- `gid://shopify/Product/10978483929421` Black and White Fashion Photography Framed Poster
- `gid://shopify/Product/10978316452173` Stay Hot and Swag Framed Poster
- `gid://shopify/Product/10978313437517` Framed Leopard Wall Art Poster
- `gid://shopify/Product/10978304524621` Believe Stephen Curry Basketball Framed Poster
- `gid://shopify/Product/10978303082829` Framed Soccer Legend Poster

Vorgehen: Für jedes Produkt die aktuelle Beschreibung lesen (Shopify-MCP `get-product` oder Adapter), dann Vorschlag
ins Ergebnis. **Freigabe nötig: ja** – nichts ändern, alles als Vorschlag. Nach Freigabe (Julius setzt
`needs_approval: false`) im zweiten Lauf höchstens 5 Produkte pro Tag ändern (Tageslimit), Rest am Folgetag;
in [[Marke/Produkte]] Spalte „Titel optimiert?“ = ✅ Datum und „Sprache“ = DE setzen.

## Kontext
[[Marke/Produkte]] (Spalte „Sprache“ = EN) · [[Marke/Tonalität]] · [[Marke/Kern]]. Die Bilder dieser 12 Produkte sind
bereits gerahmte Mockups (Spalte „Bild-Typ“).

## Ergebnis

## Protokoll

## Offene Fragen an Julius
