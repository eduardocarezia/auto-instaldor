$ErrorActionPreference = "Stop"

$RawBase = $env:IDEAL_RAW_BASE
if ([string]::IsNullOrWhiteSpace($RawBase)) {
  $RawBase = "https://raw.githubusercontent.com/eduardocarezia/auto-instaldor/ideal-meta-squad-installer-20260611/tmp/ideal-meta-squad-installer-20260623-claude-desktop-local-skills"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "IDEAL Installer: Node.js 18+ nao encontrado. Instale Node.js e rode novamente."
}

$TempRoot = [System.IO.Path]::GetTempPath()
$TempDir = Join-Path $TempRoot ("ideal-installer-" + [System.Guid]::NewGuid().ToString("N"))
$BinDir = Join-Path $TempDir "bin"
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

try {
  Write-Host "Instalador IDEAL Meta-Squad"
  Write-Host "Node: $(node --version)"
  Write-Host "Origem: $RawBase"
  Write-Host ""

  $IdealPath = Join-Path $BinDir "ideal.mjs"
  Invoke-WebRequest -Uri "$RawBase/bin/ideal.mjs" -OutFile $IdealPath

  & node $IdealPath ideal:instalar @args
  exit $LASTEXITCODE
}
finally {
  if ($env:IDEAL_KEEP_TMP -ne "1" -and (Test-Path $TempDir)) {
    Remove-Item -Recurse -Force $TempDir
  }
}
