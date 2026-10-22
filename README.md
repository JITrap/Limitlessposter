# Limitless OS

Lokales „Firmen-Betriebssystem“ für die Marke **Limitless Poster** (limitlessposter.com).
KI-Arbeiter (Claude Code, über dein Abo) arbeiten an Stationen – Planung, Content-Studio, Shop-Büro,
Studio, Review, Berichte – an der Marke. Ein **Aufseher** verteilt die Arbeit, hält das Budget bis
zum Wochen-Reset ein und zeigt in der **Welt** live, wer was macht. Dein **Obsidian-Vault** ist das Gehirn.

## In fünf Schritten
1. Repo nach `C:\Users\<du>\limitlessposter` holen.
2. `powershell -ExecutionPolicy Bypass -File scripts\install.ps1`
3. Vault wählen, bei Claude einloggen (claude.ai-Konto), Metricool über `/mcp` verbinden.
4. In Obsidian `LimitlessOS/Marke/` ausfüllen, Poster nach `Assets/poster/`.
5. Welt öffnen: http://localhost:4242 – Freigaben erteilen, zuschauen.

Anleitungen: [Erste Schritte](docs/anleitung/erste-schritte.md) · [Betrieb](docs/anleitung/betrieb.md) ·
[Shopify-App](docs/anleitung/shopify-app.md) · [Metricool](docs/anleitung/metricool-mcp.md)

## Aufbau
```
supervisor/        Aufseher (Node 22+, TypeScript) – Vault, Budget, Runner, Welt, Adapter
stations/          Stationen: station.yaml + SKILL.md (+ examples, templates)
vault-template/    wird nach <Vault>/LimitlessOS kopiert (Home, Dashboard.base, Marke, Strategie …)
scripts/           install.ps1, doctor.ps1, build-stations.ts
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
