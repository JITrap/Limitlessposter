<#
.SYNOPSIS
  Limitless OS aktualisieren – ein Befehl, keine Fernsitzung nötig.
.DESCRIPTION
  1. Holt den neuesten Stand (git pull, wenn dieses Skript aus einem Git-Klon läuft)
  2. Kopiert das Repo in den Installationsordner (robocopy; .env, limitless.config.json,
     supervisor\data und node_modules bleiben unangetastet)
  3. Baut den Aufseher und die Stationen (npm install, build, build:stations)
  4. Aktualisiert den Vault: System-Notizen werden ersetzt (mit Sicherung), alles andere nur ergänzt –
     nie angefasst werden Status.md, Kennzahlen.md, Pläne\Veröffentlicht.md, Marke\Produkte.md,
     Kalender, Wochenplan, Berichte, Archiv, Assets\content und bestehende Aufgaben
  5. Startet die geplante Aufgabe „LimitlessOS“ neu und zeigt den Doctor
.EXAMPLE
  git -C "$env:TEMP\limitlessos-git" pull; & "$env:TEMP\limitlessos-git\scripts\update.ps1"
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\update.ps1 -Target "C:\Users\juliu\limitlessposter" -NoRestart
#>
[CmdletBinding()]
param(
  [string]$Target = (Join-Path $env:USERPROFILE "limitlessposter"),
  [switch]$NoRestart,
  [switch]$NoVault,
  [switch]$NoPull
)
$ErrorActionPreference = "Stop"
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  !!  $t" -ForegroundColor Yellow }
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

$Source = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not (Test-Path (Join-Path $Source "scripts\install.ps1"))) { throw "Quelle unvollständig: $Source" }

Step "1. Neuesten Stand holen"
if (-not $NoPull -and (Test-Path (Join-Path $Source ".git")) -and (Has "git")) {
  $env:GIT_TERMINAL_PROMPT = "0"
  & git -C $Source pull --ff-only 2>&1 | ForEach-Object { "     $_" }
  if ($LASTEXITCODE -ne 0) { Warn "git pull fehlgeschlagen – es wird der vorhandene Stand im Klon genommen." } else { Ok ("Stand: " + (& git -C $Source log --oneline -1)) }
} else { Ok "Kein Git-Klon oder -NoPull – Quelle wird so genommen, wie sie ist: $Source" }

Step "2. Repo nach $Target kopieren"
if ((Resolve-Path $Source).Path -eq (Resolve-Path -ErrorAction SilentlyContinue $Target).Path) {
  Ok "Quelle und Ziel sind derselbe Ordner – nichts zu kopieren."
} else {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  # /E alle Unterordner, /XD ausgeschlossene Ordner, /XF ausgeschlossene Dateien; Exit-Codes < 8 sind Erfolg.
  & robocopy $Source $Target /E /NFL /NDL /NJH /NJS /NP /XD "node_modules" "data" ".git" /XF ".env" "limitless.config.json" | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { throw "Kopieren fehlgeschlagen (robocopy Code $rc)." }
  Ok "Kopiert (robocopy Code $rc; .env, limitless.config.json, supervisor\data und node_modules unangetastet)"
}

Step "3. Bauen"
Push-Location $Target
try {
  & npm --prefix supervisor install --no-audit --no-fund 2>&1 | Select-Object -Last 2 | ForEach-Object { "     $_" }
  if ($LASTEXITCODE -ne 0) { throw "npm install fehlgeschlagen" }
  & npm run build 2>&1 | Select-Object -Last 3 | ForEach-Object { "     $_" }
  if ($LASTEXITCODE -ne 0) { throw "npm run build fehlgeschlagen" }
  & npm run build:stations 2>&1 | Select-Object -Last 3 | ForEach-Object { "     $_" }
  if ($LASTEXITCODE -ne 0) { throw "npm run build:stations fehlgeschlagen" }
  Ok "Aufseher und Stationen gebaut"
} finally { Pop-Location }

Step "4. Vault aktualisieren"
$configPath = Join-Path $Target "limitless.config.json"
$vaultRoot = ""
if (Test-Path $configPath) {
  $raw = Get-Content $configPath -Raw
  if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
  $vaultRoot = (ConvertFrom-Json $raw).vaultRoot
}
if ($NoVault) { Warn "Vault übersprungen (-NoVault)" }
elseif (-not $vaultRoot -or -not (Test-Path $vaultRoot)) { Warn "Vault-Ordner unbekannt oder fehlt ($vaultRoot) – install.ps1 ausführen." }
else {
  $templateRoot = Join-Path $Target "vault-template\LimitlessOS"
  $backup = Join-Path $env:TEMP ("limitlessos-vault-backup-" + $stamp)
  # System-Notizen: werden ersetzt (vorher gesichert). Alles andere wird nur ergänzt, nie überschrieben.
  $overwrite = @(
    "Home.md", "Dashboard.base", "Strategie.md",
    "Marke\Kern.md", "Marke\Tonalität.md", "Marke\Hashtags.md", "Marke\Visuell.md", "Marke\Kanäle.md",
    "Pläne\Content-Bank.md", "Pläne\Produktion.md",
    "Assets\poster\README.md", "Assets\stimmen\README.md", "Ideen\README.md", "Inbox\README.md"
  )
  $replaced = 0; $added = 0
  Get-ChildItem -Path $templateRoot -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($templateRoot.Length).TrimStart("\")
    $dest = Join-Path $vaultRoot $rel
    $exists = Test-Path $dest
    if ($exists -and ($overwrite -contains $rel)) {
      if ((Get-FileHash $dest).Hash -ne (Get-FileHash $_.FullName).Hash) {
        $bak = Join-Path $backup $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $bak) | Out-Null
        Copy-Item $dest $bak -Force
        Copy-Item $_.FullName $dest -Force
        $replaced++
      }
    } elseif (-not $exists) {
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      Copy-Item $_.FullName $dest
      $added++
    }
  }
  Ok "Vault: $replaced Notizen ersetzt (Sicherung: $backup), $added Dateien neu. Unangetastet: Status, Kennzahlen, Veröffentlicht, Produkte, Kalender, Wochenplan, Aufgaben, Berichte."
}

Step "5. Aufseher neu starten"
if ($NoRestart) { Warn "Neustart übersprungen (-NoRestart)" }
elseif (Get-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  try { Start-ScheduledTask -TaskName "LimitlessOS" -ErrorAction Stop; Ok "Aufseher neu gestartet – Welt: http://localhost:4242" } catch { Warn ("Start fehlgeschlagen: " + $_.Exception.Message.Trim()) }
} else { Warn "Geplante Aufgabe 'LimitlessOS' nicht gefunden – install.ps1 ausführen oder 'npm start' im Repo." }

Step "6. Doctor"
try { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Target "scripts\doctor.ps1") } catch { Warn ("Doctor nicht gelaufen: " + $_.Exception.Message.Trim()) }
Write-Host "`nFertig." -ForegroundColor Green
