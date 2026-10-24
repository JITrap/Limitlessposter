# Betrieb – so steuerst du Limitless OS

## Wo du hinschaust
- **Die Welt** `http://localhost:4242` – oben die **Zentrale** (alle Zahlen aus Shopify, Metricool und
  Printify auf einer Seite, Links zu allen Werkzeugen), darunter wer gerade was macht, Budget,
  Wartet-auf-dich, Not-Aus.
- **Obsidian** `LimitlessOS/Home.md` – Status, Kanban, Heute. `Status.md` wird jede Minute neu geschrieben.
- **Berichte** `LimitlessOS/Berichte/` – täglich 07:30, wöchentlich Donnerstag 17:00.

## Die Zentrale
Die Station **Zentrale** (`kennzahlen`, Haiku, alle 6 Stunden) holt Follower, Reichweite,
Interaktionen und geplante Posts je Netzwerk aus Metricool, Bestellungen und Umsatz aus Shopify,
und schreibt alles nach `Kennzahlen.md`. Der Aufseher liest zusätzlich stündlich Printify
(Aufträge, Produktionskosten, Marge) direkt über den Token in der `.env` (`PRINTIFY_API_TOKEN`).
Die Welt zeigt beides als Kacheln und Tabelle; Status.md bekommt den Abschnitt „Zentrale“.
Sofort aktualisieren: Knopf **Kennzahlen aktualisieren** in der Welt. Kosten: ein Haiku-Lauf,
meist unter 0,10 $.

## Freigeben und zurückschicken
- Freigeben: in der Welt **Freigeben** klicken oder in der Notiz `needs_approval: false` setzen. Beim
  nächsten Lauf wird veröffentlicht bzw. im Shop geändert.
- Zurückschicken: Kanban-Karte von **review** nach **todo** ziehen (oder `status: todo` setzen) und
  `needs_approval: true` lassen – am besten mit einem Absatz „Korrektur: …“ unter `## Auftrag`. Die
  Aufgabe wird neu als Entwurf bearbeitet und landet wieder unter „Wartet auf dich“.
  Ein Drag nach **todo** ist also nie eine Freigabe.
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
in `requires.env` eintragen – bis er in der `.env` steht, bleibt sie grau. Gibt es mehrere Wege
(MCP-Login **oder** Schlüssel), stehen sie unter `requires.any` – einer reicht.

## Aufseher starten, stoppen, Logs
- Start: Aufgabenplanung → `LimitlessOS` → Ausführen, oder `npm start` im Repo.
- Stopp: Aufgabenplanung → Beenden, oder `Stop-ScheduledTask LimitlessOS`.
- Logs: `supervisor\data\logs\YYYY-MM-DD.log`; Rohdaten jedes Laufs: `supervisor\data\runs\`.
- Gesundheitscheck: `scripts\doctor.ps1` (`-Smoke` für einen echten Mini-Lauf).

## Wenn der Status rot ist
`Status.md` oben nennt den Grund. Häufig:
- „Nicht mit dem Claude-Abo angemeldet“ → `claude auth login` (claude.ai-Konto wählen).
- „ANTHROPIC_API_KEY ist gesetzt“ → Variable entfernen (sonst zahlst du API statt Abo).
- „Repo-Ordner nicht vertrauenswürdig“ → `install.ps1` erneut ausführen.
- „MCP-Server metricool …“ oder „MCP-Server shopify …“ → `claude mcp login metricool` bzw. `claude mcp login shopify`.
- „Shop-Büro ⛔ … (eine Anbindung reicht)“ → entweder Shopify-MCP anmelden (Weg A) oder Schlüssel in die `.env` (Weg B),
  siehe `docs/anleitung/shopify-app.md`.

## Was das System nie tut
Preise, Rabatte, neue Produkte, Zahlungen, Kundenantworten, Konten anlegen. Dafür legt es dir
Karten auf den Schreibtisch (Station **manual**).

## Dubletten-Schutz (nie wieder ein doppelter Post)

Seit dem 24.10.2026 gibt es genau einen Weg, einen Beitrag einzuplanen: `node supervisor/dist/adapters/metricool.js schedule --file post.json`.
Der Befehl prüft erst die **Veröffentlichungs-Liste** (`Pläne/Veröffentlicht.md`: jeder Post, der je rausging oder eingeplant ist, mit
Text-Schlüssel, Mediendateien und Link), dann das **Tageslimit des Netzwerks** (`Strategie.md` → `daily_post_limits`), und erst dann plant er
über die Metricool-API und trägt den Post in die Liste ein. Die direkten Metricool-Planungswerkzeuge (`createScheduledPost`,
`updateScheduledPost`) sind für alle Arbeiter gesperrt – auch, wenn ein Prompt etwas anderes behauptet.

Was als Dublette gilt (gleiches Netzwerk, 120 Tage): gleicher Text ohne Hashtags/Links/Emojis, gleicher Anfang (der kürzere Text ist der
Anfang des längeren), sehr ähnlicher Wortschatz, oder dieselbe Mediendatei. Prüfen kannst du selbst:
`node supervisor/dist/adapters/posts.js check --network instagram --text "…"` (Exit 0 frei, 2 Dublette, 3 Tageslimit).

Die Zentrale (Station `kennzahlen`) gleicht die Liste alle 6 Stunden mit Metricool ab. Ist sie älter als 12 Stunden, arbeitet die
Content-Station nur als Entwurf, und der Aufseher stößt den Abgleich an. Voraussetzung fürs automatische Posten: `METRICOOL_API_KEY`
und `METRICOOL_USER_ID` in der `.env` (Metricool → Einstellungen → API). Ohne Key entstehen nur Entwürfe.

Zähler je Netzwerk stehen in der Welt (Wandtafel) und in `Status.md` unter „Heute“.

## Update mit einem Befehl

Einmalig einen Klon anlegen (PowerShell): `git clone https://github.com/JITrap/Limitlessposter.git "$env:TEMP\limitlessos-git"`.
Danach jedes Update so:

```
git -C "$env:TEMP\limitlessos-git" pull; & "$env:TEMP\limitlessos-git\scripts\update.ps1"
```

`update.ps1` kopiert den neuen Stand in den Installationsordner (`.env`, `limitless.config.json`, `supervisor\data` bleiben),
baut Aufseher und Stationen, ersetzt im Vault nur die System-Notizen (Home, Dashboard, Strategie, Marke-Notizen außer
Produkte, Content-Bank, Produktion – mit Sicherung unter `%TEMP%\limitlessos-vault-backup-<Zeit>`), ergänzt fehlende Dateien
und startet die geplante Aufgabe „LimitlessOS“ neu. Nie angefasst: Status.md, Kennzahlen.md, Pläne\Veröffentlicht.md,
Marke\Produkte.md, Kalender, Wochenplan, Aufgaben, Berichte, Assets\content. Parameter: `-Target <Ordner>`, `-NoRestart`,
`-NoVault`, `-NoPull`.
