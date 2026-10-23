---
type: task
id: 20261023-020000-logins-claude-metricool-shopify
title: "Einmalig anmelden: Claude, Metricool, Shopify (5 Minuten)"
status: todo
station: manual
priority: 1
tier: cheap
due: 2026-10-24
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
needs_approval: false
origin: system
parent: 
published_at:
tags: [task]
---
## Auftrag
Drei Logins im Browser, danach arbeitet das System ohne Schlüssel-Gefummel. `install.ps1` hat sie schon
versucht – diese Karte ist für den Fall, dass einer übersprungen wurde oder abläuft.
PowerShell im Repo-Ordner (`C:\Users\<du>\limitlessposter`) öffnen, dann:
1. `claude auth login` → Browser: **claude.ai-Konto** wählen (Max-Abo), nicht „API key“.
2. `claude mcp login metricool` → Browser: bei Metricool anmelden.
3. `claude mcp login shopify` → Browser: mit dem Shopify-Konto anmelden, dem `limitlessposter.com` gehört, Zugriff bestätigen.
4. `claude mcp list` zeigt für beide „✔ Connected“.
   (Alte Claude-Version ohne `mcp login`? Dann `claude` starten, `/mcp`, Server wählen, Authenticate, `/exit`.)
5. Prüfen: `powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1` – alles grün?

Fertig? In dieser Notiz `status: done` setzen (oder die Karte in der Welt abhaken). Die Stationen
**Content-Studio** und **Shop-Büro** werden beim nächsten Durchlauf grün.

## Kontext
Ohne diese Logins kann das System weder posten (Metricool) noch Produkte lesen/ändern (Shopify).
Die Anmeldungen werden lokal auf deinem PC gespeichert; läuft eine ab, erscheint in `Status.md` ein
MCP-Fehler – dann einfach Schritt 1–4 wiederholen. [[Strategie#Checkliste (einmalige Aufgaben – abhaken, wenn erledigt)]]

## Ergebnis

## Protokoll

## Offene Fragen an Julius
