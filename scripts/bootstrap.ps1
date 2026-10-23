<#
.SYNOPSIS
  Holt Limitless OS aus einer heruntergeladenen ZIP (oder von GitHub) nach C:\Users\<du>\limitlessposter
  und startet die Einrichtung (install.ps1). Für PCs ohne Git.

.DESCRIPTION
  1. Sucht die ZIP: Parameter -Zip, sonst die neueste Downloads\Limitlessposter-main*.zip, sonst Download von GitHub
     (nur wenn das Repo öffentlich ist).
  2. Entpackt sie und kopiert den Inhalt nach -Target (Standard: %USERPROFILE%\limitlessposter).
     Beim Aktualisieren bleiben .env, supervisor\data und supervisor\node_modules erhalten.
  3. Hebt die Windows-Sperre für heruntergeladene Dateien auf (Unblock-File) und startet scripts\install.ps1.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bootstrap.ps1
  powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Zip "$env:USERPROFILE\Downloads\Limitlessposter-main.zip"
  powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -NoInstall     # nur kopieren
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Zip = "",
  [string]$Target = (Join-Path $env:USERPROFILE "limitlessposter"),
  [string]$Branch = "main",
  [string]$Repo = "JITrap/Limitlessposter",
  [switch]$NoInstall,
  [string]$VaultPath = ""
)

$ErrorActionPreference = "Stop"
function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

Write-Host "Limitless OS – Bootstrap" -ForegroundColor White

# --- 1. ZIP finden oder laden ----------------------------------------------------------
Step "Quelle suchen"
$repoName = $Repo.Split("/")[1]
if (-not $Zip) {
  $downloads = Join-Path $env:USERPROFILE "Downloads"
  $candidate = Get-ChildItem -Path $downloads -Filter "$repoName-$Branch*.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($candidate) { $Zip = $candidate.FullName; Ok "ZIP gefunden: $Zip" }
}
if (-not $Zip) {
  $url = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
  $Zip = Join-Path $env:TEMP "$repoName-$Branch.zip"
  Write-Host "    Keine ZIP in Downloads – lade $url"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $Zip -UseBasicParsing
    Ok "Heruntergeladen"
  } catch {
    throw "Download fehlgeschlagen (privates Repo?). Bitte auf https://github.com/$Repo 'Code -> Download ZIP' klicken und das Skript erneut starten."
  }
}
if (-not (Test-Path $Zip)) { throw "ZIP nicht gefunden: $Zip" }

# --- 2. Entpacken ---------------------------------------------------------------------------
Step "Entpacken"
$extract = Join-Path $env:TEMP ("limitless-extract-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
Expand-Archive -Path $Zip -DestinationPath $extract -Force
$inner = Get-ChildItem -Path $extract -Directory | Select-Object -First 1
if (-not $inner) { throw "ZIP ist leer oder hat kein Wurzelverzeichnis." }
if (-not (Test-Path (Join-Path $inner.FullName "scripts\install.ps1"))) { throw "Das ist keine Limitless-OS-ZIP (scripts\install.ps1 fehlt)." }
Ok ("Inhalt: " + $inner.Name)

# --- 3. Kopieren (Daten bleiben erhalten) -----------------------------------------------------
Step "Nach $Target kopieren"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
# robocopy: /E alle Unterordner, /XD ausgeschlossene Ordner, /XF ausgeschlossene Dateien; Exit-Codes < 8 sind Erfolg.
& robocopy $inner.FullName $Target /E /NFL /NDL /NJH /NJS /NP /XD "node_modules" "data" ".git" /XF ".env" "limitless.config.json" | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "Kopieren fehlgeschlagen (robocopy Code $rc)." }
Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue
Get-ChildItem -Path $Target -Recurse -File -Include *.ps1, *.psm1 -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
Ok "Repo liegt in $Target (robocopy Code $rc; .env, limitless.config.json, supervisor\data und node_modules unangetastet)"

# --- 4. Einrichtung starten ----------------------------------------------------------------------
if ($NoInstall) { Warn "Einrichtung übersprungen (-NoInstall). Manuell: powershell -ExecutionPolicy Bypass -File $Target\scripts\install.ps1"; exit 0 }
Step "Einrichtung starten (install.ps1)"
$installArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $Target "scripts\install.ps1"))
if ($VaultPath) { $installArgs += @("-VaultPath", $VaultPath) }
& powershell @installArgs
exit $LASTEXITCODE
