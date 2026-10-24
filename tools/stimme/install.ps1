<#
.SYNOPSIS
  Richtet die Stimme (lokale Sprachausgabe) für Limitless OS ein.

.DESCRIPTION
  Legt eine Python-Umgebung unter tools\stimme\.venv an, installiert
  Piper (CPU, Stimme "thorsten") und – wenn möglich – Chatterbox Multilingual
  (natürlichere Stimme, eigene Stimme per Referenz-WAV). Lädt die deutsche
  Piper-Stimme herunter und schreibt supervisor\data\stimme.json.

  Alles läuft lokal. Kein Schlüssel, kein Konto, nichts verlässt den Rechner.

.PARAMETER CpuOnly
  Keine CUDA-Pakete, auch wenn eine Nvidia-Karte da ist.
.PARAMETER SkipChatterbox
  Nur Piper installieren (schneller, kleiner, keine eigene Stimme).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\stimme\install.ps1
#>
param(
  [switch]$CpuOnly,
  [switch]$SkipChatterbox
)

$ErrorActionPreference = "Stop"
$Hier = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Resolve-Path (Join-Path $Hier "..\..")
$Venv = Join-Path $Hier ".venv"
$Data = Join-Path $Hier "data"
$StatusDir = Join-Path $Repo "supervisor\data"
$StatusFile = Join-Path $StatusDir "stimme.json"

function Schreibe-Status($felder) {
  New-Item -ItemType Directory -Force -Path $StatusDir | Out-Null
  $alt = @{}
  if (Test-Path $StatusFile) {
    try { $alt = Get-Content $StatusFile -Raw | ConvertFrom-Json -AsHashtable } catch { $alt = @{} }
  }
  foreach ($k in $felder.Keys) { $alt[$k] = $felder[$k] }
  $alt["updated"] = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
  ($alt | ConvertTo-Json -Depth 5) | Set-Content -Path $StatusFile -Encoding UTF8
}

function Finde-Python {
  foreach ($kandidat in @(@("py", "-3"), @("python"), @("python3"))) {
    try {
      $v = & $kandidat[0] $kandidat[1..($kandidat.Length)] -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
      if ($LASTEXITCODE -eq 0 -and $v) {
        $teile = $v.Trim().Split(".")
        if ([int]$teile[0] -ge 3 -and [int]$teile[1] -ge 10) { return $kandidat }
      }
    } catch {}
  }
  return $null
}

Write-Host "== Stimme einrichten ==" -ForegroundColor Cyan

$py = Finde-Python
if (-not $py) {
  Write-Host "Python 3.10 oder neuer fehlt." -ForegroundColor Red
  Write-Host "Installiere es von https://www.python.org/downloads/windows/ (Haken bei 'Add to PATH') und starte dieses Skript erneut."
  Schreibe-Status @{ installed = $false; lastError = "Python 3.10+ fehlt" }
  exit 1
}
Write-Host "Python: $($py -join ' ')"

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
  Write-Host "Lege Umgebung an: $Venv"
  & $py[0] $py[1..($py.Length)] -m venv $Venv
}
$VPy = Join-Path $Venv "Scripts\python.exe"
& $VPy -m pip install --upgrade pip --quiet

$cuda = $false
if (-not $CpuOnly) {
  try { & nvidia-smi *> $null; if ($LASTEXITCODE -eq 0) { $cuda = $true } } catch {}
}
if ($cuda) {
  Write-Host "Nvidia-Karte gefunden – installiere Torch mit CUDA 12.4"
  & $VPy -m pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cu124
} else {
  Write-Host "Keine Nvidia-Karte (oder -CpuOnly) – installiere Torch für CPU"
  & $VPy -m pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
}

Write-Host "Installiere Piper (CPU-Stimme)"
& $VPy -m pip install --quiet piper-tts

$engine = "piper"
$chatterboxFehler = ""
if (-not $SkipChatterbox) {
  Write-Host "Installiere Chatterbox Multilingual (kann einige Minuten dauern)"
  try {
    & $VPy -m pip install --quiet chatterbox-tts
    if ($LASTEXITCODE -ne 0) { throw "pip exit $LASTEXITCODE" }
    & $VPy -c "import chatterbox" 2>$null
    if ($LASTEXITCODE -eq 0) { $engine = "chatterbox" } else { throw "import chatterbox fehlgeschlagen" }
  } catch {
    $chatterboxFehler = "$_"
    Write-Host "Chatterbox nicht installierbar ($chatterboxFehler) – Piper bleibt die Stimme." -ForegroundColor Yellow
  }
}

Write-Host "Lade deutsche Piper-Stimme (thorsten, ca. 110 MB)"
New-Item -ItemType Directory -Force -Path (Join-Path $Data "piper") | Out-Null
& $VPy -m piper.download_voices --data-dir (Join-Path $Data "piper") de_DE-thorsten-high

Write-Host "Probe der Textvorverarbeitung"
$probe = & $VPy -I -c "import sys; sys.path.insert(0, r'$Hier'); from vorverarbeitung import normalisieren; print(normalisieren('Poster 50x70 cm für 79,99 €, z. B. im Flur.'))"
Write-Host "  → $probe"

$voices = @("thorsten")

Schreibe-Status @{
  installed = $true
  engine = $engine
  cuda = $cuda
  voices = $voices
  python = (& $VPy -c "import sys;print(sys.version.split()[0])").Trim()
  lastError = $chatterboxFehler
}

Write-Host ""
Write-Host "Fertig. Stimme: $engine$(if ($cuda) { ' (GPU)' } else { ' (CPU)' })" -ForegroundColor Green
Write-Host "Test:  node supervisor\dist\adapters\stimme.js speak --text ""Hallo, das ist die Stimme von Limitless OS."" --out %TEMP%\stimme-test.wav"
Write-Host ""
Write-Host "Eigene Stimme (nur mit Chatterbox): 10–30 Sekunden sauberes WAV ohne Musik als"
Write-Host "  <Vault>\LimitlessOS\Assets\stimmen\julius.wav  ablegen und in Pläne\Produktion.md  'stimme: julius' setzen."
