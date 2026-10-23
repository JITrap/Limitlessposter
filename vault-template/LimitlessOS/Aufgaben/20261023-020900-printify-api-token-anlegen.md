---
type: task
id: 20261023-020900-printify-api-token-anlegen
title: "Printify-API-Token anlegen (für die Zentrale)"
status: todo
station: manual
priority: 2
tier: cheap
due: 2026-10-26
created: 2026-10-23T02:09:00
updated: 2026-10-23T02:09:00
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
Die Zentrale in der Welt zeigt Aufträge, Produktionskosten und Marge aus Printify. Dafür braucht sie einen
Lese-Token (Printify hat keinen Login-Weg wie Shopify, nur Tokens):
1. https://printify.com → oben rechts **Mein Profil** → **Connections** → Abschnitt **Personal Access Tokens**.
2. **Generate** → Name `Limitless OS` → Zugriff: nur Lesen (shops.read, orders.read, products.read reicht) → Token kopieren.
3. Im Repo-Ordner die Datei `C:\Users\<du>\limitlessposter\.env` mit Notepad öffnen und in der Zeile
   `PRINTIFY_API_TOKEN=` den Token hinter das Gleichheitszeichen einfügen. Speichern.
4. Aufseher neu starten: PowerShell → `Stop-ScheduledTask LimitlessOS; Start-ScheduledTask LimitlessOS`.
Ab dann liest die Zentrale Printify stündlich. Fertig → hier `status: done`.

## Kontext
Der Token steht nur in der `.env` (die wird nie ins Repo geladen). Nie in Notizen, Chats oder Aufgaben kopieren.
Die Arbeiter bekommen ihn nicht zu sehen; nur der Aufseher und der Adapter `supervisor/dist/adapters/printify.js`.

## Ergebnis

## Protokoll

## Offene Fragen an Julius
