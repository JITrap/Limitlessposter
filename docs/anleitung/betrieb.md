# Betrieb – so steuerst du Limitless OS

## Wo du hinschaust
- **Die Welt** `http://localhost:4242` – wer gerade was macht, Budget, Wartet-auf-dich, Not-Aus.
- **Obsidian** `LimitlessOS/Home.md` – Status, Kanban, Heute. `Status.md` wird jede Minute neu geschrieben.
- **Berichte** `LimitlessOS/Berichte/` – täglich 07:30, wöchentlich Donnerstag 17:00.

## Freigeben und zurückschicken
- Freigeben: Kanban-Karte von **review** nach **todo** ziehen, in der Welt **Freigeben**, oder in der
  Notiz `needs_approval: false` setzen.
- Zurückschicken: in der Notiz unter `## Auftrag` einen Absatz „Korrektur: …“ anfügen, `status: todo`,
  `needs_approval: true` lassen.
- Abbrechen: `status: cancelled` (nur du darfst das).

## Pause / Not-Aus
Datei `LimitlessOS/PAUSE` anlegen (Inhalt egal) oder in der Welt **Pause** klicken. Laufende Arbeiter
machen fertig, neue starten nicht. Datei löschen oder **Weiter** klicken hebt die Pause auf.

## Autopilot ändern
`Strategie.md`, Frontmatter `autopilot:` – 0 Entwürfe, 1 nach Freigabe, 2 vollautomatisch.
Grenzen daneben: `daily_post_limit`, `daily_shop_change_limit`, `max_open_tasks`, `reserve_for_julius`.
Die technischen Grenzen des Aufsehers stehen in `limitless.config.json` (gleiche Namen in camelCase);
nach Änderungen dort den Aufseher neu starten.

## Budget
Der Aufseher misst dein Kontingent selbst (Hauptbuch `supervisor\data\ledger.jsonl`) und richtet
sich nach den offiziellen Limit-Signalen von Claude. Modus **normal** → alles; **nur günstig** →
nur Haiku-Aufgaben; **Pause** → bis zum Reset. Reset der Woche: Donnerstag 18:00. 30 % bleiben für dich frei.
Willst du mehr oder weniger: `reserveForJuliusPct` in `limitless.config.json`.

## Neue Station hinzufügen
Ordner `stations/<name>/` mit `station.yaml` und `SKILL.md` (Vorlage: eine bestehende Station),
dann `npm run build:stations` und den Aufseher neu starten. Braucht die Station einen Schlüssel,
in `requires.env` eintragen – bis er in der `.env` steht, bleibt sie grau.

## Aufseher starten, stoppen, Logs
- Start: Aufgabenplanung → `LimitlessOS` → Ausführen, oder `npm start` im Repo.
- Stopp: Aufgabenplanung → Beenden, oder `Stop-ScheduledTask LimitlessOS`.
- Logs: `supervisor\data\logs\YYYY-MM-DD.log`; Rohdaten jedes Laufs: `supervisor\data\runs\`.
- Gesundheitscheck: `scripts\doctor.ps1` (`-Smoke` für einen echten Mini-Lauf).

## Wenn der Status rot ist
`Status.md` oben nennt den Grund. Häufig:
- „Nicht mit dem Claude-Abo angemeldet“ → `claude` starten, einloggen.
- „ANTHROPIC_API_KEY ist gesetzt“ → Variable entfernen (sonst zahlst du API statt Abo).
- „Repo-Ordner nicht vertrauenswürdig“ → `install.ps1` erneut ausführen.
- „MCP-Server metricool …“ → `claude` → `/mcp` → neu anmelden.

## Was das System nie tut
Preise, Rabatte, neue Produkte, Zahlungen, Kundenantworten, Konten anlegen. Dafür legt es dir
Karten auf den Schreibtisch (Station **manual**).
