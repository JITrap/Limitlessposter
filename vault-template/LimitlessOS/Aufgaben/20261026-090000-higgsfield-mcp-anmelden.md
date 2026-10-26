---
type: task
id: 20261026-090000-higgsfield-mcp-anmelden
title: "Higgsfield anmelden (KI-Video für die Abend-Reels, 2 Minuten)"
status: todo
station: manual
priority: 2
tier: cheap
due: 2026-10-28
created: 2026-10-26T09:00:00
updated: 2026-10-26T09:00:00
started:
completed:
attempts: 0
max_attempts: 3
cost_usd: 0
tokens_in: 0
tokens_out: 0
model_used:
outputs: []
needs_approval: false
origin: system
parent: 
published_at:
tags: [task]
auto_done: mcp:higgsfield
---
## Auftrag
Du hast Higgsfield als Konnektor bei Claude verbunden. Damit auch die Arbeiter auf deinem PC damit Clips bauen können,
braucht es einmal den Login im Repo-Ordner (der Server steht schon in `.mcp.json`):
1. PowerShell in `C:\Users\juliu\limitlessposter` öffnen.
2. `claude mcp login higgsfield` → Browser: mit deinem Higgsfield-Konto anmelden, Zugriff bestätigen.
3. `claude mcp list` zeigt `higgsfield … ✔ Connected`.

Danach baut die Produktion das Abend-Reel als **H01 Higgsfield-Raum** (KI-Kamerafahrt durch den Raum, dein echtes Poster an der
Wand), höchstens `higgsfield_pro_tag` Clips am Tag (Standard 2, in [[Pläne/Produktion]]). Jede Erzeugung kostet Higgsfield-Guthaben.
Willst du das nicht: in [[Pläne/Produktion]] `higgsfield: nein` setzen und diese Karte mit **Erledigt** schließen.

## Kontext
Der Aufseher hakt die Karte selbst ab, sobald `claude mcp list` Higgsfield als verbunden meldet (Prüfung alle 10 Minuten).
Format und Regeln: `stations/produktion/formate/H01.md` · [[Pläne/Produktion#Higgsfield (KI-Video)]] · `docs/anleitung/higgsfield.md`

## Ergebnis

## Protokoll

## Offene Fragen an Julius
