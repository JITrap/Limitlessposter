<#
.SYNOPSIS
  Gesundheitscheck für Limitless OS. Prüft alles, was der Aufseher zum Arbeiten braucht.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1
  powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1 -Smoke     # zusätzlich ein echter Mini-Lauf
#>
#Requires -Version 5.1
[CmdletBinding()]
param([switch]$Smoke)

$ErrorActionPreference = "Continue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot
$script:problems = 0

function Check($ok, $label, $hint) {
  if ($ok) { Write-Host ("  OK  " + $label) -ForegroundColor Green }
  else { Write-Host ("  XX  " + $label + "  -> " + $hint) -ForegroundColor Red; $script:problems++ }
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host "Limitless OS – Doctor" -ForegroundColor White

# Werkzeuge
Check (Has "node") "Node.js vorhanden" "scripts\install.ps1 ausführen"
if (Has "node") { $major = [int]((& node --version).TrimStart("v").Split(".")[0]); Check ($major -ge 22) "Node.js >= 22 (ist $major)" "Node LTS installieren" }
Check (Has "git") "Git für Windows (Bash-Werkzeug für Claude)" "winget install Git.Git"
Check (Has "ffmpeg") "ffmpeg (Clips)" "winget install Gyan.FFmpeg"
Check ((Has "python") -or (Has "py")) "Python 3 (Stimme, Qualitäts-Gate)" "winget install Python.Python.3.12"
Check (Test-Path (Join-Path $RepoRoot "tools\stimme\.venv\Scripts\python.exe")) "Stimme eingerichtet (tools\stimme\.venv)" "powershell -ExecutionPolicy Bypass -File tools\stimme\install.ps1"

# Claude
$claudeOk = Has "claude"
Check $claudeOk "Claude Code vorhanden" "irm https://claude.ai/install.ps1 | iex"
if ($claudeOk) {
  $v = ((& claude --version) -replace "[^\d\.]", "").Split(" ")[0]
  Check ([version]$v -ge [version]"2.1.302") "Claude Code >= 2.1.302 (ist $v)" "claude update"
  $auth = & claude auth status 2>$null
  Check (($LASTEXITCODE -eq 0) -and ($auth -match "claude.ai")) "Mit dem Claude-Abo angemeldet (claude.ai)" "'claude' starten und einloggen"
}
Check (-not $env:ANTHROPIC_API_KEY) "ANTHROPIC_API_KEY ist NICHT gesetzt (sonst API-Kosten statt Abo)" "Variable entfernen: [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY',`$null,'User')"

# Vertrauen
$claudeJsonPath = Join-Path $env:USERPROFILE ".claude.json"
$trusted = $false
if (Test-Path $claudeJsonPath) {
  try { $j = Get-Content $claudeJsonPath -Raw | ConvertFrom-Json; $trusted = [bool]($j.projects.$RepoRoot.hasTrustDialogAccepted) } catch { $trusted = $false }
}
Check $trusted "Repo-Ordner für Claude vertrauenswürdig" "scripts\install.ps1 ausführen (Schritt 4)"

# Konfiguration und Vault
$configPath = Join-Path $RepoRoot "limitless.config.json"
$vaultRoot = ""
if (Test-Path $configPath) { $vaultRoot = (Get-Content $configPath -Raw | ConvertFrom-Json).vaultRoot }
Check ([bool]$vaultRoot) "vaultRoot in limitless.config.json gesetzt" "install.ps1 ausführen (Schritt 3)"
if ($vaultRoot) {
  Check (Test-Path (Join-Path $vaultRoot "Home.md")) "Vault-Ordner mit Home.md vorhanden ($vaultRoot)" "Vorlage kopieren: install.ps1"
  Check (Test-Path (Join-Path $vaultRoot "Dashboard.base")) "Dashboard.base vorhanden" "Vorlage kopieren: install.ps1"
}
Check (Test-Path (Join-Path $RepoRoot ".env")) ".env vorhanden" "Copy-Item .env.example .env"
Check (Test-Path (Join-Path $RepoRoot "supervisor\dist\index.js")) "Aufseher gebaut (supervisor\dist)" "npm run build"
Check (Test-Path (Join-Path $RepoRoot ".claude\skills\planer\SKILL.md")) "Stations-Skills erzeugt" "npm run build:stations"
$mcpPath = Join-Path $RepoRoot ".mcp.json"
$mcpOk = $false; $mcpShopify = $false
if (Test-Path $mcpPath) {
  try { $mcp = Get-Content $mcpPath -Raw | ConvertFrom-Json; $mcpOk = [bool]$mcp.mcpServers.metricool; $mcpShopify = [bool]$mcp.mcpServers.shopify } catch { }
}
Check $mcpOk ".mcp.json mit Metricool-Server" "Datei aus dem Repo wiederherstellen"
Check $mcpShopify ".mcp.json mit Shopify-MCP-Server (setup.shopify.com)" "Datei aus dem Repo wiederherstellen"
if ($claudeOk) {
  # `claude mcp list` prüft die Server und meldet, ob eine Anmeldung fehlt. Nur Hinweis, kein Fehler.
  try {
    $mcpList = (& claude mcp list 2>&1) -join "`n"
    foreach ($srv in @("metricool", "shopify")) {
      $line = ($mcpList -split "`n" | Where-Object { $_ -match "^\s*$srv\b" } | Select-Object -First 1)
      if ($line) { Write-Host ("      " + $line.Trim()) } else { Write-Host "      $srv : nicht in 'claude mcp list' (Repo-Ordner als Projekt noch nicht geöffnet?)" -ForegroundColor Yellow }
    }
    Write-Host "      Fehlt eine Anmeldung: 'claude' starten, '/mcp', Server wählen, Authenticate." -ForegroundColor Yellow
  } catch { }
}

# Obsidian – Installer-Varianten: Programs\Obsidian (Standard), LOCALAPPDATA\Obsidian (alt), Program Files, Store-App, Registry
$obsidianVersion = ""
$obsidianWhere = ""
$candidates = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Obsidian\Obsidian.exe"),
  (Join-Path $env:LOCALAPPDATA "Obsidian\Obsidian.exe"),
  (Join-Path $env:ProgramFiles "Obsidian\Obsidian.exe")
)
foreach ($c in $candidates) {
  if (-not $obsidianVersion -and (Test-Path $c)) { $obsidianVersion = (Get-Item $c).VersionInfo.ProductVersion; $obsidianWhere = $c }
}
if (-not $obsidianVersion) {
  try {
    $reg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "Obsidian*" } | Select-Object -First 1
    if ($reg -and $reg.DisplayVersion) { $obsidianVersion = [string]$reg.DisplayVersion; $obsidianWhere = "Registry" }
  } catch { }
}
if (-not $obsidianVersion) {
  try { $appx = Get-AppxPackage -Name "*Obsidian*" -ErrorAction SilentlyContinue | Select-Object -First 1; if ($appx) { $obsidianVersion = [string]$appx.Version; $obsidianWhere = "Microsoft Store" } } catch { }
}
if ($obsidianVersion) {
  $ovClean = ($obsidianVersion.Split("-")[0] -replace "[^\d\.]", "")
  $parts = $ovClean.Split("."); if ($parts.Count -gt 3) { $ovClean = ($parts[0..2] -join ".") }
  Check ([version]$ovClean -ge [version]"1.14.0") "Obsidian >= 1.14 (Kanban-Ansicht in Bases) – ist $obsidianVersion ($obsidianWhere)" "Obsidian aktualisieren (obsidian.md/download)"
} else { Write-Host "  --  Obsidian-Version konnte nicht ermittelt werden – bitte in Obsidian unter Einstellungen > Info prüfen (mindestens 1.14)" -ForegroundColor Yellow }

# Aufgabenplanung
$task = Get-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue
Check ([bool]$task) "Aufgabe 'LimitlessOS' in der Aufgabenplanung" "install.ps1 (Schritt 7)"
if ($task) { Write-Host ("      Zustand: " + $task.State) }

# Welt erreichbar?
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:4242/api/state" -UseBasicParsing -TimeoutSec 3
  Check ($r.StatusCode -eq 200) "Die Welt antwortet auf http://localhost:4242" ""
} catch { Check $false "Die Welt antwortet auf http://localhost:4242" "Aufseher läuft nicht: Start-ScheduledTask LimitlessOS oder npm start" }

# Grafikkarte (für Phase 2: lokale Bild-/Videoerzeugung mit ComfyUI)
$gpuLine = "Keine NVIDIA-Grafikkarte erkannt (nvidia-smi fehlt) – Station 'motion' bleibt aus, das Studio übernimmt Bilder."
$vramClass = "keine"
if (Has "nvidia-smi") {
  try {
    $gpu = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader) | Select-Object -First 1
    $name, $mem = $gpu.Split(",") | ForEach-Object { $_.Trim() }
    $mb = [int](($mem -replace "[^\d]", ""))
    $gb = [math]::Round($mb / 1024, 1)
    if ($gb -lt 6) { $vramClass = "klein"; $empf = "Bilder nur per Studio; ComfyUI nicht sinnvoll." }
    elseif ($gb -lt 16) { $vramClass = "mittel"; $empf = "ComfyUI: Bilder (Z-Image-Turbo / Flux-schnell fp8), kurze Clips (Wan 2.2 TI2V-5B, 480p, <= 5 s)." }
    else { $vramClass = "gross"; $empf = "ComfyUI: Wan 2.2 14B fp8 oder LTX-Video 2 für 720p-Clips, Flux/Qwen-Image für Bilder." }
    $gpuLine = "$name mit $gb GB VRAM (Klasse: $vramClass). Empfehlung: $empf"
    Write-Host ("  OK  Grafikkarte: " + $gpuLine) -ForegroundColor Green
  } catch { Write-Host "  --  nvidia-smi antwortet nicht" -ForegroundColor Yellow }
} else { Write-Host ("  --  " + $gpuLine) -ForegroundColor Yellow }

if ($vaultRoot -and (Test-Path $vaultRoot)) {
  $technik = @"
---
type: technik
updated: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
vram_klasse: $vramClass
---
# Technik (vom Doctor geschrieben)

## Grafikkarte
$gpuLine

## Letzter Doctor-Lauf
Probleme: $script:problems
"@
  [IO.File]::WriteAllText((Join-Path $vaultRoot "Technik.md"), $technik, (New-Object System.Text.UTF8Encoding $false))
}

# Rauch-Test
if ($Smoke) {
  Write-Host ""
  Write-Host "Rauch-Test: ein echter Mini-Lauf (Station Review, Modell Haiku) …" -ForegroundColor Cyan
  & node (Join-Path $RepoRoot "supervisor\dist\index.js") --smoke
  Check ($LASTEXITCODE -eq 0) "Rauch-Test bestanden" "Ausgabe oben lesen; Logs in supervisor\data\logs"
}

Write-Host ""
if ($script:problems -eq 0) { Write-Host "Alles in Ordnung." -ForegroundColor Green } else { Write-Host "$script:problems Problem(e) gefunden – siehe Hinweise." -ForegroundColor Yellow }
exit $script:problems
