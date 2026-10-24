# Betrieb – so steuerst du Limitless OS

## Wo du hinschaust
- **Die Welt** `http://localhost:4242` – oben die **Zentrale** (alle Zahlen aus Shopify, Metricool und
  Printify auf einer Seite, Links zu allen Werkzeugen), darunter wer gerade was macht, Budget,
  Wartet-auf-dich, Not-Aus.
- **Obsidian** `LimitlessOS/Home.md` – Status, Kanban, Heute. `Status.md` wird jede Minute neu geschrieben.
- **Berichte** `LimitlessOS/Berichte/` – täglich 07:30, wöchentlich Donnerstag 17:00.

## Die Welt
`http://localhost:4242`, auch im Rahmen oben in `Home.md`. Die Seite hängt am Aufseher (SSE) und
aktualisiert sich bei jedem Tick von selbst – nichts muss neu geladen werden. Von oben nach unten:

- **Ampel** (Kopfzeile): läuft die Fabrik oder steht sie – mit Grund („keine Aufgaben“, „Budget-Pause“,
  „Stationen nicht verbunden: …“), Zahl der Arbeiter, Stand der Veröffentlichungs-Liste
  (aktuell/veraltet), Budget-Modus, Pause, rote Vorab-Prüfung.
- **Zentrale**: Shop, Social und Printify als Kacheln, Knopf **Kennzahlen aktualisieren**.
- **Kalender**: 3 Tage zurück, 7 Tage voraus. Je Tag die Beiträge aus `Pläne/Veröffentlicht.md` mit
  Netzwerk, Uhrzeit, Status (geplant / veröffentlicht / entwurf / storniert) und Link zu Metricool
  bzw. zum Beitrag; darüber die Tageszähler je Netzwerk gegen das Limit aus `Strategie.md`.
- **Büro**: wer gerade woran arbeitet (Station, Modell, seit wann, Tokens).
- **Wartet auf dich**: Karten mit Knopf **Freigeben**.
- **Produktion**: Galerie aller Dateien unter `Assets/content/` – neueste zuerst, nach Aufgabe
  gruppiert. Bilder und Slides als Vorschau, Clips und Stimmproben direkt abspielbar. Dahinter steht
  die Route `/media/`, die ausschließlich den Ordner `Assets/` ausliefert – nie Notizen, nie `.env`.
- **Fabrik** (rechte Spalte): Zustand, Grund, letzter Planer-Anstoß, die nächsten Auslöser
  (Kennzahlen alle 6 h, Tagesbericht 07:30, Tagesproduktion 05:30, Wochenbericht, Wochenstrategie,
  Planer) und der Knopf **Planer jetzt** – legt sofort eine Planer-Aufgabe an, außer eine läuft schon.
- **Wandtafel**: Budget, Stationen, Tageszähler.
- **Stimme**: ob die eigene Sprachausgabe installiert ist (Chatterbox auf der Grafikkarte oder Piper
  auf der CPU), welche Stimmen es gibt, letzte Probe zum Anhören. Nicht installiert → Hinweis auf
  `tools\stimme\install.ps1`. Quelle ist `supervisor/data/stimme.json`, geschrieben vom Stimm-Adapter.
- **Veröffentlicht – zuletzt**: die letzten 10 Beiträge aus dem Kalender.
- **Ticker**: die letzten Ereignisse des Aufsehers.

**Die Fabrik steht nie lange still.** Ist nichts startbar und arbeitet niemand, legt der Aufseher
spätestens alle 30 Minuten eine Planer-Aufgabe an („Planung: Fabrik leer – Warteschlange füllen“).
Sie plant zuerst die Tagesproduktion laut `Strategie.md` (`daily_targets`, `daily_post_limits`) und
`Pläne/Produktion.md`, dann die Wertleiter. Um 05:30 plant der Planer außerdem die Produktion für den
nächsten Tag – nur, wenn die Station `produktion` geladen ist; sonst steht ein Hinweis im Ticker.
In der Budget-Pause und bei gesetzter `PAUSE`-Datei passiert beides nicht. Als Text steht all das in
`Status.md` unter „Fabrik“, „Kalender (7 Tage)“ und „Produktion“.

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
