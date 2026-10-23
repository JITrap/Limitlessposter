# Limitless OS

Lokales „Firmen-Betriebssystem“ für die Marke **Limitless Poster** (limitlessposter.com).
KI-Arbeiter (Claude Code, über dein Abo) arbeiten an Stationen – Planung, Content-Studio, Shop-Büro,
Studio, Review, Berichte, Zentrale – an der Marke. Ein **Aufseher** verteilt die Arbeit, hält das Budget
bis zum Wochen-Reset ein und zeigt in der **Welt** live, wer was macht. Die **Zentrale** oben in der Welt
führt die Zahlen aus Shopify, Metricool und Printify auf einer Seite zusammen. Dein **Obsidian-Vault**
ist das Gehirn.

## In vier Schritten
1. GitHub → **Code → Download ZIP**, dann in PowerShell die drei Zeilen aus `docs/anleitung/erste-schritte.md`
   (entpackt nach `C:\Users\<du>\limitlessposter` und startet `scripts\install.ps1`).
2. Bei Claude einloggen (claude.ai-Konto), Metricool und Shopify über `/mcp` im Browser anmelden.
3. In Obsidian die Karten unter **Wartet auf dich** abarbeiten (Produktfakten bestätigen, Rechtliches, Pinterest).
4. Welt öffnen: http://localhost:4242 – Freigaben erteilen, zuschauen.

Der Vault kommt vorbefüllt: alle 125 Produkte mit Bild-Links, Markenkern und Hashtags aus dem echten
Sortiment, Content-Kalender mit den Metricool-Autolist-Terminen, erste Aufgaben für Studio, Content-Studio
und Shop-Büro. Shopify läuft ohne Schlüssel über den offiziellen Shopify-MCP-Server; die eigene App
(`docs/anleitung/shopify-app.md`, Weg B) ist nur für den Datei-Upload nötig.

Anleitungen: [Erste Schritte](docs/anleitung/erste-schritte.md) · [Betrieb](docs/anleitung/betrieb.md) ·
[Shopify-App](docs/anleitung/shopify-app.md) · [Metricool](docs/anleitung/metricool-mcp.md)

## Aufbau
```
supervisor/        Aufseher (Node 22+, TypeScript) – Vault, Budget, Runner, Welt, Adapter
stations/          Stationen: station.yaml + SKILL.md (+ examples, templates)
vault-template/    wird nach <Vault>/LimitlessOS kopiert (Home, Dashboard.base, Marke, Strategie …)
scripts/           bootstrap.ps1, install.ps1, doctor.ps1, build-stations.ts
docs/              Spezifikation, Plan, Anleitungen
```

## Entwicklung
```
npm run install:all       # Abhängigkeiten
npm test                  # Tests, ohne echten Claude-Lauf
npm run build             # TypeScript → supervisor/dist
npm run build:stations    # stations/ → .claude/skills + .claude/agents
FAKE_CLAUDE=1 npm run dev  # Aufseher lokal mit Fake-Arbeitern
```

Spezifikation: `docs/superpowers/specs/2026-10-22-limitless-os-design.md` ·
Plan Phase 1: `docs/superpowers/plans/2026-10-22-limitless-os-phase1.md`

## Phase 2 (vorbereitet, noch nicht gebaut)
Stimme (VoiceStudio-MCP), Bild/Video (ComfyUI), Pinterest, E-Mail-Flows, Skill-Schmied für Chat-Importe.
