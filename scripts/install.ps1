<#
.SYNOPSIS
  Richtet Limitless OS auf diesem Windows-PC ein (einmalig).

.DESCRIPTION
  1. Installiert Node.js LTS, Git für Windows, ffmpeg und Claude Code (falls nicht vorhanden)
  2. Baut den Aufseher und erzeugt die Stations-Skills
  3. Findet deinen Obsidian-Vault (fragt nur bei mehreren) und kopiert die Vorlage nach <Vault>\LimitlessOS
     – vorbefüllt mit Sortiment, Marke, Kalender und ersten Aufgaben; vorhandene Dateien bleiben unangetastet
  4. Markiert den Repo-Ordner für Claude als vertrauenswürdig
  5. Legt die .env an (Shopify-Schlüssel optional)
  6. Meldet dich an: Claude (Abo), Metricool-MCP, Shopify-MCP – je ein Browserfenster
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

  if (-not (Has "python") -and -not (Has "py")) { winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements | Out-Null; RefreshPath }
  if ((Has "python") -or (Has "py")) { Ok "Python 3 (Stimme und Qualitäts-Gate) – Stimme einrichten: powershell -File tools\stimme\install.ps1" } else { Warn "Python fehlt – Stimme und Gate laufen nicht. Später: winget install Python.Python.3.12, dann tools\stimme\install.ps1" }

  $nativeClaude = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
  if (-not (Has "claude") -and -not (Test-Path $nativeClaude)) {
    Write-Host "    Installiere Claude Code (nativ) …"
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  }
  # Der Installer trägt .local\bin nicht selbst in PATH ein (Doku: "prints the fix but doesn't change PATH").
  $localBin = Join-Path $env:USERPROFILE ".local\bin"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ((Test-Path $nativeClaude) -and (-not ($userPath -split ";" | Where-Object { $_.TrimEnd("\") -ieq $localBin }))) {
    [Environment]::SetEnvironmentVariable("Path", ($userPath.TrimEnd(";") + ";" + $localBin), "User")
    Ok "PATH: $localBin ergänzt"
  }
  RefreshPath
  if (-not (Has "claude") -and -not (Test-Path $nativeClaude)) { throw "Claude Code wurde nicht gefunden. Bitte Terminal neu öffnen und Skript erneut starten." }
  if (-not (Has "claude")) { Set-Alias -Name claude -Value $nativeClaude -Scope Script }
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
  # Obsidian führt seine Vaults in %APPDATA%\obsidian\obsidian.json ("vaults": { id: { path, ts, open } }).
  # Ein Vault -> nehmen; mehrere -> Auswahl; keiner/Fehler -> Ordnerdialog.
  $registry = Join-Path $env:APPDATA "obsidian\obsidian.json"
  if (Test-Path $registry) {
    try {
      $reg = Get-Content $registry -Raw | ConvertFrom-Json
      $vaults = @()
      if ($reg.vaults) {
        foreach ($prop in $reg.vaults.PSObject.Properties) {
          $v = $prop.Value
          if ($v.path -and (Test-Path $v.path)) {
            $vaults += [pscustomobject]@{ Path = [string]$v.path; Ts = [long]($(if ($v.ts) { $v.ts } else { 0 })); Open = [bool]$v.open }
          }
        }
      }
      $vaults = @($vaults | Sort-Object -Property @{ Expression = "Open"; Descending = $true }, @{ Expression = "Ts"; Descending = $true })
      if ($vaults.Count -eq 1) {
        $VaultPath = $vaults[0].Path
        Ok "Obsidian-Vault gefunden: $VaultPath"
      } elseif ($vaults.Count -gt 1) {
        Write-Host "    Mehrere Obsidian-Vaults gefunden:"
        for ($i = 0; $i -lt $vaults.Count; $i++) {
          $mark = if ($vaults[$i].Open) { " (zuletzt geöffnet)" } else { "" }
          Write-Host ("      [{0}] {1}{2}" -f ($i + 1), $vaults[$i].Path, $mark)
        }
        $pick = Read-Host "    Nummer wählen (Enter = 1)"
        if (-not $pick) { $pick = "1" }
        $idx = 0
        if ([int]::TryParse($pick, [ref]$idx) -and $idx -ge 1 -and $idx -le $vaults.Count) { $VaultPath = $vaults[$idx - 1].Path }
      }
    } catch { Warn "obsidian.json konnte nicht gelesen werden – Ordner bitte wählen." }
  }
}
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
# Die MCP-Server aus .mcp.json (metricool, shopify) auch über die Benutzer-Einstellungen freigeben – das gilt
# unabhängig vom Vertrauensstatus des Ordners und erspart die Nachfrage in interaktiven Sitzungen.
$userSettingsDir = Join-Path $env:USERPROFILE ".claude"
$userSettingsPath = Join-Path $userSettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $userSettingsDir | Out-Null
$userSettings = [pscustomobject]@{}
if (Test-Path $userSettingsPath) { try { $userSettings = Get-Content $userSettingsPath -Raw | ConvertFrom-Json } catch { Warn "~/.claude/settings.json war nicht lesbar und wird neu angelegt." } }
if (-not $userSettings) { $userSettings = [pscustomobject]@{} }
$userSettings | Add-Member -NotePropertyName enableAllProjectMcpServers -NotePropertyValue $true -Force
[IO.File]::WriteAllText($userSettingsPath, ($userSettings | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding $false))
Ok "~/.claude/settings.json: enableAllProjectMcpServers = true"

# --- 5. .env -------------------------------------------------------------------------
Step ".env anlegen"
$envPath = Join-Path $RepoRoot ".env"
if (-not (Test-Path $envPath)) { Copy-Item (Join-Path $RepoRoot ".env.example") $envPath }
# Immer die native claude.exe bevorzugen: eine alte Claude-Desktop-Version kann ein "Claude.exe" in WindowsApps
# vor die CLI in den PATH legen, und npm-Installationen liefern nur eine .cmd-Hülle, die Node nicht direkt starten kann.
$nativeClaude = Join-Path $env:USERPROFILE ".local\bin\claude.exe"
if (Test-Path $nativeClaude) { $claudeBin = $nativeClaude }
else {
  $claudeCmd = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $claudeCmd) { $claudeCmd = Get-Command claude }
  $claudeBin = $claudeCmd.Source
}
$envText = Get-Content $envPath -Raw
if ($envText -match "(?m)^LIMITLESS_CLAUDE_BIN=.*$") {
  $envText = [regex]::Replace($envText, "(?m)^LIMITLESS_CLAUDE_BIN=.*$", "LIMITLESS_CLAUDE_BIN=$claudeBin")
} else {
  $envText += "`nLIMITLESS_CLAUDE_BIN=$claudeBin`n"
}
[IO.File]::WriteAllText($envPath, $envText, (New-Object System.Text.UTF8Encoding $false))
Ok ".env vorhanden (LIMITLESS_CLAUDE_BIN=$claudeBin)"
Write-Host "    Shopify läuft über den MCP-Login (nächster Schritt). Schlüssel in der .env sind nur für den Datei-Upload nötig (docs\anleitung\shopify-app.md, Weg B)."

# --- 6. Logins: Claude (Abo), Metricool-MCP, Shopify-MCP ----------------------------------
Step "Anmelden: Claude, Metricool, Shopify (je ein Browserfenster)"
# `claude auth status` liefert JSON mit authMethod (claude.ai = Abo, api_key = API) und Exit-Code 0 = angemeldet.
$authOk = $false
try {
  $ErrorActionPreference = "Continue"
  $auth = (& claude auth status 2>&1) -join "`n"
  $authOk = ($LASTEXITCODE -eq 0) -and ($auth -match "claude.ai")
} catch { $authOk = $false } finally { $ErrorActionPreference = "Stop" }
if (-not $authOk) {
  Write-Host "    1/3 Claude: Es öffnet sich der Browser – mit dem claude.ai-Konto (Max-Abo) anmelden, NICHT 'API key'."
  try { $ErrorActionPreference = "Continue"; & claude auth login; $ErrorActionPreference = "Stop" } catch { Warn "Login abgebrochen – später 'claude auth login' ausführen." }
  try {
    $ErrorActionPreference = "Continue"
    $auth = (& claude auth status 2>&1) -join "`n"
    $authOk = ($LASTEXITCODE -eq 0) -and ($auth -match "claude.ai")
  } catch { $authOk = $false } finally { $ErrorActionPreference = "Stop" }
}
if ($authOk) { Ok "1/3 Claude-Abo angemeldet" } else { Warn "Claude ist nicht mit dem Abo angemeldet. Später: 'claude auth login' (claude.ai-Konto wählen)." }

# MCP-Server aus .mcp.json: `claude mcp login <name>` startet den OAuth-Login im Browser, ohne das /mcp-Menü.
# (ab Claude Code 2.1.186; ältere Versionen: 'claude' starten, '/mcp', Server wählen, Authenticate)
$mcpServers = @(
  @{ Name = "metricool"; Label = "2/3 Metricool"; Hint = "mit deinem Metricool-Konto anmelden" },
  @{ Name = "shopify";   Label = "3/3 Shopify";   Hint = "mit dem Shopify-Konto anmelden, dem limitlessposter.com gehört, und den Zugriff bestätigen" }
)
if ($authOk) {
  foreach ($srv in $mcpServers) {
    $status = ""
    try { $ErrorActionPreference = "Continue"; $status = ((& claude mcp get $srv.Name 2>&1) -join "`n"); $ErrorActionPreference = "Stop" } catch { $status = "" }
    if ($status -match "Connected") { Ok ("{0} bereits verbunden" -f $srv.Label); continue }
    Write-Host ("    {0}: Browser öffnet sich – {1}." -f $srv.Label, $srv.Hint)
    try { $ErrorActionPreference = "Continue"; & claude mcp login $srv.Name; $ErrorActionPreference = "Stop" } catch { }
    try { $ErrorActionPreference = "Continue"; $status = ((& claude mcp get $srv.Name 2>&1) -join "`n"); $ErrorActionPreference = "Stop" } catch { $status = "" }
    if ($status -match "Connected") { Ok ("{0} verbunden" -f $srv.Label) }
    else { Warn ("{0}: noch nicht verbunden. Später: 'claude mcp login {1}' (oder 'claude' -> '/mcp' -> {1} -> Authenticate)." -f $srv.Label, $srv.Name) }
  }
} else {
  Warn "MCP-Logins übersprungen (erst Claude anmelden). Danach: 'claude mcp login metricool' und 'claude mcp login shopify'."
}

# --- 7. Aufgabenplanung ---------------------------------------------------------------
if (-not $NoTask) {
  Step "Autostart in der Aufgabenplanung einrichten"
  $nodeExe = (Get-Command node).Source
  $action    = New-ScheduledTaskAction -Execute $nodeExe -Argument "supervisor\dist\index.js" -WorkingDirectory $RepoRoot
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  # Eine laufende Aufgabe aus einer früheren Einrichtung lässt sich nicht überschreiben (Zugriff verweigert,
  # 0x80070005). Deshalb erst stoppen und entfernen; schlägt das Neuanlegen trotzdem fehl, die bestehende behalten.
  $existing = Get-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue
  if ($existing) {
    try { Stop-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue } catch { }
    try { Unregister-ScheduledTask -TaskName "LimitlessOS" -Confirm:$false -ErrorAction Stop; Ok "Alte Aufgabe 'LimitlessOS' entfernt" } catch { Warn "Alte Aufgabe konnte nicht entfernt werden – sie wird weiterverwendet." }
  }
  $registered = $false
  try {
    Register-ScheduledTask -TaskName "LimitlessOS" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Limitless OS Aufseher – startet bei Anmeldung" -Force -ErrorAction Stop | Out-Null
    $registered = $true
    Ok "Aufgabe 'LimitlessOS' registriert (Bei Anmeldung, nur wenn du angemeldet bist, Neustart bei Fehler)"
  } catch {
    if (Get-ScheduledTask -TaskName "LimitlessOS" -ErrorAction SilentlyContinue) { Warn ("Aufgabe konnte nicht neu angelegt werden (" + $_.Exception.Message.Trim() + ") – die vorhandene Aufgabe 'LimitlessOS' bleibt.") }
    else { throw }
  }
  try { Start-ScheduledTask -TaskName "LimitlessOS" -ErrorAction Stop; Ok "Aufseher gestartet" } catch { Warn ("Aufseher konnte nicht gestartet werden: " + $_.Exception.Message.Trim() + " – manuell: Start-ScheduledTask LimitlessOS oder npm start") }
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
Write-Host "Deine Karten liegen unter 'Wartet auf dich' (Welt oder Home.md). Anleitung: docs\anleitung\erste-schritte.md   ·   Gesundheitscheck: scripts\doctor.ps1"
