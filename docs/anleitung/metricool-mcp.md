# Metricool verbinden (MCP, kostenlos auf jedem Plan)

Limitless OS plant Posts über den **offiziellen Metricool-MCP-Server**
(`https://ai.metricool.com/mcp`). Er läuft auf jedem Metricool-Plan und braucht keinen API-Schlüssel –
nur einen Login im Browser. Der Server steht bereits in der Datei `.mcp.json` des Repos.

## Einmalig anmelden
1. PowerShell im Repo-Ordner öffnen: `claude mcp login metricool` (macht `install.ps1` bereits für dich).
2. Im Browser bei Metricool anmelden.
3. `claude mcp list` zeigt `metricool … ✔ Connected`. (Ältere Claude-Version: `claude` → `/mcp` → `metricool` → Authenticate.)

Die Anmeldung wird lokal gespeichert; die Hintergrund-Arbeiter nutzen sie automatisch.
Läuft sie ab, erscheint in der Welt und in `Status.md` ein MCP-Fehler – dann Schritt 1–3 wiederholen.

## Was das System dort tut
- `getBrandSettings` – Marke, Zeitzone, verbundene Netzwerke (steht in `Marke/Kanäle.md`)
- `getBestTimeToPostByNetwork` – beste Uhrzeit je Netzwerk
- `createScheduledPost` – Posts planen (nur nach Freigabe bzw. Autopilot 2)
- `getScheduledPosts`, `getAnalyticsDataByMetrics` – Kalender und Kennzahlen für Planer und Berichte

## Medien
Metricool braucht **öffentliche Links** für Bilder und Videos. Limitless OS lädt die Dateien aus dem
Studio dafür auf dein Shopify-CDN hoch (`upload-file`, braucht Weg B aus `shopify-app.md`). Solange
das nicht eingerichtet ist, plant das System den Post mit `autoPublish: false` – Metricool schickt dir
eine Push-Nachricht in die App, und du hängst die Datei aus `Assets/content/<aufgabe>/` selbst an.

## Autolist
In deinem Konto läuft die Autolist „Poster-Evergreen LinkedIn + Google“ (alle 2–3 Tage, 11:05 Uhr).
Das System kennt diese Termine (`Pläne/Content-Kalender.md`) und plant an diesen Tagen keine
zusätzlichen LinkedIn- oder Google-Posts.

## Pinterest
Noch nicht verbunden. Für Poster ist Pinterest der wichtigste Suchkanal. Die Schritt-für-Schritt-Karte
liegt nach der Installation unter **Wartet auf dich** (`Aufgaben/…-pinterest-business-konto-verbinden.md`).
Danach die Checkliste in `Strategie.md` abhaken; der Planer legt dann Pin-Aufgaben an (Phase 2).

## Optional: REST-API (nur Advanced-Plan)
Falls dein Plan die API enthält (Konto → API): Token, User-ID und Blog-ID in die `.env`
(`METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`). Phase 1 braucht das nicht.
