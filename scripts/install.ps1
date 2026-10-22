<#
.SYNOPSIS
  Richtet Limitless OS auf diesem Windows-PC ein (einmalig).

.DESCRIPTION
  1. Installiert Node.js LTS, Git für Windows, ffmpeg und Claude Code (falls nicht vorhanden)
  2. Baut den Aufseher und erzeugt die Stations-Skills
  3. Fragt nach dem Obsidian-Vault und kopiert die Vorlage nach <Vault>\LimitlessOS
  4. Markiert den Repo-Ordner für Claude als vertrauenswürdig
  5. Richtet den Metricool-MCP-Server ein (Login im Browser)
  6. Legt die .env an und öffnet sie
  7. Registriert den Autostart in der Aufgabenplanung ("Bei Anmeldung")
  8. Startet den Aufseher und öffnet die Welt

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -VaultPath "C:\Users\Julius\Obsidian\MeinVault"
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$VaultPath = "",
  [switch]$SkipInstall,
  [switch]$NoTask
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }
function Has($cmd)   { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Host "Limitless OS – Einrichtung" -ForegroundColor White
Write-Host "Repo: $RepoRoot"

# --- 1. Werkzeuge -------------------------------------------------------------
if (-not $SkipInstall) {
  Step "Werkzeuge prüfen und installieren"
  if (-not (Has "winget")) { throw "winget fehlt. Bitte 'App-Installer' aus dem Microsoft Store installieren und das Skript erneut starten." }

  if (-not (Has "node")) { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null; RefreshPath }
  if (Has "node") { Ok ("Node " + (& node --version)) } else { throw "Node.js konnte nicht installiert werden." }
  $nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
  if ($nodeMajor -lt 22) { throw "Node.js ist zu alt ($nodeMajor). Bitte Node 22 oder neuer installieren." }

  if (-not (Has "git")) { winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements | Out-Null; RefreshPath }
  if (Has "git") { Ok "Git für Windows (Claude bekommt damit das Bash-Werkzeug)" } else { Warn "Git fehlt – Claude nutzt dann PowerShell statt Bash, das funktioniert auch." }

  if (-not (Has "ffmpeg")) { winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements | Out-Null; RefreshPath }
  if (Has "ffmpeg") { Ok "ffmpeg (für Clips)" } else { Warn "ffmpeg fehlt – das Studio kann dann keine Clips rendern, Bilder schon." }

  if (-not (Has "claude")) {
    Write-Host "    Installiere Claude Code (nativ) …"
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
    RefreshPath
  }
  if (-not (Has "claude")) { throw "Claude Code wurde nicht gefunden. Bitte Terminal neu öffnen und Skript erneut starten." }
  $claudeVersion = (& claude --version) -replace "[^\d\.]", ""
  Ok "Claude Code $claudeVersion"
  if ([version]($claudeVersion.Split(" ")[0]) -lt [version]"2.1.302") { Warn "Claude Code ist älter als 2.1.302 – bitte 'claude update' ausführen." }
}

# --- 2. Bauen ---------------------------------------------------------------------
Step "Aufseher bauen"
& npm --prefix supervisor install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install fehlgeschlagen" }
& npm --prefix supervisor run build
if ($LASTEXITCODE -ne 0) { throw "Build fehlgeschlagen" }
& npm run build:stations
if ($LASTEXITCODE -ne 0) { throw "Stations-Generator fehlgeschlagen" }
Write-Host "    Playwright-Chromium (für das Studio) …"
& npx --prefix supervisor playwright install chromium | Out-Null
Ok "Aufseher gebaut, Skills erzeugt"

# --- 3. Vault ---------------------------------------------------------------------
Step "Obsidian-Vault wählen"
if (-not $VaultPath) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "Wähle deinen Obsidian-Vault (den Ordner, den Obsidian als Vault öffnet)"
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "Kein Vault gewählt." }
  $VaultPath = $dialog.SelectedPath
}
if (-not (Test-Path $VaultPath)) { throw "Vault-Ordner nicht gefunden: $VaultPath" }
$VaultRoot = Join-Path $VaultPath "LimitlessOS"
New-Item -ItemType Directory -Force -Path $VaultRoot | Out-Null
$templateRoot = Join-Path $RepoRoot "vault-template\LimitlessOS"
Get-ChildItem -Path $templateRoot -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($templateRoot.Length).TrimStart("\")
  $target = Join-Path $VaultRoot $rel
  if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item $_.FullName $target
  }
}
Ok "Vorlage liegt in $VaultRoot (vorhandene Dateien wurden nicht überschrieben)"

$configPath = Join-Path $RepoRoot "limitless.config.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$config.vaultRoot = $VaultRoot
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding $false))
Ok "limitless.config.json → vaultRoot gesetzt"

# --- 4. Vertrauen für Claude -------------------------------------------------------
Step "Repo-Ordner für Claude als vertrauenswürdig markieren"
$claudeJsonPath = Join-Path $env:USERPROFILE ".claude.json"
if (Test-Path $claudeJsonPath) { $claudeJson = Get-Content $claudeJsonPath -Raw | ConvertFrom-Json } else { $claudeJson = [pscustomobject]@{} }
if (-not ($claudeJson.PSObject.Properties.Name -contains "projects")) { $claudeJson | Add-Member -NotePropertyName projects -NotePropertyValue ([pscustomobject]@{}) }
# Claude Code stores project keys in more than one spelling on Windows (backslashes, forward slashes).
# Write both so the trust check matches whichever one Claude uses.
$keys = @($RepoRoot, $RepoRoot.Replace('\', '/'))
foreach ($key in $keys) {
  if ($claudeJson.projects.PSObject.Properties.Name -contains $key) {
    $claudeJson.projects.$key | Add-Member -NotePropertyName hasTrustDialogAccepted -NotePropertyValue $true -Force
  } else {
    $claudeJson.projects | Add-Member -NotePropertyName $key -NotePropertyValue ([pscustomobject]@{ hasTrustDialogAccepted = $true })
  }
}
[IO.File]::WriteAllText($claudeJsonPath, ($claudeJson | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
Ok "~/.claude.json aktualisiert"

# --- 5. .env -------------------------------------------------------------------------
Step ".env anlegen"
$envPath = Join-Path $RepoRoot ".env"
if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $RepoRoot ".env.example") $envPath }
$claudeCmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $claudeCmd) { $claudeCmd = Get-Command claude }
$claudeBin = $claudeCmd.Source
$envText = Get-Content $envPath -Raw
if ($envText -match "(?m)^LIMITLESS_CLAUDE_BIN=.*$") {
  $envText = [regex]::Replace($envText, "(?m)^LIMITLESS_CLAUDE_BIN=.*$", "LIMITLESS_CLAUDE_BIN=$claudeBin")
} else {
  $envText += "`nLIMITLESS_CLAUDE_BIN=$claudeBin`n"
}
[IO.File]::WriteAllText($envPath, $envText, (New-Object System.Text.UTF8Encoding $false))
Ok ".env vorhanden (LIMITLESS_CLAUDE_BIN=$claudeBin)"
Write-Host "    Trage jetzt die Shopify-Zugangsdaten ein (Anleitung: docs\anleitung\shopify-app.md). Leere Zeilen sind erlaubt."
Start-Process notepad $envPath

# --- 6. Claude-Login + Metricool-MCP ---------------------------------------------
Step "Claude-Login und Metricool verbinden"
$authOk = $false
try {
  $ErrorActionPreference = "Continue"
  $auth = (& claude auth status 2>&1) -join "`n"
  $authOk = ($LASTEXITCODE -eq 0) -and ($auth -match "claude.ai")
} catch { $authOk = $false } finally { $ErrorActionPreference = "Stop" }
if (-not $authOk) {
  Write-Host "    Du bist nicht mit dem Claude-Abo angemeldet. Es öffnet sich Claude – bitte einloggen (claude.ai-Konto, nicht API)."
  Write-Host "    Danach in Claude '/mcp' tippen, 'metricool' auswählen und im Browser bei Metricool anmelden. Zum Schluss '/exit'."
  & claude
} else {
  Ok "Claude-Login vorhanden"
  Write-Host "    Für Metricool einmalig: in diesem Ordner 'claude' starten, '/mcp' tippen, 'metricool' anmelden, '/exit'."
  $answer = Read-Host "    Jetzt machen? (j/n)"
  if ($answer -match "^[jJyY]") { & claude }
}

# --- 7. Aufgabenplanung ---------------------------------------------------------------
if (-not $NoTask) {
  Step "Autostart in der Aufgabenplanung einrichten"
  $nodeExe = (Get-Command node).Source
  $action    = New-ScheduledTaskAction -Execute $nodeExe -Argument "supervisor\dist\index.js" -WorkingDirectory $RepoRoot
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "LimitlessOS" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Limitless OS Aufseher – startet bei Anmeldung" -Force | Out-Null
  Ok "Aufgabe 'LimitlessOS' registriert (Bei Anmeldung, nur wenn du angemeldet bist, Neustart bei Fehler)"
  Start-ScheduledTask -TaskName "LimitlessOS"
  Ok "Aufseher gestartet"
} else {
  Warn "Autostart übersprungen (-NoTask). Manuell starten: npm start"
}

# --- 8. Öffnen -----------------------------------------------------------------------
Step "Fertig"
Start-Sleep -Seconds 3
Start-Process "http://localhost:4242"
$vaultName = Split-Path $VaultPath -Leaf
Start-Process ("obsidian://open?vault=" + [uri]::EscapeDataString($vaultName) + "&file=" + [uri]::EscapeDataString("LimitlessOS/Home"))
Write-Host ""
Write-Host "Die Welt: http://localhost:4242   ·   Obsidian: LimitlessOS/Home.md" -ForegroundColor Green
Write-Host "Nächste Schritte: docs\anleitung\erste-schritte.md   ·   Gesundheitscheck: scripts\doctor.ps1"
