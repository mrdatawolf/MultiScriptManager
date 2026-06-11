#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
$DIR = $PSScriptRoot

$pass = 0
$fail = 0
$warn = 0

function ok($msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green;   $script:pass++ }
function fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red;     $script:fail++ }
function warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow;  $script:warn++ }

Write-Host ""
Write-Host "Multi Script Manager — pre-flight checks"
Write-Host "========================================="

# ── Node.js ───────────────────────────────────────────────────────────────────
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    fail "Node.js not found. Install from https://nodejs.org"
} else {
    $nodeVer = (node --version 2>$null).TrimStart('v')
    $nodeMajor = [int]($nodeVer -split '\.')[0]
    if ($nodeMajor -ge 18) {
        ok "Node.js v$nodeVer"
    } else {
        fail "Node.js v$nodeVer found but >= 18 required. Install a newer version from https://nodejs.org"
    }
}

# ── npm ───────────────────────────────────────────────────────────────────────
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    fail "npm not found. It normally ships with Node.js."
} else {
    $npmVer = npm --version 2>$null
    ok "npm $npmVer"
}

# ── node_modules ──────────────────────────────────────────────────────────────
if (Test-Path "$DIR\node_modules\electron") {
    ok "node_modules present"
} else {
    warn "node_modules missing — running npm install..."
    Push-Location $DIR
    npm install
    Pop-Location
    ok "npm install completed"
}

# ── Electron binary ───────────────────────────────────────────────────────────
$electronExe = "$DIR\node_modules\electron\dist\electron.exe"
if (Test-Path $electronExe) {
    ok "Electron binary present"
} else {
    warn "Electron binary missing — attempting to download..."
    Push-Location $DIR
    node "$DIR\node_modules\electron\install.js" 2>$null
    Pop-Location
    if (Test-Path $electronExe) {
        ok "Electron binary ready"
    } else {
        fail "Electron binary could not be installed. Try: npm install --force"
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Passed: $pass   Warnings: $warn   Failed: $fail"
Write-Host ""

if ($fail -gt 0) {
    Write-Host "Fix the above errors before launching." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Starting Multi Script Manager..."
Write-Host ""

$electronBin = "$DIR\node_modules\.bin\electron.cmd"
& $electronBin $DIR
