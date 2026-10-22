# Limitless OS – Design-Spezifikation

Stand: 2026-10-22 · Marke: **Limitless Poster** (limitlessposter.com) · Betreiber: Julius (GitHub JITrap)

## 0. Zweck in einem Absatz

Limitless OS ist ein lokales „Firmen-Betriebssystem“, das auf Julius' Windows-PC läuft, solange er an ist. KI-Arbeiter (Claude Code im Hintergrund) arbeiten an festen **Stationen** (Planung, Content, Shop, Studio, Review, Bericht …) an der Marke. Ein **Aufseher** sorgt dafür, dass immer die wertvollste Arbeit läuft, dass das Claude-Abo bis zum Wochen-Reset reicht (Donnerstag 18:00) und dass nichts Unerwünschtes nach außen geht. Der **Obsidian-Vault ist das Gehirn**: Marke, Strategie, Aufgaben, Pläne, Berichte. Eine **„Welt“-Ansicht** im Browser zeigt live, wer gerade was tut. Das System erzeugt seine Aufgaben **selbst** – Julius muss nichts nachtragen, kann aber jederzeit eingreifen, Skills „einschicken“ und Stationen hinzufügen.

Ziel der Marke in den nächsten Wochen: **Reichweite aufbauen → Verkäufe steigern.**

## 1. Rahmenbedingungen (verifiziert)

| Thema | Fakt | Folge fürs Design |
|---|---|---|
| Claude-Abo | Max 20x, Wochen-Reset **Donnerstag 18:00** (Europe/Berlin). 5-h-Fenster + Wochenfenster, modellübergreifend; **Opus und Sonnet haben zusätzlich getrennte Wochenfenster**. Keine offiziellen Zahlen. | Budget wird **gemessen und gepaced**, nicht berechnet. Modell-Routing verteilt Last über Familien. |
| Claude Code headless | `claude -p` läuft über das Abo-Login. **Kein `--bare`** (ignoriert Abo-Login). Ohne Modus startet -p in „Manual“ → Freigaben werden verweigert; deshalb `--permission-mode auto --permission-prompts none`. `stream-json` liefert `rate_limit_event` (`allowed_warning`/`rejected`, `resets_at`) und `api_retry error: rate_limit`. Ergebnis enthält `modelUsage` (inkl. Subagenten), `subtype`, `is_error`, `api_error_status`. Projektordner muss vorab vertrauenswürdig sein (`~/.claude.json` → `projects[<pfad>].hasTrustDialogAccepted`). `ANTHROPIC_API_KEY` darf nicht gesetzt sein. | Runner-Modul + Budget-Wächter bauen auf diesen Signalen. `install.ps1` setzt Vertrauen und prüft Umgebungsvariablen. |
| Windows-Autostart | Nur ein Prozess in der **interaktiven Anmeldesitzung** sieht `%USERPROFILE%\.claude\.credentials.json`. Dienste (NSSM/pm2/WinSW) laufen in Session 0 und sehen es nicht. | Aufgabenplanung „Bei Anmeldung“, „nur wenn Benutzer angemeldet“, Neustart bei Fehler. |
| Node | Node 24 LTS empfohlen (Cloud-Entwicklung hier mit 22 – Code bleibt kompatibel ≥ 22). chokidar 6 für Dateiwächter. | TypeScript, ESM, keine nativen Abhängigkeiten. |
| Obsidian | Bases (Kernplugin) liest **nur Frontmatter**, nie Checkboxen; Kanban-Ansicht seit 1.14 (05.10.2026). Externe Dateiänderungen werden erkannt. Community-Kanban-Plugin ist unbetreut. | **Eine Notiz pro Aufgabe**, Zustand im Frontmatter, Dashboard als `.base`. Keine Community-Plugins nötig. |
| Metricool | REST-API nur ab Advanced-Plan; Julius zahlt ~50 €/Monat (vermutlich Advanced → API wahrscheinlich verfügbar). **Offizieller MCP-Server** (`https://ai.metricool.com/mcp`, OAuth 2.1) funktioniert auf jedem Plan. Marke: Instagram `@limitlessposter`, TikTok `@limitless.poster`, LinkedIn, Google-Unternehmensprofil. **Pinterest nicht verbunden.** | Phase 1 über MCP. REST-API optional für direkte Skripte, falls Token vorhanden. Erste manuelle Aufgabe: Pinterest verbinden. |
| Shopify | Store `LimitlessPoster`, Basic, EUR, DE. Alter Custom-App-Token-Weg seit 01.01.2026 geschlossen. Neu: Dev Dashboard → Client-Credentials-Grant (`POST /admin/oauth/access_token`, Token 24 h cachen). GraphQL Admin API **2026-10**. Analytics auf Basic eingeschränkt → Kennzahlen aus Bestellungen ableiten. | `shopify`-Adapter mit Client-Credentials. Ohne Credentials nur Lese-Fallback über Shopify-MCP-Connector (interaktiv). |
| Higgsfield / ElevenLabs | **Keine Konten, keine Abos gewünscht.** Ersatz durch lokale Open-Source-Tools aus Julius' Stern-Liste: **ComfyUI** (Bilder/Video, GPL-3.0, HTTP-API Port 8188) und **VoiceStudio** (Stimme/Klonen/Dubbing/Transkription, AGPL-3.0, lokale API + MCP Port 3900, Modell OmniVoice ~2,3 GB, CPU möglich aber langsam). | Stationen `motion` (ComfyUI) und `voice` (VoiceStudio-MCP). Aktiv nur, wenn der jeweilige Dienst lokal erreichbar ist. Zusätzlich GPU-freie Station `studio` (HTML/CSS/Motion-Rendering → PNG/MP4). |
| Wachstumskanäle (datenbasiert) | 1) Google Merchant Center Free Listings, 2) Pinterest (157 Mio. EU-Nutzer; Wohnen Kernkategorie), 3) Shopify E-Mail-Flows (10 000 Mails/Monat gratis), 4) Reels + Karussells statt Einzelbilder (Einzelbilder Reichweite −22 %, Engagement −46 %), 5) Instagram-Produkt-Tags, später TikTok Shop, Etsy. | Bildet die Standard-**Wertleiter** des Planers. |

Bewusst **nicht** gewählt: Claude Agent SDK (Abo-Nutzung rechtlich unklar), ruflo/Claude-Flow (riesig, entwicklerzentriert, kein Budget-Pacing fürs Abo), Browser-Automatisierung von Higgsfield (AGB-Verstoß), Windows-Dienst (sieht Login nicht).

## 2. Architektur

```
┌──────────────────────── Julius' PC (Windows, angemeldet) ────────────────────────┐
│                                                                                  │
│  Obsidian-Vault/LimitlessOS/   ◄──── liest/schreibt ────►   Aufseher (Node)       │
│   Marke/ Strategie.md Aufgaben/ Pläne/ Berichte/ Inbox/      ├ Scheduler/Queue    │
│   Home.md  Dashboard.base  Status.md                         ├ Budget-Wächter     │
│        ▲                                                     ├ Runner (claude -p) │
│        │ Dashboard (Bases)                                   ├ Vault-Adapter      │
│      Julius                                                  ├ Welt-Server :4242  │
│        │ Browser                                             └ Hauptbuch/Logs     │
│        ▼                                                             │            │
│  „Die Welt“ http://localhost:4242  ◄──── SSE live ──────────────────┘            │
│                                                                                  │
│  Arbeiter = claude -p  (cwd = Repo, --add-dir Vault)                             │
│     ├ Station-Skill + Marken-Kontext                                             │
│     ├ MCP: metricool (hosted), voicestudio (lokal :3900), obsidian? (nein, FS)   │
│     └ Adapter-Skripte: shopify (GraphQL), comfyui (:8188), studio (Playwright)   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Datenfluss: `Strategie.md` + Kennzahlen → **Planer** erzeugt Aufgaben-Notizen → **Aufseher** wählt nach Priorität/Budget → **Arbeiter** erledigt an seiner Station → Ergebnis, Kosten, Protokoll in die Notiz → **Reviewer** prüft → bei Autopilot < 2 wartet die Aufgabe auf Julius' Freigabe → Veröffentlichung/Änderung → **Berichter** fasst zusammen → Planer lernt aus Kennzahlen.

## 3. Ordnerstruktur

### 3.1 Repo `JITrap/Limitlessposter` (Code, kein Firmenwissen, keine Schlüssel)

```
limitlessposter/
  README.md                      Kurzanleitung (deutsch)
  docs/                          Spezifikation, Pläne, Betriebsanleitung
  supervisor/                    Aufseher (TypeScript, ESM, Node ≥ 22)
    src/
      index.ts                   Start, Vorab-Prüfungen, Hauptschleife
      config.ts                  liest .env + limitless.config.json
      vault/                     Frontmatter lesen/schreiben (atomar), Aufgaben-Repository
      queue/                     Auswahl, Sperren, Wiederholungen
      budget/                    Hauptbuch, Pacing, Fenster (5 h, Woche Do 18:00), Modell-Wahl
      runner/                    claude -p starten, stream-json parsen, Timeout
      stations/                  station.yaml laden, Skills/Agents generieren, Verfügbarkeit prüfen
      status/                    Status.md + Berichte-Rohdaten schreiben
      world/                     HTTP-Server :4242, SSE, statische Welt-Seite
      adapters/                  shopify.ts, comfyui.ts, metricool-rest.ts (optional)
    test/                        Unit-Tests mit aufgezeichneten stream-json-Fixtures
    data/                        ledger.jsonl, state.json (gitignored)
  stations/                      eine Station pro Ordner (Quelle der Wahrheit)
    planer/      station.yaml  SKILL.md  templates/
    content/     …
    shop-analyst/ …
    reviewer/    …
    berichter/   …
    studio/      …  (GPU-frei: Mockups & Motion-Clips)
    motion/      …  (ComfyUI, Phase 2)
    voice/       …  (VoiceStudio, Phase 2)
    skill-schmied/ … (Phase 2)
  .claude/
    CLAUDE.md                    kurze Regeln für alle Arbeiter (< 120 Zeilen)
    settings.json                Hooks (Protokoll), erlaubte Tools, MCP-Server
    skills/                      GENERIERT aus stations/ (nicht von Hand ändern)
    agents/                      GENERIERT aus stations/
  vault-template/                wird beim Installieren in den Vault kopiert (s. 3.2)
  scripts/
    install.ps1                  Einrichtung auf dem PC (s. 10)
    doctor.ps1                   Gesundheitscheck
    build-stations.ts            stations/ → .claude/skills + agents
  .env.example                   alle möglichen Schlüssel, leer, kommentiert
  limitless.config.json          Pfade, Grenzen, Reset-Zeit (ohne Geheimnisse)
  .gitignore                     .env, supervisor/data/, node_modules/, Ausgaben
```

### 3.2 Vault `<Vault>/LimitlessOS/` (Wissen; von Julius und vom System geschrieben)

```
LimitlessOS/
  Home.md             Startseite: Status-Block + eingebettete Dashboard-Ansichten
  Dashboard.base      Ansichten: Heute · Kanban · Wartet auf dich · Nach Station · Kosten · Stationen
  Status.md           vom Aufseher jede Minute: Budget-Balken, Arbeiter, Resets, Pausengrund
  Strategie.md        Ziele, Wertleiter, Autopilot-Stufen, Grenzen (Posts/Tag …)
  Marke/
    Kern.md           Was ist Limitless Poster, Versprechen, Zielgruppen
    Tonalität.md      Sprache, Du/Sie, Emojis, Tabus
    Produkte.md       Produktlinien, Formate, Preise (vom Shop-Analyst gepflegt)
    Visuell.md        Farben, Schrift, Bildsprache, Mockup-Regeln
    Hashtags.md       Pools je Plattform
  Aufgaben/           eine .md pro Aufgabe (s. 4)
  Pläne/
    Content-Kalender.md   7–14 Tage voraus (vom Planer/Content gepflegt)
    Wochenplan.md
  Berichte/           YYYY-MM-DD-Tag.md, YYYY-Www-Woche.md
  Ideen/              Poster-Ideen, Kampagnen-Ideen (Backlog ohne Termin)
  Assets/             erzeugte Bilder/Clips/Audio (Unterordner je Aufgabe)
  Inbox/              hier wirft Julius Chats, Notizen, Skills rein → werden verarbeitet
  Archiv/             erledigte Aufgaben > 30 Tage
  PAUSE               (Datei anlegen = Not-Aus)
```

## 4. Aufgaben

### 4.1 Frontmatter-Schema (flach, kleingeschrieben, strikte Formate)

```yaml
---
type: task
id: 20261022-093000-karussell-5-raeume      # eindeutig, = Dateiname ohne .md
title: Karussell „Ein Poster, 5 Räume“ für Instagram
status: todo            # todo | doing | review | blocked | done | cancelled
station: content        # Stationsname aus stations/
priority: 2             # 1 (höchste) … 4
tier: standard          # cheap | standard | premium  → Modell (s. 6.3)
due: 2026-10-25         # YYYY-MM-DD
created: 2026-10-22T09:00:00
updated: 2026-10-22T09:00:00
started:                # YYYY-MM-DDTHH:mm:ss
completed:
attempts: 0
max_attempts: 3
cost_usd: 0             # Summe aller Läufe (Schätzung aus modelUsage)
tokens_in: 0
tokens_out: 0
model_used:             # z. B. claude-sonnet-5-5
outputs: []             # Vault-Pfade erzeugter Dateien
needs_approval: false   # true = wartet auf Julius (Status review)
origin: planer          # planer | julius | inbox | system
parent:                 # id einer übergeordneten Aufgabe
tags: [task]
---
```

Body-Aufbau (Markdown, Abschnitte mit festen Überschriften, damit Skripte sie finden):

```
## Auftrag
(vom Planer oder Julius)

## Kontext
(Links zu Marken-Notizen, Kennzahlen, Vorgänger)

## Ergebnis
(vom Arbeiter; bei Posts: fertiger Text je Plattform, Dateipfade)

## Protokoll
- 2026-10-22 09:05 doing · sonnet · Lauf 1 gestartet
- 2026-10-22 09:11 review · 14 231 Tokens · 0,06 $ · Entwurf fertig

## Offene Fragen an Julius
(leer, wenn keine)
```

### 4.2 Lebenszyklus

```
todo ──Aufseher──► doing ──Erfolg──► review (needs_approval) ──Julius──► todo (needs_approval=false) ──► doing ──► done
                     │                 └────────────────────────────────────────────────────────────────┘
                     └──Fehler──► todo (attempts+1) … ≥ max_attempts ──► blocked (Grund im Protokoll)
```

- Freigabe durch Julius: im Kanban Karte von **Wartet auf dich** nach **todo** ziehen (setzt `status`) **oder** `needs_approval: false` setzen. Ein Hook im Aufseher normalisiert: Status `todo` + `needs_approval: true` → gilt als freigegeben, `needs_approval` wird auf `false` gesetzt.
- `cancelled` kann nur Julius setzen.
- `blocked` erzeugt automatisch eine Aufgabe `station: manual` für Julius, wenn der Grund menschliches Handeln braucht (fehlende Verbindung, fehlender Schlüssel, Entscheidung).

### 4.3 Sperren und Nebenläufigkeit

- Der Aufseher hält eine In-Memory-Sperre je Aufgabe; zusätzlich `status: doing` + `started` im Frontmatter. Beim Start findet er Aufgaben, die `doing` sind, aber keinen laufenden Prozess haben (Absturz) → zurück auf `todo`, Protokolleintrag.
- Schreiben ins Vault immer **atomar** (Temp-Datei im selben Ordner + `rename`). Vor jedem Schreiben wird die Datei neu gelesen und nur die vom System verwalteten Felder/Abschnitte geändert (Merge statt Überschreiben), damit Julius' Änderungen am Body nicht verloren gehen.

## 5. Der Aufseher (Supervisor)

### 5.1 Hauptschleife (alle 30 s, zusätzlich getriggert durch Dateiwächter)

1. **Gesundheit**: `claude auth status` (alle 10 min), `PAUSE`-Datei, Dienste (ComfyUI :8188, VoiceStudio :3900, Metricool-MCP erreichbar) → Stations-Verfügbarkeit.
2. **Inbox**: neue Dateien in `Inbox/` → Aufgabe `station: skill-schmied` (Phase 2) bzw. in Phase 1 `station: planer` mit Auftrag „Inbox-Notiz einordnen“.
3. **Freigaben**: `review`-Aufgaben mit `needs_approval: false` → `todo`.
4. **Budget**: Wächter liefert `allowance` (wie viele Läufe welcher Stufe jetzt erlaubt sind) – s. 6.
5. **Auswahl**: offene `todo`-Aufgaben, deren Station verfügbar ist und deren `tier` erlaubt ist; Reihenfolge: `priority` ↑, `due` ↑, `created` ↑. Maximal **2 Arbeiter gleichzeitig** (konfigurierbar), maximal 1 `premium`.
6. **Planer-Trigger**: < 5 offene Aufgaben (ohne `manual`) oder Content-Kalender < 7 Tage voraus → Planer-Aufgabe anlegen (höchstens alle 2 h).
7. **Berichter-Trigger**: täglich 07:30 Tagesbericht, Donnerstag 17:00 Wochenbericht (vor dem Reset, damit die Woche sauber abgeschlossen ist).
8. **Status.md** schreiben, SSE-Ereignisse an die Welt senden.
9. **Archiv**: `done`/`cancelled` älter als 30 Tage → `Archiv/`.

### 5.2 Runner: einen Arbeiter starten

Befehl (Arbeitsverzeichnis = Repo, damit `.claude/` geladen wird):

```
claude -p "<Auftragstext aus der Notiz + Pfad der Notiz>"
  --output-format stream-json --verbose
  --permission-mode auto --permission-prompts none
  --model <haiku|sonnet|opus aus tier>
  --max-turns <aus station.yaml, Standard 40>
  --max-budget-usd <aus tier: cheap 0.30, standard 1.50, premium 6.00>
  --append-system-prompt-file stations/<station>/SKILL.md
  --add-dir "<Vault>/LimitlessOS"
  --no-session-persistence
  --fallback-model sonnet          (nur bei premium: wenn Opus-Fenster zu, Sonnet)
```

- Eigener **Timeout** (Standard 25 min, Station kann überschreiben): erst SIGINT (Lauf beendet den Zug), nach 30 s SIGTERM.
- **Stream-Auswertung** während des Laufs: `system/init` (MCP-Fehler → Protokoll), `rate_limit_event` → Budget-Wächter, `permission_denied` → Protokoll (zeigt, welche Tools die Station noch braucht), `result` → Abschluss.
- **Ergebnis-Auswertung**: `subtype` (`success` / `error_max_turns` / `error_max_budget_usd` / `error_during_execution`), `is_error`, `api_error_status` (429 → Budget), `modelUsage` (Summe über Modelle → `cost_usd`, `tokens_*`, `model_used`), `result` (Text) → Abschnitt **Ergebnis**, falls der Arbeiter die Notiz nicht selbst beschrieben hat.
- Der Arbeiter **darf die Aufgaben-Notiz selbst beschreiben** (Abschnitte Ergebnis/Offene Fragen) – das ist der Normalfall. Der Runner ergänzt danach nur Frontmatter und Protokoll.

### 5.3 Vorab-Prüfungen beim Start

`claude --version` ≥ 2.1.302 · `claude auth status` → `authMethod: claude.ai` · `ANTHROPIC_API_KEY` **nicht** gesetzt · Repo-Pfad in `~/.claude.json` vertrauenswürdig · Vault-Pfad existiert und enthält `LimitlessOS/` · Node ≥ 22 · Schreibtest im Vault. Schlägt etwas fehl → `Status.md` rot, Welt zeigt Fehler, kein Arbeiter startet.

## 6. Budget-Wächter

### 6.1 Fenster

- **Session**: 5 Stunden, Beginn = erster Lauf nach Leerlauf (wird aus `resets_at` der `rate_limit_event`s korrigiert, sobald eins eintrifft).
- **Woche**: Reset **Donnerstag 18:00 Europe/Berlin** (Konfiguration; wird ebenfalls aus `resets_at` korrigiert).
- **Modellfamilien**: eigene Zähler für Opus, Sonnet und Haiku. Für Haiku ist kein eigenes Fenster dokumentiert; es wird separat gezählt und zusätzlich auf das Wochenfenster angerechnet (konservativ).

### 6.2 Messen statt raten

- **Hauptbuch** `supervisor/data/ledger.jsonl`: je Lauf `{ts, task, station, model, tokens_in, tokens_out, cache_read, cache_write, cost_usd_est, duration_ms, result}`.
- **Offizielle Signale**: `rate_limit_event` mit `status: allowed_warning` → Stufe „sparsam“; `rejected`/429 → Stufe „pausiert“ bis `resets_at`; laufende Aufgaben kommen zurück auf `todo` ohne Zählung als Fehlversuch.
- **Optionaler Querabgleich** (ausschaltbar, Standard aus): undokumentierter Endpunkt `GET https://api.anthropic.com/api/oauth/usage` höchstens alle 5 min. Bricht er, ignoriert der Wächter ihn still.
- **Lernen**: Nach jeder Warnung/Ablehnung speichert der Wächter, wie viele geschätzte Tokens je Familie bis dahin im Fenster verbraucht wurden → wird zur **gelernten Fensterkapazität** (gleitender Mittelwert). Ab dem zweiten Fenster plant er damit.

### 6.3 Pacing-Regeln

Konfiguration in `Strategie.md` (Frontmatter) bzw. `limitless.config.json`:

```yaml
reserve_for_julius: 30      # % der gelernten Kapazität bleiben frei für Julius' eigene Arbeit
week_reset: "Thu 18:00"
max_parallel: 2
daily_post_limit: 3
daily_shop_change_limit: 5
```

- **Wochenkurve**: Soll-Verbrauch wächst linear von Do 18:00 bis Do 18:00. Liegt der Ist-Verbrauch (Hauptbuch, je Familie) über Soll + 10 % → nur `cheap`; über Soll + 20 % → Pause bis die Kurve wieder passt. Unter Soll − 20 % → `premium` erlaubt, auch außerhalb der festen Zeiten.
- **Session**: Verbrauch im 5-h-Fenster > 70 % der gelernten Kapazität → nur `cheap`; > 85 % → Pause bis Reset.
- **Nachtbetrieb**: 00:00–07:00 läuft nur `cheap`/`standard`, nie `premium` (Opus-Fenster für Tagesentscheidungen schonen).
- **Prompt-Cache nutzen**: dieselbe Station wird bevorzugt in Serie geplant (Cache-TTL 1 h), Kontext-Dateien je Station sind fest und klein.

### 6.4 Modell-Wahl

| tier | Modell | Beispiele | Budget/Lauf |
|---|---|---|---|
| cheap | Haiku | Formatieren, Hashtags, Zusammenfassen, Prüfen gegen Regeln, Berichte | 0,30 $ |
| standard | Sonnet | Post-Texte, Karussell-/Reel-Skripte, Produkttexte, Analysen, Planung | 1,50 $ |
| premium | Opus (Fallback Sonnet) | Wochenstrategie, Markenentscheidungen, Qualitäts-Review der Woche | 6,00 $ |

`premium` höchstens 1× täglich (Tagesplanung 08:00) + 1× wöchentlich (Mi 20:00 Wochenstrategie), außer der Wächter meldet „unter Soll“.

## 7. Stationen

### 7.1 Format `stations/<name>/station.yaml`

```yaml
name: content
display: Content-Studio
description: Plant und schreibt Posts (Reels-Skripte, Karussells, Captions) und stellt sie über Metricool ein.
tier: standard
max_turns: 40
timeout_min: 25
tools:                      # Claude-Code-Tool-Regeln (permission-rule-Syntax)
  - Read
  - Write(LimitlessOS/**)
  - mcp__metricool__*
context:                    # Vault-Notizen, die in den Prompt kommen (klein halten!)
  - Marke/Kern.md
  - Marke/Tonalität.md
  - Marke/Hashtags.md
  - Pläne/Content-Kalender.md
requires:                   # alles muss erfüllt sein, sonst „nicht verbunden“
  mcp: [metricool]
  env: []
  services: []              # z. B. http://127.0.0.1:8188/system_stats
autopilot: 1                # 0 Entwürfe · 1 nach Freigabe veröffentlichen · 2 vollautomatisch
cooldown_hours: 0
outputs_dir: Assets/content
```

`SKILL.md` daneben enthält die Arbeitsanweisung (deutsch), Qualitätskriterien, Ausgabeformat (welche Abschnitte der Notiz zu füllen sind) und Grenzen („niemals veröffentlichen, wenn needs_approval true“). `scripts/build-stations.ts` erzeugt daraus `.claude/skills/<name>/SKILL.md` (mit Frontmatter `name`, `description`, `allowed-tools`) und `.claude/agents/<name>.md` (mit `model`, `tools`, `maxTurns`).

### 7.2 Phase 1 – Kern-Stationen

| Station | Aufgabe | tier | autopilot | braucht |
|---|---|---|---|---|
| **planer** | Liest Strategie, Kennzahlen, Kalender, Ideen; erzeugt Aufgaben nach Wertleiter (s. 8); hält Kalender 7–14 Tage voraus; legt `manual`-Aufgaben für Julius an | standard (Mi 20:00 premium) | 2 | – |
| **content** | Reel-Skripte (Hook, Szenen, Text-Overlays, Voiceover-Text), Karussell-Skripte (Slide-Texte), Captions je Plattform, Hashtags; plant über Metricool-MCP (`createScheduledPost`), nutzt `getBestTimeToPostByNetwork` | standard | 1 | Metricool-MCP |
| **shop-analyst** | Bestellungen/Bestseller/Lager (GraphQL), pflegt `Marke/Produkte.md`, schlägt Produkttitel/-beschreibungen/SEO vor, schreibt Änderungen bei Freigabe zurück | standard | 1 | Shopify-Credentials (sonst nur Lesen über Connector) |
| **studio** | GPU-frei: Poster-Mockups (Poster-Datei in Raum-Vorlagen komponieren), Karussell-Slides, kurze Motion-Clips (HTML/CSS + Motion-Bibliothek → Playwright-Screenshots → ffmpeg MP4) | cheap | 2 (erzeugt nur Dateien) | Playwright-Chromium, ffmpeg, Poster-Dateien in `Assets/poster/` |
| **reviewer** | Prüft Entwürfe gegen Marke/Tonalität/Verbote und Plattformregeln (Länge, Hashtag-Zahl, keine Einzelbild-Posts), setzt `review` oder schickt mit Begründung zurück | cheap | 2 | – |
| **berichter** | Tagesbericht 07:30, Wochenbericht Do 17:00: was wurde gemacht, was wartet, Kosten/Budget, Kennzahlen aus Metricool-Analytics und Shop | cheap | 2 | – |
| **manual** | Pseudo-Station: Aufgaben für Julius (Pinterest verbinden, Poster-Dateien ablegen, Entscheidungen). Kein Arbeiter. | – | – | – |

### 7.3 Phase 2 – Erweiterung

| Station | Aufgabe | braucht |
|---|---|---|
| **voice** | Voiceover DE/EN für Reels über VoiceStudio-MCP (`generate_speech`, `list_voices`, `clone_voice` nur mit Julius' eigener Stimme), Transkription für Untertitel (`transcribe`) | VoiceStudio läuft (:3900), Modell geladen |
| **motion** | Bild- und Videoerzeugung über ComfyUI-API (`POST /prompt`, `GET /history/{id}`, `GET /view`): Produkt-Hero-Bilder, Raum-Szenen, kurze Clips; Workflow-Vorlagen je VRAM-Klasse | ComfyUI läuft (:8188), GPU; Modellwahl durch `doctor.ps1` |
| **pinterest** | Pins/Boards über Metricool, sobald Pinterest verbunden; Trend-Boards 2026 | Pinterest in Metricool |
| **email** | Entwürfe für Shopify-E-Mail-Flows (Willkommen, Warenkorb, Nachkauf) als Markdown/HTML | – |
| **skill-schmied** | Verarbeitet `Inbox/`: Chat-Exporte, Regeln, Ideen → neue Station (Ordner + SKILL.md), Status `review` bis Freigabe; aktualisiert Marken-Notizen | – |
| **recherche** | Trends, Wettbewerber, Hashtag-Analysen (WebSearch), 1×/Woche | – |

### 7.4 Verfügbarkeit

Beim Start und alle 5 min prüft der Aufseher je Station `requires`. Nicht erfüllt → Station „nicht verbunden“: keine Aufgaben, Welt zeigt den Raum grau mit Grund („VoiceStudio nicht gestartet“, „SHOPIFY_CLIENT_ID fehlt“). Der Planer sieht dieselbe Liste und legt bei Bedarf `manual`-Aufgaben an („Starte VoiceStudio“, „Lege Shopify-App an – Anleitung: docs/anleitungen/shopify.md“).

## 8. Planer: Arbeit, die sich selbst erzeugt

Der Planer ist das Herz von „immer beschäftigt, aber sinnvoll“. Er arbeitet eine **Wertleiter** aus `Strategie.md` ab; jede Sprosse hat Bedingung, Aktion, Abkühlzeit:

| # | Bedingung | Aktion (erzeugte Aufgaben) | Abkühlzeit |
|---|---|---|---|
| 1 | Content-Kalender < 7 Tage voraus | je Tag 1 Reel oder Karussell (Mix 60/40), nie Einzelbild; Studio-Aufgabe für Assets; Content-Aufgabe für Texte | – |
| 2 | `Marke/Produkte.md` älter als 3 Tage | shop-analyst: Shop-Snapshot (Bestseller, Lager, neue Produkte) | 3 Tage |
| 3 | Produkte ohne optimierten Titel/Beschreibung (Markierung in Produkte.md) | shop-analyst: 3 Produkte überarbeiten | 2 Tage |
| 4 | Pinterest verbunden **und** Top-5-Produkte ohne Pins | pinterest: Pins + Board-Struktur | 7 Tage |
| 5 | Pinterest **nicht** verbunden | manual: „Pinterest-Business-Konto + in Metricool verbinden + Pinterest-for-Shopify-App“ (einmalig) | einmalig |
| 6 | Google Merchant Center nicht bestätigt | manual: „Google & YouTube-App in Shopify, Merchant Center, Free Listings“ | einmalig |
| 7 | E-Mail-Flows nicht markiert als eingerichtet | email: Entwürfe; dann manual: „in Shopify Email anlegen“ | einmalig |
| 8 | Letzte Trend-Recherche > 7 Tage | recherche (Phase 2) / content: 10 Ideen aus Pinterest-Trends 2026 → `Ideen/` | 7 Tage |
| 9 | `Ideen/` < 10 offene Poster-Ideen | content: Ideen-Session (cheap) | 3 Tage |
| 10 | Kennzahlen zeigen Format mit > 1,5× Reichweite | Planer passt Mix im Kalender an (mehr davon) | wöchentlich |
| 11 | Sonst | berichter: Qualitäts-Check alter Posts; Archiv-Pflege | täglich |

Regeln: Der Planer liest **Kennzahlen** (Metricool-Analytics der letzten 7/28 Tage, Shop-Bestellungen) bevor er plant, und schreibt seine Begründung in `Pläne/Wochenplan.md`. Er darf **keine** Aufgaben erzeugen, die Stationen brauchen, die „nicht verbunden“ sind – stattdessen die passende `manual`-Aufgabe (einmalig, bis erledigt). Er erzeugt nie mehr als 15 offene Aufgaben.

## 9. „Die Welt“ – Live-Ansicht

Lokale Web-Seite `http://localhost:4242`, vom Aufseher ausgeliefert (kein Build-Schritt; eine HTML-Datei + Motion-Bibliothek von CDN oder lokal gebündelt). Zeigt eine **Bürowelt**:

- **Räume = Stationen** (Planung, Content-Studio, Shop-Büro, Studio, Review, Berichte, Werkstatt für Phase-2). Grau = nicht verbunden (mit Grund), hell = bereit, animiert = Arbeiter aktiv.
- **Arbeiter = Figuren** mit Namensschild (Station · Modell · laufende Aufgabe · Minuten · Tokens live).
- **Wand-Tafel**: Budget-Balken 5 h / Woche je Modellfamilie, nächste Resets (Do 18:00), Pausengrund, Anzahl Aufgaben je Status, heutige Posts/Shop-Änderungen vs. Limit.
- **Schreibtisch „Wartet auf dich“**: Karten der `review`-Aufgaben; Klick öffnet die Notiz in Obsidian (`obsidian://open?vault=…&file=…`); Button „Freigeben“ setzt `needs_approval: false`.
- **Ticker**: letzte 50 Protokoll-Ereignisse.
- Daten per **SSE** (`/events`), Zustand per `/api/state`. Nur `127.0.0.1`.

Obsidian bleibt die Arbeitsfläche zum Lesen/Ändern; die Welt ist der Überblick „wer macht was“.

## 10. Installation auf dem PC (`scripts/install.ps1`)

1. Prüft/installiert: Node 24 LTS (`winget install OpenJS.NodeJS.LTS`), Git für Windows (`winget install Git.Git` – damit Claude das Bash-Tool hat), Claude Code (nativ, `irm https://claude.ai/install.ps1 | iex`), Playwright-Chromium, ffmpeg (`winget install Gyan.FFmpeg`).
2. Fragt per Ordnerdialog nach dem **Obsidian-Vault**, kopiert `vault-template/` nach `<Vault>/LimitlessOS/` (ohne vorhandene Dateien zu überschreiben), schreibt `limitless.config.json`.
3. `claude` einmal interaktiv im Repo starten lassen (Login + Vertrauen) **oder** setzt `hasTrustDialogAccepted` in `~/.claude.json`.
4. MCP: `claude mcp add --transport http metricool https://ai.metricool.com/mcp` → Julius loggt sich einmal im Browser ein. VoiceStudio-MCP später über dessen „Integrations → Export .mcp.json“.
5. `.env` aus `.env.example` anlegen und Notepad öffnen (Shopify-Client-ID/-Secret eintragen, Rest leer lassen).
6. Aufgabenplanung: Task „LimitlessOS“, Trigger „Bei Anmeldung“ (nur dieser Benutzer), Aktion `node.exe supervisor/dist/index.js`, „Nur ausführen, wenn Benutzer angemeldet“, Neustart bei Fehler alle 1 min (3×), Energieoptionen: nicht nur im Netzbetrieb.
7. Startet den Aufseher sofort, öffnet `http://localhost:4242` und `Home.md` in Obsidian.

`doctor.ps1` wiederholt alle Prüfungen, misst GPU (`nvidia-smi` → VRAM-Klasse) und schreibt Empfehlungen für ComfyUI-Modelle in `Status.md`:
- keine GPU / < 6 GB: `motion` aus; `studio` übernimmt Visuals.
- 6–12 GB: Bilder (Z-Image-Turbo/Flux-schnell fp8), Video klein (Wan 2.2 TI2V-5B, 480p, ≤ 5 s).
- ≥ 16 GB: Wan 2.2 14B fp8 / LTX-Video 2 für 720p-Clips.

## 11. Sicherheit, Grenzen, Fehler

- **Nach außen nur mit Freigabe**: Stationen mit `autopilot: 1` erzeugen Entwürfe; Veröffentlichen/Ändern erst nach Freigabe. Julius kann je Station auf 2 stellen (in `Strategie.md`); Empfehlung: nach 2 Wochen für `content`.
- **Harte Tageslimits**: Posts (3), Shop-Änderungen (5), neue Aufgaben durch Planer (15 offen). Zähler im `state.json`, Reset 00:00.
- **Schlüssel**: nur in `.env` (gitignored); Arbeiter bekommen sie nicht als Text, sondern Adapter-Skripte lesen sie selbst. Notizen enthalten nie Schlüssel.
- **Werkzeuge**: Arbeiter dürfen nur in `LimitlessOS/**` schreiben, nie im Repo (außer `skill-schmied` in `stations/`, Status `review`). `Bash` nur für definierte Adapter-Skripte (`Bash(node adapters/*)`).
- **Fehler**: 3 Versuche, dann `blocked` + `manual`-Aufgabe falls nötig. Timeout, Max-Turns, Budget-Deckel je Lauf. Login abgelaufen → Pause + roter Status, keine Fehlversuche gezählt.
- **Not-Aus**: Datei `PAUSE` im Vault oder Button in der Welt → laufende Arbeiter zu Ende, keine neuen.
- **Protokolle**: `supervisor/data/logs/YYYY-MM-DD.log` (Rotation 14 Tage), je Lauf die rohe `stream-json`-Datei 7 Tage (für Fixtures/Debugging).
- **Backup**: Empfehlung Obsidian-Git-Plugin oder Obsidian Sync für den Vault (nicht Teil des Systems).

## 12. Tests

- **Unit** (vitest): Frontmatter-Parser/-Writer (Roundtrip, Merge, atomar), Queue-Auswahl, Budget-Pacing (Zeit als Parameter, Do-18:00-Reset, Warnung/Ablehnung, gelernte Kapazität), Result-Parser gegen aufgezeichnete `stream-json`-Fixtures (success, max_turns, budget, 429, permission_denied), Stations-Loader + Generator, Wertleiter-Bedingungen.
- **Integration (ohne Claude)**: Runner mit `FAKE_CLAUDE=1` startet ein Skript, das Fixture-Streams ausgibt → kompletter Zyklus todo→doing→review im Temp-Vault.
- **Rauch-Test auf dem PC** (`doctor.ps1 --smoke`): ein echter `cheap`-Lauf („Antworte mit OK“), prüft Login, Vertrauen, Vault-Schreiben, Welt erreichbar.
- Jede Station hat eine `examples/`-Aufgabe, mit der sie manuell geprüft werden kann.

## 13. Phasen und Reihenfolge

**Phase 1 – Kern (dieser Build):** Repo-Gerüst · Vault-Template (Home, Dashboard.base, Status, Strategie, Marke-Vorlagen mit Fragen an Julius, Inbox) · Supervisor (Vault, Queue, Budget, Runner, Status, Welt) · Stationen planer/content/shop-analyst/studio/reviewer/berichter · Shopify-Adapter · build-stations · install.ps1/doctor.ps1 · Tests · deutsche Anleitung.
**Phase 2:** voice (VoiceStudio), motion (ComfyUI), pinterest, email, recherche, skill-schmied + Import von Julius' Tagesplanungs-Chat.
**Phase 3:** TikTok Shop/Etsy-Stationen, Welt-Ausbau (Historie, Kostenkurven), Metricool-REST für Analytics-Tiefe.

## 14. Offene Punkte (nicht blockierend für Phase 1)

1. **Grafikkarte** des PCs (bestimmt, ob `motion` in Phase 2 realistisch ist) – `doctor.ps1` misst es.
2. **Metricool-Plan** sicher bestimmen (Konto → Abo). Bei Advanced: API-Token für direkte Analytics-Skripte in `.env`.
3. **Poster-Dateien**: Julius legt die Druckdateien/Previews in `Assets/poster/` ab (erste `manual`-Aufgabe), sonst kann `studio` keine Mockups bauen.
4. **Marken-Notizen**: Vorlagen enthalten Fragen; Julius beantwortet sie einmal (10 min) oder legt seinen Tagesplanungs-Chat in `Inbox/` – der Planer macht dann Vorschläge.
5. **Tagesplanungs-Chat** als Text exportieren → `Inbox/` (Phase 2 `skill-schmied`; bis dahin manuell durch Claude in einer Session).
